/**
 * dsh-siyuan-notes — 契约 v7 / C：常驻注入按项目分组。
 *
 * 改前每条都写「项目/主题」，真实库里 14 条条目的项目名重复占了 227 字。v7 起每个类目内
 * 按项目分组：项目名只在组头写一次，条目行两空格缩进、方括号里只留主题与（非默认）可信度。
 * 省下来的预算留给事实类（真实库目标 3 → 4 条）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEMORY_LIMITS } from '../lib/memory.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const project = 'p';
const scope = { workspace: '/w/p', project, projects: ['*', project], projectRoots: { [project]: '/w/p' } };
const base = { project, scope, source: 'fixture:v7' };
const stateBody = text => text + '\n- 下一步：继续\n- 待决：无';
const write = async (store, spec) => {
  const result = await store.write({ ...base, ...spec });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const section = async fixture => await fixture.store.sectionText({ scope, force: true });
const countOf = (text, needle) => text.split(needle).length - 1;
const entryLines = text => text.split('\n').filter(line => line.startsWith('  - '));

test('同一项目的条目共用一行组头；不同项目各一组', async () => {
  const fixture = memorySqlKernel();
  try {
    await write(fixture.store, { type: 'preference', body: '偏好一：先给结论' });
    await write(fixture.store, { type: 'preference', body: '偏好二：不用敬语' });
    await write(fixture.store, { type: 'preference', project: '*', body: '全局偏好：中文回答' });
    const text = await section(fixture);
    assert.equal(countOf(text, '- ' + project + '\n'), 1, '同项目在同一类目里只能有一个组头：\n' + text);
    assert.equal(countOf(text, '- *\n'), 1, '全局条目单独一组：\n' + text);
    for (const line of text.split('\n')) {
      if (line.startsWith('  - ')) continue;
      assert.ok(!/^- \[.*\]/u.test(line), '条目行必须缩进两格：' + line);
    }
    assert.ok(entryLines(text).length >= 3, text);
  } finally { fixture.close(); }
});

test('条目行只留主题与可信度：组头已经有项目名', async () => {
  const fixture = memorySqlKernel();
  try {
    await write(fixture.store, { type: 'state', topic: 'task-a', body: stateBody('当前任务进度') });
    await write(fixture.store, { type: 'fact', confidence: 'verified', evidence: 'lib/memory.js:1', body: '已核实的坑' });
    await write(fixture.store, { type: 'fact', body: '未标可信度的事实' });
    const text = await section(fixture);
    // state：只有主题（stated 不写标签）；verified 事实：只有可信度；默认可信度：连方括号都没有。
    assert.match(text, /当前状态：\n- p\n  - \[task-a\] 当前任务进度/u, text);
    // 事实类的排序由 refcount/时间决定，这里只关心行格式，不锁顺序。
    assert.ok(text.includes('踩过的坑与事实：\n- p\n'), text);
    assert.ok(text.includes('  - [verified] 已核实的坑'), text);
    assert.ok(text.includes('  - 未标可信度的事实'), text);
    assert.ok(!text.includes(project + '/task-a'), '项目名不再和主题拼在方括号里：' + text);
    assert.ok(!text.includes('[verified | task-a]'), text);
  } finally { fixture.close(); }
});

test('分组后预算仍然守住：总长 ≤1500、结尾提示在、单行不超 120', async () => {
  const fixture = memorySqlKernel();
  try {
    for (let index = 0; index < 8; index++) await write(fixture.store, { type: 'fact', body: '事实第' + index + '条：' + '细节'.repeat(30) });
    for (let index = 0; index < 6; index++) await write(fixture.store, { type: 'decision', body: '决策第' + index + '条：' + '取舍'.repeat(30) });
    for (let index = 0; index < 5; index++) await write(fixture.store, { type: 'preference', body: '偏好第' + index + '条：' + '习惯'.repeat(20) });
    for (const topic of ['alpha', 'beta', 'gamma']) await write(fixture.store, { type: 'state', topic, body: stateBody('状态：' + '进展'.repeat(20)) });
    const text = await section(fixture);
    assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars, '总长 ' + text.length + '：' + text.length);
    assert.ok(text.endsWith('未命中不代表从未记录。'), '结尾提示不能被截掉');
    for (const line of text.split('\n')) assert.ok(line.length <= 120, '单行过长（' + line.length + '）：' + line.slice(0, 40));
    // 同一类目里项目名只出现一次，即使条目很多。
    assert.equal(countOf(text, '- p\n'), 4, '四类各一个组头：\n' + text);
  } finally { fixture.close(); }
});

test('分组省下的预算让事实类多进一条（目标 ≥4）', async () => {
  const fixture = memorySqlKernel();
  try {
    for (let index = 0; index < 8; index++) await write(fixture.store, { type: 'fact', body: '事实第' + index + '条：' + '细节'.repeat(28) });
    for (let index = 0; index < 6; index++) await write(fixture.store, { type: 'decision', body: '决策第' + index + '条：' + '取舍'.repeat(28) });
    for (let index = 0; index < 8; index++) await write(fixture.store, { type: 'preference', body: '偏好第' + index + '条：' + '习惯'.repeat(30) });
    for (const topic of ['alpha', 'beta', 'gamma']) await write(fixture.store, { type: 'state', topic, body: stateBody('状态：' + '进展'.repeat(20)) });
    const text = await section(fixture);
    const block = text.split('踩过的坑与事实：\n')[1]?.split('其他项目和历史条目')[0] ?? '';
    const facts = block.split('\n').filter(line => line.startsWith('  - '));
    assert.ok(facts.length >= 4, '事实类至少要进 4 条，实际 ' + facts.length + '：\n' + text);
    assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars, '预算 1500 字以内，实际 ' + text.length);
  } finally { fixture.close(); }
});

test('候选摘要格式不变（它只有 2 条，不参与项目分组）', async () => {
  const fixture = memorySqlKernel();
  try {
    await write(fixture.store, { type: 'decision', confidence: 'inferred', body: '也许改用 WAL' });
    await write(fixture.store, { type: 'decision', body: '已经生效的决定' });
    const text = await section(fixture);
    assert.match(text, /候选（未核实）：\n- \[p \| inferred\] 也许改用 WAL/u, text);
    assert.match(text, /最近决策：\n- p\n  - 已经生效的决定/u, text);
  } finally { fixture.close(); }
});

test('v8：项目清单最多列 6 个，超出按个数折叠，绝不切出半截项目名', async () => {
  const fixture = memorySqlKernel();
  try {
    const names = Array.from({ length: 9 }, (_, index) => 'proj-' + index);
    const wide = { workspace: '/w/root', project: '*', projects: ['*', ...names], projectRoots: {} };
    const text = await fixture.store.sectionText({ scope: wide, force: true });
    assert.match(text, /^当前项目：proj-0 \/ proj-1 \/ proj-2 \/ proj-3 \/ proj-4 \/ proj-5 等 3 个；通用内容填 \*。$/mu, text);
    assert.equal(/proj-[6-8]/u.test(text), false, '超出 6 个的项目不逐个列名：' + text);
    assert.equal(/等 3 个/u.test(text), true, text);
  } finally { fixture.close(); }
});

test('v8：超长主题与候选摘要补省略号，不留没有省略号的半句', async () => {
  const fixture = memorySqlKernel();
  try {
    const longTopic = '很长的任务主题'.repeat(6);
    await write(fixture.store, { type: 'state', topic: longTopic, body: stateBody('进度结论') });
    await write(fixture.store, { type: 'decision', confidence: 'inferred', body: '这是一条很长的推断结论'.repeat(8) });
    const text = await section(fixture);
    const badgeLine = text.split('\n').find(line => line.startsWith('  - [') && line.includes('…]'));
    assert.ok(badgeLine, '主题徽标要带省略号：' + text);
    const inner = badgeLine.slice(badgeLine.indexOf('[') + 1, badgeLine.indexOf(']'));
    assert.ok(inner.endsWith('…'), '徽标必须以省略号结束：' + inner);
    assert.ok([...inner].length <= 23, '徽标不超过 23 字：' + [...inner].length);
    assert.equal(inner.includes(longTopic), false, '不能把 42 字的主题整个塞进去：' + inner);
    const candidate = text.split('\n').find(line => line.startsWith('- [' + project + ' | inferred]'));
    assert.ok(candidate, text);
    assert.ok(candidate.endsWith('…'), '候选摘要截断也要带省略号：' + candidate);
    assert.ok(text.length <= MEMORY_LIMITS.sectionMaxChars, '总长仍守 1500：' + text.length);
  } finally { fixture.close(); }
});
