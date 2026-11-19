/**
 * dsh-siyuan-notes — 契约 v6 / P1-2：候选升级要兑现「候选里记下的取代意图」。
 *
 * 背景（write-ux 实测 R5–R7）：写 `inferred` 时带了 `supersedes`，取代目标只会落进
 * `proposedSupersedes` 属性；之后按提示用 `stated` 同文再写一次，v5 的升级分支只改
 * status/confidence/source/evidence/fingerprint，把 `proposedSupersedes` 原样留着——
 * 于是旧结论永久停在 active，模型却收到「已记住」。面板的 approve() 一直会应用它，
 * 工具路径不会，两条路结果不一致。v6 让升级在同一个 mutation 事务里兑现它。
 *
 * 这里全部在 store 层驱动（与 memory-repair / memory-design 同一套假内核），
 * 不碰 index.js，避免和并行修改的渲染/参数白名单互相干扰。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEMORY_ATTRS as A } from '../lib/memory.js';
import { memoryFingerprint } from '../lib/memory-policy.js';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';

const scope = { workspace: '/w/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/w/p' } };
const base = { project: 'p', scope, source: 'session:p1-2' };

/** 与宿主一致的无损 JSON 校验：任何 undefined 属性都会让整个工具结果被拒。 */
function assertLossless(value, at = 'value') {
  if (value === undefined) throw new Error('undefined at ' + at);
  if (value === null || ['boolean', 'string'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite at ' + at); return; }
  if (typeof value !== 'object') throw new Error(typeof value + ' at ' + at);
  if (Array.isArray(value)) { value.forEach((item, index) => assertLossless(item, at + '[' + index + ']')); return; }
  for (const [key, item] of Object.entries(value)) assertLossless(item, at + '.' + key);
}

const save = async (store, spec) => {
  const result = await store.write(spec);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const readOne = async (store, id) => {
  const result = await store.read([id]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.value.entries[0], '读不到条目 ' + id);
  return result.value.entries[0];
};
const decisions = async store => (await store.list({ limit: 50 })).value.entries.filter(entry => entry.type === 'decision');

test('候选升级时兑现取代意图：旧条目变 superseded，候选就地变 active，返回 superseded', async () => {
  const fixture = memorySqlKernel();
  try {
    const old = await save(fixture.store, { ...base, type: 'decision', body: '旧结论：重试要固定退避' });
    assert.equal(old.status, 'active');
    // 先写推断 + supersedes：这次只记意图，不动旧条目。
    const candidate = await save(fixture.store, { ...base, type: 'decision', confidence: 'inferred', body: '新结论：重试改为固定间隔', supersedes: [old.id] });
    assert.equal(candidate.status, 'candidate');
    assert.deepEqual(candidate.superseded, [], '候选阶段不能取代有效记忆');
    assert.equal((await readOne(fixture.store, old.id)).status, 'active', '候选写入不得改旧条目状态');
    assert.equal((await readOne(fixture.store, candidate.id)).proposedSupersedes, old.id, '取代意图要落进 proposedSupersedes');

    // 同文再写一次 stated：升级，并在同一个事务里把旧条目置 superseded。
    const promoted = await fixture.store.write({ ...base, type: 'decision', body: '新结论：重试改为固定间隔' });
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.value.id, candidate.id, '升级复用候选块，不追加新块');
    assert.equal(promoted.value.promoted, true);
    assert.equal(promoted.value.duplicate, false);
    assert.deepEqual(promoted.value.superseded, [old.id], '返回值要告诉调用方取代了谁');
    assertLossless(promoted.value);

    const oldAfter = await readOne(fixture.store, old.id);
    assert.equal(oldAfter.status, 'superseded');
    assert.equal(oldAfter.supersededBy, candidate.id, '取代链两端都要写，体检才不会报断链');
    const candidateAfter = await readOne(fixture.store, candidate.id);
    assert.equal(candidateAfter.status, 'active');
    assert.equal(candidateAfter.confidence, 'stated');
    assert.equal(candidateAfter.supersedes, old.id);
    assert.equal(candidateAfter.proposedSupersedes, '', '兑现后清空意图，避免下次重复计算');

    // 只有两条：升级是就地改属性，不是新增第三条。
    const all = await decisions(fixture.store);
    assert.deepEqual(all.map(entry => [entry.id, entry.status]).sort(), [[old.id, 'superseded'], [candidate.id, 'active']].sort());
  } finally { fixture.close(); }
});

test('候选没有取代意图时，升级行为与 v5 完全一致（superseded 为空，别的条目不被动）', async () => {
  const fixture = memorySqlKernel();
  try {
    const bystander = await save(fixture.store, { ...base, type: 'decision', body: '与本条无关的有效决策' });
    const candidate = await save(fixture.store, { ...base, type: 'decision', confidence: 'inferred', body: '也许该把重试改成固定间隔' });
    const promoted = await fixture.store.write({ ...base, type: 'decision', body: '也许该把重试改成固定间隔' });
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.value.id, candidate.id);
    assert.equal(promoted.value.promoted, true);
    assert.deepEqual(promoted.value.superseded, []);
    assert.equal((await readOne(fixture.store, candidate.id)).status, 'active');
    assert.equal((await readOne(fixture.store, bystander.id)).status, 'active', '没有提出取代就不能碰别的条目');
  } finally { fixture.close(); }
});

test('重启后（本机没有写入凭据）升级同样兑现取代意图', async () => {
  const fixture = memorySqlKernel();
  try {
    const old = await save(fixture.store, { ...base, type: 'fact', body: '旧事实：追加块会拆成多块' });
    const candidate = await save(fixture.store, { ...base, type: 'fact', confidence: 'inferred', body: '新事实：追加前必须连成单块', supersedes: [old.id] });
    // 新 store 等于宿主重启：内存里的 receipts / ring 全空，只能靠 SQL 指纹与属性找到候选。
    const restarted = fixture.makeStore();
    const promoted = await restarted.write({ ...base, type: 'fact', body: '新事实：追加前必须连成单块' });
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.value.id, candidate.id);
    assert.deepEqual(promoted.value.superseded, [old.id]);
    assert.ok(!('docId' in promoted.value), '重启后没有本机凭据，不能带 undefined 的 docId 键');
    assertLossless(promoted.value);
    assert.equal((await readOne(restarted, old.id)).status, 'superseded');
    assert.equal((await readOne(restarted, old.id)).supersededBy, candidate.id);
  } finally { fixture.close(); }
});

test('候选提出的目标已经失效（被撤销/被取代）时，升级照常完成且跳过它', async () => {
  const fixture = memorySqlKernel();
  try {
    const old = await save(fixture.store, { ...base, type: 'decision', body: '会被撤销的旧结论' });
    const candidate = await save(fixture.store, { ...base, type: 'decision', confidence: 'inferred', body: '稳定的新结论', supersedes: [old.id] });
    const current = await readOne(fixture.store, old.id);
    assert.equal((await fixture.store.setStatus({ id: old.id, status: 'revoked', expectedRevision: current.revision })).ok, true);
    const promoted = await fixture.store.write({ ...base, type: 'decision', body: '稳定的新结论' });
    assert.equal(promoted.ok, true, '目标已经不在有效状态不该让升级卡死：' + JSON.stringify(promoted));
    assert.equal(promoted.value.promoted, true);
    assert.deepEqual(promoted.value.superseded, [], '已经失效的目标不需要再写一次 superseded');
    const after = await readOne(fixture.store, candidate.id);
    assert.equal(after.status, 'active');
    assert.equal(after.proposedSupersedes, '', '不再适用的意图也要清掉，否则每次升级都重算');
    assert.equal((await readOne(fixture.store, old.id)).status, 'revoked', '撤销状态不能被升级改写');
  } finally { fixture.close(); }
});

test('候选记录的取代目标换了范围时报 scope_mismatch，且不动任何条目', async () => {
  const fixture = memorySqlKernel();
  try {
    const body = '跨项目候选的正文';
    // 直接种一个「历史遗留」的候选：proposedSupersedes 指向另一个项目的条目。
    // 正常写入路径不可能造出这种数据（写候选时就校验过范围），这里模拟旧版本/迁移留下的脏值。
    const foreignId = '20261110120000-0000001';
    const candidateId = '20261110120001-0000002';
    fixture.seed([
      { id: foreignId, type: 'decision', project: 'q', workspace: '/w/q', status: 'active', confidence: 'stated', source: 'fixture', body: '另一个项目的结论' },
      { id: candidateId, type: 'decision', project: 'p', workspace: '/w/p', status: 'candidate', confidence: 'inferred', source: 'fixture',
        body, fingerprint: memoryFingerprint({ workspace: '/w/p', project: 'p', topic: '', type: 'decision', body }), proposedSupersedes: foreignId },
    ]);
    const promoted = await fixture.store.write({ ...base, type: 'decision', body });
    assert.equal(promoted.ok, false, JSON.stringify(promoted));
    assert.equal(promoted.error.code, 'scope_mismatch', JSON.stringify(promoted));
    assert.equal((await readOne(fixture.store, candidateId)).status, 'candidate', '报错时不改候选');
    assert.equal((await readOne(fixture.store, foreignId)).status, 'active', '报错时不得动别的项目的条目');
  } finally { fixture.close(); }
});

test('升级事务中途失败会回滚：候选仍在候选、旧条目仍 active，原样重试能成功', async () => {
  const fixture = memorySqlKernel();
  try {
    const old = await save(fixture.store, { ...base, type: 'decision', body: '失败注入用的旧结论' });
    const candidate = await save(fixture.store, { ...base, type: 'decision', confidence: 'inferred', body: '失败注入用的新结论', supersedes: [old.id] });
    let armed = false, injected = false;
    fixture.control.after = (api, payload) => {
      if (!injected && api.endsWith('/setBlockAttrs') && payload.id === old.id && payload.attrs?.[A.status] === 'superseded') armed = true;
    };
    fixture.control.before = (api, payload) => {
      if (armed && api.endsWith('/getBlockAttrs') && payload.id === old.id) { armed = false; injected = true; return { ok: false, error: { code: 'network', message: '属性确认读取失败' } }; }
    };
    const failed = await fixture.store.write({ ...base, type: 'decision', body: '失败注入用的新结论' });
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.match(failed.error.message, /候选升级未完成/u, JSON.stringify(failed));
    assert.equal((await readOne(fixture.store, candidate.id)).status, 'candidate', '回滚后候选不能变 active');
    assert.equal((await readOne(fixture.store, old.id)).status, 'active', '回滚后旧条目不能留在 superseded');
    assert.equal((await readOne(fixture.store, old.id)).supersededBy, '');
    // 恢复后原样重试：同一条候选就地升级，仍然兑现取代意图。
    const retry = await fixture.store.write({ ...base, type: 'decision', body: '失败注入用的新结论' });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.value.id, candidate.id);
    assert.deepEqual(retry.value.superseded, [old.id]);
    assert.equal((await readOne(fixture.store, old.id)).status, 'superseded');
  } finally { fixture.close(); }
});
