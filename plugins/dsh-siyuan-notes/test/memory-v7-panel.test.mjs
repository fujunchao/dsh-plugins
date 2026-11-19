/**
 * dsh-siyuan-notes — 契约 v7 / A：「主题漂移」可见 + 一键收敛（路由 + 面板）。
 *
 * 两层：
 * 1. **路由**：假内核（真 SQLite）驱动真实 apply()，POST {action:'collapse-topic-drift'}；
 * 2. **面板**：假 React + 假 fetch 渲染 MemoryPage，断言体检区块、二次确认行与 POST 参数。
 *
 * 全部在内存里，不碰真实思源。
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { apply } from '../lib/index.js';
import { MEMORY_ATTRS } from '../lib/memory.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const WS = '/w/proj-a';
const PROJECT = 'proj-a';
const KEEP = '20261110120000-0000003';
const MID = '20261110110000-0000002';
const OLD = '20261110100000-0000001';

/** 三个同项目、同工作区、不同主题、不同创建时间的 active state。 */
// seed() 收的是扁平形状（键名与 MEMORY_ATTRS 同名），不是 {attrs} 包一层。
const SEED = [
  { id: OLD, body: '旧阶段一\n- 下一步：无\n- 待决：无', type: 'state', project: PROJECT, workspace: WS, topic: '旧主题', status: 'active', confidence: 'stated' },
  { id: MID, body: '旧阶段二\n- 下一步：无\n- 待决：无', type: 'state', project: PROJECT, workspace: WS, topic: '中间主题', status: 'active', confidence: 'stated' },
  { id: KEEP, body: '当前阶段\n- 下一步：继续\n- 待决：无', type: 'state', project: PROJECT, workspace: WS, topic: '新主题', status: 'active', confidence: 'stated' },
];

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v7-panel-'));
  const saved = { home: process.env.DSH_SIYUAN_NOTES_HOME, fetch: globalThis.fetch, recording: process.env.DSH_SIYUAN_MEMORY_RECORDING };
  process.env.DSH_SIYUAN_NOTES_HOME = dir; delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const backend = memorySqlKernel();
  const kernel = backend.kernel;
  backend.seed(SEED);
  const registry = new Map(), sections = [], contexts = [], listeners = new Map(), disposers = [];
  let handler;
  globalThis.fetch = async (url, init) => {
    const api = new URL(url).pathname, payload = JSON.parse(init?.body ?? '{}');
    const result = await backend.call(api, payload);
    return Response.json(result.ok ? result.value : { code: -1, msg: result.error.message });
  };
  const ctx = {
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    systemPrompt: { section(value) { sections.push(value); return () => {}; }, context(value) { contexts.push(value); return () => {}; } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
    inject(_deps, fn) { return fn(ctx); },
    on(event, fn) { listeners.set(event, fn); return () => listeners.delete(event); },
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
  const entries = async query => (await request(undefined, '/siyuan/memory?view=entries&limit=200' + (query ?? ''), 'GET')).body.value.entries;
  const close = async () => {
    for (const dispose of disposers.reverse()) dispose();
    globalThis.fetch = saved.fetch; backend.close();
    if (saved.home === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME; else process.env.DSH_SIYUAN_NOTES_HOME = saved.home;
    if (saved.recording === undefined) delete process.env.DSH_SIYUAN_MEMORY_RECORDING; else process.env.DSH_SIYUAN_MEMORY_RECORDING = saved.recording;
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  };
  return { dir, kernel, request, entries, close };
}

// ---------------------------------------------------------------- 路由

test('v7-A：POST collapse-topic-drift 200，只作废比 keep 更旧的同主题状态', async () => {
  const p = await boot();
  try {
    const before = await p.entries('&status=active');
    const keepRow = before.find(item => item.id === KEEP);
    assert.ok(keepRow, '保留项必须先在索引里');
    const trimmed = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: KEEP, expectedRevision: keepRow.revision });
    assert.equal(trimmed.status, 200, JSON.stringify(trimmed.body));
    assert.deepEqual(trimmed.body.value.superseded, [OLD, MID], '旧的先作废、按创建时间升序');
    assert.equal(trimmed.body.value.kept.topic, '新主题');
    const after = await p.entries();
    const byId = Object.fromEntries(after.map(item => [item.id, item]));
    assert.equal(byId[KEEP].status, 'active', '保留项仍然有效');
    assert.equal(byId[KEEP].supersedes.split(',').sort().join(), [OLD, MID].sort().join(), '取代链两端都要写');
    for (const id of [OLD, MID]) {
      assert.equal(byId[id].status, 'superseded', id + ' 应被作废');
      assert.equal(byId[id].supersededBy, KEEP, id + ' 必须记录被谁取代');
    }
  } finally { await p.close(); }
});

test('v7-A：再点一次是幂等的 200 + noDrift，不改任何数据', async () => {
  const p = await boot();
  try {
    await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: KEEP });
    const again = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: KEEP });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.value.noDrift, true);
    assert.deepEqual(again.body.value.superseded, []);
    const after = await p.entries();
    assert.equal(after.filter(item => item.status === 'active').length, 1);
  } finally { await p.close(); }
});

test('v7-A：失败路径原样返回错误码（invalid_keep / revision_conflict / scope_mismatch）', async () => {
  const p = await boot();
  try {
    const badShape = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: 'not-an-id' });
    assert.equal(badShape.status, 400);
    assert.equal(badShape.body.error.code, 'invalid_keep', JSON.stringify(badShape.body));
    const wrongType = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: '20261110120000-0000009' });
    assert.equal(wrongType.status, 400, '不存在的 id 也应是 400');
    const keepRow = (await p.entries('&status=active')).find(item => item.id === KEEP);
    const staleRevision = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: KEEP, expectedRevision: 'outdated' });
    assert.equal(staleRevision.status, 400);
    assert.equal(staleRevision.body.error.code, 'revision_conflict', JSON.stringify(staleRevision.body));
    const wrongProject = await p.request({ action: 'collapse-topic-drift', project: 'other', workspace: WS, keepId: KEEP, expectedRevision: keepRow.revision });
    assert.equal(wrongProject.status, 400);
    assert.equal(wrongProject.body.error.code, 'scope_mismatch', JSON.stringify(wrongProject.body));
    // 参数全套合法但内核写属性失败 → 事务回滚，一条都不许变。
    p.kernel.state.failAttrs = true;
    const failed = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: KEEP });
    assert.equal(failed.status, 400, JSON.stringify(failed.body));
    assert.ok(failed.body.error.code, JSON.stringify(failed.body));
    const after = await p.entries('&status=active');
    assert.equal(after.length, 3, '回滚后三条仍是 active：' + JSON.stringify(after.map(item => item.id)));
  } finally { await p.close(); }
});

// ---------------------------------------------------------------- 面板

/** 假 React + 假 fetch 渲染 MemoryPage；rerender() 用同一份状态再渲染一次（模拟 setState 后的重渲染）。 */
async function renderPanel(options) {
  const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const checkup = options.checkup;
  const values = [{ catalog: [] }, [], false, null, '', '', '', '', null, null,
    { approval: null, selected: [], body: '', recoveries: null, inspection: null, confirmedMissing: false, checkup: checkup }];
  let cursor = 0, exports;
  const calls = [];
  const React = {
    Component: class {},
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = initial;
      return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
    },
    useEffect: () => {}, useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn,
    useRef: value => ({ current: value }), useSyncExternalStore: (_s, get) => get(),
  };
  const json = url => {
    if (url.includes('view=recording')) return { enabled: true, locked: false, sessions: [] };
    if (url.includes('view=checkup')) return options.afterCheckup ?? checkup;
    if (url.includes('view=entries')) return { entries: [], complete: true };
    if (url.includes('view=receipts')) return { entries: [] };
    return { catalog: [] };
  };
  const fetch = async (url, init) => {
    calls.push({ url: url, init: init });
    if (init?.method === 'POST') return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { id: 'x', superseded: ['a', 'b'], kept: { id: 'x', topic: 't' } } }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: json(url) }) };
  };
  new Function('window', 'document', 'fetch', source)({ __ModuleLoader__: { load({ factory }) { exports = factory(name => (name === 'react' ? React : {})); } } }, { createElement: () => ({ dataset: {} }), head: { appendChild() {} }, querySelector: () => null }, fetch);
  const walk = () => {
    cursor = 0;
    const nodes = [];
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); visit(node.children); };
    visit(exports.__panes.MemoryPage({ t: key => key }));
    return nodes;
  };
  return { nodes: walk(), rerender: walk, calls: calls, values: values };
}

const GROUP = {
  project: PROJECT, workspace: WS,
  topics: [
    { id: KEEP, topic: '新主题', created: '20261110120000', statement: '当前阶段的结论' },
    { id: MID, topic: '中间主题', created: '20261110110000', statement: '中间阶段留下的结论' },
    { id: OLD, topic: '旧主题', created: '20261110100000', statement: '最早那条状态的结论' },
  ],
};
const CHECKUP = { complete: true, scannedLimit: 200, total: 3, active: 3, duplicates: [], similar: [], staleStates: [], brokenChains: [], archiveCandidates: [], topicDrift: [GROUP] };
const textOf = nodes => nodes.map(node => (typeof node.children?.[0] === 'string' ? node.children[0] : '')).join(' | ');
const button = (nodes, label) => nodes.find(node => node.type === 'button' && node.children[0] === label);

test('v7-A 面板：主题漂移区块列出 project、主题数与将被作废的旧状态', async () => {
  const panel = await renderPanel({ checkup: CHECKUP });
  const text = textOf(panel.nodes);
  assert.ok(text.includes('主题漂移'), text);
  assert.ok(text.includes(PROJECT + '（3 个主题）'), text);
  assert.ok(text.includes('保留最新：新主题'), text);
  assert.ok(text.includes('将作废：中间主题'), '要列出将被作废的主题：' + text);
  assert.ok(text.includes('将作废：旧主题'), text);
  // 结论只给 40 字，不整段铺开
  assert.ok(!text.includes('最早那条状态的结论'.repeat(5)), text);
  assert.ok(button(panel.nodes, '只保留最新'), '缺入口按钮');
});

test('v7-A 面板：点「只保留最新」先出二次确认行，确认后才 POST，且 keepId 是最新的那条', async () => {
  const panel = await renderPanel({ checkup: CHECKUP });
  assert.equal(panel.calls.some(call => call.init?.method === 'POST'), false, '未经确认不许发 POST');
  button(panel.nodes, '只保留最新').props.onClick();
  const confirming = panel.rerender();
  const text = textOf(confirming);
  assert.ok(text.includes('确认后会把 2 条旧状态标为「已被取代」'), '二次确认要说清条数：' + text);
  assert.ok(text.includes('中间主题、旧主题'), '二次确认要列出将作废的 topic：' + text);
  const confirm = button(confirming, '确认收敛（2 条）');
  assert.ok(confirm, '要有确认按钮：' + textOf(confirming));
  confirm.props.onClick();
  for (let i = 0; i < 20 && !panel.calls.some(call => call.init?.method === 'POST'); i++) await new Promise(resolve => setImmediate(resolve));
  const posted = panel.calls.find(call => call.init?.method === 'POST');
  assert.ok(posted, '确认后必须发 POST');
  assert.deepEqual(JSON.parse(posted.init.body), { action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: KEEP });
  // 成功后刷新体检
  for (let i = 0; i < 20 && !panel.calls.some(call => String(call.url).includes('view=checkup')); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(panel.calls.some(call => String(call.url).includes('view=checkup')), '收敛后要重新拉体检');
});

test('v7-A 面板：取消不发请求；没有漂移时不渲染该区块', async () => {
  const panel = await renderPanel({ checkup: CHECKUP });
  button(panel.nodes, '只保留最新').props.onClick();
  const confirming = panel.rerender();
  button(confirming, '取消').props.onClick();
  assert.equal(panel.calls.some(call => call.init?.method === 'POST'), false, '取消不能发 POST');
  const clean = await renderPanel({ checkup: { ...CHECKUP, topicDrift: [] } });
  assert.ok(!textOf(clean.nodes).includes('主题漂移'), '没有漂移就别渲染这一块');
});
