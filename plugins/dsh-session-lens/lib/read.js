/**
 * 阅读：大纲 / 文本投影 / 模型表层 / 原始日志。
 *
 * 寻址单位是**步**（一次模型调用 + 它触发的工具批次），不是轮次、也不是“人类消息分段”：
 * 实测轮次中位数 2、人类消息中位数 1、步中位数 97——只有步既细又无歧义。
 * 大纲的**行粒度**是自适应的（步 → 叙述段 → 轮次），但**地址永远是步号**。见 `outline.js`。
 *
 * 四个模式对应四种意图：
 * - `outline`  我不知道这段会话里有什么 → 给我目录（一行一段，带步号区间）；
 * - `text`     我只要人话 → user + assistant 的文字；
 * - `surface`  当时到底怎么做的 → 那个会话里模型实际看到的历史（含工具调用与结果）；
 * - `raw`      我要取证 → 逐条未删节事件。
 *
 * 装不下就先给大纲：对大会话来说，“从哪读起”比“一次给多少”更值钱。
 *
 * @module dsh-session-lens/read
 */

import { CODES, LensError, integerIn } from "./errors.js";
import { parseSessionId, resolveCaller, sessionRef } from "./caller.js";
import {
  lastSeqOf,
  stepOfSeq,
  stepSpan,
  stepStartSeqs,
  stepWindow,
  turnStartSeqs,
} from "./steps.js";
import {
  FENCE_CLOSE,
  escapeAngles,
  fenceOpen,
  renderEvent,
  renderRawEvent,
} from "./render.js";
import { byteLength, fitBlocks, formatBytes } from "./budget.js";
import { buildOutline } from "./outline.js";
import { redactSecrets } from "./redact.js";
import { readTitles } from "./projects.js";

/** 合法的阅读模式。 */
export const MODES = Object.freeze(["outline", "text", "surface", "raw"]);

/**
 * 把一段事件渲染成带步号的块。
 * @param {readonly any[]} events 事件。
 * @param {readonly number[]} stepStarts 步起点 seq。
 * @param {"text" | "surface" | "raw"} mode 视图层。
 * @returns {{text: string, seq: number, step: number}[]} 渲染块。
 */
export function renderBlocks(events, stepStarts, mode) {
  /** @type {{text: string, seq: number, step: number}[]} */
  const blocks = [];
  for (const event of events) {
    const step = stepOfSeq(stepStarts, event.seq);
    const text = mode === "raw" ? renderRawEvent(event, step) : renderEvent(event, { step, mode });
    if (text === null || text === "") continue;
    blocks.push({ text, seq: event.seq, step });
  }
  return blocks;
}

/**
 * `session_read` 的完整执行。
 * @param {any} ctx 插件上下文。
 * @param {any} config 归一化配置。
 * @param {any} args 模型参数。
 * @param {any} exec 工具执行上下文。
 * @returns {Promise<string>} 工具结果文本。
 */
export async function executeRead(ctx, config, args, exec) {
  const signal = exec?.signal;
  const caller = await resolveCaller(ctx, exec, signal);
  const targetId = args?.session_id === undefined ? caller.id : parseSessionId(args.session_id);
  const mode = args?.mode === undefined ? "surface" : String(args.mode);
  if (!MODES.includes(mode)) {
    throw new LensError(CODES.badArgs, `mode must be one of ${MODES.join(", ")}`);
  }

  const records = await ctx.sessionQuery.filterSessions([{ kind: "id", values: [targetId] }], signal);
  const record = records[0];
  if (record === undefined) {
    throw new LensError(CODES.unknownSession, `session ${targetId} does not exist on this machine`);
  }
  const header = record.header;

  const eventRecords = await ctx.sessionQuery.listEvents(targetId);
  const stepStarts = stepStartSeqs(eventRecords);
  const turnStarts = turnStartSeqs(eventRecords);

  // 大纲与 raw 走原始日志：表层会被压缩遮掉早期历史，而“目录”必须覆盖整段会话。
  // text / surface 走表层：那问的是“当时那个模型看到了什么”。
  const needsRaw = mode === "outline" || mode === "raw";
  const rawEvents = needsRaw ? await loadRaw(ctx, targetId) : null;
  const surface = needsRaw ? null : await loadSurface(ctx, targetId);
  const events = rawEvents ?? surface.events;
  const capturedThroughSeq = rawEvents === null ? (surface.capturedThroughSeq ?? null) : lastSeqOf(rawEvents);

  const lastSeq = Math.max(lastSeqOf(events), lastSeqOf(eventRecords));
  const totalSteps = stepStarts.length;

  const explicitRange = args?.from !== undefined || args?.to !== undefined;
  const upperStep = Math.max(totalSteps, 1);
  const from = args?.from === undefined ? 0 : integerIn(args.from, 0, upperStep, "from");
  const to = args?.to === undefined ? upperStep : integerIn(args.to, 0, upperStep, "to");
  if (to < from) throw new LensError(CODES.badRange, `to (${to}) must not be smaller than from (${from})`);
  const afterSeq =
    args?.after_seq === undefined ? -1 : integerIn(args.after_seq, -1, Number.MAX_SAFE_INTEGER, "after_seq");
  const includeSecrets = args?.include_secrets === true;
  const redacted = config.redactSecrets && !includeSecrets;

  const window = stepWindow(stepStarts, lastSeq, from, to);
  const inWindow = (seq) => seq >= window.lowSeq && seq <= window.highSeq && seq > afterSeq;

  const title = (await readTitles(ctx, [record], signal)).get(targetId) ?? "(无标题)";

  /** @type {string} */
  let body;
  /** @type {string} */
  let usedMode = mode;
  /** @type {string} */
  let continuation = "";

  if (mode === "outline") {
    const outline = buildOutline(
      events.filter((event) => inWindow(event.seq)),
      {
        stepStarts,
        turnStarts,
        maxLines: config.maxOutlineLines,
        maxBytes: config.maxReadBytes,
      },
    );
    body = outline.lines.join("\n");
    if (outline.truncated && outline.nextStep !== undefined) {
      continuation =
        `…大纲只列到第 ${config.maxOutlineLines} 行（共 ${totalSteps} 步）：` +
        `继续 session_read(session_id="${targetId}", mode="outline", from=${outline.nextStep})`;
    }
  } else {
    const chosen = events.filter((event) => inWindow(event.seq));
    const blocks = renderBlocks(chosen, stepStarts, mode);
    if (blocks.length === 0) {
      body = mode === "raw" ? "（这个区间没有事件）" : "（这个区间没有 user / assistant 文字）";
    } else {
      const totalBytes = blocks.reduce((sum, block) => sum + byteLength(block.text) + 1, 0);
      if (!explicitRange && totalBytes > config.maxReadBytes) {
        // 装不下就先给大纲：让模型先定位，再精读。目录用原始日志，保证覆盖整段会话。
        usedMode = "outline";
        const outline = buildOutline(await loadRaw(ctx, targetId), {
          stepStarts,
          turnStarts,
          maxLines: config.maxOutlineLines,
          maxBytes: config.maxReadBytes,
        });
        body =
          `（这段会话有 ${formatBytes(totalBytes)}，超过单次预算 ${formatBytes(config.maxReadBytes)}，先给大纲。）\n` +
          outline.lines.join("\n");
      } else {
        const fitted = fitBlocks(blocks, config.maxReadBytes);
        body = fitted.kept.map((block) => block.text).join("\n");
        if (fitted.truncated) {
          const next = blocks[fitted.kept.length];
          const lastKept = fitted.kept.at(-1);
          continuation =
            `…已截断（本段 ${formatBytes(fitted.usedBytes)}，还有 ${fitted.omitted} 条未读）：` +
            `继续 session_read(session_id="${targetId}", from=${next.step}, after_seq=${lastKept.seq})`;
        }
      }
    }
  }

  const head = fenceOpen({
    cwd: header.cwd ?? "(no cwd)",
    id: header.id,
    ref: sessionRef(header.id),
    title,
    mode: usedMode,
    steps: stepSpan(window.from, window.to),
    snapshot:
      `${record.live ? "live" : "persisted"}` +
      (capturedThroughSeq === null ? "" : `, through seq ${capturedThroughSeq}`) +
      (record.formatStatus === "migration-required" ? ", format needs migration" : ""),
  });

  const parts = [head, "", escapeAngles(body)];
  if (continuation !== "") parts.push("", continuation);
  parts.push(FENCE_CLOSE);

  const output = parts.join("\n");
  return redacted ? redactSecrets(output) : output;
}

/**
 * 读原始日志（raw 层）。
 * @param {any} ctx 插件上下文。
 * @param {string} targetId 会话 id。
 * @returns {Promise<any[]>} 事件。
 */
async function loadRaw(ctx, targetId) {
  try {
    const log = await ctx.sessionQuery.readSession(targetId);
    return log.events;
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : CODES.readFailed;
    const message = error instanceof Error ? error.message : String(error);
    throw new LensError(code, `cannot read session ${targetId}: ${message}`, { cause: error });
  }
}

/**
 * 读表层（每次读取都是一次一致观察，不订阅、不跟随后续变化）。
 * @param {any} ctx 插件上下文。
 * @param {string} targetId 会话 id。
 * @returns {Promise<any>} `SessionSurfaceSnapshot`。
 */
async function loadSurface(ctx, targetId) {
  try {
    return await ctx.sessionQuery.readSurface(targetId);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : CODES.readFailed;
    const message = error instanceof Error ? error.message : String(error);
    throw new LensError(code, `cannot read session ${targetId}: ${message}`, { cause: error });
  }
}
