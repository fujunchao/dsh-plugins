// Editor-context plumbing: validation of what the panel pushes, the one-line
// summary the model sees in its prompt, and the tool payload it can ask for.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  describeContext,
  normalizeContext,
  contextAgeSeconds,
  contextToolValue,
  currentEditorContext,
  clearEditorContext,
  createSiYuanRoutes,
  ROUTES,
  CONTEXT_TOOL_NAME,
} from "../lib/index.js";

const NOW = 1_800_000_000_000;

// ---------------------------------------------------------------- normalizeContext
{
  const result = normalizeContext({ docId: "doc-1", title: "第一章", hpath: "/小说/第一章" }, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.value.docId, "doc-1");
  assert.equal(result.value.title, "第一章");
  assert.equal(result.value.hpath, "/小说/第一章");
  assert.equal(result.value.updatedAt, NOW);
  assert.equal(result.value.selection, null);
  assert.deepEqual(result.value.tabs, []);
}

{
  // An empty body means "no document open" — a state the agent must be able to see.
  for (const body of [{}, { docId: null }, { docId: "   " }]) {
    const result = normalizeContext(body, NOW);
    assert.equal(result.ok, true, "empty-ish body stays valid: " + JSON.stringify(body));
    assert.equal(result.value.docId, null);
  }
}

{
  // Bad types are refused rather than silently coerced.
  const result = normalizeContext({ docId: 42 }, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_context");
  assert.equal(normalizeContext(null, NOW).ok, false, "null body is refused");
  assert.equal(normalizeContext("nope", NOW).ok, false, "a string body is refused");
}

{
  // Selection: kept when it has text, dropped when it does not, and truncated.
  const withSelection = normalizeContext(
    { docId: "d", selection: { text: "原文", startLine: 3, endLine: 5 } },
    NOW,
  );
  assert.deepEqual(withSelection.value.selection, { text: "原文", startLine: 3, endLine: 5 });

  const blank = normalizeContext({ docId: "d", selection: { text: "   " } }, NOW);
  assert.equal(blank.value.selection, null, "whitespace-only selection is not a selection");

  const huge = normalizeContext({ docId: "d", selection: { text: "x".repeat(9000) } }, NOW);
  assert.equal(huge.value.selection.text.length, 4000, "selection is truncated, not rejected");
}

{
  // Counts are clamped to sane non-negative integers, tabs are filtered.
  const result = normalizeContext(
    {
      docId: "d",
      cursorLine: -4,
      totalLines: 12.7,
      tabs: [{ docId: "a", title: "A" }, { title: "no id" }, { docId: "b" }],
      activeTabIndex: 1,
    },
    NOW,
  );
  assert.equal(result.value.cursorLine, 0);
  assert.equal(result.value.totalLines, 13);
  assert.deepEqual(result.value.tabs, [{ docId: "a", title: "A" }, { docId: "b", title: "" }]);
  assert.equal(result.value.activeTabIndex, 1);
}

// ---------------------------------------------------------------- describeContext
assert.equal(describeContext(undefined, NOW), undefined, "no snapshot -> no prompt line");
assert.equal(describeContext({ docId: null }, NOW), undefined, "nothing open -> no prompt line");

{
  const line = describeContext(
    {
      docId: "d",
      title: "第一章 红鞋的少女",
      hpath: "/绝世的笔记本/奥特曼/章节/第一章 红鞋的少女",
      cursorLine: 12,
      totalLines: 240,
      selection: { text: "选中的原文", startLine: 12, endLine: 14 },
      tabs: [{ docId: "a", title: "A" }, { docId: "b", title: "B" }],
      updatedAt: NOW,
    },
    NOW,
  );
  assert.ok(line.includes("《第一章 红鞋的少女》"), "names the document: " + line);
  assert.ok(line.includes("12/240"), "reports the caret position: " + line);
  assert.ok(line.includes("12-14"), "reports the selected line span: " + line);
  assert.ok(line.includes("2 个标签页"), "reports the open tab count: " + line);
  assert.ok(line.endsWith("。"));
  assert.ok(line.length < 300, "the summary stays compact: " + line.length);
}

{
  // A single-line selection reads as "1 行" rather than a range.
  const line = describeContext(
    { docId: "d", title: "T", cursorLine: 2, totalLines: 9, selection: { text: "x", startLine: 2, endLine: 2 }, tabs: [], updatedAt: NOW },
    NOW,
  );
  assert.ok(line.includes("选中 1 行"), line);
  assert.ok(!line.includes("标签页"), "one tab is not worth reporting");
}

{
  // Without a title or path the id is the only name available.
  const line = describeContext({ docId: "20251122094426-znic0ws", title: "", hpath: "", cursorLine: 1, totalLines: 1, selection: null, tabs: [], updatedAt: NOW }, NOW);
  assert.ok(line.includes("20251122094426-znic0ws"), line);
}

// ---------------------------------------------------------------- age + tool payload
/**
 * Assert the value is what DSH calls "lossless JSON".
 *
 * Mirrors the Host's own check (it walks every property and rejects the whole result on a
 * single `undefined`), because `JSON.stringify` is too lenient: it silently drops
 * undefined-valued keys instead of failing, which is how this defect shipped unnoticed.
 * @param {unknown} value candidate tool result.
 */
function assertLosslessJson(value) {
  const walk = (node, path) => {
    if (node === undefined) throw new Error(`undefined at ${path}`);
    if (node === null) return;
    const kind = typeof node;
    if (kind === "boolean" || kind === "string" || kind === "number") {
      if (kind === "number" && !Number.isFinite(node)) throw new Error(`non-finite number at ${path}`);
      return;
    }
    if (kind !== "object") throw new Error(`${kind} at ${path} is not JSON`);
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(node)) walk(item, `${path}.${key}`);
  };
  walk(value, "output");
}

assert.equal(contextAgeSeconds(undefined, NOW), undefined);
assert.equal(contextAgeSeconds({ updatedAt: NOW - 5000 }, NOW), 5);

{
  const value = contextToolValue(undefined, NOW);
  assert.equal(value.open, false);
  assert.ok(typeof value.summary === "string");
  // The result travels through DSH's lossless-JSON check: one undefined value rejects the
  // whole tool call, so the key must be absent rather than present-and-undefined.
  assert.equal("ageSeconds" in value, false, "an unopened document has no age, and must not report one");
  assertLosslessJson(value);
  // A stale snapshot with no document id takes the same path.
  assertLosslessJson(contextToolValue(null, NOW));
  assertLosslessJson(contextToolValue({ docId: null, updatedAt: NOW }, NOW));
}

{
  const snapshot = {
    docId: "doc-1",
    title: "第一章",
    hpath: "/小说/第一章",
    cursorLine: 4,
    totalLines: 40,
    selection: { text: "引文", startLine: 4, endLine: 4 },
    tabs: [{ docId: "doc-1", title: "第一章" }],
    activeTabIndex: 0,
    view: "split",
    updatedAt: NOW - 3000,
  };
  const value = contextToolValue(snapshot, NOW);
  assert.equal(value.open, true);
  assert.equal(value.docId, "doc-1");
  assert.equal(value.cursorLine, 4);
  assert.deepEqual(value.selection, { text: "引文", startLine: 4, endLine: 4 });
  assert.equal(value.ageSeconds, 3, "the model can judge staleness");
  assert.ok(value.summary.includes("第一章"));
  // The tool result must be JSON-serialisable: the renderer stringifies it.
  assert.doesNotThrow(() => JSON.stringify(value));
  // …and lossless, which is the stricter requirement the Host enforces.
  assertLosslessJson(value);
}

assert.equal(CONTEXT_TOOL_NAME, "siyuan_note_context");

// ---------------------------------------------------------------- route
{
  clearEditorContext();
  assert.equal(currentEditorContext(), undefined);

  const routes = createSiYuanRoutes({ config: {} });
  const call = async (method, url, body) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const stream = Readable.from(text === "" ? [] : [Buffer.from(text, "utf8")]);
    stream.method = method;
    stream.url = url;
    const res = {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(code, headers) {
        this.statusCode = code;
        Object.assign(this.headers, headers ?? {});
        return this;
      },
      end(chunk) {
        this.body = chunk ?? "";
      },
    };
    await routes.handler(stream, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };

  const accepted = await call("POST", ROUTES.context, {
    docId: "doc-7",
    title: "第七章",
    hpath: "/小说/第七章",
    cursorLine: 30,
    totalLines: 300,
    selection: { text: "他推开门。", startLine: 30, endLine: 30 },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.ok, true);
  assert.equal(accepted.json.value.accepted, true);

  const stored = currentEditorContext();
  assert.equal(stored.docId, "doc-7");
  assert.equal(stored.cursorLine, 30);

  const cleared = await call("POST", ROUTES.context, { docId: null });
  assert.equal(cleared.status, 200);
  assert.equal(currentEditorContext().docId, null);

  const wrongMethod = await call("GET", ROUTES.context);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.json.ok, false);
  assert.ok(String(wrongMethod.json.error.code).includes("method"));

  const badType = await call("POST", ROUTES.context, { docId: 99 });
  assert.equal(badType.status, 400);
  assert.equal(badType.json.ok, false);

  clearEditorContext();
}

console.log("context: all assertions passed");
