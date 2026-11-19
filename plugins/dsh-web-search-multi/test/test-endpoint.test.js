import assert from "node:assert/strict";
import test from "node:test";
import { createTestApiHandler, TEST_API_PREFIX } from "../lib/index.js";

function request({ method = "POST", path = `${TEST_API_PREFIX}/test`, body = "{}", remoteAddress = "127.0.0.1" } = {}) {
  const chunks = body === null ? [] : [Buffer.from(body)];
  return {
    method,
    url: path,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function response() {
  const state = { status: 0, headers: {}, body: "" };
  return {
    state,
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers;
      return this;
    },
    end(chunk) {
      state.body = String(chunk ?? "");
      return this;
    },
  };
}

const SAVED_OPTIONS = {
  provider: "tavily",
  tavilyApiKey: "tvly-test",
  tavilyApiKeyEnv: "TAVILY_API_KEY",
  tavilyBaseURL: "https://api.tavily.com",
  tavilyMaxResults: 8,
  tavilySearchDepth: "basic",
  tavilyIncludeAnswer: true,
  grokApiKey: "xai-test",
  grokApiKeyEnv: "XAI_API_KEY",
  grokBaseURL: "https://api.x.ai/v1",
  grokModel: "grok-4.6",
  openaiApiKey: "sk-test",
  openaiApiKeyEnv: "OPENAI_API_KEY",
  openaiBaseURL: "https://api.openai.com/v1",
  openaiModel: "gpt-5.6",
  geminiApiKey: "gem-test",
  geminiApiKeyEnv: "GEMINI_API_KEY",
  geminiBaseURL: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-3.6-flash",
};

const TAVILY_PAYLOAD = {
  answer: "ok",
  results: [
    { url: "https://example.com/a", title: "A", content: "alpha" },
    { url: "https://example.com/b", title: "B", content: "beta" },
  ],
};

test("非回环请求被拒绝（403）", async () => {
  const handler = createTestApiHandler(() => SAVED_OPTIONS);
  const res = response();
  await handler(request({ remoteAddress: "192.168.1.5" }), res);
  assert.equal(res.state.status, 403);
  const payload = JSON.parse(res.state.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "forbidden");
});

test("GET 与未知路径返回 404", async () => {
  const handler = createTestApiHandler(() => SAVED_OPTIONS);

  const get = response();
  await handler(request({ method: "GET" }), get);
  assert.equal(get.state.status, 404);

  const missing = response();
  await handler(request({ path: `${TEST_API_PREFIX}/nope` }), missing);
  assert.equal(missing.state.status, 404);
});

test("未知后端返回 400 bad-provider", async () => {
  const handler = createTestApiHandler(() => SAVED_OPTIONS);
  const res = response();
  await handler(request({ body: JSON.stringify({ provider: "brave" }) }), res);
  assert.equal(res.state.status, 400);
  const payload = JSON.parse(res.state.body);
  assert.equal(payload.error.code, "bad-provider");
});

test("默认测试已保存的激活后端并返回来源样例", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => TAVILY_PAYLOAD };
  };
  try {
    const handler = createTestApiHandler(() => SAVED_OPTIONS);
    const res = response();
    await handler(request({}), res);
    assert.equal(res.state.status, 200);
    const payload = JSON.parse(res.state.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, "tavily");
    assert.equal(payload.sourceCount, 2);
    assert.equal(payload.sample.length, 2);
    assert.equal(payload.sample[0].url, "https://example.com/a");
    assert.equal(payload.sample[0].title, "A");
    assert.equal(payload.content, "ok");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.tavily\.com\/search$/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer tvly-test");
    assert.equal(JSON.parse(calls[0].init.body).max_results, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("显式 provider 覆盖激活后端（用该后端的密钥与端点）", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }] }),
    };
  };
  try {
    const handler = createTestApiHandler(() => SAVED_OPTIONS);
    const res = response();
    await handler(request({ body: JSON.stringify({ provider: "grok" }) }), res);
    const payload = JSON.parse(res.state.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, "grok");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.x\.ai\/v1\/responses$/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer xai-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("上游 API 错误映射为 ok:false 与错误消息", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: "invalid api key" } }),
  });
  try {
    const handler = createTestApiHandler(() => SAVED_OPTIONS);
    const res = response();
    await handler(request({}), res);
    assert.equal(res.state.status, 200);
    const payload = JSON.parse(res.state.body);
    assert.equal(payload.ok, false);
    assert.equal(payload.provider, "tavily");
    assert.match(payload.error, /invalid api key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("凭据缺失时返回带错误码的失败结果", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    const options = { ...SAVED_OPTIONS, tavilyApiKey: undefined };
    const handler = createTestApiHandler(() => options);
    const res = response();
    await handler(request({}), res);
    const payload = JSON.parse(res.state.body);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /TAVILY_API_KEY/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
