// 思源原生编辑器网关：每个编辑会话一个隔离的本机来源，不转存思源前端构建。
import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { nativeConnectionKey, readNativeLoginCookie, validateNativeSession } from "./native-session.js";

const BRIDGE_NAME = "dsh-native-editor-bridge";
const DOC_ID = /^\d{14}-[a-z0-9]{7}$/;
const scriptFile = new URL("./native-bridge.cjs", import.meta.url);
const loginFile = new URL("./native-login.html", import.meta.url);
const MAX_BODY = 32 * 1024 * 1024;
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailer"]);

const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
};
const envelope = (data = null) => ({ code: 0, msg: "", data });
const escapeScript = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

async function requestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求超过 32 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// 配置只用于初始化原生界面，私密凭据仍留在内核和 DSH 宿主。
export function redactNativeConfig(value) {
  if (Array.isArray(value)) return value.map(redactNativeConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:apiKey|apiToken|token|accessAuthCode|password|secret|authorization)$/i.test(key) ? "" : redactNativeConfig(item)]));
}

export function createNativeEditorGateway({ getSettings, call, backup, onContext, maxSessions = 3, sessionStore, validateSession = validateNativeSession, now = Date.now }) {
  const sessions = new Map();
  let disposed = false;
  let loginState = null;
  let opening = 0;
  let authEpoch = 0;

  async function forgetLogin() {
    const settings = { ...getSettings() };
    authEpoch++;
    loginState = null;
    await sessionStore?.forget(settings);
    // 已打开的文稿继续完成事务；下次打开要重新登录。
    return { forgotten: true };
  }

  async function open({ docId, title = "", parentOrigin }) {
    if (sessions.size + opening >= maxSessions) throw new Error("最多同时打开三个原生编辑栏，请先关闭一个");
    opening++;
    try { return await openSession({ docId, title, parentOrigin }); }
    finally { opening--; }
  }

  async function openSession({ docId, title = "", parentOrigin }) {
    const openedEpoch = authEpoch;
    if (disposed) throw new Error("原生编辑网关已关闭");
    if (!DOC_ID.test(docId || "")) throw new Error("原生编辑需要有效文档 ID");
    if (parentOrigin !== "null" && parentOrigin !== "dsh-app://app") {
      const parent = new URL(parentOrigin);
      if (!["http:", "https:"].includes(parent.protocol) || parent.origin !== parentOrigin) throw new Error("无效的宿主页面来源");
    }
    const settings = { ...getSettings() };
    const info = await call(settings, "/api/block/getBlockInfo", { id: docId });
    if (info.rootID !== docId) throw new Error("原生编辑目标必须是文档");
    const version = await call(settings, "/api/system/version", {});
    // 当前适配从 3.8.3 验证，缺少公开 flush 方法时页面会明确拒绝准备完成。
    if (!/^3\.8\./.test(String(version))) throw new Error(`当前原生试用支持思源 3.8.x，已连接 ${version}`);
    // 3.8.3 的 WebSocket 不接受 HTTP API token，使用正式登录接口取得仅宿主持有的会话。
    const configuration = await call(settings, "/api/system/getConf", {});
    const requiresLogin = Boolean(configuration.conf?.accessAuthCode);
    const connection = nativeConnectionKey(settings);
    let cached = loginState?.connection === connection ? loginState : null;
    if (cached?.expiresAt !== null && cached?.expiresAt <= now()) { cached = null; loginState = null; await sessionStore?.forget(settings); }
    if (requiresLogin && !cached && sessionStore) cached = await sessionStore.load(settings);
    if (requiresLogin && cached) {
      if (!await validateSession(settings, cached.cookie)) {
        cached = null; loginState = null; await sessionStore?.forget(settings);
      } else if (authEpoch === openedEpoch) loginState = { ...cached, connection };
    }
    if (authEpoch !== openedEpoch) throw new Error("登录状态已改变，请重新打开原生编辑器");
    const upstreamCookie = cached?.cookie || "";
    const before = await call(settings, "/api/block/getBlockKramdown", { id: docId });
    if (backup) await backup({ docId, title, kramdown: before.kramdown });
    const id = randomBytes(24).toString("hex");
    const hostname = `dsh-sy-${id}.localhost`;
    const channel = randomBytes(24).toString("hex");
    const sockets = new Set();
    const upstreamRequests = new Set();
    const pluginSource = await readFile(scriptFile, "utf8");
    if (disposed || getSettings().baseUrl !== settings.baseUrl || getSettings().token !== settings.token) throw new Error("思源连接已改变，请重新打开原生编辑器");
    const session = { id, docId, title, parentOrigin, channel, settings, version, upstreamCookie, authenticated: !requiresLogin || Boolean(upstreamCookie), sockets, upstreamRequests, touched: Date.now(), localStorage: null };
    sessions.set(id, session);

    const authorized = (req, navigation = false) => {
      if (req.headers.host !== `${hostname}:${session.port}`) return false;
      const origin = req.headers.origin;
      if (origin && origin !== session.origin) return navigation && origin === parentOrigin;
      const site = req.headers["sec-fetch-site"];
      if (site === "cross-site" && !navigation) return false;
      return true;
    };
    const error = (res, message, status = 502) => json(res, status, { code: -1, msg: message, data: null });
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, session.origin);
        const pathname = url.pathname;
        const entry = pathname === "/stage/build/desktop/";
        if (url.origin !== session.origin || !authorized(req, entry)) { error(res, "原生编辑会话来源不匹配", 403); return; }
        session.touched = Date.now();
        if (entry && req.method !== "GET") { error(res, "不支持的页面请求", 405); return; }
        if (req.method === "OPTIONS") { error(res, "不支持跨来源请求", 403); return; }
        if (pathname === "/__dsh/login" || pathname === "/__dsh/captcha") {
          const isLogin = pathname.endsWith("login");
          if (isLogin && (req.method !== "POST" || req.headers.origin !== session.origin)) { error(res, "无效登录来源", 403); return; }
          const body = isLogin ? JSON.parse((await requestBody(req)).toString("utf8")) : null;
          if (isLogin && body.channel !== channel) { error(res, "无效登录会话", 403); return; }
          const loginEpoch = authEpoch;
          const rememberMe = isLogin && body.rememberMe === true;
          const upstream = await fetch(settings.baseUrl + (isLogin ? "/api/system/loginAuth" : "/api/system/getCaptcha"), {
            method: "POST", headers: { "Content-Type": "application/json", ...(session.upstreamCookie ? { Cookie: session.upstreamCookie } : {}) },
            body: JSON.stringify(isLogin ? { authCode: body.authCode, captcha: body.captcha || "", rememberMe } : {}),
            signal: AbortSignal.timeout(15000), redirect: "error",
          });
          const cookies = upstream.headers.getSetCookie();
          const loginCookie = readNativeLoginCookie(cookies, now());
          if (loginCookie) session.upstreamCookie = loginCookie.cookie;
          if (isLogin) {
            const result = await upstream.json();
            if (!sessions.has(id) || disposed || loginEpoch !== authEpoch) { error(res, "登录会话已关闭或改变，请重新打开", 409); return; }
            let remembered = false;
            let warning = "";
            let expiresAt = null;
            if (upstream.ok && result.code === 0 && loginCookie && (loginCookie.expiresAt === null || loginCookie.expiresAt > now())) {
              session.authenticated = true;
              expiresAt = loginCookie.expiresAt;
              loginState = { connection, cookie: session.upstreamCookie, expiresAt };
              try {
                if (rememberMe && expiresAt !== null && sessionStore) {
                  await sessionStore.save(settings, { cookie: session.upstreamCookie, expiresAt });
                  remembered = true;
                } else {
                  await sessionStore?.forget(settings);
                  if (rememberMe) warning = "本次已登录，但无法安全保存登录期限；重启 DSH 后需要重新登录。";
                }
              } catch {
                warning = rememberMe ? "本次已登录，但保存登录状态失败；请检查本机凭据保护和目录权限。" : "本次已登录，但旧的登录记录未能清除；请检查目录权限。";
              }
              if (loginEpoch !== authEpoch) { error(res, "登录状态已改变，请重新打开", 409); return; }
              json(res, 200, { code: 0, msg: "", data: { remembered, expiresAt: remembered ? expiresAt : null, warning } });
              return;
            }
            json(res, 200, { code: result.code === 0 ? -1 : result.code, msg: "登录未完成，请核对密码或验证码", data: null });
          } else {
            res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "image/png", "Cache-Control": "no-store" });
            res.end(Buffer.from(await upstream.arrayBuffer()));
          }
          return;
        }
        if (!session.authenticated) {
          if (!entry) { error(res, "请先完成思源锁屏登录", 401); return; }
          const boot = { docId, title, channel, parentOrigin };
          const html = (await readFile(loginFile, "utf8")).replace("/*DSH_BOOT*/", `window.__DSH_NATIVE__=${escapeScript(boot)};`);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
          res.end(html); return;
        }
        if (pathname === "/__dsh/bridge") {
          if (req.method !== "POST" || req.headers.origin !== session.origin) { error(res, "无效桥接请求", 403); return; }
          const data = JSON.parse((await requestBody(req)).toString("utf8"));
          if (data.channel !== channel || data.docId !== docId) { error(res, "桥接目标不匹配", 403); return; }
          if (data.type === "context") onContext?.(data.payload);
          json(res, 200, envelope());
          return;
        }
        if (pathname === "/api/petal/loadPetals") {
          json(res, 200, envelope([{ name: BRIDGE_NAME, displayName: "DSH 原生编辑桥接", js: pluginSource, css: "", i18n: {} }]));
          return;
        }
        // 内嵌窗口独立维护自己的布局及状态，禁止污染原生主窗口的持久布局。
        if (pathname === "/api/system/setUILayout") { await requestBody(req); json(res, 200, envelope()); return; }
        if (pathname === "/api/storage/setLocalStorage" || pathname === "/api/storage/removeLocalStorage") {
          const body = JSON.parse((await requestBody(req)).toString("utf8") || "{}");
          session.localStorage ??= {};
          if (pathname.endsWith("removeLocalStorage")) delete session.localStorage[body.key];
          else if (body.key) session.localStorage[body.key] = body.val;
          else Object.assign(session.localStorage, body);
          json(res, 200, envelope()); return;
        }
        if (pathname === "/api/setting/getCloudUser") { json(res, 200, envelope(null)); return; }
        if (!/^\/(?:stage\/|appearance\/|assets\/|api\/|plugins\/|emojis\/|upload(?:$|\/)|manifest\.webmanifest$|favicon\.ico$)/.test(pathname)) {
          error(res, "原生试用不提供此入口", 404); return;
        }
        const buffer = ["GET", "HEAD"].includes(req.method) ? undefined : await requestBody(req);
        const target = new URL(settings.baseUrl + pathname + url.search);
        const headers = { "Accept-Encoding": "identity", Authorization: `Token ${settings.token}` };
        for (const name of ["content-type", "accept", "range", "if-none-match", "x-siyuan-app-id"]) if (req.headers[name]) headers[name] = req.headers[name];
        if (buffer) headers["Content-Length"] = buffer.length;
        const upstream = (target.protocol === "https:" ? https : http).request(target, { method: req.method, headers }, (response) => {
          const transform = entry || ["/api/system/getConf", "/api/storage/getLocalStorage"].includes(pathname);
          if (!transform) {
            const clean = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !HOP_HEADERS.has(key) && !["set-cookie", "access-control-allow-origin"].includes(key)));
            res.writeHead(response.statusCode, clean);
            response.pipe(res);
            response.on("error", () => res.destroy());
            return;
          }
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            try {
              let text = Buffer.concat(chunks).toString("utf8");
              if (response.statusCode !== 200) { error(res, "思源拒绝加载原生编辑页面", response.statusCode); return; }
              if (entry) {
                const boot = { docId, title, channel, parentOrigin, version };
                const prelude = `<script>window.__DSH_NATIVE__=${escapeScript(boot)};try{Object.defineProperty(navigator,'serviceWorker',{value:undefined})}catch{}<\/script>`;
                const style = "<style>#toolbar,#dockLeft,#dockRight,#status{display:none!important}#layouts{visibility:hidden}#dsh-native-editor{position:fixed;inset:0;background:var(--b3-theme-background);z-index:3;display:flex;flex-direction:column}#dsh-native-editor>.protyle{flex:1;min-height:0}.dsh-native-quote{position:fixed;right:18px;bottom:18px;z-index:1000}</style>";
                text = text.replace(/<head>/i, "<head>" + prelude + style);
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
                res.end(text);
              } else {
                const data = JSON.parse(text);
                if (pathname.endsWith("getConf") && data.data?.conf) {
                  data.data.conf = redactNativeConfig(data.data.conf);
                  data.data.conf.uiLayout = {};
                  if (data.data.conf.appearance) {
                    data.data.conf.appearance.themeLight = "daylight";
                    data.data.conf.appearance.themeDark = "midnight";
                    data.data.conf.appearance.icon = "litheness";
                  }
                  if (data.data.conf.onboarding) { data.data.conf.onboarding.newUser = false; data.data.conf.onboarding.dismissed = true; }
                  data.data.start = false;
                } else if (pathname.endsWith("getLocalStorage")) {
                  session.localStorage ??= redactNativeConfig(data.data || {});
                  data.data = session.localStorage;
                }
                json(res, 200, data);
              }
            } catch { error(res, "无法解析思源初始化响应"); }
          });
        });
        upstreamRequests.add(upstream);
        upstream.once("close", () => upstreamRequests.delete(upstream));
        upstream.setTimeout(60000, () => upstream.destroy(new Error("思源请求超时")));
        upstream.on("error", () => { if (res.headersSent) res.destroy(); else error(res, "连接思源失败，请检查内核状态"); });
        res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
        upstream.end(buffer);
      } catch (failure) { if (!res.headersSent) error(res, failure.message, 400); else res.destroy(); }
    });
    session.server = server;
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    server.on("upgrade", (req, socket, head) => {
      let url;
      try { url = new URL(req.url, session.origin); } catch { socket.destroy(); return; }
      if (!session.authenticated || !authorized(req) || req.headers.origin !== session.origin || url.pathname !== "/ws") { socket.destroy(); return; }
      const target = new URL(settings.baseUrl + url.pathname + url.search);
      const headers = { Host: target.host, Origin: target.origin, Authorization: `Token ${settings.token}`, Connection: "Upgrade", Upgrade: "websocket" };
      if (session.upstreamCookie) headers.Cookie = session.upstreamCookie;
      for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) if (req.headers[name]) headers[name] = req.headers[name];
      const upstream = (target.protocol === "https:" ? https : http).request(target, { headers });
      upstreamRequests.add(upstream);
      upstream.once("close", () => upstreamRequests.delete(upstream));
      upstream.setTimeout(10000, () => upstream.destroy());
      upstream.on("upgrade", (response, remote, remoteHead) => {
        upstream.setTimeout(0);
        sockets.add(remote);
        remote.on("close", () => { sockets.delete(remote); socket.destroy(); });
        socket.on("close", () => remote.destroy());
        remote.on("error", () => socket.destroy());
        socket.on("error", () => remote.destroy());
        const responseHeaders = Object.entries(response.headers).filter(([key]) => key !== "set-cookie").map(([key, value]) => `${key}: ${value}`).join("\r\n");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\n\r\n`);
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        remote.pipe(socket); socket.pipe(remote);
      });
      upstream.on("response", () => socket.destroy());
      upstream.on("error", () => socket.destroy());
      upstream.end();
    });
    try {
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      session.port = server.address().port;
      session.origin = `http://${hostname}:${session.port}`;
      server.unref();
      return { id, channel, origin: session.origin, url: session.origin + "/stage/build/desktop/", docId, version };
    } catch (error) { close(id); throw error; }
  }

  function close(id) {
    const session = sessions.get(id);
    if (!session) return false;
    sessions.delete(id);
    for (const request of session.upstreamRequests) request.destroy();
    for (const socket of session.sockets) socket.destroy();
    session.server?.close();
    return true;
  }
  const reaper = setInterval(() => {
    for (const session of sessions.values()) if (Date.now() - session.touched > 3 * 60 * 1000) close(session.id);
  }, 60000);
  reaper.unref();
  return {
    open, close,
    forgetLogin,
    touch(id) { const session = sessions.get(id); if (session) session.touched = Date.now(); return Boolean(session); },
    dispose() { disposed = true; authEpoch++; loginState = null; clearInterval(reaper); for (const id of [...sessions.keys()]) close(id); },
    reset() { authEpoch++; loginState = null; for (const id of [...sessions.keys()]) close(id); },
  };
}
