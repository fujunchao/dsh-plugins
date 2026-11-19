// 使用本机已配置的思源连接，只创建本次专属文档/图片，finally 按返回 ID 清理。
// 不修改记忆库、连接配置或既有文档；备份与图片输入放在隔离临时目录。
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createSiYuanRoutes, createImageInsertTool, forwardSiYuanApi, forwardSiYuanAssetUpload, writeBackup, assetPathFromUpload } from "../lib/index.js";

const routes = createSiYuanRoutes();
await routes.ensureLoaded();
const settings = routes.currentSettings();
const call = (apiPath, payload) => forwardSiYuanApi(settings, apiPath, payload);
const api = async (apiPath, payload) => {
  const result = await call(apiPath, payload);
  assert.equal(result.ok, true, `${apiPath}: ${result.error?.message ?? "失败"}`);
  assert.equal(result.value.code, 0, `${apiPath}: ${result.value.msg ?? "失败"}`);
  return result.value.data;
};
const notebooks = (await api("/api/notebook/lsNotebooks", {})).notebooks;
const notebook = notebooks.find((item) => !item.closed && !item.encrypted && item.name !== "AI 记忆体");
assert.ok(notebook, "需要一个已打开的普通笔记本进行隔离验证");
const temp = await fsp.mkdtemp(path.join(tmpdir(), "dsh-siyuan-fix-e2e-"));
const oldHome = process.env.DSH_SIYUAN_NOTES_HOME;
process.env.DSH_SIYUAN_NOTES_HOME = temp;
const docs = [];
const assets = new Set();
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };
let failure;
try {
  const suffix = Date.now().toString(36);
  for (const name of ["A", "B"]) {
    const id = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/DSH-FIX-${suffix}-${name}`, markdown: `# 临时验证 ${name}\n\n普通锚点${name}\n\n> 引用锚点${name}\n\n尾段${name}` });
    assert.match(id, /^\d{14}-[a-z0-9]{7}$/);
    docs.push(id);
  }
  const read = async (id) => (await api("/api/block/getBlockKramdown", { id })).kramdown;
  const anchor = (text, token) => {
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.includes(token));
    for (let i = at + 1; at >= 0 && i < lines.length; i++) {
      const match = /^\s*(?:>\s*)*\{:\s*id="([^"]+)"/.exec(lines[i]);
      if (match) return match[1];
    }
    throw new Error(`找不到测试锚点 ${token}`);
  };
  const aBefore = await read(docs[0]);
  const bBefore = await read(docs[1]);
  const aAnchor = anchor(aBefore, "普通锚点A");
  const quoteAnchor = anchor(aBefore, "引用锚点A");
  const bAnchor = anchor(bBefore, "普通锚点B");
  const fileName = `DSH-FIX-${suffix}.png`;
  const pngPath = path.join(temp, fileName);
  await fsp.writeFile(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8o0AAAAASUVORK5CYII=", "base64"));
  const tool = createImageInsertTool({
    call,
    upload: async (input) => {
      const result = await forwardSiYuanAssetUpload(settings, input);
      if (result.ok) {
        const asset = assetPathFromUpload(result.value, fileName);
        if (asset) assets.add(asset);
      }
      return result;
    },
    readFile: (file) => fsp.readFile(file),
    editorContext: () => ({ docId: docs[0], title: "本次临时验证" }),
    backup: writeBackup,
  });
  const inserted = await tool.execute({ source: { kind: "path", value: pngPath }, after: aAnchor, alt: "普通插图", width: 560 });
  check(inserted.ok === true, `真实上传及插入通过读回确认：${inserted.error?.message ?? "成功"}`);
  check((await read(docs[0])).includes(inserted.blockId), "返回图片块确实位于目标文档");
  const source = { kind: "asset", value: inserted.assetPath };
  const foreign = await tool.execute({ source, doc: docs[0], after: bAnchor });
  check(foreign.ok === false && foreign.error.code === "invalid_anchor", "跨文档锚点被拒绝");
  check((await read(docs[1])) === bBefore, "另一篇临时文档未被误写");
  const invalidDoc = await tool.execute({ source, doc: aAnchor });
  check(invalidDoc.ok === false && invalidDoc.error.code === "invalid_document", "普通段落不能当作目标文档");
  const quoted = await tool.execute({ source, after: quoteAnchor, alt: "引用内插图" });
  check(quoted.ok === true, `引用容器内的图片校验成功：${quoted.error?.message ?? "成功"}`);
  const append = await tool.execute({ source, alt: "末尾插图" });
  check(append.ok === true, `末尾追加校验成功：${append.error?.message ?? "成功"}`);
  const snapshots = await fsp.readdir(path.join(temp, "siyuan-backups"));
  check(snapshots.length >= 3, "写前备份均位于隔离目录");
} catch (error) { failure = error; }
finally {
  for (const id of docs) {
    try { await api("/api/filetree/removeDocByID", { id }); check(true, "清理本次临时文档"); }
    catch (error) { failure ??= error; }
  }
  for (const asset of assets) {
    try {
      assert.ok(asset.startsWith("assets/DSH-FIX-") && !asset.includes("..") && !asset.includes("\\"));
      await api("/api/file/removeFile", { path: "/data/" + asset });
      check(true, "清理本次上传资源");
    } catch (error) { failure ??= error; }
  }
  if (oldHome === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
  else process.env.DSH_SIYUAN_NOTES_HOME = oldHome;
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(tmpdir()));
  await fsp.rm(temp, { recursive: true, force: true });
}
if (failure) throw failure;
console.log(`E2E-RELIABILITY: ${checks} 项通过，临时数据已清理`);
