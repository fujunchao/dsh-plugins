/**
 * dsh-siyuan-notes — 契约 v8（2026-11-19）
 *
 * 1. 路由：collapse-topic-drift 已下线 → 400 invalid_action；
 * 2. 体检：multiStateProjects 中性统计 + incomplete 未检查清单，不再返回 topicDrift；
 * 3. 面板：不完整时出常驻横幅、「取代关系异常」标未检查、没有任何收敛按钮；
 * 4. memory_distill 的早退理由各自渲染成自己的话。
 *
 * 全部在内存里（假内核 = 真 SQLite / 假 React），不碰真实思源。
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { apply, distillRender } from '../lib/index.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const WS = '/w/proj-a';
const PROJECT = 'proj-a';
const NEW = '20261110120000-0000003';
const MID = '20261110110000-0000002';
const OLD = '20261110100000-0000001';

const SEED = [
  { id: OLD, body: '旧主题的结论\n- 下一步：无\n- 待决：无', type: 'state', project: PROJECT, workspace: WS, topic: '旧主题', status: 'active', confidence: 'stated' },
  { id: MID, body: '中间主题的结论\n- 下一步：无\n- 待决：无', type: 'state', project: PROJECT, workspace: WS, topic: '中间主题', status: 'active', confidence: 'stated' },
  { id: NEW, body: '新主题的结论\n- 下一步：继续\n- 待决：无', type: 'state', project: PROJECT, workspace: WS, topic: '新主题', status: 'active', confidence: 'stated' },
];

async function boot(seed = SEED) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v8-'));
  const saved = { home: process.env.DSH_SIYUAN_NOTES_HOME, fetch: globalThis.fetch, recording: process.env.DSH_SIYUAN_MEMORY_RECORDING };
  process.env.DSH_SIYUAN_NOTES_HOME = dir; delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const backend = memorySqlKernel();
  backend.seed(seed);
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
  const close = async () => {
    for (const dispose of disposers.reverse()) dispose();
    globalThis.fetch = saved.fetch; backend.close();
    if (saved.home === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME; else process.env.DSH_SIYUAN_NOTES_HOME = saved.home;
    if (saved.recording === undefined) delete process.env.DSH_SIYUAN_MEMORY_RECORDING; else process.env.DSH_SIYUAN_MEMORY_RECORDING = saved.recording;
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  };
  return { dir, backend, request, close };
}

test('v8 路由：collapse-topic-drift 已下线，POST 报 400 invalid_action', async () => {
  const p = await boot();
  try {
    const failed = await p.request({ action: 'collapse-topic-drift', project: PROJECT, workspace: WS, keepId: NEW });
    assert.equal(failed.status, 400, JSON.stringify(failed.body));
    assert.equal(failed.body.error.code, 'invalid_action', JSON.stringify(failed.body));
    assert.equal(failed.body.error.message.includes('collapse-topic-drift'), false, '动作清单里不该再提它');
    const info = await p.request(undefined, '/siyuan/memory', 'GET');
    assert.equal(info.body.value.memoryContractVersion, 10);
  } finally { await p.close(); }
});

test('v8 体检：只给中性统计 multiStateProjects，不再返回 topicDrift', async () => {
  const p = await boot();
  try {
    const report = (await p.request(undefined, '/siyuan/memory?view=checkup', 'GET')).body.value;
    assert.equal('topicDrift' in report, false, 'v8 起不再返回 topicDrift');
    assert.deepEqual(report.incomplete, [], '三条样本完整，不该有未检查项');
    assert.equal(typeof report.libraryTotal, 'number', '面板横幅要能说出全库条数');
    assert.ok(report.libraryTotal >= 3, '全库总数至少是这次的 3 条：' + report.libraryTotal);
    assert.equal(report.multiStateProjects.length, 1);
    const group = report.multiStateProjects[0];
    assert.equal(group.project, PROJECT);
    assert.deepEqual(group.topics.map(item => item.topic).sort(), ['中间主题', '新主题', '旧主题'].sort());
    for (const item of group.topics) assert.ok(item.id && item.created, JSON.stringify(item));
    // 只统计：三条状态一个都不能被改。
    const entries = (await p.request(undefined, '/siyuan/memory?view=entries&limit=200', 'GET')).body.value.entries;
    assert.equal(entries.filter(entry => entry.status === 'active').length, 3);
  } finally { await p.close(); }
});

test('v8 体检：扫描窗口不完整时 incomplete 显式标出，而不是把「没查」渲染成 0', async () => {
  const many = Array.from({ length: 201 }, (_, index) => ({
    id: '20261110120000-' + String(index).padStart(7, '0'),
    body: '事实第' + index + '条',
    type: 'fact', project: PROJECT, workspace: WS, topic: '', status: 'active', confidence: 'stated',
  }));
  // 块 id 必须是 14 位时间戳 + '-' + 7 位（201 条 → 撑满 maxListLimit=200）。
  const p = await boot(many);
  try {
    const report = (await p.request(undefined, '/siyuan/memory?view=checkup', 'GET')).body.value;
    assert.equal(report.complete, false, '201 条超过 maxListLimit=200，必须报不完整');
  assert.equal(report.libraryTotal, 201, '横幅要报全库 201 条，而不是只报窗口 200');
    assert.deepEqual(report.incomplete, ['brokenChains.missing-target']);
  } finally { await p.close(); }
});

// ---------------------------------------------------------------- 面板

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
    if (url.includes('view=checkup')) return checkup;
    if (url.includes('view=entries')) return { entries: [], complete: true };
    if (url.includes('view=receipts')) return { entries: [] };
    return { catalog: [] };
  };
  const fetch = async (url, init) => {
    calls.push({ url: url, init: init });
    if (init?.method === 'POST') return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: {} }) };
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
  return { nodes: walk(), calls: calls };
}

const CHECKUP = {
  complete: false, scannedLimit: 200, total: 200, active: 150,
  duplicates: [], similar: [], staleStates: [], brokenChains: [], archiveCandidates: [],
  libraryTotal: 397,
  multiStateProjects: [{ project: PROJECT, workspace: WS, topics: [
    { id: NEW, topic: '新主题', created: '20261110120000', statement: '新主题的结论' },
    { id: MID, topic: '中间主题', created: '20261110110000', statement: '中间主题的结论' },
  ] }],
  incomplete: ['brokenChains.missing-target'],
};
const textOf = nodes => nodes.map(node => (typeof node.children?.[0] === 'string' ? node.children[0] : '')).join(' | ');

test('v8 面板：不完整时出常驻横幅、未检查项有标注，且没有任何收敛入口', async () => {
  const panel = await renderPanel({ checkup: CHECKUP });
  const text = textOf(panel.nodes);
  assert.ok(text.includes('只检查了最近 200 条'), '不完整要常驻可见：' + text);
  assert.ok(text.includes('全库共 397 条'), '横幅要带全库分母：' + text);
  assert.ok(text.includes('不代表全库'), text);
  assert.ok(text.includes('取代目标是否还存在'), '未检查项要说清缺的是哪一条：' + text);
  assert.ok(text.includes('同项目多任务状态：1 组'), text);
  assert.ok(text.includes('无需清理'), '统计要说明这是常态：' + text);
  assert.equal(text.includes('主题漂移'), false, '漂移区块已下线：' + text);
  assert.equal(text.includes('只保留最新'), false, '收敛按钮已下线：' + text);
  assert.equal(panel.nodes.some(node => node.type === 'button' && node.children[0] === '只保留最新'), false);
  assert.equal(panel.calls.some(call => call.init?.method === 'POST'), false, '渲染期间不许写库');
});

test('v8 面板：样本完整时不渲染横幅', async () => {
  const panel = await renderPanel({ checkup: { ...CHECKUP, complete: true, scannedLimit: 200, total: 3, active: 3, incomplete: [] } });
  const text = textOf(panel.nodes);
  assert.equal(text.includes('只检查了最近'), false, text);
  assert.equal(text.includes('另有未检查项'), false, text);
});

// ---------------------------------------------------------------- distill 渲染

test('v8：memory_distill 的早退理由不再冒充「没有值得记住的」', () => {
  const text = reason => distillRender({}, { ok: true, written: 0, reason }).map(part => part.text).join('\n');
  assert.match(text('cooldown'), /冷却/u);
  assert.match(text('没有新增内容'), /没有新的对话内容/u);
  assert.match(text('子代理不自动整理'), /子代理会话不自动整理/u);
  assert.match(text('宿主处于只读模式'), /宿主处于只读模式/u);
  for (const reason of ['cooldown', '没有新增内容', '子代理不自动整理']) {
    assert.equal(/没有找到值得长期记住/u.test(text(reason)), false, '不能再说成「没有值得记的」：' + reason);
  }
  // 没有 reason 时保留原来的兜底文案。
  assert.match(text(undefined), /没有找到值得长期记住/u);
});
