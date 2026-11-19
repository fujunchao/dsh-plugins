// Pane-model tests: the multi-pane editor's state arithmetic (tab open/close,
// document removal, active-tab selection) is pure and must hold at the edges.
import fs from "node:fs";
import assert from "node:assert/strict";

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
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (value) => ({ current: value }),
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

let bundle = null;
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } } };
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { makePane, makeTab, withTabAdded, withTabClosed, withoutDoc } = bundle.exports.__paneModel;
assert.ok(makePane && makeTab && withTabAdded && withTabClosed && withoutDoc, "pane model exported");

// ---------------------------------------------------------------- per-column flags
// Splitting the editor must produce a second, independent place to write: the view
// mode, auto-save and first-line indent belong to the column, not to the panel. A
// regression here shows up as columns sharing a reference, or a flag leaking across
// them; the click-through path itself lives in the component, not in this model.
const fresh = makePane(7);
assert.equal(fresh.key, 7, "the factory keeps the caller's key");
assert.deepEqual(fresh.tabs, [], "a new column starts empty");
assert.equal(fresh.active, -1, "a new column with no tabs has no active tab");
assert.equal(fresh.view, "split", "a new column opens in split view");
assert.equal(fresh.autoSave, false, "a new column does not auto-save by default");
assert.equal(fresh.indentOn, true, "first-line indent is on by default");
assert.notEqual(fresh, makePane(7), "each call returns its own object");
assert.notEqual(fresh.tabs, makePane(7).tabs, "two columns never share one tabs array");

// Extras override the defaults, and only the three flags they name.
const inherited = makePane(8, { view: "preview", indentOn: false });
assert.equal(inherited.view, "preview");
assert.equal(inherited.indentOn, false);
assert.equal(inherited.autoSave, false, "unspecified flags keep their default");
assert.deepEqual(inherited.tabs, [], "the split passes flags only, so the child starts with no tabs");
const parent = { key: 1, tabs: [makeTab("t1", { id: "doc1", title: "doc1" })], active: 0, view: "edit", autoSave: true, indentOn: false };
const child = makePane(9, { view: parent.view, autoSave: parent.autoSave, indentOn: parent.indentOn });
assert.equal(child.view, "edit", "a split column starts with the parent's view");
assert.equal(child.autoSave, true, "…and its auto-save choice");
assert.equal(child.indentOn, false, "…and its indent choice");
assert.equal(child.key, 9, "…but not its key");
assert.deepEqual(child.tabs, [], "…and not its tabs");
assert.notEqual(child.tabs, parent.tabs, "the tab array is not shared by reference");

// The regression that actually bit once: `makePane(key, sourcePane)` spread the whole
// source pane, so the new column inherited its key, tabs and active index. Passing a
// whole pane as the extras object must still yield an empty column.
const whole = { key: 1, tabs: [makeTab("t1", { id: "doc1", title: "doc1" })], active: 0, view: "edit", autoSave: true, indentOn: false, garbage: "x" };
const fromWholePane = makePane(9, whole);
assert.equal(fromWholePane.key, 9, "the caller's key wins over the source pane's key");
assert.deepEqual(fromWholePane.tabs, [], "a whole source pane cannot hand over its tabs");
assert.equal(fromWholePane.active, -1, "…nor its active index");
assert.equal(fromWholePane.view, "edit", "…while its view flag still carries over");
assert.equal(fromWholePane.autoSave, true);
assert.equal(fromWholePane.indentOn, false);
assert.equal(fromWholePane.garbage, undefined, "unknown keys are not copied either");
assert.equal(makePane(3, { view: "nonsense" }).view, "split", "an unknown view mode falls back to split");

const tab = (key, id) => makeTab(key, { id, title: id });
const pane = (...tabs) => withTabs(tabs);
function withTabs(tabs) {
	return { key: 1, tabs, active: tabs.length === 0 ? -1 : 0 };
}
const keys = (p) => p.tabs.map((t) => t.key).join(",");

// ---------------------------------------------------------------- makeTab
{
	const t = makeTab("t1", { id: "doc-1", title: "标题" });
	assert.equal(t.key, "t1");
	assert.equal(t.id, "doc-1");
	assert.equal(t.title, "标题");
	assert.equal(t.text, "");
	assert.equal(t.savedText, "");
	assert.equal(t.loading, true, "a freshly opened tab starts in the loading state");
	assert.deepEqual(t.blocks, []);
	assert.equal(t.error, null);
	assert.equal(t.stamp, 0);
}

// ---------------------------------------------------------------- withTabAdded
{
	const p = withTabAdded(pane(tab("a", "1")), tab("b", "2"));
	assert.equal(keys(p), "a,b");
	assert.equal(p.active, 1, "the newly added tab becomes active");
	const empty = withTabAdded(pane(), tab("a", "1"));
	assert.equal(empty.active, 0);
}

// ---------------------------------------------------------------- withTabClosed
{
	// Closing a tab that is not active keeps the selection.
	const p1 = withTabClosed({ key: 1, tabs: [tab("a", "1"), tab("b", "2"), tab("c", "3")], active: 2 }, "a");
	assert.equal(keys(p1), "b,c");
	assert.equal(p1.active, 1, "the same document stays active, index shifts down");

	// Closing the active tab falls through to the neighbour at the same index.
	const p2 = withTabClosed({ key: 1, tabs: [tab("a", "1"), tab("b", "2"), tab("c", "3")], active: 1 }, "b");
	assert.equal(keys(p2), "a,c");
	assert.equal(p2.active, 1, "next neighbour takes the seat");

	// Closing the last tab selects the new last one.
	const p3 = withTabClosed({ key: 1, tabs: [tab("a", "1"), tab("b", "2")], active: 1 }, "b");
	assert.equal(p3.active, 0);

	// Closing the only tab empties the pane.
	const p4 = withTabClosed({ key: 1, tabs: [tab("a", "1")], active: 0 }, "a");
	assert.equal(p4.tabs.length, 0);
	assert.equal(p4.active, -1, "an empty pane has no active tab");

	// Unknown key is a no-op.
	const before = { key: 1, tabs: [tab("a", "1")], active: 0 };
	assert.equal(withTabClosed(before, "zzz"), before);
}

// ---------------------------------------------------------------- withoutDoc
{
	// The same document open in two panes disappears from both.
	const panes = [
		{ key: 1, tabs: [tab("a", "shared"), tab("b", "other")], active: 1 },
		{ key: 2, tabs: [tab("c", "shared")], active: 0 },
		{ key: 3, tabs: [tab("d", "untouched")], active: 0 },
	];
	const after = withoutDoc(panes, "shared");
	assert.equal(keys(after[0]), "b");
	assert.equal(after[0].active, 0, "the removal from a non-active slot keeps the other tab");
	assert.equal(after[1].tabs.length, 0);
	assert.equal(after[1].active, -1);
	assert.equal(keys(after[2]), "d", "panes without the document are returned unchanged");
	assert.equal(after[2], panes[2], "untouched panes keep their identity (no needless re-render)");

	// Removing the active tab of the last position clamps the index.
	const clamped = withoutDoc([{ key: 1, tabs: [tab("a", "1"), tab("b", "shared")], active: 1 }], "shared");
	assert.equal(clamped[0].active, 0);
}

console.log("pane model: all assertions passed");
