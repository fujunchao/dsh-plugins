import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memorySqlKernel } from './helpers/memory-sql-kernel.mjs';
import { createMemorySessions } from '../lib/memory-sessions.js';
import { MEMORY_ATTRS } from '../lib/memory.js';
import { memoryApprovalHash } from '../lib/memory-policy.js';
import { runDistill } from '../lib/distill.js';

export const auditScope = { workspace: '/audit/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/audit/p' } };
const scope = auditScope;
const confirmed = { confirmed: true };
const spec = { scope, project: 'p', source: 'user:design-test', confidence: 'stated' };
const body = title => `${title}\n- 下一步：验收\n- 待决：无`;
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const msg = (text, id) => ({ ...(id ? { id } : {}), role: 'user', content: [{ type: 'text', text }] });

function sessionFixture(outputs = []) {
  let messages = []; const prompts = [], writes = [];
  const store = { sectionText: async () => '[记忆] 测试索引', revision: () => 0,
    changesSince: () => ({ entries: [], complete: true, revision: 0 }), list: async () => ({ ok: true, value: { entries: [] } }),
    approvalContext: async id => ({ ok: true, value: { candidate: { ...writes.at(-1), id, revision: 'fixture-version' }, conflicts: [] } }),
    write: async entry => { writes.push(entry); return { ok: true, value: { id: 'saved' } }; } };
  const agent = { session: { id: 'design-session', header: { cwd: scope.workspace }, deriveMessages: () => messages,
    requestHeader: () => ({ config: { provider: 'fake', model: 'fake' } }) } };
  const sessions = createMemorySessions({ store: () => store, resolveScope: async () => scope,
    getService: name => name === 'llm' ? { stream: async function* (input) {
      const index = prompts.length; prompts.push(input.messages[0].content[0].text);
      yield { type: 'text-delta', text: outputs[index] ?? '[]' };
    } } : undefined });
  return { sessions, agent, prompts, writes, set: next => { messages = next; } };
}

test('A1：未索引状态已删除时直读对账，解除幽灵约束', async () => {
  let clock = 2_000_000; const f = memorySqlKernel({ indexed: false, now: () => clock });
  try {
    const old = value(await f.store.write({ ...spec, type: 'state', topic: 'release', body: body('旧进度') }, confirmed));
    f.kernel.blocks.delete(old.id); f.control.indexed = true; clock += 86_400_000;
    assert.equal(value(await f.store.search({ scope, type: 'state' })).results.length, 0);
    assert.deepEqual(value(await f.store.read([old.id])).missing, [old.id]);
    value(await f.store.write({ ...spec, type: 'state', topic: 'release', body: body('新进度') }, confirmed));
  } finally { f.store.dispose(); f.close(); }
});

test('A1：对账失联不清除有效状态约束，也不把旧缓存当当前正文', async () => {
  let clock = 2_000_000; const f = memorySqlKernel({ indexed: false, now: () => clock });
  try {
    value(await f.store.write({ ...spec, type: 'state', topic: 'release', body: body('旧进度') }, confirmed));
    clock += 20_000;
    f.control.before = api => api.endsWith('/getBlockInfo') ? { ok: false, error: { code: 'network', message: '连接中断' } } : null;
    assert.equal((await f.store.read([...f.kernel.blocks.keys()])).ok, false);
    f.control.before = null;
    // 旧状态仍被记得：新状态自动取代它，而不是并列出第二条有效状态。
    const next = value(await f.store.write({ ...spec, type: 'state', topic: 'release', body: body('新进度') }, confirmed));
    assert.deepEqual(next.superseded, [...f.kernel.blocks.keys()].filter(id => id !== next.id));
    assert.equal(next.superseded.length, 1);
  } finally { f.store.dispose(); f.close(); }
});

for (const hasIds of [true, false]) test(`A2：压缩后 A→B→A 不漏掉新事件（稳定ID=${hasIds}）`, async () => {
  const f = sessionFixture();
  const m = (text, id) => msg(text, hasIds ? id : undefined);
  try {
    f.set([m('决定采用方案 A', 'one')]); await f.sessions.start(f.agent); await f.sessions.distill(f.agent);
    f.set([m('决定采用方案 A', 'one'), m('决定采用方案 B', 'two')]); await f.sessions.distill(f.agent);
    f.set([m('压缩摘要：当前为方案 B', 'summary')]); await f.sessions.distill(f.agent);
    f.set([m('压缩摘要：当前为方案 B', 'summary'), m('决定采用方案 A', 'three')]);
    await f.sessions.distill(f.agent);
    assert.equal(f.prompts.length, 4); assert.ok(f.prompts.at(-1).includes('决定采用方案 A'));
    await f.sessions.distill(f.agent); assert.equal(f.prompts.length, 4);
  } finally { f.sessions.dispose(); }
});

test('A3：一条格式错误只丢这一条，其余照常写入并推进进度；整段不可解析才保留批次重试', async () => {
  // 以前一条不合格整批不推进，手动重试会永远卡在同一批；现在只丢不合格的那一条。
  const outputs = [JSON.stringify([{ type: 'fact', project: 'p', text: '验证完成' },
    { type: 'state', project: 'p', topic: 'release', statement: body('未发布') }]),
    JSON.stringify([{ type: 'state', project: 'p', topic: 'release', text: body('未发布') }])];
  const f = sessionFixture(outputs);
  try {
    f.set([msg('验证完成，但仍未发布', 'one')]); await f.sessions.start(f.agent);
    const first = await f.sessions.distill(f.agent);
    assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.written, 1);
    assert.match(first.dropped[0].message, /缺少非空 text/u);
    assert.equal(f.prompts.length, 1); assert.equal(f.writes.at(-1).type, 'fact');
    assert.equal((await f.sessions.distill(f.agent)).reason, '没有新增内容');
    assert.equal(f.prompts.length, 1);
    // 整段输出不是 JSON：算失败，批次保留，下次重试。
    const g = sessionFixture(['不是数组', JSON.stringify([{ type: 'fact', project: 'p', text: '重试成功' }])]);
    try {
      g.set([msg('另一段内容', 'two')]); await g.sessions.start(g.agent);
      assert.equal((await g.sessions.distill(g.agent)).ok, false);
      assert.equal((await g.sessions.distill(g.agent)).ok, true);
      assert.equal(g.prompts.length, 2); assert.equal(g.writes.at(-1).body, '重试成功');
    } finally { g.sessions.dispose(); }
  } finally { f.sessions.dispose(); }
});

test('D1：写入即生效，只有 inferred 落候选，宣称已核实必须给依据', async () => {
  const f = memorySqlKernel();
  try {
    const saved = value(await f.store.write({ ...spec, type: 'decision', confidence: 'verified', evidence: '不存在.js:999 已通过', body: '决定采用某方案' }));
    assert.equal(saved.status, 'active'); assert.equal(saved.duplicate, false);
    assert.ok((await f.store.sectionText({ scope, force: true })).includes('决定采用某方案'));
    // 「已核实」不能凭空自称：verified 缺 evidence 仍被拒。
    assert.equal((await f.store.write({ ...spec, type: 'fact', confidence: 'verified', body: '拿不出依据的事实' })).error?.code, 'missing_evidence');
    // 只有显式 inferred 才落候选：search 仍能命中，但不进可信条目行。
    const inferred = value(await f.store.write({ ...spec, type: 'fact', confidence: 'inferred', body: '模型自己的推断' }));
    assert.equal(inferred.status, 'candidate');
    const snapshot = await f.store.sectionText({ scope, force: true });
    assert.ok(!snapshot.split('候选（未核实）：')[0].includes('模型自己的推断'));
    assert.ok(snapshot.split('候选（未核实）：')[1].includes('模型自己的推断'));
    assert.ok(!value(await f.store.list({ scope, trusted: true })).entries.some(entry => entry.id === inferred.id));
    assert.ok(value(await f.store.search({ scope, query: '模型自己的推断' })).results.some(entry => entry.id === inferred.id));
    // 同文再写一次并明确 stated：候选升级为有效，不需要第二次确认调用。
    const promoted = value(await f.store.write({ ...spec, type: 'fact', body: '模型自己的推断' }));
    assert.equal(promoted.promoted, true); assert.equal(promoted.duplicate, false);
    assert.equal(value(await f.store.read([inferred.id])).entries[0].status, 'active');
  } finally { f.store.dispose(); f.close(); }
});

test('D6：外部改正文仍被发现，但不再因此把条目踢出注入', async () => {
  const f = memorySqlKernel();
  try {
    // 旧时代写入的条目带确认哈希：外部改正文后 trust 变成 changed，只作信息字段。
    f.seed([{ ...spec, workspace: scope.workspace, id: '20261110090000-0000701', type: 'decision', status: 'active', body: '仅离线部署', evidence: '旧依据' }]);
    let entry = value(await f.store.list({ scope })).entries[0];
    f.kernel.blocks.get(entry.id).attrs[MEMORY_ATTRS.approvalHash] = memoryApprovalHash(entry);
    entry = value(await f.store.list({ scope })).entries[0];
    assert.equal(entry.trust, 'confirmed');
    f.kernel.blocks.get(entry.id).body = '支持公网部署';
    const changed = value(await f.store.list({ scope })).entries[0];
    assert.equal(changed.trust, 'changed'); assert.notEqual(changed.revision, entry.revision);
    assert.equal(changed.reviewRequired, false);
    // 外部改动照常注入：复核下线后不再有「改过就不许进常驻」这条岔路。
    assert.ok((await f.store.sectionText({ scope, force: true })).includes('支持公网部署'));
    // approve 只服务候选，不再有「带版本重新确认已生效条目」这条路径。
    assert.equal((await f.store.approve({ id: changed.id, expectedRevision: changed.revision, confidence: 'stated' })).error?.code, 'invalid_status');
    // 新写入不再产生确认哈希与确认时间，trust 恒为 legacy。
    const saved = value(await f.store.write({ ...spec, type: 'decision', body: '仅内网部署' }, confirmed));
    const fresh = value(await f.store.read([saved.id])).entries[0];
    assert.equal(fresh.approvalHash, ''); assert.equal(fresh.approvedAt, '');
    assert.equal(fresh.trust, 'legacy'); assert.equal(fresh.reviewRequired, false);
  } finally { f.store.dispose(); f.close(); }
});

test('D6：历史未绑定条目照常注入，trust=legacy 只是信息字段', async () => {
  const f = memorySqlKernel();
  try {
    f.seed([{ ...spec, id: '20261110090000-0000700', workspace: scope.workspace, type: 'preference', status: 'active', body: '历史偏好' }]);
    const legacy = value(await f.store.list()).entries[0];
    assert.equal(legacy.trust, 'legacy'); assert.equal(legacy.approvalHash, '');
    assert.equal(legacy.reviewRequired, false); assert.equal(legacy.reviewReason, '');
    const snapshot = await f.store.sectionText({ scope, force: true });
    assert.ok(snapshot.includes('历史偏好'));
    // 注入文本不再带条目 id，因此也不会登记「外部核对 watch」。
    assert.ok(!/\b\d{14}-[a-z0-9]{7}\b/u.test(snapshot));
    assert.ok(value(await f.store.handoff({ scope })).markdown.includes('历史偏好'));
    assert.ok(value(await f.store.list({ scope, trusted: true })).entries.some(entry => entry.id === legacy.id));
  } finally { f.store.dispose(); f.close(); }
});

test('D6：外部删除已索引条目后，已有会话得到失效提醒', async () => {
  let clock = 2_000_000; const f = memorySqlKernel({ now: () => clock });
  const sessions = createMemorySessions({ store: () => f.store, now: () => clock, resolveScope: async () => scope });
  const agent = { session: { id: 'watch-delete', header: { cwd: scope.workspace }, deriveMessages: () => [] } };
  try {
    const saved = value(await f.store.write({ ...spec, type: 'preference', body: '已确认偏好' }, confirmed));
    await sessions.start(agent); assert.ok(sessions.section({ agent }).includes('已确认偏好'));
    // 注入文本里没有条目 id，watch 只来自模型显式读取：宿主在 memory_read 之后登记。
    assert.ok(!sessions.section({ agent }).includes(saved.id));
    sessions.watch(agent, [saved.id]);
    f.kernel.blocks.delete(saved.id); clock += 31_000;
    sessions.context({ agent }); await sessions.prepare(agent);
    const hint = sessions.context({ agent });
    assert.match(hint, /已失效/u); assert.ok(hint.includes(saved.id));
    assert.match(hint, /「已确认偏好」.*已被撤销/u, '提醒带结论首句，模型能对上索引里的那一行');
    // 同一步内多次求值结果一致（宿主最后一次求值才发给模型）。
    assert.equal(sessions.context({ agent }), hint); assert.equal(sessions.hint({ agent }), hint);
    // 冻结索引里仍列着这条：轮末之后提醒继续保留，不会让模型下一轮又照旧索引引用。
    await sessions.stop(agent);
    assert.ok(sessions.context({ agent }).includes('已被撤销'));
  } finally { sessions.dispose(); f.store.dispose(); f.close(); }
});

test('D2：星号默认限定当前工作区，只有明确全局才跨项目', async () => {
  const f = memorySqlKernel();
  const other = { workspace: '/audit/q', project: 'q', projects: ['*', 'q'], projectRoots: { q: '/audit/q' } };
  try {
    const saved = value(await f.store.write({ ...spec, project: '*', type: 'decision', body: '归属待定的决定' }));
    const entry = value(await f.store.read([saved.id])).entries[0];
    assert.equal(entry.workspace, scope.workspace);
    assert.ok(!(await f.store.sectionText({ scope: other, force: true })).includes('归属待定的决定'));
    assert.ok((await f.store.sectionText({ scope, force: true })).includes('归属待定的决定'));
    const global = value(await f.store.write({ ...spec, project: '*', global: true, type: 'preference', body: '通用中文偏好' }));
    assert.equal(value(await f.store.read([global.id])).entries[0].workspace, '*');
    assert.ok((await f.store.sectionText({ scope, force: true })).includes('通用中文偏好'));
    assert.ok((await f.store.sectionText({ scope: other, force: true })).includes('通用中文偏好'));
  } finally { f.store.dispose(); f.close(); }
});

test('D5：主题常见拼写复用同一身份，目录 ID 可用于后续候选', async () => {
  const f = memorySqlKernel();
  try {
    const saved = value(await f.store.write({ ...spec, type: 'state', topic: 'Release_Check', body: body('未完成') }, confirmed));
    const renamed = value(await f.store.write({ ...spec, type: 'state', topic: 'release-check', body: body('已完成') }, confirmed));
    assert.deepEqual(renamed.superseded, [saved.id], '拼写不同的同一主题自动取代旧状态');
    const directory = value(await f.store.topics({ scope }));
    const topic = directory.topics[0]; assert.ok(topic.id); assert.equal(topic.topic, 'release-check');
    // 候选可以复用目录里的 topicId：它只是待核实的推断，不抢占当前有效状态。
    const proposed = value(await f.store.write({ ...spec, type: 'state', confidence: 'inferred', topicId: topic.id, body: body('新候选') }));
    assert.equal(proposed.status, 'candidate');
    const comparison = value(await f.store.approvalContext(proposed.id));
    assert.equal(comparison.candidate.topicId, topic.id); assert.ok(comparison.conflicts.some(entry => entry.id === renamed.id));
    assert.equal((await f.store.write({ ...spec, type: 'state', topicId: 'invented', body: body('虚构身份') })).error?.code, 'invalid_topic');
  } finally { f.store.dispose(); f.close(); }
});

test('D1：取代时传了版本就校验，候选只留取代建议、确认后才动旧条目', async () => {
  const f = memorySqlKernel();
  try {
    const old = value(await f.store.write({ ...spec, type: 'decision', body: '旧决定' }, confirmed));
    const previous = value(await f.store.read([old.id])).entries[0];
    // 传了过期版本直接拒绝，旧条目保持有效。
    assert.equal((await f.store.write({ ...spec, type: 'decision', body: '新决定', supersedes: [old.id], expectedRevisions: { [old.id]: 'stale' } })).error?.code, 'revision_conflict');
    assert.equal(value(await f.store.read([old.id])).entries[0].status, 'active');
    // 候选只保存取代建议，不改变旧条目；确认时才真正取代。
    const proposal = value(await f.store.write({ ...spec, type: 'decision', confidence: 'inferred', status: 'candidate',
      body: '新决定', supersedes: [old.id], expectedRevisions: { [old.id]: previous.revision } }));
    assert.equal(proposal.status, 'candidate');
    assert.equal(value(await f.store.read([old.id])).entries[0].status, 'active');
    const context = value(await f.store.approvalContext(proposal.id));
    assert.ok(context.conflicts.some(entry => entry.id === old.id));
    value(await f.store.approve({ id: proposal.id, confidence: 'stated', expectedRevision: context.candidate.revision,
      supersedes: [old.id], expectedRevisions: { [old.id]: context.conflicts[0].revision } }));
    assert.equal(value(await f.store.read([old.id])).entries[0].status, 'superseded');
    // 有效写入带正确版本时一次调用完成取代，取代链两端都补齐。
    const current = value(await f.store.read([proposal.id])).entries[0];
    const immediate = value(await f.store.write({ ...spec, type: 'decision', body: '最终决定', supersedes: [proposal.id], expectedRevisions: { [proposal.id]: current.revision } }));
    assert.equal(immediate.status, 'active'); assert.deepEqual(immediate.superseded, [proposal.id]);
    const replaced = value(await f.store.read([proposal.id])).entries[0];
    assert.equal(replaced.status, 'superseded'); assert.equal(replaced.supersededBy, immediate.id);
  } finally { f.store.dispose(); f.close(); }
});

test('D3：过期状态只进体检报告，不再影响注入、搜索与交接', async () => {
  let clock = Date.UTC(2026, 8, 1, 4); const f = memorySqlKernel({ now: () => clock });
  try {
    const saved = value(await f.store.write({ ...spec, type: 'state', topic: 'release', body: body('等待发布') }, confirmed));
    clock = Date.UTC(2026, 10, 10, 4);
    const entry = value(await f.store.read([saved.id])).entries[0];
    assert.equal(entry.stale, true); assert.equal(entry.reviewRequired, false);
    assert.ok((await f.store.sectionText({ scope, force: true })).includes('等待发布'));
    assert.ok(value(await f.store.search({ scope, query: '等待发布' })).results.some(item => item.id === saved.id && !('reviewRequired' in item) && !('trust' in item)));
    const handoff = value(await f.store.handoff({ scope })).markdown;
    assert.ok(handoff.includes('等待发布')); assert.ok(handoff.includes('## 当前状态与待办'));
    assert.ok(!handoff.includes('历史条目，使用前复核'));
    // 过期只作为体检信息：早于 30 天的有效状态列进 staleStates，但状态照旧有效、照常注入。
    f.seed([{ ...spec, id: '20260501000000-0000703', workspace: scope.workspace, type: 'state', topic: 'legacy-release', status: 'active', body: body('早期状态') }]);
    const stale = value(await f.store.checkup({ scope, now: clock })).staleStates.find(item => item.id === '20260501000000-0000703');
    assert.ok(stale); assert.ok(stale.ageDays >= 30);
    assert.equal(value(await f.store.read(['20260501000000-0000703'])).entries[0].status, 'active');
    assert.ok((await f.store.sectionText({ scope, force: true })).includes('早期状态'));
    // 「待复核」不复存在：已生效条目不接受确认入口。
    assert.equal((await f.store.approve({ id: saved.id, expectedRevision: entry.revision, confidence: 'stated' })).error?.code, 'invalid_status');
  } finally { f.store.dispose(); f.close(); }
});

test('D4：较新的全局条目不能挤掉当前项目约束', async () => {
  let clock = Date.UTC(2026, 10, 1); const f = memorySqlKernel({ now: () => clock });
  try {
    value(await f.store.write({ ...spec, type: 'preference', body: '交付必须使用离线包' }, confirmed));
    for (let i = 0; i < 8; i++) { clock += 1000; value(await f.store.write({ ...spec, project: '*', global: true, type: 'preference', body: `通用排版偏好 ${i}` }, confirmed)); }
    const text = await f.store.sectionText({ scope, force: true });
    assert.ok(text.includes('交付必须使用离线包')); assert.ok(text.length <= 900);
  } finally { f.store.dispose(); f.close(); }
});

test('新主题的自动整理可首次入库，不把宿主派生 ID 误认为模型复用 ID', async () => {
  const f = memorySqlKernel();
  try {
    const result = await runDistill({ provider: 'fake', model: 'fake', sessionId: 'new-topic', transcript: '新任务已经开始', scope, projects: scope.projects,
      stream: async function* () { yield { type: 'text-delta', text: JSON.stringify([{ type: 'state', project: 'p', topic: 'new-task', text: body('新任务进展') }]) }; },
      write: input => f.store.write(input) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.written, 1); assert.equal(value(await f.store.topics({ scope })).topics[0].topic, 'new-task');
  } finally { f.store.dispose(); f.close(); }
});

test('外部撤销删除后，明确读取原 ID 可以解除本地删除标记', async () => {
  const f = memorySqlKernel();
  try {
    const saved = value(await f.store.write({ ...spec, type: 'fact', body: '可恢复的事实' }, confirmed));
    await f.store.list(); const original = structuredClone(f.kernel.blocks.get(saved.id));
    f.kernel.blocks.delete(saved.id); value(await f.store.reconcile([saved.id]));
    assert.deepEqual(value(await f.store.read([saved.id])).missing, [saved.id]);
    f.kernel.blocks.set(saved.id, original);
    assert.equal(value(await f.store.read([saved.id])).entries[0]?.body, '可恢复的事实');
  } finally { f.store.dispose(); f.close(); }
});

test('撤销候选后可以恢复为候选，恢复不能把推断条目变成可信', async () => {
  const f = memorySqlKernel();
  try {
    const saved = value(await f.store.write({ ...spec, type: 'fact', confidence: 'inferred', body: '待核实的事实' }));
    assert.equal(value(await f.store.read([saved.id])).entries[0].status, 'candidate');
    value(await f.store.setStatus({ id: saved.id, status: 'revoked' }));
    // 恢复只把推断条目放回候选，不会顺手抬成有效。
    assert.equal(value(await f.store.setStatus({ id: saved.id, status: 'active' })).status, 'candidate');
    assert.equal(value(await f.store.read([saved.id])).entries[0].status, 'candidate');
    // 候选要生效必须走核对入口：setStatus 绕不过去。
    assert.equal((await f.store.setStatus({ id: saved.id, status: 'active' })).error?.code, 'confirmation_required');
    const context = value(await f.store.approvalContext(saved.id));
    value(await f.store.approve({ id: saved.id, confidence: 'stated', expectedRevision: context.candidate.revision }));
    const approved = value(await f.store.read([saved.id])).entries[0];
    assert.equal(approved.status, 'active'); assert.equal(approved.confidence, 'stated');
    assert.equal(approved.reviewRequired, false);
  } finally { f.store.dispose(); f.close(); }
});
