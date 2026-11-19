// Node harness for the plugin's classic-script client bundle.
// Loads lib/client.js exactly as the browser module loader would, with a stub
// React, then exercises the pure kramdown helpers against real SiYuan data.
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
	createElement(type, props, ...children) {
		return { type, props: props ?? {}, children };
	},
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (v) => ({ current: v }),
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

let registered = null;
globalThis.window = {
	__ModuleLoader__: {
		load({ id, factory }) {
			registered = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) };
		},
	},
};

const code = fs.readFileSync(SRC, "utf8");
new Function("window", code)(globalThis.window);

assert.ok(registered, "bundle registered a factory");
assert.equal(registered.id, "dsh-siyuan-notes");
assert.equal(typeof registered.exports.apply, "function");
assert.ok(Array.isArray(registered.exports.inject));
const { splitKramdown, splitMarkdown, planSync, markdownToHtml, cleanBlockText, createdBlockId } = registered.exports.__test;

// ---------------------------------------------------------------- kramdown
const KRAMDOWN = `# 一级标题
{: id="b1" updated="1"}

　　这是一段正文，含 **加粗**。
{: id="b2" updated="1"}

- {: id="c1" updated="1"}列表A
  {: id="c1a" updated="1"}
- {: id="c2" updated="1"}列表B
  {: id="c2a" updated="1"}
{: id="b3" updated="1"}

\`\`\`js
console.log("x")
\`\`\`
{: id="b4" updated="1"}

| 列1 | 列2 |
| --- | --- |
| a | b |
{: id="b5" updated="1"}

{: id="doc1" updated="1" type="doc" title="标题"}`;

const blocks = splitKramdown(KRAMDOWN);
assert.deepEqual(
	blocks.map((b) => b.id),
	["b1", "b2", "b3", "b4", "b5"],
	"top-level block ids",
);
assert.equal(blocks[0].text, "# 一级标题");
assert.equal(blocks[1].text, "这是一段正文，含 **加粗**。", "paragraph indentation stripped");
assert.equal(blocks[2].text, "- 列表A\n- 列表B", "inline child IALs stripped from a list block");
assert.equal(blocks[3].text, '```js\nconsole.log("x")\n```', "fence preserved");
assert.equal(blocks[4].text, "| 列1 | 列2 |\n| --- | --- |\n| a | b |");
assert.equal(blocks.some((b) => b.id === "doc1"), false, "doc IAL dropped");

// Round trip: the display text must split back into the same block count.
const next = splitMarkdown(blocks.map((b) => b.text).join("\n\n"));
assert.deepEqual(next, blocks.map((b) => b.text), "round trip is stable");

// ---------------------------------------------------------------- splitting
assert.deepEqual(splitMarkdown("a\n\nb").length, 2);
assert.deepEqual(splitMarkdown("- a\n- b").length, 1, "tight list stays one block");
assert.deepEqual(splitMarkdown("# H\ntext").length, 2, "heading starts a new block");
assert.deepEqual(splitMarkdown("```\na\n\nb\n```").length, 1, "fence keeps blank lines inside");
assert.deepEqual(splitMarkdown("> a\n> b").length, 1, "block quote stays one block");
assert.deepEqual(splitMarkdown("").length, 0);

// ---------------------------------------------------------------- planSync
const original = [
	{ id: "b1", text: "# 一级标题" },
	{ id: "b2", text: "这是一段正文，含 **加粗**。" },
	{ id: "b3", text: "- 列表A\n- 列表B" },
	{ id: "b4", text: "```js\nconsole.log(\"x\")\n```" },
];
{
	const steps = planSync(original, original.map((b) => b.text));
	assert.deepEqual(steps.map((s) => s.op), ["keep", "keep", "keep", "keep"], "no edit -> no write");
}
{
	const edited = ["# 一级标题", "改过的正文", "- 列表A\n- 列表B", "```js\nconsole.log(\"x\")\n```"];
	const steps = planSync(original, edited);
	assert.deepEqual(steps.map((s) => s.op), ["keep", "update", "keep", "keep"]);
	assert.equal(steps[1].id, "b2");
	assert.equal(steps[1].text, "改过的正文");
}
{
	const edited = ["# 一级标题", "这是新插入的段", "这是一段正文，含 **加粗**。", "- 列表A\n- 列表B", "```js\nconsole.log(\"x\")\n```"];
	const steps = planSync(original, edited);
	assert.deepEqual(steps.map((s) => s.op), ["keep", "insert", "keep", "keep", "keep"]);
	assert.equal(steps[1].text, "这是新插入的段");
}
{
	const edited = ["# 一级标题", "- 列表A\n- 列表B"];
	const steps = planSync(original, edited);
	assert.deepEqual(
		steps.map((s) => s.op + (s.id ? ":" + s.id : "")),
		["keep:b1", "delete:b2", "keep:b3", "delete:b4"],
	);
}
{
	const steps = planSync([], ["只有一段"]);
	assert.deepEqual(steps, [{ op: "insert", text: "只有一段" }]);
}
{
	const steps = planSync(original, []);
	assert.deepEqual(steps.map((s) => s.op), ["delete", "delete", "delete", "delete"]);
}

// ---------------------------------------------------------------- transactions
assert.equal(
	createdBlockId([{ doOperations: [{ action: "delete", id: "x" }, { action: "insert", id: "new-1" }] }]),
	"new-1",
);
assert.equal(createdBlockId({}), undefined);

// ---------------------------------------------------------------- markdown
const html = markdownToHtml("# 标题\n\n**粗** 与 `code`\n\n- [x] 完成\n- [ ] 未完成\n\n> 引用\n\n```js\nconst a = 1 < 2;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[x](https://example.com)\n\n![图](pics/a.png)");
assert.match(html, /<h1>标题<\/h1>/);
assert.match(html, /<strong>粗<\/strong>/);
assert.match(html, /<code>code<\/code>/);
assert.match(html, /<input type="checkbox" disabled checked \/>/);
assert.match(html, /<blockquote>/);
assert.match(html, /const a = 1 &lt; 2;/);
assert.match(html, /<table>/);
assert.match(html, /<a href="https:\/\/example.com"/);
assert.match(html, /sy-imgph/, "unknown relative image (not under assets/) becomes a placeholder, not a broken img");

// assets/ 图片走宿主代理，必须画成真图（第十八轮）：这是与上面那条互斥的正向行为。
// 详细断言在 test/image.test.mjs，这里只钉住「编码形态」这一个不走样的事实。
const assetHtml = markdownToHtml("![图](assets/a.png)");
assert.match(assetHtml, /<img[^>]*src="\/siyuan\/asset\?path=assets%2Fa\.png"/, "assets 图片要经 /siyuan/asset 代理");
assert.doesNotMatch(assetHtml, /sy-imgph/, "assets 图片不再降级为占位符");
assert.doesNotMatch(assetHtml, /demo-7f3a91|token=/, "渲染结果里不得出现 token");
assert.doesNotMatch(markdownToHtml("<script>alert(1)</script>"), /<script>/, "raw html is escaped");

// ---------------------------------------------------------------- cleanBlockText
assert.equal(cleanBlockText("\u3000\u3000段落"), "段落");
assert.equal(cleanBlockText("- {: id=\"x\"}项目"), "- 项目");
assert.equal(cleanBlockText("  {: id=\"x\"}\n"), "");

console.log("client.js pure helpers: all assertions passed");
