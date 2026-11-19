// 2026-11-11 契约：memory_write 写入即生效，memory_confirm / memory_review 两个工具与
// lib/memory-review.js 一起下线。本文件沿用旧「AI 二次确认」用例的覆盖意图，改成断言新契约：
// 一次调用即生效、inferred 落候选、同文重写把候选升级为有效、面板 approve 仍是唯一的人工入口，
// 以及复核模块下线后「历史条目不再因为缺确认哈希被排除」。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { apply, ROUTES } from '../lib/index.js';
import { createMemorySessions } from '../lib/memory-sessions.js';
import { resolveMemoryScope } from '../lib/memory-policy.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

/** 旧用例里固定的审计范围；种子条目按它定位，不需要真文件系统。 */
const scope = { workspace: '/audit/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/audit/p' } };
const user = (text, id = 'user-one') => ({ id, role: 'user', content: [{ type: 'text', text }] });
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
/** 现在的记忆工具清单：复核与自行确认入口已经删掉，不要再长回来。 */
const MEMORY_TOOLS = ['memory_search', 'memory_read', 'memory_write', 'memory_distill'];

/**
 * 真实 apply() 接线：工具注册表 + /siyuan/memory 路由 + 假思源内核。
 * @returns {Promise<{kernel: any, tools: Map<string, any>, agent: any, call: Function, request: Function, sectionText: Function, close: Function}>}
 */
async function boot() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memory-write-effect-'));
  const previous = { home: process.env.DSH_SIYUAN_NOTES_HOME, recording: process.env.DSH_SIYUAN_MEMORY_RECORDING, fetch: globalThis.fetch };
  process.env.DSH_SIYUAN_NOTES_HOME = directory;
  // 环境变量关闭记录会优先于面板开关；用例之间不能互相污染。
  delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const kernel = memorySqlKernel(), tools = new Map(), disposers = [];
  let handler;
  globalThis.fetch = async (url, input) => {
    const result = await kernel.call(new URL(url).pathname, JSON.parse(input?.body ?? '{}'));
    return Response.json(result.ok ? result.value : { code: -1, msg: result.error.message });
  };
  const ctx = {
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    effect(run) { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
    inject(_deps, run) { return run(ctx); },
    on: () => () => {},
    get(name) { return name === 'tools' ? { register(tool) { tools.set(tool.name, tool); return () => {}; } } : undefined; },
  };
  apply(ctx, { baseUrl: 'http://fake.invalid:6806', token: '' });
  const agent = { session: { id: 'ai-agent', header: { cwd: directory }, deriveMessages: () => [user('以后说明都使用简体中文。')] } };
  // 会话解析到的范围与真实会话一致，常驻注入按它筛选条目。
  const sessionScope = await resolveMemoryScope(directory);
  const request = async (body, url = ROUTES.memory, method = 'POST') => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url });
    const res = { writeHead(status) { this.status = status; }, end(text) { this.body = text ? JSON.parse(text) : null; } };
    await handler(req, res);
    return res;
  };
  return {
    kernel, blocks: kernel.kernel.blocks, tools, agent, request,
    call: (tool, args) => tools.get(tool).execute(args, { agent }),
    sectionText: () => kernel.store.sectionText({ scope: sessionScope, force: true }),
    async close() {
      kernel.control.before = null;
      for (const dispose of disposers.reverse()) dispose();
      globalThis.fetch = previous.fetch;
      if (previous.home === undefined) delete process.env.DSH_SIYUAN_NOTES_HOME; else process.env.DSH_SIYUAN_NOTES_HOME = previous.home;
      if (previous.recording === undefined) delete process.env.DSH_SIYUAN_MEMORY_RECORDING; else process.env.DSH_SIYUAN_MEMORY_RECORDING = previous.recording;
      kernel.close();
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

test('实际工具接线：一次 memory_write 即生效，模型不再有二次确认入口', async () => {
  const plugin = await boot();
  try {
    // 旧契约要求模型先 memory_review 拿令牌、再 memory_confirm 才生效；两个工具已删除，
    // 这里同时守住「注册表里不许再出现确认入口」这条边界。
    assert.deepEqual([...plugin.tools.keys()].filter(name => name.startsWith('memory_')), MEMORY_TOOLS);
    assert.ok(!plugin.tools.has('memory_confirm'), '模型不能自行确认记忆');
    assert.ok(!plugin.tools.has('memory_review'), '复核令牌入口已随 memory-review 模块下线');
    const written = await plugin.call('memory_write', { type: 'preference', project: '*', text: '以后说明都使用简体中文' });
    assert.equal(written.ok, true, JSON.stringify(written));
    assert.equal(written.status, 'active', '不传 confidence 也直接生效（默认 stated）');
    assert.equal(written.duplicate, false);
    assert.equal(written.review, undefined, '写入不再返回待核对回执');
    const [entry] = value(await plugin.kernel.store.list({})).entries;
    assert.equal(entry.id, written.id); assert.equal(entry.status, 'active'); assert.equal(entry.confidence, 'stated');
    assert.equal(entry.approvedBy, ''); assert.equal(entry.approvalHash, ''); assert.equal(entry.approvedAt, '');
    assert.equal(entry.reviewRequired, false); assert.equal(entry.trust, 'legacy', '新条目没有确认哈希，trust 只作信息字段');
    // 依据只在「verified」时仍然必需；它不再是一条二次确认的证据链。
    const unverified = await plugin.call('memory_write', { type: 'fact', project: '*', text: '内核支持属性读写', confidence: 'verified' });
    assert.equal(unverified.ok, false); assert.equal(unverified.error.code, 'missing_evidence');
    const verified = await plugin.call('memory_write', { type: 'fact', project: '*', text: '内核支持属性读写', confidence: 'verified', evidence: 'lib/memory.js:1120' });
    assert.equal(verified.ok, true, JSON.stringify(verified)); assert.equal(verified.status, 'active');
    const section = await plugin.sectionText();
    assert.match(section, /偏好：\n- \*\n  - 以后说明都使用简体中文/u, '生效条目直接进入常驻注入（v7 起项目名只在组头写一次）');
    assert.ok(!section.includes(written.id), '注入文本里不再登记条目标识');
  } finally { await plugin.close(); }
});

test('推断必须显式声明：inferred 落候选，同文重写才升级为有效', async () => {
  const plugin = await boot();
  try {
    const stated = await plugin.call('memory_write', { type: 'preference', project: '*', text: '以后说明都使用简体中文' });
    assert.equal(stated.status, 'active', '默认 stated：一次调用即生效');
    const guessed = await plugin.call('memory_write', { type: 'decision', project: '*', text: '发布前先补测试', confidence: 'inferred' });
    assert.equal(guessed.ok, true, JSON.stringify(guessed));
    assert.equal(guessed.status, 'candidate');
    assert.equal(guessed.nextStep.includes('inferred'), true, '候选要在工具结果里说清如何生效');
    let section = await plugin.sectionText();
    assert.match(section, /目录：事实 0 · 决策 0 · 状态 0 · 候选 1。/u, '候选单独计数，不进有效目录');
    assert.match(section, /候选（未核实）：\n- \[\* \| inferred\] 发布前先补测试/u);
    assert.ok(!section.includes('最近决策'), '候选不进入常驻注入的有效清单');
    assert.deepEqual(value(await plugin.kernel.store.search({ query: '发布前先补测试' })).results.map(item => item.id), [guessed.id], '候选仍可被检索命中');
    // 同文再用 stated 写一次：走指纹查重 -> 候选升级，不新增条目。
    const promoted = await plugin.call('memory_write', { type: 'decision', project: '*', text: '发布前先补测试', confidence: 'stated' });
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.promoted, true); assert.equal(promoted.duplicate, false); assert.equal(promoted.id, guessed.id); assert.equal(promoted.status, 'active');
    section = await plugin.sectionText();
    assert.match(section, /目录：事实 0 · 决策 1 · 状态 0 · 候选 0。/u);
    assert.match(section, /最近决策：\n- \*\n  - 发布前先补测试/u, '升级后进入常驻注入');
    assert.equal(value(await plugin.kernel.store.list({})).entries.length, 2, '升级不新增条目');
    const again = await plugin.call('memory_write', { type: 'decision', project: '*', text: '发布前先补测试', confidence: 'stated' });
    assert.equal(again.duplicate, true); assert.equal(again.disposition, 'active_exists'); assert.equal(again.id, guessed.id);
    assert.equal(value(await plugin.kernel.store.list({})).entries.length, 2, '已存在的有效记忆不重复追加');
  } finally { await plugin.close(); }
});

test('取代时版本可选：传了过期版本被拒，不传以当前版本为准；记录关闭后写入与整理一律被拒绝', async () => {
  const plugin = await boot();
  try {
    const first = await plugin.call('memory_write', { type: 'decision', project: '*', text: '后续使用方案 A' });
    assert.equal(first.ok, true, JSON.stringify(first));
    const read = await plugin.call('memory_read', { ids: [first.id] });
    assert.equal(read.ok, true, JSON.stringify(read));
    const revision = read.entries[0].revision;
    const merged = { type: 'decision', project: '*', text: '后续使用方案 B', supersedes: [first.id] };
    const stale = await plugin.call('memory_write', { ...merged, expectedRevisions: { [first.id]: 'stale-revision' } });
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'revision_conflict');
    assert.equal(typeof revision, 'string');
    // 不带版本：以当前版本为准，一次调用完成取代。
    const replaced = await plugin.call('memory_write', merged);
    assert.equal(replaced.ok, true, JSON.stringify(replaced));
    assert.deepEqual(replaced.superseded, [first.id]);
    const [old, current] = (await plugin.call('memory_read', { ids: [first.id, replaced.id] })).entries;
    assert.equal(old.status, 'superseded'); assert.equal(old.supersededBy, replaced.id);
    assert.equal(current.status, 'active'); assert.equal(current.supersedes, first.id);
    assert.ok(!('approvedBy' in current) && !('trust' in current) && !('reviewRequired' in current), '读取结果不再带复核残留字段');
    const disabled = await plugin.request({ action: 'recording', enabled: false });
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    const rejected = await plugin.call('memory_write', { type: 'fact', project: '*', text: '关闭记录后仍想写入' });
    assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'recording_disabled');
    const distilled = await plugin.call('memory_distill', {});
    assert.equal(distilled.ok, false); assert.match(distilled.reason, /已关闭记录/u);
  } finally { await plugin.close(); }
});

test('同主题状态再写一次自动取代旧状态，同一主题始终只有一条有效', async () => {
  const plugin = await boot();
  try {
    const state = title => `${title}\n- 下一步：先补测试再发布\n- 待决：无`;
    const old = await plugin.call('memory_write', { type: 'state', project: '*', topic: 'memory', text: state('旧进度') });
    assert.equal(old.ok, true, JSON.stringify(old));
    // 不需要先查主题、读版本：同主题直接写新状态，旧状态自动标为已被取代。
    const merged = await plugin.call('memory_write', { type: 'state', project: '*', topic: 'memory', text: state('合并后的进度：实现已完成') });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.deepEqual(merged.superseded, [old.id]); assert.equal(merged.autoSuperseded, true);
    const entries = (await plugin.call('memory_read', { ids: [old.id, merged.id] })).entries;
    assert.equal(entries[0].status, 'superseded'); assert.equal(entries[1].supersedes, old.id);
    const third = await plugin.call('memory_write', { type: 'state', project: '*', topic: 'memory', text: state('第三次进度') });
    assert.deepEqual(third.superseded, [merged.id], '连续更新每次只取代当前有效的那一条');
    assert.equal(typeof entries[1].revision, 'string');
  } finally { await plugin.close(); }
});

test('历史条目没有确认哈希仍照常可用，可信度只作信息字段', async () => {
  // 旧契约把「未绑定确认哈希 / 过期」的条目排除在 trusted 之外并打回待复核；
  // 新契约里它们只是 legacy + stale 的信息标注，照样进注入、照样能被检索。
  const kernel = memorySqlKernel();
  try {
    kernel.seed([
      { id: '20200101000000-0000001', type: 'decision', project: 'p', workspace: '/audit/p', confidence: 'verified', status: 'active', source: 'session:old', evidence: '内核日志', body: '旧决定：用 SQLite 保存数据' },
      { id: '20200101000000-0000002', type: 'decision', project: 'p', workspace: '/audit/p', confidence: 'inferred', status: 'active', source: 'session:old', body: '推断结论：也许换 WAL' },
      { id: '20200101000000-0000003', type: 'decision', project: 'q', workspace: '/other/q', confidence: 'stated', status: 'active', source: 'session:other', body: '别的项目决定' },
    ]);
    const listed = value(await kernel.store.list({ scope })).entries;
    assert.deepEqual(listed.map(entry => entry.id).sort(), ['20200101000000-0000001', '20200101000000-0000002']);
    for (const entry of listed) { assert.equal(entry.trust, 'legacy'); assert.equal(entry.stale, true); assert.equal(entry.reviewRequired, false); }
    const section = await kernel.store.sectionText({ scope, force: true });
    assert.match(section, /目录：事实 0 · 决策 2 · 状态 0 · 候选 0。/u, 'legacy 条目照常计入目录');
    assert.match(section, /旧决定：用 SQLite 保存数据/u);
    assert.ok(!/待AI复核|待复核/u.test(section), '注入不再提示复核');
    // trusted 只看 confidence，不再要求确认哈希。
    assert.deepEqual(value(await kernel.store.search({ query: 'SQLite', scope, trusted: true })).results.map(entry => entry.id), ['20200101000000-0000001']);
    assert.deepEqual(value(await kernel.store.search({ query: 'SQLite', scope })).results.map(entry => entry.id), ['20200101000000-0000001']);
    assert.deepEqual(value(await kernel.store.search({ query: 'WAL', scope })).results.map(entry => entry.id), ['20200101000000-0000002'], 'inferred 不是 trusted，但仍可检索');
    assert.deepEqual(value(await kernel.store.search({ query: 'WAL', scope, trusted: true })).results, []);
    assert.deepEqual(value(await kernel.store.search({ query: '别的项目决定', scope })).results, [], '范围过滤仍生效');
    assert.equal(value(await kernel.store.search({ query: '别的项目决定' })).results.length, 1, '显式跨项目检索仍可查到');
  } finally { kernel.close(); }
});

test('整理产出直接生效，只调用一次模型；模型标 inferred 的才落候选，面板 approve 仍是人工入口', async () => {
  const kernel = memorySqlKernel(), prompts = [];
  const agent = { session: { id: 'distill-ai', header: { cwd: scope.workspace }, deriveMessages: () => [user('以后测试报告使用中文。')], requestHeader: () => ({ config: { provider: 'fake', model: 'fake' } }) } };
  const sessions = createMemorySessions({ store: () => kernel.store, resolveScope: async () => scope, getService: name => name === 'llm' ? { stream: async function* (input) {
    prompts.push(input);
    yield { type: 'text-delta', text: JSON.stringify([{ type: 'preference', project: 'p', text: '测试报告使用中文' }, { type: 'preference', project: 'p', text: '也许喜欢深色主题', confidence: 'inferred' }]) };
  } } : undefined });
  try {
    await sessions.start(agent);
    const result = await sessions.distill(agent);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(prompts.length, 1, '只调用一次模型：没有第二次「复核并自动确认」');
    assert.equal(result.written, 2);
    assert.equal(result.entries[0].status, 'active'); assert.equal(result.entries[0].confidence, 'stated');
    assert.equal(result.entries[1].status, 'candidate'); assert.equal(result.entries[1].confidence, 'inferred');
    const listed = value(await kernel.store.list({ scope })).entries;
    const direct = listed.find(item => item.statement === '测试报告使用中文');
    assert.equal(direct.status, 'active'); assert.match(direct.source, /^distill:/u, '来源标记为自动整理，面板据此标注');
    assert.match(await kernel.store.sectionText({ scope, force: true }), /- p\n  - 测试报告使用中文/u, '整理产出直接进入常驻注入');
    const entry = listed.find(item => item.statement === '也许喜欢深色主题');
    assert.equal(entry.status, 'candidate'); assert.equal(entry.approvedBy, '');
    // 面板确认仍是人工入口：候选必须由人给出 confidence 才生效。
    const approved = value(await kernel.store.approve({ id: entry.id, confidence: 'stated', expectedRevision: entry.revision }));
    assert.equal(approved.status, 'active'); assert.equal(approved.approvedBy, undefined, '确认主体不冒充人工');
    assert.match(await kernel.store.sectionText({ scope, force: true }), /- p\n  - 也许喜欢深色主题/u);
  } finally { sessions.dispose(); kernel.close(); }
});

test('整理不重复追加：同一批不重复处理，同文已在库里只回 duplicate', async () => {
  const kernel = memorySqlKernel(), prompts = [];
  const agent = { session: { id: 'distill-duplicate', header: { cwd: scope.workspace }, deriveMessages: () => [user('以后测试报告使用中文。')], requestHeader: () => ({ config: { provider: 'fake', model: 'fake' } }) } };
  const sessions = createMemorySessions({ store: () => kernel.store, resolveScope: async () => scope, getService: name => name === 'llm' ? { stream: async function* (input) {
    prompts.push(input);
    yield { type: 'text-delta', text: JSON.stringify([{ type: 'preference', project: 'p', text: '测试报告使用中文' }]) };
  } } : undefined });
  try {
    // 同文已经有效（上一个会话写下的）：整理应该识别为重复（指纹查重），而不是并列写第二条。
    value(await kernel.store.write({ type: 'preference', project: 'p', scope, source: 'session:old', body: '测试报告使用中文' }));
    await sessions.start(agent);
    const result = await sessions.distill(agent);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.written, 0);
    assert.equal(result.entries.length, 1); assert.equal(result.entries[0].duplicate, true);
    assert.equal(value(await kernel.store.list({ scope })).entries.length, 1, '没有并列第二条');
    // 同一批内容只处理一次：再整理没有新增内容，也不再调用模型。
    assert.equal((await sessions.distill(agent)).reason, '没有新增内容');
    assert.equal(prompts.length, 1);
  } finally { sessions.dispose(); kernel.close(); }
});

test('关闭记录能取消已排队的写入，不能只在调用前检查', async () => {
  const plugin = await boot();
  let release;
  try {
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => {
      plugin.kernel.control.before = async api => { if (api.endsWith('/appendBlock')) { resolve(); await gate; } return null; };
    });
    const queued = plugin.call('memory_write', { type: 'fact', project: '*', text: '排队中的写入' });
    await started;
    assert.equal((await plugin.request({ action: 'recording', enabled: false })).status, 200);
    release();
    const result = await queued;
    assert.equal(result.ok, false);
    assert.ok(['cancelled', 'recording_disabled'].includes(result.error.code), JSON.stringify(result));
    assert.ok(result.partial?.id, '已追加的块要在结果里点名，方便到思源核对');
    assert.equal(Object.keys(plugin.blocks.get(result.partial.id).attrs).length, 0, '取消发生在写入生效之前，块上没有记忆属性');
    assert.ok(!value(await plugin.kernel.store.list({})).entries.some(entry => entry.statement.includes('排队中的写入')));
  } finally { release?.(); await plugin.close(); }
});
