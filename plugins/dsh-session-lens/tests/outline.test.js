import test from "node:test";
import assert from "node:assert/strict";

import { buildOutline, paragraphAggregates, renderLine, stepAggregates } from "../lib/outline.js";

const userEvent = (seq, text, kind = "user") => ({
  type: "user/message",
  seq,
  data: { content: [{ type: "text", text }], source: { kind } },
});

const assistantText = (seq, text) => ({
  type: "assistant/message",
  seq,
  data: { message: { role: "assistant", content: [{ type: "text", text }] } },
});

const assistantToolCall = (seq, name) => ({
  type: "assistant/message",
  seq,
  data: { message: { role: "assistant", content: [{ type: "tool-call", name, arguments: "{}" }] } },
});

const toolResult = (seq, text, isError = false) => ({
  type: "tool/result",
  seq,
  data: { message: { role: "tool", content: [{ type: "text", text }], isError } },
});

const stepStarts = [10, 20, 30];
const turnStarts = [5, 25];

const events = [
  userEvent(1, "注入的上下文", "runtime-context"),
  userEvent(10, "请修登录"),
  assistantToolCall(11, "pwsh"),
  toolResult(12, "报错了", true),
  assistantToolCall(20, "read"),
  assistantText(21, "看完了，原因是 X"),
  assistantText(30, "改好了"),
];

test("stepAggregates 按步聚合，把工具与体积算进去", () => {
  const steps = stepAggregates(events, stepStarts, turnStarts);
  assert.deepEqual(steps.map((entry) => entry.step), [0, 1, 2, 3]);
  assert.equal(steps[1].userSnippet, "请修登录");
  assert.equal(steps[1].hasError, true);
  assert.equal(steps[1].tools.get("pwsh"), 1);
  assert.equal(steps[2].hasText, true);
  assert.equal(steps[3].hasText, true);
});

test("paragraphAggregates 在有文本的 assistant 消息后另起一段", () => {
  const steps = stepAggregates(events, stepStarts, turnStarts);
  const paragraphs = paragraphAggregates(steps);
  // s0（注入上下文）自成一段；s1–s2 合成一段（s2 才出现文本）；s3 另起一段
  assert.deepEqual(paragraphs.map((entry) => [entry.from, entry.to]), [
    [0, 0],
    [1, 2],
    [3, 3],
  ]);
});

test("粒度阶梯：行数够就用步，不够就降级，再不够就截断", () => {
  const wide = buildOutline(events, { stepStarts, turnStarts, maxLines: 100 });
  assert.equal(wide.granularity, "step");
  assert.equal(wide.lines.length, 4);
  assert.equal(wide.truncated, false);

  // 段落：s0 一段、s1–s2 一段（s2 才出现文本）、s3 一段 —— 刚好 3 段
  const medium = buildOutline(events, { stepStarts, turnStarts, maxLines: 3 });
  assert.equal(medium.granularity, "paragraph");
  assert.equal(medium.lines.length, 3);

  // 只给 1 行时只剩按轮分组（t0 / t1 / t2 三组），截断后指出下一组的起点
  const narrow = buildOutline(events, { stepStarts, turnStarts, maxLines: 1 });
  assert.equal(narrow.granularity, "turn");
  assert.equal(narrow.truncated, true);
  assert.equal(narrow.nextStep, 1);
});

test("换轮时才打印 tN，行内带步号区间与错误标记", () => {
  const steps = stepAggregates(events, stepStarts, turnStarts);
  const first = renderLine(steps[1], undefined);
  assert.ok(first.startsWith("t1 · s1"), first);
  assert.ok(first.includes('"请修登录"'), first);
  assert.ok(first.includes("含错误"), first);
  const noError = renderLine(steps[2], 1);
  assert.ok(noError.startsWith("s2"), noError);
  assert.ok(!noError.includes("含错误"), noError);
  const nextTurn = renderLine(steps[3], 1);
  assert.ok(nextTurn.startsWith("t2 · s3"), nextTurn);
});

test("超过单次预算的行标记为需续读", () => {
  const steps = stepAggregates(events, stepStarts, turnStarts);
  const small = renderLine(steps[1], undefined, 10);
  assert.ok(small.includes("需续读"), small);
  const roomy = renderLine(steps[1], undefined, 1024 * 1024);
  assert.ok(!roomy.includes("需续读"), roomy);
});

test("空区间返回可读说明而不是空串", () => {
  const empty = buildOutline([], { stepStarts: [], turnStarts: [], maxLines: 10 });
  assert.deepEqual(empty.lines, ["（这个区间里没有可读内容）"]);
});
