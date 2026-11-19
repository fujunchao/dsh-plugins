// First-line indent: the transform must be exactly invertible, must never touch
// structural lines, and must survive a save/read round trip against the kernel's
// kramdown serializer (which adds one synthesized indent of its own).
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
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (v) => ({ current: v }),
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};
let bundle = null;
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } } };
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { indentParagraphs, unindentParagraphs, isParagraphLine, markdownToHtml } = bundle.exports.__test;
const IND = "\u3000\u3000";

// ---------------------------------------------------------------- paragraph detection
assert.equal(isParagraphLine("正文"), true);
assert.equal(isParagraphLine(""), false, "blank line is not a paragraph start");
assert.equal(isParagraphLine("# 标题"), false);
assert.equal(isParagraphLine("- 列表"), false);
assert.equal(isParagraphLine("* 列表"), false);
assert.equal(isParagraphLine("1. 有序"), false);
assert.equal(isParagraphLine("> 引用"), false);
assert.equal(isParagraphLine("| a | b |"), false);
assert.equal(isParagraphLine("```js"), false);

// ---------------------------------------------------------------- indent
const plain = ["第一段", "", "第二段", "", "# 标题", "", "- 列表项", "", "```", "code", "```", "", "最后一段"].join("\n");
const indented = indentParagraphs(plain);

assert.ok(indented.includes(IND + "第一段"), "first paragraph indented");
assert.ok(indented.includes(IND + "第二段"), "second paragraph indented");
assert.ok(indented.includes(IND + "最后一段"), "trailing paragraph indented");
assert.ok(!indented.includes(IND + "# 标题"), "heading untouched");
assert.ok(!indented.includes(IND + "- 列表项"), "list item untouched");
assert.ok(indented.includes("\ncode\n"), "code body untouched");
assert.ok(!indented.includes(IND + "code"), "fence content untouched");

// Idempotent: indenting twice changes nothing.
assert.equal(indentParagraphs(indented), indented, "indent is idempotent");

// Exact inverse.
assert.equal(unindentParagraphs(indented), plain, "unindent is the exact inverse of indent");

// Unindent is idempotent and leaves already-bare text alone.
assert.equal(unindentParagraphs(plain), plain);

// Continuation lines of one paragraph are not indented again.
const multiline = ["第一行", "第二行（同段）", "", "下一段"].join("\n");
assert.equal(indentParagraphs(multiline), [IND + "第一行", "第二行（同段）", "", IND + "下一段"].join("\n"));

// Empty text stays empty.
assert.equal(indentParagraphs(""), "");
assert.equal(unindentParagraphs(""), "");

// ---------------------------------------------------------------- preview
{
	// CSS draws the indent; the literal characters must not add a second one.
	const html = markdownToHtml(IND + "缩进段落\n\n普通段落");
	assert.match(html, /<p>缩进段落<\/p>/, "literal indent stripped inside the paragraph: " + html);
	assert.match(html, /<p>普通段落<\/p>/);
	assert.ok(!html.includes(IND), "no U+3000 survives into the HTML");
}

// ---------------------------------------------------------------- save round trip
// SiYuan's document-level kramdown adds one synthesized indent per paragraph, and
// the plugin strips exactly one when reading. Writing a real indent must therefore
// be stable: write N -> read back N (one synthesized + one real, minus one stripped).
{
	const { splitKramdown, splitMarkdown, planSync } = bundle.exports.__test;
	const block = (id, text) => ({ id, text });
	// What the editor holds after the user turns the indent on.
	const editorText = [IND + "第一段", "", IND + "第二段"].join("\n");
	const next = splitMarkdown(editorText);
	assert.equal(next.length, 2);
	assert.ok(next[0].startsWith(IND), "the indent is part of the block the plugin writes");

	// The kernel echoes `　　` + stored text; the plugin strips one pair on read,
	// leaving exactly the real indent the writer typed.
	const stored = next[0];
	const echoed = IND + stored;
	const readBack = bundle.exports.__test.cleanBlockText(echoed);
	assert.equal(readBack, IND + "第一段", "read-back keeps exactly one indent");

	// Saving the same buffer again produces no further writes.
	const blocks = [{ id: "b1", text: readBack }, { id: "b2", text: IND + "第二段" }];
	const steps = planSync(blocks, splitMarkdown([readBack, IND + "第二段"].join("\n\n")));
	assert.ok(steps.every((s) => s.op === "keep"), "a second save of the same indented buffer is a no-op: " + JSON.stringify(steps.map((s) => s.op)));
}

console.log("indent: all assertions passed");
