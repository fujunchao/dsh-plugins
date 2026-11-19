import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RuleStore } from "../lib/config.js";
import { createRoutes } from "../lib/api.js";
import { defaultYaml, modelToYaml, toModel } from "../lib/rules-model.js";

function makeReq(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeRes() {
  const state = { status: 0, body: "" };
  return {
    writeHead(status) {
      state.status = status;
    },
    end(body) {
      state.body = body;
    },
    result() {
      return { status: state.status, json: JSON.parse(state.body) };
    },
  };
}

async function callHandler(handler, method, path, body) {
  const res = makeRes();
  await handler(makeReq(method, "/clean-route" + path, body), res);
  return res.result();
}

async function makeFixture(rulesText, stream) {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-api-"));
  const rulesPath = join(dir, "gemini-clean.yml");
  if (rulesText !== undefined) writeFileSync(rulesPath, rulesText, "utf8");
  const store = new RuleStore({ path: rulesPath, watch: false });
  await store.reload();
  const seen = new Map();
  const recent = [];
  const { handler } = createRoutes({
    store,
    seen,
    recent: () => recent,
    providers: () => [{ id: "google", name: "google" }, { id: "deepseek", name: "DeepSeek" }],
    stream,
  });
  return { dir, rulesPath, store, seen, recent, handler };
}

const ASSEMBLY = {
  sections: [
    { name: "harness:identity", text: "身份句" },
    { name: "deployment:persona-prefix", text: "旧人设" },
    { name: "captured:body", text: "工具规范正文" },
    { name: "harness:source", text: "checkout 段落一段很长很长的文本内容用来触发残留检查" },
  ],
  contexts: [{ name: "harness:source", text: "提醒" }, { name: "memory", text: "记忆" }],
  variables: {},
};

test("GET /state 给出规则模型、默认 YAML、provider 与最近组装", async () => {
  const fixture = await makeFixture();
  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });
  const { status, json } = await callHandler(fixture.handler, "GET", "/state");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.source, "default");
  assert.ok(json.yaml.includes("version: 1"));
  assert.ok(json.defaults.includes("harness:identity"));
  assert.deepEqual(json.model.dropSections, ["harness:identity", "harness:source", "app:web-surface"]);
  assert.equal(json.providers.length, 2);
  assert.equal(json.seen.length, 1);
  assert.ok(json.seen[0].sections.some((section) => section.name === "harness:identity"));
});

test("POST /rules（表单）写盘并立即生效", async () => {
  const fixture = await makeFixture();
  const model = toModel({ ...JSON.parse(JSON.stringify({ version: 1, routes: [{ provider: "google" }], sections: { drop: ["a"], replace: {}, append: [] }, contexts: { drop: [] }, carrier: null, textRules: [] })) });
  const { status, json } = await callHandler(fixture.handler, "POST", "/rules", { mode: "model", model });
  assert.equal(status, 200);
  assert.equal(json.source, "file");
  const written = readFileSync(fixture.rulesPath, "utf8");
  assert.ok(written.includes("version: 1"));
  assert.ok(written.includes("dsh-clean-route 规则表"));
});

test("POST /rules（YAML 非法）返回 400 且不改动文件", async () => {
  const fixture = await makeFixture("routes: [{ provider: google }]\n");
  const before = readFileSync(fixture.rulesPath, "utf8");
  const { status, json } = await callHandler(fixture.handler, "POST", "/rules", { mode: "yaml", text: "routes: [\n" });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.equal(readFileSync(fixture.rulesPath, "utf8"), before);
});

test("POST /preview 没有真实组装时退到内置样本，并优先净化路由", async () => {
  const fixture = await makeFixture("routes: [{ provider: google }]\n");
  const { status, json } = await callHandler(fixture.handler, "POST", "/preview", {});
  assert.equal(status, 200);
  assert.equal(json.sampleFrom, "fixture");
  assert.equal(json.provider, "google");
  assert.equal(json.cleanRoute, true);
  assert.ok(json.beforeChars > json.afterChars, "内置样本里应确实剔掉了段落");

  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });
  const real = await callHandler(fixture.handler, "POST", "/preview", {});
  assert.equal(real.json.sampleFrom, "real");
  assert.deepEqual(real.json.hits.droppedSections, ["harness:identity", "harness:source"]);
  assert.deepEqual(real.json.residue, []);
  assert.equal(real.json.sections.find((section) => section.name === "captured:body").action, "keep");
});

test("有非净化路由的更新组装时，预览仍优先挑净化路由", async () => {
  const fixture = await makeFixture("routes: [{ provider: google }]\n");
  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });
  fixture.seen.set("deepseek/deepseek-v4.1-flash", { provider: "deepseek", model: "deepseek-v4.1-flash", at: 2, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });
  const { json } = await callHandler(fixture.handler, "POST", "/preview", {});
  assert.equal(json.provider, "google");
  assert.equal(json.model, "gemini-4-hydrogen");
  assert.equal(json.cleanRoute, true);
});
test("POST /preview 接受草稿 YAML 且不写盘", async () => {
  const fixture = await makeFixture("routes: [{ provider: google }]\n");
  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });
  const draft = "routes: [{ provider: deepseek }]\n";
  const { status, json } = await callHandler(fixture.handler, "POST", "/preview", { yaml: draft });
  assert.equal(status, 200);
  assert.equal(json.applied, false, "草稿路由不包含 google，应原样放行");
  assert.equal(json.beforeChars, json.afterChars);
  assert.equal(readFileSync(fixture.rulesPath, "utf8").includes("deepseek"), false);
});

test("未知端点与方法不匹配都报错", async () => {
  const fixture = await makeFixture();
  const missing = await callHandler(fixture.handler, "GET", "/nope");
  assert.equal(missing.status, 404);
  const wrongMethod = await callHandler(fixture.handler, "GET", "/rules");
  assert.equal(wrongMethod.status, 405);
});

test("GET /xhigh 返回可读状态（真实安装里应能定位到 resources）", async () => {
  const fixture = await makeFixture();
  const { status, json } = await callHandler(fixture.handler, "GET", "/xhigh");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(typeof json.xhigh.patched, "boolean");
});

test("modelToYaml 与 defaultYaml 都是合法规则", async () => {
  const built = modelToYaml(toModel({ version: 1, routes: [{ provider: "google" }], sections: { drop: ["x"], replace: {}, append: [] }, contexts: { drop: [] }, carrier: null, textRules: [] }));
  assert.ok(built.yaml.includes("drop:"));
  assert.deepEqual(built.rules.sections.drop, ["x"]);
  assert.ok(defaultYaml().includes("harness:identity"));
});

function fakeStream(chunks) {
  const calls = [];
  const stream = (options) => {
    calls.push(options);
    return (async function* () {
      for (const chunk of chunks) yield chunk;
    })();
  };
  stream.calls = calls;
  return stream;
}

test("POST /verify 用净化后的提示词真发一次最小请求（成功路径）", async () => {
  const stream = fakeStream([{ type: "text-delta", delta: "2" }, { type: "finish", reason: { kind: "stop" } }]);
  const fixture = await makeFixture("routes: [{ provider: google }]\n", stream);
  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });

  const { status, json } = await callHandler(fixture.handler, "POST", "/verify", {});
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.received, "2");
  assert.equal(json.sampleFrom, "real");
  assert.equal(stream.calls.length, 1);

  const sent = stream.calls[0];
  assert.equal(sent.provider, "google");
  assert.equal(sent.model, "gemini-4-hydrogen");
  const systemText = sent.messages[0].content.map((block) => block.text).join("\n");
  assert.ok(!systemText.includes("身份句"), "发出去的必须是净化后的提示词");
  assert.ok(systemText.includes("工具规范正文"));
  assert.equal(sent.messages[1].role, "user");
});

test("POST /verify 把上游失败码原样带回来（不吞错）", async () => {
  const stream = fakeStream([{ type: "finish", reason: { kind: "error", failure: { code: "RATE_LIMIT", message: "429" } } }]);
  const fixture = await makeFixture("routes: [{ provider: google }]\n", stream);
  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });

  const { json } = await callHandler(fixture.handler, "POST", "/verify", {});
  assert.equal(json.ok, false);
  assert.equal(json.failureCode, "RATE_LIMIT");
});

test("POST /verify 接受表单草稿：未保存的路由改动也会生效", async () => {
  const stream = fakeStream([{ type: "finish", reason: { kind: "stop" } }]);
  const fixture = await makeFixture("routes: [{ provider: google }]\n", stream);
  fixture.seen.set("google/gemini-4-hydrogen", { provider: "google", model: "gemini-4-hydrogen", at: 1, sections: ASSEMBLY.sections, contexts: ASSEMBLY.contexts });

  const model = { routes: [{ provider: "deepseek", model: "" }], dropSections: [], replaceSections: [], appendSections: [], dropContexts: [], carrierPath: "", textRules: [] };
  const { json } = await callHandler(fixture.handler, "POST", "/verify", { model });
  const systemText = stream.calls[0].messages[0].content.map((block) => block.text).join("\n");
  assert.ok(systemText.includes("身份句"), "草稿把路由改成 deepseek 后，不该再净化 google");
  assert.equal(json.sampleFrom, "real");
  assert.equal(readFileSync(fixture.rulesPath, "utf8").includes("deepseek"), false, "测试不应写盘");
});
