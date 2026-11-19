import test from "node:test";
import assert from "node:assert/strict";

import {
  FENCE_CLOSE,
  annotate,
  escapeAngles,
  fenceOpen,
  formatTime,
  renderEvent,
  renderRawEvent,
} from "../lib/render.js";

const userEvent = (text) => ({ type: "user/message", seq: 1, data: { content: [{ type: "text", text }] } });
const assistantEvent = (blocks) => ({ type: "assistant/message", seq: 2, data: { message: { content: blocks } } });
const toolEvent = (text, isError = false) => ({
  type: "tool/result",
  seq: 3,
  data: { message: { content: [{ type: "text", text }], isError } },
});

test("escapeAngles 只动小于号", () => {
  assert.equal(escapeAngles("a<b>c"), "a\\u003cb>c");
  assert.equal(escapeAngles("没有尖括号"), "没有尖括号");
});

test("annotate 的首行带步号边注，续行缩进", () => {
  assert.equal(annotate(3, "user", "hi"), "[s3 · user] hi");
  assert.equal(annotate(3, "user", "a\nb"), "[s3 · user] a\n  b");
});

test("user 文本原样渲染", () => {
  assert.equal(renderEvent(userEvent("hello"), { step: 1, mode: "surface" }), "[s1 · user] hello");
});

test("assistant 的文本与工具调用同时出现", () => {
  const rendered = renderEvent(
    assistantEvent([
      { type: "text", text: "我跑一下" },
      { type: "tool-call", name: "pwsh", arguments: '{"command":"ls"}' },
    ]),
    { step: 2, mode: "surface" },
  );
  assert.ok(rendered.startsWith("[s2 · assistant] 我跑一下"), rendered);
  assert.ok(rendered.includes("→ pwsh("), rendered);
});

test("只有推理的 assistant 消息在 surface 层被跳过", () => {
  const rendered = renderEvent(assistantEvent([{ type: "reasoning", text: "思考" }]), { step: 1, mode: "surface" });
  assert.equal(rendered, null);
});

test("工具结果带错误标记", () => {
  const rendered = renderEvent(toolEvent("boom", true), { step: 4, mode: "surface" });
  assert.ok(rendered.startsWith("[s4 · tool !] ← boom"), rendered);
});

test("text 层丢掉工具结果", () => {
  assert.equal(renderEvent(toolEvent("done"), { step: 1, mode: "text" }), null);
});

test("raw 层一行一条，暴露 seq 与类型", () => {
  const event = { seq: 7, type: "step/start", data: { turn: 1, step: 1 } };
  assert.equal(renderRawEvent(event, 1), '[s1 · raw] #7 step/start {"turn":1,"step":1}');
});

test("formatTime 不受区域设置影响", () => {
  const epoch = new Date(2026, 10, 17, 18, 5, 0).getTime();
  assert.equal(formatTime(epoch), "2026-11-17 18:05");
});

test("围栏头带 cwd / id / ref / 步区间 / 快照点，且提示里没有裸小于号", () => {
  const head = fenceOpen({
    cwd: "D:\\augment-projects\\dh",
    id: "session-1",
    ref: "dsh-session:abc",
    title: "登录修好了",
    mode: "surface",
    steps: "s40–52",
    snapshot: "persisted, through seq 12",
  });
  assert.ok(head.startsWith("<foreign-session "), head);
  const note = head.split("\n")[1];
  assert.ok(!note.includes("<"), note);
  for (const fragment of [
    'cwd="D:\\augment-projects\\dh"',
    'id="session-1"',
    'ref="dsh-session:abc"',
    'mode="surface"',
    'steps="s40–52"',
    'snapshot="persisted, through seq 12"',
  ]) {
    assert.ok(head.includes(fragment), `${fragment} missing in ${head}`);
  }
  assert.equal(FENCE_CLOSE, "</foreign-session>");
});
