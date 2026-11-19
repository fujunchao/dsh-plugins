import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_RULES_PATH, RuleStore, compileRoutes, parseRules } from "../lib/config.js";

test("缺省字段落回内置默认规则", () => {
  const { rules } = parseRules("routes: [{ provider: google }]");
  assert.deepEqual(rules.sections.drop, ["harness:identity", "harness:source", "app:web-surface"]);
  assert.equal(rules.sections.replace["deployment:persona-prefix"].includes("编码助手"), true);
  assert.deepEqual(rules.contexts.drop, ["harness:source", "app:web-surface"]);
});

test("未知字段只报警告", () => {
  const { warnings } = parseRules("foo: 1\nroutes: [{ provider: google }]");
  assert.ok(warnings.some((warning) => warning.includes("未知字段 foo")));
});

test("顶层不是映射、version 不对都直接拒绝", () => {
  assert.throws(() => parseRules("- 1"), /顶层必须是映射/);
  assert.throws(() => parseRules("version: 2"), /只支持 version: 1/);
});

test("无效条目逐条忽略，不整体失败", () => {
  const { rules, warnings } = parseRules(`
routes: [123, { model: "无 provider" }, { provider: "ok" }]
sections:
  drop: [1, "harness:identity"]
textRules:
  - { pattern: "(", replacement: "x", regex: true }
`);
  assert.deepEqual(rules.routes, [{ provider: "ok" }]);
  assert.deepEqual(rules.sections.drop, ["harness:identity"]);
  assert.equal(rules.textRules.length, 0);
  assert.ok(warnings.length >= 3);
});

test("路由匹配：provider 通配与 model glob", () => {
  const match = compileRoutes([{ provider: "*", model: "gemini-4-*" }]);
  assert.equal(match("google", "gemini-4-hydrogen"), true);
  assert.equal(match("any", "gemini-4-pro"), true);
  assert.equal(match("any", "gemini-3-pro"), false);
  assert.equal(match("any", undefined), false);
});

test("规则表不存在时用默认规则；坏文件保留上一份有效配置", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-"));
  const file = join(dir, "rules.yml");
  const store = new RuleStore({ path: file, watch: false });
  await store.reload();
  assert.equal(store.get().source, "default");

  writeFileSync(file, "routes: [{ provider: google }]\nsections:\n  drop: [only-this]\n", "utf8");
  await store.reload();
  assert.equal(store.get().source, "file");
  assert.deepEqual(store.get().rules.sections.drop, ["only-this"]);

  writeFileSync(file, "routes: [\n", "utf8");
  await store.reload();
  assert.equal(store.get().source, "file", "坏文件不能替换掉上一份有效配置");
  assert.deepEqual(store.get().rules.sections.drop, ["only-this"]);
});

test("默认规则表路径指向 ~/.dsh/gemini-clean.yml", () => {
  assert.ok(DEFAULT_RULES_PATH.endsWith(join(".dsh", "gemini-clean.yml")));
});
