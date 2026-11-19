import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNativeEditorGateway } from "../lib/native-editor.js";
import { createNativeSessionStore, nativeConnectionKey, readNativeLoginCookie, validateNativeSession, NATIVE_SESSION_MAX_AGE_MS } from "../lib/native-session.js";

const exec = promisify(execFile);
const docId = "20261109000000-doc0001";
const NOW = 1794230000000;
const plainCodec = { protect: async value => Buffer.from(value), unprotect: async value => Buffer.from(value) };
const cleanup = async directory => { assert.equal(path.dirname(directory), os.tmpdir()); await rm(directory, { recursive: true, force: true }); };

test("登录 Cookie 使用服务端期限，最多 30 天，非持久会话没有期限", () => {
  assert.deepEqual(readNativeLoginCookie(["other=value", "siyuan=session; Max-Age=2592000; Path=/; HttpOnly"], NOW), { cookie: "siyuan=session", expiresAt: NOW + NATIVE_SESSION_MAX_AGE_MS });
  assert.equal(readNativeLoginCookie(["siyuan=session; Max-Age=5184000"], NOW).expiresAt, NOW + NATIVE_SESSION_MAX_AGE_MS);
  assert.equal(readNativeLoginCookie(["siyuan=session; Max-Age=3600"], NOW).expiresAt, NOW + 3600000);
  assert.equal(readNativeLoginCookie(["siyuan=session; Path=/"], NOW).expiresAt, null);
  assert.equal(readNativeLoginCookie(["siyuan=session; Expires=" + new Date(NOW + 600000).toUTCString()], NOW).expiresAt, NOW + 600000);
  assert.equal(readNativeLoginCookie(["siyuan=session; Max-Age=-1"], NOW).expiresAt, NOW - 1000);
  assert.equal(readNativeLoginCookie(["siyuan=session\r\nInjected: value"], NOW), null);
});

test("当前 Windows 用户加密落盘后，新 Node 进程可以恢复会话", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-native-remember-"));
  const settings = { baseUrl: "http://127.0.0.1:16806", token: "fake-kernel-token" };
  const cookie = "siyuan=fake-session-for-test";
  const expiresAt = Date.now() + NATIVE_SESSION_MAX_AGE_MS - 10000;
  try {
    const store = createNativeSessionStore({ directory });
    await store.save(settings, { cookie, expiresAt });
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const raw = await readFile(path.join(directory, files[0]), "utf8");
    assert.ok(!raw.includes(cookie)); assert.ok(!raw.includes(settings.token));
    assert.ok(!raw.includes("authCode") && !raw.includes("password"));
    const code = `const { createNativeSessionStore } = await import(${JSON.stringify(new URL("../lib/native-session.js", import.meta.url).href)}); const value = await createNativeSessionStore({ directory: process.argv[1] }).load({baseUrl:'http://127.0.0.1:16806',token:'fake-kernel-token'}); if (value?.cookie !== 'siyuan=fake-session-for-test') process.exitCode=1; else console.log(JSON.stringify({restored:true,expiresAt:value.expiresAt}));`;
    const child = await exec(process.execPath, ["--input-type=module", "-e", code, directory], { windowsHide: true });
    assert.deepEqual(JSON.parse(child.stdout), { restored: true, expiresAt });
    assert.equal(await store.load({ ...settings, token: "different-token" }), null);
    assert.equal(await store.load({ ...settings, baseUrl: "http://127.0.0.1:26806" }), null);
  } finally { await cleanup(directory); }
});

test("会话到期、文件损坏和忘记登录会清除本机记录；读取不延长期限", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-native-expiry-"));
  const settings = { baseUrl: "http://127.0.0.1:16806", token: "fake-token" };
  let clock = NOW;
  const store = createNativeSessionStore({ directory, ...plainCodec, now: () => clock });
  try {
    await store.save(settings, { cookie: "siyuan=short", expiresAt: NOW + 1000 });
    clock += 500;
    assert.equal((await store.load(settings)).expiresAt, NOW + 1000);
    clock += 500;
    assert.equal(await store.load(settings), null); assert.deepEqual(await readdir(directory), []);
    const file = path.join(directory, nativeConnectionKey(settings) + ".json");
    await writeFile(file, "corrupted"); assert.equal(await store.load(settings), null); assert.deepEqual(await readdir(directory), []);
    await store.save(settings, { cookie: "siyuan=valid", expiresAt: clock + 1000 });
    await store.forget(settings); assert.equal(await store.load(settings), null);
    await assert.rejects(store.save(settings, { cookie: "siyuan=value;other=secret", expiresAt: clock + 1000 }));
    await assert.rejects(store.save(settings, { cookie: "siyuan=valid", expiresAt: clock + NATIVE_SESSION_MAX_AGE_MS + 1 }));
  } finally { await cleanup(directory); }
});

test("加密失败不写明文，串行写队列下一次仍可保存", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-native-save-failure-"));
  const settings = { baseUrl: "http://test.invalid", token: "fake-token" };
  let fail = true;
  const store = createNativeSessionStore({ directory, ...plainCodec, protect: async value => { if (fail) throw new Error("DPAPI failure"); return Buffer.from(value); }, now: () => NOW });
  try {
    await assert.rejects(store.save(settings, { cookie: "siyuan=session", expiresAt: NOW + 1000 }), /DPAPI/);
    assert.deepEqual(await readdir(directory), []);
    fail = false;
    await store.save(settings, { cookie: "siyuan=session", expiresAt: NOW + 1000 });
    assert.equal((await store.load(settings)).cookie, "siyuan=session");
  } finally { await cleanup(directory); }
});

const gatewayRequest = (session, requestPath, body) => new Promise((resolve, reject) => {
  const url = new URL(session.url);
  const request = http.request({ hostname: "127.0.0.1", port: url.port, path: requestPath, method: body ? "POST" : "GET", headers: { Host: url.host, Origin: session.origin, ...(body ? { "Content-Type": "application/json" } : {}) } }, response => {
    const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
  }); request.on("error", reject); request.end(body ? JSON.stringify(body) : undefined);
});

test("记住登录经真实路由写盘并跨网关恢复；撤销、取消勾选、忘记与过期都再次登录", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-native-login-flow-"));
  let clock = NOW;
  let valid = true;
  let serverDown = false;
  const logins = [];
  const upstream = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/system/loginAuth") {
      const data = JSON.parse(body); logins.push(data);
      res.setHeader("Set-Cookie", "siyuan=flow-session; HttpOnly; Path=/" + (data.rememberMe ? "; Max-Age=2592000" : ""));
      res.end(JSON.stringify({ code: 0 }));
    } else if (req.url === "/api/notebook/lsNotebooks") {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, "siyuan=flow-session");
      if (serverDown) { res.statusCode = 503; res.end("unavailable"); return; }
      res.statusCode = valid ? 200 : 401;
      res.end(JSON.stringify(valid ? { code: 0, data: { notebooks: [] } } : { code: -1, msg: "Auth failed" }));
    } else { res.setHeader("Content-Type", "text/html"); res.end("<html><head></head><body>native-editor</body></html>"); }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const settings = { baseUrl: "http://127.0.0.1:" + upstream.address().port, token: "fake-token" };
  const store = () => createNativeSessionStore({ directory, ...plainCodec, now: () => clock });
  const gateways = [];
  const create = (sessionStore = store()) => {
    const gateway = createNativeEditorGateway({ getSettings: () => settings, sessionStore, now: () => clock,
      call: async (_settings, p) => p.endsWith("getBlockInfo") ? { rootID: docId } : p.endsWith("version") ? "3.8.3" : p.endsWith("getConf") ? { conf: { accessAuthCode: "*******" } } : { kramdown: "original" } });
    gateways.push(gateway); return gateway;
  };
  const open = gateway => gateway.open({ docId, title: "验证", parentOrigin: "dsh-app://app" });
  const login = async (gateway, rememberMe) => {
    const session = await open(gateway);
    const result = await gatewayRequest(session, "/__dsh/login", { channel: session.channel, authCode: "fake-password", rememberMe });
    return { session, response: JSON.parse(result.body) };
  };
  try {
    const first = create();
    const signed = await login(first, true);
    assert.equal(signed.response.data.remembered, true);
    assert.equal(signed.response.data.expiresAt, NOW + NATIVE_SESSION_MAX_AGE_MS);
    assert.equal(logins[0].rememberMe, true);
    first.dispose();
    const second = create();
    const restored = await open(second);
    assert.ok((await gatewayRequest(restored, "/stage/build/desktop/")).body.includes("native-editor"));
    assert.equal(logins.length, 1, "跨网关恢复没有再次提交密码");
    serverDown = true; await assert.rejects(open(create()), /保留本地会话/);
    assert.equal((await readdir(directory)).length, 1, "网络故障不误删记住的会话");
    serverDown = false; valid = false;
    const revoked = await open(create());
    assert.ok((await gatewayRequest(revoked, "/stage/build/desktop/")).body.includes("思源锁屏密码"));
    assert.deepEqual(await readdir(directory), []);
    valid = true;
    const third = create(); await login(third, true);
    await login(third, false);
    assert.equal(logins.at(-1).rememberMe, false); assert.deepEqual(await readdir(directory), []);
    third.dispose();
    assert.ok((await gatewayRequest(await open(create()), "/stage/build/desktop/")).body.includes("思源锁屏密码"));
    const fourth = create(); const live = await login(fourth, true);
    await fourth.forgetLogin(); assert.deepEqual(await readdir(directory), []);
    assert.ok((await gatewayRequest(live.session, "/stage/build/desktop/")).body.includes("native-editor"), "忘记登录保留当前文稿");
    assert.ok((await gatewayRequest(await open(fourth), "/stage/build/desktop/")).body.includes("思源锁屏密码"));
    const fifth = create(); await login(fifth, true); fifth.dispose();
    clock = NOW + NATIVE_SESSION_MAX_AGE_MS;
    assert.ok((await gatewayRequest(await open(create()), "/stage/build/desktop/")).body.includes("思源锁屏密码"));
    assert.deepEqual(await readdir(directory), []);
    const failing = create({ load: async () => null, save: async () => { throw new Error("disk failure"); }, forget: async () => {} });
    const accepted = await login(failing, true);
    assert.equal(accepted.response.code, 0); assert.equal(accepted.response.data.remembered, false); assert.match(accepted.response.data.warning, /保存登录状态失败/);
    assert.ok((await gatewayRequest(accepted.session, "/stage/build/desktop/")).body.includes("native-editor"), "记住失败不妨碍当前编辑");
  } finally { for (const gateway of gateways) gateway.dispose(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); await cleanup(directory); }
});

test("Cookie 校验不会把 API 成功、服务器错误或登录重定向当作有效会话", async () => {
  let status = 200, value = { code: 0, data: null };
  const upstream = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    res.statusCode = status;
    if (status === 302) res.setHeader("Location", "/check-auth");
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const settings = { baseUrl: "http://127.0.0.1:" + upstream.address().port, token: "not-used" };
  try {
    await assert.rejects(validateNativeSession(settings, "siyuan=session"), /尚未确认/);
    status = 302; assert.equal(await validateNativeSession(settings, "siyuan=session"), false);
    status = 403; assert.equal(await validateNativeSession(settings, "siyuan=session"), false);
    status = 500; await assert.rejects(validateNativeSession(settings, "siyuan=session"), /保留/);
    status = 200; value = { code: 0, data: { notebooks: [] } };
    assert.equal(await validateNativeSession(settings, "siyuan=session"), true);
  } finally { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
