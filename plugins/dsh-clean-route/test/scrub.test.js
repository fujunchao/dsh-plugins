import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRules, compileRules } from "../lib/config.js";
import { scrubAssembly, renderScrubbedSections } from "../lib/scrub.js";

/** 组装一份贴近真实形态的 assembly。 */
function makeAssembly() {
  return {
    sections: [
      { name: "harness:identity", text: "身份句" },
      { name: "deployment:persona-prefix", text: "旧人设" },
      { name: "captured:body:1", text: "工具规范正文" },
      { name: "harness:source", text: "checkout 段落" },
      { name: "app:web-surface", text: "GUI 段落" },
    ],
    contexts: [
      { name: "harness:source", text: "checkout 提醒" },
      { name: "app:web-surface", text: "GUI 提醒" },
      { name: "memory", text: "记忆块" },
    ],
    variables: {},
  };
}

function rulesFrom(yaml, options = {}) {
  const { rules } = parseRules(yaml);
  return compileRules(rules, { baseDir: options.baseDir ?? process.cwd(), readFileText: options.readFileText ?? (() => "") });
}

test("不在净化路由上时原样返回，且不重建对象", () => {
  const assembly = makeAssembly();
  const compiled = rulesFrom("routes: [{ provider: google }]");
  const outcome = scrubAssembly(assembly, { modelSelection: { provider: "deepseek", model: "deepseek-v4.1-flash" } }, compiled);
  assert.equal(outcome.applied, false);
  assert.equal(outcome.assembly, assembly);
});

test("默认规则剔三处 section、替换人设、剔两条 context", () => {
  const assembly = makeAssembly();
  const compiled = rulesFrom("routes: [{ provider: google }]");
  const outcome = scrubAssembly(assembly, { modelSelection: { provider: "google", model: "gemini-4-hydrogen" } }, compiled);
  assert.equal(outcome.applied, true);
  assert.deepEqual(outcome.hits.droppedSections, ["harness:identity", "harness:source", "app:web-surface"]);
  assert.deepEqual(outcome.hits.replacedSections, ["deployment:persona-prefix"]);
  assert.deepEqual(outcome.hits.droppedContexts, ["harness:source", "app:web-surface"]);
  const names = outcome.assembly.sections.map((section) => section.name);
  assert.deepEqual(names, ["deployment:persona-prefix", "captured:body:1"]);
  assert.deepEqual(outcome.assembly.contexts.map((context) => context.name), ["memory"]);
  const rendered = renderScrubbedSections(outcome.assembly.sections);
  assert.ok(!rendered.includes("身份句"));
  assert.ok(!rendered.includes("checkout 段落"));
  assert.ok(rendered.includes("工具规范正文"));
});

test("模型 glob 只命中声明的模型", () => {
  const compiled = rulesFrom("routes: [{ provider: google, model: 'gemini-*' }]");
  const hit = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "gemini-4-hydrogen" } }, compiled);
  const miss = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "gemma-4" } }, compiled);
  assert.equal(hit.applied, true);
  assert.equal(miss.applied, false);
});

test("textRules 支持字面量与正则，并累计命中次数", () => {
  const compiled = rulesFrom(`
routes: [{ provider: google }]
sections:
  drop: []
  replace: {}
contexts:
  drop: []
textRules:
  - pattern: "旧人设"
    replacement: "新人设"
  - pattern: "工[具]规范"
    replacement: "工具/规范"
    regex: true
`);
  const outcome = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "m" } }, compiled);
  const rendered = renderScrubbedSections(outcome.assembly.sections);
  assert.ok(rendered.includes("新人设"));
  assert.ok(rendered.includes("工具/规范正文"));
  assert.equal(outcome.hits.textRuleHits.length, 2);
  assert.equal(compiled.textRules[0].count, 1);
  assert.equal(compiled.textRules[1].count, 1);
});
test("替换文本里的 {{ 会被钉成字面量，避免 interpolate 抛错", () => {
  const compiled = rulesFrom(`
routes: [{ provider: google }]
sections:
  drop: []
  replace:
    deployment:persona-prefix: "含 {{model}} 的文本"
`);
  const outcome = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "m" } }, compiled);
  const persona = outcome.assembly.sections.find((section) => section.name === "deployment:persona-prefix");
  assert.equal(persona.interpolate, false);
});

test("append 追加在末尾且不可被插值", () => {
  const compiled = rulesFrom(`
routes: [{ provider: google }]
sections:
  drop: []
  replace: {}
  append:
    - "第一段追加"
    - name: extra
      text: "第二段追加"
`);
  const outcome = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "m" } }, compiled);
  const names = outcome.assembly.sections.map((section) => section.name);
  assert.deepEqual(names.slice(-2), ["clean-route:append:0", "extra"]);
  assert.equal(outcome.assembly.sections.at(-1).interpolate, false);
});

test("carrier 整份接管后只剩载体文本与 append", () => {
  const compiled = rulesFrom(`
routes: [{ provider: google }]
carrier: carrier.txt
sections:
  append: ["尾巴"]
`, { baseDir: "/rules", readFileText: (target) => (target.endsWith("carrier.txt") ? "载体提示词" : "") });
  const outcome = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "m" } }, compiled);
  assert.equal(outcome.hits.carrierApplied, true);
  const names = outcome.assembly.sections.map((section) => section.name);
  assert.deepEqual(names, ["clean-route:carrier", "clean-route:append:0"]);
  assert.ok(renderScrubbedSections(outcome.assembly.sections).startsWith("载体提示词"));
});

test("section 不存在时替换是空操作，不抛错", () => {
  const compiled = rulesFrom(`
routes: [{ provider: google }]
sections:
  drop: [不存在的 section]
  replace:
    "不存在的 section": "x"
`);
  const outcome = scrubAssembly(makeAssembly(), { modelSelection: { provider: "google", model: "m" } }, compiled);
  assert.equal(outcome.assembly.sections.length, makeAssembly().sections.length);
});
