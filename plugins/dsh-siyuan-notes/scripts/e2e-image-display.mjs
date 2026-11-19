/**
 * 图片显示的浏览器回归：使用真实 React、插件组件与 CSS，测试加载成功、失败、恢复和同段图片。
 * 仅读取既有思源图片；页面不能保存、上传或修改用户笔记。
 *
 * DSH_IMAGE_BROWSER_RUNTIME 指向安装了 react / react-dom 的测试目录，
 * DSH_PLAYWRIGHT_MODULE 指向 playwright 的包入口或包目录（本项目不新增运行依赖）。
 * DSH_IMAGE_CHECK_OUTPUT 可指定截图与结果的输出目录。
 */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSiYuanRoutes, forwardSiYuanApi, forwardSiYuanAsset } from "../lib/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const browserRuntime = process.env.DSH_IMAGE_BROWSER_RUNTIME || root;
const browserRequire = createRequire(path.join(path.resolve(browserRuntime), "package.json"));
const localRequire = createRequire(import.meta.url);
const { chromium } = localRequire(process.env.DSH_PLAYWRIGHT_MODULE || "playwright");
const output = process.env.DSH_IMAGE_CHECK_OUTPUT;
const settingsRoute = createSiYuanRoutes();
await settingsRoute.ensureLoaded();
const settings = settingsRoute.currentSettings();

const firstPath = "assets/image-20261108203513-4e1flbq.png";
const inlinePath = "assets/41ad067285706e6caebfad146623263823207712-20261108210503-7uwo8ca.jpg";
const block = await forwardSiYuanApi(settings, "/api/block/getBlockKramdown", { id: "20261108203255-ztkfrxr" });
assert.equal(block.ok, true, "读取原会话对应的图片块");
assert.equal(block.value.code, 0);
const inlineMarkdown = block.value.data.kramdown.replace(/^\s*\{:[^\n]*\}\s*$/gm, "").trim();
assert.ok(inlineMarkdown.includes(inlinePath), "实读内容仍包含截图里的行内图片");

const assets = new Map();
for (const name of [firstPath, inlinePath]) {
  const result = await forwardSiYuanAsset(settings, name);
  assert.equal(result.ok, true, "资源仍可通过插件代理读取");
  assets.set(name, result.value);
}
const files = [
  ["react", "react", "cjs/react.production.js"],
  ["react-dom", "react-dom", "cjs/react-dom.production.js"],
  ["scheduler", "scheduler", "cjs/scheduler.production.js"],
  ["react-dom/client", "react-dom", "cjs/react-dom-client.production.js"],
];
const factories = await Promise.all(files.map(async ([id, pkg, rel]) => {
  const directory = path.dirname(browserRequire.resolve(pkg + "/package.json"));
  const code = await readFile(path.join(directory, rel), "utf8");
  return JSON.stringify(id) + ":function(module,exports,require){\n" + code + "\n}";
}));
const runtime = "const factories={" + factories.join(",") + "};const cache={};window.testRequire=function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;};window.__ModuleLoader__={load({factory}){window.plugin=factory(window.testRequire);}};";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>思源图片显示验证</title><style>body{margin:0;font:14px system-ui;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;--dsw-alias-border-l1:#ddd;--dsw-alias-border-l2:#bbb;--dsw-alias-brand-primary:#1668dd}#root{height:100vh;display:flex}h1{font-size:18px}</style><div id="root"></div><script src="/runtime.js"></script><script src="/client.js"></script>');
    } else if (url.pathname === "/runtime.js" || url.pathname === "/client.js") {
      response.setHeader("Content-Type", "application/javascript; charset=utf-8");
      response.end(url.pathname === "/runtime.js" ? runtime : await readFile(path.join(root, "lib/client.js")));
    } else if (url.pathname === "/siyuan/asset") {
      const asset = assets.get(url.searchParams.get("path"));
      if (!asset) { response.writeHead(404); response.end(); return; }
      response.setHeader("Content-Type", asset.contentType);
      response.end(asset.buffer);
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch (error) {
    response.writeHead(500);
    response.end(String(error.message));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
let checks = 0;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(5000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.evaluate(({ text }) => {
    const React = window.testRequire("react");
    const renderer = window.testRequire("react-dom/client").createRoot(document.querySelector("#root"));
    window.plugin.apply({
      effect(fn) { fn(); },
      locale: { register() {}, bind() { throw new Error("使用插件默认中文"); } },
      slots: { inject() {}, register() {} },
    });
    function Harness() {
      const [doc, setDoc] = React.useState({ id: "image-display-check", title: "图片显示验证", text, savedText: text, blocks: [], loading: false, saving: false, stamp: 0 });
      const [view, setView] = React.useState("edit");
      window.checkText = () => doc.text;
      window.setCheckText = (next) => setDoc((current) => ({ ...current, text: next, savedText: next }));
      window.setCheckView = setView;
      const translate = (key, params) => {
        let value = window.plugin.__dicts.zh[key] ?? key;
        for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll("{" + name + "}", replacement);
        return value;
      };
      return React.createElement(window.plugin.__panes.EditorPane, {
        t: translate, client: {}, doc, setDoc, view, autoSave: false, indentOn: false,
        setView, setAutoSave() {}, onReload() {}, onRename() {}, onRemove() {},
        onNotice() {}, onSaved() {}, onIndentChange() {}, onQuote() {}, onCaret() {},
      });
    }
    renderer.render(React.createElement(Harness));
  }, { text: "![image](" + firstPath + ")\n\n" + inlineMarkdown });

  const check = async (label, condition) => { assert.ok(await condition(), label); checks++; console.log("PASS " + label); };
  const cards = page.locator(".sy-imgcard");
  await cards.first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll(".sy-imgcard-img")].every((img) => img.complete && img.naturalWidth > 0));
  await check("两种原始图片均已解码", async () => await cards.count() === 2);
  await check("图片成功时图未找到提示不可见", async () => await page.locator(".sy-imgcard-broken:visible").count() === 0);
  await check("行内图片旁的正文仍可编辑", async () => (await page.locator(".sy-seg-text").allTextContents()).length > 0 && await page.locator(".sy-seg-text").evaluateAll((nodes) => nodes.some((node) => node.value.includes("……不是"))));
  await check("初次渲染保持原文逐字一致", async () => await page.evaluate(() => window.checkText()) === "![image](" + firstPath + ")\n\n" + inlineMarkdown);
  if (output) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "image-display-success.png"), fullPage: true });
  }
  await page.evaluate(() => window.setCheckView("split"));
  await page.waitForFunction(() => document.querySelectorAll(".sy-preview img").length === 2 && [...document.querySelectorAll(".sy-preview img")].every((img) => img.complete && img.naturalWidth > 0));
  await check("分栏预览里的两张图片同样可见", async () => await page.locator(".sy-preview img:visible").count() === 2);
  await check("分栏预览没有错误占位", async () => await page.locator(".sy-preview .sy-imgbroken:visible").count() === 0);
  await page.evaluate(() => window.setCheckView("edit"));

  await page.evaluate(() => window.setCheckText("![缺失](assets/display-check-missing.png)\n\n后文"));
  await page.locator(".sy-imgcard-broken:visible").waitFor();
  await check("资源确实不存在时显示错误占位", async () => await page.locator(".sy-imgcard-broken:visible").count() === 1);
  await check("失败的原图被隐藏", async () => await page.locator(".sy-imgcard-img:visible").count() === 0);
  await page.evaluate((name) => window.setCheckText("![恢复](" + name + ")\n\n后文"), firstPath);
  await page.waitForFunction(() => document.querySelector(".sy-imgcard-img")?.naturalWidth > 0);
  await check("更换有效图片后错误态清除", async () => await page.locator(".sy-imgcard-broken:visible").count() === 0);

  const mixed = "前文![原图](" + firstPath + ")后文\r\n末段";
  await page.evaluate((text) => window.setCheckText(text), mixed);
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await check("改宽度仅改图片", async () => await page.evaluate(() => window.checkText()) === "前文![原图](" + firstPath + '){: style="width: 50%;"}后文\r\n末段');
  await page.getByRole("button", { name: "删除该图", exact: true }).click();
  await check("删除行内图片保留前后正文", async () => await page.evaluate(() => window.checkText()) === "前文后文\r\n末段");
  const unchanged = await forwardSiYuanApi(settings, "/api/block/getBlockKramdown", { id: "20261108203255-ztkfrxr" });
  await check("真实图片块在验证前后逐字一致", async () => unchanged.ok && unchanged.value.code === 0 && unchanged.value.data.kramdown === block.value.data.kramdown);
  await check("浏览器无脚本异常", async () => pageErrors.length === 0);
  if (output) await writeFile(path.join(output, "image-display-result.json"), JSON.stringify({ checks, pageErrors, resourceBytes: [...assets.values()].map((asset) => asset.buffer.length) }, null, 2));
  console.log("IMAGE-DISPLAY: OK (" + checks + " checks)");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
