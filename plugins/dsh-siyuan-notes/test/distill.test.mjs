/**
 * dsh-siyuan-notes — 自动蒸馏的测试（`node --test`）。
 *
 * 全部用假 stream / 假 write 驱动。蒸馏是**兜底**功能，最重要的一条约束是：
 * 它出任何问题都不能影响会话本身，也不能把垃圾写进长期记忆。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISTILL_LIMITS,
  collectText,
  distillPrompt,
  parseDistillEntries,
  renderTranscript,
  runDistill,
  supersedeTargets,
  shouldDistill,
} from "../lib/distill.js";

// ------------------------------------------------------------ 触发条件

test("shouldDistill 只在压力够高、本轮没写、且过了冷却期时才为真", () => {
  const base = { ratio: 0.8, wroteThisTurn: false, lastRunAt: 0, now: 1_000_000 };
  assert.equal(shouldDistill(base), true);
  assert.equal(shouldDistill({ ...base, ratio: 0.74 }), false, "低于兜底阈值就不跑");
  assert.equal(shouldDistill({ ...base, wroteThisTurn: true }), false, "模型自己写了就不兜底");
  assert.equal(shouldDistill({ ...base, ratio: Number.NaN }), false);
  assert.equal(shouldDistill(null), false);
});

test("shouldDistill 尊重冷却期", () => {
  const now = 1_000_000;
  assert.equal(shouldDistill({ ratio: 0.9, lastRunAt: now - 1000, now }), false);
  assert.equal(shouldDistill({ ratio: 0.9, lastRunAt: now - DISTILL_LIMITS.cooldownMs - 1, now }), true);
  assert.equal(shouldDistill({ ratio: 0.9, lastRunAt: 0, now }), true, "从没跑过就能跑");
});

test("兜底阈值必须高于压力提醒的阈值", () => {
  // 提醒先让模型自己写；兜底只在它没写的时候补刀。
  assert.ok(DISTILL_LIMITS.minRatio > 0.6);
  assert.ok(DISTILL_LIMITS.minRatio < 0.8, "但要比自动压缩的 0.8 早");
});

// ------------------------------------------------------------ 会话渲染

test("renderTranscript 保留对话与精简工具证据，不保留推理", () => {
  const text = renderTranscript([
    { role: "user", content: [{ type: "text", text: "你好" }] },
    { role: "assistant", content: [{ type: "text", text: "在的" }, { type: "tool-call", id: "c1", name: "x", arguments: "{}" }] },
    { role: "tool", content: [{ type: "text", text: "工具验证结果" }] },
    { role: "assistant", content: [{ type: "reasoning", text: "思考不该出现" }] },
  ]);
  assert.ok(text.includes("用户：你好"));
  assert.ok(text.includes("助手：在的"));
  assert.ok(text.includes("工具验证结果"));
  assert.ok(text.includes("[3]"));
  assert.ok(!text.includes("思考不该出现"));
});

test("renderTranscript 从末尾往回取，保证拿到最近的内容", () => {
  const messages = Array.from({ length: 50 }, (_, index) => ({
    role: "user",
    content: [{ type: "text", text: `第 ${index} 条 ${"填充".repeat(50)}` }],
  }));
  const text = renderTranscript(messages, 400);
  assert.ok(text.includes("第 49 条"), "最近一条必须在");
  assert.ok(!text.includes("第 0 条"), "最早的应被挤掉");
  assert.ok(text.length <= 900, "长度受控");
});

test("renderTranscript 对空输入返回空串", () => {
  assert.equal(renderTranscript([]), "");
  assert.equal(renderTranscript(null), "");
});

// ------------------------------------------------------------ 提示词

test("distillPrompt 带上已有结论并限定条数", () => {
  const prompt = distillPrompt({ transcript: "用户：随便聊聊", existing: ["先出方案再动手", "   ", "用中文回答"] });
  assert.ok(prompt.includes("不要重复写"));
  assert.ok(prompt.includes("- 先出方案再动手"));
  assert.ok(prompt.includes("- 用中文回答"));
  assert.ok(prompt.includes("最多 " + DISTILL_LIMITS.maxEntries + " 条"));
  assert.ok(prompt.includes("用户：随便聊聊"));
  assert.ok(!prompt.includes('{"type":"decision"') === false, "要给输出样例");
});

test("distillPrompt 在没有已有结论时省略那一段", () => {
  const prompt = distillPrompt({ transcript: "x", existing: [] });
  assert.ok(!prompt.includes("不要重复写"));
});

// ------------------------------------------------------------ 输出解析

test("parseDistillEntries 容忍代码围栏与前后废话", () => {
  const raw = '好的，结果如下：\n```json\n[{"type":"decision","project":"p","text":"结论\\n- 理由：因为"}]\n```\n希望有帮助。';
  const entries = parseDistillEntries(raw);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "decision");
  assert.equal(entries[0].project, "p");
  assert.ok(entries[0].text.includes("理由：因为"));
});

test("parseDistillEntries 丢掉非法类型与空正文", () => {
  const entries = parseDistillEntries(
    JSON.stringify([
      { type: "nonsense", project: "p", text: "x" },
      { type: "fact", project: "p", text: "   " },
      { type: "fact", project: "p", text: "保留这条" },
    ]),
  );
  assert.deepEqual(entries, [{ type: "fact", project: "p", text: "保留这条" }]);
});

test("parseDistillEntries 限制条数并补默认 project", () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ type: "fact", text: `第 ${index} 条` }));
  const entries = parseDistillEntries(JSON.stringify(many));
  assert.equal(entries.length, DISTILL_LIMITS.maxEntries);
  assert.equal(entries[0].project, "*");
});

test("parseDistillEntries 在垃圾输入上返回空数组而不是抛", () => {
  for (const bad of ["", "没有数组", "[不是合法 JSON", "[]", null, 42]) {
    assert.deepEqual(parseDistillEntries(bad), []);
  }
});

// ------------------------------------------------------------ 收集与执行

/** 造一个假的 chunk 流。 */
async function* fakeStream(chunks) {
  for (const chunk of chunks) yield chunk;
}

test("collectText 拼接文本增量并在 finish 处停止", async () => {
  const text = await collectText(
    fakeStream([
      { type: "text-delta", text: "你" },
      { type: "text-delta", text: "好" },
      { type: "finish", reason: { kind: "stop" } },
      { type: "text-delta", text: "不该收" },
    ]),
  );
  assert.equal(text, "你好");
});

test("runDistill 正常路径：解析并逐条写入", async () => {
  const written = [];
  const result = await runDistill({
    stream: (options) => {
      assert.equal(options.provider, "p");
      assert.equal(options.model, "m");
      assert.equal(options.messages[0].role, "user");
      assert.equal(options.messages[0].content[0].type, "text");
      return fakeStream([
        { type: "text-delta", text: '[{"type":"decision","project":"x","text":"结论一"}]' },
        { type: "finish", reason: { kind: "stop" } },
      ]);
    },
    write: async (spec) => {
      written.push(spec);
      return { ok: true };
    },
    provider: "p",
    model: "m",
    sessionId: "sess-1",
    projects: ["*", "x"],
    transcript: "用户：聊点东西",
  });
  assert.equal(result.ok, true);
  assert.equal(result.written, 1);
  assert.match(written[0].source, /^distill:sess-1#[a-f0-9]{16}$/u);
  // 整理产出直接生效：默认按「对话里有明确依据」写成有效记忆。
  assert.equal(written[0].status, "active");
  assert.equal(written[0].confidence, "stated");
});

test("runDistill 在 stream 抛错时安静失败", async () => {
  const result = await runDistill({
    stream: () => {
      throw new Error("模型挂了");
    },
    write: async () => ({ ok: true }),
    provider: "p",
    model: "m",
    transcript: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.written, 0);
  assert.ok(result.reason.startsWith("stream_failed"));
});

test("runDistill 缺少路由或转录时直接跳过", async () => {
  const io = { stream: () => fakeStream([]), write: async () => ({ ok: true }) };
  assert.equal((await runDistill({ ...io, provider: "", model: "m", transcript: "x" })).reason, "no_route");
  assert.equal((await runDistill({ ...io, provider: "p", model: "m", transcript: "   " })).reason, "empty_transcript");
  assert.equal((await runDistill({ transcript: "x" })).reason, "no_stream_or_write");
});

test("runDistill 单条写失败不影响其余", async () => {
  let calls = 0;
  const result = await runDistill({
    stream: () =>
      fakeStream([
        { type: "text-delta", text: '[{"type":"fact","text":"一"},{"type":"fact","text":"二"}]' },
        { type: "finish", reason: { kind: "stop" } },
      ]),
    write: async () => {
      calls += 1;
      if (calls === 1) throw new Error("第一条写失败");
      return { ok: true };
    },
    provider: "p",
    model: "m",
    transcript: "x",
  });
  assert.equal(result.written, 1);
  assert.equal(result.ok, false);
  assert.match(result.reason, /第一条写失败/);
});

test("蒸馏必须报告部分写入错误，不能伪装成没有可记的内容", async () => {
  const result = await runDistill({
    stream: () => fakeStream([{ type: "text-delta", text: '[{"type":"fact","text":"正文"}]' }]),
    write: async () => ({ ok: false, error: { code: "tag_failed", message: "正文已追加，属性失败，勿重复追加" }, partial: { id: "partial-block" } }),
    provider: "p", model: "m", transcript: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.written, 0);
  assert.match(result.reason, /属性失败/);
  assert.equal(result.failures[0].partial.id, "partial-block");
});

test("distillPrompt 限定 project 取值，避免模型编造项目名", () => {
  // 实测过：不给候选时模型写出了一个根本不存在的项目名 dsh-siyuan-memory，
  // 于是同一条结论因为 project 不同而躲过重复检测。
  const prompt = distillPrompt({ transcript: "x", projects: ["*", "dsh-siyuan-notes"] });
  assert.ok(prompt.includes("只能"));
  assert.ok(prompt.includes("- dsh-siyuan-notes"));
  assert.ok(prompt.includes('`*` 只表示当前工作区'));
  assert.ok(prompt.includes('用户明确要求跨所有项目通用'));
});

test("distillPrompt 在没有候选项目时要求一律填 *", () => {
  const prompt = distillPrompt({ transcript: "x" });
  assert.ok(prompt.includes("不要编造项目名"));
});

test("distillPrompt 要求 state 条目写三段（做到哪/下一步/待决）", () => {
  // state 是新会话接手时最先看到的东西，一句话的 state 等于没写。
  const prompt = distillPrompt({ transcript: "x" });
  assert.ok(prompt.includes("这类必须写成三段"));
  assert.ok(prompt.includes("`- 下一步：`"));
  assert.ok(prompt.includes("`- 待决：`"));
});

test("distillPrompt 要求有实质进展时必须包含 state", () => {
  const prompt = distillPrompt({ transcript: "x" });
  assert.ok(prompt.includes("必须**包含一条 state"));
});

test("supersedeTargets 不再按整个项目自动取代状态", () => {
  const states = new Map([["p", ["old1", "old2"]], ["*", ["g1"]]]);
  assert.equal(supersedeTargets({ type: "state", project: "p" }, states), undefined);
  assert.equal(supersedeTargets({ type: "state", project: "*" }, states), undefined);
  assert.equal(supersedeTargets({ type: "state", project: "unknown" }, states), undefined);
});

test("supersedeTargets 不动 fact / decision", () => {
  // 只有 state 是「当前状态」语义，其他类型可以并存。
  const states = new Map([["p", ["old1"]]]);
  assert.equal(supersedeTargets({ type: "fact", project: "p" }, states), undefined);
  assert.equal(supersedeTargets({ type: "decision", project: "p" }, states), undefined);
});

test("runDistill 写出的状态直接生效，不自己指定取代目标（同主题取代由存储层负责）", async () => {
  const written = [];
  const result = await runDistill({
    stream: () => fakeStream([{ type: "text-delta", text: JSON.stringify([
      {type:"state",project:"p",topic:"editor",text:"新状态\n- 下一步：验收\n- 待决：无"},
      {type:"fact",project:"p",text:"一条事实"}]) }]),
    write: async spec => { written.push(spec); return {ok:true}; }, provider:"p",model:"m",transcript:"x",projects:["*","p"],
    activeStates:new Map([["p",["old-state-id"]]]),
  });
  assert.equal(result.ok,true);
  assert.equal(written.length,2);
  assert.ok(written.every(entry=>entry.status==='active' && entry.supersedes===undefined));
});

test("runDistill：模型标了 inferred 的条目落候选，其余直接生效", async () => {
  const written = [];
  const result = await runDistill({
    stream: () => fakeStream([{ type: "text-delta", text: JSON.stringify([
      { type: "fact", project: "p", text: "有依据的事实" },
      { type: "decision", project: "p", text: "只是猜测的决定", confidence: "inferred" }]) }]),
    write: async spec => { written.push(spec); return { ok: true, value: { status: spec.status } }; }, provider: "p", model: "m", transcript: "x", projects: ["*", "p"],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(written.map(entry => entry.status), ["active", "candidate"]);
  assert.deepEqual(result.entries.map(entry => entry.status), ["active", "candidate"]);
});

test("runDistill：单条校验不过只丢这一条，其余照常写入且整体算成功", async () => {
  const written = [];
  const result = await runDistill({
    stream: () => fakeStream([{ type: "text-delta", text: JSON.stringify([
      { type: "fact", project: "p", text: "超长".repeat(300) },
      { type: "state", project: "p", text: "缺主题和三段" },
      { type: "fact", project: "p", text: "正常的一条" }]) }]),
    write: async spec => { written.push(spec); return { ok: true }; }, provider: "p", model: "m", transcript: "x", projects: ["*", "p"],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.written, 1);
  assert.deepEqual(written.map(entry => entry.body), ["正常的一条"]);
  assert.equal(result.dropped.length, 2);
  assert.match(distillPrompt({ transcript: "x" }), /每条正文不超过 400 字/u);
});
