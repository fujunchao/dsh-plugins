/**
 * dsh-siyuan-notes — live smoke test for the Host half.
 *
 * Runs the real plugin entry against a real SiYuan kernel, with a fake Cordis context:
 * nothing is installed, no DSH process is started, and the only files touched are
 * `<DSH_SIYUAN_NOTES_HOME>/siyuan-notes.json` and `<...>/siyuan-backups/*.md`.
 *
 *   node scripts/smoke-live.mjs                  # default kernel from env (127.0.0.1:6806)
 *   SIYUAN_URL=http://127.0.0.1:6806 SIYUAN_TOKEN=… node scripts/smoke-live.mjs
 *
 * Exits non-zero on the first failed expectation.
 */

import { promises as fsp } from "node:fs";
import { Readable } from "node:stream";

import * as host from "../lib/index.js";

const BASE_URL = process.env.SIYUAN_URL ?? "http://127.0.0.1:6806";
const TOKEN = process.env.SIYUAN_TOKEN ?? "demo-7f3a91";

/** @type {Array<{ kind: string, path: string, handler: Function }>} */
const registered = [];
const disposers = [];

const ctx = {
  webServer: {
    register(route) {
      registered.push(route);
      return () => {
        disposers.push(route.path);
      };
    },
  },
  effect(factory) {
    const disposer = factory();
    return typeof disposer === "function" ? disposer : () => {};
  },
  logger: {
    error(error) {
      console.error("[host logger]", error);
    },
  },
};

/** @param {unknown} body */
function mockRequest(body, { method = "POST", url = "/siyuan/state" } = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const stream = Readable.from(text === "" ? [] : [Buffer.from(text, "utf8")]);
  stream.method = method;
  stream.url = url;
  return stream;
}

function mockResponse() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

/** @param {unknown} body */
async function call(body, init) {
  const res = mockResponse();
  await registered[0].handler(mockRequest(body, init), res);
  return res;
}

let failures = 0;
/**
 * @param {string} label
 * @param {boolean} condition
 * @param {unknown} [detail]
 */
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}`);
  if (detail !== undefined) console.log("       ", typeof detail === "string" ? detail : JSON.stringify(detail));
}

function section(title) {
  console.log(`\n== ${title}`);
}

async function main() {
  section("plugin entry");
  host.apply(ctx, { baseUrl: BASE_URL, token: TOKEN, timeoutSeconds: 20 });
  check("registered exactly one route", registered.length === 1, registered.map((route) => route.path));
  check("route kind is prefix", registered[0]?.kind === "prefix", registered[0]?.kind);
  check("route path is /siyuan", registered[0]?.path === "/siyuan", registered[0]?.path);

  section("POST /siyuan/config (persist + probe)");
  const configured = await call({ baseUrl: BASE_URL, token: TOKEN }, { url: "/siyuan/config" });
  console.log(`  status ${configured.status} body ${configured.body}`);
  const configPayload = JSON.parse(configured.body);
  check("config ok", configPayload.ok === true, configPayload);
  check("token reported as set, never echoed", configPayload.value?.hasToken === true && !configured.body.includes(TOKEN));
  check("kernel version probed", typeof configPayload.value?.version === "string", configPayload.value);
  check("settings file written", await fsp
    .readFile(host.settingsFilePath(), "utf8")
    .then((text) => text.includes(BASE_URL))
    .catch(() => false), host.settingsFilePath());

  section("GET /siyuan/state");
  const state = await call(undefined, { method: "GET", url: "/siyuan/state" });
  console.log(`  status ${state.status} body ${state.body}`);
  check("state ok", JSON.parse(state.body).ok === true);

  section("POST /siyuan/api { path: '/api/system/version' }");
  const version = await call({ path: "/api/system/version", payload: {} }, { url: "/siyuan/api" });
  console.log(`  status ${version.status}`);
  console.log(`  raw bytes: ${version.body}`);
  const versionJson = JSON.parse(version.body);
  check("verbatim SiYuan envelope", versionJson.code === 0 && typeof versionJson.data === "string", versionJson);

  section("POST /siyuan/api { path: '/api/notebook/lsNotebooks' }");
  const notebooks = await call({ path: "/api/notebook/lsNotebooks", payload: {} }, { url: "/siyuan/api" });
  console.log(`  status ${notebooks.status}`);
  console.log(`  raw bytes: ${notebooks.body}`);
  const notebooksJson = JSON.parse(notebooks.body);
  check("verbatim SiYuan envelope", notebooksJson.code === 0 && notebooksJson.data !== undefined, notebooksJson);

  section("POST /siyuan/backup");
  const backup = await call(
    { docId: "20260101120000-smokedoc", title: "冒烟测试", kramdown: "# smoke\n\nhello **siyuan**" },
    { url: "/siyuan/backup" },
  );
  console.log(`  status ${backup.status} body ${backup.body}`);
  const backupJson = JSON.parse(backup.body);
  check("backup ok", backupJson.ok === true, backupJson);
  const backupText = backupJson.value?.file ? await fsp.readFile(backupJson.value.file, "utf8").catch(() => null) : null;
  check("backup content round-trips", backupText === "# smoke\n\nhello **siyuan**", backupText);

  section("guard rails");
  const notApi = await call({ path: "http://evil.example/api/system/version" }, { url: "/siyuan/api" });
  console.log(`  status ${notApi.status} body ${notApi.body}`);
  check("non-/api path rejected with JSON", notApi.status === 400 && JSON.parse(notApi.body).ok === false);
  const unknown = await call(undefined, { method: "GET", url: "/siyuan/unknown" });
  check("unknown route -> JSON 404", unknown.status === 404 && JSON.parse(unknown.body).error?.code === "not_found", unknown.body);

  section("result");
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
}

await main();
