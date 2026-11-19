/**
 * dsh-siyuan-notes — Host-half tests (`node --test`).
 *
 * Covers the pure helpers in `lib/host-utils.js` plus a few route-dispatch behaviours of
 * `lib/index.js` driven with mock `IncomingMessage` / `ServerResponse` objects. Nothing here
 * needs a Cordis context or a live SiYuan kernel.
 */

import assert from "node:assert/strict";
import { mkdtempSync, promises as fsp, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import * as host from "../lib/index.js";
// 命名空间导入（而不是命名导入）intentionally：TDD 阶段 `isServableAssetPath` 尚未实现时，
// 命名导入会以「does not provide an export named」在链接期炸掉整个文件，连既有 22 个用例一起红；
// 命名空间访问只会让图片那几条断言各自失败，失败点看得见。
import * as hostUtils from "../lib/host-utils.js";
import {
  DEFAULTS,
  LIMITS,
  ROUTES,
  backupFileName,
  clampTimeoutSeconds,
  createPlainConfigSchema,
  describeFetchError,
  isForwardableApiPath,
  isoTimestampForFile,
  mergeSettings,
  normalizeBaseUrl,
  normalizeRoutePath,
  parseSettingsJson,
  sanitizeSegment,
  toPublicState,
} from "../lib/host-utils.js";

// --- baseUrl validation -----------------------------------------------------

test("normalizeBaseUrl accepts http/https and canonicalizes", () => {
  assert.deepEqual(normalizeBaseUrl("http://127.0.0.1:6806"), { ok: true, value: "http://127.0.0.1:6806" });
  assert.deepEqual(normalizeBaseUrl("  http://127.0.0.1:6806/  "), { ok: true, value: "http://127.0.0.1:6806" });
  assert.deepEqual(normalizeBaseUrl("https://notes.example.com/siyuan/"), {
    ok: true,
    value: "https://notes.example.com/siyuan",
  });
  assert.deepEqual(normalizeBaseUrl("HTTP://127.0.0.1:6806"), { ok: true, value: "http://127.0.0.1:6806" });
});

test("normalizeBaseUrl rejects userinfo, schemes, query and junk", () => {
  for (const bad of [
    "ftp://127.0.0.1:6806",
    "http://user:secret@127.0.0.1:6806",
    "http://user@127.0.0.1:6806",
    "http://127.0.0.1:6806/?x=1",
    "http://127.0.0.1:6806/#hash",
    "",
    "   ",
    "not a url",
    "127.0.0.1:6806",
    "//127.0.0.1:6806",
  ]) {
    const result = normalizeBaseUrl(bad);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.equal(result.error.code, "invalid_base_url");
  }
  assert.equal(normalizeBaseUrl(42).ok, false);
  assert.equal(normalizeBaseUrl(null).ok, false);
});

// --- backup filenames -------------------------------------------------------

const FIXED = new Date("2026-11-03T09:11:53.123Z");

test("isoTimestampForFile is filename safe", () => {
  assert.equal(isoTimestampForFile(FIXED), "2026-11-03T09-11-53-123Z");
});

test("backupFileName is <timestamp>-<docId>.md", () => {
  assert.equal(backupFileName({ docId: "20260101120000-abcdefg", now: FIXED }), "2026-11-03T09-11-53-123Z-20260101120000-abcdefg.md");
});

test("backupFileName sanitizes hostile docIds and titles", () => {
  const name = backupFileName({ docId: "a/b\\c:d*e?f\"g<h>i|j", now: FIXED });
  assert.equal(name, "2026-11-03T09-11-53-123Z-a-b-c-d-e-f-g-h-i-j.md");
  assert.ok(!name.includes("/") && !name.includes("\\"), "must not contain a path separator");
  assert.ok(name.endsWith(".md"));

  const control = backupFileName({ docId: "x\u0000y\u001fz", now: FIXED });
  assert.equal(control, "2026-11-03T09-11-53-123Z-xyz.md");

  const traversal = backupFileName({ docId: "../../etc/passwd", now: FIXED });
  assert.ok(!traversal.includes(".."), "traversal must be neutralised");
  assert.ok(!traversal.includes("/"));
});

test("backupFileName falls back to the title, then to 'doc'", () => {
  assert.equal(backupFileName({ title: "我的笔记", now: FIXED }), "2026-11-03T09-11-53-123Z-我的笔记.md");
  assert.equal(backupFileName({ now: FIXED }), "2026-11-03T09-11-53-123Z-doc.md");
  assert.equal(backupFileName({ docId: "", title: "", now: FIXED }), "2026-11-03T09-11-53-123Z-doc.md");
});

test("sanitizeSegment handles reserved device names and length", () => {
  assert.equal(sanitizeSegment("con"), "_con");
  assert.equal(sanitizeSegment("NUL"), "_NUL");
  assert.equal(sanitizeSegment("   "), "untitled");
  assert.equal(sanitizeSegment(undefined, { fallback: "fallback" }), "fallback");
  const long = sanitizeSegment("a".repeat(200));
  assert.equal(long.length, LIMITS.maxFilenameSegment);
  assert.equal(sanitizeSegment("a".repeat(200), { maxLength: 8 }), "aaaaaaaa");
});

// --- /api path filtering ----------------------------------------------------

test("isForwardableApiPath accepts SiYuan API paths", () => {
  for (const good of [
    "/api/system/version",
    "/api/notebook/lsNotebooks",
    "/api/query/sql",
    "/api/block/getBlockKramdown",
    "/api/filetree/getDoc",
    "/api/attr/setBlockAttrs",
  ]) {
    assert.deepEqual(isForwardableApiPath(good), { ok: true, value: good });
  }
});

test("isForwardableApiPath blocks everything outside /api/", () => {
  const bad = [
    "",
    "/",
    "api/system/version",
    "/static/x.js",
    "/api",
    "/apifoo/x",
    "http://evil.example/api/system/version",
    "//evil.example/api/x",
    "/api/../etc/passwd",
    "/api/x/../../y",
    "/api/x?token=1",
    "/api/x#frag",
    "/api/x y",
    "/api/x\ty",
    "/api\\x",
    "/api//x",
    `/api/${"a".repeat(LIMITS.maxPathLength)}`,
    42,
    null,
  ];
  for (const value of bad) {
    const result = isForwardableApiPath(value);
    assert.equal(result.ok, false, `expected ${JSON.stringify(value)} to be rejected`);
    assert.equal(result.error.code, "invalid_path");
  }
});

// --- settings merge ---------------------------------------------------------

test("mergeSettings applies defaults <- Config <- store precedence", () => {
  assert.deepEqual(mergeSettings(), { ...DEFAULTS });

  const configured = mergeSettings({ config: { baseUrl: "http://10.0.0.2:6806", token: "cfg", timeoutSeconds: 45 } });
  assert.equal(configured.baseUrl, "http://10.0.0.2:6806");
  assert.equal(configured.token, "cfg");
  assert.equal(configured.timeoutSeconds, 45);

  const stored = mergeSettings({
    config: { baseUrl: "http://10.0.0.2:6806", token: "cfg" },
    stored: { baseUrl: "http://127.0.0.1:6806", token: "live", timeoutSeconds: 90 },
  });
  assert.equal(stored.baseUrl, "http://127.0.0.1:6806", "the store must win over Config");
  assert.equal(stored.token, "live");
  assert.equal(stored.timeoutSeconds, 90);
});

test("mergeSettings normalizes garbage instead of throwing", () => {
  const merged = mergeSettings({
    config: { baseUrl: "ftp://bad", token: 123, timeoutSeconds: "abc" },
    stored: { baseUrl: "also bad", extra: "dropped" },
  });
  assert.equal(merged.baseUrl, DEFAULTS.baseUrl);
  assert.equal(merged.token, "");
  assert.equal(merged.timeoutSeconds, DEFAULTS.timeoutSeconds);
  assert.ok(!("extra" in merged));

  // Timeouts clamp into 1..300; tokens are trimmed.
  assert.equal(mergeSettings({ stored: { timeoutSeconds: 0 } }).timeoutSeconds, 1);
  assert.equal(mergeSettings({ stored: { timeoutSeconds: 9999 } }).timeoutSeconds, 300);
  assert.equal(mergeSettings({ stored: { token: "  abc  " } }).token, "abc");
  assert.equal(clampTimeoutSeconds(undefined), DEFAULTS.timeoutSeconds);
  assert.equal(clampTimeoutSeconds(NaN), DEFAULTS.timeoutSeconds);
});

// --- public state -----------------------------------------------------------

test("toPublicState never leaks the token", () => {
  const state = toPublicState({ baseUrl: "http://127.0.0.1:6806", token: "demo-7f3a91", timeoutSeconds: 20 }, { version: "3.8.3" });
  assert.deepEqual(state, {
    ok: true,
    value: { baseUrl: "http://127.0.0.1:6806", hasToken: true, version: "3.8.3" },
  });
  assert.ok(!JSON.stringify(state).includes("demo-7f3a91"));

  assert.deepEqual(toPublicState({ baseUrl: "http://x", token: "", timeoutSeconds: 20 }), {
    ok: true,
    value: { baseUrl: "http://x", hasToken: false, version: null },
  });

  const failed = toPublicState({ baseUrl: "http://x", token: "t", timeoutSeconds: 20 }, { version: null, error: "连接超时" });
  assert.equal(failed.value.error, "连接超时");
  assert.equal(failed.value.version, null);
});

// --- fetch error messages ---------------------------------------------------

test("describeFetchError explains socket failures in Chinese", () => {
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }),
  });
  assert.match(describeFetchError(refused), /ECONNREFUSED/);

  const aggregated = Object.assign(new TypeError("fetch failed"), {
    cause: { errors: [{ code: "ENOTFOUND" }] },
  });
  assert.match(describeFetchError(aggregated), /ENOTFOUND/);

  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  assert.match(describeFetchError(timeout), /超时/);

  assert.equal(describeFetchError("plain string"), "plain string");
});

// --- route path + settings JSON --------------------------------------------

test("normalizeRoutePath tolerates prefix stripping and trailing slashes", () => {
  assert.equal(normalizeRoutePath("/siyuan/state"), ROUTES.state);
  assert.equal(normalizeRoutePath("/state"), ROUTES.state);
  assert.equal(normalizeRoutePath("/siyuan/api/"), ROUTES.api);
  assert.equal(normalizeRoutePath("/siyuan/backup?x=1"), ROUTES.backup);
  assert.equal(normalizeRoutePath("/siyuan"), "/siyuan");
  assert.equal(normalizeRoutePath(""), "/siyuan");
});

test("parseSettingsJson is defensive", () => {
  assert.deepEqual(parseSettingsJson('{"baseUrl":"http://a:6806"}'), { baseUrl: "http://a:6806" });
  assert.deepEqual(parseSettingsJson("{not json"), {});
  assert.deepEqual(parseSettingsJson("[1,2]"), {});
  assert.deepEqual(parseSettingsJson(""), {});
  assert.deepEqual(parseSettingsJson(undefined), {});
});

// --- Config schema ----------------------------------------------------------

test("plain Config schema validates through Standard Schema", () => {
  const Config = createPlainConfigSchema();
  const empty = Config["~standard"].validate({});
  assert.equal(empty.value.baseUrl, DEFAULTS.baseUrl);
  assert.equal(empty.value.token, "");
  assert.equal(empty.value.timeoutSeconds, DEFAULTS.timeoutSeconds);

  const good = Config["~standard"].validate({ baseUrl: "http://127.0.0.1:6806/", token: " demo-7f3a91 ", timeoutSeconds: 30 });
  assert.equal(good.value.baseUrl, "http://127.0.0.1:6806");
  assert.equal(good.value.token, "demo-7f3a91");
  assert.equal(good.value.timeoutSeconds, 30);

  const bad = Config["~standard"].validate({ baseUrl: "ftp://x" });
  assert.ok(Array.isArray(bad.issues));
  assert.equal(bad.issues[0].path[0], "baseUrl");

  const schema = Config.toJSON();
  assert.equal(schema.type, "object");
  assert.deepEqual(Object.keys(schema.properties).sort(), ["baseUrl", "timeoutSeconds", "token"]);
  assert.equal(schema.properties.token["x-dsh-volatile"], true);
});

test("the plugin module exports the Cordis contract", async () => {
  const module = await import("../lib/index.js");
  assert.equal(module.name, "siyuan-notes");
  assert.deepEqual(module.inject, ["webServer"]);
  assert.equal(typeof module.apply, "function");
  assert.equal(typeof module.Config["~standard"].validate, "function");
});

// --- route dispatch with mock req/res --------------------------------------

/** @param {unknown} body @param {{ method?: string, url?: string }} [init] */
function mockRequest(body, init = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const stream = Readable.from(text === "" ? [] : [Buffer.from(text, "utf8")]);
  stream.method = init.method ?? "POST";
  stream.url = init.url ?? "/siyuan/state";
  return stream;
}

function mockResponse() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

/** Run one request through the Host router. */
async function callRoute(routes, body, init) {
  const res = mockResponse();
  await routes.handler(mockRequest(body, init), res);
  return res;
}

test("unknown /siyuan paths answer JSON 404", async () => {
  const routes = host.createSiYuanRoutes({ config: {} });
  const res = await callRoute(routes, undefined, { method: "GET", url: "/siyuan/nope" });
  assert.equal(res.status, 404);
  assert.match(res.headers["Content-Type"], /application\/json/);
  assert.equal(res.json().ok, false);
  assert.equal(res.json().error.code, "not_found");
});

test("wrong methods answer JSON 405 with Allow", async () => {
  const routes = host.createSiYuanRoutes({ config: {} });
  const res = await callRoute(routes, {}, { method: "POST", url: "/siyuan/state" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, "GET, HEAD");
  assert.equal(res.json().error.code, "method_not_allowed");
});

test("/siyuan/api rejects a non-/api path without dialling out", async () => {
  const routes = host.createSiYuanRoutes({ config: {} });
  const res = await callRoute(routes, { path: "http://evil/api/system/version", payload: {} }, { url: "/siyuan/api" });
  assert.equal(res.status, 400);
  assert.equal(res.json().error.code, "invalid_path");
});

test("/siyuan/backup writes the snapshot under DSH_SIYUAN_NOTES_HOME", async () => {
  const home = await fsp.mkdtemp(path.join(tmpdir(), "siyuan-notes-test-"));
  const previous = process.env.DSH_SIYUAN_NOTES_HOME;
  process.env.DSH_SIYUAN_NOTES_HOME = home;
  try {
    const routes = host.createSiYuanRoutes({ config: {} });
    const res = await callRoute(
      routes,
      { docId: "20260101120000-abcdefg", title: "标题", kramdown: "# 你好\n\n正文" },
      { url: "/siyuan/backup" },
    );
    assert.equal(res.status, 200);
    const payload = res.json();
    assert.equal(payload.ok, true);
    assert.match(payload.value.file, /siyuan-backups[\\/].+-20260101120000-abcdefg\.md$/);
    const written = await fsp.readFile(payload.value.file, "utf8");
    assert.equal(written, "# 你好\n\n正文");
    await assert.rejects(fsp.access(path.join(home, "siyuan-notes.json")), "backup must not touch the settings file");
  } finally {
    if (previous === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
    else process.env.DSH_SIYUAN_NOTES_HOME = previous;
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test("/siyuan/config validates baseUrl before persisting", async () => {
  const home = await fsp.mkdtemp(path.join(tmpdir(), "siyuan-notes-config-"));
  const previous = process.env.DSH_SIYUAN_NOTES_HOME;
  process.env.DSH_SIYUAN_NOTES_HOME = home;
  try {
    const routes = host.createSiYuanRoutes({ config: {} });
    const rejected = await callRoute(routes, { baseUrl: "http://user:pw@127.0.0.1:6806" }, { url: "/siyuan/config" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json().error.code, "invalid_base_url");
    await assert.rejects(fsp.access(path.join(home, "siyuan-notes.json")), "nothing persisted on invalid input");
  } finally {
    if (previous === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
    else process.env.DSH_SIYUAN_NOTES_HOME = previous;
    await fsp.rm(home, { recursive: true, force: true });
  }
});

// --- 记忆体的工具结果渲染（用户在对话里看到的那几行）-------------------------

test("firstLine 取第一行并截断", () => {
  assert.equal(host.firstLine("\n\n第一行\n第二行"), "第一行");
  assert.equal(host.firstLine("x".repeat(200)).length, 91);
  assert.equal(host.firstLine(null), "");
});

test("writeRender 给出可读的写入痕迹而不是 JSON", () => {
  const out = host.writeRender(
    { type: "decision", project: "dsh-siyuan-notes", text: "结论行\n- 理由：因为" },
    { ok: true, id: "20261106120000-abcdefg", superseded: [] },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "text");
  assert.ok(out[0].text.startsWith("已记住（决策 · dsh-siyuan-notes）：结论行"));
  assert.ok(out[0].text.includes("20261106120000-abcdefg"));
  assert.ok(!out[0].text.includes("{"), "不该把原始 JSON 直接倒给用户");
});

test("writeRender 在取代了旧条目时说明", () => {
  const out = host.writeRender(
    { type: "fact", project: "*", text: "新结论" },
    { ok: true, id: "x", superseded: ["a", "b"] },
  );
  assert.ok(out[0].text.includes("已把 2 条旧记忆标记为「已被取代」"));
});

test("writeRender 失败时只说失败原因", () => {
  const out = host.writeRender({ type: "fact" }, { ok: false, error: { code: "c", message: "思源连不上" } });
  assert.equal(out[0].text, "记忆写入失败：思源连不上");
});

test("searchRender 空结果不推断从未记录", () => {
  const out = host.searchRender({ query: "不存在的东西" }, { ok: true, results: [] });
  assert.ok(out[0].text.includes("未找到"));
  assert.ok(out[0].text.includes("不能据此认定"));
});

test("searchRender 列出命中项，并标注刚写入的", () => {
  const out = host.searchRender(
    { query: "压缩" },
    {
      ok: true,
      results: [
        { id: "1", statement: "结论一", type: "decision", project: "p", fresh: false },
        { id: "2", statement: "结论二", type: "fact", project: "q", fresh: true },
      ],
    },
  );
  assert.ok(out[0].text.includes("命中 2 条"));
  // v6：行首是条目 id（search → read 链路的入口），状态与主题跟在项目后面。
  assert.ok(out[0].text.includes("- 1 [decision · p] 结论一"));
  assert.ok(out[0].text.includes("（刚写入）"));
});

test("searchRender 在浏览模式下提示可以给 query", () => {
  const out = host.searchRender({ type: "fact" }, { ok: true, results: [{ id: "1", statement: "a", type: "fact", project: "p" }] });
  assert.ok(out[0].text.includes("浏览"));
});

test("readRender 展示全文，空结果时说明", () => {  const empty = host.readRender({}, { entries: [] });
  assert.ok(empty[0].text.includes("本次没有读取到"));
  const one = host.readRender({}, { entries: [{ id: "1", type: "fact", project: "p", status: "active", confidence: "verified", body: "结论\n- 理由：x" }] });
  assert.ok(one[0].text.includes("[fact · p · active · verified] 1"));
  assert.ok(one[0].text.includes("理由：x"));
});

// --- 上下文压力提醒（走 runtime context，不进冻结的 section）-------------------

test("pressureHintText 在阈值以下不打扰", () => {
  assert.equal(host.pressureHintText({ ratio: 0, wroteThisTurn: false }), "");
  assert.equal(host.pressureHintText({ ratio: 0.59, wroteThisTurn: false }), "");
  assert.equal(host.pressureHintText({ ratio: Number.NaN, wroteThisTurn: false }), "");
  assert.equal(host.pressureHintText(null), "");
});

test("pressureHintText 到阈值时提醒先记再继续", () => {
  const text = host.pressureHintText({ ratio: 0.62, wroteThisTurn: false });
  assert.ok(text.includes("62%"));
  assert.ok(text.includes("memory_write"));
  assert.ok(text.includes("压缩"));
});

test("pressureHintText 本轮已记过就改成「继续」", () => {
  const text = host.pressureHintText({ ratio: 0.75, wroteThisTurn: true });
  assert.ok(text.includes("75%"));
  assert.ok(text.includes("已经把结论写进记忆体"));
  assert.ok(!text.includes("现在就先用 memory_write"));
});

test("PRESSURE_HINT_RATIO 早于自动压缩阈值 0.8", () => {
  // dsh-compaction-basic 的默认 thresholdRatio 是 .8；提醒必须早于它。
  assert.ok(host.PRESSURE_HINT_RATIO < 0.8);
});

test("checkupRender 在干净时说没发现问题", () => {
  const out = host.checkupRender({}, { total: 34, active: 32, duplicates: [], similar: [], staleStates: [], brokenChains: [], archiveCandidates: [] });
  assert.ok(out[0].text.includes("已检查 34 条"));
  assert.ok(out[0].text.includes("没有发现问题"));
});

test("checkupRender 分类列出问题", () => {
  const out = host.checkupRender(
    {},
    {
      total: 5,
      active: 3,
      duplicates: [{ statement: "重复的", ids: ["a", "b"] }],
      similar: [{ score: 0.85, leftText: "甲", rightText: "乙" }],
      staleStates: [{ statement: "旧状态", ageDays: 40 }],
      brokenChains: [{ statement: "断链", reason: "缺少被谁取代" }],
      archiveCandidates: [{ statement: "旧条目", reason: "90 天未读" }],
    },
  );
  const text = out[0].text;
  assert.ok(text.includes("重复条目（1）"));
  assert.ok(text.includes("疑似相似"));
  assert.ok(text.includes("过期状态（1）"));
  assert.ok(text.includes("断掉的取代链（1）"));
  assert.ok(text.includes("可归档的旧条目（1）"));
  assert.ok(!text.includes("没有发现问题"));
});

test("checkupRender 失败时说原因", () => {
  const out = host.checkupRender({}, { ok: false, error: { code: "x", message: "思源连不上" } });
  assert.equal(out[0].text, "记忆体检失败：思源连不上");
});

test("distillRender 空结果时说没找到新东西", () => {
  const out = host.distillRender({}, { ok: true, written: 0, entries: [] });
  assert.ok(out[0].text.includes("没有找到值得长期记住的新东西"));
});

test("distillRender 列出写入的条目", () => {
  // 契约 §8：写入即生效，不再有「AI已确认 / 暂存待补依据」这类二次确认文案。
  // confirmed / deferred 是旧字段，渲染一律不再读取它们。
  const out = host.distillRender({}, { ok: true, written: 2, confirmed: 1, deferred: 1, entries: [
    { type: "decision", project: "p", statement: "结论一" },
    { type: "fact", project: "*", statement: "结论二" },
  ] });
  assert.ok(out[0].text.startsWith("整理出 2 条（新写入 2 条，已直接生效"), out[0].text);
  // 被丢弃的条目和没处理到的内容必须说出来。
  const partial = host.distillRender({}, { ok: true, written: 1, entries: [{ type: "fact", project: "p", statement: "结论" }], dropped: [{ statement: "太长的一条", message: "正文最多 400 个字符，请先精简" }], remainingChunks: 2 });
  assert.ok(partial[0].text.includes("另有 1 条不合格未写入") && partial[0].text.includes("太长的一条"), partial[0].text);
  assert.ok(partial[0].text.includes("还有 2 段较早的内容没处理到"), partial[0].text);
  assert.ok(!out[0].text.includes("AI已确认"));
  assert.ok(!out[0].text.includes("暂存"));
  assert.ok(!out[0].text.includes("无需人工逐条审批"));
  assert.ok(out[0].text.includes("[decision · p]"));
  assert.ok(out[0].text.includes("结论一"));
  assert.ok(out[0].text.includes("[fact · *]"));
  assert.ok(out[0].text.includes("结论二"));
  // 总条数与「新写入」条数是两个独立的数：已有条目重复命中时二者不同。
  const repeated = host.distillRender({}, { ok: true, written: 1, entries: [
    { type: "fact", project: "p", statement: "已有条目" },
    { type: "fact", project: "p", statement: "新条目" },
  ] });
  assert.ok(repeated[0].text.startsWith("整理出 2 条（新写入 1 条，"), repeated[0].text);
});

test("distillRender 失败时说明原因", () => {
  const out = host.distillRender({}, { ok: false, reason: "no_route" });
  assert.ok(out[0].text.includes("记忆整理未完成：no_route"));
});

test("knownProjects 从真实目录读候选，总是包含 *", async () => {
  const names = await host.knownProjects(fileURLToPath(new URL("..", import.meta.url)));
  assert.ok(names.includes("*"), "跨项目通用值必须在");
  assert.ok(names.includes("dsh-siyuan-notes"), "项目自身必须进入候选");
  assert.ok(!names.includes("lib"), "源码目录不能作为项目");
  assert.ok(!names.includes("node_modules"), "node_modules 不该进候选");
  assert.ok(!names.some((name) => name.startsWith(".")), "隐藏目录不该进候选");
});

test("knownProjects 在目录读不到时只给 *", async () => {
  const names = await host.knownProjects("D:/definitely-not-a-real-dir-xyz");
  assert.deepEqual(names, ["*"]);
});

test("knownProjects 不接受记忆库里的 project 作为来源（防循环污染）", async () => {
  // 早期版本从条目里提取候选，结果模型编的假项目名进库后被当成合法候选喂回去，
  // 实测长出了 6 条 project=dsh-siyuan-memory。签名改成 cwd 就是为了断掉这条链。
  const names = await host.knownProjects("D:/definitely-not-a-real-dir-xyz");
  assert.ok(!names.includes("dsh-siyuan-memory"));
});

test("distillRender 显示正文而不只是结论行", () => {
  // state 类条目带「下一步 / 待决」两行，只显示第一行会让人以为只产出了一句话。
  const out = host.distillRender({}, { ok: true, written: 1, entries: [
    { type: "state", project: "p", statement: "做到哪了", body: "做到哪了\n- 下一步：做 X\n- 待决：无" },
  ] });
  assert.ok(out[0].text.includes("做到哪了"));
  assert.ok(out[0].text.includes("- 下一步：做 X"));
  assert.ok(out[0].text.includes("- 待决：无"));
});

test("distillRender 在缺 body 时退回结论行", () => {
  const out = host.distillRender({}, { ok: true, written: 1, entries: [
    { type: "fact", project: "p", statement: "只有结论" },
  ] });
  assert.ok(out[0].text.includes("只有结论"));
});

// --- 蒸馏时 state 自动取代旧的 ---

test("collectActiveStates 按 project 收集有效 state", () => {
  const map = host.collectActiveStates([
    { id: "a", type: "state", project: "p", status: "active" },
    { id: "b", type: "state", project: "p", status: "active" },
    { id: "c", type: "state", project: "p", status: "superseded" },
    { id: "d", type: "fact", project: "p", status: "active" },
    { id: "e", type: "state", project: "*", status: "active" },
    { type: "state", project: "q", status: "active" },
  ]);
  assert.deepEqual(map.get("p"), ["a", "b"]);
  assert.deepEqual(map.get("*"), ["e"]);
  assert.equal(map.get("q"), undefined, "没有 id 的条目不能当取代目标");
});

test("collectActiveStates 对空输入返回空 Map", () => {
  assert.equal(host.collectActiveStates(undefined).size, 0);
  assert.equal(host.collectActiveStates([]).size, 0);
});

// --- 图片（第十八轮）：资源路径白名单、multipart 上传转发、只读图片代理 --------
//
// 契约来源：notes/siyuan-image-design.md §4.1/§4.2 与 task-1 的冻结接口。
// 这里全部靠 mock `globalThis.fetch` + mock req/res，不需要运行中的 DSH，也不需要内核。

const IMAGE_SETTINGS = { baseUrl: "http://127.0.0.1:6806", token: "demo-7f3a91", timeoutSeconds: 20 };

/** 隔离设置文件用的空目录（见 callImageRoute 的说明）。 */
const IMAGE_HOME = mkdtempSync(path.join(tmpdir(), "siyuan-notes-image-"));
after(() => {
  rmSync(IMAGE_HOME, { recursive: true, force: true });
});

/** 造一个 IncomingMessage 替身：能带原始二进制 body 与任意请求头。 */
function rawRequest({ body, method = "POST", url = ROUTES.assetUpload, headers = {} } = {}) {
  const buffer = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const stream = Readable.from(buffer.length === 0 ? [] : [buffer]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

/** 接得住 JSON 与二进制两种回包的 ServerResponse 替身。 */
function binResponse() {
  return {
    status: undefined,
    headers: undefined,
    chunks: [],
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? {};
      return this;
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return true;
    },
    end(payload) {
      if (payload !== undefined && payload !== null) {
        this.chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
      }
      this.ended = true;
      return this;
    },
    bytes() {
      return Buffer.concat(this.chunks);
    },
    text() {
      return this.bytes().toString("utf8");
    },
    json() {
      try {
        return JSON.parse(this.text());
      } catch {
        return undefined;
      }
    },
  };
}

/** 大小写不敏感地取响应头。 */
function headerOf(headers, name) {
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** 从 fetch 的 init 里大小写不敏感地取请求头（对象或 Headers 都吃）。 */
function initHeader(init, name) {
  const headers = init?.headers ?? {};
  if (typeof headers.get === "function") return headers.get(name);
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** 安装 fetch 替身并记录调用；务必在 finally 里 restore()。 */
function withFetch(impl) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init: init ?? {} });
    return impl(String(url), init ?? {}, calls.length);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** 上游响应替身：headers.get 大小写不敏感，text/arrayBuffer/body 三件套都在。 */
function upstreamResponse({ status = 200, headers = {}, body = Buffer.alloc(0) } = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "",
    headers: {
      get: (name) => (map.has(String(name).toLowerCase()) ? map.get(String(name).toLowerCase()) : null),
      has: (name) => map.has(String(name).toLowerCase()),
      forEach: (callback) => map.forEach((value, key) => callback(value, key)),
    },
    async text() {
      return buffer.toString("utf8");
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    // 与真 fetch 同形：body 是 Web ReadableStream，便于实现方走 Readable.fromWeb。
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    }),
  };
}

/** 走一次真实路由。
 *
 * 必须隔离 `DSH_SIYUAN_NOTES_HOME`：`mergeSettings` 的优先级是「持久化文件 > Cordis Config > 默认」，
 * 不隔离就会读到跑测试这台机器上真实存在的 `siyuan-notes.json`（baseUrl=127.0.0.1），
 * 断言里期望的 URL 与实际打出去的 URL 就不是一回事了。
 */
async function callImageRoute(body, init) {
  const previous = process.env.DSH_SIYUAN_NOTES_HOME;
  process.env.DSH_SIYUAN_NOTES_HOME = IMAGE_HOME;
  try {
    const routes = host.createSiYuanRoutes({ config: IMAGE_SETTINGS });
    const res = binResponse();
    await routes.handler(rawRequest({ ...init, body }), res);
    return res;
  } finally {
    if (previous === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
    else process.env.DSH_SIYUAN_NOTES_HOME = previous;
  }
}

/** 拼一段真实的 multipart body（含二进制字节，验证不是字符串转手的）。 */
function multipartBody(boundary) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="assetsDirPath"\r\n\r\n/assets/\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file[]"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test("图片路由与上传上限进了冻结的路由表 / LIMITS", () => {
  assert.equal(ROUTES.assetUpload, "/siyuan/asset/upload");
  assert.equal(ROUTES.asset, "/siyuan/asset");
  assert.equal(LIMITS.maxUploadBytes, 32 * 1024 * 1024);
});

test("isServableAssetPath 放行根资源目录下的图片路径", () => {
  const isServableAssetPath = hostUtils.isServableAssetPath;
  assert.equal(typeof isServableAssetPath, "function", "host-utils 必须导出 isServableAssetPath");
  for (const good of [
    "assets/a.png",
    "assets/20260101120000-abcdefg.png",
    "assets/clip_image002-20251224131619-agnb275.jpg",
    "assets/a-b_c.1.svg",
    "assets/sub/a.png",
    // 非 ASCII 不是可选项：真机实测（scripts 只读探针，2026-11-08）50 个唯一资源路径里
    // 有 7 个是中文名，例如 assets/64位-20251122094427-xow5mtq.png。
    // 按 ASCII 白名单实现，这 7 张图一张都显示不出来。
    "assets/中文名.png",
    "assets/64位-20251122094427-xow5mtq.png",
    "assets/中文 名.png",
    // 从桌面拖进来的文件名常带空格；空格在 URL 里逐段编码，不构成穿越风险。
    "assets/a b.png",
  ]) {
    const result = isServableAssetPath(good);
    assert.equal(result.ok, true, `期望放行 ${JSON.stringify(good)}，实际 ${JSON.stringify(result)}`);
    assert.equal(result.value, good);
  }
});

test("isServableAssetPath 拒绝穿越、协议、查询串、控制字符与超长", () => {
  const isServableAssetPath = hostUtils.isServableAssetPath;
  assert.equal(typeof isServableAssetPath, "function", "host-utils 必须导出 isServableAssetPath");
  const bad = [
    // 目录穿越（含百分号编码的变体：WHATWG URL 会把 %2e 当点做路径归一，必须挡在门前）
    "assets/../x.png",
    "assets/./x.png",
    "assets/%2e%2e/x.png",
    "assets/%252e%252e/x.png", // 双层编码：解一次之后还剩 %2e，内核可能再解一次
    "assets/a/../../b.png",
    "../../etc/passwd",
    "assets\\..\\x.png",
    // 协议 / 绝对路径 / 协议相对
    "http://evil.example/assets/x.png",
    "https://evil.example/x.png",
    "//evil.example/assets/x.png",
    "/assets/a.png",
    "file:///C:/x.png",
    // 查询串与片段与冒号
    "assets/a.png?b=1",
    "assets/a.png#frag",
    "assets/a:b.png",
    "assets/a.png?token=demo-7f3a91",
    // 控制字符（空白字符里的空格是允许的，见上一条；制表/换行/空字节一定是畸形请求）
    "assets/a\tb.png",
    "assets/a\u0000b.png",
    "assets/a\n.png",
    // 前缀本身不合法
    "",
    "assets",
    "assets/",
    "assets//a.png",
    "Assets/a.png",
    // 畸形百分号编码
    "assets/a%b.png",
    // 超长
    `assets/${"a".repeat(LIMITS.maxPathLength)}`,
    // 非字符串
    42,
    null,
    undefined,
  ];
  for (const value of bad) {
    const result = isServableAssetPath(value);
    assert.equal(result.ok, false, `期望拒绝 ${JSON.stringify(value)}，实际 ${JSON.stringify(result)}`);
    assert.equal(typeof result.error?.code, "string", "拒绝时必须给出机器可读的 error.code");
    assert.ok(result.error.code.length > 0);
  }
});

test("isServableAssetPath 的长度上限是 2048（含）", () => {
  const isServableAssetPath = hostUtils.isServableAssetPath;
  const exact = `assets/${"a".repeat(LIMITS.maxPathLength - "assets/".length)}`;
  assert.equal(exact.length, LIMITS.maxPathLength);
  assert.equal(isServableAssetPath(exact).ok, true, "正好 2048 必须放行");
  assert.equal(isServableAssetPath(`${exact}a`).ok, false, "2049 必须拒绝");
});

test("两个白名单函数在结构禁令上口径一致", () => {
  // 两个函数的字符集**故意不同**（资源路径要放行中文名，API 路径不需要），
  // 但结构性的禁令必须一致，否则会漂移出一条谁都想不到的缝。
  const isServableAssetPath = hostUtils.isServableAssetPath;
  const pairs = [
    ["反斜杠", "/api/a\\b", "assets/a\\b.png"],
    ["连续斜杠", "/api//x", "assets//a.png"],
    ["点片段", "/api/../x", "assets/../x.png"],
    ["空字节", "/api/a\u0000b", "assets/a\u0000b.png"],
    ["制表符", "/api/a\tb", "assets/a\tb.png"],
    ["片段标记", "/api/x#f", "assets/a.png#f"],
    ["绝对 URL", "http://evil/api/x", "http://evil/assets/x.png"],
  ];
  for (const [label, apiPath, assetPath] of pairs) {
    assert.equal(isForwardableApiPath(apiPath).ok, false, `isForwardableApiPath 应拒绝${label}`);
    assert.equal(isServableAssetPath(assetPath).ok, false, `isServableAssetPath 应拒绝${label}`);
  }
});

test("/siyuan/asset/upload 原样转发 multipart 到内核", async () => {
  const boundary = "----dshImageBoundary1234";
  const contentType = `multipart/form-data; boundary=${boundary}`;
  const body = multipartBody(boundary);
  const envelope = { code: 0, msg: "", data: { succMap: { "a.png": "assets/a-20261108210000-abc123.png" }, succFiles: [{ path: "assets/a-20261108210000-abc123.png" }] } };
  const stub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope) }));
  try {
    const res = await callImageRoute(body, { url: ROUTES.assetUpload, headers: { "content-type": contentType } });
    assert.equal(res.status, 200, res.text());
    const payload = res.json();
    assert.equal(payload.ok, true, res.text());
    assert.equal(payload.value.code, 0);
    assert.equal(payload.value.data.succMap["a.png"], "assets/a-20261108210000-abc123.png");

    assert.equal(stub.calls.length, 1, "只该打一次内核");
    assert.equal(stub.calls[0].url, "http://127.0.0.1:6806/api/asset/upload");
    assert.equal(String(stub.calls[0].init.method ?? "POST").toUpperCase(), "POST");
    assert.equal(initHeader(stub.calls[0].init, "Authorization"), "Token demo-7f3a91");
    assert.equal(initHeader(stub.calls[0].init, "Content-Type"), contentType, "boundary 必须原样透传");
    assert.equal(Buffer.compare(Buffer.from(stub.calls[0].init.body), body), 0, "字节必须一致（不能过一遍字符串）");
  } finally {
    stub.restore();
  }
});

test("/siyuan/asset/upload 拒绝非 multipart（且不打扰内核）", async () => {
  const stub = withFetch(async () => {
    throw new Error("不该打内核");
  });
  try {
    const cases = [
      { name: "application/json", headers: { "content-type": "application/json" } },
      { name: "text/plain", headers: { "content-type": "text/plain" } },
      { name: "无 boundary 的 multipart", headers: { "content-type": "multipart/form-data" } },
      { name: "缺 Content-Type", headers: {} },
    ];
    for (const item of cases) {
      const res = await callImageRoute("{}", { url: ROUTES.assetUpload, headers: item.headers });
      assert.equal(res.status, 400, `${item.name} 应 400，实际 ${res.status} ${res.text()}`);
      assert.equal(res.json().ok, false);
      assert.equal(res.json().error.code, "invalid_content_type", item.name);
    }
    assert.equal(stub.calls.length, 0, "非法 Content-Type 不该转发到内核");
  } finally {
    stub.restore();
  }
});

test("/siyuan/asset/upload 超过 32MB 上限返回 413 body_too_large", async () => {
  const limit = Number(LIMITS.maxUploadBytes);
  assert.ok(Number.isFinite(limit) && limit > 0, "LIMITS.maxUploadBytes 必须是数字");
  const stub = withFetch(async () => {
    throw new Error("不该打内核");
  });
  try {
    const oversized = Buffer.alloc(limit + 1, 0x41);
    const res = await callImageRoute(oversized, {
      url: ROUTES.assetUpload,
      headers: { "content-type": "multipart/form-data; boundary=----x" },
    });
    assert.equal(res.status, 413, res.text());
    assert.equal(res.json().error.code, "body_too_large");
    assert.equal(stub.calls.length, 0, "超限请求不该转发到内核");
  } finally {
    stub.restore();
  }
});

test("/siyuan/asset/upload 上游不可达与非 JSON 都是 200 + ok:false", async () => {
  const contentType = "multipart/form-data; boundary=----x";
  const body = multipartBody("----x");

  const broken = withFetch(async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  });
  try {
    const res = await callImageRoute(body, { url: ROUTES.assetUpload, headers: { "content-type": contentType } });
    assert.equal(res.status, 200, "仓库约定：永不返回 HTML 错误页，失败也走 JSON 信封");
    assert.equal(res.json().ok, false);
    assert.equal(res.json().error.code, "upstream_unreachable");
  } finally {
    broken.restore();
  }

  const html = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "text/html" }, body: "<!doctype html><title>思源</title>" }));
  try {
    const res = await callImageRoute(body, { url: ROUTES.assetUpload, headers: { "content-type": contentType } });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, false);
    assert.equal(res.json().error.code, "bad_upstream_response");
    assert.ok(!res.text().includes("<!doctype"), "内核的 HTML 绝不能原样回给浏览器");
  } finally {
    html.restore();
  }
});

test("/siyuan/asset/upload 只认 POST", async () => {
  const stub = withFetch(async () => {
    throw new Error("不该打内核");
  });
  try {
    const res = await callImageRoute(undefined, { method: "GET", url: ROUTES.assetUpload, headers: {} });
    assert.equal(res.status, 405, res.text());
    assert.equal(res.json().error.code, "method_not_allowed");
    assert.match(String(headerOf(res.headers, "Allow") ?? ""), /POST/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("GET /siyuan/asset 带 token 取图并回传二进制与缓存头", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]);
  const stub = withFetch(async () =>
    upstreamResponse({
      status: 200,
      headers: { "Content-Type": "image/png", ETag: '"etag-abc"', "Last-Modified": "Sat, 08 Nov 2026 12:00:00 GMT", "Set-Cookie": "session=secret" },
      body: png,
    }),
  );
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: { host: "127.0.0.1:57907" },
    });
    assert.equal(res.status, 200, res.text());
    assert.match(String(headerOf(res.headers, "Content-Type")), /^image\/png/, "Content-Type 必须是 image/*");
    assert.equal(Number(headerOf(res.headers, "Content-Length")), png.length);
    assert.equal(headerOf(res.headers, "ETag"), '"etag-abc"');
    assert.match(String(headerOf(res.headers, "Cache-Control") ?? ""), /private/);
    assert.match(String(headerOf(res.headers, "Cache-Control") ?? ""), /max-age=86400/);
    assert.equal(Buffer.compare(res.bytes(), png), 0, "字节必须与源文件完全一致");
    assert.equal(headerOf(res.headers, "Set-Cookie"), undefined, "不得转发上游 Set-Cookie");
    assert.ok(!res.text().includes("demo-7f3a91"), "响应体不得出现 token 明文");
    assert.ok(!JSON.stringify(res.headers).includes("demo-7f3a91"), "响应头不得出现 token 明文");

    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "http://127.0.0.1:6806/assets/a.png");
    assert.equal(initHeader(stub.calls[0].init, "Authorization"), "Token demo-7f3a91");
  } finally {
    stub.restore();
  }
});

test("GET /siyuan/asset 的 If-None-Match 命中回 304", async () => {
  const stub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "image/png", ETag: '"etag-abc"' }, body: Buffer.from("PNGBYTES") }));
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: { "if-none-match": '"etag-abc"' },
    });
    assert.equal(res.status, 304, res.text());
    assert.equal(res.bytes().length, 0, "304 不能带 body");
  } finally {
    stub.restore();
  }
});

test("GET /siyuan/asset 绝不把内核的 HTML 首页当图片回", async () => {
  const homepage = "<!doctype html><html><head><title>思源笔记</title></head><body>SPA</body></html>";
  const stub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: homepage }));
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/missing.png")}`,
      headers: {},
    });
    assert.equal(res.status, 404, res.text());
    assert.equal(res.json().error.code, "asset_not_found");
    assert.ok(!res.text().includes("<!doctype"), "不能把内核首页转给浏览器");
  } finally {
    stub.restore();
  }
});

test("GET /siyuan/asset 的上游异常分类：401/403 -> asset_forbidden，其它 -> asset_not_found", async () => {
  const cases = [
    { status: 401, code: "asset_forbidden" },
    { status: 403, code: "asset_forbidden" },
    { status: 404, code: "asset_not_found" },
    { status: 500, code: "asset_not_found" },
  ];
  for (const item of cases) {
    const stub = withFetch(async () => upstreamResponse({ status: item.status, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: -1, msg: "Auth failed" }) }));
    try {
      const res = await callImageRoute(undefined, {
        method: "GET",
        url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
        headers: {},
      });
      assert.equal(res.status, 404, `上游 ${item.status} 应回 404，实际 ${res.status} ${res.text()}`);
      assert.equal(res.json().error.code, item.code, `上游 ${item.status}`);
    } finally {
      stub.restore();
    }
  }
});

test("GET /siyuan/asset 在内核不可达时回 200 + upstream_unreachable", async () => {
  const stub = withFetch(async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  });
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: {},
    });
    assert.equal(res.status, 200, res.text());
    assert.equal(res.json().ok, false);
    assert.equal(res.json().error.code, "upstream_unreachable");
    assert.ok(!res.text().includes("demo-7f3a91"));
  } finally {
    stub.restore();
  }
});

test("GET /siyuan/asset 的非法 path 一律 400 且不打扰内核", async () => {
  const stub = withFetch(async () => {
    throw new Error("非法 path 不该转发到内核");
  });
  try {
    const urls = [
      `${ROUTES.asset}`, // 缺 path
      `${ROUTES.asset}?path=`,
      `${ROUTES.asset}?path=${encodeURIComponent("assets/../x.png")}`,
      `${ROUTES.asset}?path=${encodeURIComponent("/assets/a.png")}`,
      `${ROUTES.asset}?path=${encodeURIComponent("http://evil.example/x.png")}`,
      `${ROUTES.asset}?path=assets%2F..%2Fx.png`,
      `${ROUTES.asset}?path=%E0%A4%A`, // 畸形百分号编码：必须是 400，不能 500
      `${ROUTES.asset}?path=assets%2Fa%FF.png`, // 非法 UTF-8 字节
    ];
    for (const url of urls) {
      const res = await callImageRoute(undefined, { method: "GET", url, headers: {} });
      assert.equal(res.status, 400, `${url} 应 400，实际 ${res.status} ${res.text()}`);
      assert.equal(res.json().ok, false);
      assert.equal(res.json().error.code, "invalid_asset_path");
    }
    assert.equal(stub.calls.length, 0, "非法 path 不该转发到内核");
  } finally {
    stub.restore();
  }
});

test("GET /siyuan/asset 只认 GET / HEAD", async () => {
  const stub = withFetch(async () => {
    throw new Error("不该打内核");
  });
  try {
    const res = await callImageRoute("{}", { method: "POST", url: ROUTES.asset, headers: {} });
    assert.equal(res.status, 405, res.text());
    assert.equal(res.json().error.code, "method_not_allowed");
    assert.match(String(headerOf(res.headers, "Allow") ?? ""), /GET/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("HEAD /siyuan/asset 给头部不给 body", async () => {
  const png = Buffer.from("PNG-HEAD-BYTES");
  const stub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "image/png" }, body: png }));
  try {
    const res = await callImageRoute(undefined, {
      method: "HEAD",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: {},
    });
    assert.equal(res.status, 200, res.text());
    assert.equal(Number(headerOf(res.headers, "Content-Length")), png.length);
    assert.equal(res.bytes().length, 0, "HEAD 不能带 body");
  } finally {
    stub.restore();
  }
});

// --- 加固响应头：nosniff 一律有，SVG 额外沙箱 CSP ---------------------------
//
// 背景：`assets/` 目录里除了图片，还有内核自带的 .svg / .js / .json。`.js`/`.json` 被
// `image/*` 闸门挡掉了，但 `.svg` 会原样放行 —— 而 SVG 是可执行文档类型：放在 `<img>` 里
// 不会跑脚本，可一旦有人把这个 URL 当文档顶层打开（用户手滑、或书稿里一条链接），
// 脚本就会在 **DSH 自己的 origin** 里执行。加固办法是 nosniff + 沙箱 CSP，
// 而不是把矢量图一刀切禁掉（用户可能真的想插 SVG）。

test("代理响应一律带 X-Content-Type-Options: nosniff（png 与 svg 都有）", async () => {
  for (const [contentType, label] of [
    ["image/png", "png"],
    ["image/svg+xml", "svg"],
  ]) {
    const stub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": contentType }, body: Buffer.from("BYTES") }));
    try {
      const res = await callImageRoute(undefined, {
        method: "GET",
        url: `${ROUTES.asset}?path=${encodeURIComponent(`assets/a.${label}`)}`,
        headers: {},
      });
      assert.equal(res.status, 200, res.text());
      assert.equal(headerOf(res.headers, "X-Content-Type-Options"), "nosniff", `${label} 必须有 nosniff`);
      assert.equal(headerOf(res.headers, "Content-Type"), contentType, "Content-Type 仍原样透传");
    } finally {
      stub.restore();
    }
  }
});

test("只有 SVG 带沙箱 CSP，光栅图带上了就会伤到正常渲染", async () => {
  const cases = [
    { contentType: "image/svg+xml", expect: true },
    { contentType: "image/png", expect: false },
    { contentType: "image/jpeg", expect: false },
    { contentType: "image/avif", expect: false },
  ];
  for (const item of cases) {
    const stub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": item.contentType }, body: Buffer.from("BYTES") }));
    try {
      const res = await callImageRoute(undefined, {
        method: "GET",
        url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.bin")}`,
        headers: {},
      });
      const csp = headerOf(res.headers, "Content-Security-Policy");
      if (item.expect) {
        assert.equal(typeof csp, "string", `${item.contentType} 必须带 CSP`);
        assert.match(csp, /default-src\s+'none'/, "CSP 要掐掉所有外部取源");
        assert.match(csp, /sandbox/, "CSP 要把文档关进沙箱（没有 allow-scripts）");
        assert.doesNotMatch(csp, /allow-scripts/, "绝不能放开脚本执行");
      } else {
        assert.equal(csp, undefined, `${item.contentType} 不该带 CSP`);
      }
    } finally {
      stub.restore();
    }
  }
});

test("304 的两条路径都带 nosniff；SVG 的 304 保留缓存里那份 CSP 语义", async () => {
  // 路径一：上游自己回 304。
  const upstream304 = withFetch(async () => upstreamResponse({ status: 304, headers: { ETag: '"etag-abc"' } }));
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: { "if-none-match": '"etag-abc"' },
    });
    assert.equal(res.status, 304, res.text());
    assert.equal(headerOf(res.headers, "X-Content-Type-Options"), "nosniff", "上游 304 也要 nosniff");
    assert.equal(res.bytes().length, 0);
  } finally {
    upstream304.restore();
  }

  // 路径二：上游回 200，宿主自己比对 If-None-Match（内核不做条件请求）。
  const selfCompare = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "image/svg+xml", ETag: '"etag-svg"' }, body: Buffer.from("<svg/>") }));
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.svg")}`,
      headers: { "if-none-match": '"etag-svg"' },
    });
    assert.equal(res.status, 304, res.text());
    assert.equal(headerOf(res.headers, "X-Content-Type-Options"), "nosniff", "宿主自比对的 304 也要 nosniff");
    // SVG 的 304 必须把沙箱策略一起带上：这条路径宿主自己拿到了 Content-Type，判断得出来；
    // 而"上游自己回 304"那条路径拿不到类型，只能靠缓存条目保留原 200 的 CSP（RFC 9111）。
    const csp = headerOf(res.headers, "Content-Security-Policy");
    assert.equal(typeof csp, "string", "SVG 的 304 也要带沙箱 CSP");
    assert.match(csp, /sandbox/);
    assert.doesNotMatch(csp, /allow-scripts/);
    assert.equal(res.bytes().length, 0);
  } finally {
    selfCompare.restore();
  }

  // 光栅图的 304 不能凭空多出 CSP（多一个头就多一份误伤风险）。
  const png304 = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "image/png", ETag: '"etag-png"' }, body: Buffer.from("PNG") }));
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: { "if-none-match": '"etag-png"' },
    });
    assert.equal(res.status, 304, res.text());
    assert.equal(headerOf(res.headers, "Content-Security-Policy"), undefined, "png 的 304 不该带 CSP");
  } finally {
    png304.restore();
  }
});

test("token 明文不出现在 /siyuan/state 与 /siyuan/asset 的响应里", async () => {
  const stateStub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: 0, msg: "", data: "3.8.3" }) }));
  let stateText = "";
  let stateHeaders = "";
  try {
    const res = await callImageRoute(undefined, { method: "GET", url: ROUTES.state, headers: {} });
    assert.equal(res.status, 200);
    stateText = res.text();
    stateHeaders = JSON.stringify(res.headers);
  } finally {
    stateStub.restore();
  }
  assert.ok(stateText.includes("hasToken"), "state 只该给 hasToken");
  assert.ok(!stateText.includes(IMAGE_SETTINGS.token), "/siyuan/state 响应体不得出现 token");
  assert.ok(!stateHeaders.includes(IMAGE_SETTINGS.token), "/siyuan/state 响应头不得出现 token");

  const assetStub = withFetch(async () => upstreamResponse({ status: 200, headers: { "Content-Type": "image/png" }, body: Buffer.from("PNG") }));
  try {
    const res = await callImageRoute(undefined, {
      method: "GET",
      url: `${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`,
      headers: {},
    });
    assert.ok(!res.text().includes(IMAGE_SETTINGS.token), "/siyuan/asset 响应体不得出现 token");
    assert.ok(!JSON.stringify(res.headers).includes(IMAGE_SETTINGS.token), "/siyuan/asset 响应头不得出现 token");
    // 代理 URL 里也不该出现 token（浏览器端拼出来的形状）
    assert.ok(!`${ROUTES.asset}?path=${encodeURIComponent("assets/a.png")}`.includes("token"), "代理 URL 不能带 token 参数");
  } finally {
    assetStub.restore();
  }
});
