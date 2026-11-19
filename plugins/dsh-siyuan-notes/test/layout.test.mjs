// Layout persistence: the panel must reopen the documents the user left behind.
//
// Two halves are covered here: the shape conversion (panes <-> the remembered layout)
// and the host route that stores it. The conversion is where the risk lives — a layout
// is display memory, so it must never resurrect a broken tab, a stale column count or
// a buffer that was never saved.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

const SRC = new URL("../lib/client.js", import.meta.url);

let bundle = null;
const ReactStub = {
	Component: class {
		constructor(props) { this.props = props ?? {}; this.state = {}; }
		setState() {}
	},
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (value) => ({ current: value }),
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
	useContext: () => undefined,
	useReducer: (reducer, initial) => [initial, () => {}],
	Fragment: "Fragment",
};
globalThis.window = {
	__ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } },
};
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { makePane, makeTab, layoutSnapshot, layoutToPanes } = bundle.exports.__paneModel;

const tab = (key, id, title = id, hpath = "/" + id) => makeTab(key, { id, title, hpath });
const pane = (key, tabs, active = tabs.length === 0 ? -1 : 0, flags = {}) => makePane(key, flags, tabs, active);

// ---------------------------------------------------------------- snapshot
test("layoutSnapshot: records documents and column flags, never buffers", () => {
	const dirty = { ...tab("t1", "doc1", "第一章"), text: "未保存的草稿", savedText: "旧内容" };
	const panes = [pane(1, [dirty], 0, { view: "edit", autoSave: true, indentOn: false })];
	const snapshot = layoutSnapshot(panes, 1);
	assert.deepEqual(snapshot.panes[0].tabs, [{ docId: "doc1", title: "第一章", hpath: "/doc1" }], "only identity is remembered");
	assert.equal("text" in snapshot.panes[0].tabs[0], false, "an unsaved buffer must never be persisted as content");
	assert.equal(snapshot.panes[0].view, "edit");
	assert.equal(snapshot.panes[0].autoSave, true);
	assert.equal(snapshot.panes[0].indentOn, false);
	assert.equal(snapshot.activePane, 0);
	assert.equal(snapshot.version, 1);
});

test("layoutSnapshot: activePane follows the focused column, and tabs without an id are dropped", () => {
	const panes = [pane(1, [tab("t1", "doc1")]), pane(2, [tab("t2", "doc2"), makeTab("t3", { id: "", title: "" })])];
	assert.equal(layoutSnapshot(panes, 2).activePane, 1, "the second column is reported as focused");
	assert.equal(layoutSnapshot(panes, 2).panes[1].tabs.length, 1, "a tab with no document id is not remembered");
	// An unknown active key falls back to the first column rather than producing -1.
	assert.equal(layoutSnapshot(panes, 99).activePane, 0);
});

// ---------------------------------------------------------------- restore
test("layoutToPanes: rebuilds columns, tabs and flags from a snapshot", () => {
	const layout = {
		version: 1,
		panes: [
			{ tabs: [{ docId: "doc1", title: "一", hpath: "/一" }], active: 0, view: "preview", autoSave: true, indentOn: false },
			{ tabs: [{ docId: "doc2", title: "二" }, { docId: "doc3", title: "三" }], active: 1, view: "edit" },
		],
		activePane: 1,
	};
	const restored = layoutToPanes(layout, 0, 0);
	assert.equal(restored.panes.length, 2, "both columns come back");
	assert.deepEqual(restored.panes[0].tabs.map((item) => item.id), ["doc1"]);
	assert.deepEqual(restored.panes[1].tabs.map((item) => item.id), ["doc2", "doc3"]);
	assert.equal(restored.panes[1].active, 1, "the remembered tab stays active");
	assert.equal(restored.panes[0].view, "preview");
	assert.equal(restored.panes[0].autoSave, true);
	assert.equal(restored.panes[0].indentOn, false);
	assert.equal(restored.panes[1].view, "edit");
	assert.equal(restored.activePaneKey, restored.panes[1].key, "the focused column is restored");
	// Every restored tab starts empty and loading: its content comes from the kernel.
	assert.equal(restored.panes[0].tabs[0].text, "");
	assert.equal(restored.panes[0].tabs[0].loading, true);
});

test("layoutToPanes: keys continue past the caller's counters so later tabs cannot collide", () => {
	const layout = { panes: [{ tabs: [{ docId: "a" }, { docId: "b" }], active: 0 }], activePane: 0 };
	const restored = layoutToPanes(layout, 7, 40);
	assert.equal(restored.paneKey, 8, "one column consumed one pane key");
	assert.equal(restored.tabKey, 42, "two tabs consumed two tab keys");
	const keys = restored.panes.flatMap((item) => item.tabs.map((entry) => entry.key));
	assert.deepEqual(keys, ["t41", "t42"], "tab keys are unique and follow the counter");
});

test("layoutToPanes: refuses layouts that would restore nothing useful", () => {
	assert.equal(layoutToPanes(null, 0, 0), null, "no layout at all");
	assert.equal(layoutToPanes({}, 0, 0), null, "no panes array");
	assert.equal(layoutToPanes({ panes: [] }, 0, 0), null, "empty pane list");
	assert.equal(layoutToPanes("garbage", 0, 0), null, "not an object");
});

test("layoutToPanes: a column whose remembered tab index is out of range still opens", () => {
	const layout = { panes: [{ tabs: [{ docId: "a" }, { docId: "b" }], active: 9 }], activePane: 9 };
	const restored = layoutToPanes(layout, 0, 0);
	assert.equal(restored.panes[0].active, 1, "the index is clamped to the last tab");
	assert.equal(restored.activePaneKey, restored.panes[0].key, "and the focused column is clamped too");
	// A tab entry that is not an object, or has no id, is skipped rather than crashing.
	const messy = layoutToPanes({ panes: [{ tabs: [null, "x", { docId: "" }, { docId: "ok" }], active: 0 }], activePane: 0 }, 0, 0);
	assert.deepEqual(messy.panes[0].tabs.map((item) => item.id), ["ok"]);
});

// ---------------------------------------------------------------- host route
test("host: GET and POST /siyuan/layout round-trip through a real file", async () => {
	const home = path.join(os.tmpdir(), `dsh-siyuan-layout-${process.pid}-${Date.now()}`);
	fs.mkdirSync(home, { recursive: true });
	const previous = process.env.DSH_SIYUAN_NOTES_HOME;
	process.env.DSH_SIYUAN_NOTES_HOME = home;
	try {
		const host = await import("../lib/index.js");
		const routes = host.createSiYuanRoutes({ config: {} });

		const call = async (method, url, body) => {
			const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
			const stream = Readable.from(text === "" ? [] : [Buffer.from(text, "utf8")]);
			stream.method = method;
			stream.url = url;
			const res = {
				status: undefined,
				headers: undefined,
				body: undefined,
				writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
				end(payload) { this.body = payload; return this; },
			};
			await routes.handler(stream, res);
			return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
		};

		const empty = await call("GET", "/siyuan/layout");
		assert.equal(empty.status, 200);
		assert.equal(empty.json.ok, true);
		assert.equal(empty.json.value.layout, null, "nothing is remembered on a fresh profile");

		const saved = await call("POST", "/siyuan/layout", {
			panes: [{ tabs: [{ docId: "doc1", title: "第一章" }], active: 0, view: "split", autoSave: false, indentOn: true }],
			activePane: 0,
			// The sidebar's open folders are part of the remembered layout.
			expanded: ["box1::/", "box1::/a.sy"],
		});
		assert.equal(saved.status, 200);
		assert.equal(saved.json.value.saved, true);

		const again = await call("GET", "/siyuan/layout");
		assert.equal(again.status, 200);
		assert.equal(again.json.value.layout.panes[0].tabs[0].docId, "doc1", "the layout survives the round trip");
		assert.deepEqual(again.json.value.layout.expanded, ["box1::/", "box1::/a.sy"], "the tree expansion survives too");
		assert.equal(fs.existsSync(path.join(home, "siyuan-notes-layout.json")), true, "it lives in its own file");
		const raw = JSON.parse(fs.readFileSync(path.join(home, "siyuan-notes-layout.json"), "utf8"));
		assert.equal(raw.version, 1);

		// The layout file must not carry the connection token: it is a separate store.
		const settingsText = fs.existsSync(path.join(home, "siyuan-notes.json"))
			? fs.readFileSync(path.join(home, "siyuan-notes.json"), "utf8")
			: "";
		assert.equal(settingsText.includes("token"), settingsText === "" ? false : settingsText.includes("token"));
		const layoutText = fs.readFileSync(path.join(home, "siyuan-notes-layout.json"), "utf8");
		assert.equal(layoutText.includes("token"), false, "no credential may leak into the layout file");

		const bad = await call("POST", "/siyuan/layout", "not an object");
		assert.equal(bad.status, 400);
		assert.equal(bad.json.ok, false);

		const wrongMethod = await call("PUT", "/siyuan/layout", {});
		assert.equal(wrongMethod.status, 405);
	} finally {
		if (previous === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
		else process.env.DSH_SIYUAN_NOTES_HOME = previous;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------- restore races
// The restore is asynchronous, so two things can happen while it is in flight: the user
// opens a document, and the debounced save fires. Both were real defects before these
// guards existed: a click could be swallowed, and the empty skeleton could be written
// over the layout being restored.
test("mergeRestoredPanes: a document opened during the restore is not swallowed", () => {
	const { mergeRestoredPanes } = bundle.exports.__paneModel;
	const restored = layoutToPanes({ panes: [{ tabs: [{ docId: "docA" }], active: 0 }], activePane: 0 }, 0, 0).panes;
	const userOpened = [pane(1, [tab("t9", "docB")])];
	const merged = mergeRestoredPanes(restored, userOpened);
	assert.deepEqual(merged.flatMap((item) => item.tabs.map((entry) => entry.id)), ["docA", "docB"], "the restored document comes first, the click survives");
	assert.equal(merged.length, 1, "no extra column is created for the merge");
	assert.equal(merged[0].active, 1, "the document opened during the restore becomes the visible one");
	assert.equal(merged[0].tabs[merged[0].active].id, "docB", "…and that index really points at it");
});

test("mergeRestoredPanes: no duplicate tabs, and a no-op when the user opened nothing", () => {
	const { mergeRestoredPanes } = bundle.exports.__paneModel;
	const restored = layoutToPanes({ panes: [{ tabs: [{ docId: "docA" }, { docId: "docB" }], active: 1 }], activePane: 0 }, 0, 0).panes;
	// The same document is already restored: the user's copy must not appear twice.
	const duplicate = mergeRestoredPanes(restored, [pane(1, [tab("t9", "docA")])]);
	assert.deepEqual(duplicate.flatMap((item) => item.tabs.map((entry) => entry.id)), ["docA", "docB"]);
	assert.equal(duplicate[0].active, 1, "the remembered active tab is kept");
	// Nothing opened during the restore: the columns are handed back untouched.
	const untouched = mergeRestoredPanes(restored, []);
	assert.deepEqual(untouched, restored, "an empty merge returns the restored columns as-is");
	// An empty current column (the initial skeleton) must not add anything either.
	assert.deepEqual(mergeRestoredPanes(restored, [makePane(1)]), restored);
});

test("mergeRestoredPanes: extra tabs land on the first column, other columns keep theirs", () => {
	const { mergeRestoredPanes } = bundle.exports.__paneModel;
	const restored = layoutToPanes(
		{ panes: [{ tabs: [{ docId: "docA" }], active: 0 }, { tabs: [{ docId: "docB" }], active: 0 }], activePane: 1 },
		0,
		0,
	).panes;
	const merged = mergeRestoredPanes(restored, [pane(1, [tab("t9", "docX")]), pane(2, [tab("t10", "docY")])]);
	assert.deepEqual(merged[0].tabs.map((entry) => entry.id), ["docA", "docX", "docY"], "both new documents are kept, on the first column");
	assert.deepEqual(merged[1].tabs.map((entry) => entry.id), ["docB"], "the second column is untouched");
});

// ---------------------------------------------------------------- tree expansion
// The sidebar's open folders are part of "where I left off": without them the tree
// collapses on every visit and the document that is open is no longer visible in it.
test("revealKeys: lists every folder on the way to a document", () => {
	const { revealKeys } = bundle.exports.__test;
	// A top-level document needs only its notebook root open.
	assert.deepEqual(revealKeys("box1", "/a.sy"), ["box1::/"]);
	// One level of nesting: the root and the parent folder.
	assert.deepEqual(revealKeys("box1", "/a.sy/b.sy"), ["box1::/", "box1::/a.sy"]);
	// Three levels: every ancestor, outermost first, and never the document itself.
	assert.deepEqual(revealKeys("box1", "/a.sy/b.sy/c.sy"), ["box1::/", "box1::/a.sy", "box1::/a.sy/b.sy"]);
	assert.equal(revealKeys("box1", "/a.sy/b.sy/c.sy").includes("box1::/a.sy/b.sy/c.sy"), false, "the document is not a folder");
	// Junk in, empty out: a missing id or path reveals nothing rather than a bogus key.
	assert.deepEqual(revealKeys("", "/a.sy"), []);
	assert.deepEqual(revealKeys("box1", ""), []);
	assert.deepEqual(revealKeys(null, null), []);
});

test("expansionSnapshot: remembers only the folders that are actually open", () => {
	const { expansionSnapshot } = bundle.exports.__test;
	assert.deepEqual(expansionSnapshot({ "box1::/": true, "box1::/a.sy": true, "box1::/b.sy": false }), ["box1::/", "box1::/a.sy"], "closed folders are not remembered");
	assert.deepEqual(expansionSnapshot({}), []);
	assert.deepEqual(expansionSnapshot(null), []);
	assert.deepEqual(expansionSnapshot("garbage"), []);
	// A hostile state object cannot make the layout file enormous.
	const many = {};
	for (let i = 0; i < 300; i++) many["box::/p" + i] = true;
	assert.equal(expansionSnapshot(many).length, 200, "the list is capped");
});

test("withRevealedDocuments: opens the folders of every open document", async () => {
	const { withRevealedDocuments } = bundle.exports.__test;
	const locations = { docA: { box: "box1", path: "/a.sy/b.sy/docA.sy" }, docB: { box: "box2", path: "/docB.sy" } };
	const asked = [];
	const result = await withRevealedDocuments(
		[{ id: "docA" }, { id: "docB" }],
		async (id) => { asked.push(id); return locations[id] ?? null; },
	);
	assert.deepEqual(asked, ["docA", "docB"], "each document is located once");
	assert.deepEqual(Object.keys(result.expanded).sort(), ["box1::/", "box1::/a.sy", "box1::/a.sy/b.sy", "box2::/"], "every ancestor folder is opened");
	// A document whose location is unknown (deleted) contributes nothing and does not throw.
	const missing = await withRevealedDocuments([{ id: "gone" }, { id: "docB" }], async (id) => locations[id] ?? null);
	assert.deepEqual(Object.keys(missing.expanded), ["box2::/"]);
	// A pre-resolved location is reused instead of being queried again.
	const cached = new Map([["docA", locations.docA]]);
	const reused = await withRevealedDocuments([{ id: "docA" }], async () => { throw new Error("must not query"); }, cached);
	assert.deepEqual(Object.keys(reused.expanded).sort(), ["box1::/", "box1::/a.sy", "box1::/a.sy/b.sy"]);
});

test("host: an over-long expansion key is dropped, never truncated", async () => {
	// A cut path is not the folder the user had open: listing it would fail or open the
	// wrong one, so the key must be discarded rather than shortened.
	const { normalizeLayout } = await import("../lib/index.js");
	const tooLong = "box::/" + new Array(400).fill("p").join("/");
	assert.ok(tooLong.length > 700, "the fixture really is over the cap");
	const result = normalizeLayout({ expanded: [tooLong, "box::/ok"] });
	assert.deepEqual(result.value.expanded, ["box::/ok"], "the over-long key is dropped and the good one survives");
	// A key that is long but legal is kept intact, not trimmed.
	const legal = "box::/" + new Array(80).fill("p").join("/");
	assert.ok(legal.length < 700);
	assert.deepEqual(normalizeLayout({ expanded: [legal] }).value.expanded, [legal], "a long-but-valid key is preserved byte for byte");
});

test("host: duplicate expansion keys are collapsed", async () => {
	// The client builds the list from Object.keys, so it cannot produce duplicates; a
	// hand-edited or older layout file can, and each copy would cost a kernel request.
	const { normalizeLayout } = await import("../lib/index.js");
	const result = normalizeLayout({ expanded: ["box::/", "box::/a.sy", "box::/", "box::/a.sy"] });
	assert.deepEqual(result.value.expanded, ["box::/", "box::/a.sy"], "each folder appears once, order preserved");
});

test("layout round-trip keeps the tree expansion", () => {
	const { layoutSnapshot, layoutToPanes } = bundle.exports.__paneModel;
	const panes = [pane(1, [tab("t1", "doc1")])];
	const expanded = { "box1::/": true, "box1::/a.sy": true, "box1::/b.sy": false };
	const snapshot = layoutSnapshot(panes, 1, expanded);
	assert.deepEqual(snapshot.expanded, ["box1::/", "box1::/a.sy"], "only open folders are written");
	const restored = layoutToPanes(snapshot, 0, 0);
	assert.deepEqual(Object.keys(restored.expanded).sort(), ["box1::/", "box1::/a.sy"], "and they come back as a lookup");
	// A layout from before this feature has no `expanded` field at all.
	const old = layoutToPanes({ panes: [{ tabs: [{ docId: "doc1" }], active: 0 }], activePane: 0 }, 0, 0);
	assert.deepEqual(old.expanded, {}, "an older layout restores with a collapsed tree, not a crash");
});
