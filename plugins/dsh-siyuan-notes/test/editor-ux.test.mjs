// Editor UX pure functions, written against the frozen interface in task-2:
// continueOnEnter / changeIndent / hotkeyOf / wrapSelection / autoPairAction /
// outlineOf(line) / scrollSyncTop / countText. The assertions follow the spec,
// never the implementation: a red run means the bundle lacks the behaviour.
//
// Scope: only the pure helpers exported on __test are covered here. Component
// wiring — which rows a Tab selection touches (including a selection that ends
// exactly at a line start), native undo, scroll locking — lives in the component
// and is covered by the integration probes, not by this file.
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
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useLayoutEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (v) => ({ current: v }),
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
	useContext: () => undefined,
	useReducer: (reducer, initial) => [initial, () => {}],
	Fragment: "Fragment",
};
let bundle = null;
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } } };
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const T = bundle.exports.__test ?? {};
const INDENT_UNIT = "  ";
const FIRST_INDENT = "\u3000\u3000";

/** Frozen-name lookup: a missing export fails with the function's own name. */
function need(name) {
	const fn = T[name];
	assert.equal(typeof fn, "function", "exports.__test." + name + " must be exposed as a function (frozen interface)");
	return fn;
}

// ---------------------------------------------------------------- continueOnEnter
test("continueOnEnter: fenced code and blank lines continue nothing", () => {
	const continueOnEnter = need("continueOnEnter");
	assert.deepEqual(continueOnEnter("- 列表项", { indent: false, inFence: true }), { kind: "none", prefix: "", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("正文", { indent: true, inFence: true }), { kind: "none", prefix: "", exit: false, spaced: false });
	assert.equal(continueOnEnter("", { indent: false, inFence: false }).kind, "none", "blank line continues nothing");
	assert.equal(continueOnEnter("", { indent: true, inFence: false }).exit, false);
});

test("continueOnEnter: list and task markers, including leading whitespace", () => {
	const continueOnEnter = need("continueOnEnter");
	assert.deepEqual(continueOnEnter("- 列表项", { indent: false, inFence: false }), { kind: "list", prefix: "- ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("    - 缩进列表", { indent: false, inFence: false }), { kind: "list", prefix: "    - ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("  * 星号", { indent: false, inFence: false }), { kind: "list", prefix: "  * ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("+ 加号", { indent: false, inFence: false }), { kind: "list", prefix: "+ ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("- [x] 已完成", { indent: false, inFence: false }), { kind: "task", prefix: "- [ ] ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("  - [ ] 待办", { indent: false, inFence: false }), { kind: "task", prefix: "  - [ ] ", exit: false, spaced: false });
});

test("continueOnEnter: empty list and task items exit the list", () => {
	const continueOnEnter = need("continueOnEnter");
	const list = continueOnEnter("- ", { indent: false, inFence: false });
	assert.deepEqual({ kind: list.kind, prefix: list.prefix, exit: list.exit }, { kind: "list", prefix: "", exit: true });
	assert.equal(list.spaced, false);
	const task = continueOnEnter("- [ ] ", { indent: false, inFence: false });
	assert.deepEqual({ kind: task.kind, prefix: task.prefix, exit: task.exit }, { kind: "task", prefix: "", exit: true });
	const taskBox = continueOnEnter("- [x]", { indent: false, inFence: false });
	assert.deepEqual({ kind: taskBox.kind, prefix: taskBox.prefix, exit: taskBox.exit }, { kind: "task", prefix: "", exit: true });
});

test("continueOnEnter: ordered lists increment and keep the delimiter", () => {
	const continueOnEnter = need("continueOnEnter");
	assert.deepEqual(continueOnEnter("1. 第一项", { indent: false, inFence: false }), { kind: "ordered", prefix: "2. ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("9. 第九项", { indent: false, inFence: false }), { kind: "ordered", prefix: "10. ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("3) 括号分隔", { indent: false, inFence: false }), { kind: "ordered", prefix: "4) ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("  7. 缩进", { indent: false, inFence: false }), { kind: "ordered", prefix: "  8. ", exit: false, spaced: false });
	const empty = continueOnEnter("1. ", { indent: false, inFence: false });
	assert.deepEqual({ kind: empty.kind, prefix: empty.prefix, exit: empty.exit }, { kind: "ordered", prefix: "", exit: true });
});

test("continueOnEnter: quotes nest by continuing the quoted content", () => {
	const continueOnEnter = need("continueOnEnter");
	// The inner recursion uses indent:false: a quote is a structural line, so a
	// continuation must never write FIRST_INDENT into the quoted content.
	assert.deepEqual(continueOnEnter("> 引用文字", { indent: true, inFence: false }), { kind: "quote", prefix: "> ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("> - 条目", { indent: true, inFence: false }), { kind: "quote", prefix: "> - ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("> > 双层引用", { indent: true, inFence: false }), { kind: "quote", prefix: "> > ", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("> - ", { indent: true, inFence: false }), { kind: "quote", prefix: "> ", exit: false, spaced: false });
	const bare = continueOnEnter(">", { indent: true, inFence: false });
	assert.deepEqual({ kind: bare.kind, prefix: bare.prefix, exit: bare.exit }, { kind: "quote", prefix: "", exit: true });
	const bareSpace = continueOnEnter("> ", { indent: true, inFence: false });
	assert.deepEqual({ kind: bareSpace.kind, prefix: bareSpace.prefix, exit: bareSpace.exit }, { kind: "quote", prefix: "", exit: true });
});

test("continueOnEnter: headings stop, paragraphs take the first-line indent", () => {
	const continueOnEnter = need("continueOnEnter");
	assert.deepEqual(continueOnEnter("# 标题", { indent: false, inFence: false }), { kind: "heading", prefix: "", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("### 三级标题", { indent: true, inFence: false }), { kind: "heading", prefix: "", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("正文", { indent: true, inFence: false }), { kind: "paragraph", prefix: FIRST_INDENT, exit: false, spaced: true });
	assert.deepEqual(continueOnEnter("正文", { indent: false, inFence: false }), { kind: "paragraph", prefix: "", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("```js", { indent: true, inFence: false }), { kind: "none", prefix: "", exit: false, spaced: false });
	assert.deepEqual(continueOnEnter("| a | b |", { indent: true, inFence: false }), { kind: "none", prefix: "", exit: false, spaced: false });
});

// ---------------------------------------------------------------- changeIndent
// Picking from/to from the textarea selection is the component's job: these
// tests hand the row range in directly, so a selection whose end sits exactly at
// a line start is pinned by the integration probes, not here.
test("changeIndent: +1 indents every non-empty line inside the range", () => {
	const changeIndent = need("changeIndent");
	const rows = ["第一行", "", "第二行", "第三行"];
	const before = rows.slice();
	const out = changeIndent(rows, 0, 2, 1);
	assert.deepEqual(out.rows, [INDENT_UNIT + "第一行", "", INDENT_UNIT + "第二行", "第三行"], "line 3 is outside the range");
	assert.equal(out.from, 0);
	assert.equal(out.to, 2);
	assert.notEqual(out.rows, rows, "must return a new array");
	assert.deepEqual(rows, before, "the input array must not be mutated");
});

test("changeIndent: single-line range and inner ranges leave neighbours alone", () => {
	const changeIndent = need("changeIndent");
	assert.deepEqual(changeIndent(["a", "b", "c"], 1, 1, 1).rows, ["a", INDENT_UNIT + "b", "c"], "from == to indents only that line");
	assert.deepEqual(changeIndent(["a", "b", "c", "d"], 1, 2, 1).rows, ["a", INDENT_UNIT + "b", INDENT_UNIT + "c", "d"]);
	assert.deepEqual(changeIndent(["a", "b"], 0, 1, 1).rows, [INDENT_UNIT + "a", INDENT_UNIT + "b"]);
});

test("changeIndent: -1 strips one unit, falling back to one literal leading tab", () => {
	const changeIndent = need("changeIndent");
	assert.deepEqual(changeIndent([INDENT_UNIT + "a", "\tb", "", "d"], 0, 3, -1).rows, ["a", "b", "", "d"], "blank lines are untouched");
	assert.deepEqual(changeIndent([INDENT_UNIT + INDENT_UNIT + "a"], 0, 0, -1).rows, [INDENT_UNIT + "a"], "one level at a time");
	assert.deepEqual(changeIndent([INDENT_UNIT + "a", INDENT_UNIT + "b"], 1, 1, -1).rows, [INDENT_UNIT + "a", "b"]);
	const rows = [INDENT_UNIT + "x", "y"];
	const before = rows.slice();
	const out = changeIndent(rows, 0, 1, -1);
	assert.notEqual(out.rows, rows, "must return a new array");
	assert.deepEqual(rows, before, "the input array must not be mutated");
	assert.deepEqual(out.rows, ["x", "y"]);
});

test("changeIndent: delta 0 is a no-op and whitespace-only rows stay bare", () => {
	const changeIndent = need("changeIndent");
	assert.deepEqual(changeIndent(["  a"], 0, 0, 0).rows, ["  a"], "delta 0 must not outdent");
	assert.deepEqual(changeIndent(["   ", "x"], 0, 1, 1).rows, ["   ", INDENT_UNIT + "x"], "a whitespace-only row is not indented, so no trailing spaces are written");
	assert.deepEqual(changeIndent(["  a"], 0, 0, -1).rows, ["a"], "delta -1 still outdents");
	assert.deepEqual(changeIndent(["  a"], 0, 0, 1).rows, ["    a"], "delta +1 still indents");
});

// ---------------------------------------------------------------- hotkeyOf
test("hotkeyOf: modifier table covers formatting, save, view and find", () => {
	const hotkeyOf = need("hotkeyOf");
	assert.equal(hotkeyOf({ key: "b", ctrlKey: true }), "bold");
	assert.equal(hotkeyOf({ key: "B", metaKey: true }), "bold", "key is case-insensitive");
	assert.equal(hotkeyOf({ key: "i", ctrlKey: true }), "italic");
	assert.equal(hotkeyOf({ key: "u", metaKey: true }), "underline");
	assert.equal(hotkeyOf({ key: "s", ctrlKey: true, shiftKey: true }), "strike");
	assert.equal(hotkeyOf({ key: "S", ctrlKey: true, shiftKey: true }), "strike");
	assert.equal(hotkeyOf({ key: "c", metaKey: true, shiftKey: true }), "code");
	assert.equal(hotkeyOf({ key: "h", ctrlKey: true, shiftKey: true }), "highlight");
	assert.equal(hotkeyOf({ key: "s", ctrlKey: true }), "save");
	assert.equal(hotkeyOf({ key: "S", metaKey: true }), "save");
	assert.equal(hotkeyOf({ key: "e", ctrlKey: true }), "toggleView");
	assert.equal(hotkeyOf({ key: "f", metaKey: true }), "find");
});

test("hotkeyOf: Tab and Shift+Tab resolve to the indent/outdent ids, alt and unlisted keys are null", () => {
	const hotkeyOf = need("hotkeyOf");
	assert.equal(hotkeyOf({ key: "Tab" }), "indent");
	assert.equal(hotkeyOf({ key: "Tab", shiftKey: true }), "outdent");
	assert.equal(hotkeyOf({ key: "TAB", shiftKey: true }), "outdent", "Tab is case-insensitive");
	assert.equal(hotkeyOf({ key: "tab" }), "indent");
	assert.equal(hotkeyOf({ key: "Tab", altKey: true }), null);
	assert.equal(hotkeyOf({ key: "b", ctrlKey: true, altKey: true }), null);
	assert.equal(hotkeyOf({ key: "s", ctrlKey: true, altKey: true }), null);
	assert.equal(hotkeyOf({ key: "b" }), null, "no modifier means no shortcut");
	assert.equal(hotkeyOf({ key: "s" }), null);
	assert.equal(hotkeyOf({ key: "z", ctrlKey: true }), null);
});

test("hotkeyOf: alt bindings come from the table and fall back to the physical key code", () => {
	const hotkeyOf = need("hotkeyOf");
	assert.equal(hotkeyOf({ key: "d", altKey: true }), "highlight");
	// macOS Option+D reports key "∂" (a dead key), so the physical code decides.
	assert.equal(hotkeyOf({ key: "∂", altKey: true, code: "KeyD" }), "highlight");
	assert.equal(hotkeyOf({ key: "b", altKey: true }), null, "alt only matches keys registered in the table");
	assert.equal(hotkeyOf({ key: "∂", altKey: true, code: "KeyB" }), null, "an unregistered physical key stays inert");
	assert.equal(hotkeyOf({ key: "∂", altKey: true, code: "KeyD", shiftKey: true }), null);
});

// ---------------------------------------------------------------- wrapSelection
test("wrapSelection: an empty selection inserts the placeholder and selects it", () => {
	const wrapSelection = need("wrapSelection");
	assert.deepEqual(wrapSelection("abc", 1, 1, "**", "**", "加粗"), { text: "a**加粗**bc", start: 3, end: 5 });
	assert.deepEqual(wrapSelection("中文", 2, 2, "《", "》", ""), { text: "中文《》", start: 3, end: 3 });
	assert.deepEqual(wrapSelection("", 0, 0, "**", "**", "粗"), { text: "**粗**", start: 2, end: 3 });
});

test("wrapSelection: wrapping keeps the selection, an already wrapped one unwraps", () => {
	const wrapSelection = need("wrapSelection");
	assert.deepEqual(wrapSelection("a**b**c", 1, 6, "**", "**", ""), { text: "abc", start: 1, end: 2 }, "unwrap and keep the inner text selected");
	assert.deepEqual(wrapSelection("【重点】内容", 0, 4, "【", "】", ""), { text: "重点内容", start: 0, end: 2 });
	assert.deepEqual(wrapSelection("hello world", 0, 5, "**", "**", ""), { text: "**hello** world", start: 2, end: 7 });
	assert.deepEqual(wrapSelection("abc", 0, 1, "“", "”", ""), { text: "“a”bc", start: 1, end: 2 });
});

// ---------------------------------------------------------------- autoPairAction
test("autoPairAction: characters outside PAIRS are ignored", () => {
	const autoPairAction = need("autoPairAction");
	assert.equal(autoPairAction("abc", 1, 1, "x"), null);
	assert.equal(autoPairAction("abc", 1, 1, "。"), null);
	assert.equal(autoPairAction("abc", 0, 0, "Z"), null);
});

test("autoPairAction: a selection is wrapped, emphasis uses just the typed char", () => {
	const autoPairAction = need("autoPairAction");
	assert.deepEqual(autoPairAction("abc", 0, 3, "("), { text: "(abc)", start: 1, end: 4 });
	assert.deepEqual(autoPairAction("重点", 0, 2, "【"), { text: "【重点】", start: 1, end: 3 });
	assert.deepEqual(autoPairAction("hello", 0, 5, "*"), { text: "*hello*", start: 1, end: 6 });
	assert.deepEqual(autoPairAction("abc", 0, 3, "_"), { text: "_abc_", start: 1, end: 4 });
	assert.deepEqual(autoPairAction("重点", 0, 2, "`"), { text: "`重点`", start: 1, end: 3 });
	assert.deepEqual(autoPairAction("abc", 0, 3, "~"), { text: "~abc~", start: 1, end: 4 });
});

test("autoPairAction: an existing closer is skipped, otherwise the pair is inserted", () => {
	const autoPairAction = need("autoPairAction");
	assert.deepEqual(autoPairAction("()", 0, 0, "("), { text: "()", start: 1, end: 1 });
	assert.deepEqual(autoPairAction("【】", 0, 0, "【"), { text: "【】", start: 1, end: 1 });
	assert.deepEqual(autoPairAction("“”", 0, 0, "\u201c"), { text: "“”", start: 1, end: 1 });
	assert.deepEqual(autoPairAction("\"\"", 0, 0, "\""), { text: "\"\"", start: 1, end: 1 }, "self-pairing quotes skip too");
	assert.deepEqual(autoPairAction("ab", 1, 1, "("), { text: "a()b", start: 2, end: 2 });
	assert.deepEqual(autoPairAction("。", 0, 0, "（"), { text: "（）。", start: 1, end: 1 });
	assert.deepEqual(autoPairAction("", 0, 0, "*"), { text: "**", start: 1, end: 1 });
});

// ---------------------------------------------------------------- outlineOf line
test("outlineOf: headings carry a 0-based line and keep level and text", () => {
	const outlineOf = need("outlineOf");
	assert.deepEqual(outlineOf("# 头部\n正文\n## 子标题\n\n### 深"), [
		{ level: 1, text: "头部", line: 0 },
		{ level: 2, text: "子标题", line: 2 },
		{ level: 3, text: "深", line: 4 },
	]);
	assert.deepEqual(outlineOf(""), []);
	assert.deepEqual(outlineOf("普通段落\n- 列表"), []);
});

test("outlineOf: fenced blocks are skipped without shifting line numbers", () => {
	const outlineOf = need("outlineOf");
	assert.deepEqual(outlineOf("```\n# 不在\n```\n# 真"), [{ level: 1, text: "真", line: 3 }]);
	assert.deepEqual(outlineOf("\n\n# a\n###  多余  "), [
		{ level: 1, text: "a", line: 2 },
		{ level: 3, text: "多余", line: 3 },
	]);
});

// ---------------------------------------------------------------- scrollSyncTop
test("scrollSyncTop: proportional mapping clamped to the scrollable range", () => {
	const scrollSyncTop = need("scrollSyncTop");
	assert.equal(scrollSyncTop(0, 1000, 200, 2000, 500), 0);
	assert.equal(scrollSyncTop(400, 1000, 200, 2000, 500), 750);
	assert.equal(scrollSyncTop(800, 1000, 200, 2000, 500), 1500);
	assert.equal(scrollSyncTop(2000, 1000, 200, 2000, 500), 1500, "overscroll clamps to the bottom");
	assert.equal(scrollSyncTop(-50, 1000, 200, 2000, 500), 0, "negative offset clamps to the top");
	assert.equal(scrollSyncTop(400, 500, 500, 2000, 500), 1500, "a non-scrollable source maps to the bottom");
	assert.equal(scrollSyncTop(400, 1000, 200, 300, 300), 0, "a non-scrollable target stays at 0");
	assert.equal(scrollSyncTop(0, 0, 0, 0, 0), 0);
});

// ---------------------------------------------------------------- countText
test("countText: whitespace-stripped chars, CJK count and ASCII word runs", () => {
	const countText = need("countText");
	assert.deepEqual(countText("你好世界"), { chars: 4, chinese: 4, words: 0 });
	assert.deepEqual(countText("Hello world"), { chars: 10, chinese: 0, words: 2 });
	assert.deepEqual(countText("中文 English 混排，全角。"), { chars: 15, chinese: 6, words: 1 });
	assert.deepEqual(countText("a b\tc\nd"), { chars: 4, chinese: 0, words: 4 });
	assert.deepEqual(countText("　　"), { chars: 0, chinese: 0, words: 0 }, "U+3000 is whitespace");
	assert.deepEqual(countText(""), { chars: 0, chinese: 0, words: 0 });
	assert.deepEqual(countText("v2 版本"), { chars: 4, chinese: 2, words: 1 });
});

// ---------------------------------------------------------------- replaceRange
// The DOM is the source of truth, not the command: `execCommand("insertText")` is
// deprecated, absent in some embeddings, and may report success without changing
// anything. A silent no-op there is exactly "the button did not work", so these
// cases use a fake textarea and a stubbed document rather than a browser.
function fakeTextarea(value) {
	return {
		value,
		selectionStart: 0,
		selectionEnd: 0,
		focused: false,
		focus() {
			this.focused = true;
		},
		setSelectionRange(start, end) {
			this.selectionStart = start;
			this.selectionEnd = end;
		},
	};
}

function withDocument(execCommand, body) {
	const previous = globalThis.document;
	globalThis.document = { execCommand };
	try {
		return body();
	} finally {
		if (previous === undefined) delete globalThis.document;
		else globalThis.document = previous;
	}
}

// The native undo stack is browser state and cannot be observed from here;
// `applied` is the proxy: true only when the command really put the text in the
// DOM. Undo itself is an integration concern.
test("replaceRange: a command that really edits the DOM is applied and trusted", () => {
	const replaceRange = need("replaceRange");
	const ta = fakeTextarea("abc");
	// The browser applies insertText over the current selection.
	const browser = (_name, _ui, text) => {
		ta.value = ta.value.slice(0, ta.selectionStart) + text + ta.value.slice(ta.selectionEnd);
		return true;
	};
	const result = withDocument(browser, () => replaceRange(ta, 1, 2, "XY", 3, 3));
	assert.deepEqual(result, { text: "aXYc", applied: true });
	assert.equal(ta.value, "aXYc", "the DOM holds the replacement");
	assert.equal(ta.selectionStart, 3, "the caret lands where the caller asked");
	assert.equal(ta.focused, true, "the textarea is focused before editing");
});

test("replaceRange: a command that claims success but changes nothing still lands", () => {
	const replaceRange = need("replaceRange");
	const ta = fakeTextarea("abc");
	// This is the failure mode that looks like a dead toolbar button.
	const result = withDocument(() => true, () => replaceRange(ta, 0, 0, ">>", 2, 2));
	assert.deepEqual(result, { text: ">>abc", applied: false }, "text is corrected, undo is not claimed");
	assert.equal(ta.value, ">>abc");
	assert.equal(ta.selectionStart, 2);
});

test("replaceRange: a wrong command result is replaced from the original text, exactly once", () => {
	const replaceRange = need("replaceRange");
	const ta = fakeTextarea("abc");
	const result = withDocument(
		() => {
			ta.value = "garbage";
			return true;
		},
		() => replaceRange(ta, 0, 1, "Z", 1, 1),
	);
	assert.deepEqual(result, { text: "Zbc", applied: false });
	assert.equal(ta.value, "Zbc", "the assignment replaces the wrong result exactly once");
});

test("replaceRange: no document, or a throwing command, falls back to assignment", () => {
	const replaceRange = need("replaceRange");
	const absent = fakeTextarea("abc");
	assert.deepEqual(replaceRange(absent, 3, 3, "!"), { text: "abc!", applied: false }, "no document at all");
	assert.equal(absent.focused, true);

	const throwing = fakeTextarea("abc");
	const result = withDocument(
		() => {
			throw new Error("execCommand is not a function here");
		},
		() => replaceRange(throwing, 0, 0, "x"),
	);
	assert.deepEqual(result, { text: "xabc", applied: false }, "a throw must not escape");
	assert.equal(throwing.value, "xabc");
});

test("replaceRange: an edit that changes nothing never claims undo coverage", () => {
	const replaceRange = need("replaceRange");
	const ta = fakeTextarea("abc");
	// `applied` is the only "undo still covers this edit" signal, and nothing
	// changed, so it has to stay false. No caller reaches this today (applyEdit
	// returns early when the text is unchanged); this pins the guard itself.
	const result = withDocument(() => true, () => replaceRange(ta, 0, 0, "", 0, 0));
	assert.deepEqual(result, { text: "abc", applied: false }, "wanted === before, so nothing was applied");
});

test("replaceRange: the caller's selected span survives, not just a collapsed caret", () => {
	const replaceRange = need("replaceRange");
	const ta = fakeTextarea("abc");
	// Wrapping a selection asks for the inserted placeholder to stay selected, so
	// selStart !== selEnd is the normal case, not an edge.
	const result = withDocument(() => true, () => replaceRange(ta, 1, 1, "**x**", 3, 4));
	assert.equal(result.text, "a**x**bc");
	assert.equal(ta.selectionStart, 3, "the inserted placeholder stays selected (start)");
	assert.equal(ta.selectionEnd, 4, "the inserted placeholder stays selected (end)");
});

test("replaceRange: with no textarea it returns no document text, never the fragment", () => {
	const replaceRange = need("replaceRange");
	// `null` is the only value a caller cannot mistake for a document, so every
	// insert shape has to map to it — including "" (which `== null` would let
	// through and blank the buffer). No production caller reaches this today
	// (applyEdit returns early without a textarea); this pins the sentinel.
	for (const insert of ["fragment", "", "**", "两行\n文本"]) {
		assert.deepEqual(replaceRange(null, 0, 0, insert), { text: null, applied: false }, "inserted " + JSON.stringify(insert));
	}
});

test("preview path: what applyEdit writes back is always string text", () => {
	const wrapSelection = need("wrapSelection");
	const autoPairAction = need("autoPairAction");
	// Preview mode has no textarea, so applyEdit does `update({ text: result.text })`
	// with no null check: a null/undefined from a mutator would blank the document.
	for (const value of ["", "abc", "中文正文"]) {
		for (const [start, end] of [[0, 0], [value.length, value.length]]) {
			const wrapped = wrapSelection(value, start, end, "**", "**", "粗");
			assert.equal(typeof wrapped.text, "string", "wrapSelection on " + JSON.stringify(value));
			const paired = autoPairAction(value, start, end, "(");
			if (paired) assert.equal(typeof paired.text, "string", "autoPairAction on " + JSON.stringify(value));
		}
	}
});

// ---------------------------------------------------------------- bareParagraphLines
// The indent button decides what a click means from this count, so it has to agree
// with the sweep it drives. Drift between the two would show up as "the button says
// 0 paragraphs to indent but the document changes" (or the reverse).
test("bareParagraphLines: agrees with indentParagraphs line for line", () => {
	const bareParagraphLines = need("bareParagraphLines");
	const indentParagraphs = need("indentParagraphs");
	const IND = "\u3000\u3000";
	const samples = [
		["正文一", "", "正文二", "", "# 标题", "", "- 列表项", "", "```", "代码", "```", "", "末段"].join("\n"),
		[IND + "已缩进", "", "未缩进", "", "> 引用", "", "| a | b |", "", "1. 有序"].join("\n"),
		["段落A", "段落A的续行", "", "段落B"].join("\n"),
		["", "", ""].join("\n"),
		// A blank line after the fence opener is what exposes a missing fence skip:
		// the previous-line rule no longer shields the fenced line.
		["```", "", "代码", "```", "", "正文"].join("\n"),
		// A paragraph butted against a heading/list line is the same "continuation"
		// shape as sample 3, through a structural previous line instead of text.
		["# 标题", "正文", "", "- 列表", "正文二"].join("\n"),
		"",
	];
	for (const text of samples) {
		const rows = text.split("\n");
		const bare = bareParagraphLines(text);
		const swept = indentParagraphs(text).split("\n");
		const changed = [];
		for (let i = 0; i < rows.length; i++) if (rows[i] !== swept[i]) changed.push(i);
		assert.deepEqual(changed, bare, "the sweep touches exactly the bare paragraph lines");
		for (const index of bare) assert.equal(swept[index], IND + rows[index], `line ${index} gains exactly one indent`);
	}
});

test("bareParagraphLines: structural, already-indented and empty documents have nothing to do", () => {
	const bareParagraphLines = need("bareParagraphLines");
	assert.deepEqual(bareParagraphLines("# 标题\n\n- 列表\n\n> 引用"), []);
	assert.deepEqual(bareParagraphLines("　　已经缩进了"), []);
	assert.equal(bareParagraphLines("　　一\n\n二\n\n　　三").length, 1, "only the middle paragraph is bare");
	assert.deepEqual(bareParagraphLines(""), [], "an empty document has nothing to do");
});
