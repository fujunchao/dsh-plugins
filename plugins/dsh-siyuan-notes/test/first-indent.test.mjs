// The kernel trims the leading whitespace of a whole-document `getBlockKramdown`
// response, so a document's FIRST block reads back without the indent it really has.
// That made the opening paragraph's first-line indent look broken: the buffer was built
// from the trimmed read, so the editor showed no indent, and "补齐全篇" then re-wrote it
// on every save while the verification read reported a false mismatch.
//
// The repair reads the lead back from the block index. These tests pin the pure parts
// and the read helper's behaviour, including the failure paths that must stay harmless.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

let bundle = null;
const ReactStub = {
	Component: class { constructor(props) { this.props = props ?? {}; this.state = {}; } setState() {} },
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (v) => ({ current: v }),
	useSyncExternalStore: (a, b) => b(),
};
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } } };
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { hasLeadingSpace, restoreFirstLead, readDocumentText, firstBlockLead } = bundle.exports.__test;

const FULL = "\u3000\u3000";
/**
 * A document as the kernel hands it over: the FIRST paragraph has lost its lead, and
 * every later paragraph carries one extra INDENT prefix that the parser strips again.
 * Using this in every fixture keeps the shape stated in exactly one place.
 */
const kernelDoc = (first, rest) =>
	[first, ...rest.map((text) => FULL + text)]
		.map((text, index) => `${text}\n{: id="b${index + 1}"}`)
		.join("\n\n");

/** A client whose kramdown/l SQL answers are scripted per test. */
function fakeClient({ kramdown, indexContent, failSql = false, failKramdown = false }) {
	const calls = [];
	return {
		calls,
		async api(path, payload) {
			calls.push({ path, payload });
			if (path === "/api/block/getBlockKramdown") {
				if (failKramdown) throw new Error("kernel down");
				return { kramdown };
			}
			if (path === "/api/query/sql") {
				if (failSql) throw new Error("sql down");
				return [{ content: indexContent }];
			}
			throw new Error("unexpected call: " + path);
		},
	};
}

// ---------------------------------------------------------------- pure parts
test("hasLeadingSpace: recognises the indent characters the panel writes", () => {
	assert.equal(hasLeadingSpace(FULL + "正文"), true, "ideographic spaces");
	assert.equal(hasLeadingSpace("  正文"), true, "ascii spaces");
	assert.equal(hasLeadingSpace("\u00a0正文"), true, "no-break space");
	assert.equal(hasLeadingSpace("\t正文"), true, "tab");
	assert.equal(hasLeadingSpace("正文"), false);
	assert.equal(hasLeadingSpace(""), false);
	assert.equal(hasLeadingSpace(null), false);
	assert.equal(hasLeadingSpace(undefined), false);
	// A quoted paragraph starts with the quote mark, not whitespace.
	assert.equal(hasLeadingSpace("“引号开头”"), false);
});

test("restoreFirstLead: puts the trimmed lead back on the first block only", () => {
	const blocks = [
		{ id: "b1", text: "第一段" },
		{ id: "b2", text: "第二段" },
	];
	const repaired = restoreFirstLead(blocks, FULL);
	assert.equal(repaired[0].text, FULL + "第一段", "the first block gets its indent back");
	assert.equal(repaired[1].text, "第二段", "later blocks are untouched");
	assert.equal(repaired[0].id, "b1", "the id survives");
	assert.equal(blocks[0].text, "第一段", "the input is not mutated");

	// Nothing to do: no lead reported, no blocks, or the block already has one.
	assert.deepEqual(restoreFirstLead(blocks, ""), blocks, "no lead reported means no change");
	assert.deepEqual(restoreFirstLead([], FULL), [], "no blocks");
	assert.equal(restoreFirstLead([{ id: "b1", text: FULL + "已有缩进" }], FULL)[0].text, FULL + "已有缩进", "never doubles an existing lead");
	assert.deepEqual(restoreFirstLead(null, FULL), [], "null input");
	assert.deepEqual(restoreFirstLead(blocks, null), blocks, "null lead");
});

// ---------------------------------------------------------------- read helper
test("readDocumentText: repairs the first block from the index", async () => {
	const client = fakeClient({
		kramdown: kernelDoc("第一段", [FULL + "第二段"]),
		indexContent: FULL + "第一段",
	});
	const read = await readDocumentText(client, "doc1");
	assert.equal(read.blocks.length, 2);
	assert.equal(read.blocks[0].text, FULL + "第一段", "the opening paragraph keeps its indent");
	assert.equal(read.blocks[1].text, FULL + "第二段", "the second paragraph is untouched");
	assert.equal(read.text, FULL + "第一段\n\n" + FULL + "第二段", "the buffer text carries the indent");
	assert.equal(read.lead, FULL, "the recovered lead is reported");
	assert.equal(read.kramdown.includes("第一段"), true, "the raw kramdown is still available for the backup");
	// Only one extra request, and only for the index lookup.
	const sql = client.calls.filter((call) => call.path === "/api/query/sql");
	assert.equal(sql.length, 1, "exactly one index lookup");
	assert.match(sql[0].payload.stmt, /SELECT content FROM blocks WHERE id = 'b1'/, "the lookup asks for the first block");
});

test("readDocumentText: untouched when the first block already has a lead", async () => {
	// The serializer prefixes every block with one INDENT, so a first block that really
	// has a lead arrives with two and keeps one after the strip. In that shape nothing
	// may be repaired and no index lookup may happen.
	const client = fakeClient({
		kramdown: `${FULL}${FULL}第一段\n{: id="b1"}`,
		indexContent: FULL + "第一段",
	});
	const read = await readDocumentText(client, "doc1");
	assert.equal(read.blocks[0].text, FULL + "第一段");
	assert.equal(client.calls.filter((call) => call.path === "/api/query/sql").length, 0, "no index lookup when nothing was trimmed");
});

test("readDocumentText: a plain opening paragraph stays plain", async () => {
	const client = fakeClient({
		kramdown: `第一段\n{: id="b1"}`,
		indexContent: "第一段",
	});
	const read = await readDocumentText(client, "doc1");
	assert.equal(read.blocks[0].text, "第一段", "no indent is invented");
	assert.equal(read.lead, "");
});

test("readDocumentText: an index failure leaves the text as the kernel returned it", async () => {
	const client = fakeClient({
		kramdown: kernelDoc("第一段", [FULL + "第二段"]),
		indexContent: FULL + "第一段",
		failSql: true,
	});
	const read = await readDocumentText(client, "doc1");
	// Degrading to the pre-repair behaviour is correct: showing no indent is far better
	// than failing to open the document.
	assert.equal(read.blocks[0].text, "第一段", "falls back to the trimmed read");
	assert.equal(read.blocks[1].text, FULL + "第二段");
	assert.equal(read.lead, "");
});

test("readDocumentText: an empty document is handled", async () => {
	const client = fakeClient({ kramdown: "", indexContent: "" });
	const read = await readDocumentText(client, "doc1");
	assert.deepEqual(read.blocks, []);
	assert.equal(read.text, "");
	assert.equal(read.lead, "");
});

test("firstBlockLead: quotes the id and gives up quietly on odd input", async () => {
	const quoted = fakeClient({ kramdown: "", indexContent: FULL + "x" });
	assert.equal(await firstBlockLead(quoted, "a'b"), FULL, "the lead is returned");
	assert.match(quoted.calls[0].payload.stmt, /'a''b'/, "a quote in the id is escaped, not injected");
	assert.equal(await firstBlockLead(quoted, ""), "", "empty id needs no query");
	assert.equal(await firstBlockLead(quoted, null), "", "null id needs no query");
	assert.equal(quoted.calls.length, 1, "only the real lookup reached the bridge");
});
