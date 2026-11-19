// 契约 v5 端到端回归：全部按宿主真实调用顺序驱动 apply() 接线，断言「最终发给模型的文本」和「宿主会不会拒收工具结果」。
// 宿主每个模型步骤对同一个 context 求值三次：assemble() 调提供者 → system-prompt/assemble waterfall →
// 发请求前 refreshContext() 再调一次提供者，最后一次的返回值才发给模型（见 notes/memory-recheck-2026-11-11.md F1）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';
import { recallTerms } from '../lib/memory.js';
import { memoryKernel } from './helpers/memory-kernel.mjs';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

/** 与宿主一致的无损 JSON 校验：任何 undefined 属性都会让整个工具结果被拒。 */
function assertLossless(value, at = 'output') {
  if (value === undefined) throw new Error('undefined at ' + at);
  if (value === null || ['boolean', 'string'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite at ' + at); return; }
  if (typeof value !== 'object') throw new Error(typeof value + ' at ' + at);
  if (Array.isArray(value)) { value.forEach((item, index) => assertLossless(item, `${at}[${index}]`)); return; }
  for (const [key, item] of Object.entries(value)) assertLossless(item, `${at}.${key}`);
}

async function boot({ sql = false, rewrite } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-v5-'));
  const saved = { home: process.env.DSH_SIYUAN_NOTES_HOME, fetch: globalThis.fetch, recording: process.env.DSH_SIYUAN_MEMORY_RECORDING };
  process.env.DSH_SIYUAN_NOTES_HOME = dir; delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const backend = sql ? memorySqlKernel() : null;
  const kernel = backend ? backend.kernel : memoryKernel();
  const call = backend ? backend.call : kernel.call;
  const registry = new Map(), sections = [], contexts = [], listeners = new Map(), disposers = [], prompts = [];
  let handler, distillOutput = '[]';
  globalThis.fetch = async (url, init) => {
    const api = new URL(url).pathname, payload = JSON.parse(init?.body ?? '{}');
    // 模拟思源入库改写正文（成对单波浪线变下标等）。
    if (rewrite && api.endsWith('/appendBlock')) payload.data = rewrite(payload.data);
    const result = await call(api, payload);
    return Response.json(result.ok ? result.value : { code: -1, msg: result.error.message });
  };
  const ctx = {
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    systemPrompt: { section(value) { sections.push(value); return () => {}; }, context(value) { contexts.push(value); return () => {}; } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
    inject(_deps, fn) { return fn(ctx); }, on(event, fn) { listeners.set(event, fn); return () => listeners.delete(event); },
    get(name) {
      if (name === 'tools') return { register(tool) { registry.set(tool.name, tool); return () => {}; } };
      if (name === 'tokenMeter') return { contextPressure: session => ({ pressureTokens: (session.ratio ?? .1) * 100, contextWindow: 100 }) };
      if (name === 'llm') return { stream: async function* (input) { prompts.push(input.messages[0].content[0].text); yield { type: 'text-delta', text: distillOutput }; } };
    },
  };
  apply(ctx, { baseUrl: 'http://fake.invalid:6806', token: '' });
  const request = async (body, url = '/siyuan/memory', method = 'POST') => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]); Object.assign(req, { method, url });
    const res = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
    await handler(req, res); return res;
  };
  const agent = (id, messages = []) => ({ session: { id, header: { cwd: dir }, messages, deriveMessages() { return this.messages; }, requestHeader: () => ({ config: { provider: 'fake', model: 'fake' } }) } });
  const user = text => ({ role: 'user', content: [{ type: 'text', text }] });
  // 一个模型步骤：返回最终发给模型的常驻索引与每步提示。
  const step = async current => {
    const provided = { sections: sections.map(item => ({ name: item.name, text: item.text({ agent: current }) })), contexts: contexts.map(item => ({ name: item.name, text: item.text({ agent: current }) })) };
    const accepted = await listeners.get('system-prompt/assemble')(provided, { agent: current }, async () => provided);
    const sent = accepted.contexts.map(item => { const provider = contexts.find(entry => entry.name === item.name); return provider ? { name: item.name, text: provider.text({ agent: current }) } : item; });
    return { hint: sent.find(item => item.name === 'siyuan-notes-memory-hint').text, section: accepted.sections.find(item => item.name === 'siyuan-notes-memory').text };
  };
  const tool = async (name, args, current) => { const result = await registry.get(name).execute(args, { agent: current }); assertLossless(result, name); return result; };
  const endTurn = async current => { listeners.get('agent/turn-stopping')({ agent: current }); await new Promise(resolve => setTimeout(resolve, 30)); };
  const entries = async () => (await request(undefined, '/siyuan/memory?view=entries', 'GET')).body.value.entries;
  const close = async () => {
    for (const dispose of disposers.reverse()) dispose();
    globalThis.fetch = saved.fetch; backend?.close();
    if (saved.home === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME; else process.env.DSH_SIYUAN_NOTES_HOME = saved.home;
    if (saved.recording === undefined) delete process.env.DSH_SIYUAN_MEMORY_RECORDING; else process.env.DSH_SIYUAN_MEMORY_RECORDING = saved.recording;
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  };
  return { dir, kernel, control: backend?.control, registry, listeners, prompts, request, agent, user, step, tool, endTurn, entries, close, setDistillOutput: text => { distillOutput = text; } };
}

test('v5：撤销提醒按宿主求值顺序真正送到模型，带结论首句，并在索引仍列着该条时跨轮保留', async () => {
  const p = await boot();
  try {
    const writer = p.agent('writer', [p.user('开始')]), reader = p.agent('reader', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: writer }); await p.step(writer);
    const written = await p.tool('memory_write', { type: 'preference', project: '*', text: '发布前必须手工点检一遍' }, writer);
    assert.equal(written.status, 'active');
    p.listeners.get('agent/created')({ agent: reader });
    assert.ok((await p.step(reader)).section.includes('发布前必须手工点检一遍'));
    const entry = (await p.entries()).find(item => item.id === written.id);
    assert.equal((await p.request({ action: 'revoke', id: written.id, expectedRevision: entry.revision })).status, 200);
    const first = await p.step(reader), again = await p.step(reader);
    assert.match(first.hint, /「发布前必须手工点检一遍」.*已被撤销/u, '本步发给模型的文本里必须有提醒：' + first.hint);
    assert.equal(again.hint, first.hint, '同一轮的后续步骤提醒不丢');
    await p.endTurn(reader);
    const nextTurn = await p.step(reader);
    assert.ok(nextTurn.section.includes('发布前必须手工点检一遍'), '冻结索引不变');
    assert.match(nextTurn.hint, /已被撤销/u, '索引里还列着这条，下一轮继续提醒');
    // 恢复后提醒换成「新增或更新」，播完一轮即收走。
    const revoked = (await p.entries()).find(item => item.id === written.id);
    assert.equal((await p.request({ action: 'restore', id: written.id, expectedRevision: revoked.revision })).status, 200);
    assert.match((await p.step(reader)).hint, /新增或更新/u);
    await p.endTurn(reader);
    assert.equal((await p.step(reader)).hint, '');
  } finally { await p.close(); }
});

test('v5：memory_write 的每一种返回都能通过宿主的无损 JSON 校验（重启后重复写入不再带 undefined）', async () => {
  const p = await boot();
  try {
    const a = p.agent('lossless', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    assert.equal((await p.tool('memory_write', { type: 'fact', project: '*', text: '内核 SQL 没有参数绑定' }, a)).duplicate, false);
    // 模拟「本机没有这条的写入凭据」：迁移来的旧条目、凭据被清理后的条目都是这种情况。
    for (const name of await fs.readdir(path.join(p.dir), { recursive: true })) if (/siyuan-memory-receipts[\\/].+\.json$/u.test(name)) await fs.rm(path.join(p.dir, name), { force: true });
    p.listeners.get('agent/disposed')({ agent: a });
  } finally { await p.close(); }
  // 新实例（等于宿主重启）：凭据目录是新的，同文重写只能靠 SQL 指纹命中。
  const q = await boot();
  try {
    q.kernel.blocks.set('20261109120000-0000099', { id: '20261109120000-0000099', body: '内核 SQL 没有参数绑定', attrs: {} });
    const b = q.agent('lossless-2', [q.user('开始')]);
    q.listeners.get('agent/created')({ agent: b }); await q.step(b);
    const fresh = await q.tool('memory_write', { type: 'fact', project: '*', text: '另一条事实' }, b);
    assert.equal(fresh.duplicate, false);
    // 把刚写入那条的凭据删掉再原样重写：走「无本机凭据」的重复分支。
    for (const name of await fs.readdir(q.dir, { recursive: true })) if (/siyuan-memory-receipts[\\/].+/u.test(name) && name.endsWith('.json')) await fs.rm(path.join(q.dir, name), { force: true });
    const duplicate = await q.tool('memory_write', { type: 'fact', project: '*', text: '另一条事实' }, b);
    assert.equal(duplicate.ok, true, JSON.stringify(duplicate));
    const guessed = await q.tool('memory_write', { type: 'decision', project: '*', text: '也许改用 WAL', confidence: 'inferred' }, b);
    assert.equal(guessed.status, 'candidate');
    const promoted = await q.tool('memory_write', { type: 'decision', project: '*', text: '也许改用 WAL' }, b);
    assert.equal(promoted.promoted, true);
    const state = text => `${text}\n- 下一步：验收\n- 待决：无`;
    await q.tool('memory_write', { type: 'state', project: '*', topic: 'v5', text: state('第一阶段完成') }, b);
    const replaced = await q.tool('memory_write', { type: 'state', project: '*', topic: 'V5', text: state('第二阶段完成') }, b);
    assert.equal(replaced.autoSuperseded, true); assert.equal(replaced.superseded.length, 1);
    await q.tool('memory_search', { query: '阶段' }, b);
    const read = await q.tool('memory_read', { ids: [replaced.id] }, b);
    assert.ok(!('trust' in read.entries[0]) && !('reviewRequired' in read.entries[0]));
  } finally { await q.close(); }
});

test('v5：思源改写正文后，同文重写仍判重，不会每写一次多一块', async () => {
  // 成对的单波浪线被思源存成下标标记——真实库里已经出现过（0.3~1.5s → 0.3<sub>1.5s…</sub>）。
  const rewrite = text => text.replace(/~([^~\n]+)~/gu, '<sub>$1</sub>');
  const p = await boot({ rewrite });
  try {
    const a = p.agent('rewrite', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    const text = '重试间隔 0.3~1.5s，超时 5~8s';
    const first = await p.tool('memory_write', { type: 'fact', project: '*', text }, a);
    assert.equal(first.duplicate, false);
    assert.notEqual(p.kernel.blocks.get(first.id).body, text, '测试内核确实改写了正文');
    for (let round = 0; round < 2; round++) {
      // 清掉本机凭据，逼它走 SQL 指纹这条路。
      for (const name of await fs.readdir(p.dir, { recursive: true })) if (name.includes('siyuan-memory-receipts') && name.endsWith('.json')) await fs.rm(path.join(p.dir, name), { force: true });
      const again = await p.tool('memory_write', { type: 'fact', project: '*', text }, a);
      assert.equal(again.duplicate, true, JSON.stringify(again)); assert.equal(again.id, first.id);
    }
    assert.equal([...p.kernel.blocks.values()].filter(block => block.attrs['custom-mem-type'] === 'fact').length, 1);
  } finally { await p.close(); }
});

test('v5：读回指纹只认「思源改写」，人在思源里改过正文后原文不再算同一条', async () => {
  let clock = 5_000_000; const f = memorySqlKernel({ now: () => clock });
  const scope = { workspace: '/w/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/w/p' } };
  f.control.before = (api, payload) => { if (api.endsWith('/appendBlock')) payload.data = payload.data.replace(/~([^~]+)~/gu, '<sub>$1</sub>'); };
  try {
    const spec = { type: 'fact', project: 'p', scope, source: 'user:test', body: '重试间隔 0.3~1.5s，超时 5~8s' };
    const first = await f.store.write(spec);
    assert.equal(first.ok, true, JSON.stringify(first));
    clock += 60_000;   // 越过写穿缓存的十秒窗口，只剩索引里的指纹可查
    const store = f.makeStore();   // 新实例：没有内存凭据
    const again = await store.write(spec);
    assert.equal(again.value?.duplicate, true, JSON.stringify(again)); assert.equal(again.value.id, first.value.id);
    assert.ok(!('docId' in again.value), '没有凭据时不带 docId 键');
    f.kernel.blocks.get(first.value.id).body = '重试间隔改为 1s';
    clock += 60_000;
    const afterEdit = await f.makeStore().write(spec);
    assert.equal(afterEdit.value?.duplicate, false, JSON.stringify(afterEdit));
  } finally { f.close(); }
});

test('v5：被动召回——用户提到相关话题时，命中的记忆带 id 出现在发给模型的提示里，本轮内不变', async () => {
  const p = await boot({ sql: true });
  try {
    const seed = p.agent('seed', [p.user('开始')]);
    p.listeners.get('agent/created')({ agent: seed }); await p.step(seed);
    // 先写满决策配额，让目标这条不在常驻索引里（常驻索引已有的不重复召回）。
    const pit = await p.tool('memory_write', { type: 'fact', project: '*', text: 'appendBlock 收到多行列表会拆成多个块，必须先连成单块再写入' }, seed);
    for (let index = 0; index < 5; index++) await p.tool('memory_write', { type: 'fact', project: '*', text: `无关事实 ${index}：端口占用排查记录` }, seed);
    const a = p.agent('recall', [p.user('今天天气不错')]);
    p.listeners.get('agent/created')({ agent: a });
    const idle = await p.step(a);
    assert.ok(!idle.section.includes('appendBlock'), '目标条目不在常驻索引里：' + idle.section);
    assert.equal(idle.hint, '', '无关的话不召回任何东西');
    await p.endTurn(a);
    a.session.messages = [...a.session.messages, p.user('帮我看看为什么 appendBlock 写进去的列表变成了好几个块')];
    const first = await p.step(a);
    assert.match(first.hint, /\[相关记忆\]/u, first.hint);
    assert.ok(first.hint.includes(pit.id) && first.hint.includes('appendBlock 收到多行列表'), first.hint);
    assert.ok(first.hint.split('\n').length <= 4, '最多三条');
    assert.equal((await p.step(a)).hint, first.hint, '本轮内保持不变');
    // 思源不可用时不召回、不报错、不拖住装配。
    await p.endTurn(a);
    p.control.before = async () => ({ ok: false, error: { code: 'offline', message: '模拟内核不可达' } });
    a.session.messages = [...a.session.messages, p.user('再说说 appendBlock 的另一个问题')];
    const started = performance.now();
    assert.ok(!(await p.step(a)).hint.includes('[相关记忆]'));
    assert.ok(performance.now() - started < 2500);
  } finally { await p.close(); }
});

test('recallTerms：标识符优先、中文切二元组、过滤虚词，寒暄不产生可用关键词', () => {
  const terms = recallTerms('帮我看看为什么 appendBlock 写进去的列表变成了好几个块').map(term => term.text);
  assert.ok(terms.includes('appendblock')); assert.ok(terms.includes('列表'));
  assert.ok(!terms.includes('帮我') && !terms.includes('什么'));
  assert.ok(recallTerms('').length === 0);
  assert.ok(recallTerms('好的').length === 0);
});

test('v5：自动整理的产出直接生效并标记来源；「不记录」在面板可见、可一键恢复', async () => {
  const p = await boot();
  try {
    const long = '已决定：发布流程改用蓝绿部署，回滚窗口 10 分钟。'.repeat(260);
    const a = p.agent('auto', [p.user(long)]);
    p.listeners.get('agent/created')({ agent: a }); await p.step(a);
    p.setDistillOutput(JSON.stringify([{ type: 'decision', project: '*', text: '发布流程改用蓝绿部署，回滚窗口 10 分钟' }]));
    await p.endTurn(a);
    for (let i = 0; i < 40 && !(await p.entries()).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const [entry] = await p.entries();
    assert.equal(p.prompts.length, 1);
    assert.equal(entry.status, 'active', '整理产出直接生效'); assert.match(entry.source, /^distill:auto#/u);
    // 新会话的常驻索引直接看得到。
    const b = p.agent('next', [p.user('继续')]);
    p.listeners.get('agent/created')({ agent: b });
    assert.ok((await p.step(b)).section.includes('发布流程改用蓝绿部署'));
    // 会话里说了不要记录：面板能看到这个会话，并能恢复。
    b.session.messages = [...b.session.messages, p.user('这次对话不要记录')];
    const blocked = await p.step(b);
    assert.match(blocked.hint, /本会话已停止记录/u);
    assert.equal((await p.tool('memory_write', { type: 'fact', project: '*', text: '不该写入' }, b)).error.code, 'recording_disabled');
    const recording = (await p.request(undefined, '/siyuan/memory?view=recording', 'GET')).body.value;
    assert.deepEqual(recording.sessions.map(item => item.sessionId), ['next']);
    const resumed = await p.request({ action: 'session-recording', sessionId: 'next', enabled: true });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body)); assert.deepEqual(resumed.body.value.sessions, []);
    assert.ok(!(await p.step(b)).hint.includes('已停止记录'), '那句话仍在历史里，但恢复后不再生效');
    assert.equal((await p.tool('memory_write', { type: 'fact', project: '*', text: '恢复后可以写入' }, b)).status, 'active');
    // 普通开发用语不会关掉记录。
    b.session.messages = [...b.session.messages, p.user('登录页不要记住密码，别保存会话 cookie 到 localStorage')];
    assert.ok(!(await p.step(b)).hint.includes('已停止记录'));
  } finally { await p.close(); }
});
