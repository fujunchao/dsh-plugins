#!/usr/bin/env node
/**
 * 探针：用当前规则表渲染一遍净化后的系统提示词，检查残留，并可选真打上游。
 *
 * 这是 2026-11-17 那套 A/B 的固化版 —— DSH 升级或规则改动后，用它一键复验。
 *
 * 例：
 *   node scripts/probe.mjs                                   # 只渲染 + 查残留
 *   node scripts/probe.mjs --live --base-url https://…/v1beta # 渲染 + 真打上游（另需 GOOGLE_API_KEY）
 *   node scripts/probe.mjs --live --base-url https://…/v1beta --model gemini-4-hydrogen --max-tools 12
 *
 * 上游端点没有默认值：`--base-url` 或环境变量 `GOOGLE_BASE_URL` 必填（--live 时）。
 *
 * 退出码：0 = 净化无残留且（--live 时）上游 200；1 = 有残留或上游非 200；2 = 用法错误。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleStore } from "../lib/config.js";
import { scrubAssembly, renderScrubbedSections } from "../lib/scrub.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(name);

const assemblyPath = flag("--assembly", resolve(repo, "test/fixtures/assembly.json"));
const toolsPath = flag("--tools", resolve(repo, "test/fixtures/dsh-tools.json"));
const promptPath = flag("--prompt", null);
const rulesPath = flag("--rules", undefined);
const provider = flag("--provider", "google");
const model = flag("--model", "gemini-4-hydrogen");
const baseUrl = flag("--base-url", process.env.GOOGLE_BASE_URL ?? null);
const keyEnv = flag("--key-env", "GOOGLE_API_KEY");
const maxTools = Number(flag("--max-tools", "80"));
const live = has("--live");
const outPath = flag("--out", null);

const store = new RuleStore({ path: rulesPath, watch: false });
await store.reload("探针");
const snapshot = store.get();
console.log("规则来源：" + snapshot.source + (snapshot.source === "file" ? "（" + snapshot.path + "）" : "（内置默认）"));

let assembly;
if (promptPath !== null) {
  const text = readFileSync(promptPath, "utf8");
  assembly = { sections: [{ name: "captured:prompt", text }], contexts: [], variables: {} };
  console.log("注意：整段 prompt 模式只能验证 textRules（section 名规则无从匹配）");
} else {
  assembly = JSON.parse(readFileSync(assemblyPath, "utf8"));
}
const before = renderScrubbedSections(assembly.sections);

const outcome = scrubAssembly(assembly, { modelSelection: { provider, model } }, snapshot.compiled);
const after = renderScrubbedSections(outcome.assembly.sections);

const residue = [];
for (const name of outcome.hits.droppedSections) {
  const dropped = assembly.sections.find((section) => section.name === name);
  if (dropped !== undefined && dropped.text.length > 40 && after.includes(dropped.text)) residue.push(name);
}
const droppedContexts = outcome.hits.droppedContexts;

const report = {
  at: new Date().toISOString(),
  route: { provider, model },
  applied: outcome.applied,
  rules: { source: snapshot.source, path: snapshot.path },
  before: { chars: before.length },
  after: { chars: after.length },
  hits: outcome.hits,
  residue,
};

console.log("路由：" + provider + "/" + model + (outcome.applied ? "（命中净化路由）" : "（不在净化清单，原样放行）"));
console.log("提示词：" + before.length + " 字 → " + after.length + " 字");
console.log("剔除 section：" + (outcome.hits.droppedSections.join(", ") || "（无）"));
console.log("替换 section：" + (outcome.hits.replacedSections.join(", ") || "（无）"));
console.log("剔除 context：" + (droppedContexts.join(", ") || "（无）"));
console.log("textRules 命中：" + outcome.hits.textRuleHits.length + " 条");
console.log("残留检查：" + (residue.length === 0 ? "通过（被剔除段落未复现）" : "未通过 —— " + residue.join(", ")));

if (live) {
  const apiKey = process.env[keyEnv];
  if (apiKey === undefined || apiKey === "") {
    console.error("--live 需要环境变量 " + keyEnv);
    process.exit(2);
  }
  if (baseUrl === null || baseUrl === "") {
    console.error("--live 需要 --base-url 或环境变量 GOOGLE_BASE_URL（指向要验证的上游端点）");
    process.exit(2);
  }
  const tools = JSON.parse(readFileSync(toolsPath, "utf8")).slice(0, maxTools);
  const body = {
    contents: [{ role: "user", parts: [{ text: "只回答一个数字：1+1=?" }] }],
    systemInstruction: { role: "user", parts: [{ text: after }] },
    ...(tools.length === 0 ? {} : { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }] }),
    generationConfig: { maxOutputTokens: 256, temperature: 0 },
  };
  const url = baseUrl.replace(/\/$/, "") + "/models/" + model + ":streamGenerateContent?alt=sse";
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-api-client": "google-genai-sdk/2.21.0 gl-node/" + process.versions.node,
      "user-agent": "google-genai-sdk/2.21.0 gl-node/" + process.versions.node,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const elapsed = Date.now() - started;
  let excerpt = "";
  if (response.status === 200) {
    const reader = response.body.getReader();
    const { value } = await reader.read();
    excerpt = new TextDecoder().decode(value ?? new Uint8Array()).slice(0, 200);
    await reader.cancel().catch(() => {});
  } else {
    excerpt = (await response.text()).slice(0, 400);
  }
  report.live = { status: response.status, elapsed, tools: tools.length, excerpt };
  console.log("上游：" + response.status + "（" + elapsed + "ms，工具 " + tools.length + " 个）");
  if (response.status !== 200) console.log("  响应片段：" + excerpt.replace(/\s+/g, " ").slice(0, 240));
}

if (outPath !== null) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("报告写入：" + outPath);
}

const ok = residue.length === 0 && (!live || report.live.status === 200);
process.exitCode = ok ? 0 : 1;
