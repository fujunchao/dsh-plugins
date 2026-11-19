/**
 * 设置页的宿主端 HTTP 路由（挂在 `/clean-route` 前缀下）。
 *
 * 为什么用 HTTP 而不是远程服务：客户端半与宿主半同源，`ctx.webServer.register` 是
 * 本工作区既有插件的成熟做法（dsh-siyuan-notes 同构），不依赖额外的 RPC 编解码层。
 *
 * 端点：
 *   GET  /clean-route/state        规则、最近一次真实组装、净化记录、xhigh 状态
 *   POST /clean-route/rules        保存规则（mode: model | yaml），先校验后写盘
 *   POST /clean-route/preview      用当前或草稿规则渲染净化前后对照
 *   GET  /clean-route/xhigh        xhigh 补丁状态
 *   POST /clean-route/xhigh/apply  尝试写入补丁（宿主未关会失败并给出指引）
 *
 * @module dsh-clean-route/api
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compileRules, parseRules } from "./config.js";
import { scrubAssembly, renderScrubbedSections } from "./scrub.js";
import { defaultYaml, modelToYaml, toModel, toYaml } from "./rules-model.js";
import { applyPatch, inspect as inspectXhigh } from "./xhigh.js";

/** 请求体上限：规则表 + carrier 足够，防止误发大文件。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 「测试」请求的预算：足够拿到首字，又不至于卡住设置页。 */
const VERIFY_TIMEOUT_MS = 60000;

/**
 * 没有真实组装时的兜底：仓库里的 fixtures/assembly.json（由 build-fixture.mjs 从安装生成）。
 * 这样第一次进设置页就能点「预览 / 测试」，不用先聊一句。
 */
function loadFixtureAssembly() {
  try {
    const url = new URL("../test/fixtures/assembly.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(url, "utf8"));
    return { sections: parsed.sections ?? [], contexts: parsed.contexts ?? [], variables: {} };
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseBody(text, label = "规则表") {
  try {
    return { ok: true, ...parseRules(text, { label }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 用一组规则渲染一次净化，产出对照与残留信息。 */
function previewWith(compiled, assembly, selection) {
  const before = renderScrubbedSections(assembly.sections);
  const outcome = scrubAssembly(assembly, { modelSelection: selection }, compiled);
  const after = renderScrubbedSections(outcome.assembly.sections);
  const residue = outcome.hits.droppedSections.filter((name) => {
    const section = assembly.sections.find((candidate) => candidate.name === name);
    return section !== undefined && section.text.length > 40 && after.includes(section.text);
  });
  return {
    applied: outcome.applied,
    beforeChars: before.length,
    afterChars: after.length,
    hits: outcome.hits,
    residue,
    beforePreview: before.slice(0, 1200),
    afterPreview: after.slice(0, 1200),
    sections: assembly.sections.map((section) => ({
      name: section.name,
      chars: section.text.length,
      action: outcome.hits.droppedSections.includes(section.name)
        ? "drop"
        : outcome.hits.replacedSections.includes(section.name)
          ? "replace"
          : "keep",
    })),
  };
}

/**
 * 决定「测/预览哪条路由」：
 *  1. 显式给了 provider（可选 model）→ 就用它；
 *  2. 否则优先净化路由清单里的第一个 provider 的真实组装（这才是我们要验的）；
 *  3. 再退到最近一次组装（可能是非净化路由，要如实标注）；
 *  4. 都没有就用内置样本 + 净化路由第一个 provider。
 */
function pickRoute({ rules, seen, body }) {
  const wantedProvider = String(body.provider ?? "");
  const wantedModel = String(body.model ?? "");
  if (wantedProvider.length > 0) {
    return { entry: seen.get(wantedProvider + "/" + wantedModel) ?? null, selection: { provider: wantedProvider, model: wantedModel } };
  }
  const cleanProvider = rules.routes?.[0]?.provider ?? null;
  if (cleanProvider !== null && cleanProvider !== "*") {
    const hit = [...seen.values()].reverse().find((entry) => entry.provider === cleanProvider);
    if (hit !== undefined) return { entry: hit, selection: { provider: hit.provider, model: hit.model } };
  }
  const last = [...seen.values()].at(-1);
  if (last !== undefined) return { entry: last, selection: { provider: last.provider, model: last.model } };
  const fallbackModel = body.model ?? (cleanProvider === "google" || cleanProvider === null ? "gemini-4-hydrogen" : "");
  return { entry: null, selection: { provider: cleanProvider ?? "google", model: fallbackModel } };
}

/** 请求体里的草稿：`yaml` 原样，或把表单模型转成 YAML；都没有则返回 null。 */
function draftYaml(body) {
  if (typeof body.yaml === "string" && body.yaml.trim().length > 0) return body.yaml;
  if (body.model !== undefined && body.model !== null) return modelToYaml(body.model).yaml;
  return null;
}

/** 取「草稿 YAML 优先，否则已保存规则」的编译结果；草稿非法时抛错。 */
function resolveCompiled(store, draftYaml, warnings) {
  if (typeof draftYaml !== "string" || draftYaml.trim().length === 0) return store.get().compiled;
  const parsed = parseBody(draftYaml, "草稿规则");
  if (!parsed.ok) throw new Error(parsed.error);
  const compiled = compileRules(parsed.rules, { baseDir: dirname(store.path), readFileText: (target) => readFileSync(target, "utf8") });
  warnings.push(...parsed.warnings, ...compiled.warnings);
  return compiled;
}

/**
 * 用宿主自己的 llm 服务真发一次最小请求。
 *
 * 关键点：这里直接调 `llm.stream`，绕开 agent 与净化层 —— 发出去的就是我们渲染好的那份
 * 净化后提示词，用来回答「这条规则现在还能不能跑通」。
 */
async function verifyOnce(stream, { provider, model, system }) {
  if (typeof stream !== "function") throw new Error("宿主没有暴露 llm 服务，无法测试");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("测试超时")), VERIFY_TIMEOUT_MS);
  try {
    const options = {
      provider,
      model,
      messages: [
        { role: "system", content: [{ type: "text", text: system }] },
        { role: "user", content: [{ type: "text", text: "只回答一个数字：1+1=?" }] },
      ],
      maxTokens: 128,
      signal: controller.signal,
    };
    let text = "";
    let failure = null;
    let reasonKind = "unknown";
    for await (const chunk of stream(options)) {
      if (chunk === null || typeof chunk !== "object") continue;
      if (chunk.type === "text" || chunk.type === "text-delta") {
        const piece = chunk.text ?? chunk.delta ?? "";
        if (typeof piece === "string") text += piece;
      }
      if (chunk.type === "finish") {
        reasonKind = chunk.reason?.kind ?? "unknown";
        failure = chunk.reason?.failure ?? null;
        break;
      }
      if (text.length > 40) break;
    }
    if (failure !== null || reasonKind === "error") {
      return { ok: false, failureCode: failure?.code ?? "UNKNOWN", failureMessage: failure?.message ?? "", received: text.slice(0, 80) };
    }
    if (reasonKind === "aborted") return { ok: false, failureCode: "ABORTED", failureMessage: "测试被中断", received: text.slice(0, 80) };
    return { ok: true, received: text.slice(0, 80), reasonKind };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} deps
 * @param {import("./config.js").RuleStore} deps.store
 * @param {Map<string, object>} deps.seen 最近一次真实组装（provider/model → assembly）
 * @param {() => object[]} deps.recent 净化记录
 * @param {() => {id: string, name: string}[]} deps.providers 已注册的 provider
 * @param {(options: object) => AsyncIterable<object>} [deps.stream] 宿主 llm.stream，用于「测试」
 * @param {object} [deps.logger]
 */
export function createRoutes({ store, seen, recent, providers, stream, logger }) {
  const state = () => {
    const snapshot = store.get();
    return {
      ok: true,
      rulesPath: store.path,
      source: snapshot.source,
      note: snapshot.note ?? "",
      loadedAt: snapshot.loadedAt,
      warnings: snapshot.warnings ?? [],
      model: toModel(snapshot.rules),
      yaml: toYaml(snapshot.rules),
      defaults: defaultYaml(),
      providers: providers?.() ?? [],
      seen: [...seen.entries()].map(([key, value]) => ({
        key,
        provider: value.provider,
        model: value.model,
        at: value.at,
        sections: value.sections.map((section) => ({ name: section.name, chars: section.text.length })),
        contexts: value.contexts.map((context) => context.name),
      })),
      recent: recent?.() ?? [],
      xhigh: inspectXhigh(),
    };
  };

  const routes = [
    {
      method: "GET",
      path: "/state",
      run: async () => state(),
    },
    {
      method: "POST",
      path: "/rules",
      run: async (body) => {
        if (body.mode === "yaml") {
          if (typeof body.text !== "string") return { status: 400, payload: { ok: false, error: "缺少 text" } };
          const parsed = parseBody(body.text);
          if (!parsed.ok) return { status: 400, payload: { ok: false, error: parsed.error } };
          await writeFile(store.path, body.text, "utf8");
          await store.reload("设置页保存（YAML）");
          return { payload: { ...state(), warnings: parsed.warnings } };
        }
        const built = modelToYaml(body.model ?? {});
        await writeFile(store.path, built.yaml, "utf8");
        await store.reload("设置页保存（表单）");
        return { payload: { ...state(), warnings: built.warnings } };
      },
    },
    {
      method: "POST",
      path: "/preview",
      run: async (body) => {
        const rules = store.get().rules;
        const picked = pickRoute({ rules, seen, body });
        const entry = picked.entry ?? loadFixtureAssembly();
        if (entry === null) {
          return { status: 409, payload: { ok: false, error: "还没有捕获到真实组装：先在净化路由上发一条消息，再回来预览" } };
        }
        const warnings = [];
        let compiled;
        try {
          compiled = resolveCompiled(store, draftYaml(body), warnings);
        } catch (error) {
          return { status: 400, payload: { ok: false, error: error instanceof Error ? error.message : String(error) } };
        }
        const selection = picked.selection;
        return {
          payload: {
            ok: true,
            provider: selection.provider,
            model: selection.model,
            sampleFrom: picked.entry === null ? "fixture" : "real",
            capturedAt: picked.entry?.at ?? null,
            cleanRoute: compiled.match(selection.provider, selection.model),
            warnings,
            ...previewWith(compiled, entry, selection),
          },
        };
      },
    },
    {
      method: "POST",
      path: "/verify",
      run: async (body) => {
        const rules = store.get().rules;
        const picked = pickRoute({ rules, seen, body });
        const assembly = picked.entry ?? loadFixtureAssembly();
        if (assembly === null) {
          return { status: 409, payload: { ok: false, error: "没有可用的提示词样本：先在净化路由上发一条消息" } };
        }
        const selection = picked.selection;
        let compiled;
        const warnings = [];
        try {
          compiled = resolveCompiled(store, draftYaml(body), warnings);
        } catch (error) {
          return { status: 400, payload: { ok: false, error: error instanceof Error ? error.message : String(error) } };
        }
        if (compiled === null) return { status: 400, payload: { ok: false, error: "规则无效" } };
        const outcome = scrubAssembly(assembly, { modelSelection: selection }, compiled);
        const scrubbed = renderScrubbedSections(outcome.assembly.sections);
        const startedAt = Date.now();
        try {
          const result = await verifyOnce(stream, {
            provider: selection.provider,
            model: selection.model,
            system: scrubbed,
          });
          return {
            payload: {
              ok: result.ok,
              tookMs: Date.now() - startedAt,
              provider: selection.provider,
              model: selection.model,
              charsSent: scrubbed.length,
              sampleFrom: picked.entry === null ? "fixture" : "real",
              cleanRoute: compiled.match(selection.provider, selection.model),
              warnings,
              dropped: outcome.hits.droppedSections,
              ...result,
            },
          };
        } catch (error) {
          return {
            status: 502,
            payload: {
              ok: false,
              tookMs: Date.now() - startedAt,
              provider: selection.provider,
              model: selection.model,
              charsSent: scrubbed.length,
              cleanRoute: compiled.match(selection.provider, selection.model),
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
    },
    {
      method: "GET",
      path: "/xhigh",
      // xhigh 补丁托管已迁移到 dsh-model-tuning（见其 docs/adr/0001）。
      // 这里只保留只读状态，供老链接与老脚本判断，不再提供写入。
      run: async () => ({ ok: true, retired: true, movedTo: "dsh-model-tuning", xhigh: inspectXhigh() }),
    },
    {
      method: "POST",
      path: "/xhigh/apply",
      run: async () => ({
        status: 410,
        payload: {
          ok: false,
          retired: true,
          movedTo: "dsh-model-tuning",
          error: "xhigh 补丁托管已迁移到 dsh-model-tuning：设置 → 插件 → dsh-model-tuning → 配置 → 宿主补丁状态",
        },
      }),
    },
  ];

  const handler = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const suffix = url.pathname.replace(/^\/clean-route/, "") || "/";
    const route = routes.find((candidate) => candidate.path === suffix);
    if (route === undefined) return sendJson(res, 404, { ok: false, error: "未知端点：" + suffix });
    if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: "方法不允许：" + req.method });
    try {
      const body = req.method === "POST" ? await readJson(req) : {};
      const result = await route.run(body);
      // 端点可以直接返回 payload，也可以返回 { status, payload }；两种都收。
      const payload = result !== null && typeof result === "object" && "payload" in result && Object.keys(result).length <= 2 ? result.payload : result;
      const status = result !== null && typeof result === "object" && typeof result.status === "number" ? result.status : 200;
      return sendJson(res, status, payload);
    } catch (error) {
      logger?.warn?.("clean-route：" + (error instanceof Error ? error.message : String(error)));
      return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  return { handler, routes, state, dispose() {} };
}
