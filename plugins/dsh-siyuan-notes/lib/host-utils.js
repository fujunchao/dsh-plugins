/**
 * dsh-siyuan-notes — Host-half pure helpers.
 *
 * Everything in this module is dependency-free (node: builtins only) and side-effect free at
 * import time, so `node --test` can exercise it without a live Cordis context.
 *
 * @module dsh-siyuan-notes/host-utils
 */

import { createRequire } from "node:module";

/**
 * A machine-readable failure carried inside the plugin's JSON envelope.
 * @typedef {{ code: string, message: string }} HostError
 */

/**
 * The effective connection settings after merging Config with the persisted store.
 * @typedef {{ baseUrl: string, token: string, timeoutSeconds: number }} Settings
 */

/** Defaults applied before the Cordis Config layer. */
export const DEFAULTS = Object.freeze({
  baseUrl: "http://127.0.0.1:6806",
  token: "",
  timeoutSeconds: 20,
});

/** Hard limits shared by the router and the helpers. */
export const LIMITS = Object.freeze({
  /** Request bodies above this size are rejected instead of buffered forever. */
  maxBodyBytes: 8 * 1024 * 1024,
  /**
   * Uploads get their own, larger cap。
   *
   * 一张手机原图经常超过 8 MB，而"插图"恰恰是为这种文件存在的；把上限卡在 8 MB
   * 会让功能在最常见的场景下失败。代理路由不缓冲任何东西，所以这个上限只约束上传。
   */
  maxUploadBytes: 32 * 1024 * 1024,
  /** Longest accepted `/api/...` path string. */
  maxPathLength: 2048,
  /** Longest sanitized filename segment. */
  maxFilenameSegment: 64,
  minTimeoutSeconds: 1,
  maxTimeoutSeconds: 300,
  /** The version probe never waits longer than this. */
  probeTimeoutMs: 3000,
  /** 局域网里传大图本来就要几十秒，上传路由至少等这么久。 */
  minUploadTimeoutSeconds: 60,
  /** 代理回来的图片是私有的（同源才用得上），缓存一天足够且不会外泄。 */
  assetCacheSeconds: 86400,
});

/** Prefix registered on `ctx.webServer`. */
export const ROUTE_PREFIX = "/siyuan";

/** The exact route table. The browser half talks to nothing else. */
export const ROUTES = Object.freeze({
  state: "/siyuan/state",
  config: "/siyuan/config",
  api: "/siyuan/api",
  backup: "/siyuan/backup",
  context: "/siyuan/context",
  layout: "/siyuan/layout",
  memory: "/siyuan/memory",
  /** 上传图片：multipart 原样转发给内核，宿主不解析。 */
  assetUpload: "/siyuan/asset/upload",
  /**
   * 取回图片：内核不认没带 token 的 `/assets/...`（会回 SPA 首页），
   * 所以浏览器只能经这条路拿图。
   */
  asset: "/siyuan/asset",
});

/** Caps for the remembered editor layout: a corrupt or hostile file cannot flood the UI. */
export const LAYOUT_LIMITS = Object.freeze({
  maxPanes: 3,
  maxTabsPerPane: 20,
  maxDocIdLength: 64,
  maxTitleLength: 300,
  maxHpathLength: 512,
  maxViewLength: 16,
  /** Open folders in the document tree, and how long one expansion key may be. */
  maxExpanded: 200,
  maxExpansionKeyLength: 700,
});

/** View modes a column may restore to; anything else falls back to the default. */
export const LAYOUT_VIEW_MODES = Object.freeze(["edit", "split", "preview"]);

/**
 * Normalise the editor layout the browser last showed.
 *
 * The layout is a *display* memory, not data: a missing or malformed document simply is
 * not reopened, and every cap is enforced here rather than trusted from the client.
 * `null`/`{}` is a legitimate value meaning "nothing was open".
 *
 * @param {unknown} raw parsed request body.
 * @returns {{ ok: true, value: import("./host-utils.js").EditorLayout } | { ok: false, error: HostError }}
 */
export function normalizeLayout(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_layout", "layout 必须是一个对象");
  }
  const input = /** @type {Record<string, any>} */ (raw);
  const text = (value, limit) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
  const count = (value, min, max) => {
    const number = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.min(max, Math.max(min, number));
  };

  const panes = Array.isArray(input.panes) ? input.panes.slice(0, LAYOUT_LIMITS.maxPanes) : [];
  const normalizedPanes = panes.map((pane) => {
    const entry = pane !== null && typeof pane === "object" && !Array.isArray(pane) ? pane : {};
    const tabs = Array.isArray(entry.tabs) ? entry.tabs.slice(0, LAYOUT_LIMITS.maxTabsPerPane) : [];
    const normalizedTabs = tabs
      .map((tab) => {
        const item = tab !== null && typeof tab === "object" && !Array.isArray(tab) ? tab : {};
        const docId = text(item.docId, LAYOUT_LIMITS.maxDocIdLength);
        if (docId === "") return undefined;
        return {
          docId,
          title: text(item.title, LAYOUT_LIMITS.maxTitleLength),
          hpath: text(item.hpath, LAYOUT_LIMITS.maxHpathLength),
        };
      })
      .filter((tab) => tab !== undefined);
    const active = normalizedTabs.length === 0 ? -1 : count(entry.active, -1, normalizedTabs.length - 1);
    return {
      tabs: normalizedTabs,
      active: active < 0 ? (normalizedTabs.length === 0 ? -1 : 0) : active,
      view: LAYOUT_VIEW_MODES.includes(entry.view) ? entry.view : "split",
      autoSave: entry.autoSave === true,
      indentOn: entry.indentOn !== false,
    };
  });

  const fallbackPane = { tabs: [], active: -1, view: "split", autoSave: false, indentOn: true };
  const finalPanes = normalizedPanes.length > 0 ? normalizedPanes : [fallbackPane];
  const activePane = count(input.activePane, 0, finalPanes.length - 1);

  // The document tree's open folders. Keys are `notebookId::path`; anything without the
  // separator is dropped, because the client could not interpret it.
  //
  // An over-long key is dropped rather than truncated: a cut path is not the folder the
  // user had open, and asking the kernel to list it would fail or open the wrong one.
  // Duplicates are collapsed too: the client cannot produce them, but a hand-edited or
  // older file can, and the panel would waste a request on each copy.
  const expanded = Array.isArray(input.expanded)
    ? input.expanded
        .filter((key) => typeof key === "string")
        .map((key) => key.trim())
        .filter((key) => key !== "" && key.includes("::") && key.length <= LAYOUT_LIMITS.maxExpansionKeyLength)
        .filter((key, index, list) => list.indexOf(key) === index)
        .slice(0, LAYOUT_LIMITS.maxExpanded)
    : [];

  return {
    ok: true,
    value: {
      version: 1,
      panes: finalPanes,
      activePane: Math.min(activePane, finalPanes.length - 1),
      expanded,
      updatedAt: Date.now(),
    },
  };
}

/** Longest selection the client may hand over; anything longer is cut, not rejected. */
export const SELECTION_LIMIT = 4000;

/**
 * Normalise the "what is the user looking at" snapshot the client pushes.
 * Every field is optional: an empty body means "no document is open", which is a
 * legitimate state the agent should be able to see.
 * @param {unknown} raw parsed request body.
 * @param {number} now epoch milliseconds used for the freshness stamp.
 * @returns {{ ok: true, value: ContextSnapshot } | { ok: false, error: HostError }}
 */
export function normalizeContext(raw, now = Date.now()) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_context", "context 必须是一个对象");
  }
  const input = /** @type {Record<string, any>} */ (raw);
  const docId = input.docId === undefined || input.docId === null ? null : input.docId;
  if (docId !== null && typeof docId !== "string") return fail("invalid_context", "docId 必须是字符串或 null");
  if (docId === null) {
    return { ok: true, value: { docId: null, updatedAt: now } };
  }
  const trimmed = docId.trim();
  if (trimmed === "") return { ok: true, value: { docId: null, updatedAt: now } };

  const text = (value, limit = 300) => (typeof value === "string" ? value.slice(0, limit) : "");
  const count = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

  let selection = null;
  const rawSelection = input.selection;
  if (rawSelection !== null && typeof rawSelection === "object") {
    const selectionText = typeof rawSelection.text === "string" ? rawSelection.text : "";
    if (selectionText.trim() !== "") {
      selection = {
        text: selectionText.slice(0, SELECTION_LIMIT),
        startLine: count(rawSelection.startLine),
        endLine: count(rawSelection.endLine),
        ...(input.view === "native" ? { blockId: text(rawSelection.blockId, 64) || null, endBlockId: text(rawSelection.endBlockId, 64) || null } : {}),
      };
    }
  }

  const tabs = Array.isArray(input.tabs)
    ? input.tabs
        .slice(0, 20)
        .map((tab) => ({ docId: text(tab && tab.docId, 64), title: text(tab && tab.title) }))
        .filter((tab) => tab.docId !== "")
    : [];

  return {
    ok: true,
    value: {
      docId: trimmed,
      title: text(input.title),
      hpath: text(input.hpath, 512),
      cursorLine: count(input.cursorLine),
      totalLines: count(input.totalLines),
      selection,
      view: text(input.view, 16),
      ...(input.view === "native" ? { blockId: text(input.blockId, 64) || null, pending: input.pending === true } : {}),
      tabs,
      activeTabIndex: count(input.activeTabIndex),
      updatedAt: now,
    },
  };
}

/**
 * One compact line describing the snapshot, for the model's prompt. Returns
 * undefined when nothing is open so the section adds no noise.
 * @param {ContextSnapshot | undefined} snapshot latest pushed snapshot.
 * @param {number} now epoch milliseconds.
 * @returns {string | undefined}
 */
export function describeContext(snapshot, now = Date.now()) {
  if (snapshot === undefined || snapshot === null || snapshot.docId === null) return undefined;
  const parts = [];
  const title = snapshot.title !== "" ? snapshot.title : snapshot.docId;
  const path = snapshot.hpath !== "" ? snapshot.hpath : "";
  parts.push("思源笔记当前打开：《" + title + "》" + (path !== "" ? "（" + path + "）" : ""));
  if (snapshot.totalLines > 0) {
    parts.push("光标在第 " + Math.max(1, snapshot.cursorLine) + "/" + snapshot.totalLines + " 行");
  }
  if (snapshot.selection !== null) {
    const span = snapshot.selection.endLine > snapshot.selection.startLine ? snapshot.selection.startLine + "-" + snapshot.selection.endLine + " 行" : "1 行";
    parts.push(snapshot.view === "native" ? "已选中文字" : "选中 " + span);
  }
  if (snapshot.view === "native") parts.push("原生块编辑" + (snapshot.blockId ? "，当前块 " + snapshot.blockId : ""));
  const tabCount = snapshot.tabs.length;
  if (tabCount > 1) parts.push("共 " + tabCount + " 个标签页");
  return parts.join("；") + "。";
}

/**
 * Age of a snapshot in whole seconds; used to tell the model whether the state is stale.
 * @param {ContextSnapshot | undefined} snapshot latest pushed snapshot.
 * @param {number} now epoch milliseconds.
 * @returns {number | undefined}
 */
export function contextAgeSeconds(snapshot, now = Date.now()) {
  if (snapshot === undefined || snapshot === null) return undefined;
  return Math.max(0, Math.round((now - snapshot.updatedAt) / 1000));
}

/**
 * Build a `{ ok: false, error }` value.
 * @param {string} code machine-readable error code.
 * @param {string} message human-readable (Chinese) message.
 * @returns {{ ok: false, error: HostError }}
 */
export function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Build a `{ ok: true, value }` value.
 * @template T
 * @param {T} value payload.
 * @returns {{ ok: true, value: T }}
 */
export function succeed(value) {
  return { ok: true, value };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize a SiYuan base URL.
 *
 * Accepts only absolute `http:`/`https:` URLs without userinfo, query string or hash, and
 * returns the canonical form without a trailing slash (so `${baseUrl}/api/x` is well formed).
 *
 * @param {unknown} input raw value from Config, the settings file or a request body.
 * @returns {{ ok: true, value: string } | { ok: false, error: HostError }}
 */
export function normalizeBaseUrl(input) {
  if (typeof input !== "string") {
    return fail("invalid_base_url", "baseUrl 必须是字符串");
  }
  const raw = input.trim();
  if (raw === "") {
    return fail("invalid_base_url", "baseUrl 不能为空");
  }
  /** @type {URL} */
  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail("invalid_base_url", `baseUrl 不是合法的 URL：${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("invalid_base_url", "baseUrl 只支持 http:// 或 https://");
  }
  if (url.username !== "" || url.password !== "") {
    return fail("invalid_base_url", "baseUrl 不能包含用户名或密码");
  }
  if (url.hostname === "") {
    return fail("invalid_base_url", "baseUrl 缺少主机名");
  }
  if (url.search !== "" || url.hash !== "") {
    return fail("invalid_base_url", "baseUrl 不能包含 ? 查询串或 # 锚点");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return succeed(`${url.origin}${pathname}`);
}

/**
 * Turn an arbitrary document id / title into a Windows- and POSIX-safe filename segment.
 *
 * @param {unknown} input raw value.
 * @param {{ maxLength?: number, fallback?: string }} [options]
 * @returns {string} a non-empty, separator-free segment.
 */
export function sanitizeSegment(input, options = {}) {
  const maxLength = clampInt(options.maxLength, 1, LIMITS.maxFilenameSegment, LIMITS.maxFilenameSegment);
  // An explicit "" fallback is honoured (callers that want to detect "nothing left"), while
  // an omitted one still yields a non-empty segment.
  const fallback = options.fallback === undefined ? "untitled" : String(options.fallback);
  if (input === null || input === undefined) {
    return fallback;
  }
  let text = String(input);
  text = text.replace(/[\u0000-\u001f\u007f]/g, "");
  // Windows forbids these outright; a dash keeps the name readable.
  text = text.replace(/[\\/:*?"<>|]/g, "-");
  text = text.replace(/\s+/g, "-");
  text = text.replace(/-{2,}/g, "-");
  text = text.replace(/^[.\-_\s]+/, "").replace(/[.\-_\s]+$/, "");
  if (text.length > maxLength) {
    text = text.slice(0, maxLength).replace(/[.\-_\s]+$/, "");
  }
  if (text === "" || text === "." || text === "..") {
    return fallback;
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text)) {
    return `_${text}`;
  }
  return text;
}

/**
 * Format a timestamp as a filename-safe ISO-8601 string: `2026-11-03T09-11-53-123Z`.
 * @param {Date} [date]
 * @returns {string}
 */
export function isoTimestampForFile(date = new Date()) {
  const time = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return time.toISOString().replace(/[:.]/g, "-");
}

/**
 * Build the backup filename for one document: `<timestamp>-<docId>.md`.
 *
 * @param {{ docId?: unknown, title?: unknown, now?: Date }} input
 * @returns {string} filename without a directory part.
 */
export function backupFileName(input = {}) {
  const docId = sanitizeSegment(input.docId, { fallback: "" });
  const title = sanitizeSegment(input.title, { maxLength: 40, fallback: "" });
  const stem = docId !== "" ? docId : title !== "" ? title : "doc";
  return `${isoTimestampForFile(input.now)}-${stem}.md`;
}

/**
 * Decide whether a browser-supplied path may be forwarded to the SiYuan kernel.
 *
 * Only same-kernel POST API calls are allowed: no absolute URLs (SSRF surface), no traversal,
 * no query strings, no whitespace or control characters.
 *
 * @param {unknown} input
 * @returns {{ ok: true, value: string } | { ok: false, error: HostError }}
 */
export function isForwardableApiPath(input) {
  if (typeof input !== "string") {
    return fail("invalid_path", "path 必须是字符串");
  }
  if (input.length === 0 || input.length > LIMITS.maxPathLength) {
    return fail("invalid_path", `path 长度必须在 1..${LIMITS.maxPathLength} 之间`);
  }
  if (!input.startsWith("/api/")) {
    return fail("invalid_path", "path 必须以 /api/ 开头");
  }
  if (input.includes("\\")) {
    return fail("invalid_path", "path 不能包含反斜杠");
  }
  if (input.includes("//")) {
    return fail("invalid_path", "path 不能包含连续斜杠");
  }
  if (/[\u0000-\u001f\u007f\s]/.test(input)) {
    return fail("invalid_path", "path 不能包含空白或控制字符");
  }
  if (input.split("/").some((part) => part === ".." || part === ".")) {
    return fail("invalid_path", "path 不能包含 . 或 .. 片段");
  }
  if (!/^\/api\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]+$/.test(input)) {
    return fail("invalid_path", "path 含有不被允许的字符（查询串请放进 payload）");
  }
  return succeed(input);
}

/**
 * Validate a SiYuan asset path for the image proxy.
 *
 * 内核确实提供 `/assets/<name>`，但没带 token 的请求一定拿不到图（实测 3.8.3：裸请求 401 JSON，
 * 浏览器式请求被 302 到 `/check-auth`，跟随之后落到 SPA 首页），所以浏览器不可能直接
 * `<img src>`：只能向本宿主取图。于是这个函数就是那道安全边界，它刻意比"任意路径"窄得多——
 * 只放行工作空间级的 `assets/` 目录，文档、笔记本配置、工作空间本身一律够不到。
 *
 * **不设 ASCII 白名单**：思源保留上传时的原文件名，中文是常态（用户库里 62 张图
 * 全部是 `assets/中文名-时间戳-随机.png`），拿 `isForwardableApiPath` 那套字符集来卡，
 * 结果是一张图都显示不出来。这里校验的是**结构**：解码后以 `assets/` 开头、没有空段、
 * 没有 `.`/`..`、没有控制字符、没有 `?`/`#`/`:`、没有嵌套百分号编码。
 *
 * @param {unknown} input
 * @returns {{ ok: true, value: string } | { ok: false, error: HostError }} `value` 是解码后的真实路径。
 */
export function isServableAssetPath(input) {
  if (typeof input !== "string") {
    return fail("invalid_asset_path", "path 必须是字符串");
  }
  if (input.length === 0 || input.length > LIMITS.maxPathLength) {
    return fail("invalid_asset_path", `path 长度必须在 1..${LIMITS.maxPathLength} 之间`);
  }
  if (!input.startsWith("assets/") || input.length === "assets/".length) {
    return fail("invalid_asset_path", "path 必须是 assets/ 下的资源路径");
  }
  // 结构一律以"解码之后"的形态判断：`assets/%2e%2e/x.png` 字面看不出穿越，解码后才是
  // `assets/../x.png`；解不出来（畸形编码）就直接拒绝。
  let decoded;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return fail("invalid_asset_path", "path 含有无法解码的百分号编码");
  }
  if (!decoded.startsWith("assets/") || decoded.length === "assets/".length) {
    return fail("invalid_asset_path", "path 必须是 assets/ 下的资源路径");
  }
  if (decoded.includes("\\")) {
    return fail("invalid_asset_path", "path 不能包含反斜杠");
  }
  if (decoded.includes("//")) {
    return fail("invalid_asset_path", "path 不能包含连续斜杠");
  }
  // 只禁控制字符。文件名里的空格是常态（从桌面拖进来的图片常常带空格），而空格在 URL 里
  // 会被逐段编码，不构成风险；制表/换行/空字节则一定是有人在构造畸形请求。
  if (/[\u0000-\u001f\u007f]/.test(decoded)) {
    return fail("invalid_asset_path", "path 不能包含控制字符");
  }
  if (decoded.includes("?") || decoded.includes("#") || decoded.includes(":")) {
    return fail("invalid_asset_path", "path 不能包含 ? # 或 :");
  }
  // 解出替换字符 = 上游给了非法 UTF-8 字节序列，那种路径不可能对应真实文件。
  if (decoded.includes("\uFFFD")) {
    return fail("invalid_asset_path", "path 含有无法解码的字节序列");
  }
  // 解一次之后不该再看到百分号转义：`%252e%252e` 这类双层编码会让我们把 `%2e%2e`
  // 当成字面文件名发给内核，而内核可能又解一次。真实文件名里不会出现 `%41` 这种形状。
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
    return fail("invalid_asset_path", "path 含有嵌套的百分号编码");
  }
  if (decoded.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return fail("invalid_asset_path", "path 不能包含 . 或 .. 片段");
  }
  // 返回解码后的真实路径：调用方会逐段 encodeURIComponent 去取它。
  return succeed(decoded);
}

/**
 * Clamp `timeoutSeconds` into the accepted range.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampTimeoutSeconds(value, fallback = DEFAULTS.timeoutSeconds) {
  return clampInt(Math.round(Number(value)), LIMITS.minTimeoutSeconds, LIMITS.maxTimeoutSeconds, fallback);
}

/**
 * Clamp an integer into `[min, max]`, falling back when the input is not finite.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
export function clampInt(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/** @param {Record<string, unknown>} input @returns {Record<string, unknown>} */
function pickKnownSettings(input) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const key of ["baseUrl", "token", "timeoutSeconds"]) {
    if (Object.hasOwn(input, key) && input[key] !== undefined && input[key] !== null) {
      picked[key] = input[key];
    }
  }
  return picked;
}

/**
 * Merge defaults <- Cordis Config <- persisted settings file, then normalize every field.
 *
 * The persisted store wins over Config so that a value changed in the panel survives a
 * package upgrade and a stale `cordis.patch.yml`.
 *
 * @param {{ defaults?: Settings, config?: unknown, stored?: unknown }} [parts]
 * @returns {Settings}
 */
export function mergeSettings(parts = {}) {
  const defaults = isPlainObject(parts.defaults) ? { ...DEFAULTS, ...parts.defaults } : { ...DEFAULTS };
  const config = isPlainObject(parts.config) ? pickKnownSettings(parts.config) : {};
  const stored = isPlainObject(parts.stored) ? pickKnownSettings(parts.stored) : {};
  const merged = { ...DEFAULTS, ...defaults, ...config, ...stored };

  const baseUrl = normalizeBaseUrl(merged.baseUrl);
  const token = typeof merged.token === "string" ? merged.token.trim() : "";

  return {
    baseUrl: baseUrl.ok ? baseUrl.value : DEFAULTS.baseUrl,
    token,
    timeoutSeconds: clampTimeoutSeconds(merged.timeoutSeconds),
  };
}

/**
 * Project the internal settings onto the wire shape used by `GET /siyuan/state`.
 * The token itself never leaves the Host — only `hasToken`.
 *
 * @param {Settings} settings
 * @param {{ version?: unknown, error?: unknown }} [extra]
 * @returns {{ ok: true, value: { baseUrl: string, hasToken: boolean, version: string | null, error?: string } }}
 */
export function toPublicState(settings, extra = {}) {
  /** @type {{ baseUrl: string, hasToken: boolean, version: string | null, error?: string }} */
  const value = {
    baseUrl: settings.baseUrl,
    hasToken: typeof settings.token === "string" && settings.token.length > 0,
    version: typeof extra.version === "string" && extra.version !== "" ? extra.version : null,
  };
  if (typeof extra.error === "string" && extra.error !== "") {
    value.error = extra.error;
  }
  return succeed(value);
}

/**
 * Parse the persisted settings file defensively.
 * @param {string} text raw file content.
 * @returns {Record<string, unknown>} the object, or `{}` for anything unusable.
 */
export function parseSettingsJson(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Normalize a route pathname for dispatch.
 *
 * Tolerates both a full `/siyuan/state` and a prefix-stripped `/state`, so the router keeps
 * working whether or not the carrier removes the registered prefix. A trailing slash is
 * ignored.
 *
 * @param {string} pathname
 * @returns {string} the normalized path (see `ROUTES`), or the best-effort original.
 */
export function normalizeRoutePath(pathname) {
  const raw = typeof pathname === "string" ? pathname : "";
  const withoutQuery = raw.split("?")[0].split("#")[0];
  let cleaned = withoutQuery.replace(/\/{2,}/g, "/");
  if (cleaned.length > 1) {
    cleaned = cleaned.replace(/\/+$/, "");
  }
  if (cleaned === "") {
    return ROUTE_PREFIX;
  }
  if (cleaned === ROUTE_PREFIX || cleaned.startsWith(`${ROUTE_PREFIX}/`)) {
    return cleaned;
  }
  if (cleaned.startsWith("/")) {
    return `${ROUTE_PREFIX}${cleaned}`;
  }
  return `${ROUTE_PREFIX}/${cleaned}`;
}

/**
 * Turn a fetch/network failure into a short Chinese message.
 * @param {unknown} error
 * @returns {string}
 */
export function describeFetchError(error) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "连接思源超时，请确认内核已启动且地址可访问";
    }
    // undici wraps socket failures: TypeError("fetch failed") -> cause (Error | AggregateError).
    const cause = /** @type {any} */ (error).cause;
    const code =
      /** @type {any} */ (error).code ??
      cause?.code ??
      cause?.errors?.[0]?.code ??
      cause?.cause?.code;
    if (code === "ECONNREFUSED") return "思源内核拒绝连接（ECONNREFUSED），请确认地址与端口";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "无法解析思源地址（ENOTFOUND）";
    if (code === "ECONNRESET") return "连接被重置（ECONNRESET）";
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "网络不可达，请确认思源主机在线";
    if (code === "CERT_HAS_EXPIRED" || String(code).startsWith("UNABLE_TO_VERIFY")) return "TLS 证书校验失败";
    if (code !== undefined) return `${error.message === "" ? error.name : error.message}（${code}）`;
    const causeMessage = typeof cause?.message === "string" && cause.message !== "" ? `：${cause.message}` : "";
    return `${error.message === "" ? error.name : error.message}${causeMessage}`;
  }
  return String(error);
}

/**
 * Validate a raw Config object and return the normalized settings.
 * @param {unknown} value
 * @returns {{ ok: true, value: Settings } | { ok: false, error: HostError & { field?: string } }}
 */
export function validateConfigValue(value) {
  const input = isPlainObject(value) ? value : {};
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULTS.baseUrl);
  if (!baseUrl.ok) {
    return { ok: false, error: { ...baseUrl.error, field: "baseUrl" } };
  }
  if (input.token !== undefined && input.token !== null && typeof input.token !== "string") {
    return { ok: false, error: { code: "invalid_token", message: "token 必须是字符串", field: "token" } };
  }
  if (
    input.timeoutSeconds !== undefined &&
    input.timeoutSeconds !== null &&
    !Number.isFinite(Number(input.timeoutSeconds))
  ) {
    return { ok: false, error: { code: "invalid_timeout", message: "timeoutSeconds 必须是数字", field: "timeoutSeconds" } };
  }
  return succeed(
    mergeSettings({
      config: {
        baseUrl: baseUrl.value,
        token: typeof input.token === "string" ? input.token : DEFAULTS.token,
        timeoutSeconds: input.timeoutSeconds ?? DEFAULTS.timeoutSeconds,
      },
    }),
  );
}

/**
 * Load `@deepseek-ai/schemastery` if (and only if) the running profile can resolve it.
 *
 * A workspace bundle has no `node_modules`, so this normally returns `null` and the plugin
 * falls back to {@link createPlainConfigSchema}, which is wire-compatible with Cordis: Cordis
 * only consumes `Config["~standard"].validate`, the Standard Schema v1 interface schemastery
 * itself implements.
 *
 * @returns {any | null}
 */
export function loadSchemastery() {
  try {
    const require = createRequire(import.meta.url);
    const loaded = require("@deepseek-ai/schemastery");
    const schema = loaded?.default ?? loaded;
    return typeof schema?.object === "function" ? schema : null;
  } catch {
    return null;
  }
}

/**
 * Describe the three Config fields once, so both schema flavours stay in sync.
 * @returns {Array<{ key: string, type: "string" | "number", default: string | number, description: string, minimum?: number, maximum?: number, step?: number, format?: string }>}
 */
export function configFieldSpecs() {
  return [
    {
      key: "baseUrl",
      type: "string",
      default: DEFAULTS.baseUrl,
      description: "思源内核地址，例如 http://127.0.0.1:6806（也可在面板里改）",
      format: "uri",
    },
    {
      key: "token",
      type: "string",
      default: DEFAULTS.token,
      description: "思源 API token：思源 → 设置 → 关于 → API token（留空表示内核未设 token）",
    },
    {
      key: "timeoutSeconds",
      type: "number",
      default: DEFAULTS.timeoutSeconds,
      minimum: LIMITS.minTimeoutSeconds,
      maximum: LIMITS.maxTimeoutSeconds,
      step: 1,
      description: "单次请求思源内核的超时秒数",
    },
  ];
}

/**
 * Build a schemastery schema when the profile ships the package, else a dependency-free
 * Standard Schema object with the same field set.
 *
 * @returns {object} a value usable as a Cordis `Config` export.
 */
export function createConfigSchema() {
  const z = loadSchemastery();
  if (z) {
    try {
      const fields = configFieldSpecs();
      /** @type {Record<string, any>} */
      const shape = {};
      for (const field of fields) {
        let schema = field.type === "number" ? z.number() : z.string();
        if (field.type === "number") {
          schema = schema.min(field.minimum).max(field.maximum).step(field.step);
        }
        schema = schema.default(field.default).description(field.description);
        // volatile(): the settings form edits this value without writing it back to the
        // patch layer — the Host owns persistence in ~/.dsh/siyuan-notes.json.
        if (typeof schema.volatile === "function") {
          schema = schema.volatile();
        }
        shape[field.key] = schema;
      }
      const built = z.object(shape).description("dsh-siyuan-notes 连接设置");
      if (built && typeof built["~standard"]?.validate === "function") {
        return built;
      }
    } catch {
      // fall through to the plain schema
    }
  }
  return createPlainConfigSchema();
}

/**
 * The dependency-free `Config` implementation.
 *
 * Implements Standard Schema v1 (`~standard.validate`) plus JSON Schema metadata
 * (`~standard.jsonSchema`, `toJSON()`, `toString()`), which is what the Host settings form
 * reads when it can introspect a plugin schema.
 *
 * @returns {object}
 */
export function createPlainConfigSchema() {
  const fields = configFieldSpecs();
  /** @type {Record<string, any>} */
  const properties = {};
  /** @type {string[]} */
  const required = [];
  for (const field of fields) {
    /** @type {Record<string, any>} */
    const property = {
      type: field.type,
      default: field.default,
      description: field.description,
      // Marker understood by dsh settings forms: do not persist the edited value into the
      // patch layer; the plugin keeps its own store.
      "x-dsh-volatile": true,
    };
    if (field.format !== undefined) property.format = field.format;
    if (field.minimum !== undefined) property.minimum = field.minimum;
    if (field.maximum !== undefined) property.maximum = field.maximum;
    if (field.step !== undefined) property.multipleOf = field.step;
    properties[field.key] = property;
  }
  const jsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    title: "dsh-siyuan-notes",
    description: "SiYuan Note 连接设置",
    properties,
    required,
    additionalProperties: false,
  };

  return {
    "~standard": {
      version: 1,
      vendor: "dsh-siyuan-notes",
      validate(value) {
        const result = validateConfigValue(value);
        if (result.ok) {
          return { value: result.value };
        }
        return {
          issues: [{ message: result.error.message, path: result.error.field ? [result.error.field] : [] }],
        };
      },
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
    toJSON() {
      return jsonSchema;
    },
    toString() {
      return JSON.stringify(jsonSchema);
    },
  };
}
