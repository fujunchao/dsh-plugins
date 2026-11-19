/**
 * dsh-siyuan-notes — 编辑区的「渲染健壮性」扫描（不开浏览器）。
 *
 * 这个文件存在的理由是一次真实事故：P1 分段编辑器里 `resplitNow` 被"用在前、`const` 声明在后"，
 * 于是 —— **`node --test` 全绿、`node --check` 也过**，但只要文档里有一行"看起来像图片但还没收成
 * 卡片"的语法（围栏代码里的 `![](...)`、行内与正文同段的图片语法、列表项里的图片），
 * EditorPane 一渲染就整体抛 `ReferenceError: Cannot access 'resplitNow' before initialization`，
 * 用户打开文档看到的是一个坏掉的面板。P0 套件完全没编码到这些形态，所以谁也拦不住它。
 *
 * 两条纪律：
 *   1. 只做「渲染一次、不许抛错」这类断言 —— 不依赖浏览器、不依赖 DSH、毫秒级；
 *   2. 每个形态一条独立用例，红了直接告诉你**是哪个形态**崩的。
 */

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

new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);
const { EditorPane } = registered.exports.__panes;

/** 渲染一次 EditorPane。若 EditorPane 将来新增必需 prop，在这里补上即可（属于测试维护）。 */
function render(text, overrides = {}) {
	const doc = {
		id: "doc1",
		title: "文档",
		text,
		savedText: text,
		blocks: [],
		loading: false,
		saving: false,
		error: null,
		savedAt: null,
		stamp: 0,
	};
	return EditorPane({
		t: (key, params) => (params ? key + JSON.stringify(params) : key),
		client: { uploadAsset: async () => "assets/x.png" },
		doc,
		setDoc: () => {},
		onReload: () => {},
		onRename: () => {},
		onRemove: () => {},
		view: "split",
		setView: () => {},
		autoSave: false,
		setAutoSave: () => {},
		onNotice: () => {},
		stale: false,
		onSaved: () => {},
		indentOn: false,
		onIndentChange: () => {},
		onQuote: () => {},
		onCaret: () => {},
		caretRequest: null,
		...overrides,
	});
}

/** 收集渲染树里所有节点的 "标签.类名"（类名按 token 拆开），供结构断言使用。 */
function labelsOf(node, out = []) {
	if (node === null || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const child of node) labelsOf(child, out);
		return out;
	}
	const tag = typeof node.type === "string" ? node.type : String(node.type?.name ?? "Component");
	const className = typeof node.props?.className === "string" ? node.props.className : "";
	const tokens = className.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) out.push(tag);
	for (const token of tokens) out.push(tag + "." + token);
	for (const child of node.children ?? []) labelsOf(child, out);
	return out;
}

/** 精确数某类名的节点数（用 token 全等，避免把 `sy-imgcard-head` 也数成卡片）。 */
function countClass(labels, className) {
	return labels.filter((label) => label.endsWith("." + className)).length;
}

/** 数某个标签的节点数（`textarea` 这类通常没有类名）。 */
function countTag(labels, tag) {
	return labels.filter((label) => label === tag || label.startsWith(tag + ".")).length;
}

/** 取真实编辑器渲染树中的指定节点，直接调用它交给 React 的事件处理器。 */
function nodesWhere(node, predicate, out = []) {
	if (node === null || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const child of node) nodesWhere(child, predicate, out);
		return out;
	}
	if (predicate(node)) out.push(node);
	for (const child of node.children ?? []) nodesWhere(child, predicate, out);
	return out;
}

test("图片加载成功后隐藏错误占位，失败后显示，重新成功可恢复", () => {
	const tree = render("![图](assets/a.png)");
	const image = nodesWhere(tree, (node) => node.type === "img")[0];
	assert.equal(typeof image?.props.onLoad, "function", "成功加载必须能清除错误态");
	assert.equal(typeof image?.props.onError, "function", "加载失败必须能显示错误态");
	const shot = { dataset: {} };
	const event = { currentTarget: { parentElement: shot } };
	image.props.onError(event);
	assert.equal(shot.dataset.broken, "true");
	image.props.onLoad(event);
	assert.notEqual(shot.dataset.broken, "true", "恢复加载后不能残留错误提示");
});

test("正文同一行的图片显示成卡片，前后正文仍可编辑且原文不变", () => {
	const image = "![41ad067285706e6caebfad146623263823207712](assets/41ad067285706e6caebfad146623263823207712-20261108210503-7uwo8ca.jpg)";
	const text = "“……不是，我吗？”" + image + "后续正文\r\n下一行";
	const tree = render(text);
	assert.equal(countClass(labelsOf(tree), "sy-imgcard"), 1, "同段图片也必须显示");
	const edits = nodesWhere(tree, (node) => node.type === "textarea" && node.props.className === "sy-seg-text");
	assert.equal(edits.map((node) => node.props.value).join(""), "“……不是，我吗？”后续正文\r\n下一行");
	const { splitEditorSegments, joinEditorSegments } = registered.exports.__test;
	assert.equal(joinEditorSegments(splitEditorSegments(text)), text);
});

test("同一行多张图片各成一张卡片，字符范围连续且 CRLF 原样保留", () => {
	const text = '前文![甲](assets/a.png){: style="width: 50%;"}中间![乙](assets/b.png)后文\r\n\r\n末段';
	const { splitEditorSegments, joinEditorSegments, replaceSegmentText } = registered.exports.__test;
	const rows = splitEditorSegments(text);
	const pictures = rows.filter((row) => row.kind === "image");
	assert.equal(pictures.length, 2);
	assert.deepEqual(pictures.map((row) => row.line), [0, 0]);
	assert.equal(pictures[0].style, "width:50%");
	for (let i = 0; i < rows.length; i++) {
		assert.equal(rows[i].start, i === 0 ? 0 : rows[i - 1].end);
		assert.equal(text.slice(rows[i].start, rows[i].end), rows[i].syntax ?? rows[i].text);
	}
	assert.equal(rows.at(-1).end, text.length);
	assert.equal(joinEditorSegments(rows), text);
	assert.equal(replaceSegmentText(text, rows, rows.indexOf(pictures[0]), ""), '前文中间![乙](assets/b.png)后文\r\n\r\n末段');
});

for (const [label, text, expected] of [
	["行内代码", '`![示例](assets/a.png)`正文![真图](assets/b.png)', 1],
	["双反引号代码", '``带 ` 的 ![示例](assets/a.png)``![真图](assets/b.png)', 1],
	["转义图片标记", '\\![示例](assets/a.png)正文![真图](assets/b.png)', 1],
	["HTML 注释", '<!-- ![示例](assets/a.png) -->![真图](assets/b.png)', 1],
	["普通资源链接", '[链接](assets/a.png)', 0],
]) {
	test(`行内图片识别跳过${label}`, () => {
		const { splitEditorSegments, joinEditorSegments } = registered.exports.__test;
		const rows = splitEditorSegments(text);
		assert.equal(rows.filter((row) => row.kind === "image").length, expected);
		assert.equal(joinEditorSegments(rows), text);
	});
}

for (const action of ["width", "alt", "delete"]) {
	test(`行内图片操作 ${action} 只修改图片本身，保留前后正文`, () => {
		const before = '前文![原图](assets/a.png)后文\r\n下一段';
		let doc = { text: before };
		const tree = render(before, { setDoc: (next) => { doc = typeof next === "function" ? next(doc) : next; } });
		const card = nodesWhere(tree, (node) => node.props.className === "sy-imgcard")[0];
		assert.ok(card);
		let picture;
		if (action === "width") {
			const button = nodesWhere(card, (node) => node.type === "button" && node.children.includes("imageWidthHalf"))[0];
			button.props.onClick();
			picture = '![原图](assets/a.png){: style="width: 50%;"}';
		} else if (action === "alt") {
			const input = nodesWhere(card, (node) => node.props.className === "sy-imgcard-alt")[0];
			input.props.onBlur({ target: { value: "新图" } });
			picture = '![新图](assets/a.png)';
		} else {
			const button = nodesWhere(card, (node) => node.type === "button" && node.children.includes("imageDelete"))[0];
			button.props.onClick();
			picture = "";
		}
		assert.equal(doc.text, '前文' + picture + '后文\r\n下一段');
	});
}

test("含转义方括号的图片说明反复失焦不会被重复转义", () => {
	const text = '前文![图\\]片](assets/a.png "保留标题"){: style="width: 50%; max-width: 100%;"}后文';
	let doc = { text };
	const tree = render(text, { setDoc: (next) => { doc = typeof next === "function" ? next(doc) : next; } });
	const input = nodesWhere(tree, (node) => node.props.className === "sy-imgcard-alt")[0];
	assert.ok(input);
	assert.equal(input.props.defaultValue, "图]片");
	input.props.onBlur({ target: { value: input.props.defaultValue } });
	assert.equal(doc.text, text, "没有改说明就不应更改原文");
});

const FENCE = "```";

/** 9 类必须覆盖的形态 + 几处顺手补的边界。 */
const SHAPES = [
	["纯文本", "第一段正文"],
	["空文档", ""],
	["纯图片文档", "![图](assets/a.png)"],
	["图片卡片 + 正文", "![图](assets/a.png)\n\n后面一段正文"],
	["两个图片卡片", "![图](assets/a.png)\n\n正文一段\n\n![图二](assets/b.png)"],
	["列表项里的图片语法", "- ![图](assets/a.png)"],
	["行内图片语法与正文同段", "说明：![图](assets/a.png) 是图片语法"],
	["围栏代码里的图片语法（```）", FENCE + "\n![图](assets/a.png)\n" + FENCE],
	["围栏代码里的图片语法（~~~ 带语言）", "~~~markdown\n![图](assets/a.png)\n~~~"],
	["未闭合围栏里的图片语法", FENCE + "\n![图](assets/a.png)"],
	["缩进的图片行", "\u3000\u3000![图](assets/a.png)"],
	["表格里的图片语法", "| 列 | 图 |\n| --- | --- |\n| a | ![图](assets/a.png) |"],
	["引用块里的图片语法", "> ![图](assets/a.png)"],
	["CRLF 换行", "第一段\r\n\r\n![图](assets/a.png)\r\n\r\n第二段"],
	["无尾换行（图片在最后一行）", "第一段\n\n![图](assets/a.png)"],
	["图片带宽度 IAL", '![图](assets/a.png){: style="width: 560px;"}'],
];

for (const [label, text] of SHAPES) {
	test(`渲染不抛错：${label}`, () => {
		let tree = null;
		assert.doesNotThrow(() => {
			tree = render(text);
		}, `EditorPane 渲染这个形态时抛错了：${JSON.stringify(text)}`);
		assert.ok(tree && typeof tree === "object", "渲染必须返回一棵树");
		assert.ok(labelsOf(tree).length > 10, "渲染结果不该是空壳");
	});
}

// 三种视图模式都要能渲染：分段视图只在 edit/split 下存在，预览是另一条路径。
for (const view of ["edit", "split", "preview"]) {
	test(`渲染不抛错：视图模式 ${view}`, () => {
		assert.doesNotThrow(() => render("第一段\n\n![图](assets/a.png)", { view }));
	});
}

test("图片行渲染成 sy-imgcard 卡片，而不是留在文本段里", () => {
	const pure = labelsOf(render("![图](assets/a.png)"));
	assert.equal(countClass(pure, "sy-imgcard"), 1, "一行图片 = 一张卡片");

	const mixed = labelsOf(render("![图](assets/a.png)\n\n正文一段\n\n![图二](assets/b.png)"));
	assert.equal(countClass(mixed, "sy-imgcard"), 2, "两行图片 = 两张卡片");
	assert.equal(countClass(mixed, "sy-seg-text"), 1, "中间那段正文仍是一个文本段");

	const prose = labelsOf(render("第一段正文"));
	assert.equal(countClass(prose, "sy-imgcard"), 0, "纯文本没有卡片");
	assert.ok(countTag(prose, "textarea") >= 1, "纯文本有可编辑的 textarea");
});

test("围栏里的图片语法不算图片：仍留在文本段里、不产生卡片", () => {
	const labels = labelsOf(render(FENCE + "\n![图](assets/a.png)\n" + FENCE));
	assert.equal(countClass(labels, "sy-imgcard"), 0, "代码块里的 ![](...) 是代码，不是图片");
	assert.ok(countTag(labels, "textarea") >= 1, "它应该还能作为文本编辑");
});

// --- 更刁的形态：真实文档里会遇到、但没人会想到要测的输入 -------------------
//
// 这一批的目标不是"断言某个行为"，而是"渲染整体不许抛错"——分段渲染是整篇一个函数，
// 任何一处读未初始化的变量都会让整个编辑区崩掉，代价和收益完全不成比例，所以宁可多铺几铲。

const NASTY_SHAPES = [
	["空 alt 与空路径", "![](assets/a.png)\n\n![x]()"],
	["带 title 的图片", '![a](assets/a.png "标题")'],
	["路径里有空格与中文", "![图](assets/我的 图-2026.png)"],
	["alt 里有转义右方括号", "![a\\]b](assets/a.png)"],
	["alt 里有未转义右方括号", "![a]b](assets/a.png)"],
	["写了一半的图片语法", "![abc\n\n![x]("],
	["空 alt 的普通链接", "[](assets/a.png)"],
	["两行图片紧挨、中间没有空行", "![a](assets/a.png)\n![b](assets/b.png)"],
	["图片行的下一行跟一条 IAL", '![a](assets/a.png)\n{: style="width: 560px;"}'],
	["tab 缩进的图片行", "\t![a](assets/a.png)"],
	["只有一个围栏标记", FENCE],
	["相邻的多个围栏", FENCE + "\ncode\n" + FENCE + "\n" + FENCE + "\ncode2\n" + FENCE],
	["围栏内又出现一个围栏标记", FENCE + "\n" + FENCE + "\n![a](assets/a.png)\n" + FENCE],
	["未闭合的 ~~~ 之后跟着图片", "~~~\n![a](assets/a.png)"],
	["只以 \\r 结尾的行", "第一段\r![a](assets/a.png)"],
	["文件开头的 BOM", "\uFEFF![a](assets/a.png)"],
	["HTML 注释里的图片语法", "<!-- ![a](assets/a.png) -->"],
	["HTML 的 img 标签", '<img src="assets/a.png">'],
	["连续 60 张图片", Array.from({ length: 60 }, (_, i) => `![图${i}](assets/a${i}.png)`).join("\n\n")],
	["20 万字符的单行（含图片）", "前".repeat(99900) + "![a](assets/a.png)" + "后".repeat(99900)],
	["2000 处图片语法但都不成行", Array.from({ length: 2000 }, (_, i) => `![${i}](a)`).join(" ")],
	["CRLF + 围栏 + 图片混排", "```\r\n![a](assets/a.png)\r\n```\r\n\r\n![b](assets/b.png)"],
];

for (const [label, text] of NASTY_SHAPES) {
	test(`渲染不抛错（刁钻形态）：${label}`, () => {
		assert.doesNotThrow(() => render(text), `EditorPane 渲染这个形态时抛错了：${label}`);
	});
}

test("分段纯函数在所有形态上都逐字节可重组（split/join 不变式）", () => {
	const { splitEditorSegments, joinEditorSegments } = registered.exports.__test;
	assert.equal(typeof splitEditorSegments, "function", "__test 必须导出 splitEditorSegments");
	assert.equal(typeof joinEditorSegments, "function", "__test 必须导出 joinEditorSegments");
	for (const [label, text] of [...SHAPES, ...NASTY_SHAPES]) {
		const segments = splitEditorSegments(text);
		assert.equal(joinEditorSegments(segments), text, `重组后与原文不一致：${label}`);
	}
});
