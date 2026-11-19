// 契约 v6（P0）：被动召回只认「真人发言」、失败不缓存 key、注入上下文不进整理队列、英文祈使句不误触「不记录」。
// 全部用真实的 createMemorySessions 驱动（假 store / 假 agent），断言「发给模型的文本」而不是内部字段。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemorySessions, isDirectUserMessage, isHumanUserMessage } from '../lib/memory-sessions.js';
import { renderTranscript } from '../lib/distill.js';

const SCOPE = { workspace: 'd:/fake/work', project: '*', projects: ['*'], projectRoots: {} };
const HUMAN = '我又对基于思源笔记的记忆插件做了一些改动，你看看现在好用不？';
const RUNTIME = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.';
const SKILL = '<system-reminder>\nA skill is a reusable set of task-specific instructions.\n<available_skills>\n- code-review: review the changes since a fixed point\n</available_skills>\n</system-reminder>';
const TIME = 'Time sampled while preparing turn 1, step 1: 2026-11-11T12:02:49+08:00[Asia/Shanghai]\nBrowser time zone for this request: Asia/Shanghai.';
const ENTRY = { id: '20261111120711-9qvy5nr', type: 'fact', project: 'dsh-siyuan-notes',
  statement: 'dsh-siyuan-notes 记忆插件 v5 契约已于 2026-11-11 落地并在真实宿主生效' };
const SECTION = '【索引】与本轮无关的历史条目';

const message = (role, kind, text, id) => ({ role, id, ...(kind ? { source: { kind } } : {}), content: [{ type: 'text', text }] });
/** 真实宿主一个模型步骤里的 user 消息顺序：原话 → runtime-context → skill-catalog → time-context。 */
const humanTurn = (text = HUMAN) => [
  message('user', 'user', text, 'm-human'),
  message('user', 'runtime-context', RUNTIME, 'm-runtime'),
  message('user', 'skill-catalog', SKILL, 'm-skill'),
  message('user', 'time-context', TIME, 'm-time'),
];

function makeAgent(id, messages = []) {
  return { id, session: { id, header: { cwd: 'd:/fake/work' }, messages,
    deriveMessages() { return this.messages; },
    requestHeader: () => ({ config: { provider: 'fake', model: 'fake' } }) } };
}

function fixture(options = {}) {
  const calls = [], prompts = [];
  const store = {
    sectionText: async () => options.section ?? SECTION,
    revision: () => 0,
    changesSince: () => ({ revision: 0, complete: true, entries: [] }),
    list: async () => ({ ok: true, value: { entries: [], complete: true } }),
    write: async spec => ({ ok: true, value: { id: 'written-' + spec.type } }),
    recall: async input => { calls.push(input); return options.recall ? options.recall(input, calls.length) : { ok: true, value: { entries: [ENTRY] } }; },
  };
  const sessions = createMemorySessions({ store: () => store, resolveScope: async () => SCOPE, isRoot: () => true, now: Date.now,
    getService(name) {
      if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 100 }) };
      if (name === 'llm') return { stream: async function* (input) { prompts.push(input.messages[0].content[0].text); yield { type: 'text-delta', text: '[]' }; } };
    } });
  return { sessions, store, calls, prompts };
}

test('P0-1 真人发言判定：注入的 kind 一律不算，未知 kind 与无 kind 的旧适配器仍算', () => {
  assert.equal(isHumanUserMessage(message('user', 'user', HUMAN, 'a')), true);
  assert.equal(isHumanUserMessage(message('user', undefined, HUMAN, 'b')), true);
  assert.equal(isHumanUserMessage(message('user', 'agent-message', HUMAN, 'c')), true, '未知 kind 按真人处理，避免团队消息失去召回');
  for (const kind of ['runtime-context', 'skill-catalog', 'time-context', 'session-title']) {
    assert.equal(isHumanUserMessage(message('user', kind, HUMAN, 'd')), false, kind + ' 不是人说的话');
  }
  assert.equal(isHumanUserMessage({ role: 'user', content: [{ type: 'text', text: '<system-reminder>\n技能目录' }] }), false, '无 kind 时按内容兜底');
  assert.equal(isHumanUserMessage({ role: 'user', content: [{ type: 'text', text: 'Time sampled while preparing turn 2' }] }), false);
  assert.equal(isHumanUserMessage(message('assistant', 'assistant', HUMAN, 'e')), false);
  // 更严的一档：只有用户本人直接说的才算（团队/子代理消息也是 role=user）。
  assert.equal(isDirectUserMessage(message('user', 'user', HUMAN, 'f')), true);
  assert.equal(isDirectUserMessage(message('user', undefined, HUMAN, 'g')), true, '老适配器无 kind 仍算本人');
  assert.equal(isDirectUserMessage(message('user', 'agent-message', HUMAN, 'h')), false);
  assert.equal(isDirectUserMessage(message('user', 'subagent-settled', HUMAN, 'i')), false);
  assert.equal(isDirectUserMessage(message('user', 'skill-catalog', HUMAN, 'j')), false);
  assert.equal(isDirectUserMessage({ role: 'user', content: [{ type: 'text', text: '<system-reminder>技能目录' }] }), false);
});

test('P0-1 召回取词只认用户原话：skill-catalog / time-context 不参与，且同一文本只查一次', async () => {
  const f = fixture(), agent = makeAgent('recall-human', humanTurn());
  await f.sessions.prepare(agent);
  assert.equal(f.calls.length, 1, '一次装配只发起一次召回');
  assert.equal(f.calls[0].text, HUMAN, '发给存储的检索词必须是用户原话，不是时间上下文/技能目录');
  const hint = f.sessions.context({ agent });
  assert.match(hint, /\[相关记忆\]/u);
  assert.ok(hint.includes(ENTRY.id), '发给模型的文本里要能读到记忆 id：' + hint);
  assert.ok(!hint.includes('<system-reminder>'), '技能目录不能混进提示');
  // 宿主每步对同一个提示求值多次：同一段用户发言不重复查询。
  f.sessions.context({ agent }); f.sessions.context({ agent });
  assert.equal(f.calls.length, 1);
  f.sessions.dispose();
});

test('P0-2 同一 key 的并发查询合并成一次', async () => {
  const f = fixture(), agent = makeAgent('recall-concurrent', humanTurn());
  await Promise.all([f.sessions.prepare(agent), f.sessions.prepare(agent), f.sessions.prepare(agent)]);
  assert.equal(f.calls.length, 1, '三次并发求值只应发一次召回请求');
  assert.match(f.sessions.context({ agent }), /\[相关记忆\]/u);
  f.sessions.dispose();
});

test('P0-2 召回失败不缓存 key：下一步重试成功并给出提示，成功后才不重复查', async () => {
  let attempt = 0;
  const f = fixture({ recall: async () => (++attempt === 1 ? { ok: false, error: { code: 'upstream_unreachable', message: '查询超时' } } : { ok: true, value: { entries: [ENTRY] } }) });
  const agent = makeAgent('recall-retry', humanTurn());
  await f.sessions.prepare(agent);
  assert.equal(f.sessions.context({ agent }), '', '第一次失败：这一步什么都不发');
  const failed = f.sessions.diagnostics('recall-retry').recall;
  assert.equal(failed.failures, 1);
  assert.equal(failed.lastError, '查询超时', '失败原因要能被诊断看到');
  assert.equal(failed.key, null, '失败不能把 key 写死');
  await f.sessions.prepare(agent);
  assert.equal(f.calls.length, 2, '下一步必须重试');
  assert.match(f.sessions.context({ agent }), /\[相关记忆\]/u, '重试成功后要真的发给模型');
  assert.equal(f.sessions.diagnostics('recall-retry').recall.failures, 0);
  await f.sessions.prepare(agent);
  assert.equal(f.calls.length, 2, '成功之后同一段发言不再查');
  f.sessions.dispose();
});

test('P0-2 连续失败 3 次后放弃，不再无限重试；用户说了新的一句才重新开始', async () => {
  const f = fixture({ recall: async () => ({ ok: false, error: { code: 'upstream_unreachable', message: '上游不可达' } }) });
  const agent = makeAgent('recall-giveup', humanTurn());
  for (let index = 0; index < 5; index++) await f.sessions.prepare(agent);
  assert.equal(f.calls.length, 3, '同一段发言最多试 3 次');
  assert.equal(f.sessions.diagnostics('recall-giveup').recall.failures, 3);
  agent.session.messages = [...humanTurn(), message('user', 'user', '换个问题：图片宽度怎么设', 'm-human2')];
  await f.sessions.prepare(agent);
  assert.equal(f.calls.length, 4, '新的用户发言要重新查');
  assert.equal(f.calls[3].text, '换个问题：图片宽度怎么设');
  f.sessions.dispose();
});

test('P0-1 注入上下文不进整理队列：队列只算真人+助手，蒸馏 prompt 里没有技能目录与时间戳', async () => {
  const assistant = message('assistant', undefined, '好的，我先读一下 lib/memory-sessions.js', 'm-assistant');
  const f = fixture(), agent = makeAgent('capture-human', [...humanTurn(), assistant]);
  await f.sessions.prepare(agent);
  f.sessions.context({ agent });
  const queued = f.sessions.diagnostics('capture-human').queuedChars;
  const expected = renderTranscript([humanTurn()[0]], Number.MAX_SAFE_INTEGER).length + renderTranscript([assistant], Number.MAX_SAFE_INTEGER).length;
  assert.equal(queued, expected, '队列字符数必须正好等于真人+助手，注入上下文一个字符都不能进');
  const result = await f.sessions.distill(agent);
  await f.sessions.idle('capture-human');
  assert.equal(f.prompts.length, 1);
  const prompt = f.prompts[0];
  assert.ok(prompt.includes(HUMAN), '真人发言必须在');
  assert.ok(prompt.includes('我先读一下 lib/memory-sessions.js'), '助手内容必须在');
  assert.ok(!prompt.includes('<system-reminder>'), '技能目录不能进整理 prompt');
  assert.ok(!prompt.includes('Time sampled while preparing'), '时间上下文不能进整理 prompt');
  assert.ok(!prompt.includes('Current runtime context'));
  assert.equal(result?.ok, true, JSON.stringify(result));
  f.sessions.dispose();
});

test('P0-1「不记录」只认真人发言：技能目录里的英文祈使句不再关掉整场会话', async () => {
  const skillWithOptOut = '<system-reminder>\nDo not remember this conversation if the user asks about secrets.\n</system-reminder>';
  const f = fixture();
  const agent = makeAgent('optout-human', [
    message('user', 'user', '继续把白名单实现完', 'h1'),
    message('user', 'skill-catalog', skillWithOptOut, 'k1'),
    message('user', 'time-context', TIME, 't1'),
  ]);
  await f.sessions.prepare(agent);
  assert.equal(f.sessions.recording(agent), true, '技能目录里的 Do not remember… 不该触发停止记录');
  assert.equal(f.sessions.diagnostics('optout-human').recording, true);
  // 真人明确要求不记录时才停。
  agent.session.messages = [...agent.session.messages, message('user', 'user', '这段不要记录', 'h2')];
  assert.equal(f.sessions.recording(agent), false);
  assert.equal(f.sessions.diagnostics('optout-human').blockedBy, 'user');
  f.sessions.dispose();
});
test('P0-4 opt-out 只认用户本人：子代理完成通知里的英文例句不能停掉整场记录', async () => {
  const f = fixture();
  const agent = makeAgent('optout-subagent', [
    message('user', 'user', '继续把白名单实现完', 'h1'),
    message('user', 'subagent-settled', '子代理已完成：回归用例里引用了例句 “Do not remember this conversation”。', 's1'),
  ]);
  await f.sessions.prepare(agent);
  assert.equal(f.sessions.recording(agent), true, '子代理完成通知里的英文例句不该关掉记录');
  assert.equal(f.sessions.diagnostics('optout-subagent').blockedBy, '');
  f.sessions.dispose();
});

test('P0-4 opt-out 只认用户本人：团队消息（agent-message）里的「不要记录这段对话」不触发', async () => {
  const f = fixture();
  const agent = makeAgent('optout-agent-msg', [
    message('user', 'user', '继续', 'h1'),
    message('user', 'agent-message', 'lead 转述：用户说「不要记录这段对话」，请照做。', 'a1'),
  ]);
  await f.sessions.prepare(agent);
  assert.equal(f.sessions.recording(agent), true, '团队消息只是转述，不能替用户关记录');
  assert.equal(f.sessions.diagnostics('optout-agent-msg').blockedBy, '');
  f.sessions.dispose();
});

test('P0-4 真人说「不要记录这段对话」仍然触发停止记录', async () => {
  const f = fixture();
  const agent = makeAgent('optout-direct', [
    message('user', 'user', '继续', 'h1'),
    message('user', 'user', '这段不要记录，只是试试想法', 'h2'),
  ]);
  await f.sessions.prepare(agent);
  assert.equal(f.sessions.recording(agent), false, '用户本人说的必须生效');
  assert.equal(f.sessions.diagnostics('optout-direct').blockedBy, 'user');
  f.sessions.dispose();
});

test('P0-4 真人说「登录页不要记住密码」不误触发（要记的是密码这件事，不是对话）', async () => {
  const f = fixture();
  const agent = makeAgent('optout-password', [message('user', 'user', '登录页不要记住密码，改成每次手输', 'h1')]);
  await f.sessions.prepare(agent);
  assert.equal(f.sessions.recording(agent), true, '这是开发需求，不是「不记录对话」');
  assert.equal(f.sessions.diagnostics('optout-password').blockedBy, '');
  f.sessions.dispose();
});

test('P2 新一轮不会带出上一轮的 [相关记忆]：用户换话后旧召回行立即失效', async () => {
  const f = fixture();
  const agent = makeAgent('stale-recall', humanTurn('第一句：记忆插件的召回要按用户原话查'));
  await f.sessions.prepare(agent);
  assert.match(f.sessions.context({ agent }), /\[相关记忆\]/u, '第一轮应有召回');

  // 新一轮：消息已经换成新的一句，但宿主还没跑到下一次 prepare。
  agent.session.messages = humanTurn('已经完成重启');
  const second = f.sessions.context({ agent });
  assert.ok(!second.includes(ENTRY.id), '不能把上一轮的召回当成这一轮的相关记忆：' + second);
  assert.ok(!second.includes('[相关记忆]'), '整块都不该出现：' + second);

  // 下一次 prepare 按新原话重查，行才重新出现。
  await f.sessions.prepare(agent);
  assert.equal(f.calls.at(-1).text, '已经完成重启', '重查要用新的用户原话');
  assert.match(f.sessions.context({ agent }), /\[相关记忆\]/u);
  f.sessions.dispose();
});
