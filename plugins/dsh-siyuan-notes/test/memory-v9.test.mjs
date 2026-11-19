/**
 * dsh-siyuan-notes — 契约 v9（2026-11-19）：检索词元 / 相关度 / 完整性 / 注入下一步 / 候选最后 / 徽标。
 */

import assert from 'node:assert/strict';
import assertStrict from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { test } from 'node:test';

import { ftsExpression, queryExpanded, queryTokens } from '../lib/memory.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const project = 'p';
const scope = { workspace: '/w/p', project, projects: ['*', project], projectRoots: { [project]: '/w/p' } };
const base = { project, scope, source: 'fixture:v9' };
const stateBody = (text, next) => text + '\n- 下一步：' + (next ?? '继续') + '\n- 待决：无';
const write = async (store, spec) => {
  const result = await store.write({ ...base, ...spec });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

test('v9 检索词元：整句中文按二元组展开，短词与英文标识符不变', () => {
  const tokens = queryTokens('记忆插件如何安装到本地宿主');
  assert.ok(tokens.length >= 6, JSON.stringify(tokens));
  for (const token of tokens) assert.ok([...token].length <= 4, '展开后不该还有整句：' + token);
  assert.deepEqual(queryTokens('面板'), ['面板'], '两字短查询原样保留');
  assert.deepEqual(queryTokens('memory_read reconcile'), ['memory_read', 'reconcile'], '英文多词不展开');
  assert.equal(ftsExpression('记忆插件如何安装到本地宿主').includes(' OR '), false, 'AND 优先');
  assert.equal(ftsExpression('记忆插件如何安装到本地宿主', 'or').includes(' OR '), true);
  // 只有整句展开的查询才按 rank 排；短关键词保持 v8 的「当前项目 + 时间」，避免排序回退。
  assert.equal(queryExpanded('记忆插件如何安装到本地宿主'), true);
  assert.equal(queryExpanded('面板'), false);
  assert.equal(queryExpanded('memory_read reconcile'), false);
});

test('v9 检索：整句中文能命中（假内核已按真实内核的中文分词对齐）', async () => {
  const f = memorySqlKernel();
  try {
    await write(f.store, { type: 'fact', confidence: 'inferred', body: '被动召回采用关键词匹配，不是语义检索' });
    await write(f.store, { type: 'fact', body: '面板体检只扫最近 200 条' });
    const hit = await f.store.search({ scope, query: '为什么召回不准' });
    assert.equal(hit.ok, true, JSON.stringify(hit));
    assert.ok(hit.value.results.length >= 1, '整句「为什么召回不准」至少要命中那条召回的坑：' + JSON.stringify(hit.value));
    const miss = await f.store.search({ scope, query: '面板' });
    assert.equal(miss.value.results.length, 1, '短查询仍然精确');
  } finally { f.close(); }
});

test('v9 检索：被 limit 截断时 complete=false（不再硬编码 true）', async () => {
  const f = memorySqlKernel();
  try {
    for (let index = 0; index < 3; index++) await write(f.store, { type: 'fact', body: '面板第' + index + '条：细节' });
    const two = await f.store.search({ scope, query: '面板', limit: 2 });
    assert.equal(two.value.results.length, 2);
    assert.equal(two.value.complete, false, '还有第 3 条没列出来');
    const ten = await f.store.search({ scope, query: '面板', limit: 10 });
    assert.equal(ten.value.complete, true);
  } finally { f.close(); }
});

test('v9 注入：组名叫「当前状态」、state 带一行「下一步」、「无」不占行', async () => {
  const f = memorySqlKernel();
  try {
    await write(f.store, { type: 'state', topic: 'alpha', body: stateBody('alpha 的进度', '先跑面板测试') });
    await write(f.store, { type: 'state', topic: 'beta', body: stateBody('beta 的进度', '无') });
    const text = await f.store.sectionText({ scope, force: true });
    assert.match(text, /当前状态：\n/u, text);
    assert.equal(text.includes('待办：'), false, text);
    assert.match(text, /下一步：先跑面板测试/u, text);
    const nextLines = text.split('\n').filter(line => line.includes('下一步：'));
    assert.equal(nextLines.length, 1, '值为「无」的不写这一行：' + text);
    for (const line of nextLines) assert.match(line, /^ {4}下一步：/u, '缩进两格在结论行下方：' + line);
    assert.ok(text.length <= 1500, text.length + ' 字');
  } finally { f.close(); }
});

test('v9 注入：候选块最后分配，不再挤掉「最近决策」的位置', async () => {
  const f = memorySqlKernel();
  try {
    for (let index = 0; index < 5; index++) await write(f.store, { type: 'decision', body: '决策第' + index + '条：' + '取舍'.repeat(30) });
    for (let index = 0; index < 4; index++) await write(f.store, { type: 'fact', body: '事实第' + index + '条：' + '细节'.repeat(30) });
    await write(f.store, { type: 'decision', confidence: 'inferred', body: '也许改用 WAL 的推断' });
    const text = await f.store.sectionText({ scope, force: true });
    const decisionBlock = text.split('最近决策：\n')[1]?.split('踩过的坑与事实')[0] ?? '';
    const decisions = decisionBlock.split('\n').filter(line => line.startsWith('  - '));
    assert.ok(decisions.length >= 3, '候选块不再先占预算，决策至少要进 3 条：' + decisions.length + '\n' + text);
    assert.ok(text.includes('候选（未核实）：'), '预算够时候选仍要出现：' + text);
    assert.ok(text.length <= 1500, text.length + ' 字');
  } finally { f.close(); }
});

test('v9 面板：徽标用 catalog 真值，不再把本页 200 条当总数', async () => {
  const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const values = [{ catalog: [{ type: 'fact', count: 173 }, { type: 'decision', count: 60 }, { type: 'state', count: 62 }, { type: 'preference', count: 5 }] },
    [{ id: 'a', statement: '一条', type: 'fact', project: 'p', status: 'active' }], false, null, '', '', '', '', null, null,
    { approval: null, selected: [], body: '', recoveries: null, inspection: null, confirmedMissing: false }];
  let cursor = 0, exports;
  const React = { Component: class {}, createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; },
    useEffect: () => {}, useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: v => ({ current: v }), useSyncExternalStore: (_s, get) => get() };
  const fetch = async (url, init) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: json(url) }) });
  const json = url => url.includes('view=recording') ? { enabled: true, locked: false, sessions: [] }
    : url.includes('view=entries') ? { entries: values[1], complete: true }
    : url.includes('view=receipts') ? { entries: [] }
    : values[0];
  new Function('window', 'document', 'fetch', source)({ __ModuleLoader__: { load({ factory }) { exports = factory(name => (name === 'react' ? React : {})); } } },
    { createElement: () => ({ dataset: {} }), head: { appendChild() {} }, querySelector: () => null }, fetch);
  cursor = 0;
  const nodes = [];
  const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); visit(node.children); };
  // 面板文案走 t()：这里给一个最小的中文本地化，才能断言真实显示出来的徽标。
  const t = (key, params = {}) => (key === 'memoryCount' ? params.n + ' 条' : key === 'memoryCountWindowed' ? params.n + ' 条 · 仅显示 ' + params.shown : key);
  const walk = () => { cursor = 0; nodes.length = 0; visit(exports.__panes.MemoryPage({ t })); return nodes; };
  const text = walk().map(node => (typeof node.children?.[0] === 'string' ? node.children[0] : '')).join(' | ');
  assert.ok(text.includes('300 条'), '徽标要显示全库有效条数：' + text);
  assert.ok(text.includes('仅显示 1'), '被窗口截断时要说清本页条数：' + text);
});
test('v9 检索：limit 拉满时 complete 仍然诚实（probe 上限放行 +1）', async () => {
  const f = memorySqlKernel();
  try {
    for (let index = 0; index < 30; index++) await write(f.store, { type: 'fact', body: '面板第' + index + '条：细节' });
    const full = await f.store.search({ scope, query: '面板', limit: 25 });
    assert.equal(full.value.results.length, 25);
    assert.equal(full.value.complete, false, '还有 5 条没列出来，不能说完整');
  } finally { f.close(); }
});
