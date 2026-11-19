// Component-level behaviour of the editor's text-changing actions.
//
// The pure helpers live in editor-ux.test.mjs; this file drives the real EditorPane
// with a stub React so it can see what an action writes into the buffer and what the
// switch/notice do. It exists because two mutations survived the pure-function suite:
// removing the "no textarea" branch of applyEdit (a preview-mode document wipe) and
// restoring the indent switch to a plain toggle with no feedback.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

class StubComponent {
	constructor(props) {
		this.props = props ?? {};
		this.state = this.state ?? {};
	}
	setState(next) {
		const patch = typeof next === "function" ? next(this.state) : next;
		this.state = { ...this.state, ...patch };
	}
}

const ReactStub = {
	Component: StubComponent,
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
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

let bundle = null;
globalThis.window = {
	__ModuleLoader__: {
		load({ id, factory }) {
			bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) };
		},
	},
};
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { EditorPane } = bundle.exports.__panes;
const IND = "\u3000\u3000";
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

function collect(node, hits, predicate) {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) collect(child, hits, predicate);
		return;
	}
	if (predicate(node)) hits.push(node);
	for (const child of node.children ?? []) collect(child, hits, predicate);
}

/** Render one editor column and capture what its actions write back. */
function renderEditor({ text, indentOn = true, view = "split", savedText = text }) {
	const state = { updates: [], notice: null, indentOn: null };
	const doc = { id: "doc1", title: "文档", text, savedText, blocks: [], loading: false, saving: false, error: null, savedAt: null, stamp: 0 };
	const tree = EditorPane({
		t,
		client: { api: async () => ({}) },
		doc,
		setDoc: (next) => state.updates.push(typeof next === "function" ? next(doc) : next),
		onReload: () => {},
		onRename: () => {},
		onRemove: () => {},
		view,
		setView: () => {},
		autoSave: false,
		setAutoSave: () => {},
		onNotice: (payload) => { state.notice = payload; },
		stale: false,
		onSaved: () => {},
		indentOn,
		onIndentChange: (next) => { state.indentOn = next; },
		onQuote: () => {},
		onCaret: () => {},
		caretRequest: null,
	});
	const buttons = [];
	collect(tree, buttons, (node) => node.type === "button");
	const formatButtons = [];
	collect(tree, formatButtons, (node) => typeof node.type === "function" && typeof node.props.onClick === "function" && typeof node.props.label === "string");
	const byTitle = (title) => buttons.find((node) => node.props.title === title) ?? null;
	return { state, doc, buttons, formatButtons, byTitle, latestText: () => (state.updates.length === 0 ? text : state.updates[state.updates.length - 1].text) };
}

// ---------------------------------------------------------------- the indent switch
test("indent switch: turning it off on an unindented document changes nothing and says so", () => {
	const editor = renderEditor({ text: "第一段\n\n第二段", indentOn: true });
	const toggle = editor.byTitle("indentHint");
	assert.ok(toggle, "the switch is rendered");
	toggle.props.onClick();
	assert.equal(editor.state.indentOn, false, "the switch flips");
	assert.deepEqual(editor.state.updates, [], "the buffer is not touched: there was nothing to remove");
	assert.equal(editor.state.notice.text, "indentAlreadyOff", "the user is told why nothing happened");
});

test("indent switch: turning it on indents what is already written", () => {
	const editor = renderEditor({ text: "第一段\n\n第二段", indentOn: false });
	editor.byTitle("indentHint").props.onClick();
	assert.equal(editor.state.indentOn, true);
	const text = editor.latestText();
	assert.equal(text, `${IND}第一段\n\n${IND}第二段`, "both paragraphs gain one indent");
	assert.equal(editor.state.notice.text, 'indentAppliedCount{"n":2}', "the notice carries the count");
});

test("indent switch: turning it off removes indents that exist", () => {
	const editor = renderEditor({ text: `${IND}第一段\n\n${IND}第二段`, indentOn: true });
	editor.byTitle("indentHint").props.onClick();
	assert.equal(editor.state.indentOn, false);
	assert.equal(editor.latestText(), "第一段\n\n第二段");
	assert.equal(editor.state.notice.text, "indentRemoved");
});

// ---------------------------------------------------------------- the sweep action
test("indent all: offered only while a paragraph still lacks the indent", () => {
	const bare = renderEditor({ text: "第一段\n\n第二段", indentOn: true });
	const sweep = bare.byTitle("indentFillHint");
	assert.ok(sweep, "a bare document offers the sweep");
	assert.deepEqual(sweep.children, ['indentFill{"n":2}'], "the label carries the count");

	const done = renderEditor({ text: `${IND}第一段\n\n${IND}第二段`, indentOn: true });
	assert.equal(done.byTitle("indentFillHint"), null, "a fully indented document does not offer it");
});

test("indent all: one click indents every bare paragraph and turns the switch on", () => {
	// The reported case: the switch was already on, the document had no indents at all,
	// so the switch alone could never fix it.
	const editor = renderEditor({ text: "第一段\n\n第二段\n\n第三段", indentOn: true });
	editor.byTitle("indentFillHint").props.onClick();
	assert.equal(editor.state.indentOn, true, "the switch is on afterwards");
	assert.equal(editor.latestText(), `${IND}第一段\n\n${IND}第二段\n\n${IND}第三段`);
	assert.equal(editor.state.notice.text, 'indentAppliedCount{"n":3}');
});

test("indent all: headings, lists and fenced code are left alone", () => {
	const source = ["# 标题", "", "- 列表项", "", "```", "代码", "```", "", "正文"].join("\n");
	const editor = renderEditor({ text: source, indentOn: false });
	editor.byTitle("indentFillHint").props.onClick();
	assert.equal(editor.latestText(), ["# 标题", "", "- 列表项", "", "```", "代码", "```", "", `${IND}正文`].join("\n"));
});

// ---------------------------------------------------------------- no textarea (preview)
// In preview-only view there is no textarea: the action must still write the whole
// document back, not the fragment that replaceRange reports for a missing element.
test("preview view: an action writes the complete document, never a fragment", () => {
	const source = "第一段\n\n第二段\n\n第三段";
	const editor = renderEditor({ text: source, indentOn: false, view: "preview" });
	editor.byTitle("indentFillHint").props.onClick();
	const text = editor.latestText();
	assert.equal(typeof text, "string", "the buffer must not be set to null");
	assert.equal(text, `${IND}第一段\n\n${IND}第二段\n\n${IND}第三段`, "the whole document is written back");
	assert.ok(text.includes("第三段"), "content after the change survives");
});

test("no textarea: an inline format still writes the whole document back", () => {
	// The harness has no DOM, so textareaRef is null — the same shape as preview-only
	// view. The buffer must keep the document and gain the marks, not be replaced by
	// the inserted fragment.
	const editor = renderEditor({ text: "第一段", view: "split" });
	const bold = editor.formatButtons.find((node) => node.props.label === "bold");
	assert.ok(bold, "the format bar offers bold");
	bold.props.onClick();
	const text = editor.latestText();
	assert.equal(typeof text, "string", "the buffer must not be set to null");
	assert.ok(text.startsWith("第一段"), "the existing wording survives");
	assert.ok(text.includes("**"), "the marks were inserted");
});

// ---------------------------------------------------------------- dictionary coverage
// Every inline format is looked up dynamically (`t(action)`), so a missing entry never
// fails a literal-key check — it shows up as the raw key name in the UI. `link` was
// missing exactly that way: Ctrl+K inserted "[link](https://)" in a Chinese panel.
test("every inline format has a label in both dictionaries", () => {
	const { INLINE_FORMATS } = bundle.exports.__test;
	const { zh, en } = bundle.exports.__dicts;
	const missing = [];
	for (const action of Object.keys(INLINE_FORMATS)) {
		if (typeof zh[action] !== "string" || !zh[action]) missing.push(`zh.${action}`);
		if (typeof en[action] !== "string" || !en[action]) missing.push(`en.${action}`);
	}
	assert.deepEqual(missing, [], `inline formats with no translation: ${missing.join(", ")}`);
	// The dictionaries must also agree with each other, or one locale silently falls back.
	const onlyZh = Object.keys(zh).filter((key) => !(key in en)).sort();
	const onlyEn = Object.keys(en).filter((key) => !(key in zh)).sort();
	assert.deepEqual(onlyZh, [], `keys only in zh: ${onlyZh.join(", ")}`);
	assert.deepEqual(onlyEn, [], `keys only in en: ${onlyEn.join(", ")}`);
});
