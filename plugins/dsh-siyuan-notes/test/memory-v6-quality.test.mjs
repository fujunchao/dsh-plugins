// 契约 v6（P2）：召回质量（12 条池 + 去重 + 权重/门槛/元数据奖励 + 行格式）、常驻注入瘦身、checkup 主题漂移。
// 用真实 SQLite/FTS 内核（memory-sql-kernel）与真实 createMemorySessions 驱动，断言「真正发给模型的东西」。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemorySessions } from '../lib/memory-sessions.js';
import { MEMORY_LIMITS, recallLine, recallTerms } from '../lib/memory.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const scope = { workspace: '/workspace/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/workspace/p' } };
const trusted = { confidence: 'stated', source: 'test:quality', scope, project: 'p' };
const stateBody = title => title + '\n- 下一步：继续推进\n- 待决：无';

test('召回取词：标识符权重 3、通用词直接丢弃、纯指代短句一个词都不抽', () => {
  const terms = recallTerms('dsh-resume 在 Windows 上杀掉进程算什么退出码');
  assert.equal(terms.find(term => term.text === 'dsh-resume')?.weight, 3, '标识符权重升到 3');
  assert.ok(!terms.some(term => term.text === 'windows'), '通用词 windows 不该进检索式');
  assert.ok(recallTerms('上次定的外部变更闸门方案是什么').some(term => term.text === '闸门'), '项目内的中文词元仍然抽取');
  assert.ok(!recallTerms('这个工作区的项目文件在哪').some(term => ['工作', '作区', '项目', '文件'].includes(term.text)), '工作区/项目/文件是通用词');
  for (const text of ['好的，继续', '继续', '上次那个', '那个呢？']) {
    assert.deepEqual(recallTerms(text), [], JSON.stringify(text) + ' 只有指代词，不该抽词（也就不发查询）');
  }
});

test('召回：整句只有通用词时不再误召回（改前会被 windows/工作区 拉出无关条目）', async () => {
  const backend = memorySqlKernel();
  try {
    const store = backend.makeStore();
    await store.write({ ...trusted, type: 'decision', statement: '记住登录 30 天用 loginAuth + DPAPI（Windows 环境实测）' });
    await store.write({ ...trusted, type: 'fact', statement: 'cz 工作区不是 git 仓库，里面有三个 DSH 插件项目' });
    const result = await store.recall({ text: 'windows 工作区 html 这些通用词到底算不算', scope, limit: 12 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.entries, [], '只有通用词就该静默');
  } finally { backend.close(); }
});

test('召回：用户话里出现项目名时，这个项目的条目加权排到最前', async () => {
  const backend = memorySqlKernel();
  try {
    const store = backend.makeStore();
    const wide = { workspace: '/workspace', project: '*', projects: ['*', 'dsh-resume', 'dsh-quote-ref'], projectRoots: { 'dsh-resume': '/workspace/dsh-resume', 'dsh-quote-ref': '/workspace/dsh-quote-ref' } };
    const same = { confidence: 'stated', source: 'test:quality', type: 'fact', workspace: '/workspace/dsh-resume', statement: '进程被杀时退出码是 1', projects: ['*', 'dsh-resume'] };
    await store.write({ ...same, project: 'dsh-resume', scope: { ...wide, project: 'dsh-resume' } });
    await store.write({ ...same, project: 'dsh-quote-ref', scope: { ...wide, project: 'dsh-quote-ref' } });
    const result = await store.recall({ text: 'dsh-resume 进程被杀算什么退出码', scope: wide, limit: 12 });
    assert.equal(result.value.entries[0]?.project, 'dsh-resume', JSON.stringify(result.value.entries));
    assert.ok(result.value.entries[0].score >= 6, '中文词元 3 分 + 项目名奖励 3 分：' + result.value.entries[0].score);
  } finally { backend.close(); }
});

test('每步提示：先取 12 条再按常驻索引去重、只展示 3 条，且优先展示索引外的强匹配', async () => {
  const inSection = ['索引里已经有的强匹配一', '索引里已经有的强匹配二', '索引里已经有的强匹配三'];
  const section = '【索引】' + inSection.join(' | ');
  const entries = [
    ...inSection.map((statement, index) => ({ id: 'sec-' + index, type: 'fact', project: 'p', statement, status: 'active', created: '20261110000000' })),
    { id: 'out-strong', type: 'decision', project: 'p', statement: '常驻索引外的强匹配决策', status: 'active', created: '20261109000000' },
    { id: 'out-weak', type: 'fact', project: 'p', statement: '常驻索引外的次强匹配事实', status: 'active', created: '20261108000000' },
    { id: 'out-fourth', type: 'fact', project: 'p', statement: '第四条不该出现', status: 'active', created: '20261107000000' },
    { id: 'out-fifth', type: 'fact', project: 'p', statement: '第五条不该出现', status: 'active', created: '20261106000000' },
  ];
  let askedLimit = null;
  const store = { sectionText: async () => section, revision: () => 0,
    changesSince: () => ({ revision: 0, complete: true, entries: [] }),
    list: async () => ({ ok: true, value: { entries: [], complete: true } }),
    recall: async input => { askedLimit = input.limit; return { ok: true, value: { entries } }; } };
  const sessions = createMemorySessions({ store: () => store, resolveScope: async () => scope, isRoot: () => true, now: Date.now });
  const agent = { id: 'q', session: { id: 'quality-hint', header: { cwd: '/workspace/p' },
    deriveMessages: () => [{ role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: '上次定的外部变更闸门方案是什么' }] }] } };
  try {
    await sessions.prepare(agent);
    const hint = sessions.context({ agent });
    assert.equal(askedLimit, 12, '要先取一池 12 条，才不会被索引去重筛成第二梯队');
    assert.match(hint, /out-strong/);
    assert.match(hint, /out-weak/);
    assert.equal(hint.split('\n').filter(line => line.startsWith('- ')).length, 3, '只展示 3 条：' + hint);
    assert.ok(!hint.includes('out-fifth'), '第 4 条检索结果不该出现');
    assert.ok(!hint.includes('sec-'), '已在常驻索引里的条目不再重复展示：' + hint);
    assert.match(hint, /\[决策·p · active · 2026-11-09\] 常驻索引外的强匹配决策/u, '召回行带类型/项目/状态/日期：' + hint);
  } finally { sessions.dispose(); }
});

test('召回行：带 id、类型、项目、状态、日期，一行不超过 100 字', () => {
  const line = recallLine({ id: '20261111120711-9qvy5nr', type: 'fact', project: 'dsh-siyuan-notes', status: 'active', created: '20261111120711', statement: '很长的结论'.repeat(40) });
  assert.ok(line.length <= 100, line.length + ' 字：' + line);
  assert.match(line, /^- 20261111120711-9qvy5nr \[事实·dsh-siyuan-notes · active · 2026-11-11\] /u);
  assert.ok(line.endsWith('…'), '超长结论要被截断');
  assert.equal(recallLine({ id: 'x', type: 'decision', project: 'p', status: 'active', created: '20261110', statement: '短结论' }),
    '- x [决策·p · active · 2026-11-10] 短结论');
});

test('常驻注入：stated 省掉可信度标签、verified 保留，总长仍不超预算', async () => {
  const backend = memorySqlKernel();
  try {
    const store = backend.makeStore();
    await store.write({ ...trusted, type: 'preference', statement: '以后都用简体中文' });
    await store.write({ ...trusted, type: 'fact', statement: '内核 SQL 没有参数绑定' });
    await store.write({ confidence: 'verified', evidence: '实测 /api/query/sql 报 not enough args', source: 'test:quality', scope, project: 'p', type: 'fact', statement: 'blocks 索引最多滞后 2.4 秒' });
    const text = await store.sectionText({ scope, force: true });
    assert.ok(!text.includes('| stated'), 'stated 是默认值，不再占字数：' + text);
    assert.match(text, /- p\n  - \[verified\] blocks 索引最多滞后 2\.4 秒/u, '非默认可信度仍然标注');
    assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars, '预算 1500 字以内，实际 ' + text.length);
    for (const line of text.split('\n')) assert.ok(line.length <= 120, '单行过长：' + line.slice(0, 40));
  } finally { backend.close(); }
});

test('常驻注入：预算用满时尽量多收录，被截断的行至少留 50 字正文', async () => {
  const backend = memorySqlKernel();
  try {
    const store = backend.makeStore();
    for (let index = 0; index < 8; index++) await store.write({ ...trusted, type: 'fact', statement: '事实第' + index + '条：' + '细节'.repeat(28) });
    for (let index = 0; index < 6; index++) await store.write({ ...trusted, type: 'decision', statement: '决策第' + index + '条：' + '取舍'.repeat(28) });
    for (let index = 0; index < 4; index++) await store.write({ ...trusted, type: 'preference', statement: '偏好第' + index + '条：' + '习惯'.repeat(20) });
    for (const [index, topic] of ['alpha', 'beta', 'gamma'].entries()) await store.write({ ...trusted, type: 'state', topic, body: stateBody('状态第' + index + '条：' + '进展'.repeat(20)) });
    const text = await store.sectionText({ scope, force: true });
    assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars, '总长 ' + text.length);
    const entryLines = text.split('\n').filter(line => line.startsWith('  - '));
    assert.ok(entryLines.length >= 10, '预算应该被用满，实际只收录 ' + entryLines.length + ' 条：' + text);
    for (const line of entryLines) {
      const body = line.replace(/^  - (\[[^\]]*\] )?/u, '');
      // v7 把下限从 60 调到 50：真实库里 57 字的最后一条事实不该被挡在门外（见 MIN_TRUNCATED_BODY）。
      if (body.endsWith('…')) assert.ok(body.length >= 50, '截断行不能只剩几个字：' + line);
    }
  } finally { backend.close(); }
});

test('checkup：同项目多条 active 状态主题不同时报 topicDrift，且不自动合并', async () => {
  const backend = memorySqlKernel();
  try {
    const store = backend.makeStore();
    await store.write({ ...trusted, type: 'state', topic: 'memory-plugin', body: stateBody('记忆插件改造进行中') });
    await store.write({ ...trusted, type: 'state', topic: 'image-engine', body: stateBody('图片引擎重写进行中') });
    const report = (await store.checkup({ scope })).value;
    assert.equal(report.topicDrift.length, 1, JSON.stringify(report.topicDrift));
    const group = report.topicDrift[0];
    assert.equal(group.project, 'p');
    assert.equal(group.topics.length, 2);
    for (const item of group.topics) {
      assert.ok(item.id, '要带 id');
      assert.ok(item.topic, '要带 topic');
      assert.ok(item.created, '要带创建时间');
    }
    assert.deepEqual(group.topics.map(item => item.topic).sort(), ['image-engine', 'memory-plugin']);
    const active = (await store.list({ scope })).value.entries.filter(entry => entry.type === 'state' && entry.status === 'active');
    assert.equal(active.length, 2, '只报告不合并：两条都还是 active');
  } finally { backend.close(); }
});

test('checkup：同项目只有一个 active 主题时不报 topicDrift', async () => {
  const backend = memorySqlKernel();
  try {
    const store = backend.makeStore();
    await store.write({ ...trusted, type: 'state', topic: 'memory-plugin', body: stateBody('只有一个主题') });
    const report = (await store.checkup({ scope })).value;
    assert.deepEqual(report.topicDrift, []);
  } finally { backend.close(); }
});
