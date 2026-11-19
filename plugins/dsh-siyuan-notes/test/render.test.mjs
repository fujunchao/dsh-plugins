// Headless render smoke test: execute the panel component tree with a stub React
// and no DOM, to catch runtime errors (undefined access, bad props) that a
// syntax check cannot see. This is not a visual preview; it only proves the
// component functions run to completion for each state the panel can be in.
import fs from "node:fs";
import assert from "node:assert/strict";

const SRC = new URL("../lib/client.js", import.meta.url);

let treeDepth = 0;
let rendered = 0;

function createElement(type, props, ...children) {
	return { type, props: props ?? {}, children };
}

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

/**
 * 预置好的 useState 初值，按调用顺序消费。
 *
 * 有些组件（例如记忆面板）把真正的内容放在「请求返回之后」的状态里，而 stub 的
 * useEffect 不会跑，所以只能靠预置状态去走「列表已加载」那条渲染路径——那才是
 * 真正会崩的地方（空数组、缺字段、展开态）。
 */
let stateSeeds = [];

const ReactStub = {
	Component: StubComponent,
	createElement,
	useState: (initial) => {
		if (stateSeeds.length > 0) {
			const seed = stateSeeds.shift();
			return [seed.value, seed.setter ?? (() => {})];
		}
		return [typeof initial === "function" ? initial() : initial, () => {}];
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

let bundle = null;
globalThis.window = {
	__ModuleLoader__: {
		load({ id, factory }) {
			bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) };
		},
	},
};
globalThis.document = {
	head: { appendChild() {}, removeChild() {} },
	createElement: () => ({ dataset: {}, remove() {} }),
	querySelector: () => null,
};
globalThis.fetch = async () => ({
	ok: true,
	status: 200,
	text: async () => JSON.stringify({ ok: true, value: { baseUrl: "http://127.0.0.1:6806", hasToken: true, version: "3.8.3" } }),
});
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.setTimeout = setTimeout;

new Function("window", "document", "fetch", fs.readFileSync(SRC, "utf8"))(globalThis.window, globalThis.document, globalThis.fetch);
assert.ok(bundle, "bundle registered");

/** Walk an element tree, invoking every function component (this is where errors surface). */
function render(node, depth = 0) {
	if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return;
	if (Array.isArray(node)) {
		for (const child of node) render(child, depth + 1);
		return;
	}
	if (typeof node === "function") {
		rendered++;
		render(node({}), depth + 1);
		return;
	}
	if (typeof node !== "object") return;
	const { type, props, children } = node;
	if (typeof type === "function") {
		rendered++;
		treeDepth = Math.max(treeDepth, depth);
		const withChildren = { ...props, children: props.children ?? children };
		// A class component must be constructed; calling it as a function throws. The
		// panel is wrapped in one (PanelBoundary), so the smoke test has to handle them.
		if (typeof type.prototype?.render === "function") {
			const instance = new type(withChildren);
			instance.props = withChildren;
			render(instance.render(), depth + 1);
			return;
		}
		render(type(withChildren), depth + 1);
		return;
	}
	if (typeof type === "string") {
		rendered++;
		render(children, depth + 1);
		render(props.children, depth + 1);
		return;
	}
	render(children, depth + 1);
}

// Install the plugin into a fake Cordis context so apply() runs for real.
const registrations = [];
const ctx = {
	effect(fn) {
		const disposer = fn();
		return () => (typeof disposer === "function" ? disposer() : undefined);
	},
	on() {
		return () => {};
	},
	locale: {
		register: () => () => {},
		bind: () => (key, params) => {
			const dict = bundle.exports.__dicts ? bundle.exports.__dicts.zh : {};
			let text = dict[key] ?? key;
			if (params) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
			return text;
		},
	},
	slots: {
		inject(key, callback) {
			const registration = callback();
			registrations.push({ key, registration });
			return () => {};
		},
		register(options, component) {
			return { options, component };
		},
	},
};

bundle.exports.apply(ctx);
assert.equal(registrations.length, 5, "两套入口：编辑器面板 + 记忆面板（各一条 sidebar 与一条 main），加一个 composer bridge");
const sidebar = registrations.find((r) => r.key === "sidebar.panellist");
const main = registrations.find((r) => r.key === "main");
const bridgeEntry = registrations.find((r) => r.key === "conversation.input.dock");
assert.ok(bridgeEntry, "the composer bridge registers into the input dock");
assert.equal(bridgeEntry.registration.options.id, "siyuan-notes-composer-bridge");
assert.equal(sidebar.registration.options.id, "siyuan-notes");
assert.equal(typeof sidebar.registration.options.label, "function");
assert.equal(sidebar.registration.options.label(), "思源笔记");
assert.equal(main.registration.options.key, "siyuan-notes");

// 记忆面板是**独立**入口：它不该挤进编辑器面板，也不该绑一个会话。
const panelEntries = registrations.filter((r) => r.key === "sidebar.panellist");
const memorySidebar = panelEntries.find((r) => r.registration.options.id === "siyuan-memory");
const memoryMain = registrations
	.filter((r) => r.key === "main")
	.find((r) => r.registration.options.key === "siyuan-memory");
assert.ok(memorySidebar, "记忆面板有自己的侧栏入口");
assert.ok(memoryMain, "记忆面板有自己的主面板");
assert.equal(memorySidebar.registration.options.label(), "记忆体");
assert.equal(memorySidebar.registration.options.order, 21, "排在编辑器入口之后");
assert.equal(memoryMain.registration.options.children, undefined, "记忆面板不绑会话");
render(memorySidebar.registration.component({ size: 18, active: false }));

// The sidebar icon renders at both rail sizes.
render(sidebar.registration.component({ size: 18, active: false }));
render(sidebar.registration.component({ size: 16, active: true }));

// The panel renders in its initial (probing) state, then each of its states.
const Panel = main.registration.component;
const t = ctx.locale.bind("siyuan-notes");
// Standard slot props, stubbed the way the renderer supplies them.
const slotProps = {
	t,
	useSessions: (selector) =>
		selector({
			ids: ["sess-1"],
			byId: { "sess-1": { id: "sess-1", title: "会话", retainedBy: { mainView: 1 } } },
			phase: "ready",
			projectionsBySession: {},
		}),
	renderFactorySlot: (name) => ({ type: "factory", props: { name }, children: [] }),
	SessionProvider: ({ children }) => children,
};
rendered = 0;
render(Panel(slotProps));
assert.ok(rendered > 0, "the panel component tree executed");

// Render the two sub-panes directly in the states the panel drives them through,
// including a loaded document with markdown, a dirty buffer and an error notice.
const internals = bundle.exports.__panes;
assert.ok(internals, "panes exposed for the smoke test");

const client = { api: async () => ({}) };
const emptyDoc = { id: "doc-1", title: "测试文档", text: "", savedText: "", blocks: [], loading: false, saving: false, error: null, savedAt: null };
const richDoc = {
	id: "doc-1",
	title: "测试文档",
	text: "# 标题\n\n正文 **加粗**\n\n- 列表\n\n```js\ncode\n```",
	savedText: "# 标题\n\n正文 **加粗**\n\n- 列表\n\n```js\ncode\n```",
	blocks: [{ id: "b1", text: "# 标题" }, { id: "b2", text: "正文 **加粗**" }],
	loading: false,
	saving: false,
	error: null,
	savedAt: 1793703708923,
};

for (const view of ["edit", "split", "preview"]) {
	render(internals.EditorPane({ t, client, doc: emptyDoc, setDoc: () => {}, view, setView: () => {}, autoSave: false, setAutoSave: () => {}, onNotice: () => {}, onReload: () => {}, onRename: () => {}, onRemove: () => {} }));
	render(internals.EditorPane({ t, client, doc: richDoc, setDoc: () => {}, view, setView: () => {}, autoSave: true, setAutoSave: () => {}, onNotice: () => {}, onReload: () => {}, onRename: () => {}, onRemove: () => {} }));
	render(internals.EditorPane({ t, client, doc: { ...richDoc, error: "保存失败" }, setDoc: () => {}, view, setView: () => {}, autoSave: false, setAutoSave: () => {}, onNotice: () => {}, onReload: () => {}, onRename: () => {}, onRemove: () => {} }));
	render(internals.EditorPane({ t, client, doc: null, setDoc: () => {}, view, setView: () => {}, autoSave: false, setAutoSave: () => {}, onNotice: () => {}, onReload: () => {}, onRename: () => {}, onRemove: () => {} }));
}

// The connect card is the state shown when no token is stored.
render(internals.ConnectCard({ t, initialBaseUrl: "http://127.0.0.1:6806", onConnected: () => {} }));
render(internals.ConnectCard({ t, initialBaseUrl: undefined, notice: "连接超时", onConnected: () => {} }));

// --- 记忆面板 ---------------------------------------------------------------
// 状态的真正内容在「请求返回之后」，而 stub 的 useEffect 不跑，所以用状态预置
// 直接走「列表已加载」和「展开一条」这两条路径——那才是会崩的地方。
assert.equal(typeof internals.MemoryPage, "function", "记忆面板组件已导出");
assert.equal(typeof internals.MemoryIcon, "function", "记忆面板图标已导出");
render(internals.MemoryIcon({ size: 18, active: true }));

const memT = ctx.locale.bind("siyuan-notes");
const twoEntries = [
	{ id: "20261106115529-u2ccn40", statement: "结论一", body: "结论一\n- 理由：因为", type: "decision", project: "dsh-siyuan-notes", status: "active", confidence: "verified", created: "20261106115529", source: "session:x", fresh: false },
	{ id: "20261106115529-zw6yn3g", statement: "结论二", body: "结论二", type: "fact", project: "*", status: "superseded", confidence: "stated", created: "20261106115529", source: "", fresh: true },
];

// 初始态：还没加载完。
rendered = 0;
render(internals.MemoryPage({ t: memT }));
assert.ok(rendered > 0, "记忆面板的初始态能渲染");

// 已加载：列出两条。
stateSeeds = [
	{ value: { sectionChars: 400, catalog: [], box: "b", ring: 0 } },
	{ value: twoEntries },
	{ value: false },
	{ value: null },
	{ value: "" },
	{ value: "active" },
	{ value: "" },
	{ value: "" },
	{ value: null },
];
rendered = 0;
render(internals.MemoryPage({ t: memT }));
assert.ok(rendered > 0, "记忆面板在已加载状态下能渲染");

// 展开一条 + 交接卡已打开：渲染正文、按钮与整卡 Markdown。
stateSeeds = [
	{ value: null },
	{ value: twoEntries },
	{ value: false },
	{ value: null },
	{ value: "decision" },
	{ value: "active" },
	{ value: "dsh-siyuan-notes" },
	{ value: "20261106115529-u2ccn40" },
	{ value: null },
	{ value: "# 会话交接卡\n\n## 最近决策\n\n- 结论一" },
];
render(internals.MemoryPage({ t: memT }));
stateSeeds = [];

assert.equal(internals.memoryStamp("20261106115529"), "11-06 11:55");
assert.equal(internals.memoryStamp(""), "");
assert.equal(internals.memoryStamp(null), "");

/**
 * 收集树里所有 `sy-iconbtn` 按钮的文本。
 *
 * `.sy-iconbtn` 是 26px 固定宽的图标按钮——往里塞中文标签会一字一行、溢出到面板边缘
 * （这个 bug 在顶栏和展开行各犯过一次）。所以在这条回归守卫里：图标按钮里只能有短符号。
 */
function iconButtonTexts(node, out = []) {
	if (node === null || node === undefined) return out;
	if (Array.isArray(node)) {
		for (const child of node) iconButtonTexts(child, out);
		return out;
	}
	if (typeof node !== "object") return out;
	if (node.props && node.props.className === "sy-iconbtn") {
		const text = (node.children ?? []).filter((child) => typeof child === "string").join("");
		out.push(text);
	}
	for (const child of node.children ?? []) iconButtonTexts(child, out);
	return out;
}

stateSeeds = [
	{ value: { sectionChars: 400, catalog: [], box: "b", ring: 0 } },
	{ value: twoEntries },
	{ value: false },
	{ value: null },
	{ value: "" },
	{ value: "" },
	{ value: "" },
	{ value: "20261106115529-u2ccn40" },
	{ value: null },
	{ value: "# 会话交接卡" },
];
const memoryTree = internals.MemoryPage({ t: memT });
stateSeeds = [];

// 先证明这个 walker 本身有效，否则「没找到图标按钮」会让下面的断言空转。
assert.deepEqual(iconButtonTexts({ props: { className: "sy-iconbtn" }, children: ["交接卡"] }), ["交接卡"]);
assert.deepEqual(
	iconButtonTexts({ props: {}, children: [{ props: { className: "sy-iconbtn" }, children: ["⟲"] }] }),
	["⟲"],
);

const iconTexts = iconButtonTexts(memoryTree);
for (const text of iconTexts) {
	assert.ok(text.length <= 2, `图标按钮里不该塞文字标签：「${text}」`);
}
// 记忆面板的文字按钮必须是 .sy-mem-btn —— 它是自适应的，不是 26px 固定宽。
const flat = JSON.stringify(memoryTree);
assert.ok(flat.includes('"sy-mem-btn"'), "记忆面板的文字按钮应当用 sy-mem-btn");

// The panel itself: its first render is the probing state, and the component
// body (including the multi-pane map and the embedded-chat wrapper) must execute
// without throwing.
const PanelComponent = internals.PanelPage;
assert.ok(typeof PanelComponent === "function", "PanelPage exposed");
render(PanelComponent(slotProps));

// The same panel in its ready state would need the live bridge; the chat wrapper
// is exercised through the props it depends on instead (SessionProvider present
// versus absent), so both branches run.
render(
	PanelComponent({
		...slotProps,
		SessionProvider: undefined,
		renderFactorySlot: undefined,
	}),
);

// A pane holding two tabs is what the split view renders; drive the tab strip,
// the per-pane actions and the stale banner through the pane directly.
const twoTabPane = {
	key: 1,
	active: 1,
	tabs: [
		{ ...richDoc, key: "t1", stamp: 1 },
		{ ...richDoc, key: "t2", id: "doc-2", title: "第二篇", stamp: 0 },
	],
};
render(
	internals.EditorPane({
		t,
		client,
		doc: twoTabPane.tabs[1],
		stale: true,
		setDoc: () => {},
		view: "split",
		setView: () => {},
		autoSave: false,
		setAutoSave: () => {},
		onNotice: () => {},
		onSaved: () => {},
		onReload: () => {},
		onRename: () => {},
		onRemove: () => {},
	}),
);

// ---------------------------------------------------------------- error boundary
// A failure inside the optional embedded conversation must cost that region only:
// an unhandled throw unmounts the whole slot entry, which the user sees as a blank
// panel. The boundary's logic is asserted directly (no DOM involved).
{
	const Boundary = bundle.exports.__panes.PanelBoundary;
	assert.equal(typeof Boundary, "function", "the panel error boundary is exported");
	const instance = new Boundary({ label: "对话", hint: "刷新试试" });
	assert.equal(instance.state.message, null, "healthy regions render their children");

	// React reports a child throw through this static hook.
	const derived = Boundary.getDerivedStateFromError(new Error("boom"));
	assert.equal(derived.message, "boom");

	instance.state = derived;
	const fallback = instance.render();
	assert.equal(fallback.type, "div");
	assert.equal(fallback.props.className, "sy-boundary");
	const flat = JSON.stringify(fallback);
	assert.ok(flat.includes("对话"), "the failing region is named: " + flat);
	assert.ok(flat.includes("boom"), "the error message is shown: " + flat);
	assert.ok(flat.includes("刷新试试"), "the hint is shown: " + flat);

	// A non-Error throw still produces readable text.
	assert.equal(Boundary.getDerivedStateFromError("plain string").message, "plain string");
}

// The client half must declare the sessions service: cordis throws when a service
// is read without being injected, and the panel retains a session reference.
assert.ok(bundle.exports.inject.includes("sessions"), "sessions is in the client inject list");
assert.ok(bundle.exports.inject.includes("slots"));
assert.ok(bundle.exports.inject.includes("locale"));

console.log(`render smoke test: ${rendered} components executed, depth ${treeDepth}, no exceptions`);
