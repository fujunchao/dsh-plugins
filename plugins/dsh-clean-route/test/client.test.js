import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "client.js"), "utf8");
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));

test("客户端挂在插件页的行配置入口，而不是设置页 tab", () => {
  assert.ok(client.includes('name: "plugins.row.config"'), "应注册 plugins.row.config");
  assert.ok(client.includes('key: ROW_KEY') || client.includes("dsh-clean-route#clean-route"));
  assert.ok(!client.includes('"settings.plugins.tab"'), "设置页 tab 应已移除");
  assert.ok(!client.includes('"plugins.item"'), "不再额外占用插件页的卡片位");
});

test("行键等于 <包名>#<row id>，与 cordis.patch.yml 的 row id 一致", () => {
  const patch = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "cordis.patch.yml"), "utf8");
  const rowId = /- id:\s*(\S+)/.exec(patch)?.[1];
  assert.equal(rowId, "clean-route");
  assert.equal(pkg.name, "dsh-clean-route");
  assert.ok(client.includes(pkg.name + "#" + rowId));
});

test("卡片同时支持 summary 与 page 两种视图", () => {
  assert.ok(client.includes('props.view === "summary"'), "应处理摘要视图");
  assert.ok(client.includes("CleanRoutePanel"), "page 视图应渲染完整面板");
});

test("客户端只声明插件页所需的模块依赖", () => {
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-plugin-manager",
    "@deepseek-ai/dsh-api-remotes",
  ]);
  assert.equal(pkg.dsh.client.platform, "web");
});
