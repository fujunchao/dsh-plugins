/**
 * dsh-siyuan-notes — searchRender（契约 v6，P0-3）回归测试。
 *
 * 背景：v5 的检索渲染只有 `[类型 · 项目 · 状态 · 可信度] 结论`，**没有 id**。
 * 于是 `memory_read` 描述里的「id 来自 memory_search 的结果」实际不成立——
 * 模型想读全文只能整篇重新检索。v6 起行格式固定为：
 *
 *     - <id> [<类型> · <项目>[/<主题>] · <状态>] <结论>
 *
 * 这里只测渲染本身与「search → read」链路，不碰内核。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { searchRender } from "../lib/index.js";
import { createMemoryStore } from "../lib/memory.js";
import { memoryKernel } from "./helpers/memory-kernel.mjs";

const FIXED_NOW = 1_791_000_000_000;

/** 一句 100 字的结论，用来验证 80 字截断。 */
const LONG = "这是一条用来验证截断的结论".repeat(8);

test("searchRender：id 在行首，状态与主题都渲染出来", () => {
  const out = searchRender(
    { query: "发布" },
    {
      ok: true,
      results: [
        { id: "20261111120000-aaaaaaa", statement: "发布前必须跑一遍面板测试", type: "state", project: "dsh-siyuan-notes", topic: "发布", status: "active" },
        { id: "20261111120001-bbbbbbb", statement: "内核 SQL 没有参数绑定", type: "fact", project: "*", status: "active" },
      ],
    },
  );
  const lines = out[0].text.split("\n");
  assert.equal(lines[0], "命中 2 条记忆：");
  // 逐字断言：id、类型、项目/主题、状态、结论的次序固定，改格式就会红。
  assert.equal(lines[1], "- 20261111120000-aaaaaaa [state · dsh-siyuan-notes/发布 · active] 发布前必须跑一遍面板测试");
  // 没有主题的条目不能拼出多余的 "/"。
  assert.equal(lines[2], "- 20261111120001-bbbbbbb [fact · * · active] 内核 SQL 没有参数绑定");
});

test("searchRender：结论截到 80 字加省略号，一条记忆只占一行", () => {
  const out = searchRender(
    { query: "截断" },
    { ok: true, results: [{ id: "20261111120002-ccccccc", statement: LONG, type: "fact", project: "p", status: "active" }] },
  );
  const lines = out[0].text.split("\n");
  assert.equal(lines.length, 2, out[0].text);
  const body = lines[1].slice(lines[1].indexOf("] ") + 2);
  assert.equal(body.length, 81, "截断后应为 80 字 + 省略号");
  assert.ok(body.endsWith("…"));
  assert.equal(body.slice(0, 80), LONG.slice(0, 80));
});

test("searchRender：刚写入的标记保留在行尾", () => {
  const out = searchRender(
    { query: "刚写入" },
    { ok: true, results: [{ id: "20261111120003-ddddddd", statement: "刚记下的一条", type: "preference", project: "*", status: "active", fresh: true }] },
  );
  assert.ok(out[0].text.includes("- 20261111120003-ddddddd [preference · * · active] 刚记下的一条（刚写入）"), out[0].text);
});

test("searchRender：没有 id 的条目退回 v5 格式（含可信度），不至于渲染成半截", () => {
  const out = searchRender(
    { query: "旧条目" },
    { ok: true, results: [{ statement: "旧缓存里的一条", type: "fact", project: "p", status: "revoked", confidence: "verified" }] },
  );
  assert.ok(out[0].text.includes("- [fact · p · revoked · verified] 旧缓存里的一条"), out[0].text);
});

test("searchRender：空结果与失败文案保持不变", () => {
  const empty = searchRender({ query: "不存在的东西" }, { ok: true, results: [] });
  assert.equal(empty[0].text, "本次检索未找到与「不存在的东西」相关的记忆；不能据此认定从未记录。");
  const failed = searchRender({ query: "x" }, { ok: false, error: { code: "offline", message: "思源连不上" } });
  assert.equal(failed[0].text, "记忆检索失败：思源连不上");
});

test("searchRender：浏览模式提示与「结果不完整」提示都还在", () => {
  const browse = searchRender({ type: "fact" }, { ok: true, results: [{ id: "20261111120004-eeeeeee", statement: "a", type: "fact", project: "p", status: "active" }] });
  assert.ok(browse[0].text.includes("浏览"), browse[0].text);
  const partial = searchRender({ query: "压缩" }, { ok: true, complete: false, warning: "仅缓存可用", results: [{ id: "20261111120005-fffffff", statement: "b", type: "fact", project: "p", status: "active" }] });
  assert.ok(partial[0].text.includes("结果不完整：仅缓存可用"), partial[0].text);
});

test("search → read 链路：渲染出来的 id 能直接喂给 memory_read", async () => {
  const kernel = memoryKernel();
  const store = createMemoryStore({ call: kernel.call, now: () => FIXED_NOW });
  // state 条目要求「结论 + - 下一步： + - 待决：」三段，写完整才能过校验。
  const written = await store.write({
    type: "state", project: "*", topic: "发布流程",
    statement: "发布流程改用蓝绿部署，回滚窗口 10 分钟\n- 下一步：观察一小时\n- 待决：无",
    confidence: "stated", source: "test:v6-render",
  });
  assert.equal(written.ok, true, JSON.stringify(written));

  const found = await store.search({ query: "蓝绿部署" });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.equal(found.value.results.length >= 1, true, "检索必须命中刚写入的条目");

  const rendered = searchRender({ query: "蓝绿部署" }, found.value)[0].text;
  // 渲染里必须出现真实 id 与主题——这正是 v5 缺的两样东西。
  assert.ok(rendered.includes(written.value.id), rendered);
  assert.ok(rendered.includes("发布流程"), rendered);
  assert.ok(rendered.includes("state"), rendered);

  // 把渲染行首的 id 原样取出来喂给 memory_read，能拿到全文（这就是模型的实际动作）。
  const id = rendered.split("\n").find((line) => line.startsWith("- ")).split(" ")[1];
  assert.equal(id, written.value.id);
  const read = await store.read([id]);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.value.entries.length, 1);
  assert.ok(read.value.entries[0].body.includes("蓝绿部署"));
});
