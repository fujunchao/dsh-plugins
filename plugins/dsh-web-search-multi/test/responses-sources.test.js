import assert from "node:assert/strict";
import test from "node:test";

import { MultiSearchProvider } from "../lib/index.js";

/** Minimal Response stand-in for the one fetch call searchResponses makes. */
function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

/**
 * Run searchResponses against a stubbed transport.
 * The literal api key keeps the call off the credentials seam.
 */
async function searchResponsesWith(output, maxResults) {
  const provider = new MultiSearchProvider(() => ({}));
  const original = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ output });
  try {
    return await provider.searchResponses(
      { query: "OpenWrt 24.10 发布说明", ...(maxResults === undefined ? {} : { maxResults }) },
      { openaiApiKey: "test-key", openaiBaseURL: "https://example.invalid/v1", openaiModel: "gpt-test" },
      "openai",
      undefined,
    );
  } finally {
    globalThis.fetch = original;
  }
}

/** One Responses body: a web_search_call carrying `searchUrls`, then an answer citing `citedUrls`. */
function payload(searchUrls, citedUrls = [], answer = "结论。") {
  return [
    {
      type: "web_search_call",
      action: { sources: searchUrls.map((item) => (typeof item === "string" ? { type: "url", url: item } : item)) },
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: answer,
          annotations: citedUrls.map((url) => ({ type: "url_citation", url })),
        },
      ],
    },
  ];
}

test("被回答引用的来源排在最前，搜索结果排在后面", async () => {
  const result = await searchResponsesWith(
    payload(["https://a.example/1", "https://b.example/2", "https://c.example/3"], [
      "https://c.example/3",
      "https://a.example/1",
    ]),
  );

  assert.deepEqual(
    result.sources.map((source) => source.url),
    ["https://c.example/3", "https://a.example/1", "https://b.example/2"],
  );
  assert.equal(result.content, "结论。");
  assert.equal(result.truncated, false);
});

test("引用 URL 的 utm 参数被去掉，并与裸 URL 去重后保留标题", async () => {
  const result = await searchResponsesWith(
    payload(
      [{ type: "url", url: "https://lists.openwrt.org/pipermail/openwrt-devel/043702.html", title: "OpenWrt 发布公告" }],
      ["https://lists.openwrt.org/pipermail/openwrt-devel/043702.html?utm_source=openai"],
    ),
  );

  assert.equal(result.sources.length, 1, "同一页面的两种写法必须合成一条");
  assert.equal(result.sources[0].url, "https://lists.openwrt.org/pipermail/openwrt-devel/043702.html");
  assert.equal(result.sources[0].title, "OpenWrt 发布公告", "搜索结果里的标题应补到引用条目上");
});

test("超过 maxResults 时截断，引用来源优先保留", async () => {
  const searchUrls = Array.from({ length: 15 }, (_, index) => `https://noise.example/${index}`);
  const result = await searchResponsesWith(
    payload(searchUrls, ["https://cited.example/a?utm_source=openai", "https://cited.example/b"]),
    10,
  );

  assert.equal(result.sources.length, 10);
  assert.deepEqual(
    result.sources.slice(0, 2).map((source) => source.url),
    ["https://cited.example/a", "https://cited.example/b"],
    "被引用的两条必须落在前 10 内",
  );
  assert.equal(result.truncated, true, "确实丢弃了来源时必须置 truncated");
});

test("未给 maxResults 时不截断", async () => {
  const searchUrls = Array.from({ length: 30 }, (_, index) => `https://noise.example/${index}`);
  const result = await searchResponsesWith(payload(searchUrls));

  assert.equal(result.sources.length, 30);
  assert.equal(result.truncated, false);
});

test("来源数正好等于 maxResults 时不算截断", async () => {
  const searchUrls = Array.from({ length: 10 }, (_, index) => `https://noise.example/${index}`);
  const result = await searchResponsesWith(payload(searchUrls), 10);

  assert.equal(result.sources.length, 10);
  assert.equal(result.truncated, false);
});

test("无法解析的 URL 保持原样，不因归一化抛错", async () => {
  const result = await searchResponsesWith(payload(["not a url"], ["also-not-a-url"]));

  assert.deepEqual(result.sources.map((source) => source.url), ["also-not-a-url", "not a url"]);
});
