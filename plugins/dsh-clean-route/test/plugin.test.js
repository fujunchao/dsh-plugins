import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { apply } from "../lib/index.js";

/** 最小 Cordis 替身：记录注册的水位线处理器，effect 立即执行并返回 disposer。 */
function fakeContext() {
  const handlers = new Map();
  const warnings = [];
  const webRoutes = [];
  const context = {
    handlers,
    warnings,
    webRoutes,
    get: () => undefined,
    inject(_deps, callback) {
      callback({
        ...context,
        webServer: {
          register({ kind, path, handler }) {
            webRoutes.push({ kind, path, handler });
            return () => {};
          },
        },
      });
    },
    logger: { warn: (message) => warnings.push(String(message)), info() {} },
    effect(fn) {
      const disposer = fn();
      return () => disposer?.();
    },
    on(name, fn) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
      return () => {};
    },
  };
  return context;
}

const assembly = () => ({
  sections: [
    { name: "harness:identity", text: "身份句" },
    { name: "deployment:persona-prefix", text: "旧人设" },
    { name: "captured:body", text: "工具规范" },
    { name: "harness:source", text: "checkout 段" },
  ],
  contexts: [{ name: "harness:source", text: "提醒" }, { name: "memory", text: "记忆" }],
  variables: {},
});

test("插件把净化接在 system-prompt/assemble 出口，且只对净化路由生效", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-plugin-"));
  const rulesPath = join(dir, "rules.yml");
  writeFileSync(rulesPath, "routes: [{ provider: google }]\n", "utf8");
  const ctx = fakeContext();
  apply(ctx, { rulesPath, watch: false });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const handler = ctx.handlers.get("system-prompt/assemble")?.[0];
  assert.equal(typeof handler, "function");

  const scrubbed = await handler(assembly(), { modelSelection: { provider: "google", model: "gemini-4-hydrogen" } }, async () => assembly());
  const names = scrubbed.sections.map((section) => section.name);
  assert.deepEqual(names, ["deployment:persona-prefix", "captured:body"]);
  assert.deepEqual(scrubbed.contexts.map((context) => context.name), ["memory"]);

  const untouched = await handler(assembly(), { modelSelection: { provider: "deepseek", model: "deepseek-v4.1-flash" } }, async () => assembly());
  assert.deepEqual(untouched.sections.map((section) => section.name), ["harness:identity", "deployment:persona-prefix", "captured:body", "harness:source"]);
});

test("净化失败时退回原 assembly，不抛给上层", async () => {
  const ctx = fakeContext();
  apply(ctx, { rulesPath: join(tmpdir(), "clean-route-missing", "rules.yml"), watch: false });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const handler = ctx.handlers.get("system-prompt/assemble")?.[0];
  const broken = { sections: [{ name: "x", get text() { throw new Error("炸了"); } }], contexts: [], variables: {} };
  const result = await handler(broken, { modelSelection: { provider: "google", model: "m" } }, async () => broken);
  assert.equal(result, broken);
});

test("429 类失败会写一条可操作的诊断，且不改任何决策", async () => {
  const ctx = fakeContext();
  apply(ctx, { rulesPath: join(tmpdir(), "clean-route-missing", "rules.yml"), watch: false });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const assemble = ctx.handlers.get("system-prompt/assemble")?.[0];
  await assemble(assembly(), { modelSelection: { provider: "google", model: "gemini-4-hydrogen" } }, async () => assembly());

  const requestError = ctx.handlers.get("agent/request-error")?.[0];
  const action = await requestError({ provider: "google", failure: { code: "RATE_LIMIT" } }, async () => "next-action");
  assert.equal(action, "next-action");
  assert.ok(ctx.warnings.some((warning) => warning.includes("疑似提示词指纹拦截")), "应写出疑似指纹拦截的诊断");
  assert.ok(ctx.warnings.some((warning) => warning.includes("gemini-4-hydrogen")));
});

test("插件把自己挂到 /clean-route 前缀，GET /state 可用", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-wire-"));
  const rulesPath = join(dir, "rules.yml");
  writeFileSync(rulesPath, "routes: [{ provider: google }]\n", "utf8");
  const ctx = fakeContext();
  apply(ctx, { rulesPath, watch: false });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const route = ctx.webRoutes.find((entry) => entry.path === "/clean-route");
  assert.ok(route !== undefined, "应注册 /clean-route 前缀路由");
  assert.equal(route.kind, "prefix");

  const response = { status: 0, body: "" };
  await route.handler(
    { method: "GET", url: "/clean-route/state" },
    { writeHead: (status) => { response.status = status; }, end: (body) => { response.body = body; } },
  );
  const payload = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "file");
  assert.ok(Array.isArray(payload.model.dropSections));
  assert.ok(payload.yaml.includes("version: 1"));
});
