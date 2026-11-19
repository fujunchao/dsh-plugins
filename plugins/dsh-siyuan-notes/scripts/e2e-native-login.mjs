// 登录界面与跨进程恢复验收：使用本机模拟思源和虚构密码，不读取用户凭据、不写真实笔记。
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createNativeEditorGateway } from "../lib/native-editor.js";
import { createNativeSessionStore } from "../lib/native-session.js";

const DOC = "20261109000000-test001";

// 每次创建独立宿主进程，恢复只能依赖磁盘记录，不能复用上次的内存变量。
if (process.argv[2] === "--worker") {
  const settings = { baseUrl: process.env.NATIVE_TEST_UPSTREAM, token: "fake-api-token" };
  const gateway = createNativeEditorGateway({
    getSettings: () => settings,
    sessionStore: createNativeSessionStore({ directory: process.env.NATIVE_TEST_STORE }),
    call: async (_settings, route) => route.endsWith("getBlockInfo") ? { rootID: DOC } : route.endsWith("version") ? "3.8.3" : route.endsWith("getConf") ? { conf: { accessAuthCode: "*******" } } : { kramdown: "test" },
  });
  process.on("message", async message => {
    try {
      if (message === "stop") { gateway.dispose(); process.disconnect(); return; }
      if (message === "forget") { await gateway.forgetLogin(); process.send({ forgotten: true }); }
      if (message === "open") process.send({ session: await gateway.open({ docId: DOC, title: "登录记忆验证", parentOrigin: "null" }) });
    } catch (error) { process.send({ error: error.message }); }
  });
  process.send({ ready: true });
} else {
  const localRequire = createRequire(import.meta.url);
  const { chromium } = localRequire(process.env.DSH_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
  const output = path.resolve(process.env.DSH_NATIVE_LOGIN_OUTPUT || fileURLToPath(new URL("../../.local/siyuan-remember-20261109/", import.meta.url)));
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-native-login-browser-"));
  const checks = [];
  const mark = label => { checks.push(label); console.log("PASS " + label); };
  let revoked = false;
  let clockedLogins = 0;
  const upstream = http.createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    if (req.url === "/api/system/loginAuth") {
      const body = JSON.parse(text); clockedLogins++;
      assert.equal(body.authCode, "fake-password-for-local-test");
      revoked = false;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Set-Cookie", "siyuan=remember-browser-test; HttpOnly; Path=/" + (body.rememberMe ? "; Max-Age=2592000" : ""));
      res.end(JSON.stringify({ code: 0 }));
    } else if (req.url === "/api/notebook/lsNotebooks") {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, "siyuan=remember-browser-test");
      res.statusCode = revoked ? 401 : 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(revoked ? { code: -1, msg: "Auth failed" } : { code: 0, data: { notebooks: [] } }));
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<!doctype html><html><head></head><body><h1>原生页面已授权</h1></body></html>");
    }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const workers = [];
  const start = async () => {
    const worker = fork(fileURLToPath(import.meta.url), ["--worker"], { env: { ...process.env, NATIVE_TEST_UPSTREAM: "http://127.0.0.1:" + upstream.address().port, NATIVE_TEST_STORE: directory }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    workers.push(worker);
    const message = await Promise.race([once(worker, "message"), once(worker, "exit").then(() => { throw new Error("测试宿主提前退出"); })]);
    assert.equal(message[0].ready, true); return worker;
  };
  const command = async (worker, message) => { const reply = once(worker, "message"); worker.send(message); const [result] = await reply; if (result.error) throw new Error(result.error); return result; };
  const stop = async worker => { const done = once(worker, "exit"); worker.send("stop"); await done; };
  let browser, failure;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    let worker = await start();
    let session = (await command(worker, "open")).session;
    await page.goto(session.url);
    assert.equal(await page.getByRole("checkbox", { name: "记住登录 30 天" }).isChecked(), true);
    mark("登录页默认勾选记住登录 30 天");
    await page.screenshot({ path: path.join(output, "remember-login.png") });
    await page.getByLabel("思源锁屏密码", { exact: true }).fill("fake-password-for-local-test");
    await page.getByRole("button", { name: "登录并继续编辑", exact: true }).click();
    await page.getByRole("heading", { name: "原生页面已授权" }).waitFor();
    const records = await readdir(directory);
    assert.equal(records.length, 1);
    const bytes = await readFile(path.join(directory, records[0]), "utf8");
    assert.ok(!bytes.includes("remember-browser-test") && !bytes.includes("fake-password") && !bytes.includes("fake-api-token"));
    mark("真实表单提交后用 Windows 凭据保护加密落盘");
    await stop(worker);
    worker = await start(); session = (await command(worker, "open")).session;
    await page.goto(session.url);
    await page.getByRole("heading", { name: "原生页面已授权" }).waitFor();
    assert.equal(clockedLogins, 1);
    mark("重新启动独立宿主进程后免输密码进入");
    await command(worker, "forget");
    assert.deepEqual(await readdir(directory), []);
    session = (await command(worker, "open")).session; await page.goto(session.url);
    await page.getByRole("heading", { name: "登录思源原生编辑器" }).waitFor();
    mark("忘记登录删除记录并恢复登录页");
    await page.getByRole("checkbox", { name: "记住登录 30 天" }).uncheck();
    await page.getByLabel("思源锁屏密码", { exact: true }).fill("fake-password-for-local-test");
    await page.getByRole("button", { name: "登录并继续编辑", exact: true }).click();
    await page.getByRole("heading", { name: "原生页面已授权" }).waitFor();
    assert.deepEqual(await readdir(directory), []);
    await stop(worker); worker = await start(); session = (await command(worker, "open")).session;
    await page.goto(session.url); await page.getByRole("heading", { name: "登录思源原生编辑器" }).waitFor();
    mark("取消勾选只保留当前运行会话，重启要求登录");
    await page.getByLabel("思源锁屏密码", { exact: true }).fill("fake-password-for-local-test");
    await page.getByRole("button", { name: "登录并继续编辑", exact: true }).click();
    await page.getByRole("heading", { name: "原生页面已授权" }).waitFor();
    await stop(worker); revoked = true;
    worker = await start(); session = (await command(worker, "open")).session;
    await page.goto(session.url); await page.getByRole("heading", { name: "登录思源原生编辑器" }).waitFor();
    assert.deepEqual(await readdir(directory), []);
    mark("服务端撤销会话后清除旧凭据并重新登录");
    assert.deepEqual(errors, []); mark("登录页无脚本异常");
  } catch (error) { failure = error; }
  finally {
    await browser?.close();
    for (const worker of workers) if (worker.exitCode === null && worker.connected) await stop(worker);
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    assert.equal(path.dirname(directory), os.tmpdir()); await rm(directory, { recursive: true, force: true });
    await writeFile(path.join(output, "remember-login-result.json"), JSON.stringify({ passed: checks.length, checks, error: failure?.message || null, upstream: "本机模拟思源；Windows DPAPI 和独立宿主进程为真实运行" }, null, 2));
  }
  if (failure) throw failure;
  console.log(`记住登录浏览器验证：${checks.length} 项通过`);
}
