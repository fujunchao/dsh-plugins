/**
 * 跨区检索：按内容找会话。
 *
 * 作用域是**本插件和官方工具唯一的行为差异**，所以它是显式参数而不是默认能力：
 * 不传 `scope` 时只看调用方工作区；跨项目必须写 `scope: "all"`——这样对话记录里
 * 每一次跨区都留得下痕迹，模型不会不声不响地把别的项目拉进上下文。
 *
 * 命中行自带步号，于是“搜到”到“读到”只差一次 `session_read`。
 *
 * @module dsh-session-lens/find
 */

import { CODES, LensError, integerIn } from "./errors.js";
import { resolveCaller, sessionRef } from "./caller.js";
import { readTitles } from "./projects.js";
import { stepOfSeq, stepStartSeqs, stepLabel } from "./steps.js";
import { formatTime } from "./render.js";
import { redactSecrets } from "./redact.js";

/**
 * 构造 `searchSessions` 的会话过滤器。
 * @param {"workspace" | "all"} scope 作用域。
 * @param {string | undefined} callerCwd 调用方 cwd。
 * @returns {readonly any[]} 会话过滤器数组。
 */
export function scopeFilters(scope, callerCwd) {
  if (scope === "all") return [];
  return [{ kind: "cwd", values: [callerCwd] }];
}

/**
 * 检索期间需要丢弃的记录：调用方自己，以及（默认）子会话。
 * @param {readonly {header: any}[]} records 命中记录。
 * @param {{callerId: string, includeSubagents: boolean}} options 过滤选项。
 * @returns {any[]} 保留的记录。
 */
export function keepRecords(records, options) {
  return records.filter((record) => {
    const header = record?.header;
    if (header?.id === options.callerId) return false;
    if (!options.includeSubagents && header?.origin === "subagent") return false;
    return true;
  });
}

/**
 * 渲染一条命中。
 * @param {number} index 从 1 开始的序号。
 * @param {any} hit 搜索命中（`SessionSearchHit`）。
 * @param {{title: string, step: number | undefined}} extra 补充信息。
 * @returns {string} 三行文本：序号与标题、定位行、摘录。
 */
export function renderHit(index, hit, extra) {
  const header = hit.header;
  const title = extra.title === "" ? "(无标题)" : extra.title;
  const where = header.cwd ?? "(no cwd)";
  const location = extra.step === undefined ? "?" : stepLabel(extra.step);
  const snippet = String(hit.bestMatch?.snippet ?? "").replace(/\s+/g, " ").trim();
  return [
    `${index}. ${title} · ${where}`,
    `   ${header.id} · ${location} · ${formatTime(header.createdAt)} · ref=${sessionRef(header.id)}`,
    `   "${snippet}"`,
  ].join("\n");
}

/**
 * `session_find` 的完整执行。
 * @param {any} ctx 插件上下文。
 * @param {any} config 归一化配置。
 * @param {any} args 模型参数。
 * @param {any} exec 工具执行上下文。
 * @returns {Promise<string>} 工具结果文本。
 */
export async function executeFind(ctx, config, args, exec) {
  const signal = exec?.signal;
  const caller = await resolveCaller(ctx, exec, signal);
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (query === "") throw new LensError(CODES.badArgs, "query must be a non-empty string");

  const scope = args?.scope === "all" ? "all" : "workspace";
  if (scope === "workspace" && caller.cwd === undefined) {
    return (
      "调用方会话没有 cwd，所以“当前工作区”这个作用域无意义。" +
      '跨项目检索请显式传 scope: "all"。'
    );
  }
  const includeSubagents = typeof args?.include_subagents === "boolean" ? args.include_subagents : config.includeSubagentsDefault;
  const limit = args?.limit === undefined ? config.maxFindResults : integerIn(args.limit, 1, config.maxFindResults, "limit");
  const includeSecrets = args?.include_secrets === true;
  const redacted = config.redactSecrets && !includeSecrets;

  let page;
  try {
    page = await ctx.sessionQuery.searchSessions(
      {
        query,
        sessionFilters: scopeFilters(scope, caller.cwd),
        limit: Math.min(limit * 4, 100),
      },
      { signal },
    );
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "SESSION_LENS_SEARCH_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    throw new LensError(code, `session search failed: ${message}`, { cause: error });
  }

  const kept = keepRecords(page.items, { callerId: caller.id, includeSubagents }).slice(0, limit);
  const scopeNote =
    scope === "all"
      ? "scope=all（跨全部项目）"
      : `scope=workspace（仅 ${caller.cwd}）`;
  const subagentNote = includeSubagents ? "包含子会话" : "子会话已排除";

  if (kept.length === 0) {
    const hints = [
      scope === "workspace" ? '跨项目再试一次：加 scope: "all"' : "",
      includeSubagents ? "" : "子代理里可能才有答案：加 include_subagents: true",
      "换个更短的词（字面匹配，不是语义搜索）",
    ].filter((hint) => hint !== "");
    return [`没有命中（${scopeNote} · ${subagentNote}）。可尝试：`, ...hints.map((hint) => `- ${hint}`)].join("\n");
  }

  const titles = await readTitles(ctx, kept, signal);
  const lines = [`命中 ${kept.length} 个会话（${scopeNote} · ${subagentNote}）`];
  for (const [index, hit] of kept.entries()) {
    lines.push(
      renderHit(index + 1, hit, {
        title: titles.get(hit.header.id) ?? "",
        step: await stepOfHit(ctx, hit),
      }),
    );
  }
  lines.push("");
  lines.push('读正文：session_read(session_id="…", from=<步号>, to=<步号>)');
  const output = lines.join("\n");
  return redacted ? redactSecrets(output) : output;
}

/**
 * 命中事件的步号。拿不到就返回 undefined——定位只是便捷信息，不该让整次检索失败。
 * @param {any} ctx 插件上下文。
 * @param {any} hit 搜索命中。
 * @returns {Promise<number | undefined>} 步号。
 */
async function stepOfHit(ctx, hit) {
  const seq = hit?.bestMatch?.seq;
  if (typeof seq !== "number") return undefined;
  try {
    const records = await ctx.sessionQuery.listEvents(hit.header.id);
    return stepOfSeq(stepStartSeqs(records), seq);
  } catch {
    return undefined;
  }
}
