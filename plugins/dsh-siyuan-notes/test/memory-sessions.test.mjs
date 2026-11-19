import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemorySessions } from '../lib/memory-sessions.js';

const agent = (id, ratio = .1) => ({ session: { id, cwd: '/fake/' + id, ratio,
  deriveMessages() { return [{ role: 'user', content: [{ type: 'text', text: this.transcript ?? '已决定采用方案A' }] }]; },
  requestHeader() { return { config: { provider: 'fake', model: 'fake' } }; } } });
const scope = async cwd => ({ workspace: cwd, project: cwd.split('/').at(-1), projects: ['*', cwd.split('/').at(-1)], projectRoots: { [cwd.split('/').at(-1)]: cwd } });
function fixture(options = {}) {
  let version = 0;
  const calls = [];
  const store = { sectionText: async ({ scope }) => '快照:' + scope.project + ':' + version, revision: () => 0,
    changesSince: () => ({ revision: 0, complete: true, entries: [] }), list: async () => ({ ok: true, value: { entries: [], complete: true } }),
    write: async spec => { calls.push({ written: spec }); return { ok: true, value: { id: 'memory-id' } }; } };
  const sessions = createMemorySessions({ store: () => store, resolveScope: scope, now: options.now, getService(name) {
    if (name === 'tokenMeter') return { contextPressure: session => ({ pressureTokens: session.ratio * 100, contextWindow: 100 }) };
    if (name === 'llm') return { stream: async function* (options) { calls.push({ prompt: options.messages[0].content[0].text, sessionId: options.sessionId }); yield { type: 'text-delta', text: '[]' }; } };
  } });
  return { sessions, calls, bump: () => version++ };
}

test('B会话创建、写入和压力变化均不修改A快照或压力', async () => {
  const f = fixture(), a = agent('A', .7), b = agent('B', .1);
  await f.sessions.start(a);
  const before = f.sessions.section({ agent: a });
  f.bump(); await f.sessions.start(b);
  assert.equal(f.sessions.section({ agent: a }), before);
  assert.notEqual(f.sessions.section({ agent: b }), before);
  assert.match(f.sessions.context({ agent: a }), /60%/);
  assert.ok(!f.sessions.context({ agent: b }).includes('60%'));
  f.sessions.wrote(b);
  assert.equal(f.sessions.diagnostics('A').pressure.wroteThisTurn, false);
  f.sessions.dispose();
});

test('压缩前85%捕获的文本在轮末整理时完整进入 prompt，不被压缩后的摘要替换', async () => {
  const f = fixture(), a = agent('A', .85);
  a.session.transcript = '压缩前唯一的决定证据';
  await f.sessions.start(a);
  assert.match(f.sessions.context({ agent: a }), /75%/);
  a.session.ratio = .25;
  a.session.transcript = '压缩后的笼统摘要';
  await f.sessions.stop(a);
  await f.sessions.idle('A');
  const prompts = f.calls.filter(call => call.prompt);
  // 契约 §5：一次自动整理只调用一次模型，没有第二次复核调用。
  assert.equal(prompts.length, 1);
  // 轮末会话里只剩压缩后的摘要，但 85% 时同步捕获的正文仍完整进入 prompt——
  // 整理用的是压缩前捕获的副本，不是重新去读已被压缩的会话。
  assert.ok(prompts[0].prompt.includes('压缩前唯一的决定证据'));
  assert.equal(prompts[0].prompt.split('压缩前唯一的决定证据').length, 2);
  assert.ok(!a.session.deriveMessages()[0].content[0].text.includes('压缩前唯一的决定证据'));
  // 注：压缩后出现的摘要也会作为「新内容」入队（lib 的投影代次设计：宁可重新核对也不漏掉纠正），
  // 所以这里不禁止 prompt 出现摘要；要守的是压缩前的证据没有被摘要替换掉。
  f.sessions.dispose();
});

test('蒸馏冷却按会话隔离，明确不记录会停止后台调用', async () => {
  let clock = 1_000_000;
  const f = fixture({ now: () => clock }), a = agent('A', .85), b = agent('B', .85), c = agent('C', .9);
  const callers = () => f.calls.filter(call => call.prompt).map(call => call.sessionId).sort();
  c.session.transcript = '这段不要记录，测试一个想法';
  await Promise.all([f.sessions.start(a), f.sessions.start(b), f.sessions.start(c)]);
  for (const current of [a, b, c]) f.sessions.context({ agent: current });
  for (const [id, current] of [['A', a], ['B', b], ['C', c]]) { await f.sessions.stop(current); await f.sessions.idle(id); }
  // 同一时刻 A、B 各自整理一次：冷却按会话隔离，一个会话跑过不占用另一个；
  // C 明确要求不记录，后台模型调用根本不发起。
  assert.deepEqual(callers(), ['A', 'B']);
  assert.equal(f.sessions.recording(c), false);
  // 同一会话在 DISTILL_LIMITS.cooldownMs（10 分钟）内不再自动整理。
  clock += 60_000; a.session.transcript = '已决定采用方案A，补充第二段';
  f.sessions.context({ agent: a }); await f.sessions.stop(a); await f.sessions.idle('A');
  assert.deepEqual(callers(), ['A', 'B']);
  assert.equal(f.sessions.diagnostics('A').distill.skipped, 1);
  // 过了冷却、又有新内容且仍逼近压缩，才重新整理。
  clock += 11 * 60_000; a.session.transcript = '已决定采用方案A，补充第三段';
  f.sessions.context({ agent: a }); await f.sessions.stop(a); await f.sessions.idle('A');
  assert.deepEqual(callers(), ['A', 'A', 'B']);
  f.sessions.dispose();
});

test('释放会话后不再保留诊断状态，连接重置取消旧任务', async () => {
  const f = fixture(), a = agent('A'); await f.sessions.start(a);
  f.sessions.remove(a);
  assert.equal(f.sessions.diagnostics('A'), null);
  await f.sessions.start(a); f.sessions.reset();
  assert.equal(f.sessions.diagnostics('A'), null);
  f.sessions.dispose();
});

test('当前宿主的工作目录来自session.header.cwd，不能退到全局', async () => {
  const f=fixture(), a=agent('A');
  a.session.header={cwd:'/actual/project'};delete a.session.cwd;
  await f.sessions.start(a);
  assert.equal((await f.sessions.scope(a)).workspace,'/actual/project');
  assert.ok(f.sessions.section({agent:a}).includes('project'));
  f.sessions.dispose();
});

test('首次装配仅等待短预算，后台索引恢复后升级一次并保持稳定', async () => {
  let release, clock = 1_000, offline = true;
  const gate = new Promise(resolve => release = resolve);
  const store = { revision: () => 0, changesSince: () => ({ revision: 0, complete: true, entries: [] }),
    sectionText: async () => { if (offline) { await gate; return '[记忆] 长期记忆体暂时不可用'; } return '已恢复的索引'; } };
  const sessions = createMemorySessions({ store: () => store, resolveScope: scope, now: () => clock, snapshotWaitMs: 15, snapshotRetryMs: 30 });
  const a = agent('recover');
  try {
    const started = performance.now();
    await sessions.prepare(a);
    assert.ok(performance.now() - started < 200);
    assert.match(sessions.section({ agent: a }), /正在读取/u);
    release(); await sessions.start(a);
    offline = false; clock += 40;
    sessions.context({ agent: a }); await sessions.prepare(a);
    assert.equal(sessions.section({ agent: a }), '已恢复的索引');
    offline = true; clock += 40; sessions.context({ agent: a });
    assert.equal(sessions.section({ agent: a }), '已恢复的索引');
  } finally { release(); sessions.dispose(); }
});

test('没有新增内容时冷却后不再整理，子代理也不自动调用模型', async () => {
  let clock = 1_000_000;
  const calls = [];
  const store = { sectionText: async () => '索引', revision: () => 0, changesSince: () => ({ entries: [], revision: 0, complete: true }), list: async () => ({ ok: true, value: { entries: [] } }) };
  const sessions = createMemorySessions({ store: () => store, resolveScope: scope, now: () => clock, isRoot: a => !a.parentAgent,
    getService: name => name === 'llm' ? { stream: async function* (input) { calls.push(input.messages[0].content[0].text); yield { type: 'text-delta', text: '[]' }; } } : undefined });
  try {
    const root = agent('root'), child = { ...agent('child'), parentAgent: root };
    // 内容攒够阈值（DISTILL_LIMITS.minQueuedChars）才触发自动整理。
    root.session.transcript = '已决定采用方案A。'.repeat(800); child.session.transcript = '子代理的过程内容。'.repeat(800);
    await sessions.stop(root); await sessions.idle('root');
    // 跨过冷却但没有新增内容：仍然不该再整理，子代理也不整理。
    clock += 86_400_000; await sessions.stop(root); await sessions.idle('root');
    await sessions.stop(child); await sessions.idle('child');
    assert.equal(calls.length, 1);
  } finally { sessions.dispose(); }
});

test('每步求值不触发整理；显式整理从最近的消息取材，成功后只处理新增片段', async () => {
  let clock = 1_000_000; const prompts = [];
  const store = { sectionText: async () => '索引', revision: () => 0, changesSince: () => ({ entries: [], revision: 0, complete: true }), list: async () => ({ ok: true, value: { entries: [] } }) };
  const sessions = createMemorySessions({ store: () => store, resolveScope: scope, now: () => clock,
    getService(name) { if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 85, contextWindow: 100 }) };
      if (name === 'llm') return { stream: async function* (input) { prompts.push(input.messages[0].content[0].text); yield { type: 'text-delta', text: '[]' }; } }; } });
  const a = agent('incremental');
  const messages = Array.from({ length: 28 }, (_, index) => ({ role: 'user', content: [{ type: 'text', text: `消息${index}：` + '待保留证据'.repeat(120) }] }));
  a.session.deriveMessages = () => messages;
  try {
    await sessions.start(a); sessions.context({ agent: a }); await sessions.idle(a.session.id);
    // 整理只在轮末判断；每步求值（context）只捕获内容，不发起模型调用。
    assert.equal(prompts.length, 0);
    assert.equal((await sessions.distill(a)).ok, true);
    // 取材受 DISTILL_LIMITS.maxTranscriptChars 限制：第一批必须是最近的内容（用户刚说的话），更早的排在后续批次。
    assert.ok(prompts[0].includes('消息27：')); assert.ok(!prompts[0].includes('消息0：'));
    assert.ok(prompts.at(-1).includes('消息0：'), '一次显式整理最多三批，足以覆盖这段会话的全部内容');
    const previous = prompts.length;
    messages.push({ role: 'user', content: [{ type: 'text', text: '新增进展：已确认交付' }] });
    clock += 700_000;
    sessions.context({ agent: a });
    // 显式整理走 force：不受冷却限制，且只处理成功后新增的片段。
    assert.equal((await sessions.distill(a)).ok, true);
    assert.equal(prompts.length, previous + 1);
    assert.ok(prompts.at(-1).includes('新增进展')); assert.ok(!prompts.at(-1).includes('消息0：'));
  } finally { sessions.dispose(); }
});

test('关闭记录期间的对话在重新开启后不会被补录', async () => {
  let disabled = true; const prompts = [];
  const store = { sectionText: async () => '索引', revision: () => 0, changesSince: () => ({ entries: [], revision: 0, complete: true }), list: async () => ({ ok: true, value: { entries: [] } }) };
  const sessions = createMemorySessions({ store: () => store, resolveScope: scope, recordingDisabled: () => disabled,
    getService: name => name === 'llm' ? { stream: async function* (input) { prompts.push(input.messages[0].content[0].text); yield { type: 'text-delta', text: '[]' }; } } : undefined });
  const a = agent('toggle');const messages = [{ role: 'user', content: [{ type: 'text', text: '关闭期间的内容不应该补录' }] }];a.session.deriveMessages = () => messages;
  try {
    await sessions.start(a);sessions.context({agent:a});disabled=false;sessions.refreshRecording();
    messages.push({ role:'user',content:[{type:'text',text:'开启后的新增内容，已确认完成。'.repeat(500)}] });
    await sessions.stop(a);await sessions.idle('toggle');
    assert.equal(prompts.length,1);assert.ok(!prompts[0].includes('关闭期间'));assert.ok(prompts[0].includes('开启后的新增内容'));
  } finally { sessions.dispose(); }
});

test('自动整理：第一轮寒暄不触发，内容攒够阈值才跑一次，冷却内不重复', async () => {
  let clock = 1_000_000;
  const f = fixture({ now: () => clock }), a = agent('auto');
  const messages = [{ id: 'm0', role: 'user', content: [{ type: 'text', text: '你好，帮我看看这个仓库' }] }];
  a.session.deriveMessages = () => messages;
  const prompts = () => f.calls.filter(call => call.prompt);
  await f.sessions.start(a);
  f.sessions.context({ agent: a }); await f.sessions.stop(a); await f.sessions.idle('auto');
  assert.equal(prompts().length, 0, '第一轮内容太少，不调用模型');
  for (let turn = 1; turn <= 4; turn++) {
    messages.push({ id: 'm' + turn, role: 'user', content: [{ type: 'text', text: `第${turn}轮决定：` + '发布流程改用蓝绿部署。'.repeat(160) }] });
    clock += 60_000; f.sessions.context({ agent: a }); await f.sessions.stop(a); await f.sessions.idle('auto');
  }
  assert.equal(prompts().length, 1, '累计超过阈值后整理一次，冷却内不再跑');
  assert.ok(prompts()[0].prompt.includes('第4轮决定') || prompts()[0].prompt.includes('第3轮决定'));
  f.sessions.dispose();
});

test('模型本轮自己写过记忆且压力不高时，自动整理让一让；下一轮照常', async () => {
  const f = fixture(), a = agent('yield');
  a.session.transcript = '已决定采用方案A。'.repeat(800);
  await f.sessions.start(a); f.sessions.context({ agent: a });
  f.sessions.wrote(a); await f.sessions.stop(a); await f.sessions.idle('yield');
  assert.equal(f.calls.filter(call => call.prompt).length, 0);
  f.sessions.context({ agent: a }); await f.sessions.stop(a); await f.sessions.idle('yield');
  assert.equal(f.calls.filter(call => call.prompt).length, 1);
  f.sessions.dispose();
});
