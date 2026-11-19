import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_KEY_FALLBACK_REF,
  TEST_API_PREFIX,
  apply,
  createTestApiHandler,
  inject,
  name,
} from "../lib/index.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const view = (value) => ({ get: () => value });

function makeConfig(overrides = {}) {
  return {
    baseURL: view(overrides.baseURL ?? "https://gw.example/v1"),
    model: view(overrides.model ?? "gpt-image-2.5"),
    apiKey: view(overrides.apiKey),
    apiKeyEnv: view(overrides.apiKeyEnv ?? "IMAGE_GEN_API_KEY"),
    size: view(overrides.size ?? "auto"),
    quality: view(overrides.quality ?? "medium"),
    outputFormat: view(overrides.outputFormat ?? "png"),
    outputDir: view(overrides.outputDir ?? "images"),
    n: view(overrides.n ?? 1),
    timeoutSeconds: view(overrides.timeoutSeconds ?? 300),
  };
}

function makeCtx({ credentials, workspaceRoot } = {}) {
  const registered = [];
  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    effect: (fn) => {
      fn();
      return () => {};
    },
    inject: () => {},
    on: () => {},
    get: (serviceName) => (serviceName === "credentials" ? credentials : undefined),
    logger: { info() {} },
  };
  if (workspaceRoot !== undefined) ctx.workspaceRegistry = { list: () => [{ path: workspaceRoot }] };
  ctx.registered = registered;
  return ctx;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("module shape: cordis plugin contract", () => {
  assert.equal(name, "dsh-image-gen");
  assert.deepEqual(inject, ["tools"]);
});

test("apply registers generate_image and edit_image with consistent output schema", () => {
  const ctx = makeCtx();
  apply(ctx, makeConfig());
  assert.equal(ctx.registered.length, 2);
  const names = ctx.registered.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["edit_image", "generate_image"]);
  for (const tool of ctx.registered) {
    // defineTool 把作者面的属性级 required:true 编译成 JSON-Schema 的 required 数组。
    const schema = tool.output.schema;
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, true);
    const keys = Object.keys(schema.properties);
    assert.deepEqual(schema.required.slice().sort(), keys.slice().sort(), "every output key must be required");
    const text = tool.output.render({}, { ok: true, paths: ["a.png"], model: "m", size: "1024x1024", quality: "low" });
    assert.equal(text[0].type, "text");
  }
  const generate = ctx.registered.find((entry) => entry.name === "generate_image");
  assert.deepEqual(generate.parameters.required, ["prompt"]);
  const edit = ctx.registered.find((entry) => entry.name === "edit_image");
  assert.deepEqual(edit.parameters.required, ["imagePaths", "prompt"]);
  assert.equal(edit.parameters.properties.imagePaths.items.type, "string");
});

test("generate_image without any key returns guidance mentioning both refs", async () => {
  const ctx = makeCtx();
  apply(ctx, makeConfig());
  const tool = ctx.registered.find((entry) => entry.name === "generate_image");
  const result = await tool.execute({ prompt: "a cat" }, { signal: undefined });
  assert.equal(result.ok, false);
  assert.match(result.error, /IMAGE_GEN_API_KEY/);
  assert.match(result.error, new RegExp(API_KEY_FALLBACK_REF));
  assert.deepEqual(result.paths, []);
});

test("generate_image happy path writes files under the workspace output dir", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "dsh-image-gen-ws-"));
  const ctx = makeCtx({
    credentials: { resolve: async () => ({ value: "sk-gw" }) },
    workspaceRoot: workspace,
  });
  apply(ctx, makeConfig());
  const tool = ctx.registered.find((entry) => entry.name === "generate_image");

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requested = JSON.parse(init.body).n ?? 1;
    return jsonResponse({
      data: Array.from({ length: requested }, () => ({ b64_json: PNG_1X1.toString("base64") })),
      usage: { total_tokens: 42 },
    });
  };
  try {
    const result = await tool.execute(
      { prompt: "城市夜景 skyline", n: 2, size: "1024x1024", quality: "low" },
      { signal: new AbortController().signal, agent: { session: { cwd: workspace } } },
    );
    assert.equal(result.ok, true, result.error);
    assert.equal(result.paths.length, 2);
    for (const file of result.paths) {
      assert.ok(existsSync(file), `${file} should exist`);
      assert.ok(path.isAbsolute(file));
    }
    assert.match(path.basename(result.paths[0]), /^城市夜景-skyline-\d{8}-\d{6}-1\.png$/);
    assert.match(result.usage, /42/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-gw");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.size, "1024x1024");
    assert.equal(body.quality, "low");
    assert.equal(body.n, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("edit_image resolves relative inputs and rejects missing files", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "dsh-image-gen-ws-"));
  writeFileSync(path.join(workspace, "input.png"), PNG_1X1);
  const ctx = makeCtx({
    credentials: { resolve: async () => ({ value: "sk-gw" }) },
    workspaceRoot: workspace,
  });
  apply(ctx, makeConfig());
  const tool = ctx.registered.find((entry) => entry.name === "edit_image");

  const missing = await tool.execute(
    { imagePaths: ["nope.png"], prompt: "repaint" },
    { signal: new AbortController().signal, agent: { session: { cwd: workspace } } },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /nope\.png/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ data: [{ b64_json: PNG_1X1.toString("base64") }] });
  try {
    const result = await tool.execute(
      { imagePaths: ["input.png"], prompt: "repaint" },
      { signal: new AbortController().signal, agent: { session: { cwd: workspace } } },
    );
    assert.equal(result.ok, true, result.error);
    assert.ok(existsSync(result.paths[0]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pre-aborted signal short-circuits with an interrupted error", async () => {
  const ctx = makeCtx({
    credentials: { resolve: async () => ({ value: "sk-gw" }) },
  });
  apply(ctx, makeConfig());
  const tool = ctx.registered.find((entry) => entry.name === "generate_image");
  const result = await tool.execute({ prompt: "a cat" }, { signal: AbortSignal.abort() });
  assert.equal(result.ok, false);
  assert.match(result.error, /中断/);
});

test("invalid size returns INVALID_INPUT text, not a thrown error", async () => {
  const ctx = makeCtx({ credentials: { resolve: async () => ({ value: "sk-gw" }) } });
  apply(ctx, makeConfig());
  const tool = ctx.registered.find((entry) => entry.name === "generate_image");
  const result = await tool.execute({ prompt: "a cat", size: "wide" }, { signal: new AbortController().signal });
  assert.equal(result.ok, false);
  assert.match(result.error, /size/);
});

function mockRes() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
}

const plainOptions = {
  baseURL: "https://gw.example/v1",
  model: "gpt-image-2.5",
  apiKey: undefined,
  apiKeyEnv: "IMAGE_GEN_API_KEY",
  size: "auto",
  quality: "medium",
  outputFormat: "png",
  outputDir: "images",
  n: 1,
  timeoutSeconds: 300,
};

test("GET /check reports config without leaking the key value", async () => {
  const handler = createTestApiHandler(
    () => plainOptions,
    async () => ({ apiKey: "sk-secret-value", source: "OPENAI_API_KEY" }),
  );
  const res = mockRes();
  await handler(
    { method: "GET", url: `${TEST_API_PREFIX}/check`, socket: { remoteAddress: "127.0.0.1" } },
    res,
  );
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.value.apiKeyConfigured, true);
  assert.equal(payload.value.apiKeySource, "OPENAI_API_KEY");
  assert.equal(payload.value.endpointHost, "gw.example");
  assert.ok(!res.body.includes("sk-secret-value"));
});

test("GET /check refuses non-loopback and unknown routes", async () => {
  const handler = createTestApiHandler(() => plainOptions, async () => ({ apiKey: undefined, source: undefined }));
  const far = mockRes();
  await handler({ method: "GET", url: `${TEST_API_PREFIX}/check`, socket: { remoteAddress: "10.0.0.5" } }, far);
  assert.equal(far.status, 403);

  const unknown = mockRes();
  await handler({ method: "GET", url: `${TEST_API_PREFIX}/other`, socket: { remoteAddress: "127.0.0.1" } }, unknown);
  assert.equal(unknown.status, 404);
});

test("POST /test without a key reports a friendly error", async () => {
  const handler = createTestApiHandler(() => plainOptions, async () => ({ apiKey: undefined, source: undefined }));
  const res = mockRes();
  await handler(
    { method: "POST", url: `${TEST_API_PREFIX}/test`, socket: { remoteAddress: "::1" } },
    res,
  );
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /未配置/);
});
