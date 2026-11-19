import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inspectSession, classifyReason, summarizeTodos, summarizeGoal } from '../lib/state.js'
import { continuationPrompt, continuationSummary, normalizeLanguage } from '../lib/prompt.js'

/** 造一条会话事件。 */
let seq = 0
function ev(type, data, at = 1_700_000_000_000) {
  seq += 1
  return { type, seq, time: at + seq, data }
}

function turnStart(turn) { return ev('turn/start', { turn }) }
function stepStart(turn, step) { return ev('step/start', { turn, step }) }
function stepEnd(turn, step) { return ev('step/end', { turn, step }) }
function turnEnd(turn, reason) { return ev('turn/end', { turn, reason }) }
function userMsg(text) { return ev('user/message', { id: `m${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }) }

test('classifyReason maps every terminal kind', () => {
  assert.equal(classifyReason({ kind: 'error', error: { code: 'RATE_LIMIT', message: '429' } }).code, 'RATE_LIMIT')
  assert.equal(classifyReason({ kind: 'aborted', reason: { kind: 'user' } }).code, 'USER_STOP')
  assert.equal(classifyReason({ kind: 'aborted', reason: { kind: 'disposed' } }).code, 'PLUGIN_UNLOAD')
  assert.equal(classifyReason({ kind: 'interrupted' }).code, 'PROCESS_EXIT')
  assert.equal(classifyReason({ kind: 'max-tokens' }).code, 'MAX_TOKENS')
  assert.equal(classifyReason({ kind: 'blocked' }).code, 'BLOCKED')
  assert.equal(classifyReason({ kind: 'completed' }).code, null)
})

test('a clean completed turn offers nothing', () => {
  const events = [turnStart(1), stepStart(1, 1), userMsg('hi'), stepEnd(1, 1), turnEnd(1, { kind: 'completed' })]
  const state = inspectSession(events)
  assert.equal(state.status, 'completed')
  assert.equal(state.eligible, false)
  assert.equal(state.turn, 1)
})

test('an upstream error is eligible and keeps the provider message', () => {
  const events = [turnStart(7), stepStart(7, 2), turnEnd(7, { kind: 'error', error: { code: 'RATE_LIMIT', message: '上游返回 429' } })]
  const state = inspectSession(events)
  assert.equal(state.eligible, true)
  assert.equal(state.code, 'RATE_LIMIT')
  assert.equal(state.turn, 7)
  assert.equal(state.step, 2)
  assert.match(state.reason.message, /429/)
})

test('a user stop is eligible', () => {
  const events = [turnStart(3), stepStart(3, 1), turnEnd(3, { kind: 'aborted', reason: { kind: 'user' } })]
  const state = inspectSession(events)
  assert.equal(state.eligible, true)
  assert.equal(state.code, 'USER_STOP')
})

test('blocked is not eligible', () => {
  const events = [turnStart(2), turnEnd(2, { kind: 'blocked' })]
  assert.equal(inspectSession(events).eligible, false)
})

test('max-tokens is eligible', () => {
  const events = [turnStart(4), stepStart(4, 1), turnEnd(4, { kind: 'max-tokens' })]
  const state = inspectSession(events)
  assert.equal(state.eligible, true)
  assert.equal(state.code, 'MAX_TOKENS')
})

test('an open turn at the tail counts as a process exit', () => {
  const events = [turnStart(5), stepStart(5, 1)]
  const state = inspectSession(events)
  assert.equal(state.status, 'interrupted')
  assert.equal(state.code, 'PROCESS_EXIT')
  assert.equal(state.open, true)
  assert.equal(state.eligible, true)
})

test('ignoreErrorCodes suppresses the offer', () => {
  const events = [turnStart(1), turnEnd(1, { kind: 'error', error: { code: 'CONTEXT_LENGTH_EXCEEDED', message: 'too long' } })]
  const state = inspectSession(events, { ignoreErrorCodes: ['CONTEXT_LENGTH_EXCEEDED'] })
  assert.equal(state.eligible, false)
})

test('a truncated assistant message still counts as interrupted', () => {
  const events = [
    turnStart(9),
    stepStart(9, 1),
    ev('assistant/message', { turn: 9, step: 1, interrupted: true, message: { role: 'assistant', content: [] }, stream: [] }),
    turnEnd(9, { kind: 'completed' }),
  ]
  const state = inspectSession(events)
  assert.equal(state.eligible, true)
  assert.equal(state.code, 'TRUNCATED')
})

test('remaining work is folded from todos, goals and jobs', () => {
  const events = [
    ev('todo/write', { todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] }),
    ev('goal/change', { kind: 'goal/change', operation: 'create', goal: { id: 'g', phase: 'active', objective: 'ship it', roundsStarted: 2, maxGoalRounds: 10 } }),
    ev('job/registered', { jobId: 'job-a' }),
    ev('job/registered', { jobId: 'job-b' }),
    ev('job/settled', { jobId: 'job-b' }),
    turnStart(1),
    turnEnd(1, { kind: 'error', error: { code: 'TIMEOUT', message: 'slow' } }),
  ]
  const state = inspectSession(events)
  assert.deepEqual(state.remaining.todos, { pending: 1, inProgress: 1, done: 1, total: 3, open: 2 })
  assert.equal(state.remaining.goal.active, true)
  assert.equal(state.remaining.jobs, 1)
})

test('includeCompleted promotes leftover work', () => {
  const events = [
    ev('todo/write', { todos: [{ status: 'pending' }] }),
    turnStart(1),
    stepStart(1, 1),
    turnEnd(1, { kind: 'completed' }),
  ]
  assert.equal(inspectSession(events).eligible, false)
  const promoted = inspectSession(events, { includeCompleted: true })
  assert.equal(promoted.eligible, true)
  assert.equal(promoted.code, 'LEFTOVER_WORK')
})

test('summaries stay short and localized', () => {
  const events = [
    ev('todo/write', { todos: [{ status: 'pending' }, { status: 'pending' }] }),
    turnStart(12),
    stepStart(12, 3),
    turnEnd(12, { kind: 'error', error: { code: 'RATE_LIMIT', message: 'boom' } }),
  ]
  const state = inspectSession(events)
  const zh = continuationSummary(state, 'zh')
  const en = continuationSummary(state, 'en')
  assert.ok(zh.length <= 120, zh)
  assert.ok(en.length <= 120, en)
  assert.match(zh, /限流/)
  assert.match(zh, /第 12 轮/)
  assert.match(zh, /待办 2 项/)
  assert.match(en, /rate limit/)
})

test('prompt carries the cause, the leftover facts and the guardrails', () => {
  const events = [
    ev('todo/write', { todos: [{ status: 'pending' }] }),
    turnStart(4),
    stepStart(4, 2),
    turnEnd(4, { kind: 'error', error: { code: 'RATE_LIMIT', message: '429 upstream' } }),
  ]
  const state = inspectSession(events)
  const zh = continuationPrompt(state, { language: 'zh' })
  assert.match(zh, /<resume_after_interruption>/)
  assert.match(zh, /429 upstream/)
  assert.match(zh, /不要重做已经完成的工作/)
  assert.match(zh, /<\/resume_after_interruption>/)
  const en = continuationPrompt(state, { language: 'en' })
  assert.match(en, /Do not redo completed work/)
  assert.match(en, /turn 4, step 2/)
})

test('prompt respects the character budget while keeping the guardrails', () => {
  const long = 'x'.repeat(4000)
  const events = [turnStart(1), turnEnd(1, { kind: 'error', error: { code: 'LLM_ERROR', message: long } })]
  const state = inspectSession(events)
  const text = continuationPrompt(state, { language: 'zh', maxChars: 300 })
  assert.ok(text.length <= 1200)
  assert.match(text, /继续规则/)
})

test('normalizeLanguage follows the locale', () => {
  assert.equal(normalizeLanguage('zh'), 'zh')
  assert.equal(normalizeLanguage('auto', 'zh-CN'), 'zh')
  assert.equal(normalizeLanguage('auto', 'en-US'), 'en')
  assert.equal(normalizeLanguage(undefined, undefined), 'en')
})

test('summarizers tolerate junk', () => {
  assert.equal(summarizeTodos(null), null)
  assert.equal(summarizeTodos([]), null)
  assert.equal(summarizeTodos([{}, { status: 'nope' }]).pending, 2)
  assert.equal(summarizeGoal(null), null)
  assert.equal(summarizeGoal({ goal: { phase: 'paused', objective: 'x' } }).active, false)
})
