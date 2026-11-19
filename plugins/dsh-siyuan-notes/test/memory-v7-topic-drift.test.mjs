/**
 * dsh-siyuan-notes — 契约 v7 / A：主题漂移收敛（store 层）。
 *
 * checkup().topicDrift 只报告不合并（合并要同时改取代链两端，属用户决策）。面板的
 * 「只保留最新」按下之后走 collapseTopicDrift()：把同项目同工作区里比 keep 更旧的
 * active 状态一次性标成已被取代，并在同一个 mutation('collapse') 事务里补上取代链两端。
 *
 * 这里全部在 store 层驱动（真实 SQLite 假内核），不碰路由与面板。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEMORY_ATTRS as A } from '../lib/memory.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const project = 'p';
const scope = { workspace: '/w/p', project, projects: ['*', project], projectRoots: { [project]: '/w/p' } };
const stateBody = text => text + '\n- 下一步：继续\n- 待决：无';
const state = (overrides = {}) => ({
  type: 'state', project, workspace: '/w/p', status: 'active', confidence: 'stated', source: 'fixture',
  topic: 'memory-repair', body: stateBody('当前状态'), ...overrides,
});
/** 直接种条目：id 前 14 位决定 created，所以新旧由 id 前缀控制。 */
const seedStates = (fixture, entries) => fixture.seed(entries.map(entry => ({ id: entry.id, ...state(entry) })));
const readOne = async (store, id) => {
  const result = await store.read([id]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.value.entries[0], '读不到条目 ' + id);
  return result.value.entries[0];
};
const writeCalls = fixture => fixture.kernel.calls.filter(call => call.api.endsWith('/setBlockAttrs'));

const OLD = '20261109120000-0000001';
const MIDDLE = '20261110120000-0000002';
const KEEP = '20261111120000-0000003';

test('收敛成功：更旧的 active 状态变 superseded，取代链两端都补齐', async () => {
  const fixture = memorySqlKernel();
  try {
    seedStates(fixture, [
      { id: OLD, topic: 'memory-usability', text: '评估进行中（旧）' },
      { id: MIDDLE, topic: 'legacy-20261109211213-8b1qmgr', text: '迁移留下的旧状态' },
      { id: KEEP, topic: 'memory-repair', text: '当前状态' },
      { id: '20261108120000-0000009', project: 'q', workspace: '/w/q', topic: 'other', text: '别的项目' },
    ]);
    const result = await fixture.store.collapseTopicDrift({ keepId: KEEP, project, workspace: '/w/p' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value.superseded, [OLD, MIDDLE], '按从旧到新收敛更旧的两条');
    assert.deepEqual(result.value.kept, { id: KEEP, topic: 'memory-repair' });
    assert.equal(result.value.id, KEEP);
    const old = await readOne(fixture.store, OLD);
    assert.equal(old.status, 'superseded');
    assert.equal(old.supersededBy, KEEP, '反向链接要写上，体检才不会报断链');
    const keep = await readOne(fixture.store, KEEP);
    assert.equal(keep.status, 'active');
    assert.equal(keep.supersedes, OLD + ',' + MIDDLE, '保留项要记下被它取代的旧状态');
    assert.equal((await readOne(fixture.store, '20261108120000-0000009')).status, 'active', '别的项目不受影响');
    // changed()：让别的会话看到旧状态失效
    const changes = fixture.store.changesSince(0).entries.filter(entry => entry.status === 'superseded');
    assert.deepEqual(changes.map(entry => entry.id).sort(), [OLD, MIDDLE].sort());
  } finally { fixture.close(); }
});

test('只作废比保留项更旧的：更新的 active 状态一律跳过', async () => {
  const fixture = memorySqlKernel();
  try {
    seedStates(fixture, [
      { id: OLD, topic: 'a', text: '最旧的' },
      { id: MIDDLE, topic: 'b', text: '要保留的' },
      { id: KEEP, topic: 'c', text: '比保留项还新（正常不该出现，但必须不被误标）' },
    ]);
    const result = await fixture.store.collapseTopicDrift({ keepId: MIDDLE });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value.superseded, [OLD]);
    assert.equal((await readOne(fixture.store, OLD)).status, 'superseded');
    assert.equal((await readOne(fixture.store, KEEP)).status, 'active', '更新的不能被标掉');
    assert.equal((await readOne(fixture.store, MIDDLE)).supersedes, OLD);
  } finally { fixture.close(); }
});

test('同项目只有一个主题：noDrift，一个字节都不写', async () => {
  const fixture = memorySqlKernel();
  try {
    seedStates(fixture, [{ id: KEEP, topic: 'memory-repair', text: '唯一状态' }]);
    const before = writeCalls(fixture).length;
    const result = await fixture.store.collapseTopicDrift({ keepId: KEEP });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.noDrift, true);
    assert.deepEqual(result.value.superseded, []);
    assert.equal(writeCalls(fixture).length, before, '没有漂移就不能有任何属性写入');
    assert.equal((await readOne(fixture.store, KEEP)).status, 'active');
  } finally { fixture.close(); }
});

test('事务中途失败回滚：旧状态仍 active，保留项的 supersedes 不变，重试可成功', async () => {
  const fixture = memorySqlKernel();
  try {
    seedStates(fixture, [
      { id: OLD, topic: 'a', text: '旧状态' },
      { id: MIDDLE, topic: 'b', text: '旧状态二' },
      { id: KEEP, topic: 'c', text: '当前状态' },
    ]);
    let armed = false, injected = false;
    fixture.control.after = (api, payload) => {
      if (!injected && api.endsWith('/setBlockAttrs') && payload.id === KEEP && String(payload.attrs?.[A.supersedes] ?? '') !== '') armed = true;
    };
    fixture.control.before = (api, payload) => {
      if (armed && api.endsWith('/getBlockAttrs') && payload.id === KEEP) { armed = false; injected = true; return { ok: false, error: { code: 'network', message: '属性确认读取失败' } }; }
    };
    const failed = await fixture.store.collapseTopicDrift({ keepId: KEEP });
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(failed.error.message, /主题漂移收敛未完成/u, JSON.stringify(failed));
    for (const id of [OLD, MIDDLE]) {
      const entry = await readOne(fixture.store, id);
      assert.equal(entry.status, 'active', '回滚后旧状态必须还在 valid');
      assert.equal(entry.supersededBy, '');
    }
    assert.equal((await readOne(fixture.store, KEEP)).supersedes, '', '保留项不能被留在半路');
    // 钩子只触发一次；重试应当成功。
    const retry = await fixture.store.collapseTopicDrift({ keepId: KEEP });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.deepEqual(retry.value.superseded, [OLD, MIDDLE]);
    assert.equal((await readOne(fixture.store, OLD)).supersededBy, KEEP);
  } finally { fixture.close(); }
});

test('keep 必须是有效、有主题的 state；版本不符与范围不符都要报错', async () => {
  const fixture = memorySqlKernel();
  try {
    seedStates(fixture, [
      { id: OLD, topic: 'a', text: '旧状态' },
      { id: KEEP, topic: 'b', text: '当前状态' },
      { id: '20261107120000-0000007', topic: 'c', text: '候选状态', status: 'candidate', confidence: 'inferred' },
      { id: '20261107120000-0000008', topic: '', text: '没有主题的旧状态' },
    ]);
    assert.equal((await fixture.store.collapseTopicDrift({ keepId: '20261107120000-0000007' })).error.code, 'invalid_keep');
    assert.equal((await fixture.store.collapseTopicDrift({ keepId: '20261107120000-0000008' })).error.code, 'invalid_keep');
    assert.equal((await fixture.store.collapseTopicDrift({ keepId: 'not-an-id' })).error.code, 'invalid_keep');
    assert.equal((await fixture.store.collapseTopicDrift({ keepId: KEEP, expectedRevision: 'deadbeef' })).error.code, 'revision_conflict');
    assert.equal((await fixture.store.collapseTopicDrift({ keepId: KEEP, project: 'q' })).error.code, 'scope_mismatch');
    assert.equal((await fixture.store.collapseTopicDrift({ keepId: KEEP, workspace: '/w/elsewhere' })).error.code, 'scope_mismatch');
    assert.equal((await readOne(fixture.store, OLD)).status, 'active', '报错时什么都不改');
  } finally { fixture.close(); }
});

test('取代链已经满了：宁可少收敛也不写单向链接（skipped 说明还剩几条）', async () => {
  const fixture = memorySqlKernel();
  try {
    const five = ['20261101120000-0000101', '20261102120000-0000102', '20261103120000-0000103', '20261104120000-0000104', '20261105120000-0000105'];
    // 保留项自己已经记了 5 个前驱（上限就是 5），再收敛就没有位置写反向关系了。
    fixture.seed([{ id: KEEP, type: 'state', project, workspace: '/w/p', status: 'active', confidence: 'stated', source: 'fixture',
      topic: 'c', body: stateBody('当前状态'), supersedes: five.join(',') }]);
    seedStates(fixture, [{ id: OLD, topic: 'a', text: '旧状态' }, { id: MIDDLE, topic: 'b', text: '旧状态二' }]);
    const result = await fixture.store.collapseTopicDrift({ keepId: KEEP });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value.superseded, []);
    assert.equal(result.value.skipped, 2, '两条更旧的状态没地方挂，必须如实报告');
    assert.equal((await readOne(fixture.store, OLD)).status, 'active');
  } finally { fixture.close(); }
});
