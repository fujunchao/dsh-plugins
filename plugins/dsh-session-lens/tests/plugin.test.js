import test from "node:test";
import assert from "node:assert/strict";

import { apply } from "../lib/index.js";
import { createExec, createFixtureContext, createFixtureStore } from "./support/fixture-store.js";

const header = {
  id: "session-caller",
  cwd: "D:\\augment-projects\\cz",
  createdAt: 1_700_000_000_000,
  version: 4,
  isSeeded: false,
};

const other = {
  id: "session-other",
  cwd: "D:\\augment-projects\\dh",
  createdAt: 1_700_000_100_000,
  version: 4,
  isSeeded: false,
};

const events = [
  { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } },
  { type: "user/message", seq: 2, time: 2, data: { role: "user", id: "m1", content: [{ type: "text", text: "你好" }] } },
  {
    type: "assistant/message",
    seq: 3,
    time: 3,
    data: { turn: 1, step: 1, message: { role: "assistant", id: "m2", content: [{ type: "text", text: "在" }] } },
  },
];

/**
 * 造一个只记录注册动作的假 Cordis 上下文。
 * @returns {any} 假上下文与注册表。
 */
function createPluginContext() {
  const tools = new Map();
  const sections = [];
  const sessionQuery = createFixtureStore([
    { header, events },
    { header: other, events },
  ]);
  const ctx = {
    sessionQuery,
    tools: { register: (definition) => tools.set(definition.name, definition) },
    systemPrompt: {
      section: (section) => {
        sections.push(section);
        return () => {};
      },
      getSectionOrder: () => 10,
    },
    get: (name) => (name === "workspaceRegistry" ? undefined : undefined),
  };
  return { ctx, tools, sections };
}

test("apply 注册三个工具与一段指引", () => {
  const { ctx, tools, sections } = createPluginContext();
  apply(ctx, { redactSecrets: false });
  assert.deepEqual([...tools.keys()].sort(), ["session_find", "session_projects", "session_read"]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "tool:session-lens");
  assert.ok(sections[0].text.includes('scope="all"'), sections[0].text);
});

test("工具描述的第一句就写清作用域边界", () => {
  const { ctx, tools } = createPluginContext();
  apply(ctx, {});
  assert.ok(tools.get("session_find").description.includes('scope="all"'));
  assert.ok(tools.get("session_projects").description.includes("EVERY project"));
  assert.ok(tools.get("session_read").description.includes("any session") || tools.get("session_read").description.includes("including sessions from other projects"));
});

test("注册的定义可被工具注册表消费：schema 是对象根且封闭", () => {
  const { ctx, tools } = createPluginContext();
  apply(ctx, {});
  for (const definition of tools.values()) {
    assert.equal(definition.parameters.type, "object", definition.name);
    assert.equal(definition.parameters.additionalProperties, false, definition.name);
    assert.equal(typeof definition.execute, "function", definition.name);
    assert.deepEqual(definition.output.render(undefined, "x"), [{ type: "text", text: "x" }]);
    // 注册表按 `(args) => boolean` 调用它，必须是函数
    assert.equal(typeof definition.isConcurrencySafe, "function", definition.name);
    assert.equal(typeof definition.isConcurrencySafe({}), "boolean", definition.name);
  }
});

test("端到端：session_find 默认不跨区、scope=all 才跨", async () => {
  const { ctx, tools } = createPluginContext();
  apply(ctx, {});
  const exec = createExec(header);
  const local = await tools.get("session_find").execute({ query: "在" }, exec);
  assert.ok(local.startsWith("命中 ") || local.startsWith("没有命中"), local);
  assert.ok(!local.includes("session-other"), local);
  const global = await tools.get("session_find").execute({ query: "在", scope: "all" }, exec);
  assert.ok(global.includes("session-other"), global);
});

test("端到端：session_read 能读到另一个项目的会话", async () => {
  const { ctx, tools } = createPluginContext();
  apply(ctx, {});
  const output = await tools.get("session_read").execute({ session_id: "session-other", mode: "text" }, createExec(header));
  assert.ok(output.includes('cwd="D:\\augment-projects\\dh"'), output);
  assert.ok(output.includes("你好"), output);
});

test("端到端：session_projects 没有注册表时退化成按 cwd 分组", async () => {
  const { ctx, tools } = createPluginContext();
  apply(ctx, {});
  const output = await tools.get("session_projects").execute({}, createExec(header));
  assert.ok(output.includes("未注册目录") || output.includes("注册表为空"), output);
});
