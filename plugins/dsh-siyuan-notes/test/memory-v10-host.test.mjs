/**
 * dsh-siyuan-notes — 契约 v10（宿主半）：候选成组作废、entries 视图、读计数门禁、对账批量化、落点。
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { apply, writeRender } from '../lib/index.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const WS = '/w/proj-a';
const PROJECT = 'proj-a';
const scope = { workspace: WS, project: PROJECT, projects: ['*', PROJECT], projectRoots: { [PROJECT]: WS } };
const spec = { scope, project: PROJECT, source: 'fixture:v10' };
const stateBody = text => text + '\n- 下一步：继续\n- 待决：无';
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v10-'));
  const saved = { home: process.env.DSH_SIYUAN_NOTES_HOME, fetch: globalThis.fetch, recording: process.env.DSH_SIYUAN_MEMORY_RECORDING };
  process.env.DSH_SIYUAN_NOTES_HOME = dir; delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const backend = memorySqlKernel();
  const registry = new Map(), disposers = [];
  let handler;
  globalThis.fetch = async (url, init) => {
    const api = new URL(url).pathname, payload = JSON.parse(init?.body ?? '{}');
    const result = await backend.call(api, payload);
    return Response.json(result.ok ? result.value : { code: -1, msg: result.error.message });
  };
  const ctx = {
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    systemPrompt: { section() { return () => {}; }, context() { return () => {}; } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
    inject(_deps, fn) { return fn(ctx); },
    on() { return () => {}; },
    get(name) {
      if (name === 'tools') return { register(tool) { registry.set(tool.name, tool); return () => {}; } };
      if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 100 }) };
      if (name === 'llm') return { stream: async function* () { yield { type: 'text-delta', text: '[]' }; } };
    },
  };
  apply(ctx, { baseUrl: 'http://fake.invalid:6806', token: '' });
  const request = async (body, url = '/siyuan/memory', method = 'POST') => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url });
    const res = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
    await handler(req, res); return res;
  };
  const close = async () => {
    for (const dispose of disposers.reverse()) dispose();
    globalThis.fetch = saved.fetch; backend.close();
    if (saved.home === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME; else process.env.DSH_SIYUAN_NOTES_HOME = saved.home;
    if (saved.recording === undefined) delete process.env.DSH_SIYUAN_MEMORY_RECORDING; else process.env.DSH_SIYUAN_MEMORY_RECORDING = saved.recording;
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  };
  return { request, close, backend, tools: registry };
}

test('v10 候选：确认最新一条时，同主题的其它候选一并作废', async () => {
  const backend = memorySqlKernel();
  const store = backend.makeStore();
  try {
    const ids = [];
    for (const version of ['第一版', '第二版', '第三版', '第四版']) {
      const written = value(await store.write({ ...spec, type: 'state', topic: 'release', body: stateBody(version), confidence: 'inferred' }));
      assert.equal(written.status, 'candidate', JSON.stringify(written));
      ids.push(written.id);
    }
    const listed = value(await store.list({ status: 'candidate' })).entries;
    assert.equal(listed.length, 4, '四条候选应该并存');
    const newest = listed.find(entry => entry.id === ids[3]);
    const approved = value(await store.approve({ id: newest.id, expectedRevision: newest.revision, confidence: 'stated' }));
    assert.equal(approved.status, 'active');
    assert.deepEqual(approved.supersededCandidates.sort(), ids.slice(0, 3).sort(), '其余三条候选要被一并作废：' + JSON.stringify(approved));
    const after = value(await store.list({})).entries;
    assert.equal(after.filter(entry => entry.status === 'active').length, 1, '同主题只留一条有效');
    assert.equal(after.filter(entry => entry.status === 'candidate').length, 0, '不能再留候选');
    assert.equal(after.filter(entry => entry.status === 'superseded').length, 3);
  } finally { store.dispose(); backend.close(); }
});

test('v10 视图：entries 带 byStatus 与 candidates，并支持 offset 分页', async () => {
  const p = await boot();
  try {
    const store = p.backend.makeStore();
    for (let index = 0; index < 3; index++) {
      value(await store.write({ ...spec, type: 'fact', body: '有效事实第' + index + '条' }));
    }
    value(await store.write({ ...spec, type: 'fact', confidence: 'inferred', body: '一条推断' }));
    const listed = (await p.request(undefined, '/siyuan/memory?view=entries&limit=2', 'GET')).body.value;
    assert.equal(listed.byStatus.active, 3, JSON.stringify(listed.byStatus));
    assert.equal(listed.byStatus.candidate, 1);
    assert.equal(listed.candidates.length, 1, '候选单独带一批，不受窗口影响');
    assert.equal(listed.candidates[0].body.includes('一条推断'), true);
    assert.equal(listed.offset, 0);
    assert.equal(listed.entries.length, 2, '第一页就该是 limit 条');
    assert.equal(listed.hasMore, true, '还有下一页');
    const next = (await p.request(undefined, '/siyuan/memory?view=entries&limit=2&offset=2', 'GET')).body.value;
    assert.equal(next.offset, 2);
    assert.equal(next.entries.length, 2, '第二页要真的取到剩下的 2 条（不能因为二次 offset 变成 0 条）');
    assert.equal(next.hasMore, false, '最后一页');
    assert.equal(next.candidates, undefined, '分页时不重复带候选');
  } finally { await p.close(); }
});

test('v10 列表：limit=200 时分页真值（探针上限放行 +1，250 条数据）', async () => {
  const f = memorySqlKernel();
  try {
    f.seed(Array.from({ length: 250 }, (_, index) => ({
      id: '20261110120000-' + String(index).padStart(7, '0'),
      body: '分页事实第' + index + '条',
      created: '20261110120000',
      type: 'fact', project: PROJECT, workspace: WS, topic: '', status: 'active', confidence: 'stated',
    })));
    const store = f.makeStore();
    const page1 = value(await store.list({ limit: 200 }));
    assert.equal(page1.entries.length, 200, '第一页 200 条');
    assert.equal(page1.hasMore, true, '后面还有 50 条，不能报「已全部加载」');
    assert.equal(page1.complete, false);
    const page2 = value(await store.list({ limit: 200, offset: 200 }));
    assert.equal(page2.entries.length, 50, '第二页 50 条（不是 0 条）');
    assert.equal(page2.hasMore, false);
    assert.equal(page2.complete, true);
  } finally { f.close(); }
});

test('v10 渲染：记忆写入回执要有「落点：项目 @ 工作区」一行', () => {
  const out = writeRender({ type: 'fact', text: '写入的一条', project: PROJECT }, {
    ok: true, id: '20261110120000-0000001', status: 'active', duplicate: false,
    placement: { project: PROJECT, workspace: WS, global: false, reason: 'explicit' },
  });
  const text = out.map(part => part.text).join('\n');
  assert.ok(text.includes('落点：' + PROJECT + ' @ ' + WS + '（指定项目）'), text);
  const global = writeRender({ type: 'fact', text: '全局的一条' }, { ok: true, id: 'x', status: 'active', placement: { project: '*', workspace: '*', global: true, reason: 'global' } });
  assert.ok(global.map(part => part.text).join('\n').includes('落点：* @ 所有工作区（显式全局）'), '全局落点不许写成「所有工作区（所有工作区）」');
});
test('v10 视图：view=scopes 返回项目与工作区候选值', async () => {
  const p = await boot();
  try {
    const store = p.backend.makeStore();
    value(await store.write({ ...spec, type: 'fact', body: '一条事实' }));
    const scopes = (await p.request(undefined, '/siyuan/memory?view=scopes', 'GET')).body.value;
    assert.deepEqual(scopes.projects, [PROJECT]);
    assert.deepEqual(scopes.workspaces, [WS]);
  } finally { await p.close(); }
});

test('v10 读：关闭记录时 counted=0 且不写入引用计数', async () => {
  const backend = memorySqlKernel();
  const store = backend.makeStore();
  try {
    const written = value(await store.write({ ...spec, type: 'fact', body: '要读的一条' }));
    const blocked = value(await store.read([written.id], { canWrite: () => false }));
    assert.equal(blocked.counted, 0, '关闭记录后不该写库');
    assert.equal(value(await store.list({})).entries[0].refcount, 0, '引用计数保持 0');
    const allowed = value(await store.read([written.id], { canWrite: () => true }));
    assert.equal(allowed.counted, 1);
    assert.equal(value(await store.list({})).entries[0].refcount, 1, '打开记录时 +1');
  } finally { store.dispose(); backend.close(); }
});

test('v10 对账：20 个未变化的 id 只发 1 次内核查询（原来 40 次）', async () => {
  const backend = memorySqlKernel();
  const store = backend.makeStore();
  try {
    const ids = [];
    for (let index = 0; index < 20; index++) ids.push(value(await store.write({ ...spec, type: 'fact', body: '对账条目' + index })).id);
    let calls = 0;
    const original = backend.call;
    backend.call = async (...args) => { calls += 1; return original(...args); };
    // 测试里 store 已经拿住原始 call，这里重新建一个用包装后的 call。
    const wrapped = backend.makeStore();
    calls = 0;
    const result = value(await wrapped.reconcile(ids));
    assert.equal(result.entries.length, 20);
    assert.ok(calls <= 2, '20 个 id 对账最多 2 次内核请求，实际 ' + calls);
    wrapped.dispose();
  } finally { backend.close(); }
});

test('v10 列表：order=oldest 时最老的在前（候选积压先处理）', async () => {
  const backend = memorySqlKernel();
  const store = backend.makeStore();
  try {
    for (const version of ['最老', '中间', '最新']) {
      value(await store.write({ ...spec, type: 'fact', confidence: 'inferred', body: '候选-' + version }));
    }
    const oldest = value(await store.list({ status: 'candidate', limit: 20, order: 'oldest' })).entries;
    assert.equal(oldest.length, 3);
    assert.equal(oldest[0].body.includes('最老'), true, '最老的必须排第一：' + oldest.map(item => item.body).join(' / '));
    const newest = value(await store.list({ status: 'candidate', limit: 20 })).entries;
    assert.equal(newest[0].body.includes('最新'), true, '默认仍是最新在前');
  } finally { store.dispose(); backend.close(); }
});

test('v10 候选：同项目候选超过 200 条时，兄弟不会被窗口漏掉（SQL 下推）', async () => {
  const f = memorySqlKernel();
  try {
    // 205 条别的项目的候选（created 更新，会占满旧的 200 条窗口），加 4 条同主题兄弟。
    const others = Array.from({ length: 205 }, (_, index) => ({
      id: '2026120' + String(index % 10) + '120000-' + String(index).padStart(7, '0'),
      body: '别项目候选' + index + '\n- 下一步：无\n- 待决：无',
      created: '20261201120000',
      type: 'state', project: 'other', workspace: '/w/other', topic: 'topic-' + index, status: 'candidate', confidence: 'inferred', source: 'seed',
    }));
    const siblings = Array.from({ length: 4 }, (_, index) => ({
      id: '20261110120000-' + String(900 + index).padStart(7, '0'),
      body: '同主题候选第' + index + '版\n- 下一步：无\n- 待决：无',
      created: '2026111012000' + index,
      type: 'state', project: PROJECT, workspace: WS, topic: 'release', status: 'candidate', confidence: 'inferred', source: 'seed',
    }));
    f.seed([...others, ...siblings]);
    const store = f.makeStore();
    const newest = value(await store.list({ type: 'state', status: 'candidate', project: PROJECT, limit: 50 })).entries[0];
    const approved = value(await store.approve({ id: newest.id, expectedRevision: newest.revision, confidence: 'stated' }));
    assert.equal(approved.supersededCandidates.length, 3, '同项目兄弟必须全部处理，不能被 200 条窗口挡住：' + JSON.stringify(approved));
    assert.equal(value(await store.list({ project: PROJECT })).entries.filter(item => item.status === 'candidate').length, 0);
  } finally { f.close(); }
});

test('v10 候选：窗口真的不够时报 candidatesTruncated', async () => {
  const f = memorySqlKernel();
  try {
    const many = Array.from({ length: 205 }, (_, index) => ({
      id: '20261110120000-' + String(index).padStart(7, '0'),
      body: '同主题候选' + index + '\n- 下一步：无\n- 待决：无',
      created: '20261110120000',
      type: 'state', project: PROJECT, workspace: WS, topic: 'release', status: 'candidate', confidence: 'inferred', source: 'seed',
    }));
    f.seed(many);
    const store = f.makeStore();
    const newest = value(await store.list({ type: 'state', status: 'candidate', project: PROJECT, order: 'oldest', limit: 50 })).entries[0];
    const approved = value(await store.approve({ id: newest.id, expectedRevision: newest.revision, confidence: 'stated' }));
    assert.equal(approved.candidatesTruncated, true, '超过单次扫描上限必须如实报告：' + JSON.stringify(approved));
    assert.ok(approved.supersededCandidates.length <= 5);
  } finally { f.close(); }
});

test('v10 候选：没有 source 的历史候选也能确认（兜底 panel:approve）', async () => {
  const f = memorySqlKernel();
  try {
    f.seed([{ id: '20261110120000-0000777', body: '历史候选\n- 下一步：无\n- 待决：无', created: '20261110120000', type: 'state', project: PROJECT, workspace: WS, topic: 'legacy', status: 'candidate', confidence: 'inferred' }]);
    const store = f.makeStore();
    const candidate = value(await store.list({ status: 'candidate' })).entries[0];
    const approved = value(await store.approve({ id: candidate.id, expectedRevision: candidate.revision, confidence: 'stated' }));
    assert.equal(approved.status, 'active');
  } finally { f.close(); }
});

test('v10 清理：retainedReasons 分类（incomplete / recent / fingerprint）', async () => {
  const NOW = 1_791_000_000_000;
  const receipts = {
    store: [
      { key: 'k-incomplete', id: '20261110120000-0000881', complete: false, phase: 'committed', created: '20261101120000' },
      { key: 'k-recent', id: '20261110120000-0000882', complete: true, phase: 'complete', completedAt: NOW },
      { key: 'k-fingerprint', id: '20261110120000-0000883', complete: true, phase: 'complete', completedAt: 0 },
    ],
    list: async () => receipts.store,
    set: async () => {},
    delete: async () => {},
  };
  const f = memorySqlKernel({ receipts, now: () => NOW });
  try {
    const result = value(await f.makeStore().cleanupReceipts());
    assert.equal(result.retained, 3);
    assert.deepEqual(result.retainedReasons, { incomplete: 1, recent: 1, fingerprint: 1, limit: 0 });
  } finally { f.close(); }
});

test('v10 落点：写入回执带 placement（项目 / 工作区 / 是否全局）', async () => {
  const backend = memorySqlKernel();
  const store = backend.makeStore();
  try {
    const local = value(await store.write({ ...spec, type: 'fact', body: '项目内的一条' }));
    assert.deepEqual(local.placement, { project: PROJECT, workspace: WS, global: false }, JSON.stringify(local.placement));
    const global = value(await store.write({ ...spec, type: 'fact', project: '*', global: true, body: '全局的一条' }));
    assert.equal(global.placement.global, true, JSON.stringify(global.placement));
    assert.equal(global.placement.project, '*');
  } finally { store.dispose(); backend.close(); }
});