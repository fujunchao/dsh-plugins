// 图片功能（第十八轮）的真机端到端验证：对真实思源内核建临时文档 -> 上传一张真图 ->
// 插入 ![alt](assets/…) -> 读回断言 kramdown 一致 -> 经宿主 /siyuan/asset 代理取图并逐字节比对 ->
// 删块、删文档、/api/file/removeFile 清理资源。
//
// 用法：
//   node scripts/e2e-image.mjs                      # 默认内核 127.0.0.1:6806，载体自动选择
//   DSH_BASE=http://127.0.0.1:57907 node scripts/e2e-image.mjs   # 指定运行中的 DSH
//   DSH_BASE=off node scripts/e2e-image.mjs         # 强制只用本地临时载体
//
// 「载体」有两路，脚本会明确打印用的是哪一路：
//   A) live —— 运行中的 DSH 进程的 /siyuan/asset 路由（宿主半边改完必须重启应用才会生效）；
//   B) local —— 用 lib/index.js 的真实路由代码起一个临时 http server 对真内核跑同一组断言。
//      这一路验的是「路由代码 + 真内核」，只差 live 的最后一跳；两路跑的是同一份 handler。
//
// 用户库是真库：所有写入（文档 / 块 / 资源文件）都在 finally 里清理并复核。

import fs, { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { api, kramdown, parseKramdown, removeDoc } from "../../tools/siyuan.mjs";
import * as host from "../lib/index.js";

const BASE = process.env.SY_BASE || "http://127.0.0.1:6806";
const TOKEN = process.env.SY_TOKEN || "demo-7f3a91";
const NB = process.env.SY_NB || "20251122094407-b4g4hhx";
// 运行中的 DSH 地址：显式 DSH_BASE 优先；其次用 harness 注入的 DSH_WEB_URL（DSH 每次启动端口可能变）；
// 最后才是历史默认端口。端口写死过一次就踩过坑：重启后端口从 57907 变成 49576。
const DSH_BASE = process.env.DSH_BASE || process.env.DSH_WEB_URL || "http://127.0.0.1:57907";

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

// ---------------------------------------------------------------- 一张真图

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 现造一张真 PNG（不用记 base64，字节数也不像占位符那么可疑）。 */
function makePng(width = 26, height = 18) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = (x * 8) & 0xff;
      raw[offset + 1] = (y * 8) & 0xff;
      raw[offset + 2] = 0x80;
    }
  }
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- 内核写入

/** multipart 上传到内核资源库（与浏览器→宿主→内核同形的请求）。 */
async function uploadAsset(buffer, fileName) {
  const boundary = "----dshE2E" + Date.now().toString(16);
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="assetsDirPath"\r\n\r\n/assets/\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file[]"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), buffer, Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")]);
  const response = await fetch(`${BASE}/api/asset/upload`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Authorization: `Token ${TOKEN}` },
    body,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保持 null */
  }
  return { status: response.status, json, text };
}

/** 走载体的上传路由（浏览器形状：不带 token，multipart 原样）。 */
async function uploadThroughCarrier(carrierBase, buffer, fileName) {
  const boundary = "----dshCarrier" + Date.now().toString(16);
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="assetsDirPath"\r\n\r\n/assets/\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file[]"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), buffer, Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")]);
  const response = await fetch(`${carrierBase}/siyuan/asset/upload`, {
    method: "POST",
    // 刻意不带 Authorization：浏览器就是这么发的，token 由宿主补。
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保持 null */
  }
  return { status: response.status, json, text };
}

/** 读文档 kramdown，直到稳定（内核读模型滞后 0.3–1.5 s）。 */
async function settledKramdown(docId, predicate, attempts = 14) {
  let previous = null;
  let stable = 0;
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await kramdown(docId).catch(() => "");
    if (last === previous) {
      stable++;
      if (stable >= 2 && (!predicate || predicate(last))) return last;
    } else {
      stable = 0;
      previous = last;
    }
    await sleep(250);
  }
  return last;
}

// ---------------------------------------------------------------- 载体

/** 起一个临时 http server，把 lib/index.js 的真实路由代码挂上去（只在本机回环上监听）。 */
async function startLocalCarrier() {
  const home = mkdtempSync(path.join(tmpdir(), "siyuan-e2e-image-"));
  const previousHome = process.env.DSH_SIYUAN_NOTES_HOME;
  process.env.DSH_SIYUAN_NOTES_HOME = home;
  const routes = host.createSiYuanRoutes({ config: { baseUrl: BASE, token: TOKEN, timeoutSeconds: 20 } });
  if (previousHome === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
  else process.env.DSH_SIYUAN_NOTES_HOME = previousHome;
  const server = http.createServer((req, res) => {
    routes.handler(req, res).catch((error) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "carrier_error", message: String(error?.message ?? error) } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    kind: "local",
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** 判断运行中的 DSH 是否已经有 /siyuan/asset（宿主半边改完要重启应用才生效）。 */
async function liveCarrierState() {
  try {
    const state = await fetch(`${DSH_BASE}/siyuan/state`, { signal: AbortSignal.timeout(4000) });
    if (!state.ok) return { available: false, why: `GET /siyuan/state -> HTTP ${state.status}` };
    const asset = await fetch(`${DSH_BASE}/siyuan/asset?path=${encodeURIComponent("assets/__probe__.png")}`, {
      signal: AbortSignal.timeout(4000),
    });
    const text = await asset.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 保持 null */
    }
    if (json?.error?.code === "not_found") {
      return { available: false, why: "运行中的 DSH 还没有 /siyuan/asset 路由（宿主半边需要重启应用）" };
    }
    if (json?.error?.code === "asset_not_found" || asset.status === 404) {
      return { available: true, base: DSH_BASE };
    }
    return { available: false, why: `GET /siyuan/asset 的响应无法识别：HTTP ${asset.status} ${text.slice(0, 120)}` };
  } catch (error) {
    return { available: false, why: `DSH 不可达：${error?.message ?? error}` };
  }
}

// ---------------------------------------------------------------- 主流程

(async () => {
  log("# 真机图片 E2E");
  log(`  内核   ${BASE}`);
  log(`  笔记本 ${NB}`);
  log(`  DSH    ${DSH_BASE}`);

  const version = await api("/api/system/version", {}).catch((error) => ({ code: -1, msg: String(error?.message ?? error) }));
  check(version.code === 0, "内核可达", JSON.stringify(version).slice(0, 160));
  if (version.code !== 0 && process.env.SY_E2E_SKIP === "1") {
    log("\nE2E-IMAGE: SKIP（内核不可达，且 SY_E2E_SKIP=1）");
    process.exit(0);
  }

  // 载体选择：活体 DSH 优先，拿不到就退回「真实路由代码 + 真内核」的本地临时载体。
  let carrier = null;
  const live = process.env.DSH_BASE === "off" ? { available: false, why: "DSH_BASE=off" } : await liveCarrierState();
  if (live.available) {
    carrier = { kind: "live", base: live.base, async close() {} };
    log("  载体   A) 运行中的 DSH（活体路由）");
  } else {
    log(`  载体   B) 本地临时载体（真实路由代码 + 真内核）—— 原因：${live.why}`);
    log("         注：活体 DSH 的 /siyuan/asset 在用户重启应用前一定不可用，这一路替代不了最后一跳。");
    carrier = await startLocalCarrier();
  }

  const source = makePng();
  const fileName = `E2E-图片-${Date.now()}.png`;
  /** @type {{docId?: string, blockId?: string, relPath?: string, dataPath?: string}} */
  const written = {};

  try {
    // --- 0. 源图自身是一个合法 PNG（先证明它不是随便一串字节）
    check(source.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "源图是 PNG（签名正确）");
    check(source.length > 100, "源图不是空壳", `${source.length} B`);

    // --- 1. 建临时文档
    const created = await api("/api/filetree/createDocWithMd", {
      notebook: NB,
      path: "/DSH-E2E-IMAGE-" + Date.now(),
      markdown: "第一段正文（图片 E2E 的锚点）\n",
    });
    check(created.code === 0 && typeof created.data === "string", "建临时文档", JSON.stringify(created).slice(0, 200));
    written.docId = created.data;
    log(`  临时文档 ${written.docId}`);

    const anchorBlocks = parseKramdown(await kramdown(written.docId));
    const anchorId = anchorBlocks[0]?.id ?? null;
    check(anchorId !== null, "拿到锚点块 id（文档首块）", String(anchorId));

    // --- 2. 上传真图（multipart，中文件名：真实库里 7/50 的资源路径是中文名）
    const uploaded = await uploadAsset(source, fileName);
    check(uploaded.status === 200 && uploaded.json?.code === 0, "上传返回 code 0", JSON.stringify(uploaded.json ?? uploaded.text).slice(0, 240));
    const relPath = uploaded.json?.data?.succMap?.[fileName] ?? uploaded.json?.data?.succFiles?.[0]?.path ?? "";
    check(/^assets\/.+\.png$/.test(relPath), "拿到 assets/ 下的资源路径", relPath || JSON.stringify(uploaded.json ?? {}).slice(0, 240));
    written.relPath = relPath;
    written.dataPath = "/data/" + relPath;
    log(`  资源路径 ${relPath}（源图 ${source.length} B）`);

    // --- 2b. 同一枚 multipart 从「浏览器那一侧」再走一遍：经载体上传路由（不带 token）
    //     文件名故意带一个**普通空格**：宿主白名单放行空格，整条链路（上传 -> 资源路径 ->
    //     逐段编码 -> 内核取图）必须真的跑得通，否则「放行」只是纸面上的。
    const second = makePng(31, 13);
    const secondName = `E2E-二图 空格-${Date.now()}.png`;
    const carrierUpload = await uploadThroughCarrier(carrier.base, second, secondName);
    check(
      carrierUpload.status === 200 && carrierUpload.json?.ok === true && carrierUpload.json?.value?.code === 0,
      "经载体上传路由（浏览器形状、不带 token）拿到 code 0",
      `${carrierUpload.status} ${String(carrierUpload.text).slice(0, 200)}`,
    );
    const secondRel = carrierUpload.json?.value?.data?.succMap?.[secondName] ?? carrierUpload.json?.value?.data?.succFiles?.[0]?.path ?? "";
    check(/^assets\/.+\.png$/.test(secondRel), "载体上传拿到资源路径", secondRel || String(carrierUpload.text).slice(0, 200));
    if (secondRel) {
      written.extraRelPath = secondRel;
      written.extraDataPath = "/data/" + secondRel;
      const fetched = await fetch(carrier.base + "/siyuan/asset?path=" + encodeURIComponent(secondRel), { signal: AbortSignal.timeout(20000) });
      const bytes = Buffer.from(await fetched.arrayBuffer());
      check(
        fetched.status === 200 && /^image\//.test(fetched.headers.get("content-type") ?? "") && Buffer.compare(bytes, second) === 0,
        `经载体上传、文件名带空格的第二张图也能取回且字节一致（${secondRel}）`,
        `HTTP ${fetched.status} ${bytes.length} vs ${second.length}`,
      );
    }

    // --- 2c. 上限与类型闸门（走载体，触不到内核）
    const tooLarge = Buffer.alloc(33 * 1024 * 1024, 0x41);
    const oversized = await uploadThroughCarrier(carrier.base, tooLarge, "too-big.png");
    check(
      oversized.status === 413 && oversized.json?.error?.code === "body_too_large",
      "33MB 上传被 413 body_too_large 拒绝",
      `${oversized.status} ${String(oversized.text).slice(0, 160)}`,
    );
    const notMultipart = await fetch(`${carrier.base}/siyuan/asset/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      signal: AbortSignal.timeout(20000),
    });
    check(
      notMultipart.status === 400 && (await notMultipart.json()).error?.code === "invalid_content_type",
      "非 multipart 上传被 400 invalid_content_type 拒绝",
    );

    // --- 3. insertBlock 插入图片块
    const alt = fileName.replace(/\.[^.]+$/, "");
    const markdown = `![${alt}](${relPath})`;
    const inserted = await api("/api/block/insertBlock", {
      previousID: anchorId,
      dataType: "markdown",
      data: markdown,
    });
    check(inserted.code === 0, "insertBlock 返回 code 0", JSON.stringify(inserted).slice(0, 200));
    written.blockId = inserted.data?.[0]?.doOperations?.find?.((op) => op.action === "insert")?.id ?? null;
    check(typeof written.blockId === "string", "拿到新块 id", String(written.blockId));

    // --- 4. 读回断言 kramdown 一致
    const readBack = await settledKramdown(written.docId, (text) => text.includes(relPath));
    check(readBack.includes(markdown), "读回的 kramdown 与写入完全一致", readBack.replace(/\n/g, "\\n").slice(0, 300));
    const imageBlocks = parseKramdown(readBack).filter((block) => block.markdown.includes(relPath));
    check(
      imageBlocks.length === 1 && imageBlocks[0].markdown === markdown,
      "插件自己的块解析器看到的就是那一个图片块",
      JSON.stringify(imageBlocks.map((block) => block.markdown)),
    );

    // --- 5. 客户端会把这一行渲染成什么 URL（同一份 bundle 的纯函数）
    const clientBundle = loadClientBundle();
    const proxyUrl = clientBundle.assetPreviewUrl(relPath);
    check(proxyUrl === "/siyuan/asset?path=" + encodeURIComponent(relPath), "客户端拼出的代理 URL 形状正确", proxyUrl);
    check(!proxyUrl.includes(TOKEN) && !proxyUrl.toLowerCase().includes("token="), "代理 URL 里没有 token");

    // --- 6. 经载体代理取图，逐字节比对
    const proxied = await fetch(carrier.base + proxyUrl, { signal: AbortSignal.timeout(20000) });
    const proxiedBytes = Buffer.from(await proxied.arrayBuffer());
    const contentType = proxied.headers.get("content-type") ?? "";
    const headerText = JSON.stringify([...proxied.headers.entries()]);
    check(proxied.status === 200, "代理返回 200", `HTTP ${proxied.status} ${proxiedBytes.subarray(0, 80).toString("utf8")}`);
    check(/^image\//.test(contentType), "代理回的 Content-Type 是 image/*", contentType || "<空>");
    check(proxiedBytes.length === source.length, "代理回来的字节数与源文件一致", `${proxiedBytes.length} vs ${source.length}`);
    check(Buffer.compare(proxiedBytes, source) === 0, "代理回来的字节逐字节相同");
    check(!headerText.includes(TOKEN), "代理响应头里没有 token 明文");
    check(!proxiedBytes.toString("latin1").includes(TOKEN), "代理响应体里没有 token 明文");
    check(proxied.headers.get("x-content-type-options") === "nosniff", "代理响应带 X-Content-Type-Options: nosniff");
    check(proxied.headers.get("content-security-policy") === null, "光栅图不带 CSP（不能误伤正常渲染）");

    // --- 6b. SVG：assets 里真有内核自带的 .svg，是可执行文档类型 → 必须沙箱化
    const svgPath = "assets/code-block-20210512171201-pw7hrv2.svg";
    const svgResponse = await fetch(carrier.base + "/siyuan/asset?path=" + encodeURIComponent(svgPath), { signal: AbortSignal.timeout(20000) });
    if (svgResponse.status === 200) {
      const svgType = svgResponse.headers.get("content-type") ?? "";
      const svgCsp = svgResponse.headers.get("content-security-policy");
      await svgResponse.arrayBuffer();
      check(/^image\/svg\+xml/.test(svgType), "SVG 资源被放行且类型正确", svgType);
      check(typeof svgCsp === "string" && /default-src\s+'none'/.test(svgCsp) && /sandbox/.test(svgCsp), "SVG 带沙箱 CSP", String(svgCsp));
      check(!/allow-scripts/.test(String(svgCsp)), "SVG 的 CSP 没有放开脚本执行");
      check(svgResponse.headers.get("x-content-type-options") === "nosniff", "SVG 也带 nosniff");
    } else {
      log(`  INFO 内核自带 SVG 样例不在库中（HTTP ${svgResponse.status}），跳过 SVG 头断言`);
    }

    // --- 7. 宿主的 ETag / 条件请求：同一张图第二次应当是 304
    const etag = proxied.headers.get("etag");
    check(Boolean(etag), "代理给了 ETag", String(etag));
    if (etag) {
      const conditional = await fetch(carrier.base + proxyUrl, { headers: { "If-None-Match": etag }, signal: AbortSignal.timeout(20000) });
      const conditionalBytes = Buffer.from(await conditional.arrayBuffer());
      check(conditional.status === 304, "带 If-None-Match 再取一次回 304", `HTTP ${conditional.status}`);
      check(conditionalBytes.length === 0, "304 不带 body", `${conditionalBytes.length} B`);
    }

    // --- 8. 对抗性检查（走同一载体）
    const bad = await fetch(carrier.base + "/siyuan/asset?path=" + encodeURIComponent("assets/../x.png"), { signal: AbortSignal.timeout(10000) });
    check(bad.status === 400 && (await bad.json()).error?.code === "invalid_asset_path", "路径穿越被 400 拒绝");
    const malformed = await fetch(carrier.base + "/siyuan/asset?path=%E0%A4%A", { signal: AbortSignal.timeout(10000) });
    check(malformed.status === 400, "畸形百分号编码被 400 拒绝（不是 500）", `HTTP ${malformed.status}`);
    const missing = await fetch(carrier.base + "/siyuan/asset?path=" + encodeURIComponent("assets/__dsh_e2e_missing__.png"), { signal: AbortSignal.timeout(10000) });
    check(missing.status === 404 && (await missing.json()).error?.code === "asset_not_found", "缺失资源回 404 asset_not_found");
    const html = await fetch(carrier.base + "/siyuan/asset?path=" + encodeURIComponent("assets/../../conf/conf.json"), { signal: AbortSignal.timeout(10000) });
    check(html.status === 400, "跳向工作空间其它目录的路径被拒", `HTTP ${html.status}`);

    // --- 9. 内核原样事实：不带 token 直连取不到真图（这正是要经宿主代理的原因）
    const direct = await fetch(`${BASE}/${relPath}`, { signal: AbortSignal.timeout(10000) });
    const directBytes = Buffer.from(await direct.arrayBuffer());
    log(`  直连内核（不带 token）: HTTP ${direct.status} ${direct.headers.get("content-type") ?? "<无>"} ${directBytes.length} B`);
    check(
      !/^image\//.test(direct.headers.get("content-type") ?? "") || directBytes.length !== source.length,
      "不带 token 直连拿不到真图（所以必须经宿主代理）",
      `HTTP ${direct.status} ${direct.headers.get("content-type")} ${directBytes.length} B`,
    );
    const directTokened = await fetch(`${BASE}/${relPath}`, { headers: { Authorization: `Token ${TOKEN}` }, signal: AbortSignal.timeout(10000) });
    const directTokenedBytes = Buffer.from(await directTokened.arrayBuffer());
    check(
      directTokened.status === 200 && directTokenedBytes.length === source.length && Buffer.compare(directTokenedBytes, source) === 0,
      "带 token 直连内核拿到与源文件一致的字节",
      `HTTP ${directTokened.status} ${directTokenedBytes.length} B`,
    );
  } catch (error) {
    failures++;
    log("  FAIL 异常中断 :: " + (error?.stack ?? String(error)));
  } finally {
    // ---- 清理：块 -> 复核 -> 文档 -> 资源文件，全部复核（用户的库是真库）
    log("\n## 清理");
    if (written.blockId) {
      const removed = await api("/api/block/deleteBlock", { id: written.blockId }).catch((error) => ({ code: -1, msg: String(error?.message ?? error) }));
      check(removed.code === 0, "删除图片块", JSON.stringify(removed).slice(0, 160));
    }
    if (written.docId && written.relPath) {
      const after = await settledKramdown(written.docId, (value) => !value.includes(written.relPath), 6).catch(() => "");
      check(!after.includes(written.relPath), "删除后文档里已看不到这张图");
    }
    if (written.docId) {
      const removed = await removeDoc(written.docId).catch((error) => ({ envelope: { code: -1, msg: String(error?.message ?? error) } }));
      check(removed.envelope?.code === 0, "删除临时文档", JSON.stringify(removed.envelope).slice(0, 160));
    }
    if (written.dataPath) {
      const removed = await api("/api/file/removeFile", { path: written.dataPath }).catch((error) => ({ code: -1, msg: String(error?.message ?? error) }));
      check(removed.code === 0, "删除上传的资源文件", JSON.stringify(removed).slice(0, 160));
      const stillThere = await fetch(`${BASE}/${written.relPath}`, { headers: { Authorization: `Token ${TOKEN}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      const gone = !stillThere || stillThere.status !== 200;
      check(gone, "资源文件确实已删除（再取不到）", stillThere ? `HTTP ${stillThere.status}` : "<fetch 失败>");
    }
    if (written.extraDataPath) {
      const removed = await api("/api/file/removeFile", { path: written.extraDataPath }).catch((error) => ({ code: -1, msg: String(error?.message ?? error) }));
      check(removed.code === 0, "删除第二张上传的资源文件", JSON.stringify(removed).slice(0, 160));
      const stillThere = await fetch(`${BASE}/${written.extraRelPath}`, { headers: { Authorization: `Token ${TOKEN}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      check(!stillThere || stillThere.status !== 200, "第二张资源文件确实已删除", stillThere ? `HTTP ${stillThere.status}` : "<fetch 失败>");
    }
    if (carrier) await carrier.close();

    // 兜底清扫：万一脚本中途被打断（Ctrl+C / 崩溃），上面记的路径就没机会执行。
    // 本脚本的资源与文档都有固定前缀，直接按前缀扫一遍，宁可多扫也不能给用户留垃圾。
    log("\n## 兜底清扫");
    try {
      const listed = await api("/api/file/readDir", { path: "/data/assets" });
      const leftovers = (Array.isArray(listed.data) ? listed.data : [])
        .map((item) => String(item?.name ?? ""))
        .filter((name) => /^E2E-(图片|二图)/.test(name));
      for (const name of leftovers) await api("/api/file/removeFile", { path: "/data/assets/" + name }).catch(() => {});
      const after = await api("/api/file/readDir", { path: "/data/assets" });
      const remaining = (Array.isArray(after.data) ? after.data : [])
        .map((item) => String(item?.name ?? ""))
        .filter((name) => /^E2E-(图片|二图)/.test(name));
      check(remaining.length === 0, `资源目录里没有本脚本的残留文件（本轮清掉 ${leftovers.length} 个）`, remaining.join(", "));

      const strayDocs = await api("/api/query/sql", { stmt: "SELECT id FROM blocks WHERE type = 'd' AND hpath LIKE '/DSH-E2E-IMAGE-%' LIMIT 20" });
      const docs = Array.isArray(strayDocs.data) ? strayDocs.data : [];
      for (const row of docs) await removeDoc(row.id).catch(() => {});
      // SQL 索引滞后 0.3–1.5 s：刚删掉的文档可能还在结果里，所以轮询等它消失，而不是立刻判定。
      let remainingDocs = [];
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(300);
        const again = await api("/api/query/sql", { stmt: "SELECT id FROM blocks WHERE type = 'd' AND hpath LIKE '/DSH-E2E-IMAGE-%' LIMIT 20" }).catch(() => ({ data: [] }));
        remainingDocs = (Array.isArray(again.data) ? again.data : []).map((row) => row.id);
        if (remainingDocs.length === 0) break;
      }
      check(
        remainingDocs.length === 0,
        `没有遗留的临时文档（本轮清掉 ${docs.length} 个）`,
        remainingDocs.join(", "),
      );
    } catch (error) {
      check(false, "兜底清扫", String(error?.message ?? error));
    }

    log(failures === 0 ? "\nE2E-IMAGE: OK" : `\nE2E-IMAGE: ${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();

/** 用与单测同款的方式装载 client.js，取它自己的纯函数（不改 lib/）。 */
function loadClientBundle() {
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
  if (!bundle?.exports?.__test?.assetPreviewUrl) throw new Error("client bundle 没有导出 assetPreviewUrl");
  return bundle.exports.__test;
}
