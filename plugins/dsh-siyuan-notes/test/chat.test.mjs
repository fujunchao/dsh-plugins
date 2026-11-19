// Chat surfaces: the panel offers the conversation as a closable right column or
// as a floating window that folds to an edge tab. The shape of each state is pure,
// so it is asserted here without a DOM.
import fs from "node:fs";
import assert from "node:assert/strict";

const SRC = new URL("../lib/client.js", import.meta.url);

class StubComponent {
	constructor(props) {
		this.props = props ?? {};
		this.state = this.state ?? {};
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
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (value) => ({ current: value }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

let bundle = null;
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } } };
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { buildChatSurfaces } = bundle.exports.__panes;
assert.equal(typeof buildChatSurfaces, "function", "the builder is exported");

const dict = {
	chatHistory: "历史对话",
	chatNew: "新开对话",
	chatNewHint: "新开对话，并在这一栏里跟它聊",
	chatNewFailed: "新开对话失败",
	chatHistoryEmpty: "还没有别的对话",
	chatCurrent: "当前",
	chatRunning: "正在回复",
	chatResize: "拖动调整大小",
	chat: "对话",
	chatClose: "关闭对话",
	chatCollapse: "收起到边缘",
	chatExpand: "展开对话",
};
const t = (key) => dict[key] ?? key;

const BODY = { type: "conversation", props: {}, children: [] };
const noop = () => {};

/** Every element with a className, depth first. */
function findAll(node, className) {
	const found = [];
	const walk = (current) => {
		if (current === null || current === undefined || typeof current !== "object") return;
		if (Array.isArray(current)) {
			current.forEach(walk);
			return;
		}
		if (current.props && current.props.className === className) found.push(current);
		(current.children ?? []).forEach(walk);
		if (current.props) walk(current.props.children);
	};
	walk(node);
	return found;
}

/** Depth-first search for an element with a className. */
function find(node, className) {
	if (node === null || node === undefined || typeof node !== "object") return undefined;
	if (Array.isArray(node)) {
		for (const child of node) {
			const hit = find(child, className);
			if (hit) return hit;
		}
		return undefined;
	}
	if (node.props && node.props.className === className) return node;
	for (const child of node.children ?? []) {
		const hit = find(child, className);
		if (hit) return hit;
	}
	const nested = find(node.props && node.props.children, className);
	return nested;
}

/** Default interaction wiring for a surface. */
function handlers(overrides = {}) {
	return {
		onClose: () => {},
		onCollapse: () => {},
		onExpand: () => {},
		headProps: {},
		resizeProps: {},
		style: undefined,
		containerRef: undefined,
		onHistory: () => {},
		onNew: () => {},
		historyNode: null,
		...overrides,
	};
}

// ---------------------------------------------------------------- off
{
	const surfaces = buildChatSurfaces("off", false, BODY, t, handlers());
	assert.equal(surfaces.sideChat, null);
	assert.equal(surfaces.floatChat, null);
	assert.equal(surfaces.floatTab, null);
}

// ---------------------------------------------------------------- side
{
	const surfaces = buildChatSurfaces("side", false, BODY, t, handlers());
	assert.equal(surfaces.sideChat.type, "aside");
	assert.equal(surfaces.sideChat.props.className, "sy-sidechat");
	assert.ok(find(surfaces.sideChat, "sy-sidechat-body"), "the body host exists");
	assert.ok(String(JSON.stringify(surfaces.sideChat)).includes("conversation"), "the conversation element is mounted inside");
	assert.equal(surfaces.floatChat, null, "only one surface at a time");
	assert.equal(surfaces.floatTab, null);

	let closed = 0;
	const withClose = buildChatSurfaces("side", false, BODY, t, handlers({ onClose: () => closed++ }));
	const buttons = findAll(withClose.sideChat, "sy-iconbtn");
	assert.equal(buttons.length, 3, "history, new and close sit in the header");
	const byTitle = (needle) => buttons.find((button) => String(button.props.title || "").includes(needle));
	assert.equal(typeof byTitle("关闭对话").props.onClick, "function", "the close control is wired");
	byTitle("关闭对话").props.onClick();
	assert.equal(closed, 1, "the close control dismisses the surface");
}

// ---------------------------------------------------------------- float (expanded)
{
	const surfaces = buildChatSurfaces("float", false, BODY, t, handlers());
	assert.equal(surfaces.floatChat.props.className, "sy-float");
	assert.equal(surfaces.floatChat.props["data-collapsed"], undefined, "expanded by default");
	assert.ok(find(surfaces.floatChat, "sy-float-body"));
	assert.ok(find(surfaces.floatChat, "sy-float-resize"), "the resize handle exists");
	assert.equal(surfaces.floatTab, null, "no edge tab while expanded");
	assert.equal(surfaces.sideChat, null);
}

// ---------------------------------------------------------------- float (collapsed)
{
	const surfaces = buildChatSurfaces("float", true, BODY, t, handlers());
	assert.equal(surfaces.floatChat.props["data-collapsed"], true, "folded state is marked");
	assert.equal(surfaces.floatTab.props.className, "sy-float-tab", "the edge tab appears");
	assert.equal(surfaces.floatTab.children[0], "对话", "the tab is labelled");

	let expanded = 0;
	const withTab = buildChatSurfaces("float", true, BODY, t, handlers({ onExpand: () => expanded++ }));
	withTab.floatTab.props.onClick();
	assert.equal(expanded, 1, "the edge tab expands the window");
}

// ---------------------------------------------------------------- dragging and resizing
{
	// The floating window is only useful if it can be moved out of the way: the header
	// drives a move gesture, the corner drives a resize gesture. Both must reach the DOM.
	const moves = [];
	const headProps = {
		onPointerDown: (event) => moves.push(["down", event.button]),
		onPointerMove: () => moves.push(["move"]),
		onPointerUp: () => moves.push(["up"]),
	};
	const resizeProps = {
		onPointerDown: () => moves.push(["resize-down"]),
		onPointerMove: () => moves.push(["resize-move"]),
		onPointerUp: () => moves.push(["resize-up"]),
	};
	const surfaces = buildChatSurfaces("float", false, BODY, t, handlers({ headProps, resizeProps }));

	const head = find(surfaces.floatChat, "sy-float-head");
	assert.equal(typeof head.props.onPointerDown, "function", "the header starts a drag");
	head.props.onPointerDown({ button: 0 });
	head.props.onPointerMove({});
	head.props.onPointerUp({});
	assert.deepEqual(moves, [["down", 0], ["move"], ["up"]], "the header is the drag handle");

	const handle = find(surfaces.floatChat, "sy-float-resize");
	assert.equal(typeof handle.props.onPointerDown, "function", "the corner starts a resize");
	handle.props.onPointerDown({});
	handle.props.onPointerMove({});
	handle.props.onPointerUp({});
	assert.deepEqual(moves.slice(3), [["resize-down"], ["resize-move"], ["resize-up"]]);
}

// ---------------------------------------------------------------- positioned box
{
	const style = { left: "120px", top: "48px", right: "auto", bottom: "auto", width: "420px", height: "380px" };
	const surfaces = buildChatSurfaces("float", false, BODY, t, handlers({ style }));
	assert.deepEqual(surfaces.floatChat.props.style, style, "a dragged window keeps its pixel box");
	// Without a drag it falls back to the CSS anchor (no inline box).
	const anchored = buildChatSurfaces("float", false, BODY, t, handlers());
	assert.equal(anchored.floatChat.props.style, undefined);
}

// ---------------------------------------------------------------- fallback body
{
	const fallback = { type: "div", props: { className: "sy-chat-fallback" }, children: ["对话暂不可用"] };
	const surfaces = buildChatSurfaces("side", false, fallback, t, handlers());
	assert.ok(find(surfaces.sideChat, "sy-chat-fallback"), "the notice takes the body slot");
}

// ---------------------------------------------------------------- quoting a rendered selection
// The panel shows raw markdown beside a rendered preview, and people select in
// whichever one they are reading. Quoting the preview means matching rendered prose
// back to a source line, because the markup is gone from what they selected.
{
	const { locateQuote } = bundle.exports.__test;
	assert.equal(typeof locateQuote, "function", "locateQuote is exported");

	const doc = [
		"# 第一章 红鞋的少女",
		"",
		"　　走在赶往宿舍的路上，杨曦的思绪被一个困扰了他整个下午的问题所占据。",
		"",
		'　　"晚上到底是吃米饭呢？还是吃面条呢？"',
		"",
		"　　这是一个一旦上班就会自动开始思考的问题。",
	].join("\n");

	// The rendered text has no markdown markers and no indent characters.
	assert.equal(locateQuote(doc, "这是一个一旦上班就会自动开始思考的问题。"), 7, "finds the paragraph the reader selected");
	assert.equal(locateQuote(doc, "走在赶往宿舍的路上，杨曦的思绪被一个困扰了他整个下午的问题所占据。"), 3, "matches through the stripped indent");
	assert.equal(locateQuote(doc, "晚上到底是吃米饭呢？还是吃面条呢？"), 5, "matches a quoted line inside the prose");

	// Multi-line selections anchor on the first substantial line.
	assert.equal(locateQuote(doc, "\n第一行很短\n这是一个一旦上班就会自动开始思考的问题。\n"), 7);

	// Nothing recognisable falls back to line 1 rather than throwing.
	assert.equal(locateQuote(doc, "完全不属于这篇文档的文字"), 1);
	assert.equal(locateQuote(doc, ""), 1);
	assert.equal(locateQuote("", "任意"), 1);
	assert.equal(locateQuote(doc, "短"), 1, "too short to locate reliably");
}

// ---------------------------------------------------------------- selection action bar placement
// The bar floats over the selection the way the app's own selection menu does. A
// selection near an edge must not push it off screen, and a keyboard selection has
// no pointer coordinates at all.
{
	const { selectionBarPosition } = bundle.exports.__test;
	assert.equal(typeof selectionBarPosition, "function", "placement is a pure helper");

	// A pointer selection floats just above the pointer.
	assert.deepEqual(selectionBarPosition({ x: 400, y: 300 }, 1200, null), { left: "295px", top: "256px" });

	// Near the left edge it stops at the margin instead of hanging outside.
	assert.equal(selectionBarPosition({ x: 20, y: 300 }, 1200, null).left, "8px");
	// Near the top it stays visible below the top edge.
	assert.equal(selectionBarPosition({ x: 400, y: 5 }, 1200, null).top, "8px");
	// Near the right edge it stops inside the viewport.
	assert.equal(selectionBarPosition({ x: 1190, y: 300 }, 1200, null).left, "982px");

	// No coordinates (keyboard selection): park over the top-right of the pane.
	const anchorRect = { top: 100, right: 800, bottom: 600, left: 0 };
	assert.deepEqual(selectionBarPosition(null, 1200, anchorRect), { left: "578px", top: "108px" });
	// Without a pane rect either, fall back to a safe corner.
	assert.deepEqual(selectionBarPosition(null, 1200, null), { left: "12px", top: "12px" });
	assert.deepEqual(selectionBarPosition(undefined, 0, undefined), { left: "12px", top: "12px" });
}

// ---------------------------------------------------------------- history menu rows
// The side chat gains a conversation switcher. Rows come from the session store, so
// the model must tolerate partial summaries, subagent conversations and long lists.
{
	const { sessionHistoryItems } = bundle.exports.__panes;
	assert.equal(typeof sessionHistoryItems, "function", "the row model is exported");

	const byId = {
		a: { id: "a", displayTitle: "写小说", running: true },
		b: { id: "b", title: "改大纲" },
		c: { id: "c" },
		d: { id: "d", displayTitle: "子代理任务", parentId: "a" },
	};
	const rows = sessionHistoryItems(["a", "b", "c", "d"], byId, "b", t, 30);
	assert.deepEqual(
		rows.map((row) => row.id),
		["a", "b", "c"],
		"subagent conversations are not offered as conversations",
	);
	assert.equal(rows[0].label, "写小说", "displayTitle wins");
	assert.equal(rows[0].running, true, "running conversations are marked");
	assert.equal(rows[1].label, "改大纲", "title is the fallback label");
	assert.equal(rows[1].current, true, "only the shown conversation is current");
	assert.equal(rows[2].label, "c", "a summary built before its title arrives falls back to the id");

	// Defensive: empty and malformed stores must not throw.
	assert.deepEqual(sessionHistoryItems(undefined, undefined, "a", t, 30), []);
	assert.deepEqual(sessionHistoryItems([], {}, "a", t, 30), []);
	// A non-string key is skipped; the valid id beside it still yields a row.
	assert.deepEqual(
		sessionHistoryItems([123, "a"], undefined, "a", t, 30).map((row) => row.id),
		["a"],
	);
	assert.deepEqual(sessionHistoryItems([], {}, undefined, t, 30), []);

	// A whitespace-only title must not produce a blank row.
	const blank = sessionHistoryItems(["x"], { x: { displayTitle: "   " } }, undefined, t, 30);
	assert.equal(blank[0].label, "x");

	// The limit is honoured.
	const many = Array.from({ length: 40 }, (_, index) => "s" + index);
	assert.equal(sessionHistoryItems(many, {}, undefined, t, 5).length, 5);
}

// ---------------------------------------------------------------- header controls
{
	const calls = [];
	const surfaces = buildChatSurfaces(
		"float",
		false,
		BODY,
		t,
		handlers({
			onHistory: () => calls.push("history"),
			onNew: () => calls.push("new"),
			onClose: () => calls.push("close"),
			historyNode: { type: "div", props: { className: "sy-chatmenu" }, children: [] },
		}),
	);
	const buttons = findAll(surfaces.floatChat, "sy-iconbtn");
	assert.equal(buttons.length, 4, "history, new, collapse and close");
	const byTitle = (needle) => {
		const hit = buttons.find((button) => String(button.props.title || "").includes(needle));
		assert.ok(hit, "no header button titled like " + needle + "; got " + JSON.stringify(buttons.map((button) => button.props.title)));
		return hit;
	};
	byTitle("历史对话").props.onClick();
	byTitle("新开对话").props.onClick();
	assert.deepEqual(calls, ["history", "new"], "both conversation controls are wired");

	// The session list is placed inside the surface, so it can float under the header
	// and is clipped with the window it belongs to.
	assert.ok(find(surfaces.floatChat, "sy-chatmenu"), "the dropdown renders inside the floating surface");
	const side = buildChatSurfaces("side", false, BODY, t, handlers({ historyNode: { type: "div", props: { className: "sy-chatmenu" }, children: [] } }));
	assert.ok(find(side.sideChat, "sy-chatmenu"), "and inside the side column too");

	// Closed by default: no menu, no node.
	const closed = buildChatSurfaces("side", false, BODY, t, handlers());
	assert.equal(find(closed.sideChat, "sy-chatmenu"), undefined);
}

console.log("chat surfaces: all assertions passed");
