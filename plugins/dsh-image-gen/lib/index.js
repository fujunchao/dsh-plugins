import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import z from "@deepseek-ai/schemastery";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BACKGROUNDS,
  ImageApiError,
  OUTPUT_FORMATS,
  QUALITIES,
  editImages,
  generateImages,
  validateSize,
} from "./api.js";
import { buildImageFilename, extensionFor, slugify } from "./images.js";
import { describeError } from "./retry.js";

export const name = "dsh-image-gen";
// The tool service is the only hard requirement; the web server (settings test
// API) is optional and attached through a callback injection below, so the
// plugin also activates in headless profiles without a web server.
export const inject = ["tools"];

/** Settings-card namespace (loader entry id in cordis.patch.yml). */
export const SETTINGS_ID = "image-gen";
/** Loopback settings-page helper API prefix. */
export const TEST_API_PREFIX = "/dsh-image-gen/api";
/** API key 回退链：apiKeyEnv（默认 IMAGE_GEN_API_KEY）未配置时回退 OPENAI_API_KEY。 */
export const API_KEY_FALLBACK_REF = "OPENAI_API_KEY";

export const Config = z
  .object({
    baseURL: z.string().default("https://api.openai.com/v1").volatile(),
    model: z.string().default("gpt-image-2.5").volatile(),
    apiKey: z.string().role("secret").volatile(),
    apiKeyEnv: z.string().role("credential-ref").default("IMAGE_GEN_API_KEY").volatile(),
    size: z.string().default("auto").volatile(),
    quality: z.string().default("medium").volatile(),
    outputFormat: z.string().default("png").volatile(),
    outputDir: z.string().default("images").volatile(),
    n: z.number().step(1).min(1).max(4).default(1).volatile(),
    timeoutSeconds: z.number().step(1).min(30).max(900).default(300).volatile(),
  })
  .description("图片生成（OpenAI Images 兼容端点，gpt-image 系列）配置");

function nonEmpty(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
}

/** 读取当前生效配置（volatile 活视图每次调用都取新值，设置卡保存即生效）。 */
function currentConfig(config) {
  return {
    baseURL: nonEmpty(config.baseURL.get()) ?? "https://api.openai.com/v1",
    model: nonEmpty(config.model.get()) ?? "gpt-image-2.5",
    apiKey: nonEmpty(config.apiKey.get()),
    apiKeyEnv: nonEmpty(config.apiKeyEnv.get()) ?? "IMAGE_GEN_API_KEY",
    size: config.size.get(),
    quality: config.quality.get(),
    outputFormat: config.outputFormat.get(),
    outputDir: config.outputDir.get(),
    n: config.n.get(),
    timeoutSeconds: config.timeoutSeconds.get(),
  };
}

async function resolveRef(ctx, envRef) {
  const ref = credentialRef(envRef);
  try {
    const credentials = ctx.get("credentials");
    if (credentials !== undefined) {
      const resolved = await credentials.resolve(ref);
      if (typeof resolved?.value === "string" && resolved.value.length > 0) return resolved.value;
    }
  } catch {
    /* credentials 服务不可用 → 走启动环境回退 */
  }
  try {
    const ambient = launchEnvironmentOf(ctx).get(ref);
    if (ambient !== undefined && ambient.value.length > 0) return ambient.value;
  } catch {
    /* 启动环境不可用 → 视为未配置 */
  }
  return undefined;
}

/**
 * API key 解析链（高 → 低）：配置字面 apiKey > apiKeyEnv 凭据 ref >
 * OPENAI_API_KEY 凭据 ref。返回 { apiKey, source }，供报错与 /check 指引。
 */
async function resolveApiKey(ctx, options) {
  if (options.apiKey !== undefined) return { apiKey: options.apiKey, source: "config" };
  const refs = [options.apiKeyEnv];
  if (!refs.includes(API_KEY_FALLBACK_REF)) refs.push(API_KEY_FALLBACK_REF);
  for (const ref of refs) {
    const value = await resolveRef(ctx, ref);
    if (value !== undefined) return { apiKey: value, source: ref };
  }
  return { apiKey: undefined, source: undefined };
}

/** 当前会话工作区根：registry 命中会话 → 最后一个 workspace → 回退 cwd。 */
function resolveWorkspaceRoot(ctx, agent) {
  try {
    const list = ctx.workspaceRegistry?.list?.() ?? [];
    const last = list[list.length - 1];
    if (last?.path) return last.path;
  } catch {
    /* registry 未就绪 */
  }
  const cwd = agent?.session?.cwd;
  return cwd || process.cwd();
}

function isAbsolutePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  return value.startsWith("/") || value.startsWith("\\\\");
}

/** 生效输出目录：绝对路径原样；相对路径按工作区根解析；空值回退 images/。 */
function resolveOutputDir(ctx, agent, configured) {
  const value = nonEmpty(configured) ?? "images";
  if (isAbsolutePath(value)) return path.normalize(value);
  return path.join(resolveWorkspaceRoot(ctx, agent), value);
}

/** 工具输出统一键集（dsh-tools 的 object 节点不支持 required 数组，必须每个分支同键）。 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", required: true },
    paths: { type: "array", items: { type: "string" }, required: true, description: "生成的图片绝对路径" },
    detail: { type: "string", required: true, description: "给模型看的结果摘要" },
    model: { type: "string", required: true },
    size: { type: "string", required: true },
    quality: { type: "string", required: true },
    revisedPrompt: { type: "string", required: true },
    usage: { type: "string", required: true },
    error: { type: "string", required: true },
  },
  additionalProperties: true,
};

function baseResult(model, size, quality) {
  return {
    ok: false,
    paths: [],
    detail: "",
    model: String(model ?? ""),
    size: String(size ?? ""),
    quality: String(quality ?? ""),
    revisedPrompt: "",
    usage: "",
    error: "",
  };
}

function isAborted(signal, error) {
  return signal?.aborted === true || error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

const ABORT_HINT = "图片生成已中断。如仍需要请重新调用（中断前未完成的请求不会产生文件）。";

function toErrorText(error) {
  if (error instanceof ImageApiError) return error.message;
  return describeError(error);
}

async function saveImages(buffers, { outputDir, prefix, outputFormat }) {
  await mkdir(outputDir, { recursive: true });
  const now = new Date();
  const paths = [];
  for (let index = 0; index < buffers.length; index++) {
    const ext = extensionFor(buffers[index], outputFormat);
    const file = path.join(outputDir, buildImageFilename(prefix, index + 1, ext, now));
    await writeFile(file, buffers[index]);
    paths.push(file);
  }
  return paths;
}

function normalizeNumber(value, fallback, min, max) {
  const num = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeEnum(value, allowed, fallback) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(text) ? text : fallback;
}

/** 每次调用共享的参数归一（args 覆盖配置默认值；非法值落回配置而不是报错，配置值在保存时校验）。 */
function effectiveOptions(args, options) {
  const size = nonEmpty(args.size) ?? options.size;
  return {
    model: nonEmpty(args.model) ?? options.model,
    size: validateSize(size),
    quality: normalizeEnum(args.quality, QUALITIES, normalizeEnum(options.quality, QUALITIES, "medium")),
    outputFormat: normalizeEnum(args.outputFormat, OUTPUT_FORMATS, normalizeEnum(options.outputFormat, OUTPUT_FORMATS, "png")),
    background: normalizeEnum(args.background, BACKGROUNDS, "auto"),
    n: normalizeNumber(args.n, normalizeNumber(options.n, 1, 1, 4), 1, 4),
    timeoutSeconds: normalizeNumber(options.timeoutSeconds, 300, 30, 900),
  };
}

const GENERATE_DESCRIPTION = [
  "文生图（OpenAI Images 兼容端点，默认 gpt-image 系列）。生成图片写入工作区并返回绝对路径。",
  "提示词建议包含主体、风格、构图、色调；中文可用但英文通常更稳。",
  "尺寸：auto 由模型定；常用 1024x1024（方图）/ 2048x1152（16:9 全幅）/ 1024x1536（竖版），宽高比须在 1:3~3:1。",
  "质量：low 十几秒最便宜（约 $0.006/张）；medium 默认；high 精细但约需 2 分钟（约 $0.2/张）；auto 交给端点。",
  "改图/风格化已有图片请改用 edit_image 工具。",
].join("");

const EDIT_DESCRIPTION = [
  "图生图/改图（OpenAI Images edits 端点，multipart）。传入 1-16 张本地图片（PNG/JPEG/WebP/GIF）+ 修改指令，",
  "生成新图写入工作区并返回绝对路径。适合：logo 风格化、截图重绘、配色统一、扩图。",
  "相对路径按当前工作区根解析；其余参数语义与 generate_image 相同。",
].join("");

const SHARED_PARAMETERS = {
  size: { type: "string", description: "输出尺寸：auto 或 宽x高（如 1024x1024、2048x1152、1024x1536）。缺省用插件配置" },
  quality: {
    type: "string",
    enum: ["low", "medium", "high", "auto"],
    description: "质量档位。low 最快最便宜，high 精细但慢（大图约 2 分钟）。缺省用插件配置",
  },
  outputFormat: { type: "string", enum: ["png", "jpeg", "webp"], description: "输出格式，缺省 png（webp 体积更小）" },
  background: {
    type: "string",
    enum: ["auto", "transparent", "opaque"],
    description: "背景：transparent 透明底（png/webp）。缺省 auto",
  },
  n: { type: "number", description: "一次生成张数（1-4，按张计费）。缺省 1" },
  filename: { type: "string", description: "输出文件名前缀（缺省取提示词前 30 字符）" },
  outputDir: { type: "string", description: "输出目录：绝对路径或相对工作区根的目录（缺省 images/）" },
};

function renderToolResult(args, value) {
  const v = value;
  const text = !v?.ok
    ? `❌ 图片生成失败：${v?.error ?? "未知错误"}`
    : `✅ 已生成 ${v.paths?.length ?? 0} 张图片（${v.model} · ${v.size} · ${v.quality}）：\n${(v.paths ?? []).join("\n")}` +
      (v.revisedPrompt ? `\n模型改写后的提示词：${v.revisedPrompt}` : "");
  return [{ type: "text", text }];
}

export function apply(ctx, config) {
  const readOptions = () => currentConfig(config);

  const run = async (args, exec, mode) => {
    const signal = exec?.signal;
    const options = readOptions();
    let eff;
    try {
      eff = effectiveOptions(args, options);
    } catch (error) {
      if (isAborted(signal, error)) {
        const aborted = baseResult(options.model, args.size ?? options.size, options.quality);
        aborted.error = ABORT_HINT;
        return aborted;
      }
      const invalid = baseResult(options.model, args.size ?? options.size, options.quality);
      invalid.error = toErrorText(error);
      return invalid;
    }

    const fail = (errorText) => ({ ...baseResult(eff.model, eff.size, eff.quality), error: errorText });
    if (signal?.aborted) return fail(ABORT_HINT);

    const prompt = nonEmpty(args.prompt);
    if (prompt === undefined) return fail("缺少 prompt（图片生成指令）。请提供 prompt 后重试。");

    try {
      const { apiKey, source } = await resolveApiKey(ctx, options);
      if (apiKey === undefined) {
        return fail(
          `未配置 API key：请在凭据服务存入 ${options.apiKeyEnv}（或 ${API_KEY_FALLBACK_REF}），` +
            `或在设置卡「图片生成」里填写。当前端点 ${options.baseURL}`,
        );
      }

      let inputPaths;
      if (mode === "edit") {
        const raw = Array.isArray(args.imagePaths)
          ? args.imagePaths.map((entry) => String(entry))
          : String(args.imagePaths ?? "").split(/[\n,]+/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        if (raw.length === 0) return fail("缺少 imagePaths（要修改的图片路径，1-16 张）。");
        if (raw.length > 16) return fail(`输入图片最多 16 张，收到 ${raw.length} 张。`);
        const wsRoot = resolveWorkspaceRoot(ctx, exec?.agent);
        inputPaths = raw.map((entry) => (isAbsolutePath(entry) ? path.normalize(entry) : path.join(wsRoot, entry)));
        const missing = [];
        for (const entry of inputPaths) {
          try {
            await stat(entry);
          } catch {
            missing.push(entry);
          }
        }
        if (missing.length > 0) return fail(`输入图片不存在：\n${missing.join("\n")}`);
      }

      const request = {
        baseURL: options.baseURL,
        apiKey,
        prompt,
        n: eff.n,
        size: eff.size,
        quality: eff.quality,
        ...(eff.background !== "auto" ? { background: eff.background } : {}),
        outputFormat: eff.outputFormat,
        timeoutSeconds: eff.timeoutSeconds,
        ...(mode === "edit" ? { imagePaths: inputPaths } : {}),
      };

      const result = mode === "edit" ? await editImages(request, signal) : await generateImages(request, signal);
      if (signal?.aborted) return fail(ABORT_HINT);

      const outputDir = resolveOutputDir(ctx, exec?.agent, nonEmpty(args.outputDir) ?? options.outputDir);
      const prefix = nonEmpty(args.filename) ?? slugify(prompt);
      const paths = await saveImages(result.images, { outputDir, prefix, outputFormat: eff.outputFormat });

      return {
        ...baseResult(eff.model, eff.size, eff.quality),
        ok: true,
        paths,
        detail: `${paths.length} 张图片已写入 ${outputDir}（key 来源 ${source}）`,
        revisedPrompt: result.revisedPrompt ?? "",
        usage: result.usage ? JSON.stringify(result.usage) : "",
      };
    } catch (error) {
      if (isAborted(signal, error)) return fail(ABORT_HINT);
      return fail(toErrorText(error));
    }
  };

  ctx.effect(() => ctx.tools.register(defineTool({
    name: "generate_image",
    description: GENERATE_DESCRIPTION,
    parameters: {
      prompt: { type: "string", required: true, description: "图像描述（必填）。建议含主体、风格、构图、色调" },
      ...SHARED_PARAMETERS,
    },
    output: { schema: OUTPUT_SCHEMA, render: renderToolResult },
    execute: (args, exec) => run(args, exec, "generate"),
  })));

  ctx.effect(() => ctx.tools.register(defineTool({
    name: "edit_image",
    description: EDIT_DESCRIPTION,
    parameters: {
      imagePaths: {
        type: "array",
        items: { type: "string" },
        required: true,
        description: "输入图片路径（1-16 张，PNG/JPEG/WebP/GIF；相对路径按工作区根解析）",
      },
      prompt: { type: "string", required: true, description: "修改指令（必填）：要改成什么样" },
      ...SHARED_PARAMETERS,
    },
    output: { schema: OUTPUT_SCHEMA, render: renderToolResult },
    execute: (args, exec) => run(args, exec, "edit"),
  })));

  // Loopback settings-page helper API. `inject` stays ["tools"]: this plugin
  // also runs in headless profiles where the web server never exists; the
  // callback fiber only starts when the service is provided.
  ctx.effect(() => ctx.inject(["webServer"], (webCtx) => {
    const unregister = webCtx.webServer.register({
      kind: "prefix",
      path: TEST_API_PREFIX,
      handler: createTestApiHandler(readOptions, (options) => resolveApiKey(ctx, options)),
    });
    return () => unregister();
  }), "dsh-image-gen: test api");

  ctx.logger?.info?.("[dsh-image-gen] generate_image / edit_image 工具已注册");
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function endpointHost(baseURL) {
  try {
    return new URL(baseURL).host;
  } catch {
    return String(baseURL ?? "");
  }
}

/**
 * GET  {prefix}/check — 报告当前生效配置与 key 状态（不花钱、不回显 key）。
 * POST {prefix}/test  — 真实生成一张 low 质量 1024x1024 测试图（写临时目录后删除）。
 * 两个端点都仅接受 loopback 请求。
 */
export function createTestApiHandler(readOptions, resolveKey) {
  return async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://dsh.local").pathname;
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "loopback requests only" } });
      return;
    }

    if (req.method === "GET" && pathname === `${TEST_API_PREFIX}/check`) {
      const options = readOptions();
      const { source } = await resolveKey(options);
      writeJson(res, 200, {
        ok: true,
        value: {
          baseURL: options.baseURL,
          endpointHost: endpointHost(options.baseURL),
          model: options.model,
          apiKeyEnv: options.apiKeyEnv,
          apiKeyFallback: API_KEY_FALLBACK_REF,
          apiKeyConfigured: source !== undefined,
          apiKeySource: source ?? "",
          defaults: {
            size: options.size,
            quality: options.quality,
            outputFormat: options.outputFormat,
            outputDir: options.outputDir,
            n: options.n,
            timeoutSeconds: options.timeoutSeconds,
          },
        },
      });
      return;
    }

    if (req.method === "POST" && pathname === `${TEST_API_PREFIX}/test`) {
      const options = readOptions();
      const { apiKey, source } = await resolveKey(options);
      if (apiKey === undefined) {
        writeJson(res, 200, {
          ok: false,
          endpointHost: endpointHost(options.baseURL),
          error: `未配置 API key（${options.apiKeyEnv} / ${API_KEY_FALLBACK_REF}）`,
        });
        return;
      }
      const startedAt = Date.now();
      try {
        const result = await generateImages(
          {
            baseURL: options.baseURL,
            apiKey,
            prompt: "A minimal red circle centered on a white background, flat design",
            n: 1,
            size: "1024x1024",
            quality: "low",
            outputFormat: "png",
            timeoutSeconds: Math.min(options.timeoutSeconds, 180),
          },
          AbortSignal.timeout(Math.min(options.timeoutSeconds, 180) * 1000),
        );
        writeJson(res, 200, {
          ok: true,
          endpointHost: endpointHost(options.baseURL),
          model: options.model,
          apiKeySource: source,
          latencyMs: Date.now() - startedAt,
          bytes: result.images[0]?.length ?? 0,
        });
      } catch (error) {
        writeJson(res, 200, {
          ok: false,
          endpointHost: endpointHost(options.baseURL),
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown endpoint ${req.method} ${pathname}` } });
  };
}
