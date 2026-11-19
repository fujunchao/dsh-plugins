/**
 * dsh-siyuan-notes — 契约 v6 阶段 2（P1-1 写入口白名单 / P1-3 面板三处）回归测试。
 *
 * 两个层面都测：
 * 1. **路由与工具层**：用假思源内核驱动真实 apply()，按面板与模型真实的请求顺序打接口；
 * 2. **面板层**：用假 React + 假 fetch 直接渲染 MemoryPage，断言按钮真的换了行为
 *    （缺工作区的候选不再一键确认，而是打开确认弹窗）。
 *
 * 这里不联网、不写真实思源：所有请求都落在内存里的假内核上。
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { apply, MEMORY_WRITE_ARGS, rejectUnknownArgs } from '../lib/index.js';
import { MEMORY_ATTRS } from '../lib/memory.js';
import { memoryKernel } from './helpers/memory-kernel.mjs';

/** 与宿主一致的无损 JSON 校验：任何 undefined 属性都会让整个工具结果被拒。 */
function assertLossless(value, at = 'output') {
  if (value === undefined) throw new Error('undefined at ' + at);
  if (value === null || ['boolean', 'string'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite at ' + at); return; }
  if (typeof value !== 'object') throw new Error(typeof value + ' at ' + at);
  if (Array.isArray(value)) { value.forEach((item, index) => assertLossless(item, at + '[' + index + ']')); return; }
  for (const [key, item] of Object.entries(value)) assertLossless(item, at + '.' + key);
}

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v6-panel-'));
  // 让 resolveMemoryScope 认出一个真实项目：临时目录本身没有项目标记，子目录里放一个。
  await fs.mkdir(path.join(dir, 'proj-a'), { recursive: true });
  await fs.writeFile(path.join(dir, 'proj-a', 'package.json'), '{"name":"proj-a"}\n');
  const saved = { home: process.env.DSH_SIYUAN_NOTES_HOME, fetch: globalThis.fetch, recording: process.env.DSH_SIYUAN_MEMORY_RECORDING };
  process.env.DSH_SIYUAN_NOTES_HOME = dir; delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const kernel = memoryKernel();
  const registry = new Map(), sections = [], contexts = [], listeners = new Map(), disposers = [];
  let handler;
  globalThis.fetch = async (url, init) => {
    const api = new URL(url).pathname, payload = JSON.parse(init?.body ?? '{}');
    const result = await kernel.call(api, payload);
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
  const agent = (id, messages = []) => ({ session: { id, header: { cwd: dir }, messages, deriveMessages() { return this.messages; }, requestHeader: () => ({ config: { provider: 'fake', model: 'fake' } }) } });
  const user = text => ({ role: 'user', content: [{ type: 'text', text }] });
  const step = async current => {
    const provided = { sections: sections.map(item => ({ name: item.name, text: item.text({ agent: current }) })), contexts: contexts.map(item => ({ name: item.name, text: item.text({ agent: current }) })) };
    const accepted = await listeners.get('system-prompt/assemble')(provided, { agent: current }, async () => provided);
    return { section: accepted.sections.find(item => item.name === 'siyuan-notes-memory').text };
  };
  const tool = async (name, args, current) => { const result = await registry.get(name).execute(args, { agent: current }); assertLossless(result, name); return result; };
  const entries = async query => (await request(undefined, '/siyuan/memory?view=entries&limit=200' + (query ?? ''), 'GET')).body.value.entries;
  const close = async () => {
    for (const dispose of disposers.reverse()) dispose();
    globalThis.fetch = saved.fetch;
    if (saved.home === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME; else process.env.DSH_SIYUAN_NOTES_HOME = saved.home;
    if (saved.recording === undefined) delete process.env.DSH_SIYUAN_MEMORY_RECORDING; else process.env.DSH_SIYUAN_MEMORY_RECORDING = saved.recording;
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  };
  return { dir, kernel, registry, listeners, request, agent, user, step, tool, entries, close };
}

const STATE_BODY = progress => progress + '\n- 下一步：观察一小时\n- 待决：无';

// ---------------------------------------------------------------- P1-1 参数校验

test('P1-1：rejectUnknownArgs 点名未知参数与合法参数', () => {
  assert.equal(rejectUnknownArgs('memory_read', { ids: [] }, ['ids']), null);
  const bad = rejectUnknownArgs('memory_write', { supersede: ['x'] }, MEMORY_WRITE_ARGS);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'invalid_arguments');
  assert.ok(bad.error.message.includes('supersede'), bad.error.message);
  assert.ok(bad.error.message.includes('supersedes'), '要列出合法参数：' + bad.error.message);
  // 非对象（undefined / null / 数组）直接放过，不该把「没传参数」当成错误。
  assert.equal(rejectUnknownArgs('memory_read', undefined, ['ids']), null);
  assert.equal(rejectUnknownArgs('memory_read', null, ['ids']), null);
  assert.equal(rejectUnknownArgs('memory_read', ['x'], ['ids']), null);
});

test('P1-1：memory_write 遇到未知键报 invalid_arguments，不再静默忽略', async () => {
  const p = await boot();
  try {
    const a = p.agent('args', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const bad = await p.tool('memory_write', { type: 'fact', project: '*', text: '一条事实', supersede: ['20261109120000-0000001'] }, a);
    assert.equal(bad.ok, false, JSON.stringify(bad));
    assert.equal(bad.error.code, 'invalid_arguments');
    assert.ok(bad.error.message.includes('supersede'));
    assert.equal((await p.entries()).length, 0, '参数不合法时不能写入');
    // 拼错的那个键被点名后，模型会自己改对。
    const good = await p.tool('memory_write', { type: 'fact', project: '*', text: '一条事实' }, a);
    assert.equal(good.ok, true, JSON.stringify(good));
    assert.equal(good.status, 'active');
  } finally { await p.close(); }
});

test('P1-1：statement 作为 text 的别名，两者都缺时报 missing_text 并点名', async () => {
  const p = await boot();
  try {
    const a = p.agent('alias', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const missing = await p.tool('memory_write', { type: 'fact', project: '*' }, a);
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'missing_text');
    assert.ok(missing.error.message.includes('text'), missing.error.message);
    // 模型常从检索结果里照抄 statement。
    const viaStatement = await p.tool('memory_write', { type: 'fact', project: '*', statement: '照抄字段名的正文' }, a);
    assert.equal(viaStatement.ok, true, JSON.stringify(viaStatement));
    const listed = await p.entries();
    assert.ok(listed.some(entry => entry.id === viaStatement.id && entry.statement === '照抄字段名的正文'), JSON.stringify(listed));
  } finally { await p.close(); }
});

test('P1-1：memory_read / memory_search 也拦未知参数', async () => {
  const p = await boot();
  try {
    const a = p.agent('args2', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const readBad = await p.tool('memory_read', { ids: [], id: 'x' }, a);
    assert.equal(readBad.error?.code, 'invalid_arguments', JSON.stringify(readBad));
    assert.ok(readBad.error.message.includes('id'), readBad.error.message);
    const searchBad = await p.tool('memory_search', { q: '压缩' }, a);
    assert.equal(searchBad.error?.code, 'invalid_arguments', JSON.stringify(searchBad));
  } finally { await p.close(); }
});

// ---------------------------------------------------------------- P1-3 面板

test('P1-3：POST action=recording 的回包也带 sessions（与 GET 同形状）', async () => {
  const p = await boot();
  try {
    const blocked = p.agent('blocked', [p.user('这次对话不要记录')]);
    p.listeners.get('agent/created')({ agent: blocked }); await p.step(blocked);
    const shape = Object.keys((await p.request(undefined, '/siyuan/memory?view=recording', 'GET')).body.value).sort();
    const toggled = await p.request({ action: 'recording', enabled: false });
    assert.equal(toggled.status, 200, JSON.stringify(toggled.body));
    assert.deepEqual(Object.keys(toggled.body.value).sort(), shape, 'POST 与 GET 的字段必须一致');
    assert.deepEqual(toggled.body.value.sessions.map(item => item.sessionId), ['blocked']);
    // 关掉再打开，会话列表仍在（面板把这个回包整个塞回 manager.recording）。
    const again = await p.request({ action: 'recording', enabled: true });
    assert.deepEqual(Object.keys(again.body.value).sort(), shape);
  } finally { await p.close(); }
});

test('P1-3：state 候选一键确认成功，同主题的旧 active 被自动取代', async () => {
  const p = await boot();
  try {
    const a = p.agent('state', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const old = await p.tool('memory_write', { type: 'state', project: '*', topic: '发布', text: STATE_BODY('第一阶段完成') }, a);
    assert.equal(old.status, 'active', JSON.stringify(old));
    const candidate = await p.tool('memory_write', { type: 'state', project: '*', topic: '发布', text: STATE_BODY('第二阶段完成'), confidence: 'inferred' }, a);
    assert.equal(candidate.status, 'candidate', JSON.stringify(candidate));
    const row = (await p.entries('&status=candidate')).find(item => item.id === candidate.id);
    // 面板「确认生效」的真实请求：只有 id 与用户看到的 revision，没有 supersedes。
    const approved = await p.request({ action: 'approve', id: candidate.id, expectedRevision: row.revision });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const after = await p.entries();
    assert.equal(after.find(item => item.id === candidate.id).status, 'active');
    const superseded = after.find(item => item.id === old.id);
    assert.equal(superseded.status, 'superseded', JSON.stringify(superseded));
    assert.equal(superseded.supersededBy, candidate.id);
  } finally { await p.close(); }
});

test('P1-3：旧候选没有工作区时，先选范围再确认（不再是一句 invalid_project）', async () => {
  const p = await boot();
  try {
    const a = p.agent('legacy', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const written = await p.tool('memory_write', { type: 'fact', project: 'proj-a', text: '迁移来的旧候选', confidence: 'inferred' }, a);
    assert.equal(written.status, 'candidate', JSON.stringify(written));
    // 模拟历史迁移：条目丢了工作区属性。
    // 注意 list() 会先返回写穿缓存里的副本（带旧 workspace），所以这里用审批入口
    // （走 directEntry 直读属性）来确认这条条目确实已经是「没有工作区」的旧候选。
    delete p.kernel.blocks.get(written.id).attrs[MEMORY_ATTRS.workspace];
    const context = await p.request(undefined, '/siyuan/memory?view=approval&id=' + written.id, 'GET');
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.equal(context.body.value.candidate.workspace, '', '旧候选应当没有工作区');
    // revision 要用审批入口（directEntry 直读）给的那份：list() 里还是写穿缓存的旧副本。
    const revision = context.body.value.candidate.revision;
    // ① 没给范围就点确认：必须是一句能照做的提示，而不是让审批公式自己抛参数错。
    const noScope = await p.request({ action: 'approve', id: written.id, expectedRevision: revision });
    assert.equal(noScope.status, 400);
    assert.equal(noScope.body.error.code, 'workspace_required', JSON.stringify(noScope.body));
    assert.ok(noScope.body.error.message.includes('工作区'), noScope.body.error.message);
    // ② 弹窗里选好项目+工作区再确认 → 200（这就是「先选范围再确认」）。
    const scoped = await p.request({ action: 'approve', id: written.id, expectedRevision: revision, project: 'proj-a', workspace: p.dir });
    assert.equal(scoped.status, 200, JSON.stringify(scoped.body));
    const after = (await p.entries()).find(item => item.id === written.id);
    assert.equal(after.status, 'active');
    assert.ok(after.workspace !== '' && after.workspace !== 'unassigned', JSON.stringify(after));
  } finally { await p.close(); }
});

test('P1-3：普通候选（自带范围）一键确认仍是 200', async () => {
  const p = await boot();
  try {
    const a = p.agent('plain', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const written = await p.tool('memory_write', { type: 'preference', project: '*', text: '提交前跑面板测试', confidence: 'inferred' }, a);
    const row = (await p.entries('&status=candidate')).find(item => item.id === written.id);
    const approved = await p.request({ action: 'approve', id: written.id, expectedRevision: row.revision });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal((await p.entries()).find(item => item.id === written.id).status, 'active');
  } finally { await p.close(); }
});

// ---------------------------------------------------------------- 面板层

/** 用假 React + 假 fetch 渲染 MemoryPage，返回节点树与请求记录。 */
async function renderPanel(options) {
  const candidate = options.candidate, workspace = options.workspace || '';
  const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const values = [{ catalog: [] }, [candidate], false, null, '', '', '', candidate.id, null, null,
    { approval: null, selected: [], body: '', recoveries: null, inspection: null, confirmedMissing: false, workspace: workspace }];
  let cursor = 0;
  const React = {
    Component: class {},
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; },
    useEffect: () => {}, useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn,
    useRef: value => ({ current: value }), useSyncExternalStore: (_s, get) => get(),
  };
  let exports;
  const win = { __ModuleLoader__: { load({ factory }) { exports = factory(name => (name === 'react' ? React : {})); } } };
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: url, init: init });
    const value = url.includes('view=recording') ? { enabled: true, locked: false, sessions: [] }
      : url.includes('view=approval') ? { candidate: candidate, conflicts: [], selection: { project: candidate.project, workspace: candidate.workspace }, topics: [] }
        : url.includes('view=entries') ? { entries: [candidate], complete: true } : { catalog: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: value }) };
  };
  new Function('window', 'document', 'fetch', source)(win, { createElement: () => ({ dataset: {} }), head: { appendChild() {} }, querySelector: () => null }, fetch);
  const tree = exports.__panes.MemoryPage({ t: key => key });
  const nodes = [];
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.children); };
  walk(tree);
  return { nodes: nodes, calls: calls, values: values };
}

test('P1-3：缺工作区的候选不给「确认生效」，按钮改为打开确认弹窗', async () => {
  const legacy = { id: '20261109120000-0000001', statement: '旧候选', body: '旧候选', type: 'fact', project: 'proj-a', workspace: '', status: 'candidate', confidence: 'inferred', revision: 'r1', source: 'migrate', created: '20261109120000' };
  const panel = await renderPanel({ candidate: legacy });
  const labels = panel.nodes.filter(node => node.type === 'button' && typeof node.children[0] === 'string').map(node => node.children[0]);
  assert.ok(labels.includes('选范围后确认'), '缺工作区时应显示「选范围后确认」：' + labels.join(' | '));
  assert.ok(!labels.includes('确认生效'), '缺工作区时不能给一键确认：' + labels.join(' | '));
  assert.ok(!labels.includes('memoryApprove'), '此时主按钮已经是弹窗入口，不该出现第二个同义按钮');
  const open = panel.nodes.find(node => node.type === 'button' && node.children[0] === '选范围后确认');
  open.props.onClick();
  for (let i = 0; i < 20 && !panel.calls.some(call => String(call.url).includes('view=approval')); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(panel.calls.some(call => String(call.url).includes('view=approval')), '点击后应打开确认弹窗（GET view=approval）');
  assert.equal(panel.calls.some(call => call.init?.method === 'POST'), false, '缺范围时不能直接 POST approve');
});

test('P1-3：自带范围的候选仍是「确认生效」+「调整后确认」两个入口', async () => {
  const scoped = { id: '20261109120000-0000002', statement: '普通候选', body: '普通候选', type: 'preference', project: 'proj-a', workspace: '/w/proj-a', status: 'candidate', confidence: 'inferred', revision: 'r2', source: 'tool', created: '20261109120000' };
  const panel = await renderPanel({ candidate: scoped });
  const labels = panel.nodes.filter(node => node.type === 'button' && typeof node.children[0] === 'string').map(node => node.children[0]);
  assert.ok(labels.includes('确认生效'), labels.join(' | '));
  assert.ok(labels.includes('memoryApprove'), '仍要有「调整范围或正文后确认」的入口：' + labels.join(' | '));
});

test('P1-3：面板不再请求死参数 refresh=1', async () => {
  const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  // 注释里保留了这个参数名做说明，所以先把注释行去掉，只看真正会执行的代码。
  const code = source.split(String.fromCharCode(10)).filter(line => {
    const text = line.trim();
    return !text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*');
  }).join(String.fromCharCode(10));
  assert.equal(/[?&]refresh=1/u.test(code), false, 'client 仍在请求 /memory?refresh=1（宿主没有这个分支）');
});

test('契约版本：GET /siyuan/memory 报 memoryContractVersion=10', async () => {
  // 全仓此前没有断言版本号的地方（grep memoryContractVersion 只命中实现与文档），
  // 版本升到 6 却没测试盯着，很容易在后续改动里被悄悄改回去。
  const p = await boot();
  try {
    const info = await p.request(undefined, '/siyuan/memory', 'GET');
    assert.equal(info.status, 200, JSON.stringify(info.body));
    assert.equal(info.body.value.memoryContractVersion, 10);
  } finally { await p.close(); }
});
