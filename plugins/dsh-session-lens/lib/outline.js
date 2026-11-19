/**
 * 大纲：一段会话的“目录”。
 *
 * 粒度是**自适应的**，因为数据分布很宽：cz 桶里既有 1 步的会话，也有 1,034 步、
 * 368 个叙述段的会话。固定粒度必然在某一头失效，所以按顺序试三档，取第一个能装进
 * `maxLines` 的：
 *
 * 1. **步**：一行一步（步数 ≤ maxLines 时最精确）；
 * 2. **叙述段**：把步合并到“模型说完一句话”为止（有文本的 assistant 消息）或下一条
 *    人类消息处；它是人读转写稿时的自然段落；
 * 3. **轮次**：再不够就按 turn 分组（最粗，兜底）。
 *
 * 无论哪一档，**寻址永远是步号**：每行都带 `s40–52` 这样的区间，`session_read` 的
 * `from` / `to` 收的就是它。粒度只影响“一行写多少”，不影响“怎么点名”。
 *
 * @module dsh-session-lens/outline
 */

import { byteLength, formatBytes } from "./budget.js";
import { contentBlocksOf, collapse } from "./render.js";
import { stepOfSeq, turnOfSeq, turnLabel } from "./steps.js";

/**
 * 把一个事件折算成它对本段摘要的贡献。
 * @param {any} event 会话事件。
 * @param {{userSnippet: string, tools: Map<string, number>, messages: number, bytes: number, hasText: boolean, hasHuman: boolean, hasError: boolean}} bucket 聚合桶。
 * @returns {void}
 */
function accumulate(event, bucket) {
  bucket.messages += 1;
  bucket.bytes += byteLength(JSON.stringify(event.data ?? {}));

  if (event.type === "user/message") {
    if (event?.data?.source?.kind === "user") bucket.hasHuman = true;
    if (bucket.userSnippet === "") {
      const text = contentBlocksOf(event)
        .filter((block) => block?.type === "text")
        .map((block) => String(block.text ?? ""))
        .join(" ");
      if (text.trim() !== "") bucket.userSnippet = collapse(text, 56);
    }
  }

  if (event.type === "assistant/message") {
    for (const block of contentBlocksOf(event)) {
      if (block?.type === "tool-call" && typeof block.name === "string") {
        bucket.tools.set(block.name, (bucket.tools.get(block.name) ?? 0) + 1);
      }
      if (block?.type === "text" && String(block.text ?? "").trim() !== "") bucket.hasText = true;
    }
  }

  if (event.type === "tool/result" && event?.data?.message?.isError === true) bucket.hasError = true;
}

/**
 * 造一个空聚合桶。
 * @param {number} step 步号。
 * @param {number} turn 轮次号。
 * @returns {any} 聚合桶。
 */
function emptyBucket(step, turn) {
  return {
    step,
    turn,
    userSnippet: "",
    tools: new Map(),
    messages: 0,
    bytes: 0,
    hasText: false,
    hasHuman: false,
    hasError: false,
  };
}

/**
 * 按步聚合。
 * @param {readonly any[]} events 表层事件。
 * @param {readonly number[]} stepStarts 步起点 seq。
 * @param {readonly number[]} turnStarts 轮次起点 seq。
 * @returns {any[]} 每步一个聚合桶（按步号升序）。
 */
export function stepAggregates(events, stepStarts, turnStarts) {
  /** @type {Map<number, any>} */
  const buckets = new Map();
  for (const event of events) {
    const step = stepOfSeq(stepStarts, event.seq);
    let bucket = buckets.get(step);
    if (bucket === undefined) {
      bucket = emptyBucket(step, turnOfSeq(turnStarts, event.seq));
      buckets.set(step, bucket);
    }
    accumulate(event, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.step - right.step);
}

/**
 * 把步聚合成「叙述段」：一条人类消息或一句模型文本之后另起一段。
 * @param {any[]} steps 每步聚合桶。
 * @returns {any[]} 段落聚合桶。
 */
export function paragraphAggregates(steps) {
  /** @type {any[]} */
  const paragraphs = [];
  let current;
  for (const step of steps) {
    const startsNew = current === undefined || step.hasHuman || current.hasText;
    if (startsNew) {
      if (current !== undefined) paragraphs.push(current);
      current = { ...emptyBucket(step.step, step.turn), from: step.step, to: step.step };
    }
    current.to = step.step;
    current.messages += step.messages;
    current.bytes += step.bytes;
    current.hasText = step.hasText;
    current.hasHuman = step.hasHuman || current.hasHuman;
    current.hasError = current.hasError || step.hasError;
    if (current.userSnippet === "" && step.userSnippet !== "") current.userSnippet = step.userSnippet;
    for (const [name, count] of step.tools) current.tools.set(name, (current.tools.get(name) ?? 0) + count);
  }
  if (current !== undefined) paragraphs.push(current);
  return paragraphs;
}

/**
 * 按轮次聚合（兜底粒度）。
 * @param {any[]} steps 每步聚合桶。
 * @returns {any[]} 每轮一个聚合桶。
 */
export function turnAggregates(steps) {
  /** @type {Map<number, any>} */
  const turns = new Map();
  for (const step of steps) {
    let bucket = turns.get(step.turn);
    if (bucket === undefined) {
      bucket = { ...emptyBucket(step.step, step.turn), from: step.step, to: step.step };
      turns.set(step.turn, bucket);
    }
    bucket.to = step.step;
    bucket.messages += step.messages;
    bucket.bytes += step.bytes;
    bucket.hasError = bucket.hasError || step.hasError;
    if (bucket.userSnippet === "" && step.userSnippet !== "") bucket.userSnippet = step.userSnippet;
    for (const [name, count] of step.tools) bucket.tools.set(name, (bucket.tools.get(name) ?? 0) + count);
  }
  return [...turns.values()].sort((left, right) => left.from - right.from);
}

/**
 * 把聚合桶渲染成一行。
 * @param {any} bucket 聚合桶。
 * @param {number | undefined} previousTurn 上一行的轮次（用于只在换轮时打印 `tN`）。
 * @param {number} [maxBytes] 单次读取预算；超过它的行会被标上“需续读”。
 * @returns {string} 一行文本。
 */
export function renderLine(bucket, previousTurn, maxBytes = Number.POSITIVE_INFINITY) {
  const from = bucket.from ?? bucket.step;
  const to = bucket.to ?? bucket.step;
  const range = from === to ? `s${from}` : `s${from}–${to}`;
  const turnPrefix = bucket.turn === previousTurn ? "" : `${turnLabel(bucket.turn)} · `;
  const tools =
    bucket.tools.size === 0
      ? "无工具"
      : [...bucket.tools.entries()].map(([name, count]) => `${name}×${count}`).join(", ");
  const snippet = bucket.userSnippet === "" ? "" : `  "${bucket.userSnippet}"`;
  const error = bucket.hasError ? " · 含错误" : "";
  const oversized = bucket.bytes > maxBytes ? " · 需续读" : "";
  return `${turnPrefix}${range}${snippet} · ${tools} · ${bucket.messages} 事件 · ${formatBytes(bucket.bytes)}${error}${oversized}`;
}

/**
 * 生成大纲。
 * @param {readonly any[]} events 表层事件。
 * @param {{stepStarts: readonly number[], turnStarts: readonly number[], maxLines: number, maxBytes?: number}} options 选项。
 * @returns {{lines: string[], granularity: "step" | "paragraph" | "turn", truncated: boolean, nextStep: number | undefined}} 大纲。
 */
export function buildOutline(events, options) {
  const steps = stepAggregates(events, options.stepStarts, options.turnStarts);
  if (steps.length === 0) {
    return { lines: ["（这个区间里没有可读内容）"], granularity: "step", truncated: false, nextStep: undefined };
  }
  const maxLines = Math.max(1, options.maxLines);
  /** @type {{granularity: "step" | "paragraph" | "turn", buckets: any[]}} */
  let chosen;
  if (steps.length <= maxLines) {
    chosen = { granularity: "step", buckets: steps };
  } else {
    const paragraphs = paragraphAggregates(steps);
    if (paragraphs.length <= maxLines) chosen = { granularity: "paragraph", buckets: paragraphs };
    else chosen = { granularity: "turn", buckets: turnAggregates(steps) };
  }

  let buckets = chosen.buckets;
  let truncated = false;
  let nextStep;
  if (buckets.length > maxLines) {
    truncated = true;
    const dropped = buckets.slice(maxLines);
    nextStep = dropped[0]?.from ?? dropped[0]?.step;
    buckets = buckets.slice(0, maxLines);
  }

  const lines = [];
  let previousTurn;
  for (const bucket of buckets) {
    lines.push(renderLine(bucket, previousTurn, options.maxBytes));
    previousTurn = bucket.turn;
  }
  return { lines, granularity: chosen.granularity, truncated, nextStep };
}
