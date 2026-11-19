/**
 * dsh-clean-route —— 净化路由的宿主半。
 *
 * 只做三件事：
 *  1. 在 `system-prompt/assemble` 出口按规则表改写 assembly（只对净化路由生效）；
 *  2. 记录每次净化的摘要，供 429 诊断与阶段 2 的设置页使用；
 *  3. 请求失败时把「疑似提示词指纹拦截」写清楚（不改任何决策，不自动降级）。
 *
 * @module dsh-clean-route
 */

import { createHash } from "node:crypto";
import { RuleStore, DEFAULT_RULES_PATH, PLUGIN_NAME } from "./config.js";
import { inspect as inspectXhigh, rememberResources } from "./xhigh.js";
import { createRoutes } from "./api.js";
import { scrubAssembly, renderScrubbedSections } from "./scrub.js";

export const name = PLUGIN_NAME;

/**
 * 系统提示词组装是我们唯一必须的服务；HTTP 路由依赖 webServer，用嵌套 inject 优雅降级，
 * provider 列表依赖 llm，取不到就返回空数组（设置页会显示「无」而不是崩）。
 */
export const inject = ["systemPrompt"];

/** 会被当作「疑似指纹拦截」的失败码。 */
const SUSPECT_CODES = new Set(["RATE_LIMIT", "QUOTA", "ACCOUNT_QUOTA"]);
/** 摘要环形缓冲上限（够诊断，不占内存）。 */
const RECENT_LIMIT = 32;

/** 只保留最近 N 条净化摘要。 */
function pushRecent(list, entry) {
  list.push(entry);
  if (list.length > RECENT_LIMIT) list.splice(0, list.length - RECENT_LIMIT);
}

/**
 * @param {object} ctx Cordis 上下文
 * @param {{ rulesPath?: string, watch?: boolean }} [config]
 */
export function apply(ctx, config = {}) {
  const store = new RuleStore({
    path: config.rulesPath ?? DEFAULT_RULES_PATH,
    watch: config.watch !== false,
    logger: ctx.logger,
  });
  const recent = [];
  /** 最近一次真实组装（provider/model → assembly），设置页的净化预览就用它。 */
  const seen = new Map();
  const warned = new Set();
  const SEEN_LIMIT = 8;

  const warnOnce = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    try {
      ctx.logger?.warn?.(PLUGIN_NAME + "：" + message);
    } catch {
      /* 日志不可用时静默 */
    }
  };

  ctx.effect(() => {
    void store.start();
    return () => store.dispose();
  }, "clean-route: rules");

  // 启动时看一眼 xhigh 补丁：宿主升级会把它冲掉，症状是一句难懂的 pi-ai 报错。
  ctx.effect(() => {
    try {
      const status = inspectXhigh();
      if (status.exists !== true) {
        warnOnce("xhigh-unavailable", "xhigh 检测不可用：" + status.error);
      } else {
        rememberResources(status.resources);
        if (!status.patched) {
          warnOnce(
            "xhigh-missing",
            "宿主 pi-ai 未打 xhigh 补丁，第四档会被拒绝（Unsupported Google thinking level mapping）。" +
              "完全退出宿主后运行：node scripts/xhigh.mjs apply",
          );
        }
      }
    } catch (error) {
      warnOnce("xhigh-check", "xhigh 检测失败：" + (error instanceof Error ? error.message : String(error)));
    }
    return () => {};
  }, "clean-route: xhigh status");

  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const result = await next();
    try {
      const snapshot = store.get();
      const selection = context?.modelSelection;
      if (selection !== undefined && selection !== null) {
        const key = selection.provider + "/" + selection.model;
        seen.delete(key);
        seen.set(key, {
          provider: selection.provider,
          model: selection.model,
          at: Date.now(),
          sections: result.sections,
          contexts: result.contexts,
        });
        while (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value);
      }
      const outcome = scrubAssembly(result, context, snapshot.compiled);
      if (!outcome.applied) return result;

      const droppedTexts = result.sections
        .filter((section) => outcome.hits.droppedSections.includes(section.name))
        .map((section) => section.text)
        .filter((text) => typeof text === "string" && text.length >= 40);
      const rendered = renderScrubbedSections(outcome.assembly.sections);
      for (const text of droppedTexts) {
        if (rendered.includes(text)) {
          warnOnce("residue:" + text.slice(0, 24), "净化后仍残留被剔除 section 的原文，规则表可能需要补充 textRules");
        }
      }

      pushRecent(recent, {
        at: Date.now(),
        sessionId: context?.agent?.session?.id ?? null,
        provider: context?.modelSelection?.provider ?? null,
        model: context?.modelSelection?.model ?? null,
        source: snapshot.source,
        chars: rendered.length,
        sha256: createHash("sha256").update(rendered).digest("hex").slice(0, 16),
        hits: {
          droppedSections: outcome.hits.droppedSections,
          replacedSections: outcome.hits.replacedSections,
          droppedContexts: outcome.hits.droppedContexts,
          textRuleHits: outcome.hits.textRuleHits.length,
          carrier: outcome.hits.carrierApplied,
          appended: outcome.hits.appendedSections.length,
        },
      });
      return outcome.assembly;
    } catch (error) {
      warnOnce("scrub-failed", "净化失败，按原样组装：" + (error instanceof Error ? error.message : String(error)));
      return result;
    }
  });

  ctx.on("agent/request-error", async (payload, next) => {
    const action = await next();
    try {
      const code = payload?.failure?.code;
      if (!SUSPECT_CODES.has(code)) return action;
      const provider = payload?.provider;
      const record = [...recent].reverse().find((entry) => entry.provider === provider);
      if (record === undefined) return action;
      ctx.logger?.warn?.(
        PLUGIN_NAME + "：净化请求仍被上游拒绝（provider=" + provider + " model=" + record.model + " code=" + code + "）。" +
          "疑似提示词指纹拦截，不是 UA / 工具 / generationConfig 的问题。\n" +
          "  最近一次净化：" + record.chars + " 字，sha256=" + record.sha256 +
          "，剔除 section=[" + record.hits.droppedSections.join(", ") + "]" +
          "，剔除 context=[" + record.hits.droppedContexts.join(", ") + "]，textRules 命中 " + record.hits.textRuleHits + " 条。\n" +
          "  处置：检查 " + store.path + " 是否漏了新的指纹段；用 scripts/probe.mjs 复验（--live 直打上游）。",
      );
    } catch {
      /* 诊断失败不影响请求 */
    }
    return action;
  });


  // 设置页的宿主端接口：/clean-route/*。没有 web 载体（例如纯 CLI profile）时静默跳过。
  ctx.inject?.(["webServer"], (webCtx) => {
    const webServer = webCtx.webServer;
    if (webServer === undefined || typeof webServer.register !== "function") return;
    const routes = createRoutes({
      store,
      seen,
      recent: () => [...recent],
      providers: () => {
        try {
          return (ctx.get?.("llm")?.listProviders?.() ?? []).map((provider) => ({ id: provider.id, name: provider.name }));
        } catch {
          return [];
        }
      },
      stream: (options) => {
        const llm = ctx.get?.("llm");
        if (llm === undefined) throw new Error("宿主没有 llm 服务");
        return llm.stream(options);
      },
      logger: ctx.logger,
    });
    webCtx.effect(() => {
      const dispose = webServer.register({ kind: "prefix", path: "/clean-route", handler: routes.handler });
      return () => {
        routes.dispose();
        try {
          dispose?.();
        } catch {
          /* 载体已经先放手了 */
        }
      };
    }, "clean-route: /clean-route routes");
  });

}
