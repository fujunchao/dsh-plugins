// v7-B：召回命中项已在常驻索引时不再整块消失，补一行带 id 的「索引内」提示。
// 用真实 createMemorySessions 驱动（假 store / 假 agent），断言真正发给模型的那段文本。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemorySessions } from '../lib/memory-sessions.js';

const scope = { workspace: '/workspace/p', project: '*', projects: ['*', 'p'], projectRoots: { p: '/workspace/p' } };
const LONG = '结论甲：' + '细节'.repeat(40);   // > 60 字，用来验证索引内行只给短结论

const entry = (id, statement, extra = {}) => ({ id, type: 'fact', project: 'p', status: 'active', created: '20261110000000', statement, ...extra });
const indexed = [
  entry('20261110000001-aaaaaaa', LONG, { type: 'state', created: '20261111000000' }),
  entry('20261110000002-bbbbbbb', '结论乙：图片卡片已经全部通过验收', { type: 'decision' }),
  entry('20261110000003-ccccccc', '结论丙：SQL 索引最多滞后 2.4 秒'),
];
const fresh = [
  entry('20261109000001-ddddddd', '新结论丁：外部变更闸门要比较空保存点', { type: 'decision', created: '20261109000000' }),
  entry('20261109000002-eeeeeee', '新结论戊：分段编辑器走纯函数'),
  entry('20261109000003-fffffff', '新结论己：写入工具只提供新增'),
  entry('20261109000004-ggggggg', '新结论庚：不该出现的第四条'),
];
// 常驻索引里只有结论、没有 id：这里用结论前 30 字构造真实的 section。
const section = '【索引】' + indexed.map(item => item.statement.slice(0, 30)).join(' | ');

function fixture(entries, { sectionText = section, recall } = {}) {
  const calls = [];
  const store = {
    sectionText: async () => sectionText,
    revision: () => 0,
    changesSince: () => ({ revision: 0, complete: true, entries: [] }),
    list: async () => ({ ok: true, value: { entries: [], complete: true } }),
    recall: async input => {
      calls.push(input);
      if (recall) return recall(input, calls.length);
      return { ok: true, value: { entries } };
    },
  };
  const sessions = createMemorySessions({ store: () => store, resolveScope: async () => scope, isRoot: () => true, now: Date.now });
  const agent = { id: 'agent', session: { id: 'v7-recall', header: { cwd: '/workspace/p' },
    deriveMessages: () => [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '记忆插件改造做得怎么样了' }] }] } };
  return { sessions, agent, calls };
}
const bullets = hint => hint.split('\n').filter(line => line.startsWith('- '));

test('B：最强命中在常驻索引里时，提示补一行带 id 的「索引内」，只给 60 字结论', async () => {
  const f = fixture([indexed[0], fresh[0]]);
  try {
    await f.sessions.prepare(f.agent);
    const hint = f.sessions.context({ agent: f.agent });
    assert.match(hint, /\[相关记忆\]/u);
    // 索引外的先排，索引内的补在后面。
    assert.equal(bullets(hint).length, 2, hint);
    assert.match(hint, new RegExp('- ' + fresh[0].id + ' \\[决策·p · 11-09\\] 新结论丁', 'u'));
    const indexLine = bullets(hint).find(line => line.includes('索引内'));
    assert.ok(indexLine, '必须有「索引内」行：' + hint);
    assert.ok(indexLine.includes(indexed[0].id), '索引内行要带 id：' + indexLine);
    assert.match(indexLine, /^- 20261110000001-aaaaaaa \[状态·p · 索引内\] /u);
    assert.ok(!indexLine.includes(LONG), '不能重复整段正文：' + indexLine);
    assert.ok(indexLine.includes(LONG.slice(0, 60)), '保留 60 字结论：' + indexLine);
    assert.ok(indexLine.endsWith('…'), '超过 60 字要截断：' + indexLine);
  } finally { f.sessions.dispose(); }
});

test('B：全部命中都在索引外时格式不变（仍是 recallLine），且没有「索引内」', async () => {
  const f = fixture(fresh);
  try {
    await f.sessions.prepare(f.agent);
    const hint = f.sessions.context({ agent: f.agent });
    assert.equal(bullets(hint).length, 3, '最多 3 行：' + hint);
    assert.ok(!hint.includes('索引内'), hint);
    assert.match(hint, /\[决策·p · 11-09\] 新结论丁/u);
    assert.ok(!hint.includes(fresh[3].id), '第 4 条不该出现');
  } finally { f.sessions.dispose(); }
});

test('B：索引外不足 3 条时，用剩余名额补索引内行，总行数仍 ≤3', async () => {
  const f = fixture([...indexed, ...fresh.slice(0, 2)]);
  try {
    await f.sessions.prepare(f.agent);
    const hint = f.sessions.context({ agent: f.agent });
    const lines = bullets(hint);
    assert.equal(lines.length, 3, '2 条新命中 + 1 条索引内 = 3：' + hint);
    assert.equal(lines.filter(line => line.includes('索引内')).length, 1);
    assert.ok(hint.includes(indexed[0].id), '索引内优先用最强的（第一条）');
    assert.ok(!hint.includes(indexed[1].id), '名额只有 1 个，第二条索引内不该出现');
  } finally { f.sessions.dispose(); }
});

test('B：没有任何命中时仍然静默（不产生空提示块）', async () => {
  const f = fixture([]);
  try {
    await f.sessions.prepare(f.agent);
    assert.equal(f.sessions.context({ agent: f.agent }), '');
    assert.equal(f.calls.length, 1);
  } finally { f.sessions.dispose(); }
});

test('B：召回的失败重试与换话失效逻辑不受影响（失败时不出索引内行，重试成功后才出）', async () => {
  let attempt = 0;
  const f = fixture([indexed[0]], { recall: () => (++attempt === 1
    ? { ok: false, error: { code: 'upstream_unreachable', message: '查询超时' } }
    : { ok: true, value: { entries: [indexed[0]] } }) });
  try {
    await f.sessions.prepare(f.agent);
    assert.equal(f.sessions.context({ agent: f.agent }), '', '失败时这一步什么都别发');
    assert.equal(f.sessions.diagnostics('v7-recall').recall.failures, 1);
    await f.sessions.prepare(f.agent);
    const hint = f.sessions.context({ agent: f.agent });
    assert.match(hint, /索引内/u, '重试成功后才补索引内行：' + hint);
    assert.equal(f.sessions.diagnostics('v7-recall').recall.failures, 0);
    await f.sessions.prepare(f.agent);
    assert.equal(f.calls.length, 2, '成功后同一段发言不再查');
  } finally { f.sessions.dispose(); }
});
