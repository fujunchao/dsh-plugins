// 真实内核、真实 React 和真实 Protyle 联调，仅编辑本次创建的临时文档。
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSiYuanRoutes, forwardSiYuanApi, createTextInsertTool, createImageInsertTool, forwardSiYuanAssetUpload, currentEditorContext, writeBackup } from "../lib/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const localRequire = createRequire(import.meta.url);
const runtimeRequire = createRequire(path.join(process.env.DSH_NATIVE_BROWSER_RUNTIME || path.resolve(root, "../.local/dsh-siyuan-image-20261109-182530/browser-runtime"), "package.json"));
const { chromium } = localRequire(process.env.DSH_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const output = path.resolve(process.env.DSH_NATIVE_CHECK_OUTPUT || path.join(root, "../.local/siyuan-native-20261109"));
await mkdir(output, { recursive: true });
const initial = createSiYuanRoutes(); await initial.ensureLoaded();
const settings = initial.currentSettings();
const api = async (apiPath, payload) => {
  const r = await forwardSiYuanApi(settings, apiPath, payload);
  assert.ok(r.ok && r.value?.code === 0, apiPath + ": " + (r.error?.message || r.value?.msg));
  return r.value.data;
};
const notebooks = (await api("/api/notebook/lsNotebooks", {})).notebooks;
const notebook = notebooks.find(x => !x.closed && !x.encrypted && x.name !== "AI 记忆体");
assert.ok(notebook, "需要普通笔记本进行临时文档验证");
const temporary = await mkdtemp(path.join(os.tmpdir(), "dsh-native-e2e-"));
const previousHome = process.env.DSH_SIYUAN_NOTES_HOME;
process.env.DSH_SIYUAN_NOTES_HOME = temporary;
const docs = [];
const assets = new Set();
const results = [];
const check = (name, condition = true) => { assert.ok(condition, name); results.push(name); console.log("PASS " + name); };
let browser, server, routes, failure;
try {
  for (const label of ["A", "B"]) {
    docs.push(await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/DSH-NATIVE-${Date.now()}-${label}`, markdown: `# 原生编辑验证 ${label}\n\n第一段测试文字\n\n第二段保留块标识\n\n- 列表项一\n- 列表项二\n\n| 名称 | 内容 |\n| --- | --- |\n| 表格 | 原生编辑 |` }));
  }
  const before = (await api("/api/block/getBlockKramdown", { id: docs[0] })).kramdown;
  const beforeB = (await api("/api/block/getBlockKramdown", { id: docs[1] })).kramdown;
  const beforeIds = [...before.matchAll(/id="(\d{14}-[a-z0-9]{7})"/g)].map(x => x[1]);
  routes = createSiYuanRoutes({ config: settings });
  const files = [["react", "react", "cjs/react.production.js"], ["react-dom", "react-dom", "cjs/react-dom.production.js"], ["scheduler", "scheduler", "cjs/scheduler.production.js"], ["react-dom/client", "react-dom", "cjs/react-dom-client.production.js"]];
  const factories = await Promise.all(files.map(async ([id, pkg, rel]) => JSON.stringify(id) + ":function(module,exports,require){\n" + await readFile(path.join(path.dirname(runtimeRequire.resolve(pkg + "/package.json")), rel), "utf8") + "\n}"));
  const runtime = "const factories={" + factories.join(",") + "};const cache={};window.testRequire=function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;};window.__ModuleLoader__={load({factory}){window.plugin=factory(window.testRequire);}};";
  const reply = (res, data) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, value: data })); };
  let layout = { version: 1, panes: [{ view: "edit", indentOn: false, autoSave: false, tabs: docs.map((id, i) => ({ docId: id, title: "原生验证 " + (i ? "B" : "A"), hpath: "/验证" })), activeTabIndex: 0 }], activePaneIndex: 0, expanded: {} };
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>DSH 原生编辑器验收</title><style>body{margin:0;font:14px system-ui;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-bg-layer-2:#f2f2f2;--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;--dsw-alias-border-l1:#ddd;--dsw-alias-border-l2:#bbb;--dsw-alias-brand-primary:#1668dd}#root{height:100vh;display:flex}.test-chat{display:flex;flex-direction:column;height:100%;padding:12px;gap:8px}.test-chat textarea{flex:1;resize:none}</style><div id="root"></div><script src="/runtime.js"></script><script src="/client.js"></script>');
      } else if (url.pathname === "/runtime.js" || url.pathname === "/client.js") {
        res.setHeader("content-type", "application/javascript"); res.end(url.pathname === "/runtime.js" ? runtime : await readFile(path.join(root, "lib/client.js")));
      } else if (url.pathname === "/siyuan/layout") {
        if (req.method === "POST") { let body="";for await(const chunk of req)body+=chunk;layout=JSON.parse(body);reply(res,{saved:true}); }
        else reply(res, { layout });
      } else await routes.handler(req, res);
    } catch (error) { res.statusCode = 500; res.end(error.message); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const interactive = process.env.DSH_NATIVE_INTERACTIVE === "1";
  browser = await chromium.launch({ channel: "chrome", headless: !interactive });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", async response => {
    if(new URL(response.url()).pathname!=="/upload")return;
    try{const value=await response.json();for(const asset of Object.values(value.data?.succMap||{}))if(typeof asset==="string"&&asset.startsWith("assets/DSH-NATIVE-"))assets.add(asset);}catch{}
  });
  page.on("console", e => { if (e.type() === "error") console.log("BROWSER " + e.text().slice(0, 300)); });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.evaluate(() => {
    const React = window.testRequire("react");
    window.plugin.apply({ effect(fn) { fn(); }, locale: { register() {}, bind() { throw new Error("中文默认"); } }, slots: { inject() {}, register() {} } });
    const renderer = window.testRequire("react-dom/client").createRoot(document.querySelector("#root"));
    window.unmountNativePanel = () => renderer.unmount();
    const t = (key, params) => { let v=window.plugin.__dicts.zh[key]??key;for(const[k,x]of Object.entries(params??{}))v=v.replaceAll("{"+k+"}",x);return v; };
    const state = { ids: ["test-session"], byId: { "test-session": { id: "test-session", retainedBy: { mainView: 1 } } } };
    function Chat() {
      const [value,setValue] = React.useState("");
      const actions = React.useMemo(() => ({ captureInsertion: () => ({}), insertText: (text) => { setValue(old => old + text); return true; } }), []);
      return React.createElement("div", { className:"test-chat" }, React.createElement(window.plugin.__panes.ComposerBridge, { sessionId:"test-session",inputActions:actions }), React.createElement("strong",null,"DSH 引用输入验证"), React.createElement("textarea",{value,readOnly:true,"aria-label":"引用输入"}));
    }
    const props={t,useSessions:selector=>selector(state),sessions:{retain:()=>({sessionId:"test-session",release(){}})},SessionProvider:({children})=>children,renderFactorySlot:()=>React.createElement(Chat)};
    renderer.render(React.createElement(window.plugin.__panes.PanelPage,props));
  });
  await page.getByRole("button", { name: "原生编辑（试用）" }).click();
  if(interactive)console.log("等待用户在已打开的 Chrome 测试页完成思源锁屏登录");
  await page.getByText("原生编辑 · 自动保存到思源", { exact: true }).waitFor({ timeout: interactive ? 600000 : 45000 });
  const frame = page.frames().find(f => f.url().includes("/stage/build/desktop/"));
  assert.ok(frame);
  check("真实 PanelPage 切换到原生 Protyle");
  const first = frame.locator('#dsh-native-editor [data-type="NodeParagraph"] [contenteditable="true"]').filter({ hasText: "第一段测试文字" }).first();
  const blockId = await first.evaluate(el=>el.closest("[data-node-id]").dataset.nodeId);
  await first.click(); await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "，中文输入验证", selectionStart: 7, selectionEnd: 7 });
  await cdp.send("Input.insertText", { text: "，中文输入验证" });
  await page.getByText("原生编辑 · 已保存到思源", { exact: true }).waitFor();
  let after = (await api("/api/block/getBlockKramdown", { id: docs[0] })).kramdown;
  check("原生中文输入已落到真实内核", after.includes("中文输入验证"));
  check("段落、嵌套列表、表格原有块 ID 保持", beforeIds.every(id=>after.includes(id)));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1200);
  after = (await api("/api/block/getBlockKramdown", { id: docs[0] })).kramdown;
  check("原生撤销同步到内核", !after.includes("中文输入验证"));
  await page.keyboard.press("Control+y"); await page.waitForTimeout(1200);
  check("原生重做同步到内核", (await api("/api/block/getBlockKramdown",{id:docs[0]})).kramdown.includes("中文输入验证"));
  await first.evaluate(el => { const range=document.createRange();range.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(range); });
  await frame.getByRole("button", { name: "引用到 DSH 对话", exact: true }).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="引用输入"]').value.includes("中文输入验证"));
  check("原生选区通过真实 PanelPage 引用处理进入 DSH 输入框", (await page.getByRole("textbox",{name:"引用输入"}).inputValue()).includes(blockId));
  await page.waitForTimeout(700);
  const context = currentEditorContext();
  check("AI 上下文包含当前文档、块 ID 与选区", context.docId===docs[0] && context.blockId===blockId && context.selection?.text.includes("中文输入验证"));
  const textTool = createTextInsertTool({call:(p,x)=>forwardSiYuanApi(settings,p,x),backup:writeBackup,editorContext:()=>({docId:docs[0],title:"原生验证 A"})});
  const inserted = await textTool.execute({ text: "AI 插入验证 <原样保留> & **不是格式**", after:blockId });
  check("AI 文字插入备份并确认归属", inserted.ok===true);
  await frame.getByText("AI 插入验证 <原样保留> & **不是格式**", {exact:true}).waitFor();
  check("AI 插入通过原生 WebSocket 自动显示");
  const refused=await textTool.execute({text:"不得写错文档",doc:docs[1],after:blockId});
  check("AI 跨文档锚点被拒绝",refused.ok===false&&refused.error.code==="invalid_anchor");
  check("另一篇临时文档不变",(await api("/api/block/getBlockKramdown",{id:docs[1]})).kramdown===beforeB);
  const imageTool=createImageInsertTool({call:(p,x)=>forwardSiYuanApi(settings,p,x),upload:input=>forwardSiYuanAssetUpload(settings,input),readFile,editorContext:()=>({docId:docs[0],title:"原生验证 A"}),backup:writeBackup});
  const imagePath=path.join(temporary,"DSH-NATIVE-"+Date.now()+".png");
  await writeFile(imagePath,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8o0AAAAASUVORK5CYII=","base64"));
  const imageResult=await imageTool.execute({source:{kind:"path",value:imagePath},after:inserted.blockId,alt:"原生图片验证",width:120});
  if(imageResult.assetPath)assets.add(imageResult.assetPath);
  check("AI 图片上传与插入确认",imageResult.ok===true);
  await frame.waitForFunction(()=>[...document.querySelectorAll('#dsh-native-editor img')].some(x=>x.complete&&x.naturalWidth>0));
  check("资源通过原生页面解码显示");
  await frame.evaluate(({blockId,imageId})=>{
    const editor=document.querySelector('#dsh-native-editor .protyle-wysiwyg');
    const start=editor.querySelector(`[data-node-id="${blockId}"] [contenteditable="true"]`);
    const end=[...editor.querySelectorAll('[data-type="NodeParagraph"] [contenteditable="true"]')].find(x=>x.textContent.includes("第二段保留块标识"));
    const range=document.createRange();range.setStart(start,0);range.setEnd(end,end.childNodes.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  },{blockId,imageId:imageResult.blockId});
  await frame.getByRole("button",{name:"引用到 DSH 对话",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="引用输入"]').value.includes("第二段保留块标识"));
  check("跨文字、图片和下一段的统一选区可以引用");
  const pasteName="DSH-NATIVE-PASTE-"+Date.now()+".png";
  await first.click();await page.keyboard.press("End");
  await first.evaluate((element,name)=>{
    const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8o0AAAAASUVORK5CYII="),c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],name,{type:"image/png"}));
    element.dispatchEvent(new ClipboardEvent("paste",{clipboardData:transfer,bubbles:true,cancelable:true}));
  },pasteName);
  await frame.waitForFunction(()=>[...document.querySelectorAll('#dsh-native-editor img')].filter(x=>x.complete&&x.naturalWidth>0).length>=2);
  await page.getByText("原生编辑 · 已保存到思源",{exact:true}).waitFor();
  check("图片粘贴事件经原生上传并插入真实文档");
  const tableCell=frame.locator('#dsh-native-editor [data-type="NodeTable"] td').filter({hasText:"原生编辑"}).first();
  await tableCell.click();await page.keyboard.press("End");await page.keyboard.type("-table");
  await page.getByText("原生编辑 · 已保存到思源",{exact:true}).waitFor();
  check("原生表格单元格编辑落盘",(await api("/api/block/getBlockKramdown",{id:docs[0]})).kramdown.includes("-table"));
  await page.locator('.sy-tabpill').filter({hasText:"原生验证 B"}).click();
  await page.getByRole("button",{name:"原生编辑（试用）"}).waitFor();
  check("切换标签等待原生保存后离开");
  await page.locator('.sy-tabpill').filter({hasText:"DSH-NATIVE-"}).first().click();
  await page.getByText("原生编辑 · 自动保存到思源",{exact:true}).waitFor({timeout:45000});
  await page.screenshot({path:path.join(output,"native-editor-success.png")});
  await page.getByRole("button",{name:"切回 Markdown",exact:true}).click();
  await page.getByRole("button",{name:"原生编辑（试用）"}).waitFor();
  check("切回 Markdown 重新读取原生与 AI 新内容",await page.locator(".sy-seg-text").evaluateAll(els=>els.map(x=>x.value).join("")).then(x=>x.includes("AI 插入验证")));
  await page.waitForFunction(()=>!document.querySelector(".sy-native-frame"));
  check("原生会话已卸载");
  await page.getByRole("button",{name:"原生编辑（试用）"}).click();
  await page.getByText("原生编辑 · 自动保存到思源",{exact:true}).waitFor({timeout:45000});
  const reopened=page.frames().find(f=>f.url().includes("/stage/build/desktop/"));
  check("同进程重新打开复用已登录会话",!(await reopened.getByRole("heading",{name:"登录思源原生编辑器"}).count()));
  const paragraph=reopened.locator('#dsh-native-editor [data-type="NodeParagraph"] [contenteditable="true"]').filter({hasText:"第一段测试文字"}).first();
  await paragraph.click();await page.keyboard.press("End");await page.keyboard.type("-flush-on-leave");
  await page.evaluate(()=>window.unmountNativePanel());
  await page.waitForFunction(()=>!document.querySelector(".sy-native-frame"));
  check("离开整个面板仍等待原生事务完成",(await api("/api/block/getBlockKramdown",{id:docs[0]})).kramdown.includes("flush-on-leave"));
  check("浏览器无脚本异常",errors.length===0);
} catch(error) { failure=error; console.error(error); }
finally {
  await browser?.close(); routes?.dispose(); initial.dispose();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  for(const id of docs) await api("/api/filetree/removeDocByID",{id}).catch(error=>{failure??=error;});
  for(const asset of assets){assert.ok(asset.startsWith("assets/DSH-NATIVE-")&&!asset.includes(".."));await api("/api/file/removeFile",{path:"/data/"+asset}).catch(error=>{failure??=error;});}
  if(previousHome===undefined)delete process.env.DSH_SIYUAN_NOTES_HOME;else process.env.DSH_SIYUAN_NOTES_HOME=previousHome;
  assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));await rm(temporary,{recursive:true,force:true});
  await writeFile(path.join(output,"native-editor-result.json"),JSON.stringify({passed:results.length,checks:results,error:failure?.message||null},null,2));
}
if(failure)throw failure;
console.log(`NATIVE E2E: ${results.length} 项通过，临时文档及资源已清理`);
