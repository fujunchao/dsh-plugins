// Layout persistence at the panel level: the two races a pure-function test cannot see.
//
// 1. The debounced save must not run while the restore is still loading documents, or the
//    empty skeleton is written over the very layout being restored (a crash in that
//    window would lose the user's remembered layout).
// 2. A document opened while the restore is in flight must survive the merge, instead of
//    being silently replaced by the restored columns.
//
// Both drive the real PanelPage. The stub React keeps hook state and re-renders, because
// these defects live in the ordering of effects and promises, not in a helper.
import fs from "node:fs";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);
const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

/**
 * Build a hook runtime around the real panel.
 * @param {{ layout: object | null, gate?: Promise<unknown> }} options
 *   `layout` is what GET /siyuan/layout returns; `gate` lets a test hold that request.
 */
function createHarness({ layout, gate }) {
	const slots = new Map();
	const saved = [];
	const uploads = [];
	let renderSlot = 0;
	let module = null;
	let dirty = false;
	let effects = [];
	const effectSlots = new Map();
	const queueEffect = (fn, deps) => { effects.push({ slot: renderSlot++, fn, deps }); };
	cleanups.push(() => { for (const entry of effectSlots.values()) entry.cleanup?.(); });

	const ReactStub = {
		Component: class {
			constructor(props) { this.props = props ?? {}; this.state = {}; }
			setState(next) { this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) }; }
		},
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useState: (initial) => {
			const slot = renderSlot++;
			if (!slots.has(slot)) slots.set(slot, typeof initial === "function" ? initial() : initial);
			const set = (next) => {
				const current = slots.get(slot);
				const value = typeof next === "function" ? next(current) : next;
				if (value === current) return;
				slots.set(slot, value);
				dirty = true;
			};
			return [slots.get(slot), set];
		},
		useEffect: queueEffect,
		useLayoutEffect: queueEffect,
		useMemo: (factory) => factory(),
		useCallback: (fn) => fn,
		useRef: (value) => {
			const slot = renderSlot++;
			if (!slots.has(slot)) slots.set(slot, { current: value });
			return slots.get(slot);
		},
		useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
		useContext: () => undefined,
		useReducer: (reducer, initial) => [initial, () => {}],
		Fragment: "Fragment",
	};

	globalThis.window = {
		__ModuleLoader__: { load({ id, factory }) { module = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } },
	};
	globalThis.document = { head: { appendChild() {}, removeChild() {} }, createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null };
	const json = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value }) });
	globalThis.fetch = async (url, init) => {
		const path = String(url);
		if (path.endsWith("/siyuan/asset/upload")) {
			uploads.push(init.body);
			return json({ code: 0, data: { succFiles: [{ path: "assets/uploaded.png" }] } });
		}
		if (path.endsWith("/siyuan/state")) return json({ baseUrl: "http://127.0.0.1:6806", hasToken: true, version: "3.8.3" });
		if (path.endsWith("/siyuan/layout")) {
			if (init && init.method === "POST") {
				saved.push(JSON.parse(init.body));
				return json({ saved: true });
			}
			if (gate) await gate;
			return json({ layout });
		}
		if (path.endsWith("/siyuan/api")) {
			const body = JSON.parse(init.body);
			if (body.path === "/api/block/getBlockKramdown") {
				const kramdown = `正文-${body.payload.id}\n{: id="b1"}`;
				return json({ kramdown, data: { kramdown } });
			}
			return json("/路径");
		}
		return json(null);
	};
	new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

	const { PanelPage, EditorPane } = module.exports.__panes;

	/** One render pass plus its effects. */
	const renderOnce = () => {
		renderSlot = 0;
		effects = [];
		const tree = PanelPage({ t: (key) => key, useSessions: (selector) => selector({ ids: [], byId: {} }) });
		const editors = [];
		const walk = (node) => {
			if (node === null || typeof node !== "object") return;
			if (Array.isArray(node)) return node.forEach(walk);
			if (node.type === EditorPane) editors.push(node.props);
			for (const child of node.children ?? []) walk(child);
		};
		walk(tree);
		for (const effect of effects) {
			const old = effectSlots.get(effect.slot);
			if (old && Array.isArray(effect.deps) && Array.isArray(old.deps) && effect.deps.length === old.deps.length && effect.deps.every((value, index) => Object.is(value, old.deps[index]))) continue;
			old?.cleanup?.();
			const cleanup = effect.fn();
			effectSlots.set(effect.slot, { deps: effect.deps, cleanup: typeof cleanup === "function" ? cleanup : undefined });
		}
		return { tree, editors };
	};

	/**
	 * Render, let pending promises settle, and repeat while any state changed.
	 * A fixed number of passes would be flaky; this stops when the panel is quiet.
	 */
	const settle = async (limit = 20) => {
		let result = renderOnce();
		for (let i = 0; i < limit; i++) {
			dirty = false;
			await new Promise((resolve) => setTimeout(resolve, 10));
			result = renderOnce();
			if (!dirty) break;
		}
		return result;
	};

	return {
		nativeControllers: module.exports.__panes.nativeControllers,
		NativeEditorPane: module.exports.__panes.NativeEditorPane,
		renderOnce,
		settle,
		saved,
		uploads,
		docIds: (result) => result.editors.map((props) => (props.doc ? props.doc.id : null)),
		/** Every tab in every column, visible or not. */
		allTabs() {
			for (const [, value] of slots) {
				if (!Array.isArray(value) || value.length === 0) continue;
				if (typeof value[0] !== "object" || !value[0] || !("tabs" in value[0])) continue;
				return value.flatMap((pane) => pane.tabs.map((tab) => tab.id));
			}
			return [];
		},
		/**
		 * Add a tab to the live columns the way the panel's own openDoc would.
		 * The panes state is the slot holding an array of column objects; the setter is
		 * captured from the render, so this reproduces "the user clicked a document while
		 * the restore was still loading".
		 */
		openDocumentWhileRestoring(docId) {
			for (const [slot, value] of slots) {
				if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== "object" || !value[0] || !("tabs" in value[0])) continue;
				const next = value.map((pane, index) =>
					index !== 0
						? pane
						: {
								...pane,
								tabs: [
									...pane.tabs,
									{ key: "tUser", id: docId, title: docId, hpath: "", text: "", savedText: "", blocks: [], loading: false, saving: false, error: null, savedAt: null, stamp: 0 },
								],
								active: pane.tabs.length,
							},
				);
				slots.set(slot, next);
				// The restore reads panesRef, not the state: keep the ref in step so the
				// simulated click is visible to it exactly as a real click would be.
				for (const [, other] of slots) {
					if (!other || typeof other !== "object" || Array.isArray(other) || !("current" in other)) continue;
					if (!Array.isArray(other.current) || other.current.length === 0) continue;
					if (typeof other.current[0] !== "object" || !other.current[0] || !("tabs" in other.current[0])) continue;
					other.current = next;
				}
				dirty = true;
				return true;
			}
			return false;
		},
	};
}

const LAYOUT = { panes: [{ tabs: [{ docId: "docA", title: "A" }], active: 0, view: "split", autoSave: false, indentOn: true }], activePane: 0 };

function findNode(node, predicate) {
	if (!node || typeof node !== "object") return undefined;
	if (!Array.isArray(node) && predicate(node)) return node;
	for (const child of Array.isArray(node) ? node : node.children ?? []) {
		const found = findNode(child, predicate);
		if (found) return found;
	}
}

test("面板给编辑器的真实 client 可以上传图片", async () => {
	const harness = createHarness({ layout: LAYOUT });
	const result = await harness.settle();
	assert.ok(result.editors[0].key, "编辑器必须按标签隔离生命周期，不能在多个文档之间复用异步引用");
	assert.equal(typeof result.editors[0].client.uploadAsset, "function");
	const path = await result.editors[0].client.uploadAsset(new File(["png"], "demo.png", { type: "image/png" }));
	assert.equal(path, "assets/uploaded.png");
	assert.equal(harness.uploads.length, 1);
	assert.equal(harness.uploads[0].get("file[]").name, "demo.png");
});

test("关闭脏标签可以取消；明确放弃才移除；保存中不能关闭", async () => {
	const harness = createHarness({ layout: LAYOUT });
	let result = await harness.settle();
	result.editors[0].setDoc((prev) => ({ ...prev, text: prev.text + "未保存" }));
	result = await harness.settle();
	let confirmations = 0;
	window.confirm = () => { confirmations++; return false; };
	const close = () => findNode(result.tree, (node) => node.props?.className === "sy-tab-x").props.onClick({ stopPropagation() {} });
	close();
	result = await harness.settle();
	assert.deepEqual(harness.allTabs(), ["docA"]);
	assert.equal(confirmations, 1);
	result.editors[0].setDoc((prev) => ({ ...prev, saving: true }));
	result = await harness.settle();
	window.confirm = () => { confirmations++; return true; };
	close();
	result = await harness.settle();
	assert.deepEqual(harness.allTabs(), ["docA"]);
	assert.equal(confirmations, 1, "保存中的标签不能靠确认强行移除");
	result.editors[0].setDoc((prev) => ({ ...prev, saving: false }));
	result = await harness.settle();
	close();
	await harness.settle();
	assert.deepEqual(harness.allTabs(), []);
});

test("关闭分栏会检查其中未激活标签的未保存内容", async () => {
	const layout = { ...LAYOUT, panes: [{ ...LAYOUT.panes[0], tabs: [...LAYOUT.panes[0].tabs, { docId: "docB", title: "B" }] }, { ...LAYOUT.panes[0], tabs: [{ docId: "docC", title: "C" }] }] };
	const harness = createHarness({ layout });
	let result = await harness.settle();
	result.editors[0].setDoc((prev) => ({ ...prev, text: prev.text + "未保存" }));
	result = await harness.settle();
	const tab = findNode(result.tree, (node) => node.props?.className === "sy-tabpill" && node.props.title === "B");
	tab.props.onClick();
	result = await harness.settle();
	let confirmations = 0;
	window.confirm = () => { confirmations++; return false; };
	findNode(result.tree, (node) => node.props?.title === "closePane").props.onClick();
	await harness.settle();
	assert.deepEqual(harness.allTabs(), ["docA", "docB", "docC"]);
	assert.equal(confirmations, 1);
});

test("panel: no save happens while the remembered layout is still loading", async () => {
	let release = null;
	const gate = new Promise((resolve) => { release = resolve; });
	const harness = createHarness({ layout: LAYOUT, gate });

	// Render and let the probe resolve: the panel is now "ready" with an empty column
	// while GET /siyuan/layout is still hanging.
	const first = await harness.settle();
	assert.equal(first.editors.length, 1, "the panel renders a column while the restore is in flight");
	assert.deepEqual(harness.docIds(first), [null], "that column is still empty");

	// Advance well past the 600ms debounce: nothing may be written yet.
	await new Promise((resolve) => setTimeout(resolve, 800));
	assert.deepEqual(harness.saved, [], "the empty skeleton must not be written over the remembered layout");

	// Let the restore finish; now the real layout may be saved.
	release();
	await new Promise((resolve) => setTimeout(resolve, 50));
	const restored = await harness.settle();
	assert.deepEqual(harness.docIds(restored), ["docA"], "the remembered document is reopened");
	await new Promise((resolve) => setTimeout(resolve, 800));
	const last = harness.saved[harness.saved.length - 1];
	assert.ok(last, "the restored layout is saved once it is loaded");
	assert.equal(last.panes[0].tabs[0].docId, "docA", "what is saved is the restored document, not the skeleton");
});

test("panel: a document opened during the restore is not swallowed by it", async () => {
	let release = null;
	const gate = new Promise((resolve) => { release = resolve; });
	const harness = createHarness({ layout: LAYOUT, gate });

	// The panel is ready and empty; the layout request is still hanging.
	await harness.settle();
	assert.equal(harness.openDocumentWhileRestoring("docB"), true, "the user's click lands on the live columns");
	const clicked = await harness.settle();
	assert.deepEqual(harness.docIds(clicked), ["docB"], "the clicked document is open before the restore finishes");

	// Now the restore resolves against columns that already contain the click.
	release();
	await new Promise((resolve) => setTimeout(resolve, 50));
	const merged = await harness.settle();
	const ids = harness.docIds(merged);
	const every = harness.allTabs();
	assert.ok(every.includes("docA"), "the remembered document is reopened (tab present)");
	assert.ok(every.includes("docB"), "the clicked document is kept as a tab");
	assert.ok(ids.includes("docB"), "and it is the one on screen, not replaced by the restore");
});

test("panel: the layout is saved after a restore that found nothing", async () => {
	const harness = createHarness({ layout: null });
	const result = await harness.settle();
	assert.deepEqual(harness.docIds(result), [null], "nothing is reopened");
	await new Promise((resolve) => setTimeout(resolve, 800));
	// With no remembered layout the panel must not block saving forever: it writes the
	// (empty) current layout, which is the correct answer for "nothing was open".
	assert.ok(harness.saved.length >= 1, "saving resumes once the restore is finished");
});

test("原生模式替换旧编辑器，切标签和关闭必须先确认事务", async () => {
	const layout = { ...LAYOUT, panes: [{ ...LAYOUT.panes[0], tabs: [...LAYOUT.panes[0].tabs, { docId: "docB", title: "B" }] }] };
	const harness = createHarness({ layout });
	let result = await harness.settle();
	const tabKey = result.editors[0].doc.key;
	result.editors[0].onNative();
	result = await harness.settle();
	assert.equal(result.editors.length, 0, "原生模式不挂载旧 Markdown 编辑器和保存定时器");
	assert.ok(findNode(result.tree, node => node.type === harness.NativeEditorPane));
	let release;
	harness.nativeControllers.set(tabKey, { flush: () => new Promise(resolve => { release = resolve; }) });
	findNode(result.tree, node => node.props?.className === "sy-tabpill" && node.props.title === "B").props.onClick();
	result = await harness.settle();
	assert.ok(findNode(result.tree, node => node.type === harness.NativeEditorPane), "确认完成前仍保留原生编辑器");
	release(); result = await harness.settle();
	assert.equal(result.editors[0].doc.id, "docB");
	harness.nativeControllers.delete(tabKey);
	findNode(result.tree, node => node.props?.className === "sy-tabpill" && node.props.title === "A").props.onClick();
	result = await harness.settle();
	harness.nativeControllers.set(tabKey, { flush: async () => { throw new Error("原生保存未确认"); } });
	const a = findNode(result.tree, node => node.props?.className === "sy-tabpill" && node.props.title === "A");
	findNode(a, node => node.props?.className === "sy-tab-x").props.onClick({ stopPropagation() {} });
	result = await harness.settle();
	assert.deepEqual(harness.allTabs(), ["docA", "docB"], "保存失败时不关闭原生标签");
	harness.nativeControllers.clear();
});
