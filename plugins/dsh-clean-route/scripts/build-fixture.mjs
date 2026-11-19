#!/usr/bin/env node
/**
 * 生成 test/fixtures/assembly.json：按真实顺序拼出一份可复现的 assembly，供探针与单测使用。
 *
 * 来源（从宿主 app.asar 读，归档/目录两种形态都支持）：
 *  - harness:identity            dsh-system-prompt 的内置文本
 *  - deployment:persona-prefix   dsh-web-app 里 cordis 预设的 persona.prefix（含 {{model}} 插值，
 *                                在捕获文本里取它渲染后的那一块，保持与线上一致）
 *  - harness:source              dsh-harness-dev-context 的 HARNESS_SOURCE_PROMPT
 *  - app:web-surface             dsh-harness-dev-context 的 WEB_SURFACE_PROMPT
 *  - 其余正文                    test/fixtures/dsh-system-prompt.txt（一次真实捕获）
 *
 * 用法：node scripts/build-fixture.mjs [--resources <…/resources>] [--capture <prompt.txt>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../lib/asar.js";
import { locateResources } from "../lib/xhigh.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const located = locateResources({ resourcesPath: arg("--resources", undefined) });
if (located.path === null) throw new Error("找不到宿主 resources 目录（可用 DSH_CLEAN_ROUTE_RESOURCES 指定）");
const archive = join(located.path, "app.asar");
const capturePath = arg("--capture", resolve(repo, "test/fixtures/dsh-system-prompt.txt"));
const outPath = resolve(repo, "test/fixtures/assembly.json");

const systemPromptSource = readText(archive, "dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js");
const identityMatch = /name: "harness:identity"[\s\S]{0,200}?text: "((?:[^"\\]|\\.)*)"/.exec(systemPromptSource);
if (identityMatch === null) throw new Error("在 dsh-system-prompt 里找不到 harness:identity 文本");
const identity = JSON.parse('"' + identityMatch[1] + '"');

const devContextSource = readText(archive, "dsh/node_modules/@deepseek-ai/dsh-harness-dev-context/lib/index.js");
const literal = (name) => {
  const match = new RegExp("const " + name + " = `([\\s\\S]*?)`;").exec(devContextSource);
  if (match === null) throw new Error("在 dsh-harness-dev-context 里找不到 " + name);
  return match[1];
};
const harnessSource = literal("HARNESS_SOURCE_PROMPT");
const webSurface = literal("WEB_SURFACE_PROMPT");

const captured = readFileSync(capturePath, "utf8");
if (!captured.startsWith(identity)) throw new Error("捕获文本不以 harness:identity 开头，无法按真实顺序切分");

// 身份句之后的第一段就是渲染后的人设（预设里写的是 {{model}} 模板）。
const afterIdentity = captured.slice(identity.length).replace(/^\n\n/, "");
const personaEnd = afterIdentity.indexOf("\n\n");
if (personaEnd < 0) throw new Error("捕获文本里找不到人设段与正文的分界");
const personaRendered = afterIdentity.slice(0, personaEnd);

const remainder = afterIdentity.slice(personaEnd + 2);
// 段落定位用前 120 字符做前缀：安装版本与捕获版本可能有个别字符差异，
// 但段首足够长的前缀是稳定的。段落文本取到下一个段首（或文末）为止。
const markers = [
  { name: "harness:source", text: harnessSource },
  { name: "app:web-surface", text: webSurface },
].map((entry) => ({ ...entry, at: remainder.indexOf(entry.text.slice(0, 120)) }));

const ordered = markers.filter((entry) => entry.at >= 0).sort((a, b) => a.at - b.at);
const sections = [
  { name: "harness:identity", text: identity },
  { name: "deployment:persona-prefix", text: personaRendered },
];
let cursor = 0;
let body = 0;
for (const [index, entry] of ordered.entries()) {
  const gap = remainder.slice(cursor, entry.at).replace(/^\n\n/, "").replace(/\n\n$/, "");
  if (gap.length > 0) sections.push({ name: "captured:body:" + ++body, text: gap });
  const end = index + 1 < ordered.length ? ordered[index + 1].at : remainder.length;
  sections.push({ name: entry.name, text: remainder.slice(entry.at, end).replace(/\n\n$/, "") });
  cursor = end;
}
const tail = remainder.slice(cursor).replace(/^\n\n/, "");
if (tail.length > 0) sections.push({ name: "captured:body:" + ++body, text: tail });

const contexts = [
  { name: "harness:source", text: "Current DeepSeekRuntime implementation checkout: （示例）." },
  { name: "app:web-surface", text: "Current DeepSeekRuntime Web GUI URL: \"http://127.0.0.1:50774\"." },
  { name: "memory", text: "（示例记忆块，规则不处理它）" },
];

writeFileSync(outPath, JSON.stringify({ sections, contexts, variables: {} }, null, 2) + "\n", "utf8");
console.log("写出 " + outPath);
console.log("section：" + sections.map((section) => section.name + "(" + section.text.length + ")").join(", "));
console.log("未在捕获文本里找到：" + (markers.filter((entry) => entry.at < 0).map((entry) => entry.name).join(", ") || "（无）"));
