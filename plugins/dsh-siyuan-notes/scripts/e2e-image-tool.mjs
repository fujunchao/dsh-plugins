// P2b 真机 E2E：宿主工具 `siyuan_note_insert_image` 的完整链路。
//
// 建临时文档 → 通过插件的**真实注册路径**（apply + 假 ctx）拿到工具 → 调工具（path kind，真图）
// → 读回 kramdown 断言内容与插入位置 → asset kind 复用 → 错误路径 → 清理（块/文档/资源/临时目录）。
//
// 依赖隔离：`DSH_SIYUAN_NOTES_HOME` 指向本脚本的临时目录，所以设置文件与**写前快照**都落在临时目录里，
// 不会污染用户的 ~/.dsh/siyuan-backups。内核侧（上传的资源、临时文档）在 finally 里删干净并复核。
//
// 用法：node scripts/e2e-image-tool.mjs

import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { api, kramdown, parseKramdown, removeDoc } from "../../tools/siyuan.mjs";
import * as host from "../lib/index.js";

const BASE = process.env.SY_BASE || "http://127.0.0.1:6806";
const TOKEN = process.env.SY_TOKEN || "demo-7f3a91";
const NB = process.env.SY_NB || "20251122094407-b4g4hhx";
const TOOL_NAME = "siyuan_note_insert_image";

const log = (...args) => console.log(...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function check(ok, label, extra) {
  if (ok) log("  PASS " + label);
  else {
    failures++;
    log("  FAIL " + label + (extra ? " :: " + extra : ""));
  }
}

// ---------------------------------------------------------------- 一张真 PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}
function makePng(width = 24, height = 16) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = (x * 9) & 0xff;
      raw[offset + 1] = (y * 11) & 0xff;
      raw[offset + 2] = 0x40;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 假 Cordis 上下文（真插件注册路径）

/** 与 test/activation.test.mjs 同款的最小 ctx：够 apply() 完整跑完并注册出工具。 */
function makeCtx() {
  const services = { webServer: undefined, tools: undefined, systemPrompt: undefined };
  const registered = { tools: [], routes: [] };
  const injected = new Set();
  const strictContext = (table, chain) =>
    new Proxy(
      {
        effect(fn) {
          const dispose = fn();
          return typeof dispose === "function" ? dispose : () => {};
        },
        inject(deps, callback) {
          for (const dep of deps) if (table[dep] === undefined) return undefined;
          callback(strictContext(table, new Set([...chain, ...deps])));
          return undefined;
        },
        get: (name) => table[name],
      },
      {
        get(target, prop, receiver) {
          if (typeof prop === "string" && !(prop in target)) {
            if (prop in table) return table[prop];
            if (chain.has(prop)) return undefined;
            throw new Error(`cannot get property "${prop}" without inject`);
          }
          return Reflect.get(target, prop, receiver);
        },
      },
    );
  services.webServer = {
    register(route) {
      registered.routes.push(route);
      return () => {};
    },
  };
  services.tools = {
    register(tool) {
      registered.tools.push(tool);
      return () => {};
    },
  };
  services.systemPrompt = {
    section: () => () => {},
    context: () => () => {},
  };
  return { ctx: strictContext(services, injected), registered, services };
}

/** 走一次插件的真实路由（用来上报"面板当前文档"）。 */
async function callRoute(handler, url, body, method = "POST") {
  const text = body === undefined ? "" : JSON.stringify(body);
  const { Readable } = await import("node:stream");
  const stream = Readable.from(text === "" ? [] : [Buffer.from(text, "utf8")]);
  stream.method = method;
  stream.url = url;
  stream.headers = { "content-type": "application/json" };
  const res = { status: undefined, headers: undefined, chunks: [], ended: false };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
    return res;
  };
  res.write = (chunk) => {
    if (chunk) res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };
  res.end = (payload) => {
    if (payload) res.chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
    res.ended = true;
    return res;
  };
  await handler(stream, res);
  const bodyText = Buffer.concat(res.chunks).toString("utf8");
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    /* 保持 null */
  }
  return { status: res.status, json, text: bodyText };
}

// ---------------------------------------------------------------- 客户端纯函数（闭环判定用）

/** 用与单测一致的方式装载 client.js，取它的纯函数（不改 lib/）。 */
function loadClientTestHelpers() {
  class StubComponent {
    constructor(props) {
      this.props = props ?? {};
      this.state = {};
    }
    setState(next) {
      this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) };
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
  globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory(() => ReactStub) }; } } };
  new Function("window", fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"))(globalThis.window);
  const helpers = bundle?.exports?.__test ?? {};
  if (typeof helpers.documentUnchanged !== "function" || typeof helpers.splitKramdown !== "function") {
    throw new Error("client bundle 没有导出 documentUnchanged / splitKramdown");
  }
  return helpers;
}

// ---------------------------------------------------------------- 主流程

(async () => {
  log("# P2b 真机 E2E：siyuan_note_insert_image");
  log(`  内核 ${BASE} / 笔记本 ${NB}`);

  // 依赖隔离：设置文件与快照都落在临时目录，用户 ~/.dsh 不被写。
  const home = mkdtempSync(path.join(tmpdir(), "dsh-e2e-image-tool-"));
  const previousHome = process.env.DSH_SIYUAN_NOTES_HOME;
  process.env.DSH_SIYUAN_NOTES_HOME = home;

  const version = await api("/api/system/version", {}).catch((error) => ({ code: -1, msg: String(error?.message ?? error) }));
  check(version.code === 0, "内核可达", JSON.stringify(version).slice(0, 160));
  if (version.code !== 0) {
    log("\nE2E-IMAGE-TOOL: SKIP（内核不可达）");
    if (previousHome === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
    else process.env.DSH_SIYUAN_NOTES_HOME = previousHome;
    process.exit(0);
  }

  const written = { docId: null, blockIds: [], assets: [] };
  const assetDirBefore = (await api("/api/file/readDir", { path: "/data/assets" })).data ?? [];

  try {
    // --- 注册：走真实 apply()，从 tools.register 里拿到工具（测的是注册路径，不是直接 new）
    const { ctx, registered } = makeCtx();
    host.apply(ctx, { baseUrl: BASE, token: TOKEN, timeoutSeconds: 60 });
    await sleep(50);
    const tool = registered.tools.find((item) => item.name === TOOL_NAME);
    check(Boolean(tool), "插件在 ctx.get('tools') 上注册了插图工具", registered.tools.map((t) => t.name).join(", "));
    check(registered.tools.length === 7, "工具总数 7（上下文 + 插图 + 记忆五件套）", String(registered.tools.length));
    const handler = registered.routes[0]?.handler;
    check(typeof handler === "function", "插件注册了 /siyuan 路由");
    if (!tool || typeof handler !== "function") throw new Error("工具或路由没注册成功，后续无法验证");

    // --- 建临时文档
    const created = await api("/api/filetree/createDocWithMd", {
      notebook: NB,
      path: "/DSH-E2E-IMAGE-TOOL-" + Date.now(),
      markdown: "# 标题\n\n这段文字是锚点\n\n尾段\n",
    });
    check(created.code === 0 && typeof created.data === "string", "建临时文档", JSON.stringify(created).slice(0, 200));
    written.docId = created.data;
    log(`  临时文档 ${written.docId}`);

    // 等索引/读模型就绪（工具本身不依赖 SQL，但锚点用的是 kramdown，立刻可读）
    let blocks = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      blocks = parseKramdown(await kramdown(written.docId));
      if (blocks.length >= 3) break;
      await sleep(250);
    }
    check(blocks.length === 3, "临时文档有 3 个块", JSON.stringify(blocks.map((b) => b.markdown)));

    // --- 面板当前文档：经真实路由上报 context，然后用**缺省 doc** 调工具
    const reported = await callRoute(handler, "/siyuan/context", { docId: written.docId, title: "E2E 临时文档", hpath: "/DSH-E2E" });
    check(reported.status === 200 && reported.json?.ok === true, "上报面板当前文档", reported.text.slice(0, 160));

    // --- 真图写到临时目录，用 path kind
    const png = makePng();
    const pngPath = path.join(home, "E2E 工具图.png");
    fs.writeFileSync(pngPath, png);
    check(fs.readFileSync(pngPath).length === png.length, "本地真图已就位", `${png.length} B`);

    const inserted = await tool.execute({
      source: { kind: "path", value: pngPath },
      after: "这段文字是锚点",
      alt: "E2E 工具图",
      width: 560,
    });
    check(inserted.ok === true, "工具返回成功（doc 缺省 = 面板当前文档）", JSON.stringify(inserted).slice(0, 300));
    check(inserted.docId === written.docId, "插入到了面板当前文档", String(inserted.docId));
    check(/^assets\/.+\.png$/.test(String(inserted.assetPath)), "返回了资源路径", String(inserted.assetPath));
    check(inserted.markdown === `![E2E 工具图](${inserted.assetPath}){: style="width: 560px;"}`, "返回的 markdown 形态正确", String(inserted.markdown));
    check(typeof inserted.blockId === "string" && inserted.blockId.length > 0, "返回了新块 id", String(inserted.blockId));
    if (inserted.assetPath) written.assets.push(inserted.assetPath);
    if (inserted.blockId) written.blockIds.push(inserted.blockId);

    // --- 写前快照真的落了盘，且在写入之前
    const backupDir = path.join(home, "siyuan-backups");
    const snapshots = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    check(snapshots.length >= 1, "写前快照落在隔离目录里", snapshots.join(", "));
    if (snapshots.length > 0) {
      const text = fs.readFileSync(path.join(backupDir, snapshots[snapshots.length - 1]), "utf8");
      check(text.includes("这段文字是锚点") && !text.includes(inserted.markdown), "快照内容是**插入之前**的整篇 kramdown");
    }
    check(fs.existsSync(path.join(home, "siyuan-notes.json")) === false, "没有把测试的 token 写进设置文件（未调用 config 路由）");

    // --- 读回：位置与内容
    let after = [];
    for (let attempt = 0; attempt < 14; attempt++) {
      after = parseKramdown(await kramdown(written.docId));
      if (after.some((block) => block.markdown.includes("assets/"))) break;
      await sleep(250);
    }
    const imageIndex = after.findIndex((block) => block.markdown.includes("assets/"));
    const anchorIndex = after.findIndex((block) => block.markdown === "这段文字是锚点");
    check(imageIndex !== -1, "读回里能看到图片块", JSON.stringify(after.map((b) => b.markdown)));
    check(imageIndex > anchorIndex && anchorIndex !== -1, "图片块正好在锚点块**之后**", `anchor=${anchorIndex} image=${imageIndex}`);
    check(after[imageIndex]?.markdown === inserted.markdown, "读回的图片行与工具返回的 markdown 完全一致", JSON.stringify(after[imageIndex]?.markdown));
    check(Number(after.length) === 4, "文档从 3 个块变成 4 个块", String(after.length));

    // --- asset kind：复用已上传的资源，不重复上传
    const reused = await tool.execute({ source: { kind: "asset", value: inserted.assetPath }, after: "尾段" });
    check(reused.ok === true, "asset kind 复用成功", JSON.stringify(reused).slice(0, 240));
    check(reused.assetPath === inserted.assetPath, "复用的资源路径不变");
    check(reused.markdown === `![${path.parse(inserted.assetPath).name}](${inserted.assetPath})`, "asset kind 的 alt 取资源文件名", String(reused.markdown));
    if (reused.blockId) written.blockIds.push(reused.blockId);
    const assetDirAfterAssetKind = (await api("/api/file/readDir", { path: "/data/assets" })).data ?? [];
    check(assetDirAfterAssetKind.length === assetDirBefore.length + 1, "整轮只多出 1 个资源文件（asset kind 没有重复上传）", `${assetDirBefore.length} -> ${assetDirAfterAssetKind.length}`);

    // --- 追加到末尾（不给 after）
    const appended = await tool.execute({ source: { kind: "asset", value: inserted.assetPath } });
    check(appended.ok === true && appended.after === undefined, "不给 after 时追加到末尾", JSON.stringify(appended).slice(0, 200));
    if (appended.blockId) written.blockIds.push(appended.blockId);
    const finalBlocks = parseKramdown(await kramdown(written.docId));
    check(finalBlocks[finalBlocks.length - 1]?.markdown.startsWith("!["), "末尾确实是新插的图片块", JSON.stringify(finalBlocks[finalBlocks.length - 1]?.markdown));

    // --- 真机错误路径（都不该写）
    const beforeErrors = parseKramdown(await kramdown(written.docId)).length;
    check(beforeErrors >= 1, "错误路径之前先记下块数", String(beforeErrors));
    const missing = await tool.execute({ source: { kind: "asset", value: inserted.assetPath }, after: "根本没有这段文字" });
    check(missing.ok === false && missing.error.code === "anchor_not_found", "文本锚点不存在 → anchor_not_found", JSON.stringify(missing).slice(0, 160));
    const traversal = await tool.execute({ source: { kind: "asset", value: "assets/../conf/conf.json" } });
    check(traversal.ok === false && traversal.error.code === "invalid_asset_path", "asset 穿越被拒 → invalid_asset_path", JSON.stringify(traversal).slice(0, 160));
    const badDoc = await tool.execute({ source: { kind: "asset", value: inserted.assetPath }, doc: "/绝对不存在的文档路径" });
    check(badDoc.ok === false && badDoc.error.code === "doc_not_found", "hpath 不存在 → doc_not_found", JSON.stringify(badDoc).slice(0, 160));
    const blockCountAfterErrors = parseKramdown(await kramdown(written.docId)).length;
    check(blockCountAfterErrors === beforeErrors, "错误路径一条都没写进文档", `${beforeErrors} -> ${blockCountAfterErrors}`);

    // --- 闭环：AI 插图之后，面板的"外部变更闸门"必须认出这次改动
    // （否则下一次保存会把这些新块当成"多余块"删掉 —— 这正是 P2a 要解决的隐患）
    const clientTest = loadClientTestHelpers();
    const diskText = await kramdown(written.docId);
    const diskBlocks = clientTest.splitKramdown(diskText).filter((block) => block.id != null);
    const bufferBeforeAiInsert = "# 标题\n\n这段文字是锚点\n\n尾段";
    check(
      clientTest.documentUnchanged(diskBlocks, bufferBeforeAiInsert) === false,
      "闸门认出「AI 插了图」：磁盘与面板缓冲区不一致 → 会弹提示而不是静默覆盖",
    );
    check(
      clientTest.documentUnchanged(diskBlocks, diskBlocks.map((block) => block.text).join("\n\n")) === true,
      "同一个磁盘内容当缓冲区 → 判定为「没变」（不误报）",
    );
    check(
      clientTest.documentUnchanged(diskBlocks, diskBlocks.map((block) => block.text).join("\n\n") + "\n\n") === true,
      "只多尾随空行不算外部改动（内核没有这个块）",
    );
    check(clientTest.documentUnchanged(diskBlocks, "") === false, "空文档基线也必须识别外部新增的内容");
    check(clientTest.documentUnchanged([], bufferBeforeAiInsert) === false, "磁盘是空的、缓冲区有内容 → 视为有差异（有基线时）");
  } catch (error) {
    failures++;
    log("  FAIL 异常中断 :: " + (error?.stack ?? String(error)));
  } finally {
    log("\n## 清理");
    for (const blockId of written.blockIds) {
      const removed = await api("/api/block/deleteBlock", { id: blockId }).catch(() => ({ code: -1 }));
      check(removed.code === 0, `删除插入的块 ${blockId}`);
    }
    if (written.docId) {
      const removed = await removeDoc(written.docId).catch(() => ({ envelope: { code: -1 } }));
      check(removed.envelope?.code === 0, "删除临时文档");
    }
    for (const assetPath of [...new Set(written.assets)]) {
      const removed = await api("/api/file/removeFile", { path: "/data/" + assetPath }).catch(() => ({ code: -1 }));
      check(removed.code === 0, `删除上传的资源 ${assetPath}`);
    }
    if (previousHome === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
    else process.env.DSH_SIYUAN_NOTES_HOME = previousHome;

    // 兜底清扫：按前缀扫残留（脚本被打断时也能收尾）
    log("\n## 兜底清扫");
    try {
      const listed = await api("/api/file/readDir", { path: "/data/assets" });
      const leftovers = (Array.isArray(listed.data) ? listed.data : [])
        .map((item) => String(item?.name ?? ""))
        .filter((name) => /E2E (工具图|二图)/.test(name) || /^E2E-工具图/.test(name));
      for (const name of leftovers) await api("/api/file/removeFile", { path: "/data/assets/" + name }).catch(() => {});
      const after = await api("/api/file/readDir", { path: "/data/assets" });
      const remaining = (Array.isArray(after.data) ? after.data : [])
        .map((item) => String(item?.name ?? ""))
        .filter((name) => /E2E (工具图|二图)/.test(name) || /^E2E-工具图/.test(name));
      check(remaining.length === 0, `资源目录没有本脚本的残留（本轮清掉 ${leftovers.length} 个）`, remaining.join(", "));
      const docs = await api("/api/query/sql", { stmt: "SELECT id FROM blocks WHERE type = 'd' AND hpath LIKE '/DSH-E2E-IMAGE-TOOL-%' LIMIT 20" });
      const rows = Array.isArray(docs.data) ? docs.data : [];
      for (const row of rows) await removeDoc(row.id).catch(() => {});
      await sleep(600);
      const again = await api("/api/query/sql", { stmt: "SELECT id FROM blocks WHERE type = 'd' AND hpath LIKE '/DSH-E2E-IMAGE-TOOL-%' LIMIT 20" });
      const left = Array.isArray(again.data) ? again.data : [];
      check(left.length === 0, `没有遗留的临时文档（本轮清掉 ${rows.length} 个）`, left.map((row) => row.id).join(", "));
    } catch (error) {
      check(false, "兜底清扫", String(error?.message ?? error));
    }

    rmSync(home, { recursive: true, force: true });
    log(failures === 0 ? "\nE2E-IMAGE-TOOL: OK" : `\nE2E-IMAGE-TOOL: ${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
