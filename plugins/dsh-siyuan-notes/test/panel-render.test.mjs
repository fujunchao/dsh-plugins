// Panel-level render guard: PanelPage must survive having an open document.
//
// The render smoke test only renders PanelPage with an EMPTY pane list, so the whole
// per-column wiring inside `panes.map(...)` never runs there. That blind spot shipped a
// white screen: two stale prop lines left `setView` referenced in PanelPage's scope,
// which only throws once a document is open — and the framework then disables the
// panel's main-slot registration, so the user sees a blank area with no error text.
// This file renders the panel WITH documents so that class of fault cannot pass again.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

let bundle = null;

function makeTab(key, id, title, text) {
	return { key, id, title, hpath: "/" + title, text, savedText: text, blocks: [], loading: false, saving: false, error: null, savedAt: null, stamp: 0 };
}

function makePane(key, tabs, active) {
	return { key, tabs, active, view: "split", autoSave: false, indentOn: true };
}

/**
 * Render PanelPage with the given initial state, the way React would.
 *
 * State is seeded by *name* (`{ connection, panes, dialog }`) and translated to slot
 * indices through the implementation's `__stateSlots` export, so adding a hook to the
 * panel cannot silently shift a seed onto the wrong piece of state.
 * @param {Record<string, unknown>} seed named initial values.
 */
function renderPanel(seed) {
	let stateIndex = 0;
	let named = {};
	const ReactStub = {
		Component: class {
			constructor(props) { this.props = props ?? {}; this.state = {}; }
			setState() {}
		},
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useState: (initial) => {
			const index = stateIndex++;
			const value = index in named ? named[index] : typeof initial === "function" ? initial() : initial;
			return [value, () => {}];
		},
		useEffect: () => {},
		useLayoutEffect: () => {},
		useMemo: (factory) => factory(),
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
	globalThis.document = { head: { appendChild() {}, removeChild() {} }, createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null };
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { baseUrl: "http://127.0.0.1:6806", hasToken: true, version: "3.8.3" } }) });
	new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

	const { PanelPage, EditorPane, TreePane } = bundle.exports.__panes;
	const slots = bundle.exports.__stateSlots;
	// Translate the named seed into slot indices now that the bundle is loaded.
	for (const [name, value] of Object.entries(seed)) {
		if (!(name in slots)) throw new Error(`unknown panel state slot: ${name}`);
		named[slots[name]] = value;
	}
	stateIndex = 0;
	const tree = PanelPage({
		t: (key) => key,
		useSessions: (selector) => selector({ ids: [], byId: {} }),
	});
	// React would render the function components; do the same so their bodies run too.
	const rendered = [];
	const walk = (node) => {
		if (node === null || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(walk);
		if (node.type === EditorPane) rendered.push({ kind: "editor", props: node.props });
		if (node.type === TreePane) rendered.push({ kind: "tree", props: node.props });
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	return { tree, rendered, EditorPane };
}

const connection = { phase: "ready", value: { baseUrl: "http://127.0.0.1:6806", hasToken: true, version: "3.8.3" } };

test("PanelPage renders with one open document", () => {
	const tab = makeTab("t1", "doc1", "第一章", "第一段\n\n第二段");
	const { rendered, EditorPane } = renderPanel({ connection: connection, panes: [makePane(1, [tab], 0)] });
	const editors = rendered.filter((node) => node.kind === "editor");
	assert.equal(editors.length, 1, "the column renders exactly one editor");
	const props = editors[0].props;
	assert.equal(props.doc.id, "doc1", "the editor receives the open document");
	// Every handler the panel hands down must be callable: a dangling identifier here is
	// exactly what produced the white screen.
	for (const name of ["setDoc", "setView", "setAutoSave", "onIndentChange", "onQuote", "onCaret", "onReload", "onRename", "onRemove", "onNotice", "onSaved"]) {
		assert.equal(typeof props[name], "function", `${name} must be passed as a function`);
	}
	assert.equal(typeof EditorPane, "function", "the editor component exists");
	// The per-column flags come from the pane object, not from panel-wide state.
	assert.equal(props.view, "split");
	assert.equal(props.autoSave, false);
	assert.equal(props.indentOn, true);
});

test("PanelPage renders with two columns, each with its own document and flags", () => {
	const left = makeTab("t1", "doc1", "左", "左文\n\n左二");
	const right = makeTab("t2", "doc2", "右", "右文");
	const panes = [
		{ ...makePane(1, [left], 0), view: "split", autoSave: false, indentOn: true },
		{ ...makePane(2, [right], 0), view: "preview", autoSave: true, indentOn: false },
	];
	const { rendered } = renderPanel({ connection: connection, panes: panes });
	const editors = rendered.filter((node) => node.kind === "editor");
	assert.equal(editors.length, 2, "both columns render an editor");
	assert.deepEqual(editors.map((node) => node.props.doc.id), ["doc1", "doc2"]);
	assert.deepEqual(editors.map((node) => node.props.view), ["split", "preview"], "each column keeps its own view mode");
	assert.deepEqual(editors.map((node) => node.props.autoSave), [false, true], "each column keeps its own auto-save choice");
	assert.deepEqual(editors.map((node) => node.props.indentOn), [true, false], "each column keeps its own indent switch");
});

test("PanelPage renders a column whose document is still loading", () => {
	const tab = { ...makeTab("t1", "doc1", "载入中", ""), loading: true };
	const { rendered } = renderPanel({ connection: connection, panes: [makePane(1, [tab], 0)] });
	const editors = rendered.filter((node) => node.kind === "editor");
	assert.equal(editors.length, 1, "a loading document still renders the column");
	assert.equal(editors[0].props.doc.loading, true);
});

test("PanelPage renders three columns and keeps their documents apart", () => {
	const panes = [1, 2, 3].map((key) => makePane(key, [makeTab(`t${key}`, `doc${key}`, `文档${key}`, `正文${key}`)], 0));
	const { rendered } = renderPanel({ connection: connection, panes: panes });
	const editors = rendered.filter((node) => node.kind === "editor");
	assert.equal(editors.length, 3, "every column renders an editor");
	assert.deepEqual(editors.map((node) => node.props.doc.id), ["doc1", "doc2", "doc3"], "no column receives another column's document");
	for (const node of editors) assert.equal(typeof node.props.onIndentChange, "function", "handlers are wired in every column");
});

test("PanelPage renders its delete dialog over the editor", () => {
	const dialog = { kind: "remove", paneKey: 1, tabKey: "t1", docId: "doc1", title: "第一章" };
	const { tree } = renderPanel({ connection: connection, panes: [makePane(1, [makeTab("t1", "doc1", "第一章", "正文")], 0)], dialog: dialog });
	const modals = [];
	const walk = (node) => {
		if (node === null || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(walk);
		if (node.props && node.props.className === "sy-modal") modals.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	assert.equal(modals.length, 1, "the confirmation dialog is rendered");
});
