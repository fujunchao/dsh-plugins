import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  ImageApiError,
  generateImages,
  parseImagesResponse,
  validateSize,
} from "../lib/api.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("validateSize accepts auto and normalizes 宽x高", () => {
  assert.equal(validateSize("auto"), "auto");
  assert.equal(validateSize(undefined), "auto");
  assert.equal(validateSize(""), "auto");
  assert.equal(validateSize(" 1024X768 "), "1024x768");
});

test("validateSize rejects malformed / out-of-range / extreme-ratio sizes", () => {
  assert.throws(() => validateSize("big"), ImageApiError);
  assert.throws(() => validateSize("1024"), ImageApiError);
  assert.throws(() => validateSize("10x10"), ImageApiError);
  assert.throws(() => validateSize("4000x1000"), ImageApiError);
  assert.throws(() => validateSize("1024x100"), ImageApiError);
  try {
    validateSize("1024x100");
    assert.fail("unreachable");
  } catch (error) {
    assert.equal(error.code, "INVALID_INPUT");
  }
});

test("parseImagesResponse accepts b64_json and url items", () => {
  const items = parseImagesResponse({ data: [{ b64_json: "aGk=" }, { url: "https://cdn.example/x.png" }] });
  assert.deepEqual(items.map((item) => item.kind), ["base64", "url"]);
});

test("parseImagesResponse rejects empty / malformed payloads with UNSUPPORTED_RESPONSE", () => {
  for (const payload of [{}, { data: [] }, { data: [{}] }, { data: ["x"] }, null]) {
    try {
      parseImagesResponse(payload);
      assert.fail(`expected rejection for ${JSON.stringify(payload)}`);
    } catch (error) {
      assert.equal(error.code, "UNSUPPORTED_RESPONSE");
    }
  }
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("generateImages sends Authorization + minimal body and decodes b64 results", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ data: [{ b64_json: PNG_1X1.toString("base64") }], usage: { total_tokens: 100 } });
  };
  try {
    const result = await generateImages({
      baseURL: "https://gw.example/v1/",
      apiKey: "sk-test",
      model: "gpt-image-2.5",
      prompt: "a red circle",
      n: 1,
      size: "auto",
      quality: "medium",
      outputFormat: "png",
      timeoutSeconds: 10,
    });
    assert.equal(result.images.length, 1);
    assert.ok(result.images[0].equals(PNG_1X1));
    assert.equal(result.usage.total_tokens, 100);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://gw.example/v1/images/generations");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "gpt-image-2.5");
    assert.equal(body.prompt, "a red circle");
    assert.equal(body.size, undefined, "auto size is omitted");
    assert.equal(body.quality, "medium");
    assert.equal(body.output_format, undefined, "png default format is omitted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImages surfaces provider error messages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ error: { message: "model not found" } }, 404);
  try {
    await generateImages({
      baseURL: "https://gw.example/v1",
      apiKey: "sk-test",
      model: "nope",
      prompt: "x",
      n: 1,
      size: "auto",
      timeoutSeconds: 10,
    });
    assert.fail("unreachable");
  } catch (error) {
    assert.ok(error instanceof ImageApiError);
    assert.equal(error.code, "PROVIDER_ERROR");
    assert.match(error.message, /model not found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImages classifies hard timeouts as TIMEOUT", async () => {
  const originalFetch = globalThis.fetch;
  // AbortSignal.timeout() 的计时器不维持事件循环，mock 里用一个普通 setTimeout 兜底保活。
  globalThis.fetch = (url, init) =>
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 2000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  try {
    await generateImages({
      baseURL: "https://gw.example/v1",
      apiKey: "sk-test",
      model: "gpt-image-2.5",
      prompt: "x",
      n: 1,
      size: "auto",
      timeoutSeconds: 0.05,
    });
    assert.fail("unreachable");
  } catch (error) {
    assert.ok(error instanceof ImageApiError);
    assert.equal(error.code, "TIMEOUT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
