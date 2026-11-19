// 宿主可靠性回归：所有网络和文件均隔离，不接触用户的思源或 DSH 配置。
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { apply, createSiYuanRoutes } from "../lib/index.js";

async function request(handler, url, body, method = "POST") {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url });
  const res = { status: 0, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res);
  return res;
}

async function isolated(run) {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "dsh-siyuan-reliability-"));
  const oldHome = process.env.DSH_SIYUAN_NOTES_HOME;
  const oldFetch = globalThis.fetch;
  process.env.DSH_SIYUAN_NOTES_HOME = dir;
  try { await run(dir); }
  finally {
    globalThis.fetch = oldFetch;
    if (oldHome === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME;
    else process.env.DSH_SIYUAN_NOTES_HOME = oldHome;
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    // 记忆凭据是后台落盘的：停用后可能还有一次写入没结束，清理临时目录要容忍它（此前偶发 ENOTEMPTY）。
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

test("配置和布局一次写盘失败后可以重试，失败内容不会成为已保存缓存", async () => {
  await isolated(async () => {
    globalThis.fetch = async () => Response.json({ code: 0, data: "3.8.3" });
    for (const route of ["config", "layout"]) {
      const routes = createSiYuanRoutes({ config: { baseUrl: "http://kernel-a:6806" } });
      const payload = route === "config" ? { baseUrl: "http://kernel-b:6806" } : { panes: [{ tabs: [], active: -1 }], activePane: 0 };
      const mkdir = fsp.mkdir;
      let attempts = 0;
      fsp.mkdir = async () => { attempts++; throw Object.assign(new Error("磁盘已满"), { code: "ENOSPC" }); };
      try {
        const failed = await request(routes.handler, `/siyuan/${route}`, payload);
        assert.equal(failed.status, 500);
      } finally { fsp.mkdir = mkdir; }
      if (route === "config") assert.equal(routes.currentSettings().baseUrl, "http://kernel-a:6806");
      else assert.equal((await request(routes.handler, "/siyuan/layout", undefined, "GET")).body.value.layout, null);
      assert.equal(attempts, 1);
      const retried = await request(routes.handler, `/siyuan/${route}`, payload);
      assert.equal(retried.status, 200, JSON.stringify(retried.body));
      assert.equal(retried.body.ok, true);
    }
  });
});

test("切换连接重建记忆实例，后续查询和写入只使用新库", async () => {
  await isolated(async () => {
    const calls = [];
    let seq = 0;
    const attrs = new Map(), bodies = new Map();
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(url);
      const body = JSON.parse(init.body ?? "{}");
      const group = parsed.hostname === "kernel-a" ? "a" : "b";
      const docId = `20261109120000-${group.repeat(7)}`;
      calls.push({ group, api: parsed.pathname, body });
      let data = null;
      if (parsed.pathname.endsWith("/version")) data = "3.8.3";
      if (parsed.pathname.endsWith("/lsNotebooks")) data = { notebooks: [{ id: `box-${group}`, name: "AI 记忆体" }] };
      if (parsed.pathname.endsWith("/sql")) data = body.stmt.includes("hpath =") ? [{ id: docId }] : [];
      if (parsed.pathname.endsWith("/appendBlock")) {
        if (body.parentID !== docId) return Response.json({ code: -1, msg: "使用了其他内核的文档 ID" });
        const id = `20261109120000-${String(++seq).padStart(7, "0")}`;
        data = [{ doOperations: [{ id }] }]; bodies.set(id, body.data);
      }
      if (parsed.pathname.endsWith("/setBlockAttrs")) attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs });
      if (parsed.pathname.endsWith("/getBlockAttrs")) data = attrs.get(body.id) ?? {};
      if (parsed.pathname.endsWith("/getBlockInfo")) data = { box: `box-${group}` };
      if (parsed.pathname.endsWith("/getBlockKramdown")) data = { kramdown: bodies.get(body.id) };
      return Response.json({ code: 0, data });
    };
    let handler;
    const tools = new Map();
    const sections = [];
    const ctx = {
      webServer: { register(route) { handler = route.handler; return () => {}; } },
      systemPrompt: { section(value) { sections.push(value); }, context() {} },
      effect(fn) { return fn(); },
      inject(_deps, fn) { fn(ctx); },
      get(name) { return name === "tools" ? { register(tool) { tools.set(tool.name, tool); } } : undefined; },
    };
    apply(ctx, { baseUrl: "http://kernel-a:6806" });
    const first = await tools.get("memory_write").execute({ type: "fact", project: "*", text: "A库私有内容" });
    assert.equal(first.ok, true);
    await request(handler, "/siyuan/config", { baseUrl: "http://kernel-b:6806" });
    const second = await tools.get("memory_write").execute({ type: "fact", project: "*", text: "B库的新内容" });
    assert.equal(second.ok, true, JSON.stringify(second));
    const found = await tools.get("memory_search").execute({ query: "A库私有内容" });
    assert.deepEqual(found.results, []);
    assert.ok(calls.some((entry) => entry.group === "b" && entry.api.endsWith("/lsNotebooks")));
    assert.ok(!sections.find((entry) => entry.name === "siyuan-notes-memory").text().includes("A库私有内容"));
  });
});
