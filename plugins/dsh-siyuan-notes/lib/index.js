/**
 * dsh-siyuan-notes — Host half.
 *
 * Owns every byte that leaves this machine towards the self-hosted SiYuan kernel:
 * the API token lives only here, the browser half never sees it. It exposes these routes
 * on the DSH web carrier:
 *
 * | Method | Path                   | Purpose                                              |
 * |--------|------------------------|------------------------------------------------------|
 * | GET    | `/siyuan/state`        | connection state + kernel version probe               |
 * | POST   | `/siyuan/config`       | persist `{ baseUrl, token }` and re-probe             |
 * | POST   | `/siyuan/api`          | forward `{ path, payload }` to `${baseUrl}${path}`    |
 * | POST   | `/siyuan/backup`       | write `{ docId, title, kramdown }` to a backup file   |
 * | POST   | `/siyuan/context`      | the editor's live snapshot (doc, caret, selection)    |
 * | GET    | `/siyuan/layout`       | the editor layout the user last left behind           |
 * | POST   | `/siyuan/layout`       | remember that layout                                  |
 * | GET    | `/siyuan/memory`       | long-term memory reads (entries / handoff / checkup)  |
 * | POST   | `/siyuan/memory`       | memory status changes (revoke / restore / supersede)  |
 * | POST   | `/siyuan/asset/upload` | forward a multipart image upload to the kernel        |
 * | GET    | `/siyuan/asset`        | proxy one `assets/...` image back, token attached     |
 *
 * Persistence: `%USERPROFILE%\.dsh\siyuan-notes.json` (settings) and
 * `%USERPROFILE%\.dsh\siyuan-backups\<timestamp>-<docId>.md` (pre-save snapshots).
 *
 * Only node: builtins are imported; see `lib/host-utils.js` for why the schema is hand-rolled.
 *
 * @module dsh-siyuan-notes
 */

import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULTS,
  LIMITS,
  ROUTES,
  normalizeContext,
  normalizeLayout,
  LAYOUT_LIMITS,
  LAYOUT_VIEW_MODES,
  describeContext,
  contextAgeSeconds,
  ROUTE_PREFIX,
  backupFileName,
  clampTimeoutSeconds,
  createConfigSchema,
  describeFetchError,
  fail,
  isForwardableApiPath,
  isPlainObject,
  isServableAssetPath,
  mergeSettings,
  normalizeBaseUrl,
  normalizeRoutePath,
  parseSettingsJson,
  succeed,
  toPublicState,
} from "./host-utils.js";
import {
  MEMORY_LIMITS,
  MEMORY_NOTEBOOK_NAME,
  MEMORY_TYPES,
  MEMORY_CONFIDENCES,
  createMemoryStore,
} from "./memory.js";
import { createMemorySessions } from "./memory-sessions.js";
import { resolveMemoryScope } from "./memory-policy.js";
import { createMemoryReceipts } from "./memory-receipts.js";
import { createMemoryRecording } from './memory-recording.js';
import { createNativeEditorGateway } from "./native-editor.js";
import { createNativeSessionStore } from "./native-session.js";
import { createTextInsertTool } from "./insert-text.js";
export { createTextInsertTool } from "./insert-text.js";

export {
  DEFAULTS,
  LIMITS,
  ROUTES,
  ROUTE_PREFIX,
  normalizeContext,
  normalizeLayout,
  LAYOUT_LIMITS,
  LAYOUT_VIEW_MODES,
  describeContext,
  contextAgeSeconds,
  backupFileName,
  createConfigSchema,
  isForwardableApiPath,
  mergeSettings,
  normalizeBaseUrl,
  normalizeRoutePath,
  parseSettingsJson,
  toPublicState,
} from "./host-utils.js";

/** Cordis entry name (must match the bundle row id). */
export const name = "siyuan-notes";

/** Hard dependency on the browser HTTP carrier. */
export const inject = ["webServer"];

/**
 * Connection settings. Volatile: the panel/persisted store owns the live values, the patch
 * layer only seeds them.
 */
export const Config = createConfigSchema();

/** Settings file name inside the DSH home directory. */
export const SETTINGS_FILE_NAME = "siyuan-notes.json";

/** Backup directory name inside the DSH home directory. */
export const BACKUP_DIR_NAME = "siyuan-backups";

/** Editor-layout file name inside the DSH home directory. */
export const LAYOUT_FILE_NAME = "siyuan-notes-layout.json";

/**
 * 给 SVG 资源加的沙箱策略。
 *
 * `assets/` 目录里除了图片还有内核自带的 `.svg`（14 个，实测）。SVG 本质是可执行文档：
 * 放进 `<img>` 里不会跑脚本，但把这个 URL 当文档顶层打开时脚本会在 **DSH 自己的 origin**
 * 里执行。这条策略只作用于"当文档打开"，图片渲染不受影响。
 */
export const SVG_SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** 某段内容是不是 SVG —— 决定要不要带上沙箱策略。 */
function isSvgContentType(contentType) {
  return /^image\/svg\+xml/i.test(typeof contentType === "string" ? contentType : "");
}

/** @returns {string} absolute path of the remembered editor layout. */
export function layoutFilePath() {
  return path.join(dshHome(), LAYOUT_FILE_NAME);
}

/**
 * Resolve the DSH home directory.
 *
 * `DSH_SIYUAN_NOTES_HOME` exists so tests (and a portable install) can redirect both the
 * settings file and the backup directory without touching the real profile.
 *
 * @returns {string}
 */
export function dshHome() {
  const override = process.env.DSH_SIYUAN_NOTES_HOME;
  if (typeof override === "string" && override.trim() !== "") {
    return path.resolve(override.trim());
  }
  return path.join(os.homedir(), ".dsh");
}

/** @returns {string} absolute path of the persisted settings file. */
export function settingsFilePath() {
  return path.join(dshHome(), SETTINGS_FILE_NAME);
}

/** @returns {string} absolute path of the pre-save backup directory. */
export function backupDirectory() {
  return path.join(dshHome(), BACKUP_DIR_NAME);
}

/**
 * Which SiYuan notebook holds the memory entries.
 *
 * Kept out of the Cordis Config on purpose: `mergeSettings` narrows the wire shape to the
 * three connection fields, and adding a fourth would churn that contract (and its tests)
 * for a value that changes roughly never. `DSH_SIYUAN_MEMORY_NOTEBOOK` is the escape hatch,
 * mirroring how `DSH_SIYUAN_NOTES_HOME` redirects the store.
 *
 * @returns {string}
 */
export function memoryNotebookName() {
  const override = process.env.DSH_SIYUAN_MEMORY_NOTEBOOK;
  if (typeof override === "string" && override.trim() !== "") return override.trim();
  return MEMORY_NOTEBOOK_NAME;
}

/**
 * Write a file atomically (temp file + rename) so a crash cannot truncate the store.
 * @param {string} file absolute target path.
 * @param {string} content UTF-8 content.
 * @returns {Promise<void>}
 */
async function writeFileAtomic(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temporary, content, "utf8");
  try {
    await fsp.rename(temporary, file);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Read a JSON request body with a hard size cap.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [limitBytes]
 * @returns {Promise<Record<string, unknown>>} the parsed object (`{}` for an empty body).
 */
export function readJsonBody(req, limitBytes = LIMITS.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    /** @param {Error} error */
    const bail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limitBytes) {
        bail(Object.assign(new Error("请求体过大"), { code: "body_too_large" }));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("error", (error) => bail(Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "body_error" })));
    req.on("aborted", () => bail(Object.assign(new Error("请求被中断"), { code: "body_aborted" })));
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (!isPlainObject(parsed)) {
          reject(Object.assign(new Error("请求体必须是 JSON 对象"), { code: "invalid_json" }));
          return;
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error("请求体不是合法 JSON"), { code: "invalid_json" }));
      }
    });
  });
}

/**
 * Read a request body as raw bytes, with a hard size cap.
 *
 * 上传是 multipart，宿主**不能**解析它：除了 Content-Type 里的 boundary，其余每一字节
 * 都要原样交给内核。所以这里只负责"收齐 + 限流"，不做解码、不 trim（图片数据里什么
 * 字节都可能出现，`toString("utf8")` 会悄悄改写它）。
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [limitBytes]
 * @returns {Promise<Buffer>}
 */
export function readRawBody(req, limitBytes = LIMITS.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    /** 已经越过上限：不再缓冲，但继续把请求读完。 */
    let overflow = false;

    /** @param {Error} error */
    const bail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    /** 上限文案只在这一个地方拼，读起来也只需要看这一处。 */
    const tooLarge = () =>
      Object.assign(new Error(`请求体过大（上限 ${Math.round(limitBytes / 1024 / 1024)} MB）`), {
        code: "body_too_large",
      });

    req.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limitBytes) {
        // 超限之后仍然把请求读完再回答 413：半途 destroy 会让浏览器只看到"网络错误"，
        // 用户无从知道是文件太大。但也不能无限读下去（那等于把宿主当垃圾桶），
        // 所以再超过一个上限就直接断开。
        if (size > limitBytes * 2) {
          bail(tooLarge());
          req.destroy();
          return;
        }
        overflow = true;
        return;
      }
      chunks.push(buffer);
    });
    req.on("error", (error) =>
      bail(Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "body_error" })),
    );
    req.on("aborted", () => bail(Object.assign(new Error("请求被中断"), { code: "body_aborted" })));
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (overflow) {
        reject(tooLarge());
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Send a JSON response.
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extraHeaders]
 */
export function sendJson(res, status, body, extraHeaders = {}) {
  if (!res || typeof res.writeHead !== "function") return;
  const json = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(json);
}

/**
 * POST a SiYuan API call and return the kernel envelope verbatim.
 *
 * @param {{ baseUrl: string, token: string, timeoutSeconds: number }} settings
 * @param {string} apiPath an already-validated `/api/...` path.
 * @param {unknown} payload request body sent to the kernel.
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>}
 */
export async function forwardSiYuanApi(settings, apiPath, payload) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  // An empty token means the kernel has no API token configured; sending "Token " would
  // then look like a wrong credential instead of "no credential".
  if (settings.token !== "") {
    headers.Authorization = `Token ${settings.token}`;
  }
  try {
    const response = await fetch(`${settings.baseUrl}${apiPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(Math.round(settings.timeoutSeconds * 1000)),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (parsed !== null && parsed !== undefined && typeof parsed === "object") {
      return succeed(parsed);
    }
    const preview = text.replace(/\s+/g, " ").slice(0, 200);
    return fail(
      "bad_upstream_response",
      `思源返回了非 JSON 响应（HTTP ${response.status}）：${preview === "" ? "<空响应>" : preview}`,
    );
  } catch (error) {
    return fail("upstream_unreachable", `无法连接思源内核：${describeFetchError(error)}`);
  }
}

/**
 * Forward a multipart upload to the kernel's asset endpoint.
 *
 * 为什么不复用 `forwardSiYuanApi`：那个函数的 `Content-Type` 是硬编码的 JSON、body 恒为
 * `JSON.stringify(...)`，而 multipart 的 body 是二进制、`Content-Type` 里带 boundary，
 * 两者没有任何共同部分。这里只借用它的错误语义（上游失败 → 两种 code + 中文说明）。
 *
 * @param {{ baseUrl: string, token: string, timeoutSeconds: number }} settings
 * @param {{ contentType: string, body: Buffer }} input
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>}
 */
export async function forwardSiYuanAssetUpload(settings, input) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": input.contentType, Accept: "application/json" };
  if (settings.token !== "") {
    headers.Authorization = `Token ${settings.token}`;
  }
  const timeoutSeconds = Math.max(LIMITS.minUploadTimeoutSeconds, settings.timeoutSeconds);
  try {
    const response = await fetch(`${settings.baseUrl}/api/asset/upload`, {
      method: "POST",
      headers,
      body: input.body,
      signal: AbortSignal.timeout(Math.round(timeoutSeconds * 1000)),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (parsed !== null && parsed !== undefined && typeof parsed === "object") {
      return succeed(parsed);
    }
    // 内核在鉴权失败或路径不存在时会回一张 SPA 首页。把 HTML 原样塞进错误提示，用户
    // 只会看到一串标签（`<!doctype` 出现在 JSON 错误里也毫无意义），所以这里去掉标签、
    // 压平空白，只留下"内核到底说了什么"。
    const preview = text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return fail(
      "bad_upstream_response",
      `思源返回了非 JSON 响应（HTTP ${response.status}）：${preview === "" ? "<空响应>" : preview}`,
    );
  } catch (error) {
    return fail("upstream_unreachable", `无法连接思源内核：${describeFetchError(error)}`);
  }
}

/**
 * Fetch one asset from the kernel, token attached.
 *
 * 路径按段 encode：思源保留上传时的原文件名（中文很常见），而 `%` 这类字节直接拼进 URL
 * 会被当成转义序列 —— 所以"原样拼接"并不是真的原样。
 *
 * @param {{ baseUrl: string, token: string, timeoutSeconds: number }} settings
 * @param {string} assetPath already validated by `isServableAssetPath`.
 * @param {string} [ifNoneMatch] the browser's `If-None-Match`, so a repeat render costs a 304.
 * @returns {Promise<
 *   | { ok: true, value: { notModified: true, etag: string | null } }
 *   | { ok: true, value: { notModified: false, contentType: string, buffer: Buffer, etag: string | null } }
 *   | { ok: false, error: { code: string, message: string } }>}
 */
export async function forwardSiYuanAsset(settings, assetPath, ifNoneMatch) {
  const encoded = assetPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  /** @type {Record<string, string>} */
  const headers = { Accept: "image/*" };
  if (settings.token !== "") {
    headers.Authorization = `Token ${settings.token}`;
  }
  if (typeof ifNoneMatch === "string" && ifNoneMatch !== "") {
    headers["If-None-Match"] = ifNoneMatch;
  }
  /**
   * 读上游响应头。测试里的假响应可能没有完整的 Headers 实现，所以这里只做"能读就读"。
   * @param {any} response
   * @param {string} name
   * @returns {string | null}
   */
  const headerOf = (response, name) => {
    try {
      const value = typeof response?.headers?.get === "function" ? response.headers.get(name) : undefined;
      return typeof value === "string" && value !== "" ? value : null;
    } catch {
      return null;
    }
  };
  try {
    const response = await fetch(`${settings.baseUrl}/${encoded}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(Math.round(settings.timeoutSeconds * 1000)),
    });
    const upstreamEtag = headerOf(response, "etag");
    if (response.status === 304) {
      return { ok: true, value: { notModified: true, etag: upstreamEtag } };
    }
    if (response.status === 401 || response.status === 403) {
      return fail("asset_forbidden", "思源拒绝了这次资源请求（token 不对，或该资源没有访问权限）");
    }
    if (!(response.status >= 200 && response.status < 300)) {
      return fail("asset_not_found", `资源不存在（思源返回 HTTP ${response.status}）`);
    }
    const contentType = headerOf(response, "content-type") ?? "";
    // 未鉴权访问 `/assets/...` 一定拿不到图，但形态取决于请求头：裸请求是 401 JSON，
    // 浏览器式请求（`Accept: text/html`）会被 302 到 `/check-auth`，跟随之后落到 SPA 首页
    // （HTTP 200 + text/html，实测 3.8.3）。那种响应必须当成"没有这张图"报错，绝不能原样
    // 塞回浏览器的 <img>：否则用户只看到一个破图，真正的原因（未授权）完全不可见。
    if (!/^image\//i.test(contentType)) {
      return fail("asset_not_found", `该路径不是图片资源（Content-Type：${contentType === "" ? "<空>" : contentType}）`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    // 内核 3.8.3 的静态资源响应**不带 ETag**（实测），所以上游没给就自己算一个弱校验值：
    // 浏览器下次带着 If-None-Match 回来时，宿主就能直接回 304，省掉一次下行传输。
    const etag =
      headerOf(response, "etag") ??
      `W/"${buffer.length.toString(16)}-${createHash("sha1").update(buffer).digest("hex").slice(0, 16)}"`;
    return { ok: true, value: { notModified: false, contentType, buffer, etag } };
  } catch (error) {
    return fail("upstream_unreachable", `无法连接思源内核：${describeFetchError(error)}`);
  }
}

/**
 * Probe `POST/GET /api/system/version` with a short timeout.
 *
 * @param {{ baseUrl: string, token: string, timeoutSeconds: number }} settings
 * @param {number} [timeoutMs]
 * @returns {Promise<{ version: string | null, error?: string }>}
 */
export async function probeKernelVersion(settings, timeoutMs = LIMITS.probeTimeoutMs) {
  /** @type {Record<string, string>} */
  const headers = { Accept: "application/json" };
  if (settings.token !== "") {
    headers.Authorization = `Token ${settings.token}`;
  }
  try {
    const response = await fetch(`${settings.baseUrl}/api/system/version`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { version: null, error: `思源返回了非 JSON 响应（HTTP ${response.status}）` };
    }
    if (isPlainObject(parsed) && typeof parsed.data === "string" && parsed.code === 0) {
      return { version: parsed.data };
    }
    const message = isPlainObject(parsed) && typeof parsed.msg === "string" && parsed.msg !== "" ? parsed.msg : "未知错误";
    return { version: null, error: `思源内核返回错误：${message}` };
  } catch (error) {
    return { version: null, error: describeFetchError(error) };
  }
}

/**
 * Persist the pre-save snapshot.
 *
 * @param {{ docId?: unknown, title?: unknown, kramdown?: unknown }} input
 * @param {Date} [now]
 * @returns {Promise<{ ok: true, value: { file: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function writeBackup(input, now = new Date()) {
  if (typeof input.kramdown !== "string") {
    return fail("invalid_kramdown", "kramdown 必须是字符串");
  }
  const directory = backupDirectory();
  const fileName = backupFileName({ docId: input.docId, title: input.title, now });
  const file = path.join(directory, fileName);
  if (path.dirname(path.resolve(file)) !== path.resolve(directory)) {
    return fail("invalid_file_name", "备份文件名不合法");
  }
  try {
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(file, input.kramdown, "utf8");
    return succeed({ file });
  } catch (error) {
    return fail("backup_write_failed", `写入备份失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create the route handler plus the small state machine behind it.
 *
 * Exported so `test/` can drive it without a Cordis context.
 *
 * @param {{ config?: unknown, logger?: { error?: (error: unknown) => void } }} [options]
 * @returns {{
 *   handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>,
 *   ensureLoaded: () => Promise<void>,
 *   currentSettings: () => import("./host-utils.js").Settings,
 *   reloadStore: () => Promise<void>
 * }}
 */
/** Section placement: after the repository sections, before tool guidance. */
const CONTEXT_SECTION_ORDER = 640;

/**
 * Section placement for the memory index: immediately after the editor-context section.
 *
 * The real `SECTION_ORDERS` table (`dsh-system-prompt/lib/index.js:10-45`) puts TEAM_POLICY
 * at 600 and PTC_ONLY at 800, so 660 sits after team policy and before the PTC block.
 */
const MEMORY_SECTION_ORDER = 660;

/**
 * 压力提醒的 runtime-context 位置。
 *
 * 真实 `CONTEXT_ORDERS`（`dsh-system-prompt/lib/index.js:46-54`）里
 * WORKING_DIRECTORY=100、SUBAGENT_DELEGATION=120、TEAM_IDENTITY=125、HARNESS_SOURCE=200，
 * 130 落在团队身份之后、harness 来源之前——和它「会话级提醒」的性质相称。
 */
const MEMORY_HINT_CONTEXT_ORDER = 130;

/** 插图工具的注册名。 */
export const IMAGE_TOOL_NAME = "siyuan_note_insert_image";

/**
 * 插图工具的硬限制。
 *
 * 与浏览器侧的前置拦截保持同一数量级：浏览器拦 20 MB，宿主再兜一次，避免工具被直接调用时
 * 把整块内存吃满（读文件 → Blob → 序列化，一份数据会短暂存在三份）。
 */
export const IMAGE_TOOL_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  /** 扩展名白名单。内核自己会再校验真实内容，这里先挡掉明显不是图片的文件。 */
  extensions: Object.freeze([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]),
  /** alt 太长会挤爆卡片与预览；超长截断而不是拒绝。 */
  maxAltLength: 200,
});

/** 扩展名 → MIME。内核不看这个值（它自己嗅探内容），但 multipart 的每一段需要它。 */
const IMAGE_MIME = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
});

/** 思源块 id 的形状：14 位时间戳 + `-` + 7 位字母数字。 */
const BLOCK_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/i;

/** 宽度的合法形态：纯数字（按 px 处理）或百分比。 */
const WIDTH_PATTERN = /^\d+(\.\d+)?(px|%)?$/i;

/**
 * SQL 字符串字面量的转义。思源只支持单引号字符串，双写单引号是标准做法。
 * @param {string} value
 * @returns {string}
 */
function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * 拆出文件名与扩展名（小写，含点）。
 * @param {string} filePath
 * @returns {{ name: string, ext: string } | null}
 */
export function imageFileParts(filePath) {
  const raw = typeof filePath === "string" ? filePath.trim() : "";
  if (raw === "") return null;
  const name = path.basename(raw);
  if (name === "" || name === "." || name === "..") return null;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return { name, ext };
}

/**
 * 文件名 → 图片说明。规则与客户端的 `filenameToAlt` 一致（卡片与预览才显示得一致）：
 * 去掉最后一个扩展名，`]` 转义（否则会截断 markdown），换行折成空格，超长截断。
 * @param {string} fileName
 * @returns {string}
 */
export function imageAltFromFileName(fileName) {
  const parts = imageFileParts(fileName);
  const base = parts === null ? String(fileName ?? "") : parts.name;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = stem.replace(/[\r\n]+/g, " ").replace(/\]/g, "\\]").trim();
  return cleaned.length > IMAGE_TOOL_LIMITS.maxAltLength
    ? cleaned.slice(0, IMAGE_TOOL_LIMITS.maxAltLength)
    : cleaned;
}

/**
 * 校验并归一化宽度。
 *
 * 只接受"数字"（按 px）或"百分比"两种形态：其它写法（表达式、rem、calc）一律拒绝，
 * 因为它会被原样写进 markdown 的 IAL，不能有半点歧义。
 *
 * @param {unknown} width
 * @returns {{ ok: true, value: string | null } | { ok: false, error: { code: string, message: string } }}
 */
export function normalizeImageWidth(width) {
  if (width === undefined || width === null || width === "") {
    return { ok: true, value: null };
  }
  if (typeof width === "number") {
    if (!Number.isFinite(width) || width <= 0) {
      return fail("invalid_width", "width 必须是正数（像素）或百分比字符串");
    }
    return { ok: true, value: `${Math.round(width)}px` };
  }
  const text = String(width).trim().toLowerCase();
  if (!WIDTH_PATTERN.test(text)) {
    return fail("invalid_width", `width 只接受数字（像素）或百分比，收到「${text}」`);
  }
  return { ok: true, value: text.endsWith("%") ? text : `${text}px` };
}

/**
 * 拼出图片那一行的 markdown。
 * @param {string} assetPath 已校验的资源路径（`assets/...`）。
 * @param {string} alt 图片说明（调用方负责转义）。
 * @param {string | null} width 已归一化的宽度，或 null。
 * @returns {string}
 */
export function imageMarkdown(assetPath, alt, width) {
  const line = `![${alt}](${assetPath})`;
  return width === null || width === "" ? line : `${line}{: style="width: ${width};"}`;
}

/**
 * 从内核写入响应里取新块 id。
 *
 * 与客户端 `createdBlockId` 等价：`insertBlock` / `appendBlock` 的 `data` 是事务数组，
 * 里面 `action === "insert"` 的那条带 `id`。
 * @param {unknown} envelope 内核信封 `{code,msg,data}`
 * @returns {string | null}
 */
export function insertedBlockId(envelope) {
  const data = isPlainObject(envelope) ? envelope.data : undefined;
  if (!Array.isArray(data)) return null;
  for (const transaction of data) {
    if (!isPlainObject(transaction)) continue;
    const ops = transaction.doOperations;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      if (isPlainObject(op) && op.action === "insert" && typeof op.id === "string" && op.id !== "") return op.id;
    }
  }
  return null;
}

/**
 * 从上传信封里取资源相对路径。
 * @param {unknown} envelope 内核信封
 * @param {string} fileName 上传时用的原文件名（`succMap` 的 key）
 * @returns {string}
 */
export function assetPathFromUpload(envelope, fileName) {
  const data = isPlainObject(envelope) ? envelope.data : undefined;
  if (!isPlainObject(data)) return "";
  const succMap = isPlainObject(data.succMap) ? data.succMap : {};
  const direct = succMap[fileName];
  if (typeof direct === "string" && direct !== "") return direct;
  const files = Array.isArray(data.succFiles) ? data.succFiles : [];
  for (const item of files) {
    if (isPlainObject(item) && typeof item.path === "string" && item.path !== "") return item.path;
  }
  return "";
}

/** 块级 IAL 行（`{: id="…" …}`），缩进形式也认（那表示最内层的子块）。 */
const IAL_ID_LINE = /^\s*\{:\s*id="([^"]+)"/;

/**
 * 在 kramdown 里按一段文本定位它所属的块 id。
 *
 * **为什么不查 SQL**：`blocks` 表的索引是**异步**写的 —— 实测同一台内核，小库（"AI 记忆体"）
 * 新建文档约 0.4 秒可查，而用户的大库要 **约 3.5 秒**；`getBlockKramdown` 则立即可读。
 * 工具若依赖 SQL，就会表现为"刚建好/刚改过的文档插不进去"这种莫名其妙的失败。
 *
 * 块的 kramdown 形如：
 * ```
 * 　　正文文字
 * {: id="20240101120000-abcdefg" updated="…"}
 * ```
 * 所以「找到含该文本的行 → 向下找最近的 IAL 行」就能拿到块 id；块内多行命中同一个 id 不算歧义，
 * 命中到**不同** id 才算，那时要求模型给更长的片段或直接给块 id。空行视为块结束，避免错配到下一块。
 *
 * @param {string} kramdown
 * @param {string} anchorText
 * @returns {{ ok: true, value: string } | { ok: false, error: { code: string, message: string } }}
 */
export function locateAnchorInKramdown(kramdown, anchorText) {
  const text = String(anchorText ?? "");
  if (text === "") {
    return fail("invalid_source", "锚点文本不能为空");
  }
  const lines = String(kramdown ?? "").split("\n");
  /** @type {Set<string>} */
  const ids = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (IAL_ID_LINE.test(line)) continue; // 属性行本身不是内容
    if (!line.includes(text)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") break; // 空行 = 这个块结束了，不该再往下找
      const match = IAL_ID_LINE.exec(lines[j]);
      if (match !== null) {
        ids.add(match[1]);
        break;
      }
    }
  }
  if (ids.size === 0) {
    return fail("anchor_not_found", `文档里没有包含「${text}」的块；可以改用块 id，或省略 after 追加到末尾`);
  }
  if (ids.size > 1) {
    return fail("ambiguous_anchor", `有 ${ids.size} 个块包含「${text}」，请改用块 id 或更长的唯一文本`);
  }
  return { ok: true, value: [...ids][0] };
}

/**
 * 构造 `siyuan_note_insert_image` 工具。
 *
 * 依赖全部通过参数注入（而不是在函数体里直接抓 `routes` / `fsp`），这样单测可以喂假内核、
 * 假文件系统，不需要真跑 DSH。
 *
 * @param {{
 *   call: (apiPath: string, payload: unknown) => Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>,
 *   upload: (input: { contentType: string, body: Buffer }) => Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>,
 *   readFile: (filePath: string) => Promise<Buffer>,
 *   editorContext: () => { docId?: string | null, title?: string } | undefined,
 *   backup: (input: { docId: string, title: string, kramdown: string }) => Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>,
 * }} deps
 * @returns {{ name: string, description: string, parameters: Record<string, unknown>, output: Record<string, unknown>, execute: (args: any) => Promise<Record<string, unknown>> }}
 */
export function createImageInsertTool(deps) {
  /**
   * 调内核并把「信封里的 code !== 0」变成结构化失败。
   * @param {string} apiPath
   * @param {unknown} payload
   * @returns {Promise<{ ok: true, value: any } | { ok: false, error: { code: string, message: string } }>}
   */
  async function callKernel(apiPath, payload) {
    const result = await deps.call(apiPath, payload);
    if (result.ok !== true) return result;
    const envelope = result.value;
    if (!isPlainObject(envelope) || envelope.code !== 0) {
      const message = typeof envelope?.msg === "string" && envelope.msg !== "" ? envelope.msg : "内核返回了错误或无效响应";
      return fail("kernel_error", `${apiPath} 失败：${message}`);
    }
    return { ok: true, value: envelope };
  }

  /** @param {string} stmt @returns {Promise<{ ok: true, value: any[] } | { ok: false, error: { code: string, message: string } }>} */
  async function querySql(stmt) {
    const result = await callKernel("/api/query/sql", { stmt });
    if (result.ok !== true) return result;
    const rows = isPlainObject(result.value) ? result.value.data : undefined;
    return { ok: true, value: Array.isArray(rows) ? rows : [] };
  }

  /**
   * 定位目标文档。缺省用"用户当前在面板打开的文档"；显式给值可以是块 id 或 hpath。
   * @param {unknown} doc
   * @returns {Promise<{ ok: true, value: { docId: string, title: string } } | { ok: false, error: { code: string, message: string } }>}
   */
  async function resolveDocument(doc) {
    const wanted = typeof doc === "string" ? doc.trim() : "";
    if (wanted === "") {
      const snapshot = typeof deps.editorContext === "function" ? deps.editorContext() : undefined;
      const docId = snapshot && typeof snapshot.docId === "string" ? snapshot.docId : "";
      if (docId === "") {
        return fail("no_open_document", "没有给 doc，而面板当前也没有打开任何文档；请显式给出文档 id");
      }
      return { ok: true, value: { docId, title: typeof snapshot.title === "string" ? snapshot.title : "" } };
    }
    if (BLOCK_ID_PATTERN.test(wanted)) {
      return { ok: true, value: { docId: wanted, title: "" } };
    }
    // hpath：精确匹配文档块，必须唯一 —— 不想在"插错文档"上赌运气。
    const found = await querySql(
      `SELECT id, content FROM blocks WHERE type = 'd' AND hpath = '${sqlString(wanted)}' LIMIT 5`,
    );
    if (found.ok !== true) return found;
    const rows = found.value;
    if (rows.length === 0) {
      return fail("doc_not_found", `按路径找不到文档：${wanted}（也可以直接给文档 id）`);
    }
    if (rows.length > 1) {
      return fail("ambiguous_doc", `路径「${wanted}」匹配到 ${rows.length} 篇文档，请改用文档 id`);
    }
    const row = rows[0];
    return {
      ok: true,
      value: {
        docId: String(row.id),
        title: typeof row.content === "string" ? row.content : "",
      },
    };
  }

  /**
   * 读整篇 kramdown（写前快照要用）。
   * @param {string} docId
   * @returns {Promise<{ ok: true, value: string } | { ok: false, error: { code: string, message: string } }>}
   */
  async function readWholeDocument(docId) {
    const result = await callKernel("/api/block/getBlockKramdown", { id: docId });
    if (result.ok !== true) return result;
    const data = isPlainObject(result.value) ? result.value.data : undefined;
    const kramdown = isPlainObject(data) && typeof data.kramdown === "string" ? data.kramdown : "";
    if (kramdown === "") {
      return fail("doc_not_found", `读不到文档 ${docId} 的正文（可能不存在，或所在笔记本已关闭/加密）`);
    }
    return { ok: true, value: kramdown };
  }

  /**
   * 本地文件 → 思源资源库里的一份资源，返回它的相对路径。
   * @param {string} filePath
   * @returns {Promise<{ ok: true, value: string } | { ok: false, error: { code: string, message: string } }>}
   */
  async function uploadLocalImage(filePath) {
    const parts = imageFileParts(filePath);
    if (parts === null) {
      return fail("invalid_source", "source.value 必须是本地图片文件的路径");
    }
    if (!IMAGE_TOOL_LIMITS.extensions.includes(parts.ext)) {
      return fail(
        "unsupported_image",
        `只接受图片文件（${IMAGE_TOOL_LIMITS.extensions.join(" / ")}），收到「${parts.ext || "无扩展名"}」`,
      );
    }
    /** @type {Buffer} */
    let buffer;
    try {
      const read = await deps.readFile(filePath);
      buffer = Buffer.isBuffer(read) ? read : Buffer.from(read);
    } catch (error) {
      return fail("file_not_found", `读不到本地文件：${filePath}（${error instanceof Error ? error.message : String(error)}）`);
    }
    if (buffer.length === 0) {
      return fail("file_not_found", `本地文件是空的：${filePath}`);
    }
    if (buffer.length > IMAGE_TOOL_LIMITS.maxBytes) {
      return fail(
        "image_too_large",
        `图片 ${(buffer.length / 1024 / 1024).toFixed(1)} MB，超过上限 ${IMAGE_TOOL_LIMITS.maxBytes / 1024 / 1024} MB`,
      );
    }
    // 用标准的 FormData 序列化出 multipart 再交给宿主已有的转发函数：字段名与浏览器上传
    // 完全一致（assetsDirPath + file[]），内核那边看到的是同一种请求。
    const form = new FormData();
    form.append("assetsDirPath", "/assets/");
    form.append("file[]", new Blob([buffer], { type: IMAGE_MIME[parts.ext] ?? "application/octet-stream" }), parts.name);
    const request = new Request("http://localhost/", { method: "POST", body: form });
    const contentType = request.headers.get("content-type") ?? "";
    const body = Buffer.from(await request.arrayBuffer());
    const uploaded = await deps.upload({ contentType, body });
    if (uploaded.ok !== true) return uploaded;
    const assetPath = assetPathFromUpload(uploaded.value, parts.name);
    if (assetPath === "") {
      return fail("upload_failed", "内核没有返回资源路径（响应里既没有 succMap 也没有 succFiles）");
    }
    return { ok: true, value: assetPath };
  }

  /**
   * 把一行 markdown 插到目标位置。
   * @param {string} docId
   * @param {unknown} after 块 id 或一段唯一文本；空 = 追加到文档末尾
   * @param {string} markdown
   * @returns {Promise<{ ok: true, value: { blockId: string | null, anchor?: string } } | { ok: false, error: { code: string, message: string } }>}
   */
  async function insertLine(docId, after, markdown, kramdown) {
    const anchorText = typeof after === "string" ? after.trim() : "";
    let previousId = "";
    let anchor = "";
    if (anchorText !== "") {
      if (BLOCK_ID_PATTERN.test(anchorText)) {
        previousId = anchorText;
        anchor = anchorText;
      } else {
        // 正文定位走 kramdown（**不查 SQL**）：理由见 locateAnchorInKramdown 的注释——
        // 大库里 blocks 索引要 3.5 秒才就绪，会让"刚建好的文档插不进去"。
        const located = locateAnchorInKramdown(kramdown, anchorText);
        if (located.ok !== true) return located;
        previousId = located.value;
        anchor = anchorText;
      }
    }
    if (previousId !== "") {
      if (previousId === docId) return fail("invalid_anchor", "锚点必须是文档内的内容块，不能是文档自身");
      const info = await callKernel("/api/block/getBlockInfo", { id: previousId });
      if (info.ok !== true) return info;
      if (info.value?.data?.rootID !== docId) return fail("invalid_anchor", "锚点不属于目标文档，已停止插入");
    }
    const payload = previousId === ""
      ? { parentID: docId, dataType: "markdown", data: markdown }
      : { previousID: previousId, dataType: "markdown", data: markdown };
    const written = await callKernel(previousId === "" ? "/api/block/appendBlock" : "/api/block/insertBlock", payload);
    if (written.ok !== true) return written;
    const blockId = insertedBlockId(written.value);
    if (blockId === null) {
      return fail("insert_failed", "内核接受了写入，但响应里没有新块 id —— 请重新读取文档确认");
    }
    // 事务返回 ID 不代表落盘。只重读目标文档确认，不重发写入，以免生成重复图片。
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      const info = await callKernel("/api/block/getBlockInfo", { id: blockId });
      if (info.ok !== true || info.value?.data?.rootID !== docId) continue;
      // 单独读图片块，避免引用/列表容器在整篇序列化时添加 > 或缩进导致误判。
      const read = await readWholeDocument(blockId);
      if (read.ok !== true) continue;
      const content = read.value.split("\n").filter((line) => !IAL_ID_LINE.test(line)).join("\n").trim();
      const location = await callKernel("/api/block/getBlockRelevantIDs", { id: blockId });
      const relative = location.ok === true ? location.value?.data : null;
      const positioned = relative && (previousId === "" ? relative.parentID === docId : relative.previousID === previousId);
      if (content === markdown && positioned) {
        return { ok: true, value: { blockId, ...(anchor === "" ? {} : { anchor }) } };
      }
    }
    return { ...fail("insert_unconfirmed", `插图写入尚未确认（文档 ${docId}，返回块 ${blockId}）。请先重新读取核对，勿直接重复插入。`), docId, blockId };
  }

  return {
    name: IMAGE_TOOL_NAME,
    description:
      "把一张图片写进思源文档。只做「插入」，不删除、不覆盖任何已有内容，也一次只处理一张。\n" +
      "source.kind=\"path\"：读取 DSH 主机上的本地图片文件（png/jpg/jpeg/gif/webp/bmp/svg，≤20 MB），" +
      "上传到思源资源库后再插入；source.kind=\"asset\"：直接引用资源库里已有的图片（如 assets/xxx.png），不重复上传。\n" +
      "doc 省略时用用户**当前在面板里打开的文档**——用户说「这一章」「这篇」时就省略它。\n" +
      "after 给块 id 或一段只出现在一个块里的文本，图片插到那个块之后；省略则追加到文档末尾。\n" +
      "alt 是图片说明（写进 ![] 里）；width 是像素数字或百分比（写进 {: style=\"width: …\" }）。\n" +
      "写入前会自动落一份快照到 ~/.dsh/siyuan-backups。返回新块 id、资源路径与最终 markdown，可用它复核。",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["path", "asset"],
              description: "path=DSH 主机上的本地图片文件；asset=思源资源库里已有的图片路径。",
            },
            value: {
              type: "string",
              description: "kind=path 时是文件绝对路径（Windows 上写完整盘符路径，例如 Pictures 目录里的 cover.png）；kind=asset 时是资源相对路径（如 assets/cover.png）。",
            },
          },
          required: ["kind", "value"],
          additionalProperties: false,
        },
        doc: {
          type: "string",
          description: "目标文档 id 或 hpath；省略则用用户当前在面板打开的文档。尽量省略，除非用户明确指定了别的文档。",
        },
        after: {
          type: "string",
          description: "锚点：块 id，或一段只出现在一个块里的原文；省略则追加到文档末尾。",
        },
        alt: {
          type: "string",
          description: "图片说明，写进 markdown 的 ![] 里（省略时用文件名）。",
        },
        width: {
          description: "图片宽度：像素数字（如 560）或百分比字符串（如 \"100%\"）；省略则不加宽度属性。",
        },
      },
      required: ["source"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    /**
     * @param {any} args
     * @returns {Promise<Record<string, unknown>>}
     */
    async execute(args) {
      const input = isPlainObject(args) ? args : {};

      // ---- 1. 参数 ----
      const source = input.source;
      if (!isPlainObject(source)) {
        return fail("invalid_source", "source 必须是 { kind, value }");
      }
      const kind = typeof source.kind === "string" ? source.kind : "";
      if (kind !== "path" && kind !== "asset") {
        return fail("invalid_source", `source.kind 只支持 path / asset，收到「${kind}」`);
      }
      const value = typeof source.value === "string" ? source.value.trim() : "";
      if (value === "") {
        return fail("invalid_source", "source.value 不能为空");
      }
      const width = normalizeImageWidth(input.width);
      if (width.ok !== true) return width;

      // ---- 2. 目标文档 ----
      const target = await resolveDocument(input.doc);
      if (target.ok !== true) return target;
      const docId = target.value.docId;

      // ---- 3. 取图（上传 or 直接引用）----
      let assetPath;
      if (kind === "asset") {
        const checked = isServableAssetPath(value);
        if (checked.ok !== true) return checked;
        assetPath = checked.value;
      } else {
        const uploaded = await uploadLocalImage(value);
        if (uploaded.ok !== true) return uploaded;
        assetPath = uploaded.value;
      }

      // ---- 4. 组装 markdown ----
      const altRaw = typeof input.alt === "string" && input.alt.trim() !== ""
        ? imageAltFromFileName(input.alt)
        : imageAltFromFileName(kind === "path" ? value : assetPath);
      const alt = altRaw === "" ? "图片" : altRaw;
      const markdown = imageMarkdown(assetPath, alt, width.value);

      // ---- 5. 写前快照（失败就中止：宁可不插，也不留一条无法回滚的写入）----
      const info = await callKernel("/api/block/getBlockInfo", { id: docId });
      if (info.ok !== true) return info;
      if (info.value?.data?.rootID !== docId) return fail("invalid_document", "doc 必须是文档 ID，不能是普通内容块");
      const whole = await readWholeDocument(docId);
      if (whole.ok !== true) return whole;
      const snapshot = await deps.backup({
        docId,
        title: target.value.title === "" ? docId : target.value.title,
        kramdown: whole.value,
      });
      if (snapshot.ok !== true) {
        return fail("backup_failed", `写入前的快照失败，已中止（文档未被改动）：${snapshot.error.message}`);
      }

      // ---- 6. 插入（复用第 5 步读到的 kramdown 做锚点定位，不再多读一次）----
      const inserted = await insertLine(docId, input.after, markdown, whole.value);
      if (inserted.ok !== true) return inserted;

      return withoutUndefined({
        ok: true,
        docId,
        blockId: inserted.value.blockId,
        assetPath,
        markdown,
        ...(inserted.value.anchor === undefined ? {} : { after: inserted.value.anchor }),
        summary: `已在文档 ${docId} 插入图片 ${assetPath}${inserted.value.anchor === undefined ? "（文档末尾）" : `（${inserted.value.anchor} 之后）`}。`,
      });
    },
  };
}

/** Tool name the model calls to re-read the editor state on demand. */
export const CONTEXT_TOOL_NAME = "siyuan_note_context";

/**
 * JSON Schema of the tool's (empty) arguments: it reads live state, so it needs none.
 * @returns {Record<string, unknown>}
 */
function contextToolParameters() {
  return { type: "object", properties: {}, additionalProperties: false };
}

/**
 * Drop keys whose value is `undefined`.
 *
 * A tool result passes through DSH's lossless-JSON check, which walks every property: one
 * `undefined` value makes it reject the WHOLE result ("value is not lossless JSON"), even
 * though `JSON.stringify` would silently drop that key. Compacting in one place keeps the
 * guarantee instead of repeating "never return undefined" at every field.
 *
 * @param {Record<string, unknown>} value candidate result.
 * @returns {Record<string, unknown>} the same result without undefined-valued keys.
 */
function withoutUndefined(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out;
}

/**
 * Describe the current editor state as the tool's structured result. Kept separate
 * from the registry call so tests can assert the payload without a Host.
 * @param {ContextSnapshot | undefined} snapshot latest snapshot.
 * @param {number} now epoch milliseconds.
 * @returns {Record<string, unknown>}
 */
export function contextToolValue(snapshot, now = Date.now()) {
  if (snapshot === undefined || snapshot === null || snapshot.docId === null) {
    // No `ageSeconds` here: a document that is not open has no age, and returning
    // `undefined` for it makes DSH reject the entire result as non-lossless JSON.
    return { open: false, summary: "当前没有打开任何思源文档。" };
  }
  return withoutUndefined({
    open: true,
    docId: snapshot.docId,
    title: snapshot.title,
    path: snapshot.hpath,
    cursorLine: snapshot.cursorLine,
    totalLines: snapshot.totalLines,
    selection: snapshot.selection,
    tabs: snapshot.tabs,
    activeTabIndex: snapshot.activeTabIndex,
    view: snapshot.view,
    ...(snapshot.view === "native" ? { blockId: snapshot.blockId || null, pending: snapshot.pending === true } : {}),
    ageSeconds: contextAgeSeconds(snapshot, now),
    summary: describeContext(snapshot, now),
  });
}

/**
 * The last "what is the user looking at" snapshot the panel pushed. It lives in
 * this process on purpose: it is a live view of an open editor, not durable state,
 * and the agent only ever needs the most recent one.
 * @type {ContextSnapshot | undefined}
 */
let editorContext;

/**
 * Read the latest editor snapshot.
 * @returns {ContextSnapshot | undefined}
 */
export function currentEditorContext() {
  return editorContext;
}

/** Drop the snapshot (tests and profile teardown). */
export function clearEditorContext() {
  editorContext = undefined;
}

export function createSiYuanRoutes(options = {}) {
  const configLayer = isPlainObject(options.config) ? options.config : {};
  /** @type {Record<string, unknown>} */
  let stored = {};
  let loaded = false;
  /** @type {Promise<void> | null} */
  let loading = null;
  /** @type {Promise<void>} */
  let writeChain = Promise.resolve();
  let nativeGateway;

  function getNativeGateway() {
    nativeGateway ??= createNativeEditorGateway({
      getSettings: currentSettings,
      sessionStore: createNativeSessionStore({ directory: path.join(dshHome(), "siyuan-native-sessions") }),
      async call(settings, apiPath, payload) {
        const result = await forwardSiYuanApi(settings, apiPath, payload);
        if (!result.ok || result.value?.code !== 0) throw new Error(result.error?.message || result.value?.msg || "思源请求失败");
        return result.value.data;
      },
      async backup(input) {
        const result = await writeBackup(input);
        if (!result.ok) throw new Error(result.error.message);
      },
    });
    return nativeGateway;
  }

  /** @returns {import("./host-utils.js").Settings} */
  function currentSettings() {
    return mergeSettings({ defaults: DEFAULTS, config: configLayer, stored });
  }

  async function ensureLoaded() {
    if (loaded) return;
    if (loading === null) {
      loading = (async () => {
        try {
          const text = await fsp.readFile(settingsFilePath(), "utf8");
          stored = parseSettingsJson(text);
        } catch {
          stored = {};
        }
        loaded = true;
        loading = null;
      })();
    }
    await loading;
  }

  async function reloadStore() {
    loaded = false;
    loading = null;
    stored = {};
    await ensureLoaded();
  }

  /**
   * @param {Record<string, unknown>} patch
   * @returns {Promise<void>}
   */
  async function persist(patch) {
    const task = writeChain.then(async () => {
      const previous = currentSettings();
      const next = { ...stored, ...patch };
      const snapshot = JSON.stringify({ baseUrl: next.baseUrl, token: next.token, timeoutSeconds: next.timeoutSeconds ?? undefined }, null, 2);
      await fsp.mkdir(path.dirname(settingsFilePath()), { recursive: true });
      await writeFileAtomic(settingsFilePath(), `${snapshot}\n`);
      stored = next;
      const updated = currentSettings();
      if (previous.baseUrl !== updated.baseUrl || previous.token !== updated.token) {
        nativeGateway?.reset();
        if (typeof options.onConnectionChanged === "function") options.onConnectionChanged(updated);
        else options.memoryState?.()?.reset?.();
        clearEditorContext();
      }
    });
    // 当前请求保留自己的错误，但队列尾部必须恢复，后续重试才能继续执行。
    writeChain = task.catch(() => {});
    await task;
  }

  /** Last layout read from disk; `undefined` means "not loaded yet". */
  let layoutCache;
  /** @type {Promise<void> | null} */
  let layoutLoading = null;
  /** @type {Promise<void>} */
  let layoutWriteChain = Promise.resolve();

  /**
   * Read the remembered layout once. A corrupt file is treated as "nothing remembered":
   * the panel must never fail to open because of its own memory.
   * @returns {Promise<void>}
   */
  async function ensureLayoutLoaded() {
    if (layoutCache !== undefined) return;
    if (layoutLoading === null) {
      layoutLoading = (async () => {
        try {
          const text = await fsp.readFile(layoutFilePath(), "utf8");
          const parsed = text === "" ? null : JSON.parse(text);
          const normalized = normalizeLayout(parsed === null ? {} : parsed);
          layoutCache = normalized.ok === true ? normalized.value : undefined;
        } catch {
          layoutCache = undefined;
        }
      })();
    }
    await layoutLoading;
  }

  /** @returns {import("./host-utils.js").EditorLayout | undefined} */
  function currentLayout() {
    return layoutCache;
  }

  /**
   * Remember a layout. Writes are serialised so two rapid saves cannot interleave, and
   * a failed write is reported rather than swallowed (the client retries on next change).
   * @param {import("./host-utils.js").EditorLayout} layout
   * @returns {Promise<void>}
   */
  async function persistLayout(layout) {
    const snapshot = JSON.stringify(layout, null, 2);
    const task = layoutWriteChain.then(async () => {
      await fsp.mkdir(path.dirname(layoutFilePath()), { recursive: true });
      await writeFileAtomic(layoutFilePath(), `${snapshot}\n`);
      layoutCache = layout;
    });
    layoutWriteChain = task.catch(() => {});
    await task;
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handler(req, res) {
    try {
      await ensureLoaded();
      const method = typeof req.method === "string" ? req.method.toUpperCase() : "GET";
      const pathname = normalizeRoutePath(typeof req.url === "string" ? req.url : "/");
      const settings = currentSettings();

      if (pathname === "/siyuan/native") {
        if (method !== "POST") { sendJson(res, 405, fail("method_not_allowed", "原生会话只支持 POST")); return; }
        if (req.headers?.["sec-fetch-site"] === "cross-site") { sendJson(res, 403, fail("invalid_origin", "不允许跨来源创建编辑会话")); return; }
        const body = await readJsonBody(req);
        if (body.action === "close") { sendJson(res, 200, succeed({ closed: nativeGateway?.close(body.id) || false })); return; }
        if (body.action === "touch") { sendJson(res, 200, succeed({ active: nativeGateway?.touch(body.id) || false })); return; }
        if (body.action === "forget-login") { sendJson(res, 200, succeed(await getNativeGateway().forgetLogin())); return; }
        if (body.action !== "open") { sendJson(res, 400, fail("invalid_action", "未知原生会话操作")); return; }
        if (req.headers?.origin && req.headers.origin !== body.parentOrigin) { sendJson(res, 403, fail("invalid_origin", "编辑页面来源不匹配")); return; }
        try { sendJson(res, 200, succeed(await getNativeGateway().open(body))); }
        catch (error) { sendJson(res, 400, fail("native_open_failed", error.message)); }
        return;
      }

      if (pathname === ROUTES.state) {
        if (method !== "GET" && method !== "HEAD") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 GET"), { Allow: "GET, HEAD" });
          return;
        }
        const probe = await probeKernelVersion(settings);
        sendJson(res, 200, toPublicState(settings, probe));
        return;
      }

      if (pathname === ROUTES.config) {
        if (method !== "POST") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 POST"), { Allow: "POST" });
          return;
        }
        await handleConfig(req, res, settings);
        return;
      }

      if (pathname === ROUTES.api) {
        if (method !== "POST") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 POST"), { Allow: "POST" });
          return;
        }
        await handleApi(req, res, settings);
        return;
      }

      if (pathname === ROUTES.memory) {
        const store = typeof options.memoryState === "function" ? options.memoryState() : null;
        if (store === null || store === undefined) {
          sendJson(res, 200, fail("memory_unavailable", "记忆体尚未初始化"));
          return;
        }

        /** 解析查询串；解析失败就当没参数。 */
        const search =
          (() => {
            try {
              return new URL(req.url, "http://localhost").searchParams;
            } catch {
              return new URLSearchParams();
            }
          })();

        if (method === "POST") {
          const body = await readJsonBody(req);
          const action = typeof body.action === "string" ? body.action : "";
          const id = typeof body.id === "string" ? body.id : "";
          const statusByAction = { revoke: "revoked", restore: "active", supersede: "superseded" };
          const status = statusByAction[action];
          if (action === 'recording') {
            if (typeof body.enabled !== 'boolean' || !options.setRecording) { sendJson(res, 400, fail('invalid_recording', 'enabled 必须是布尔值')); return; }
            try {
              const state = await options.setRecording(body.enabled);
              // 回包必须与 GET ?view=recording 同形状：面板把这个返回值整个塞回 manager.recording，
              // 少了 sessions 就会让「已停止记录的会话」警告从界面上消失（v5 实测）。
              sendJson(res, 200, succeed({ ...state, sessions: options.blockedSessions?.() ?? [] }));
            } catch (error) { sendJson(res, 400, fail('recording_failed', error.message)); }
            return;
          }
          if (action === 'session-recording') {
            const changed = typeof body.sessionId === 'string' && typeof body.enabled === 'boolean' ? options.setSessionRecording?.(body.sessionId, body.enabled) : null;
            if (!changed) { sendJson(res, 400, fail('invalid_session', '会话不存在或已结束')); return; }
            sendJson(res, 200, succeed({ ...changed, sessions: options.blockedSessions?.() ?? [] })); return;
          }
          if (action === "approve") {
            let supersedes = body.supersedes;
            if (supersedes === undefined) {
              // 面板的「确认生效」不带 supersedes/body。状态类候选若同主题已有有效状态，
              // approve() 里的 checkStateConflict 会一路 400（v5 实测），用户点一下永远失败。
              // 这里按 write() 的同主题自动取代规则先算出取代目标，与「写一条新 state」同规则。
              const context = await store.approvalContext(id, {
                ...(body.global !== undefined ? { global: body.global } : {}),
                ...(typeof body.project === "string" ? { project: body.project } : {}),
                ...(typeof body.workspace === "string" ? { workspace: body.workspace } : {}),
                ...(typeof body.topicId === "string" ? { topicId: body.topicId } : {}),
              });
              if (context.ok === true) {
                const { candidate, conflicts } = context.value;
                // 迁移来的旧候选没有归属工作区：给一句能照做的提示，而不是让
                // approvalSelection 抛「请先为候选选择真实工作区」再让面板把它显示成一行红字。
                if ((!candidate.workspace || candidate.workspace === "unassigned") && typeof body.workspace !== "string") {
                  sendJson(res, 400, fail("workspace_required", "这条候选还没有归属工作区：请先在确认弹窗里选好工作区与项目再确认"));
                  return;
                }
                if (candidate.type === "state" && Array.isArray(conflicts) && conflicts.length > 0) {
                  supersedes = conflicts.slice(0, MEMORY_LIMITS.maxSupersedes).map((item) => item.id);
                }
              }
              // context 不 ok（例如条目已不是候选）：照原样交给 approve 报它自己的错。
            }
            const approved = await store.approve({ id, confidence: "stated", expectedRevision: body.expectedRevision,
              supersedes, expectedRevisions: body.expectedRevisions, body: body.body,
              project: body.project, workspace: body.workspace, global: body.global, topicId: body.topicId });
            sendJson(res, approved.ok ? 200 : 400, approved);
            return;
          }
          if (action === 'recover' || action === 'cleanup-receipts') {
            const result = action === 'recover' ? await store.recoverReceipt({ key: body.key, action: body.operation, expectedVersion: body.expectedVersion, confirmedMissing: body.confirmedMissing }) : await store.cleanupReceipts();
            sendJson(res, result.ok ? 200 : 400, result); return;
          }
          if (action === "reproject") {
            const moved = await store.setProject({
              id,
              project: typeof body.project === "string" ? body.project : "",
              workspace: typeof body.workspace === "string" ? body.workspace : undefined,
              expectedRevision: body.expectedRevision,
            });
            if (moved.ok !== true) {
              sendJson(res, 400, fail(moved.error.code, moved.error.message));
              return;
            }
            sendJson(res, 200, succeed(moved.value));
            return;
          }
          if (status === undefined) {
            sendJson(res, 400, fail("invalid_action", "action 只支持 approve / revoke / restore / supersede / reproject"));
            return;
          }
          const patched = await store.setStatus({
            id,
            status,
            supersededBy: typeof body.supersededBy === "string" ? body.supersededBy : undefined,
            expectedRevision: body.expectedRevision,
          });
          if (patched.ok !== true) {
            sendJson(res, 400, fail(patched.error.code, patched.error.message));
            return;
          }
          // 状态更新由记忆库记录；会话动态上下文会使旧索引失效，无须重建冻结快照。
          sendJson(res, 200, succeed(patched.value));
          return;
        }

        if (method !== "GET" && method !== "HEAD") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 GET / POST"), { Allow: "GET, HEAD, POST" });
          return;
        }

        let readScope;
        if (search.get('workspace') && search.get('view') !== 'approval') {
          readScope = await resolveMemoryScope(search.get('workspace'));
          if (!readScope.workspace) { sendJson(res, 400, fail('invalid_scope', '工作区必须是存在的真实目录')); return; }
        }
        if (search.get("view") === "handoff") {
          const card = await store.handoff({ scope: readScope, project: search.get('project') || undefined });
          sendJson(res, card.ok ? 200 : 503, card);
          return;
        }

        if (search.get("view") === "checkup") {
          const report = await store.checkup({ scope: readScope, project: search.get('project') || undefined });
          sendJson(res, report.ok ? 200 : 503, report);
          return;
        }

        if (search.get('view') === 'recording') { sendJson(res, 200, succeed({ ...(options.recordingState?.() ?? { enabled: true, locked: false }), sessions: options.blockedSessions?.() ?? [] })); return; }
        if (search.get('view') === 'approval' || search.get('view') === 'receipts') {
          const result = search.get('view') === 'approval' ? await store.approvalContext(search.get('id'), {
            ...(search.has('global') ? { global: search.get('global') === 'true' } : {}),
            ...(search.has('project') ? { project: search.get('project') } : {}),
            ...(search.has('workspace') ? { workspace: search.get('workspace') } : {}),
            ...(search.get('topicId') ? { topicId: search.get('topicId') } : {}),
          }) : await store.receiptList();
          sendJson(res, result.ok ? 200 : 400, result); return;
        }

        if (search.get("view") === "entries") {
          const status = search.get("status") ?? undefined;
          const [listed, counts] = await Promise.all([
            store.list({
              scope: readScope,
              type: search.get("type") ?? undefined,
              project: search.get("project") ?? undefined,
              status,
              limit: search.get("limit") ?? undefined,
              offset: search.get("offset") ?? undefined,
            }),
            store.statusCounts(),
          ]);
          if (listed.ok !== true) { sendJson(res, 503, listed); return; }
          // v10：候选不再被 200 条窗口藏掉——不带 status 时单独带一批（最老的在前，先处理积压）。
          // 候选只在第一页带：翻页时重复带一份没有意义，也会让面板重复渲染候选区块。
          const firstPage = (search.get("offset") ?? "0") === "0";
          const candidates = status === undefined && firstPage ? await store.list({ status: "candidate", limit: 20, order: "oldest" }) : null;
          sendJson(res, 200, succeed({
            ...listed.value,
            byStatus: counts.ok === true ? counts.value : { active: 0, candidate: 0, superseded: 0, revoked: 0 },
            ...(candidates !== null && candidates.ok === true ? { candidates: candidates.value.entries } : {}),
          }));
          return;
        }

        if (search.get("view") === "scopes") {
          const listed = await store.scopes();
          sendJson(res, listed.ok === true ? 200 : 503, listed);
          return;
        }

        const state = typeof options.sessionState === 'function' ? options.sessionState(search.get('sessionId')) : null;
        const catalogued = await store.catalog();
        if (!catalogued.ok) { sendJson(res, 503, catalogued); return; }
        const section = state?.section ?? '';
        sendJson(res, 200, succeed({
          // 10 = 2026-11-19 契约 v10：同主题候选确认时一并作废、候选不再被 200 条窗口藏掉（candidates/byStatus）、
          // entries 支持 offset 分页、新增 view=scopes；memory_read 受「记录已关闭」约束且一次批量写计数；
          // reconcile 用一条 SQL 对账（20 个 id 从 40 次请求降到 1–2 次）；写入回执带落点。
          memoryContractVersion: 10,
          catalog: catalogued.value.catalog, box: catalogued.value.box, availability: catalogued.value.availability,
          ring: store.peekRing().length, section, sectionChars: section.length,
          sessionId: state?.sessionId ?? null,
          note: state ? '这是指定会话的冻结快照。' : '未指定 sessionId；这里仅展示存储概览，不代表任何会话提示。',
          ...(state ? { pressureRatio: state.pressure.ratio,
            wroteThisTurn: state.pressure.wroteThisTurn, pressureProbes: state.pressure.probes, queuedChars: state.queuedChars, recall: state.recall, blockedBy: state.blockedBy,
            distillRuns: state.distill.runs, distillLast: state.distill.lastResult, recording: state.recording } : {}),
        }));
        return;
      }

      if (pathname === ROUTES.backup) {
        if (method !== "POST") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 POST"), { Allow: "POST" });
          return;
        }
        await handleBackup(req, res);
        return;
      }

      if (pathname === ROUTES.assetUpload) {
        if (method !== "POST") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 POST"), { Allow: "POST" });
          return;
        }
        await handleAssetUpload(req, res, settings);
        return;
      }

      if (pathname === ROUTES.asset) {
        if (method !== "GET" && method !== "HEAD") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 GET"), { Allow: "GET, HEAD" });
          return;
        }
        await handleAsset(req, res, settings);
        return;
      }

      if (pathname === ROUTES.context) {
        if (method !== "POST") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 POST"), { Allow: "POST" });
          return;
        }
        const raw = await readJsonBody(req);
        if (raw === undefined) {
          sendJson(res, 400, fail("invalid_json", "请求体不是合法 JSON"));
          return;
        }
        const normalized = normalizeContext(raw);
        if (normalized.ok !== true) {
          sendJson(res, 400, normalized);
          return;
        }
        editorContext = normalized.value;
        sendJson(res, 200, succeed({ accepted: true, updatedAt: normalized.value.updatedAt }));
        return;
      }

      if (pathname === ROUTES.layout) {
        if (method === "GET" || method === "HEAD") {
          await ensureLayoutLoaded();
          sendJson(res, 200, succeed({ layout: currentLayout() ?? null }));
          return;
        }
        if (method !== "POST") {
          sendJson(res, 405, fail("method_not_allowed", "该路由只支持 GET 和 POST"), { Allow: "GET, HEAD, POST" });
          return;
        }
        const rawLayout = await readJsonBody(req);
        if (rawLayout === undefined) {
          sendJson(res, 400, fail("invalid_json", "请求体不是合法 JSON"));
          return;
        }
        const normalizedLayout = normalizeLayout(rawLayout);
        if (normalizedLayout.ok !== true) {
          sendJson(res, 400, normalizedLayout);
          return;
        }
        try {
          await persistLayout(normalizedLayout.value);
        } catch (error) {
          sendJson(res, 500, fail("layout_write_failed", `保存布局失败：${error instanceof Error ? error.message : String(error)}`));
          return;
        }
        sendJson(res, 200, succeed({ saved: true, updatedAt: normalizedLayout.value.updatedAt }));
        return;
      }

      sendJson(res, 404, fail("not_found", `未知路由：${pathname}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /** @type {any} */ (error)?.code;
      if (code === "body_too_large") {
        // 上传路由的上限（32 MB）与 JSON 路由（8 MB）不同，所以文案由抛错方给出。
        sendJson(res, 413, fail("body_too_large", message || "请求体过大"));
        return;
      }
      if (code === "invalid_json" || code === "body_error" || code === "body_aborted") {
        sendJson(res, 400, fail("invalid_json", message));
        return;
      }
      try {
        options.logger?.error?.(error);
      } catch {
        /* logging must never mask the response */
      }
      sendJson(res, 500, fail("internal_error", `Host 内部错误：${message}`));
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {import("./host-utils.js").Settings} settings
   */
  async function handleConfig(req, res, settings) {
    const body = await readJsonBody(req);
    const patch = {};

    if (body.baseUrl !== undefined) {
      const baseUrl = normalizeBaseUrl(body.baseUrl);
      if (!baseUrl.ok) {
        sendJson(res, 400, baseUrl);
        return;
      }
      patch.baseUrl = baseUrl.value;
    }
    if (body.token !== undefined) {
      if (body.token !== null && typeof body.token !== "string") {
        sendJson(res, 400, fail("invalid_token", "token 必须是字符串"));
        return;
      }
      patch.token = typeof body.token === "string" ? body.token.trim() : "";
    }
    if (body.timeoutSeconds !== undefined) {
      const seconds = clampTimeoutSeconds(Number(body.timeoutSeconds), settings.timeoutSeconds);
      patch.timeoutSeconds = seconds;
    }

    if (Object.keys(patch).length > 0) {
      await persist(patch);
    }
    const next = currentSettings();
    const probe = await probeKernelVersion(next);
    sendJson(res, 200, toPublicState(next, probe));
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {import("./host-utils.js").Settings} settings
   */
  async function handleApi(req, res, settings) {
    const body = await readJsonBody(req);
    const apiPath = isForwardableApiPath(body.path);
    if (!apiPath.ok) {
      sendJson(res, 400, apiPath);
      return;
    }
    const payload = body.payload === undefined ? {} : body.payload;
    const result = await forwardSiYuanApi(settings, apiPath.value, payload);
    if (result.ok) {
      // The kernel envelope goes back verbatim: { code, msg, data }.
      sendJson(res, 200, result.value);
      return;
    }
    // Transport/parse failure still answers 200 with a JSON error, never an HTML page.
    sendJson(res, 200, result);
  }

  /**
   * Upload images: hand the multipart body to the kernel unchanged.
   *
   * 宿主**不解析** multipart：理解内容对"转发"毫无帮助，反而要求重新拼一份 boundary 一致
   * 的请求体（多一次出错机会）。字段名、`assetsDirPath`、文件名都保持浏览器发来的样子，
   * 因此内核收到的请求与它自己的上传行为完全一致。
   *
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {import("./host-utils.js").Settings} settings
   */
  async function handleAssetUpload(req, res, settings) {
    const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "";
    // `multipart/form-data; boundary=...` —— boundary 必须一起转发，只认前缀即可。
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      sendJson(res, 400, fail("invalid_content_type", "上传请求必须是 multipart/form-data"));
      return;
    }
    const body = await readRawBody(req, LIMITS.maxUploadBytes);
    const result = await forwardSiYuanAssetUpload(settings, { contentType, body });
    // 成功与上游失败都回 200：成功是内核原样信封 `{ code, msg, data }`，
    // 失败是 `{ ok:false, error }` —— 与 `/siyuan/api` 同一条约定。
    sendJson(res, 200, result);
  }

  /**
   * Serve one image out of the kernel's asset folder.
   *
   * 这是浏览器唯一能看到 `assets/` 图片的通道：内核不认没带 token 的静态资源请求。
   *
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {import("./host-utils.js").Settings} settings
   */
  async function handleAsset(req, res, settings) {
    /** @type {URLSearchParams} */
    let search;
    try {
      // `req.url` 是路径形式（`/siyuan/asset?path=...`），必须给 base 才能解析。
      search = new URL(req.url, "http://localhost").searchParams;
    } catch {
      search = new URLSearchParams();
    }
    const checked = isServableAssetPath(search.get("path") ?? "");
    if (checked.ok !== true) {
      sendJson(res, 400, checked);
      return;
    }
    const ifNoneMatch = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : "";
    const result = await forwardSiYuanAsset(settings, checked.value, ifNoneMatch);
    if (result.ok !== true) {
      // 网络问题沿用 `/siyuan/api` 的约定（200 + ok:false）；资源本身的问题回 404，
      // 这样 `<img>` 会走 onerror 分支，而不是把一张错误页当成图片画出来。
      sendJson(res, result.error.code === "upstream_unreachable" ? 200 : 404, result);
      return;
    }
    if (result.value.notModified) {
      /** @type {Record<string, string>} */
      const headers = {
        "Cache-Control": `private, max-age=${LIMITS.assetCacheSeconds}`,
        "X-Content-Type-Options": "nosniff",
      };
      if (result.value.etag) headers.ETag = result.value.etag;
      res.writeHead(304, headers);
      res.end();
      return;
    }
    // 上游回了 200，但浏览器手里那份就是同一张图：回 304，不必再下一次行。
    // （内核自己不做条件请求，所以这一步只能由宿主比对。）
    if (ifNoneMatch !== "" && result.value.etag !== null && ifNoneMatch === result.value.etag) {
      /** @type {Record<string, string>} */
      const headers = {
        ETag: result.value.etag,
        "Cache-Control": `private, max-age=${LIMITS.assetCacheSeconds}`,
        "X-Content-Type-Options": "nosniff",
        // 304 只更新它带上的头；缓存里那份 200 本来就有 CSP，这里再带一次是为了
        // "响应头能自证"——审计时不用回头翻 200。
        ...(isSvgContentType(result.value.contentType) ? { "Content-Security-Policy": SVG_SANDBOX_CSP } : {}),
      };
      res.writeHead(304, headers);
      res.end();
      return;
    }
    /** @type {Record<string, string | number>} */
    const headers = {
      "Content-Type": result.value.contentType,
      "Content-Length": result.value.buffer.length,
      "Cache-Control": `private, max-age=${LIMITS.assetCacheSeconds}`,
      // `assets/` 里除了图片还有内核自带的 .js / .json / .svg，响应类型靠 Content-Type 判定，
      // 这里再禁止浏览器自己嗅探，避免"类型判断"和"渲染方式"出现两套结论。
      "X-Content-Type-Options": "nosniff",
    };
    if (result.value.etag) headers.ETag = result.value.etag;
    if (isSvgContentType(result.value.contentType)) {
      headers["Content-Security-Policy"] = SVG_SANDBOX_CSP;
    }
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : result.value.buffer);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleBackup(req, res) {
    const body = await readJsonBody(req);
    const result = await writeBackup(body);
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    sendJson(res, 200, result);
  }

  return { handler, ensureLoaded, currentSettings, reloadStore, dispose: () => nativeGateway?.dispose() };
}

/**
 * Cordis plugin entry.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {unknown} config validated Config value.
 * @returns {void}
 */
/**
 * 取正文第一行作为展示用的一句话结论。
 * @param {unknown} text
 * @param {number} [limit]
 * @returns {string}
 */
export function firstLine(text, limit = 90) {
  const line = String(typeof text === "string" ? text : "")
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item !== "");
  if (line === undefined) return "";
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

/**
 * `memory_write` 接受的参数名（含 `statement` 别名）。
 *
 * 导出来是为了让测试和报错文案用同一份清单，不出现「文档说支持、代码没实现」。
 */
export const MEMORY_WRITE_ARGS = Object.freeze([
  "type", "project", "text", "statement", "confidence", "global", "topic", "topicId", "evidence", "expectedRevisions", "supersedes",
]);

/**
 * 拦掉工具不认识的参数。
 *
 * 宿主只对 `defineTool` 做参数校验；这些工具是裸 `register`，所以模型把 `supersedes`
 * 拼成 `supersede`、或把正文塞进 `body` 之类，都会被**静默忽略**——写入看起来成功了，
 * 其实什么都没发生（v5 实测）。这里自己点名，让错误回到模型眼前。
 *
 * @param {string} name 工具名，只用于报错。
 * @param {Record<string, any>} args 模型传来的参数。
 * @param {readonly string[]} allowed 允许的参数名（含别名）。
 * @returns {{ ok: false, error: { code: string, message: string } } | null} 参数不合法时返回工具错误值。
 */
export function rejectUnknownArgs(name, args, allowed) {
  if (!isPlainObject(args)) return null;
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return null;
  const shown = allowed.length > 0 ? allowed.join("、") : "（无：这个工具不接受参数）";
  return fail("invalid_arguments", `${name} 不认识参数：${unknown.join("、")}；可用参数：${shown}`);
}

/**
 * 写入结果的用户可见痕迹。
 *
 * 刻意**不用 `actionCards`**：那是 `propose_action` 工具的审批卡机制（卡片由 tool call
 * 派生、按 callId 索引），拿它做痕迹会逼模型每次写记忆都多调一次工具。痕迹放在工具结果
 * 的渲染里就够了——那本来就是用户在对话里看到的东西。
 *
 * @param {Record<string, any>} args
 * @param {Record<string, any>} value
 * @returns {Array<{ type: "text", text: string }>}
 */
export function writeRender(args, value) {
  if (value?.ok === false) {
    return [{ type: "text", text: `记忆写入失败：${value.error?.message ?? "未知错误"}` }];
  }
  const kind = { preference: "偏好", fact: "事实", decision: "决策", state: "状态" }[args?.type] ?? args?.type ?? "记忆";
  const result = value?.duplicate
    ? (value?.status === "candidate" ? "已有候选（推断），未重复追加" : "已存在有效记忆，未重复追加")
    : value?.status === "candidate" ? "已保存为候选（推断），未生效" : "已记住";
  const lines = [`${result}（${kind} · ${args?.project ?? "当前项目"}）：${firstLine(args?.text)}`];
  if (Array.isArray(value?.superseded) && value.superseded.length > 0) {
    lines.push(`已把 ${value.superseded.length} 条旧记忆标记为「已被取代」：${value.superseded.join("、")}`);
  }  // v10：落点写清楚——落点隐式时同一件事会存两份，换个 cwd 就读不到。
  if (value?.placement) {
    const reason = value.placement.global ? "显式全局" : ({ explicit: "指定项目", current: "当前项目" }[value.placement.reason] ?? value.placement.reason ?? "");
    const where = value.placement.global ? "所有工作区" : (value.placement.workspace || "未绑定工作区");
    lines.push(`落点：${value.placement.project ?? "*"} @ ${where}（${reason}）`);
  }
  lines.push(`id ${value?.id ?? "?"}　要改请到思源的「AI 记忆体」笔记本，要撤销请打开侧栏「记忆体」面板。`);
  if (value?.status === 'candidate') lines.push('候选（推断）不进常驻记忆条目，只在候选摘要里列最多 2 条；要它生效，用 confidence=stated 或 verified 重新写入。');
  return [{ type: "text", text: lines.join("\n") }];
}

/**
 * 检索结果的用户可见痕迹。
 *
 * v6 起行格式固定为 `- <id> [<类型> · <项目>[/<主题>] · <状态>] <结论>`。
 * 带上 id 是为了让「search → read」真的走得通：`memory_read` 的 id 只能从这里拿，
 * v5 的渲染里没有 id，模型想读全文只能整篇重新检索一次。
 *
 * 主题只在有条目时拼在项目后面（state 类通常有）；不渲染 topicId——它太长，
 * 需要时 `memory_read` 会把 topicId 和 revision 一起返回。
 *
 * @param {Record<string, any>} args
 * @param {Record<string, any>} value
 * @returns {Array<{ type: "text", text: string }>}
 */
/** 检索行里的日期：同年 MM-DD，跨年 YY-MM-DD。 */
const searchStamp = (created) => {
  const value = String(created ?? "");
  if (!/^\d{8}/u.test(value)) return "";
  const year = value.slice(0, 4);
  const monthDay = value.slice(4, 6) + "-" + value.slice(6, 8);
  return year === String(new Date().getFullYear()) ? monthDay : year.slice(2) + "-" + monthDay;
};
/** 检索行里的可信度：verified=已核实，inferred=推断，stated（用户明确说的）是默认值，不写。 */
const confidenceLabel = (confidence) => (confidence === "verified" ? "已核实" : confidence === "inferred" ? "推断" : "");

export function searchRender(args, value) {
  if (value?.ok === false) return [{ type: "text", text: `记忆检索失败：${value.error?.message ?? "未知错误"}` }];
  const results = Array.isArray(value?.results) ? value.results : [];
  if (results.length === 0) {
    return [{ type: "text", text: `本次检索未找到与「${args?.query ?? ""}」相关的记忆；不能据此认定从未记录。` }];
  }
  const lines = [`命中 ${results.length} 条记忆：`];
  if (value.complete === false) lines.push(`结果被截断：只列出前 ${results.length} 条${value.warning ? `（${value.warning}）` : ""}；可以缩小范围或传更大的 limit。`);
  for (const entry of results) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (id === "") {
      // 防御：老缓存或外部来源的条目可能没有 id。这一支与 v5 逐字一致（含可信度），
      // 宁可格式新旧不统一，也不能因为少一个字段渲染失败。
      const marks = [entry.type, entry.project, entry.status, entry.confidence].filter((item) => typeof item === "string" && item !== "").join(" · ");
      lines.push(`- [${marks}] ${entry.statement}${entry.fresh ? "（刚写入）" : ""}`);
      continue;
    }
    // 一条记忆只占一行：结论截到 80 字，免得超长条目把别的命中项挤出视野。
    const statement = firstLine(entry.statement, 80);
    // 项目为空时只写主题，避免拼出 "/主题" 这种半截路径。
    const location = [entry.project, entry.topic ? firstLine(entry.topic, 24) : ""].filter((item) => typeof item === "string" && item !== "").join("/");
    // v9：补日期与可信度——「三天前」和「三个月前」的区别，决定这条还作不作数；
    // 状态也让位给这两项（active 是默认值，不写）。
    const marks = [entry.type, location, entry.status === "active" ? "" : entry.status, searchStamp(entry.created), confidenceLabel(entry.confidence)]
      .filter((item) => typeof item === "string" && item !== "").join(" · ");
    lines.push(`- ${id} [${marks}] ${statement}${entry.fresh ? "（刚写入）" : ""}`);
  }
  if (args?.query === undefined) lines.push("（这是按类型/项目浏览的结果；要精确找请给 query。）");
  return [{ type: "text", text: lines.join("\n") }];
}

/**
 * 读取结果的用户可见痕迹。
 * @param {Record<string, any>} _args
 * @param {Record<string, any>} value
 * @returns {Array<{ type: "text", text: string }>}
 */
export function readRender(_args, value) {
  if (value?.ok === false) return [{ type: "text", text: `记忆读取失败：${value.error?.message ?? "未知错误"}` }];
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  if (entries.length === 0) return [{ type: "text", text: "本次没有读取到这些 ID；请核对记忆笔记本和查询状态，不能据此认定从未记录。" }];
  return [
    {
      type: "text",
      text: (value.complete === false ? '结果不完整。\n' : '') + (value.missing?.length ? '本次未读取到：' + value.missing.join('、') + '\n' : '') + entries
        .map((entry) => {
          const head = `[${entry.type} · ${entry.project} · ${entry.status ?? ""} · ${entry.confidence}] ${entry.id}\nrevision: ${entry.revision ?? ""}\n来源：${entry.source ?? ""}\n依据：${entry.evidence ?? ""}`;
          const body = typeof entry.body === "string" && entry.body !== "" ? entry.body : entry.statement;
          return `${head}\n${body}`;
        })
        .join("\n\n---\n\n"),
    },
  ];
}

/**
 * 上下文压力提醒的分界点。
 *
 * `dsh-compaction-basic` 的自动压缩默认阈值是 0.8（源码 `:15` 的
 * `DEFAULT_THRESHOLD_RATIO = .8`），到 0.8 再记就晚了——压缩随时发生。0.6 提醒，
 * 留出把话说完的余量。
 */
export const PRESSURE_HINT_RATIO = 0.6;

/**
 * 上下文压力提醒的文本。
 *
 * 这条**不是**常驻 section：section 在一个会话里是冻结的（那是压缩免疫与 prompt cache
 * 的前提），而这条需要随压力和本轮写入情况实时变化，所以走 `systemPrompt.context`
 * ——那是每步重新求值的通道。
 *
 * @param {{ ratio: number, wroteThisTurn: boolean }} input
 * @returns {string} 不需要提醒时返回空串。
 */
export function pressureHintText(input) {
  const ratio = Number(input?.ratio);
  if (!Number.isFinite(ratio) || ratio < PRESSURE_HINT_RATIO) return "";
  const percent = Math.min(99, Math.round(ratio * 100));
  if (input?.wroteThisTurn === true) {
    return `[记忆] 上下文已用约 ${percent}%，压缩随时可能发生；本轮已经把结论写进记忆体，继续即可。`;
  }
  return (
    `[记忆] 上下文已用约 ${percent}%，压缩随时可能发生。` +
    "如果这一轮里有值得跨会话保留的决定、踩过的坑或用户纠正，现在就先用 memory_write 记下来，再继续往下做。"
  );
}

/**
 * 记忆体检报告的用户可见痕迹。
 * @param {Record<string, any>} _args
 * @param {Record<string, any>} value
 * @returns {Array<{ type: "text", text: string }>}
 */
export function checkupRender(_args, value) {
  if (value?.ok === false) return [{ type: "text", text: `记忆体检失败：${value.error?.message ?? "未知错误"}` }];
  const lines = [`记忆体检：已检查 ${value.total} 条，其中 ${value.active} 条有效。`];
  if (value.complete === false) lines.push(`仅检查最近 ${value.scannedLimit ?? value.total} 条，结果不完整，不能代表全库。`);
  const sections = [
    ["重复条目", value.duplicates, (item) => `  · 「${item.statement}」有 ${item.ids.length} 条：${item.ids.join("、")}`],
    ["疑似相似（可能矛盾，需人判断）", value.similar, (item) => `  · ${item.score}　${item.leftText}　↔　${item.rightText}`],
    ["过期状态", value.staleStates, (item) => `  · ${item.statement}（${item.ageDays} 天未更新）`],
    ["断掉的取代链", value.brokenChains, (item) => `  · ${item.statement}——${item.reason}`],
    ["可归档的旧条目", value.archiveCandidates, (item) => `  · ${item.statement}——${item.reason}`],
  ];
  let issues = 0;
  for (const [title, items, render] of sections) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) continue;
    issues += list.length;
    lines.push("", `${title}（${list.length}）：`);
    for (const item of list) lines.push(render(item));
  }
  if (issues === 0) lines.push("", value.complete === false ? '本次检查范围内没有发现问题。' : "没有发现问题。");
  return [{ type: "text", text: lines.join("\n") }];
}

/**
 * 蒸馏结果的用户可见痕迹。
 *
 * 显示正文而不只是结论行：`state` 类条目按约定带「下一步 / 待决」两行，只显示第一行
 * 会让用户以为蒸馏只产出了一句话（实测就发生过这种误判）。
 *
 * @param {Record<string, any>} _args
 * @param {Record<string, any>} value
 * @returns {Array<{ type: "text", text: string }>}
 */
export function distillRender(_args, value) {
  if (value?.ok === false) {
    return [{ type: "text", text: `记忆整理未完成：${value.reason ?? value.error?.message ?? "未知原因"}` }];
  }
  if (!Array.isArray(value?.entries) || value.entries.length === 0) {
    // v8：三种「根本没跑」不能再冒充「没有值得记的」——用户会以为整理过了、本轮结论已存好。
    const reason = typeof value?.reason === "string" ? value.reason : "";
    const lines = [
      reason === "没有新增内容"
        ? "自上次整理以来没有新的对话内容，这次没有运行（没有写入任何条目）。"
        : reason === "cooldown"
          ? "距上次自动整理不足 10 分钟（冷却中），这次没有运行；稍后再让我整理即可。"
          : reason === "子代理不自动整理"
            ? "子代理会话不自动整理记忆；请在主会话里调用 memory_distill。"
            : reason
              ? "这次没有写入条目（原因：" + reason + "）。"
              : "这次会话里没有找到值得长期记住的新东西（没有写入任何条目）。",
    ];
    appendDistillNotes(lines, value);
    return [{ type: "text", text: lines.join("\n") }];
  }
  const lines = [`整理出 ${value.entries.length} 条（新写入 ${value.written ?? 0} 条，已直接生效；记错了可在「记忆体」面板一键撤销）：`];
  for (const entry of value.entries) {
    lines.push("", `[${entry.type} · ${entry.project}${entry.status === 'candidate' ? ' · 候选（推断），未生效' : ''}${entry.duplicate ? ' · 已存在' : ''}]`);
    const body = typeof entry.body === "string" && entry.body.trim() !== "" ? entry.body : entry.statement;
    lines.push(body);
  }
  appendDistillNotes(lines, value);
  return [{ type: "text", text: lines.join("\n") }];
}

/** 被丢弃的条目和还没处理到的内容要说出来，不能让用户以为都记下了。 */
function appendDistillNotes(lines, value) {
  const dropped = Array.isArray(value?.dropped) ? value.dropped : [];
  if (dropped.length) lines.push("", `另有 ${dropped.length} 条不合格未写入：` + dropped.map(item => (item.statement ? `「${item.statement}」` : "") + item.message).join("；"));
  if (Number(value?.remainingChunks) > 0) lines.push("", `还有 ${value.remainingChunks} 段较早的内容没处理到，再整理一次可以继续。`);
}

/**
 * 蒸馏时允许模型填的 project 取值。
 *
 * **必须从文件系统读，不能从记忆库读。** 早期版本从现有条目的 project 里提取候选，
 * 结果形成循环污染：模型编出一个不存在的 `dsh-siyuan-memory` → 它进了库 → 下次被当成
 * 「合法候选」喂回给模型 → 模型继续用它。实测就是这么长出 6 条的。
 *
 * 现在只列工作区里真实存在的子目录，模型只能从里面挑。
 *
 * @param {string} cwd 会话的工作目录。
 * @returns {Promise<string[]>}
 */
export async function knownProjects(cwd) { return (await resolveMemoryScope(cwd)).projects; }

/**
 * 收集每个 project 下当前有效的 `state` 条目 id。
 *
 * 蒸馏写新 state 时用它做「取代」目标：`state` 的语义是当前状态，同一项目只该留一条。
 * 不做这件事的话，每次蒸馏都会并列一条「当前状态与待办」——实测交接卡里已经出现过两条。
 *
 * @param {ReadonlyArray<{ id?: string, type?: string, project?: string, status?: string }>} entries
 * @returns {Map<string, string[]>}
 */
export function collectActiveStates(entries) {
  /** @type {Map<string, string[]>} */
  const byProject = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type !== "state") continue;
    if (entry?.status !== "active") continue;
    if (typeof entry.id !== "string" || entry.id === "") continue;
    const project = typeof entry.project === "string" && entry.project !== "" ? entry.project : "*";
    const bucket = byProject.get(project);
    if (bucket === undefined) byProject.set(project, [entry.id]);
    else bucket.push(entry.id);
  }
  return byProject;
}

export function apply(ctx, config) {
  // 路由先建、记忆体后建：`/siyuan/memory` 需要一个能延迟取到当前实例的读法，
  // 所以用闭包而不是把实例直接传进去。
  /** @type {ReturnType<typeof createMemoryStore> | null} */
  let memory = null;
  let memorySessions = null;
  const recordingSettings = createMemoryRecording(path.join(dshHome(), 'siyuan-memory-policy.json'), () => process.env.DSH_SIYUAN_MEMORY_RECORDING === 'off');

  const routes = createSiYuanRoutes({
    config,
    memoryState: () => memory,
    recordingState: recordingSettings.state,
    setRecording: async enabled => { const state = await recordingSettings.set(enabled); memorySessions?.refreshRecording(); return state; },
    // 会话级的「不记录」要看得见、撤得回：面板列出被停掉的会话，并能一键恢复。
    blockedSessions: () => memorySessions?.blockedSessions() ?? [],
    setSessionRecording: (id, enabled) => memorySessions?.setSessionRecording(id, enabled) ?? null,
    onConnectionChanged: (settings) => {
      memory?.dispose();
      memory = makeMemoryStore(settings);
      memorySessions?.reset();
    },
    // 压力提醒的实时状态也要能从诊断路由里读到——否则「提醒到底接没接上」只能靠猜。
    sessionState: id => memorySessions?.diagnostics(id) ?? null,
    logger: {
      error(error) {
        try {
          ctx.logger?.error?.(error);
        } catch {
          /* ignore a broken logger */
        }
      },
    },
  });

  function makeMemoryStore(settings) {
    // 每个实例固定连接，旧异步操作不能在中途改向另一个内核。
    let boundSettings = settings;
    let receiptStore;
    const getReceipts = async () => {
      await routes.ensureLoaded();
      boundSettings ??= { ...routes.currentSettings() };
      const key = createHash("sha256").update(boundSettings.baseUrl + "\0" + boundSettings.token + "\0" + memoryNotebookName()).digest("hex");
      return receiptStore ??= createMemoryReceipts(path.join(dshHome(), "siyuan-memory-receipts", key));
    };
    const store = createMemoryStore({
      call: async (apiPath, payload, requestOptions) => {
        try {
          await routes.ensureLoaded();
        } catch {
          /* 设置读不出来就退回默认连接，让调用方收到明确的 upstream 错误 */
        }
        if (memory !== store) return fail("connection_changed", "思源连接已切换，请重试");
        boundSettings ??= { ...routes.currentSettings() };
        return forwardSiYuanApi({ ...boundSettings, timeoutSeconds: requestOptions?.timeoutMs ? requestOptions.timeoutMs / 1000 : routes.currentSettings().timeoutSeconds }, apiPath, payload);
      },
      notebookName: memoryNotebookName(),
      receipts: { get: async key => (await getReceipts()).get(key), set: async (key, value) => (await getReceipts()).set(key, value),
        delete: async key => (await getReceipts()).delete(key), list: async () => (await getReceipts()).list() },
      logger: {
        warn(message) {
          try {
            ctx.logger?.warn?.(message);
          } catch {
            /* ignore a broken logger */
          }
        },
      },
    });
    return store;
  }
  memory = makeMemoryStore();

  memorySessions = createMemorySessions({
    store: () => memory,
    getService: name => typeof ctx.get === 'function' ? ctx.get(name) : undefined,
    recordingDisabled: () => !recordingSettings.state().enabled,
  });
  if (ctx.webServer === undefined || typeof ctx.webServer.register !== 'function') return;
  if (ctx.inject) ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({ name: 'siyuan-notes-editor-context', order: CONTEXT_SECTION_ORDER,
      text: () => describeContext(currentEditorContext()) ?? '' }), 'dsh-siyuan-notes: editor context section');
    promptCtx.effect(() => promptCtx.systemPrompt.section({ name: 'siyuan-notes-memory', order: MEMORY_SECTION_ORDER,
      text: context => memorySessions.section(context), interpolate: false }), 'dsh-siyuan-notes: memory section');
    if (typeof promptCtx.systemPrompt.context === 'function') promptCtx.effect(() => promptCtx.systemPrompt.context({
      name: 'siyuan-notes-memory-hint', order: MEMORY_HINT_CONTEXT_ORDER,
      text: context => memorySessions.context(context), interpolate: false,
    }), 'dsh-siyuan-notes: memory context');
  });
  let subscribe;
  try { subscribe = typeof ctx.on === 'function' ? ctx.on.bind(ctx) : null; } catch { subscribe = null; }
  if (subscribe) {
    ctx.effect(() => subscribe('agent/created', ({ agent }) => { void memorySessions.start(agent); }), 'dsh-siyuan-notes: memory session start');
    ctx.effect(() => subscribe('agent/disposed', ({ agent }) => memorySessions.remove(agent)), 'dsh-siyuan-notes: memory session dispose');
    ctx.effect(() => subscribe('agent/turn-stopping', ({ agent }) => { void memorySessions.stop(agent).catch(() => {}); }), 'dsh-siyuan-notes: memory turn stop');
    // 当前宿主先求 section/context，再执行装配 waterfall；补齐已存在会话的首次预热。
    ctx.effect(() => subscribe('system-prompt/assemble', async (assembly, context, next) => {
      await memorySessions.prepare(context?.agent);
      const accepted = typeof next === 'function' ? await next() : assembly;
      return { ...accepted,
        sections: accepted.sections.map(section => section.name === 'siyuan-notes-memory' ? { ...section, text: memorySessions.section(context) } : section),
        contexts: accepted.contexts.map(item => item.name === 'siyuan-notes-memory-hint' ? { ...item, text: memorySessions.hint(context) } : item),
      };
    }), 'dsh-siyuan-notes: memory first assembly');
  }

  // Optional access: Cordis throws on reading a service that was not injected,
  // so a missing tool registry must be probed through ctx.get.
  const toolRegistry = typeof ctx.get === "function" ? ctx.get("tools") : undefined;
  if (toolRegistry !== undefined && typeof toolRegistry.register === "function") {
    ctx.effect(
      () =>
        toolRegistry.register({
          name: CONTEXT_TOOL_NAME,
          description:
            "读取用户在 DSH 思源笔记面板里正在编辑的文档信息：打开的文档 id/标题/路径、光标所在行、" +
            "选中的文本、以及其它打开的标签页。当用户说「这篇」「这里」「这一段」「我正在写的」或问到当前文档时调用。" +
            "返回的是实时快照，含 ageSeconds（距上次汇报的秒数）。",
          parameters: contextToolParameters(),
          output: {
            schema: { type: "object", additionalProperties: true },
            render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
          },
          execute: () => contextToolValue(currentEditorContext()),
        }),
      "dsh-siyuan-notes: editor context tool",
    );

    // --- 插图工具 ---------------------------------------------------------
    //
    // 这是本插件第一个**写文档**的工具，所以依赖全部显式注入：内核调用走与面板同一套
    // settings（token 不出宿主），文件读取、写前快照、编辑器快照都由这里提供。
    const boundImageTool = (settings) => {
      const onConnection = (action) => async (...args) => {
        const matches = () => {
          const current = routes.currentSettings();
          return current.baseUrl === settings.baseUrl && current.token === settings.token;
        };
        if (!matches()) return fail("connection_changed", "插图期间思源连接已切换，请重新确认目标文档");
        const result = await action(...args);
        return matches() ? result : fail("connection_changed", "插图期间思源连接已切换，请检查原文档后重试");
      };
      return createImageInsertTool({
        call: onConnection((apiPath, payload) => forwardSiYuanApi(settings, apiPath, payload)),
        upload: onConnection((input) => forwardSiYuanAssetUpload(settings, input)),
        readFile: (filePath) => fsp.readFile(filePath),
        editorContext: () => currentEditorContext(),
        backup: (input) => writeBackup(input),
      });
    };
    const imageTool = boundImageTool(routes.currentSettings());
    imageTool.execute = async (args) => {
      await routes.ensureLoaded();
      return boundImageTool({ ...routes.currentSettings() }).execute(args);
    };
    ctx.effect(
      () => toolRegistry.register(imageTool),
      "dsh-siyuan-notes: image insert tool",
    );

    const bindTextTool = (settings) => createTextInsertTool({
      call: async (apiPath, payload) => {
        const current = routes.currentSettings();
        if (current.baseUrl !== settings.baseUrl || current.token !== settings.token) return fail("connection_changed", "思源连接已切换，已停止插入");
        return forwardSiYuanApi(settings, apiPath, payload);
      },
      backup: writeBackup,
      editorContext: currentEditorContext,
    });
    const textTool = bindTextTool(routes.currentSettings());
    textTool.execute = async (args) => {
      await routes.ensureLoaded();
      return bindTextTool({ ...routes.currentSettings() }).execute(args);
    };
    ctx.effect(() => toolRegistry.register(textTool), "dsh-siyuan-notes: text insert tool");

    // --- 记忆体：四个工具（search / read / write / distill）------------------
    // 主题目录与体检不再作为模型工具：同主题状态由存储层自动取代，体检只在面板里做。
    //
    // 工具名与描述是模型唯一能看到的东西，所以每个工具的用途、边界、参数规则都写在
    // 它自己的 description / parameters 里，不在别处重复。

    const textOutput = {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };

    ctx.effect(
      () =>
        toolRegistry.register({
          name: "memory_search",
          description:
            "在长期记忆体里检索：跨会话的项目决策、已经踩过并修好的坑、用户偏好、各项目当前状态。" +
            "当用户提到以前的工作、或你需要确认某件事是否已经定过、是否踩过某个坑、用户的偏好是什么时调用。" +
            "默认搜索当前项目及全局。每条结果一行，行首是条目 id，后面是「类型 · 项目（含任务主题）· 日期 · 可信度」和结论；" +
            "query 可以是整句中文（超过 6 字会按二元组展开），也可以用空格分词；整句查询按相关度排序，短关键词按当前项目与时间排。" +
            "这个 id 可以直接传给 memory_read 取全文。需要明确查其他项目时传 allProjects。" +
            "未命中只代表本次检索没有找到；不可用时无法确认。候选尚未经核实，不能当作既定事实。",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "检索词。可以给整句中文（会把词拆成二元组查），也可以给几个关键词（空格分开）；每个词至少 2 个字。",
              },
              type: {
                type: "string",
                enum: [...MEMORY_TYPES],
                description:
                  "限定记忆类型：preference=用户偏好，fact=已核实的事实，decision=做过的决定（含否决的方案），state=项目当前状态。省略则全部搜。",
              },
              project: {
                type: "string",
                description: "限定真实项目名，例如 dsh-siyuan-notes。省略时搜索当前工作区适用项目与全局；跨工作区必须明确传 allProjects。",
              },
              allProjects: { type: "boolean", description: "明确需要跨项目检索或查找未迁移旧记忆时设 true。" },
              status: { type: "string", enum: ["active", "candidate", "superseded", "revoked"] },
              limit: {
                type: "integer",
                description: "返回条数，默认 8，最多 25。",
                minimum: 1,
                maximum: 25,
              },
            },
            additionalProperties: false,
          },
          output: { schema: textOutput.schema, render: searchRender },
          execute: async (args, execution) => {
            const invalid = rejectUnknownArgs("memory_search", args, ["query", "type", "project", "allProjects", "status", "limit"]);
            if (invalid) return invalid;
            const result = await memory.search({
              query: args?.query,
              status: args?.status,
              scope: args?.allProjects === true ? undefined : await memorySessions.scope(execution?.agent),
              type: args?.type,
              project: args?.project,
              limit: args?.limit,
            });
            if (result.ok !== true) return { ok: false, error: result.error };
            const { results, source } = result.value;
            // 不能带 undefined 值：DSH 的 lossless-JSON 校验会因此拒掉整个结果。
            const fresh = results.some((entry) => entry.fresh);
            return {
              ok: true,
              count: results.length,
              source,
              complete: result.value.complete, availability: result.value.availability,
              ...(result.value.warning ? { warning: result.value.warning } : {}),
              ...(fresh
                ? { note: "fresh 只表示最近写入且索引可能尚未同步，不代表内容已核实。" }
                : {}),
              results,
            };
          },
        }),
      "dsh-siyuan-notes: memory_search",
    );

    ctx.effect(
      () =>
        toolRegistry.register({
          name: "memory_read",
          description:
            "按 id 取记忆条目的全文：结论 + 理由 + 被否决的方案。id 来自 memory_search 的结果——每条结果的行首就是 id，直接照抄即可。" +
            "读取会给该条目累加引用计数，用于后续淘汰长期没人看的旧条目。",
          parameters: {
            type: "object",
            properties: {
              ids: {
                type: "array",
                items: { type: "string" },
                description: "要读取的条目 id，最多 20 个。",
              },
            },
            required: ["ids"],
            additionalProperties: false,
          },
          output: { schema: textOutput.schema, render: readRender },
          execute: async (args, execution) => {
            const invalid = rejectUnknownArgs("memory_read", args, ["ids"]);
            if (invalid) return invalid;
            const agent = execution?.agent;
            // v10：读计数也要受「记录已关闭」约束，否则关掉记录后 memory_read 还在改库。
            const result = await memory.read(args?.ids, {
              canWrite: () => !execution?.signal?.aborted && memorySessions.recording(agent),
            });
            memorySessions.watch(execution?.agent, result?.value?.entries?.map(entry => entry.id));
            if (result.ok !== true) return { ok: false, error: result.error };
            // 复核已下线：这些字段对模型没有用，只会占上下文。
            const entries = result.value.entries.map(({ trust: _t, reviewRequired: _r, reviewReason: _rr, reviewAfterDays: _d, approvalHash: _h, approvedAt: _a, approvedBy: _b, echo: _e, fingerprint: _f, ...entry }) => entry);
            return { ok: true, ...result.value, entries };
          },
        }),
      "dsh-siyuan-notes: memory_read",
    );

    ctx.effect(
      () =>
        toolRegistry.register({
          name: "memory_write",
          description:
            "把一条值得跨会话记住的东西记进长期记忆，写入即生效，不需要二次确认。" +
            "在拍板了方案、踩到并修好了一个坑、被用户纠正、或确认了一条用户偏好时调用。" +
            "正文参数名是 text（从检索结果里照抄 statement 亦可）；其余参数只认 schema 里列出的那些，拼错会直接报 invalid_arguments 而不会静默忽略。" +
            "用户说的用 stated（默认），你实际验证过的用 verified；只是你的猜测请显式传 inferred（会存成候选：不进常驻记忆条目，只在候选摘要里列最多 2 条）。" +
            "更新任务进度：直接再写一条同 topic 的 state，旧状态会自动标为已被取代（所以要写完整，保留仍未完成的待办）。修正其他类型的旧结论传 supersedes。",
          parameters: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [...MEMORY_TYPES],
                description:
                  "preference=用户偏好（年），fact=已核实的事实（月），decision=做过的决定（项目周期），state=项目当前状态（天）。",
              },
              project: {
                type: "string",
                description: "真实项目名，省略时使用当前项目。* 默认仅当前工作区；跨所有项目通用须明确设置 global。",
              },
              text: {
                type: "string",
                description:
                  "正文参数名就是 text。Markdown 正文，第一行必须是一句话结论——它会成为检索结果和常驻注入里显示的那一行；" +
                  "state 必须包含 - 下一步：和 - 待决：；其他类型可附理由与否决。从检索结果照抄 statement 也认。",
              },
              confidence: {
                type: "string",
                enum: [...MEMORY_CONFIDENCES],
                description:
                  "这条有多可靠：verified=你在代码或内核上验证过（必须给 evidence）；stated=用户明确说的（默认）；inferred=你自己的推断——只有它会存成候选、不进常驻记忆条目（只在候选摘要里列最多 2 条）。",
              },
              global: { type: 'boolean', description: '仅用户明确要求所有工作区通用时设 true，且 project 必须是 *；候选确认时还会显示范围。' },
              topic: { type: "string", description: "任务主题（state 必填）。同一任务始终用同一个主题名，memory_search 结果里的 topic 可直接照抄；大小写、空格、下划线、连字符的差别会被忽略。" },
              topicId: { type: 'string', description: '可选：memory_search 返回的 topicId，用它可以精确复用已有任务主题。' },
              evidence: { type: "string", description: "核实依据：文件位置或验证结果；verified 必填。" },
              expectedRevisions: { type: "object", additionalProperties: { type: "string" }, description: "可选：supersedes 中旧 ID 对应 memory_read 返回的 revision。传了会校验旧条目没被别人改过；不传以当前版本为准。" },
              supersedes: {
                type: "array",
                items: { type: "string" },
                description: "被这条取代的旧条目 id，最多 5 个。传了就表示这是修正：旧条目保留并标记作废。",
              },
            },
            required: ["type", "text"],
            additionalProperties: false,
          },
          output: { schema: textOutput.schema, render: writeRender },
          execute: async (args, execution) => {
            const invalid = rejectUnknownArgs("memory_write", args, MEMORY_WRITE_ARGS);
            if (invalid) return invalid;
            const agent = execution?.agent;
            if (!memorySessions.recording(agent)) return fail('recording_disabled', '当前会话已设置不记录记忆');
            // 正文参数名是 text；模型常从检索结果里照抄 statement，这里认这个别名。
            // 两者都空要明确点名，否则 store 会报一句「缺少结论」让人猜是哪个参数。
            const body = typeof args?.text === "string" && args.text.trim() !== ""
              ? args.text
              : typeof args?.statement === "string" ? args.statement : "";
            if (body.trim() === "") return fail('missing_text', '缺少 text（正文第一行必须是一句话结论；从检索结果照抄的 statement 也认）');
            const scope = await memorySessions.scope(agent);
            const result = await memory.write({ type: args?.type, project: args?.project, body,
              signal: memorySessions.signal(agent), canWrite: () => !execution?.signal?.aborted && memorySessions.recording(agent), originSessionId: agent?.session?.id,
              topic: args?.topic, topicId: args?.topicId, global: args?.global === true, evidence: args?.evidence, scope, confidence: args?.confidence,
              supersedes: args?.supersedes, expectedRevisions: args?.expectedRevisions,
              source: agent?.session?.id ? 'session:' + agent.session.id : 'tool:memory_write',
            });
            if (!result.ok) return result;
            // v10：回执写清落点（显式传 project / 用当前项目 / 全局）。
            const placement = {
              ...(result.value?.placement ?? { project: '*', workspace: '', global: false }),
              reason: args?.global === true ? 'global' : (typeof args?.project === 'string' && args.project.trim() !== '' ? 'explicit' : 'current'),
            };
            memorySessions.wrote(agent);
            return result.value.status === 'candidate'
              ? { ok: true, ...result.value, placement, nextStep: '这条按 inferred（推断）存为候选，不进常驻记忆条目（只在候选摘要里列最多 2 条）；要它生效就用 confidence=stated / verified 把同样的正文再写一次。' }
              : { ok: true, ...result.value, placement };
          },
        }),
      "dsh-siyuan-notes: memory_write",
    );


    ctx.effect(
      () =>
        toolRegistry.register({
          name: "memory_distill",
          description:
            "把本会话里值得长期记住的东西整理一遍，写入后直接生效（会话内容攒够一定量或上下文快满时也会自动跑）。" +
            "当用户说「整理一下记忆」「把这次聊的记下来」「有什么该记的」时调用。" +
            "它从最近的对话往前读还没整理过的内容，提炼偏好/决定/事实/状态；一次最多处理三段、每段最多 3 条，没有值得记的就什么都不写。",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          output: { schema: textOutput.schema, render: distillRender },
          execute: async (args, execution) => {
            const invalid = rejectUnknownArgs("memory_distill", args, []);
            if (invalid) return invalid;
            return memorySessions.distill(execution?.agent);
          },
        }),
      "dsh-siyuan-notes: memory_distill",
    );
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "prefix",
      path: ROUTE_PREFIX,
      handler: routes.handler,
    });
    return () => {
      routes.dispose();
      memory.dispose();
      memorySessions.dispose();
      try {
        dispose?.();
      } catch {
        /* the carrier already dropped the route */
      }
    };
  }, "dsh-siyuan-notes: /siyuan routes");
}

export default { name, inject, Config, apply };
