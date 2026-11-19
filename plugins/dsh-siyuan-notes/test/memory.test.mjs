/**
 * dsh-siyuan-notes — 记忆体测试（`node --test`）。
 *
 * 全部用一个假内核驱动，不需要真的思源。重点盯三类风险：
 * 1. SQL 注入面（思源没有参数绑定，只能自己转义）
 * 2. 写穿缓存（索引会滞后 ~2.4 秒，写完必须立刻能搜到）
 * 3. 常驻注入的冻结语义（每步重算会打掉 prompt cache，也会抖 surface）
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MEMORY_ATTRS,
  MEMORY_LIMITS,
  attributesToMap,
  buildCatalogStatement,
  buildDocLookupStatement,
  buildFilterStatement,
  buildListStatement,
  buildFtsSearchStatement,
  buildLikeSearchStatement,
  buildReadStatement,
  clampSectionLines,
  conclusionLine,
  entryAttributes,
  entryMarkdown,
  escapeSqlString,
  ftsExpression,
  siyuanStamp,
  charBigrams,
  similarity,
  parseStamp,
  singleBlockMarkdown,
  sqlString,
  toMemoryEntry,
} from "../lib/memory.js";
import { createConfirmedMemoryStore as createMemoryStore } from './helpers/confirmed-memory-store.mjs';

// ---------------------------------------------------------------- 假内核

/**
 * 一个只实现记忆体用到的几个路由的假思源内核。
 * @param {{ sql?: (stmt: string, state: any) => any }} [options]
 */
function fakeKernel(options = {}) {
  const state = {
    notebooks: [...(options.notebooks ?? [])],
    docs: new Map(),
    blocks: [],
    attrCalls: [],
    notebookCreates: 0,
    docCreates: 0,
    appends: 0,
    sqlStatements: [],
  };
  let seq = 0;
  // 思源真实块 id 形如 20261106113000-6bah958：14 位数字 + '-' + 7 位 base36。
  // 假内核必须生产同形状的 id，否则 supersedes 的格式校验会（正确地）把它们丢掉。
  const nextId = () => `20261106113000-${String(++seq).padStart(7, "0")}`;

  async function call(apiPath, payload) {
    switch (apiPath) {
      case "/api/notebook/lsNotebooks":
        return { ok: true, value: { code: 0, data: { notebooks: state.notebooks } } };
      case "/api/notebook/createNotebook": {
        state.notebookCreates += 1;
        const notebook = { id: nextId(), name: payload.name };
        state.notebooks.push(notebook);
        return { ok: true, value: { code: 0, data: { notebook } } };
      }
      case "/api/query/sql": {
        state.sqlStatements.push(payload.stmt);
        if (options.sql) return options.sql(payload.stmt, state);
        return { ok: true, value: { code: 0, data: [] } };
      }
      case "/api/filetree/createDocWithMd": {
        state.docCreates += 1;
        const id = nextId();
        state.docs.set(payload.path, id);
        return { ok: true, value: { code: 0, data: id } };
      }
      case "/api/block/appendBlock": {
        state.appends += 1;
        const id = nextId();
        state.blocks.push({ id, parentID: payload.parentID, data: payload.data, attrs: {} });
        return { ok: true, value: { code: 0, data: [{ doOperations: [{ id }] }] } };
      }
      case "/api/attr/setBlockAttrs": {
        state.attrCalls.push({ id: payload.id, attrs: payload.attrs });
        const block = state.blocks.find(block => block.id === payload.id);
        if (block) Object.assign(block.attrs, payload.attrs);
        return { ok: true, value: { code: 0, data: null } };
      }
      case "/api/attr/getBlockAttrs": return { ok: true, value: { code: 0, data: { ...state.blocks.find(block => block.id === payload.id)?.attrs } } };
      case "/api/block/getBlockInfo": return { ok: true, value: { code: 0, data: { box: state.notebooks[0]?.id } } };
      case "/api/block/getBlockKramdown": return { ok: true, value: { code: 0, data: { kramdown: state.blocks.find(block => block.id === payload.id)?.data ?? "" } } };
      default:
        return { ok: true, value: { code: 0, data: null } };
    }
  }

  return { call, state };
}

const FIXED_NOW = () => new Date("2026-11-06T11:30:00Z").getTime();

/**
 * 一个已经初始化过的记忆笔记本。
 *
 * 读路径按设计**不创建**笔记本（见 memory.js 的 resolveNotebook 注释），所以凡是要验证
 * 「读走了 SQL」的用例，都必须先让内核里已经存在这个笔记本——这才是真实稳态。
 */
const READY = Object.freeze([Object.freeze({ id: "box-ready", name: "AI 记忆体" })]);

test("内核业务失败不能被撤销成功或缓存状态变化掩盖", async () => {
  const kernel = fakeKernel();
  let rejectAttrs = false;
  const store = createMemoryStore({ call: async (path, payload) => rejectAttrs && path.endsWith("/setBlockAttrs")
    ? { ok: true, value: { code: -1, msg: "内核拒绝属性写入", data: null } }
    : kernel.call(path, payload) });
  const created = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", statement: "原记忆", project: "p" });
  rejectAttrs = true;
  const result = await store.setStatus({ id: created.value.id, status: "revoked" });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /内核拒绝/);
  assert.equal(store.peekRing()[0].status, "active");
});

test("记忆属性失败返回部分写入错误，不缓存成功，也不取代旧条目", async () => {
  const kernel = fakeKernel();
  let reject = false;
  const store = createMemoryStore({ call: async (path, payload) => reject && path.endsWith("/setBlockAttrs")
    ? { ok: true, value: { code: -1, msg: "属性失败", data: null } }
    : kernel.call(path, payload) });
  const old = await store.write({ source: "test:fixture", confidence: "stated", type: "fact", statement: "旧正文", project: "p" });
  const revision = (await store.read([old.value.id])).value.entries[0].revision;
  reject = true;
  const before = kernel.state.attrCalls.length;
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", statement: "新正文", project: "p", supersedes: [old.value.id], expectedRevisions: { [old.value.id]: revision } });
  assert.equal(result.ok, false);
  assert.ok(result.error.message.includes("属性失败"));
  assert.ok(result.partial?.id, "正文已追加，错误必须给出定位信息而不是让调用方盲目重试");
  assert.equal(store.peekRing().length, 1);
  assert.equal(store.peekRing()[0].status, "active");
  assert.equal(kernel.state.attrCalls.length, before);
});

test("写穿缓存到期后不遮盖新正文，也不复活已撤销条目", async () => {
  let at = FIXED_NOW();
  let indexed = false;
  let id;
  const kernel = fakeKernel({ sql: (stmt) => ({ ok: true, value: { code: 0, data: indexed && !stmt.includes("hpath =") && !stmt.includes("revoked") && stmt.includes("s.value = 'active'") ? [] : indexed && !stmt.includes("hpath =") ? [{ id, markdown: "思源端新正文", content: "思源端新正文", type: "fact", project: "p", status: "revoked", confidence: "verified" }] : [] } }) });
  const store = createMemoryStore({ call: kernel.call, now: () => at });
  id = (await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", statement: "旧正文", project: "p" })).value.id;
  indexed = true;
  at += 30_000;
  assert.deepEqual((await store.search({ query: "旧正文" })).value.results, []);
  assert.deepEqual((await store.list({ status: "active" })).value.entries, []);
  const all = await store.list();
  assert.equal(all.value.entries[0].statement, "思源端新正文");
  assert.deepEqual(store.peekRing(), []);
});

test("已停用的记忆实例拒绝后续写入，延迟响应不会重新填入缓存", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: async (path, payload) => {
    if (path.endsWith("/lsNotebooks")) await gate;
    return kernel.call(path, payload);
  } });
  const pending = store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", statement: "旧连接上的请求", project: "p" });
  assert.equal(typeof store.dispose, "function");
  store.dispose();
  release();
  assert.equal((await pending).ok, false);
  assert.equal(kernel.state.appends, 0);
  assert.equal(store.peekBox(), null);
  assert.deepEqual(store.peekRing(), []);
});

test("数据库确认写入后退出临时缓存，后续外部修改立即采用数据库结果", async () => {
  let row = null;
  const kernel = fakeKernel({ sql: (stmt) => ({ ok: true, value: { code: 0, data: row && !stmt.includes("hpath =") ? [row] : [] } }) });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "写入正文" });
  row = { ...Object.fromEntries(Object.entries(MEMORY_ATTRS).map(([key, attr]) => [key, kernel.state.blocks[0].attrs[attr] ?? ''])), id: result.value.id, markdown: "写入正文" };
  await store.search({ query: "正文" });
  assert.deepEqual(store.peekRing(), []);
  row.markdown = "外部修正正文";
  assert.equal((await store.search({ query: "正文" })).value.results[0].statement, "外部修正正文");
});

test("撤销已成功但 SQL 尚未更新时，不从旧索引复活记忆", async () => {
  let row = null;
  const kernel = fakeKernel({ sql: (stmt) => ({ ok: true, value: { code: 0, data: row && !stmt.includes("hpath =") ? [row] : [] } }) });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "待撤销正文" });
  row = { id: result.value.id, markdown: "待撤销正文", type: "fact", project: "p", status: "active" };
  await store.setStatus({ id: result.value.id, status: "revoked" });
  assert.deepEqual((await store.search({ query: "正文" })).value.results, []);
  assert.deepEqual((await store.list({ status: "active" })).value.entries, []);
});

test("正文缓存已经淘汰后撤销，也必须遮住延迟的 active 索引", async () => {
  let row = null;
  const kernel = fakeKernel({ sql: (stmt) => ({ ok: true, value: { code: 0, data: row && !stmt.includes("hpath =") ? [{ ...row }] : [] } }) });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "已索引正文" });
  row = { ...Object.fromEntries(Object.entries(MEMORY_ATTRS).map(([key, attr]) => [key, kernel.state.blocks[0].attrs[attr] ?? ''])), id: result.value.id, markdown: "已索引正文" };
  await store.search({ query: "正文" });
  assert.deepEqual(store.peekRing(), []);
  await store.setStatus({ id: result.value.id, status: "revoked" });
  assert.deepEqual((await store.search({ query: "正文" })).value.results, []);
  assert.deepEqual((await store.list({ status: "active" })).value.entries, []);
  assert.equal((await store.list()).value.entries[0].status, "revoked");
});

// ------------------------------------------------------------ 纯函数：转义

test("escapeSqlString 把单引号加倍", () => {
  assert.equal(escapeSqlString("it's"), "it''s");
  assert.equal(escapeSqlString("'''"), "''''''");
  assert.equal(escapeSqlString("中文'引号"), "中文''引号");
  assert.equal(escapeSqlString(null), "");
  assert.equal(escapeSqlString(42), "42");
});

test("sqlString 产出完整的单引号字面量", () => {
  assert.equal(sqlString("a'b"), "'a''b'");
  assert.equal(sqlString(""), "''");
});

// ------------------------------------------------------ 纯函数：FTS 表达式

test("ftsExpression 包成短语并保留 AND 语义", () => {
  assert.equal(ftsExpression("压缩 免疫"), '"压缩" "免疫"');
  assert.equal(ftsExpression("  噩梦  "), '"噩梦"');
});

test("ftsExpression 丢掉单字词元（中文单字会命中上万条）", () => {
  assert.equal(ftsExpression("的"), null);
  assert.equal(ftsExpression("a"), null);
  assert.equal(ftsExpression("的 梦"), null);
  assert.equal(ftsExpression("的 决定"), '"决定"');
});

test("ftsExpression 转义双引号并拒绝空输入", () => {
  assert.equal(ftsExpression('say "hi"'), '"say" """hi"""');
  assert.equal(ftsExpression(""), null);
  assert.equal(ftsExpression("   "), null);
  assert.equal(ftsExpression(null), null);
  assert.equal(ftsExpression(42), null);
});

test("ftsExpression 支持放宽成 OR", () => {
  // 模型给的检索词常比条目更宽：纯 AND 会把明明相关的条目判成不存在。
  assert.equal(ftsExpression("笔记本 内核 版本", "or"), '"笔记本" OR "内核" OR "版本"');
  assert.equal(ftsExpression("笔记本 内核 版本"), '"笔记本" "内核" "版本"');
});

test("ftsExpression 截断超长检索词", () => {
  const long = "a".repeat(500) + " b";
  const expression = ftsExpression(long);
  assert.ok(expression.length <= MEMORY_LIMITS.maxQueryChars + 8);
});

// -------------------------------------------------------- 纯函数：条目形状

test("conclusionLine 取第一个非空行并截断", () => {
  assert.equal(conclusionLine("\n\n第一行\n第二行"), "第一行");
  assert.equal(conclusionLine("  空格结论  \n理由"), "空格结论");
  assert.equal(conclusionLine(""), "");
  assert.equal(conclusionLine(null), "");
  assert.equal(conclusionLine("x".repeat(400)).length, 200);
});

test("entryMarkdown 以结论开头，理由与否决各占一行", () => {
  assert.equal(
    entryMarkdown({ statement: "结论", reason: "因为", rejected: "另一种做法" }),
    "结论\n- 理由：因为\n- 否决：另一种做法",
  );
  assert.equal(entryMarkdown({ statement: "只有结论" }), "只有结论");
  assert.equal(entryMarkdown({ statement: "  结论  ", reason: "  ", rejected: "" }), "结论");
});

test("entryAttributes 只收枚举，非法值退回安全默认", () => {
  const attrs = entryAttributes({
    type: "decision",
    project: "dsh-siyuan-notes",
    confidence: "verified",
    source: "session:abc",
    created: "20261106113000",
  });
  assert.equal(attrs[MEMORY_ATTRS.type], "decision");
  assert.equal(attrs[MEMORY_ATTRS.status], "active");
  assert.equal(attrs[MEMORY_ATTRS.confidence], "verified");
  assert.equal(attrs[MEMORY_ATTRS.project], "dsh-siyuan-notes");

  const fallback = entryAttributes({ type: " nonsense ", project: "", confidence: "maybe" });
  assert.equal(fallback[MEMORY_ATTRS.type], "fact");
  assert.equal(fallback[MEMORY_ATTRS.confidence], "inferred");
  assert.equal(fallback[MEMORY_ATTRS.project], "*");
});

test("attributesToMap 折平查询行", () => {
  const map = attributesToMap([
    { name: "custom-mem-type", value: "decision" },
    { name: "custom-mem-status", value: "active" },
    { name: 42, value: "x" },
    { value: "no-name" },
  ]);
  assert.deepEqual(map, { "custom-mem-type": "decision", "custom-mem-status": "active" });
});

test("clampSectionLines 超预算就截断而不是硬塞", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `第 ${index} 行`);
  const clamped = clampSectionLines(lines, 40);
  assert.ok(clamped.length <= 40);
  assert.ok(clamped.startsWith("第 0 行"));
  assert.ok(!clamped.includes("第 49 行"));
});

test("siyuanStamp 是 14 位数字", () => {
  const stamp = siyuanStamp(new Date(2026, 10, 6, 11, 30, 0));
  assert.match(stamp, /^\d{14}$/u);
  assert.equal(stamp, "20261106113000");
});

test("toMemoryEntry 优先用 markdown 再看 content", () => {
  const entry = toMemoryEntry(
    { id: "b1", content: "纯文本", markdown: "**富文本**\n第二行", created: "20261106" },
    { "custom-mem-type": "decision", "custom-mem-project": "p", "custom-mem-created": "20261106" },
  );
  assert.equal(entry.id, "b1");
  assert.equal(entry.statement, "**富文本**");
  assert.equal(entry.type, "decision");
  assert.equal(entry.fresh, false);
});

// ------------------------------------------------------- SQL 构造安全性

test("buildFtsSearchStatement 转义检索词与过滤值", () => {
  const stmt = buildFtsSearchStatement({
    box: "b'x",
    expression: ftsExpression("危险' OR 1=1 --"),
    type: "decision",
    project: "p'q",
    limit: 8,
  });
  assert.ok(stmt.includes("b.box = 'b''x'"));
  assert.ok(stmt.includes("t.value = 'decision'"));
  assert.ok(stmt.includes("p.value = 'p''q'"));
  assert.ok(!stmt.includes("p.value = 'p'q'"));
});

test("buildFtsSearchStatement 夹紧 limit", () => {
  const over = buildFtsSearchStatement({ box: "b", expression: "x", limit: 9999 });
  assert.ok(over.trimEnd().endsWith("LIMIT 25;"));
  const under = buildFtsSearchStatement({ box: "b", expression: "x", limit: 0 });
  assert.ok(under.trimEnd().endsWith("LIMIT 1;"));
});

test("buildReadStatement 转义 id 并夹紧数量", () => {
  const stmt = buildReadStatement({ ids: ["a'1", "b2"] });
  assert.ok(stmt.includes("'a''1'"));
  assert.ok(stmt.includes("'b2'"));

  const many = buildReadStatement({ ids: Array.from({ length: 100 }, (_, index) => `id${index}`) });
  assert.equal((many.match(/'id\d+'/gu) ?? []).length, MEMORY_LIMITS.maxReadIds);
});

test("buildReadStatement 对空列表产出不可命中的 IN ()", () => {
  assert.ok(buildReadStatement({ ids: [] }).includes("IN ()"));
});

test("buildCatalogStatement 与 buildDocLookupStatement 都限定在记忆笔记本内", () => {
  assert.ok(buildCatalogStatement({ box: "nb1" }).includes("b.box = 'nb1'"));
  assert.ok(buildDocLookupStatement({ box: "nb1", title: "决策" }).includes("hpath = '/决策'"));
});

test("buildLikeSearchStatement 转义 LIKE 通配之外的字符", () => {
  const stmt = buildLikeSearchStatement({ box: "b", needle: "50%'", limit: 5 });
  assert.ok(stmt.includes("'%50%''%'"));
});

test("buildFilterStatement 是纯过滤，不带文字条件", () => {
  const stmt = buildFilterStatement({ box: "b", type: "decision", project: "p", limit: 5 });
  assert.ok(!stmt.includes("LIKE"), "浏览不该生成 LIKE");
  assert.ok(!stmt.includes("MATCH"), "浏览不该生成 MATCH");
  assert.ok(stmt.includes("s.value IN ('active', 'candidate')"));
  assert.ok(stmt.includes("t.value = 'decision'"));
  assert.ok(stmt.includes("p.value = 'p'"));
  assert.ok(stmt.trimEnd().endsWith("LIMIT 5;"));
});

// ------------------------------------------------------------ 存储：写入

test("write 走两步写：先 appendBlock 再 setBlockAttrs", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });

  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实",
    type: "decision",
    project: "dsh-siyuan-notes",
    statement: "压缩免疫靠 system prompt section",
    reason: "section 不在被压缩的面上",
    rejected: "挂 compaction 事件",
    confidence: "verified",
    source: "session:abc",
  });

  assert.equal(result.ok, true);
  assert.equal(kernel.state.appends, 1);
  assert.equal(kernel.state.notebookCreates, 1, "第一次写入要建记忆笔记本");
  assert.equal(kernel.state.docCreates, 1, "decision 类要建对应文档");

  const appended = kernel.state.blocks[0];
  assert.equal(
    appended.data,
    "压缩免疫靠 system prompt section<br>- 理由：section 不在被压缩的面上<br>- 否决：挂 compaction 事件",
    "多行正文必须压成一个段落块，否则属性会和正文分家",
  );

  const tagged = kernel.state.attrCalls.find((item) => item.id === result.value.id);
  assert.equal(tagged.attrs[MEMORY_ATTRS.type], "decision");
  assert.equal(tagged.attrs[MEMORY_ATTRS.status], "active");
  assert.equal(tagged.attrs[MEMORY_ATTRS.confidence], "verified");
});

test("write 复用同一个笔记本与文档，不重复创建", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "第一条" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "第二条" });
  assert.equal(kernel.state.notebookCreates, 1);
  assert.equal(kernel.state.docCreates, 1);
  assert.equal(kernel.state.appends, 2);
});

test("write 只新建缺的那类文档", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "事实一条" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "决策一条" });
  assert.equal(kernel.state.docCreates, 2);
});

test("write 接受整段 Markdown，并用第一行作结论", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实",
    type: "decision",
    project: "p",
    body: "第一行结论\n- 理由：随便\n- 否决：另一条路",
  });
  assert.equal(result.ok, true);
  assert.equal(kernel.state.blocks[0].data, "第一行结论<br>- 理由：随便<br>- 否决：另一条路");

  const found = await store.search({ query: "结论" });
  assert.equal(found.value.results[0].statement, "第一行结论");
});

test("singleBlockMarkdown 把换行压成 <br>", () => {
  // 实测：带 `- ` 列表的多行 Markdown 会被 appendBlock 拆成多个块，属性就只能标到其中一个；
  // 用 <br> 保持单块，读回来的 content 仍是真实换行。
  assert.equal(singleBlockMarkdown("结论\n- 理由：r\n- 否决：x"), "结论<br>- 理由：r<br>- 否决：x");
  assert.equal(singleBlockMarkdown("结论\r\n理由\r\n"), "结论<br>理由");
  assert.equal(singleBlockMarkdown("单行"), "单行");
  assert.equal(singleBlockMarkdown("  \n "), "");
  assert.equal(singleBlockMarkdown(null), "");
  assert.equal(singleBlockMarkdown(42), "");
});

test("write 对只有空白的 body 报空结论", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", body: "   \n  \n" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "empty_statement");
});

test("write 拒绝非法类型与空结论", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });

  const badType = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "nonsense", project: "p", statement: "x" });
  assert.equal(badType.ok, false);
  assert.equal(badType.error.code, "invalid_type");

  const empty = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "   " });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "empty_statement");
  assert.equal(kernel.state.appends, 0);
});

test("write 在 appendBlock 没有返回块 id 时失败", async () => {
  const kernel = fakeKernel();
  const brokenCall = async (apiPath, payload) => {
    if (apiPath === "/api/block/appendBlock") return { ok: true, value: { code: 0, data: [] } };
    return kernel.call(apiPath, payload);
  };
  const store = createMemoryStore({ call: brokenCall, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "append_failed");
});

test("write 的属性写入失败必须报告部分完成", async () => {
  const kernel = fakeKernel();
  const partialCall = async (apiPath, payload) => {
    if (apiPath === "/api/attr/setBlockAttrs") return { ok: false, error: { code: "x", message: "boom" } };
    return kernel.call(apiPath, payload);
  };
  const store = createMemoryStore({ call: partialCall, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "正文写进去了" });
  assert.equal(result.ok, false);
  assert.ok(result.partial.id);
  assert.equal(result.partial.superseded.length, 0);
});

test("write 用 supersedes 标记旧条目而不是删除", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const first = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "旧决定" });
  const second = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实",
    type: "decision",
    project: "p",
    statement: "新决定",
    supersedes: [first.value.id],
    expectedRevisions: { [first.value.id]: (await store.read([first.value.id])).value.entries[0].revision },
  });

  assert.deepEqual(second.value.superseded, [first.value.id]);
  const patch = kernel.state.attrCalls.find(
    (item) => item.id === first.value.id && item.attrs[MEMORY_ATTRS.status] === "superseded",
  );
  assert.ok(patch, "旧条目要被标 superseded");
  assert.equal(patch.attrs[MEMORY_ATTRS.supersededBy], second.value.id);
});

test("write 拒绝格式非法的 supersedes id", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const result = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实",
    type: "fact",
    project: "p",
    statement: "x",
    supersedes: ["'; DROP TABLE blocks; --", "20260101000000-abcdefg"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_targets");
  assert.equal(kernel.state.appends, 0);
});

// ------------------------------------------------------------ 存储：检索

test("search 先命写穿缓存，保证「刚写完就能搜到」", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "索引会滞后两秒" });

  // 假内核的 SQL 永远返回空——模拟 attributes 表还没索引到。
  const found = await store.search({ query: "滞后" });
  assert.equal(found.ok, true);
  assert.equal(found.value.results.length, 1);
  assert.equal(found.value.results[0].fresh, true);
  assert.equal(found.value.results[0].statement, "索引会滞后两秒");
});

test("search 合并缓存与 SQL 并去重", async () => {
  const INDEX_ONLY = "20200101000000-abcdefg";
  const kernel = fakeKernel({
    sql: (stmt, state) => {
      if (stmt.includes("blocks_fts MATCH")) {
        const cachedId = state.blocks[0]?.id ?? "";
        return {
          ok: true,
          value: {
            code: 0,
            data: [
              { id: cachedId, content: "来自缓存的那条", type: "decision", project: "p", confidence: "verified", created: "1" },
              { id: INDEX_ONLY, content: "只存在于索引里的那条", type: "decision", project: "p", confidence: "stated", created: "2" },
            ],
          },
        };
      }
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const written = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "来自缓存的那条" });

  const found = await store.search({ query: "那条" });
  assert.deepEqual(
    found.value.results.map((entry) => entry.id),
    [written.value.id, INDEX_ONLY],
  );
  assert.equal(found.value.results[0].fresh, true);
  assert.equal(found.value.results[1].fresh, false);
});

test("search 的 FTS 抛错时退回 LIKE", async () => {
  let calls = 0;
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => {
      calls += 1;
      if (stmt.includes("blocks_fts MATCH")) return { ok: false, error: { code: "sql", message: "fts exploded" } };
      if (stmt.includes("LIKE")) return { ok: true, value: { code: 0, data: [{ id: "b9", content: "LIKE 兜底命中", type: "fact", project: "p", confidence: "stated", created: "3" }] } };
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const found = await store.search({ query: "兜底" });
  assert.equal(found.value.source, "like");
  assert.equal(found.value.results.length, 1);
  assert.ok(calls >= 2);
});

test("search 在 AND 落空时放宽成 OR", async () => {
  const seen = [];
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => {
      seen.push(stmt);
      // 第一次（AND）故意返回空，第二次（OR）返回一条。
      if (stmt.includes('"笔记本" "内核"')) return { ok: true, value: { code: 0, data: [] } };
      if (stmt.includes('"笔记本" OR "内核"')) {
        return {
          ok: true,
          value: {
            code: 0,
            data: [{ id: "20261106113000-0000001", content: "内核与笔记本", type: "fact", project: "p", confidence: "verified", created: "1" }],
          },
        };
      }
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const found = await store.search({ query: "笔记本 内核 版本" });
  assert.equal(found.value.source, "fts-or");
  assert.equal(found.value.results.length, 1);
  assert.ok(seen.some((s) => s.includes(" OR ")));
});

test("search 单次检索词不会触发放宽", async () => {
  const seen = [];
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => {
      seen.push(stmt);
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.search({ query: "内核" });
  assert.ok(!seen.some((s) => s.includes(" OR ")), "单个词元没有可放宽的余地");
});

test("search 在单字检索词时直接走 LIKE", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const found = await store.search({ query: "的" });
  assert.equal(found.value.source, "like");
  assert.ok(!kernel.state.sqlStatements.some((stmt) => stmt.includes("blocks_fts MATCH")));
});

test("search 无检索词时走 filter，不生成 LIKE 或 MATCH", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const found = await store.search({ type: "fact", project: "p" });
  assert.equal(found.value.source, "filter");
  assert.ok(!kernel.state.sqlStatements.some((stmt) => stmt.includes("LIKE")));
  assert.ok(!kernel.state.sqlStatements.some((stmt) => stmt.includes("MATCH")));
});

test("search 按类型与项目过滤写穿缓存", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "a", statement: "A 事实" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "b", statement: "B 决策" });

  assert.equal((await store.search({ type: "fact" })).value.results.length, 1);
  assert.equal((await store.search({ project: "b" })).value.results.length, 1);
  assert.equal((await store.search({ type: "fact", project: "b" })).value.results.length, 0);
  assert.equal((await store.search({ limit: 1 })).value.results.length, 1);
});

test("search 夹紧 limit 上界", async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `202001010000${String(index).padStart(2, "0")}-zzzzzzz`,
    content: `条目 ${index}`,
    type: "fact",
    project: "p",
    confidence: "stated",
    created: "1",
  }));
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => (stmt.includes("blocks_fts MATCH") ? { ok: true, value: { code: 0, data: rows } } : { ok: true, value: { code: 0, data: [] } }),
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const found = await store.search({ query: "条目", limit: 9999 });
  assert.equal(found.value.results.length, MEMORY_LIMITS.maxSearchLimit);
});

// ------------------------------------------------------------ 存储：读取

test("read 在 SQL 还没索引到时用写穿缓存顶上", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const written = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "刚写的", reason: "马上要读" });

  const read = await store.read([written.value.id]);
  assert.equal(read.value.entries.length, 1);
  assert.equal(read.value.entries[0].fresh, true);
  assert.ok(read.value.entries[0].body.includes("马上要读"));
});

test("read 从索引取全文并顺带累计引用计数", async () => {
  const kernel = fakeKernel({ notebooks: READY,
    sql: (stmt) => {
      if (stmt.includes("b.id IN")) {
        return {
          ok: true,
          value: {
            code: 0,
            data: [
              { id: "b1", content: "结论行\n- 理由：细节", markdown: "", created: "7", name: "custom-mem-type", value: "decision" },
              { id: "b1", created: "7", name: "custom-mem-refcount", value: "4" },
            ],
          },
        };
      }
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const read = await store.read(["b1"]);
  assert.equal(read.value.entries.length, 1);
  assert.equal(read.value.entries[0].statement, "结论行");
  assert.equal(read.value.entries[0].type, "decision");

  const bump = kernel.state.attrCalls.find((item) => item.attrs[MEMORY_ATTRS.refcount] === "5");
  assert.ok(bump, "引用计数应当累加");
});

test("read 对空输入与超量输入都不炸", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  assert.deepEqual((await store.read([])).value.entries, []);
  assert.deepEqual((await store.read(undefined)).value.entries, []);
  await store.read(Array.from({ length: 50 }, (_, index) => `id${index}`));
});

// ------------------------------------------------------------ 存储：注入

test("sectionText 在会话内冻结，重复调用不再查 SQL", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "preference", project: "*", global: true, statement: "先出方案再动手" });

  const before = kernel.state.sqlStatements.length;
  const first = await store.sectionText();
  const afterFirst = kernel.state.sqlStatements.length;
  const second = await store.sectionText();

  assert.equal(first, second);
  assert.equal(kernel.state.sqlStatements.length, afterFirst, "第二次不应再打内核");
  assert.ok(afterFirst >= before);
  assert.ok(first.includes("先出方案再动手"));
});

test("sectionText 在 refreshSnapshot 后重建", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.sectionText();
  const callsBefore = kernel.state.sqlStatements.length;
  store.refreshSnapshot();
  await store.sectionText();
  assert.ok(kernel.state.sqlStatements.length > callsBefore);
});

test("sectionText 在 force 时重建", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.sectionText();
  const callsBefore = kernel.state.sqlStatements.length;
  await store.sectionText({ force: true });
  assert.ok(kernel.state.sqlStatements.length > callsBefore);
});

test("sectionText 在思源不可用时降级而不是抛", async () => {
  const store = createMemoryStore({
    call: async () => ({ ok: false, error: { code: "upstream_unreachable", message: "断网" } }),
    now: FIXED_NOW,
  });
  const text = await store.sectionText();
  assert.equal(typeof text, "string");
  assert.ok(text.startsWith("[记忆]"));
});

test("sectionText 遵守字符预算", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  for (let index = 0; index < 12; index += 1) {
    await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "preference", project: "*", statement: `偏好条目 ${index} ${"很长的描述".repeat(6)}` });
  }
  const text = await store.sectionText();
  assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars);
});

// ------------------------------------------------------------ 存储：目录

test("catalog 只返回四类，且过滤未知类型", async () => {
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => {
      if (stmt.includes("GROUP BY t.value")) {
        return {
          ok: true,
          value: {
            code: 0,
            data: [
              { type: "decision", n: 47, latest: "20261106113000" },
              { type: "weird", n: 3, latest: "20261101" },
            ],
          },
        };
      }
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const catalog = await store.catalog();
  assert.deepEqual(catalog.value.catalog.map((item) => item.type), ["decision"]);
  assert.equal(catalog.value.catalog[0].count, 47);
});

test("catalog 在笔记本不可达时返回明确失败", async () => {
  const store = createMemoryStore({
    call: async () => ({ ok: false, error: { code: "x", message: "y" } }),
    now: FIXED_NOW,
  });
  assert.equal((await store.catalog()).ok, false);
});

// ------------------------------------------------------------ 存储：面板列表

test("buildListStatement 支持按状态过滤，且不强制 active", () => {
  const stmt = buildListStatement({ box: "b", status: "superseded", limit: 100 });
  assert.ok(stmt.includes("s.value = 'superseded'"));
  assert.ok(!stmt.includes("s.value = 'active'"), "面板要能看见非 active 的条目");
  assert.ok(stmt.includes("LEFT JOIN attributes src"), "来源要一起取出来");
});

test("list 能看见 superseded / revoked 条目", async () => {
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => {
      if (stmt.includes("LEFT JOIN attributes src")) {
        return {
          ok: true,
          value: {
            code: 0,
            data: [
              { id: "20261106113000-0000001", content: "旧决定", type: "decision", project: "p", status: "superseded", confidence: "verified", created: "1", source: "session:x" },
              { id: "20261106113000-0000002", content: "新决定", type: "decision", project: "p", status: "active", confidence: "verified", created: "2", source: "session:x" },
            ],
          },
        };
      }
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const listed = await store.list({});
  assert.deepEqual(listed.value.entries.map((e) => e.status).sort(), ["active", "superseded"]);
  assert.equal(listed.value.entries.find(entry => entry.status === 'superseded').source, "session:x");
});

test("list 把还没进索引的缓存条目补在最前面", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const written = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "刚写的" });
  const listed = await store.list({});
  assert.equal(listed.value.entries[0].id, written.value.id);
  assert.equal(listed.value.entries[0].fresh, true);
});

test("list 按类型与状态过滤缓存", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "事实" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "决策" });
  assert.equal((await store.list({ type: "fact" })).value.entries.length, 1);
  assert.equal((await store.list({ status: "superseded" })).value.entries.length, 0);
});

test("setStatus 改状态而不是删除", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const written = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "要撤销的" });
  const revoked = await store.setStatus({ id: written.value.id, status: "revoked" });
  assert.equal(revoked.ok, true);
  const patch = kernel.state.attrCalls.find(
    (item) => item.id === written.value.id && item.attrs[MEMORY_ATTRS.status] === "revoked",
  );
  assert.ok(patch, "应当下发 status=revoked 的属性更新");
});

test("setStatus 标记被取代时补上「被谁取代」这一半", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const old = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "旧" });
  const fresh = await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "新" });
  const result = await store.setStatus({
    id: old.value.id,
    status: "superseded",
    supersededBy: fresh.value.id,
    expectedRevision: (await store.read([old.value.id])).value.entries[0].revision,
  });
  assert.equal(result.ok, true);
  const patch = kernel.state.attrCalls.find(
    (item) => item.id === old.value.id && item.attrs[MEMORY_ATTRS.status] === "superseded",
  );
  assert.equal(patch.attrs[MEMORY_ATTRS.supersededBy], fresh.value.id);
});

test("setStatus 拒绝形状不对的 supersededBy，不修改条目", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const old = await store.write({ type: "fact", project: "p", statement: "旧", source: "test:fixture", confidence: "stated" });
  const result = await store.setStatus({ id: old.value.id, status: "superseded", supersededBy: "invalid" });
  assert.equal(result.ok, false);
  assert.equal(store.peekRing()[0].status, "active");
});

test("setStatus 校验 id 形状与状态取值", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  assert.equal((await store.setStatus({ id: "'; DROP TABLE blocks; --", status: "revoked" })).error.code, "invalid_id");
  assert.equal(
    (await store.setStatus({ id: "20261106115529-u2ccn40", status: "nonsense" })).error.code,
    "invalid_status",
  );
});

// ------------------------------------------------------------ 存储：交接卡

test("handoff 把当前 active 记忆按结构拼成 Markdown", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "state", project: "dsh-siyuan-notes", topic: "memory", body: "P3 进行中\n- 下一步：验收\n- 待决：无" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "preference", project: "*", statement: "先出方案再动手" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "dsh-siyuan-notes", statement: "用 section 不用钩子" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "dsh-siyuan-notes", statement: "索引滞后两秒" });

  const card = await store.handoff();
  const md = card.value.markdown;
  assert.ok(md.startsWith("# 会话交接卡"));
  assert.ok(md.includes("## 当前状态与待办"));
  assert.ok(md.includes("P3 进行中"));
  assert.ok(md.includes("## 工作方式"));
  assert.ok(md.includes("先出方案再动手"));
  assert.ok(md.includes("## 最近决策"));
  assert.ok(md.includes("## 已知的坑与硬约束"));
  assert.equal(card.value.counts.decision, 1);
});

test("handoff 在记忆为空时说明而不是给一张空卡", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const card = await store.handoff();
  assert.ok(card.value.markdown.includes("还没有可交接的条目"));
});

test("handoff 说明自己是记忆快照而不是会话流水", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const card = await store.handoff();
  assert.ok(card.value.markdown.includes("记忆快照"));
  assert.ok(card.value.markdown.includes("session_search"));
});

test("读路径绝不创建笔记本（HMR 反复重载曾因此留下三个空笔记本）", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.sectionText();
  await store.catalog();
  await store.search({ query: "任意" });
  await store.read(["20261106113000-0000001"]);
  assert.equal(kernel.state.notebookCreates, 0, "没有任何写入时不该建笔记本");
  assert.equal(kernel.state.docCreates, 0);
});

test("并发写入只建一个笔记本", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await Promise.all([
    store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "并发一" }),
    store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "并发二" }),
    store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "并发三" }),
  ]);
  assert.equal(kernel.state.notebookCreates, 1);
  assert.equal(kernel.state.docCreates, 2, "fact 一篇、decision 一篇");
});

test("catalog 把还没进索引的缓存条目补上", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "刚写的决策" });
  // 假内核的 SQL 永远返回空 => 模拟索引还没跟上。
  const catalog = await store.catalog();
  const decision = catalog.value.catalog.find((item) => item.type === "decision");
  assert.ok(decision, "缓存里的决策必须出现在目录里");
  assert.equal(decision.count, 1);
});

test("catalog 不重复计算已经进索引的缓存条目", async () => {
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt, state) => {
      if (stmt.includes("GROUP BY t.value")) {
        return { ok: true, value: { code: 0, data: [{ type: "decision", n: 5, latest: "20261106113000" }] } };
      }
      if (stmt.includes("id IN (")) {
        // 缓存里那条已经在索引里了
        return { ok: true, value: { code: 0, data: [{ id: state.blocks[0]?.id ?? "" }] } };
      }
      return { ok: true, value: { code: 0, data: [] } };
    },
  });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "p", statement: "x" });
  const catalog = await store.catalog();
  const decision = catalog.value.catalog.find((item) => item.type === "decision");
  assert.equal(decision.count, 5, "已在索引里的缓存条目不应再算一遍");
});

// ------------------------------------------------------------ 存储：复用

test("已有同名笔记本时直接复用，不新建", async () => {
  const kernel = fakeKernel({ notebooks: [{ id: "existing-box", name: "AI 记忆体" }] });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "x" });
  assert.equal(kernel.state.notebookCreates, 0);
});

test("自定义笔记本名会被尊重", async () => {
  const kernel = fakeKernel({ notebooks: [{ id: "b1", name: "我的记忆" }] });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW, notebookName: "我的记忆" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "x" });
  assert.equal(kernel.state.notebookCreates, 0);
  assert.equal(store.peekBox(), "b1");
});

test("reset 清空全部缓存，下次重新解析笔记本", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: "x" });
  assert.equal(store.peekRing().length, 1);
  store.reset();
  assert.equal(store.peekRing().length, 0);
  assert.equal(store.peekBox(), null);
});

test("写穿缓存有上界", async () => {
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  for (let index = 0; index < MEMORY_LIMITS.ringSize + 5; index += 1) {
    await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "fact", project: "p", statement: `条目 ${index}` });
  }
  assert.equal(store.peekRing().length, MEMORY_LIMITS.ringSize);
});

// ------------------------------------------------------------ 体检用的纯函数

test("charBigrams 切中文二元组", () => {
  assert.deepEqual([...charBigrams("压缩免疫")].sort(), ["免疫", "压缩", "缩免"].sort());
  assert.deepEqual([...charBigrams("a")], ["a"]);
  assert.equal(charBigrams("").size, 0);
});

test("similarity 能分开重复与不同", () => {
  assert.equal(similarity("压缩免疫靠 section", "压缩免疫靠 section"), 1);
  assert.ok(similarity("压缩免疫靠 section", "压缩免疫靠 section 实现") > 0.7);
  assert.ok(similarity("压缩免疫靠 section", "思源的索引会滞后两秒") < 0.2);
  assert.equal(similarity("", ""), 1);
  assert.equal(similarity("", "x"), 0);
});

test("parseStamp 解析思源时间戳", () => {
  assert.equal(typeof parseStamp("20261106121212"), "number");
  assert.equal(parseStamp("nope"), null);
  assert.equal(parseStamp(""), null);
  const parsed = parseStamp("20261106121212");
  assert.equal(new Date(parsed).getFullYear(), 2026);
});

// ------------------------------------------------------------ 记忆体检

/** 一套固定的体检样本。 */
const CHECKUP_ROWS = [
  { id: "20261106000001-aaaaaaa", content: "重复结论", type: "fact", project: "p", status: "active", confidence: "verified", created: "20261106000000", refcount: "0", lastread: "", supersedes: "", supersededBy: "" },
  { id: "20261106000002-bbbbbbb", content: "重复结论", type: "fact", project: "p", status: "active", confidence: "verified", created: "20261106000001", refcount: "0", lastread: "", supersedes: "", supersededBy: "" },
  { id: "20261106000003-ccccccc", content: "压缩免疫靠 section 实现", type: "decision", project: "p", status: "active", confidence: "verified", created: "20261106000002", refcount: "0", lastread: "", supersedes: "", supersededBy: "" },
  { id: "20261106000004-ddddddd", content: "压缩免疫靠 section", type: "decision", project: "p", status: "active", confidence: "verified", created: "20261106000003", refcount: "0", lastread: "", supersedes: "", supersededBy: "" },
  { id: "20250101000005-eeeeeee", content: "很久以前的当前状态", type: "state", project: "p", status: "active", confidence: "stated", created: "20250101000000", refcount: "0", lastread: "", supersedes: "", supersededBy: "" },
  { id: "20250101000006-fffffff", content: "断链的旧条目", type: "fact", project: "p", status: "superseded", confidence: "stated", created: "20250101000000", refcount: "1", lastread: "20250101000000", supersedes: "", supersededBy: "" },
  { id: "20250101000007-ggggggg", content: "可归档的条目", type: "fact", project: "p", status: "revoked", confidence: "stated", created: "20250101000000", refcount: "0", lastread: "20250101000000", supersedes: "", supersededBy: "" },
];

test("checkup 找出重复、疑似相似、过期状态、断链与归档候选", async () => {
  const kernel = fakeKernel({
    notebooks: READY,
    sql: (stmt) => (stmt.includes("LEFT JOIN attributes sup") ? { ok: true, value: { code: 0, data: CHECKUP_ROWS } } : { ok: true, value: { code: 0, data: [] } }),
  });
  const store = createMemoryStore({ call: kernel.call, now: () => new Date("2026-11-06T12:00:00").getTime() });
  const report = (await store.checkup()).value;

  assert.equal(report.total, CHECKUP_ROWS.length);
  assert.equal(report.active, 5);
  assert.equal(report.duplicates.length, 1);
  assert.deepEqual(report.duplicates[0].ids.slice().sort(), ["20261106000001-aaaaaaa", "20261106000002-bbbbbbb"]);
  assert.equal(report.similar.length, 1, "「压缩免疫靠 section」两条只差两个字，算疑似");
  assert.equal(report.staleStates.length, 1, "只挑 state 类且超过 30 天的");
  assert.equal(report.staleStates[0].id, "20250101000005-eeeeeee");
  assert.equal(report.brokenChains.length, 1);
  assert.equal(report.brokenChains[0].id, "20250101000006-fffffff");
  // 两条非 active 的旧条目都够归档条件：断链那条和撤销那条。
  assert.deepEqual(
    report.archiveCandidates.map((entry) => entry.id).sort(),
    ["20250101000006-fffffff", "20250101000007-ggggggg"],
  );
});

test("checkup 在空记忆上给出空报告而不是报错", async () => {
  const kernel = fakeKernel({ notebooks: READY });
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  const report = (await store.checkup()).value;
  assert.deepEqual(report, { complete: true, scannedLimit: 200, total: 0, active: 0, duplicates: [], similar: [], staleStates: [], brokenChains: [], archiveCandidates: [], topicDrift: [] });
});

test("sectionText 截断过长的单条，避免挤爆预算", async () => {
  // 实测：一条 state 的结论行写了 100+ 字，把注入从 400 字顶到 717 字（预算 900）。
  const kernel = fakeKernel();
  const store = createMemoryStore({ call: kernel.call, now: FIXED_NOW });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "state", project: "*", global: true, topic: "memory", body: "很长的待办".repeat(30) + "\n- 下一步：验收\n- 待决：无" });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "decision", project: "*", global: true, statement: "很长的决策".repeat(30) });
  await store.write({ source: "test:fixture", confidence: "stated", evidence: "测试中由假内核核实", type: "preference", project: "*", global: true, statement: "很长的偏好".repeat(30) });
  const text = await store.sectionText();
  assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars);
  for (const line of text.split("\n")) {
    assert.ok(line.length <= 120, `单行过长：${line.slice(0, 40)}…`);
  }
  assert.ok(text.includes("…"), "截断要有省略号");
});
