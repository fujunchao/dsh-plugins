// Three defects the writer hit while using the panel, all of them around a save:
//
//   1. every auto-save made the whole editor move up and down once;
//   2. a caret blinking on a blank line snapped back to the end of the paragraph above;
//   3. the first paragraph typed by hand never got the first-line indent, the second did.
//
// 1 was layout: the transient note was a row in the panel column, and the "保存/保存中…"
// label could re-wrap the toolbar. 2 was the save completion rebuilding the textarea from
// the kernel's read-back: a trailing empty line has no block there, so the value got
// shorter under the caret and the caret clamped to the previous paragraph. 3 was the
// indent being written by Enter only, which the first paragraph never passes through.
//
// These tests pin each fix: the pure rule for 3, the save completion for 2 (driven through
// the real EditorPane), and the two layout decisions for 1 as source assertions, because a
// unit test has no layout to measure.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

class StubComponent {
	constructor(props) {
		this.props = props ?? {};
		this.state = {};
	}
	setState(next) {
		this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) };
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

const { autoIndentParagraph, autoIndentTextarea, typingIndentPlan, caretAfterIndent } = bundle.exports.__test;
const { EditorPane } = bundle.exports.__panes;
const IND = "\u3000\u3000";
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
const source = fs.readFileSync(SRC, "utf8").replace(/\s+/g, " ");

// ---------------------------------------------------------------- 3. the first paragraph
test("autoIndentParagraph: the paragraph a document starts with is indented", () => {
	// What the writer does: open an empty document and type the first character.
	assert.deepEqual(autoIndentParagraph("", "第", 1, { indent: true }), { text: IND + "第", at: 0, caret: 3 });
	// The caret keeps its place relative to the text it typed, not to the line start.
	assert.deepEqual(autoIndentParagraph("", "第一段", 2, { indent: true }), { text: IND + "第一段", at: 0, caret: 4 });
});

test("autoIndentParagraph: a paragraph Enter already indented is left alone", () => {
	// Enter writes \n\n + indent when the switch is on, so the second paragraph is done.
	const before = IND + "第一段\n\n" + IND;
	assert.equal(autoIndentParagraph(before, before + "第", before.length + 1, { indent: true }), null);
});

test("autoIndentParagraph: typing inside an existing paragraph changes nothing", () => {
	// A paragraph that was already written has no indent; rewriting it under the writer's
	// caret would be an edit they never asked for ("补齐全篇" is the control for that).
	assert.equal(autoIndentParagraph("第一段", "第一段改", 4, { indent: true }), null);
	// Same for a paragraph that already carries one.
	assert.equal(autoIndentParagraph(IND + "第一段", IND + "第一段改", 6, { indent: true }), null);
});

test("autoIndentParagraph: a fresh blank line between paragraphs is a paragraph start", () => {
	const before = IND + "第一段\n\n";
	const after = before + "第二";
	assert.deepEqual(autoIndentParagraph(before, after, after.length, { indent: true }), {
		text: IND + "第一段\n\n" + IND + "第二",
		at: before.length,
		caret: after.length + IND.length,
	});
});

test("autoIndentParagraph: structural lines are never indented", () => {
	for (const line of ["# 标题", "## 小标题", "- 列表", "1. 有序", "> 引用", "- [ ] 任务", "| 表格 |"]) {
		assert.equal(autoIndentParagraph("", line, line.length, { indent: true }), null, line + " is structural");
	}
	// A fenced block, and the first line of one.
	assert.equal(autoIndentParagraph("", "```", 3, { indent: true }), null, "a fence opener stays put");
	assert.equal(autoIndentParagraph("```\n", "```\ncode", 8, { indent: true }), null, "code inside a fence stays put");
});

test("autoIndentParagraph: deliberate leading spaces win", () => {
	// Two spaces are how this editor nests; a writer who typed them meant it.
	assert.equal(autoIndentParagraph("", "  诗歌", 4, { indent: true }), null);
	assert.equal(autoIndentParagraph("", "\t代码", 3, { indent: true }), null);
});

test("autoIndentParagraph: a paragraph after a heading is a paragraph start", () => {
	// A heading is a one-line block, so the text typed under it opens a new block and is the
	// first line of its paragraph — the same case as the first paragraph of a document.
	const before = "# 标题\n";
	const after = before + "正文";
	assert.deepEqual(autoIndentParagraph(before, after, after.length, { indent: true }), {
		text: "# 标题\n" + IND + "正文",
		at: before.length,
		caret: after.length + IND.length,
	});
	// A soft break inside a paragraph (Enter with the switch off) continues the block and
	// must not grow an indent in the middle of it.
	assert.equal(autoIndentParagraph("第一段", "第一段\n第二", 6, { indent: true }), null);
});

test("autoIndentParagraph: nothing happens with the switch off or without a real edit", () => {
	assert.equal(autoIndentParagraph("", "第", 1, { indent: false }), null, "switch off");
	assert.equal(autoIndentParagraph("", "第", 1, {}), null, "no options");
	assert.equal(autoIndentParagraph("同一段", "同一段", 3, { indent: true }), null, "no edit");
	assert.equal(autoIndentParagraph("", "", 0, { indent: true }), null, "nothing typed");
	assert.equal(autoIndentParagraph("", "第", -1, { indent: true }), null, "caret outside the buffer");
	assert.equal(autoIndentParagraph("", "第", 99, { indent: true }), null, "caret outside the buffer");
});

test("autoIndentTextarea: writes the indent into the live buffer and moves the caret", () => {
	const textarea = {
		value: "第",
		selectionStart: 1,
		selectionEnd: 1,
		focused: false,
		focus() {
			this.focused = true;
		},
		setSelectionRange(start, end) {
			this.selectionStart = start;
			this.selectionEnd = end;
		},
	};
	assert.equal(autoIndentTextarea(textarea, "", { indent: true, kind: "insertText" }), IND.length, "returns what it inserted");
	assert.equal(textarea.value, IND + "第");
	assert.equal(textarea.selectionStart, 3, "the caret stays after the typed text");
});

test("autoIndentTextarea: leaves a selection, an indented line and the switch alone", () => {
	const selected = { value: "第", selectionStart: 0, selectionEnd: 1, focus() {}, setSelectionRange() {} };
	assert.equal(autoIndentTextarea(selected, "", { indent: true, kind: "insertText" }), 0, "a selection is not a paragraph start");
	assert.equal(selected.value, "第");

	const indented = { value: IND + "第", selectionStart: 3, selectionEnd: 3, focus() {}, setSelectionRange() {} };
	assert.equal(autoIndentTextarea(indented, IND, { indent: true, kind: "insertText" }), 0, "already indented");
	assert.equal(indented.value, IND + "第");

	const off = { value: "第", selectionStart: 1, selectionEnd: 1, focus() {}, setSelectionRange() {} };
	assert.equal(autoIndentTextarea(off, "", { indent: false, kind: "insertText" }), 0, "switch off");
	assert.equal(off.value, "第");
});

test("typingIndentPlan: only a real keystroke on a fresh paragraph gets the indent", () => {
	const fresh = ["", "第", 1];
	assert.ok(typingIndentPlan(...fresh, { indent: true, kind: "insertText" }), "plain typing counts");
	assert.ok(typingIndentPlan(...fresh, { indent: true, kind: "insertReplacementText" }), "an IME commit counts");
	// An input method owns the buffer while it composes; the indent waits for compositionend.
	assert.equal(typingIndentPlan(...fresh, { indent: true, kind: "insertCompositionText", composing: true }), null, "composing");
	// Content that was not typed is not a paragraph start either.
	for (const kind of ["insertFromPaste", "insertFromDrop", "historyUndo", "historyRedo", "deleteByCut"]) {
		assert.equal(typingIndentPlan(...fresh, { indent: true, kind }), null, kind + " is not typing");
	}
	assert.equal(typingIndentPlan(...fresh, { indent: false, kind: "insertText" }), null, "switch off");
});

test("caretAfterIndent: the switch keeps the caret where the writer left it", () => {
	const before = "第一段\n\n第二段";
	const after = IND + "第一段\n\n" + IND + "第二段";
	// Three characters into the second paragraph.
	const caret = before.indexOf("第二段") + 1;
	const mapped = caretAfterIndent(before, after, caret);
	assert.equal(after.slice(0, mapped), IND + "第一段\n\n" + IND + "第", "the caret stays beside the same character");
	assert.equal(caretAfterIndent(after, before, mapped), caret, "removing the indents maps back");
	// The top of the document never becomes the bottom: offset 0 stays on the first line.
	assert.equal(caretAfterIndent(before, after, 0), IND.length, "a caret before the indent lands after it");
	assert.equal(caretAfterIndent(after, before, IND.length), 0);
	// A heading keeps no indent, so its caret does not move at all.
	const withHeading = "# 标题\n\n正文";
	const indentedHeading = "# 标题\n\n" + IND + "正文";
	assert.equal(caretAfterIndent(withHeading, indentedHeading, 2), 2, "a line the rewrite leaves alone keeps its offset");
});

test("source: the indent is applied on the first typed character, IME included", () => {
	assert.equal(source.includes("autoIndentTextarea(ta, base, { indent: true, kind, composing })"), true, "the typing path calls the rule with the event's verdict");
	assert.equal(source.includes("beforeText = ta.value;"), true, "the pre-edit buffer is kept for the rule");
	assert.equal(source.includes('ta.addEventListener("compositionend", onCompositionEnd)'), true, "a Chinese commit is caught after the IME lets go");
	assert.equal(source.includes("const inserted = indentTyped(previous, kind, event.isComposing);"), true, "composition is never edited under the IME");
	assert.equal(source.includes("const delta = ta.value.length - previous.length - inserted;"), true, "the indent is not counted as typing");
	assert.equal(source.includes("if (indenting || suppressTypingCount) return 0;"), true, "our own write cannot re-enter the rule");
});

test("source: the indent switch and the sweep keep the caret", () => {
	const mapped = source.match(/caretAfterIndent\(value, indented, start\)/g) || [];
	assert.equal(mapped.length, 2, "the switch and 补齐全篇 both map the caret through the rewrite");
	// 「别把光标丢回文首」：这里只允许负例匹配「applyEdit 的返回值」，别把
	// editorSegments 给空文档造的那一段（start: 0, end: 0 是段的位置，不是光标）算进来。
	assert.equal(/return \{[^}]*start: 0, end: 0/.test(source), false, "neither throws the caret back to the top of the document");
});

// ---------------------------------------------------------------- 2. the save completion
/** Render one editor column and capture every setDoc payload it produces. */
function renderEditor({ text, savedText = "", client }) {
	const doc = { id: "doc1", title: "文档", text, savedText, blocks: [], loading: false, saving: false, error: null, savedAt: null, stamp: 0 };
	const state = { doc, updates: [], notice: null };
	const tree = EditorPane({
		t,
		client,
		doc,
		// Chained, like a real re-render: an update sees the previous update's state.
		setDoc: (next) => {
			state.doc = typeof next === "function" ? next(state.doc) : next;
			state.updates.push(state.doc);
		},
		onReload: () => {},
		onRename: () => {},
		onRemove: () => {},
		view: "split",
		setView: () => {},
		autoSave: false,
		setAutoSave: () => {},
		onNotice: (payload) => {
			state.notice = payload;
		},
		stale: false,
		onSaved: () => {},
		indentOn: true,
		onIndentChange: () => {},
		onQuote: () => {},
		onCaret: () => {},
		caretRequest: null,
	});
	const buttons = [];
	const textareas = [];
	const collect = (node) => {
		if (node === null || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const child of node) collect(child);
			return;
		}
		if (node.type === "button") buttons.push(node);
		if (node.type === "textarea") textareas.push(node);
		for (const child of node.children ?? []) collect(child);
	};
	collect(tree);
	return { state, doc, textarea: textareas[0], saveButton: buttons.find((node) => node.props["data-tone"] === "accent") };
}

/** Let a save's promise chain run to completion. */
async function settle() {
	for (let i = 0; i < 40; i++) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 5));
}

test("save: the buffer keeps the blank line the caret is on (the read-back is not adopted)", async () => {
	// The writer typed two paragraphs and pressed Enter at the end, so the caret blinks on a
	// trailing empty line. The kernel has no block for that line: the joined read-back is two
	// characters shorter, and adopting it is what snapped the caret up to the paragraph end.
	const buffer = IND + "第一段\n\n" + IND + "第二段\n\n";
	const kramdown = "第一段\n" + '{: id="b1"}\n\n' + IND + IND + "第二段\n" + '{: id="b2"}';
	let reads = 0;
	const client = {
		async api(path) {
			if (path === "/api/block/getBlockKramdown") return { kramdown: ++reads === 1 ? "" : kramdown };
			if (path === "/api/query/sql") return [{ content: IND + "第一段" }];
			return [{ doOperations: [{ action: "insert", id: "new-block" }] }];
		},
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { file: "test-backup.md" } }) });
	try {
		const editor = renderEditor({ text: buffer, savedText: "", client });
		assert.ok(editor.saveButton, "the save button is rendered");
		editor.saveButton.props.onClick();
		await settle();

		const final = editor.state.updates[editor.state.updates.length - 1];
		assert.equal(final.saving, false, "the save finished");
		assert.equal(final.error, null);
		assert.equal(final.text, buffer, "the buffer is untouched, trailing blank line included");
		assert.equal(final.savedText, buffer, "the text that was written is the buffer itself");
		assert.equal(final.savedText !== final.text, false, "so the document is not left dirty");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("save: typing while the save is in flight is not swallowed", async () => {
	// The block writes and the verification read take a while. If the writer keeps typing, the
	// buffer is newer than what was written: the newer text must survive the completion, and the
	// document must stay unsaved so the next auto-save picks it up.
	const buffer = "第一段";
	const kramdown = '第一段\n{: id="b1"}';
	let reads = 0;
	let typing = null;
	const client = {
		async api(path) {
			if (path === "/api/block/getBlockKramdown") {
				reads++;
				// The second read is the verification pass: type into the buffer right then.
				if (reads === 2 && typing) typing();
				return { kramdown: reads === 1 ? "" : kramdown };
			}
			if (path === "/api/query/sql") return [{ content: "第一段" }];
			return [{ doOperations: [{ action: "insert", id: "new-block" }] }];
		},
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { file: "test-backup.md" } }) });
	try {
		const editor = renderEditor({ text: buffer, savedText: "", client });
		assert.ok(editor.textarea, "the textarea is rendered");
		typing = () => editor.textarea.props.onChange({ target: { value: buffer + "续" } });
		editor.saveButton.props.onClick();
		await settle();

		const final = editor.state.updates[editor.state.updates.length - 1];
		assert.equal(final.text, buffer + "续", "the keystroke survives the save that was already running");
		assert.equal(final.savedText, buffer, "the save point names what was written, not the newer buffer");
		assert.notEqual(final.text, final.savedText, "so the document is still unsaved and the next save follows up");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("save: a manual save still confirms; the auto-save path passes the silent flag", async () => {
	const buffer = "正文";
	let reads = 0;
	const client = {
		async api(path) {
			if (path === "/api/block/getBlockKramdown") return { kramdown: ++reads === 1 ? "" : '正文\n{: id="b1"}' };
			if (path === "/api/query/sql") return [{ content: "正文" }];
			return [{ doOperations: [{ action: "insert", id: "new-block" }] }];
		},
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { file: "test-backup.md" } }) });
	try {
		const editor = renderEditor({ text: buffer, savedText: "", client });
		editor.saveButton.props.onClick();
		await settle();
		assert.ok(editor.state.notice, "a manual save tells the writer it happened");
		assert.equal(editor.state.notice.tone, "ok");
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(source.includes("const timer = setTimeout(() => void save(true), 2200);"), true, "auto-save is silent");
	assert.equal(source.includes("if (silent !== true) onNotice"), true, "only a manual save confirms");
});

test("source: the save never rebuilds the textarea value from the read-back", () => {
	assert.equal(source.includes("let text = current.text;"), false, "the old read-back branch is gone");
	assert.equal(source.includes("const joined ="), false, "the joined read-back is no longer built at all");
	// Opening and reloading a document still set both fields from the read; only the save
	// completion must bind savedText to the buffer it wrote and flip `saving` off.
	//
	// 这条锁的是**语义**，不是整个对象字面量：payload 里「保存哪一份块表」是实现细节，
	// 而且已经合法地变过一次（读回校验失败时保留上次已知块表，别把唯一的块级写基线清掉）。
	// 锁字面量会让每次这类修复都再红一遍，锁语义才是这条断言原本要保的性质。
	const completion = /setDoc\(\(prev\) => prev === null \? prev : \{ \.\.\.prev, savedText: current\.text, saving: false[^}]*\}/.exec(source);
	assert.ok(completion, "the save completion binds savedText to the buffer that was written, with saving off");
	assert.equal(/\btext:/.test(completion[0]), false, "and it does not put any read-back text back into the buffer");
	assert.match(completion[0], /blocks: /, "the completion still records a block table for the next save to diff against");
});

// ---------------------------------------------------------------- 1. the layout
test("source: the transient note floats instead of taking a row in the column", () => {
	assert.equal(source.includes(".sy-toast{position:absolute"), true, "the note is positioned out of the flow");
	assert.equal(source.includes(".sy-toast[data-tone]{background:var(--dsw-alias-bg-layer-1)}"), true, "and stays readable over the editor");
	assert.equal(source.includes('className: "sy-notice sy-toast"'), true, "the panel note is the floating one");
	// The layout-shifting form must not come back for the panel-level note.
	assert.equal(source.includes('notice ? h("div", { className: "sy-notice", "data-tone"'), false, "no notice row in the panel column");
});

test("source: the save label keeps its width so the toolbar cannot re-wrap", () => {
	assert.equal(source.includes('h("span", { className: "sy-btn-label" }, doc.saving ? t("saving") : t("save"))'), true, "the label sits in a fixed slot");
	assert.equal(source.includes(".sy-btn-label{display:inline-block;min-width:5em;text-align:center}"), true, "and the slot has a minimum width with headroom for a wider label");
});
