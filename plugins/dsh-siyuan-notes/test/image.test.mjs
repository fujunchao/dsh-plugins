/**
 * dsh-siyuan-notes — 图片功能（第十八轮）的客户端断言。
 *
 * 覆盖三件在浏览器里看不到、但错了会静默出事的东西：
 *   1. 资源路径 -> 宿主代理 URL 的编码形态（token 绝不能进 URL）；
 *   2. 行内 IAL 的宽度白名单（只放行 width / max-width，其余 IAL 内容不得进 HTML）；
 *   3. 文件名 -> markdown alt 的转义。
 * 外加预览渲染的正反例：assets 图片必须画成真 <img>，未知相对路径仍降级为占位。
 *
 * 装载方式与 test/client.test.mjs 完全一致：把 lib/client.js 当成浏览器里的
 * 经典脚本喂给 __ModuleLoader__，用 stub React 取 exports.__test。
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
assert.ok(registered, "bundle registered a factory");

const T = registered.exports.__test ?? {};
const { assetPreviewUrl, parseImageIal, filenameToAlt, markdownToHtml } = T;

/** 取输出里第一个 <img …> 标签。 */
function imgTag(html) {
	const match = /<img\b[^>]*>/.exec(html);
	return match ? match[0] : null;
}

/** 取标签上的属性值（属性一定带双引号，因为整段是拼接出来的）。 */
function attr(tag, name) {
	const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag ?? "");
	return match ? match[1] : null;
}

/** 渲染一行 markdown，返回 { html, tag, style }。 */
function render(line) {
	const html = markdownToHtml(line);
	const tag = imgTag(html);
	return { html, tag, style: attr(tag, "style") ?? "" };
}

// ------------------------------------------------------------ 代理 URL

test("assetPreviewUrl 走宿主代理并正确编码路径", () => {
	assert.equal(typeof assetPreviewUrl, "function", "__test 必须导出 assetPreviewUrl");
	assert.equal(assetPreviewUrl("assets/a.png"), "/siyuan/asset?path=assets%2Fa.png");
	assert.equal(assetPreviewUrl("assets/a b.png"), "/siyuan/asset?path=assets%2Fa%20b.png");
	assert.equal(assetPreviewUrl("assets/中文.png"), "/siyuan/asset?path=assets%2F%E4%B8%AD%E6%96%87.png");
	// 关键安全性质：代理 URL 里永远不出现 token 参数（浏览器拿不到 token）。
	assert.ok(!assetPreviewUrl("assets/a.png").includes("token"), "代理 URL 不能带 token");
	assert.ok(!assetPreviewUrl("assets/a.png").includes("Authorization"));
});

// ------------------------------------------------------------ IAL 宽度白名单

test("parseImageIal 提取合法的 width / max-width", () => {
	assert.equal(typeof parseImageIal, "function", "__test 必须导出 parseImageIal");
	const plain = parseImageIal('{: style="width: 560px;"}');
	assert.equal(plain.width, "560px");
	assert.ok(String(plain.style).includes("560px"), "style 里要带上宽度");

	const maxWidth = parseImageIal('{: style="max-width: 100%;"}');
	assert.equal(maxWidth.maxWidth, "100%");
	assert.ok(String(maxWidth.style).includes("100%"));

	for (const good of ["560px", "50%", "1.5rem", "12.5px", "2em", "0px"]) {
		const result = parseImageIal(`{: style="width: ${good};"}`);
		assert.equal(result.width, good, `${good} 是合法宽度，应通过`);
	}

	const none = parseImageIal("");
	assert.equal(none.width, null);
	assert.equal(none.maxWidth, null);
	assert.equal(none.style, "");
});

test("parseImageIal 丢弃非法宽度值", () => {
	for (const bad of ["520pt", "2vh", "calc(100% - 10px)", "expression(alert(1))", "1e3px", "abc", "-10px", "100 px"]) {
		const result = parseImageIal(`{: style="width: ${bad};"}`);
		assert.equal(result.width, null, `${bad} 不是白名单里的 CSS 长度，必须丢弃`);
		assert.ok(!String(result.style).includes(bad), `${bad} 不得写进 style`);
		assert.ok(!String(result.style).toLowerCase().includes("expression"), "不得把表达式写进 style");
	}
	// 用分号塞第二个属性也不能混进 style
	const sneaky = parseImageIal('{: style="width: 100px;color:red;}');
	assert.ok(!String(sneaky.style).includes("color"), "非白名单属性名不得进 style");
	assert.ok(!String(sneaky.style).includes("red"));
});

test("parseImageIal 不泄漏 width 之外的 IAL 内容", () => {
	const result = parseImageIal('{: id="b1" style="width: 560px; color: red;" custom="javascript:alert(1)"}');
	assert.equal(result.width, "560px");
	const style = String(result.style);
	assert.ok(!style.includes("color"), "color 不得进 style");
	assert.ok(!style.includes("red"));
	assert.ok(!style.includes("custom"));
	assert.ok(!style.includes("javascript"));
	assert.ok(!style.includes("b1"));
});

// ------------------------------------------------------------ alt 生成

test("filenameToAlt 去扩展名并转义会破坏 markdown 的字符", () => {
	assert.equal(typeof filenameToAlt, "function", "__test 必须导出 filenameToAlt");
	assert.equal(filenameToAlt("照片 1.png"), "照片 1");
	assert.equal(filenameToAlt("a.b.png"), "a.b", "按最后一个点去扩展名");
	assert.equal(filenameToAlt("README"), "README", "没有扩展名就原样");
	assert.equal(filenameToAlt("a]b.png"), "a\\]b", "右方括号必须转义，否则 markdown 结构被破坏");
	assert.equal(filenameToAlt("a\nb.png"), "a b", "换行不能留在 alt 里");
	assert.equal(filenameToAlt("a\r\nb.png"), "a b");
});

// ------------------------------------------------------------ 预览渲染

test("预览把 assets 图片渲染成宿主代理 URL 的 <img>", () => {
	const { tag, html } = render("![图](assets/a.png)");
	assert.ok(tag, `assets 图片必须画成 <img>，实际输出：${html}`);
	assert.equal(attr(tag, "src"), "/siyuan/asset?path=assets%2Fa.png");
	assert.equal(attr(tag, "alt"), "图");
	assert.equal(attr(tag, "loading"), "lazy");
	assert.equal(attr(tag, "decoding"), "async");
	assert.ok(!html.includes("sy-imgph"), "assets 路径不该再降级成占位符");
	assert.ok(!html.includes("demo-7f3a91"), "渲染结果里不得出现 token");
});

test("预览消费紧跟图片的行内 IAL 宽度，且不把它显示成文字", () => {
	const { html, style } = render('![图](assets/a.png){: style="width: 560px;"}');
	assert.match(style, /width:\s*560px/, `宽度应写进 img 的 style，实际：${style}`);
	assert.ok(!html.includes("{:"), "IAL 不该作为可见文本出现");
	assert.ok(!html.includes("560px}"), "IAL 的残留不该出现");

	// 真实用户文档的形态：段落有 　　 缩进，图片与 IAL 在同一行。
	const real = markdownToHtml('\u3000\u3000![](assets/clip_image002-20251224131619-agnb275.jpg){: style="width: 560px;"}');
	const realTag = imgTag(real);
	assert.ok(realTag, `真实文档形态也要出图，实际：${real}`);
	assert.equal(attr(realTag, "src"), "/siyuan/asset?path=assets%2Fclip_image002-20251224131619-agnb275.jpg");
	assert.match(attr(realTag, "style") ?? "", /width:\s*560px/);
	assert.ok(!real.includes("{:"), "真实文档形态下 IAL 也不能漏成文字");
});

test("预览的 IAL 只带出宽度，不泄漏其它属性", () => {
	const { html, style } = render('![图](assets/a.png){: id="b1" style="width: 560px; color: red;" custom="javascript:alert(1)"}');
	assert.match(style, /width:\s*560px/);
	for (const leaked of ["color", "red", "custom", "javascript", "b1", "{:"]) {
		assert.ok(!html.includes(leaked), `${leaked} 不得出现在预览 HTML 里`);
	}
});

test("预览的 IAL 非法宽度被丢弃", () => {
	const { html, style } = render('![图](assets/a.png){: style="width: expression(alert(1));"}');
	assert.ok(!/width/.test(style), `非法宽度不得写进 style，实际：${style}`);
	assert.ok(!html.includes("expression"));
	assert.ok(imgTag(html), "图片本身仍要画出来");
});

test("预览里 http / data 图片行为不变（只是补了 lazy）", () => {
	const http = render("![x](https://example.com/a.png)");
	assert.equal(attr(http.tag, "src"), "https://example.com/a.png");
	assert.equal(attr(http.tag, "loading"), "lazy");

	const data = render("![x](data:image/png;base64,iVBORw0KGgo=)");
	assert.equal(attr(data.tag, "src"), "data:image/png;base64,iVBORw0KGgo=");
	assert.equal(attr(data.tag, "loading"), "lazy");
});

test("非 assets 的相对路径仍降级为占位符", () => {
	const html = markdownToHtml("![图](pics/a.png)");
	assert.ok(html.includes("sy-imgph"), `未知相对路径仍应是占位符，实际：${html}`);
	assert.equal(imgTag(html), null, "不能对未知相对路径画 <img>");
});

test("图片 alt 里的 HTML 被转义", () => {
	const html = markdownToHtml("![<script>alert(1)</script>](assets/a.png)");
	assert.ok(!html.includes("<script>"), "alt 必须转义");
	assert.ok(imgTag(html), "图片仍要画出来");
});

test("预览与卡片一致识别转义说明和标题，后续格式解析不改写图片属性", () => {
	const { html, tag, style } = render('前文![图\\]片 **原样**](assets/a_b_c.png "标题"){: style="width: 50%;"}后文');
	assert.ok(tag, "有转义说明、标题和行内正文时仍须出图");
	assert.equal(attr(tag, "alt"), "图]片 **原样**");
	assert.equal(attr(tag, "src"), "/siyuan/asset?path=assets%2Fa_b_c.png");
	assert.equal(style, "width:50%");
	assert.ok(html.includes("前文") && html.includes("后文"));
	assert.ok(!html.includes("<strong>"), "替代文字中的 Markdown 标记不能改写 img 属性");
});

test("同一段里图片后的正文不被 IAL 消费逻辑吃掉", () => {
	const html = markdownToHtml('![图](assets/a.png){: style="width: 560px;"}后面还有正文');
	assert.ok(html.includes("后面还有正文"), "图片后的正文必须保留");
	assert.ok(!html.includes("{:"));
});

test("正文里写死的穿越路径，渲染出的代理 URL 会被宿主白名单拒绝（跨半边联测）", async () => {
	// 这是「文档内容不可信」这条攻击面：作者可以在书稿里手写任意相对路径，
	// 预览会把它变成 /siyuan/asset?path=…。渲染这一侧不做判断，但宿主必须拒绝。
	const { isServableAssetPath } = await import("../lib/host-utils.js");
	for (const src of [
		"assets/../../etc/passwd",
		"assets/..%2F..%2Fconf/conf.json",
		"assets/%2e%2e/%2e%2e/conf/conf.json",
		"assets/a.png?token=demo-7f3a91",
	]) {
		const tag = imgTag(markdownToHtml(`![x](${src})`));
		if (!tag) continue; // 没渲染成 <img> 的形态本来就不构成取图请求
		const url = attr(tag, "src");
		const search = new URL(url, "http://localhost").searchParams;
		const verdict = isServableAssetPath(search.get("path") ?? "");
		assert.equal(verdict.ok, false, `${src} 渲染成 ${url} 之后仍必须被宿主拒绝`);
	}
});
