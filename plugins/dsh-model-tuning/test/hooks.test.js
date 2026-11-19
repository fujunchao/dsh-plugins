import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createStore } from '../lib/state.js'
import {
  installHooks,
  isEligibleForDefaults,
  shouldCarryEffort,
  toModelSelection,
} from '../lib/hooks.js'
import { createTuner } from '../lib/tune.js'

const tempStore = () => createStore(join(mkdtempSync(join(tmpdir(), 'model-tuning-hooks-')), 'state.json'))

/** 一个够用的假宿主：只实现钩子会碰到的服务。 */
function fakeCtx({ teams, subagents, llm, agents } = {}) {
  const handlers = new Map()
  return {
    handlers,
    logger: { warn() {}, info() {} },
    on(name, fn) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn])
      return () => {}
    },
    get(name) {
      if (name === 'agentTeams') return teams
      if (name === 'subagents') return subagents
      if (name === 'llm') return llm
      if (name === 'agents') return agents
      return undefined
    },
    fire(name, ...args) {
      for (const fn of handlers.get(name) ?? []) return fn(...args)
      return undefined
    },
  }
}

function fakeAgent({ id = 's1', origin = 'user', isSeeded = false, selects = [] } = {}) {
  return {
    id,
    session: { id, header: { origin, isSeeded }, append() {} },
    model: {
      select(selection) {
        selects.push(selection)
      },
      current() {
        return undefined
      },
    },
    selects,
  }
}

test('isEligibleForDefaults：只认新建根会话', () => {
  const base = { source: 'startup', header: { origin: 'user' } }
  assert.equal(isEligibleForDefaults(base), true)
  assert.equal(isEligibleForDefaults({ ...base, source: 'resume' }), false)
  assert.equal(isEligibleForDefaults({ ...base, source: 'compact' }), false)
  assert.equal(isEligibleForDefaults({ ...base, header: { origin: 'subagent' } }), false)
  assert.equal(isEligibleForDefaults({ ...base, header: { origin: 'user', isSeeded: true } }), false)
})

test('shouldCarryEffort：只在"上游自动重置"时成立', () => {
  const supported = ['low', 'medium', 'high', 'max']
  const prev = { provider: 'p', model: 'a', reasoningEffort: 'max' }
  // 换模型、新档位 = 目标默认档、旧档受支持 → 补
  assert.equal(shouldCarryEffort({ prev, next: { provider: 'q', model: 'b', reasoningEffort: 'high' }, supported, defaultEffort: 'high' }), true)
  // 新档位不是默认档 = 用户显式挑的 → 不动
  assert.equal(shouldCarryEffort({ prev, next: { provider: 'q', model: 'b', reasoningEffort: 'low' }, supported, defaultEffort: 'high' }), false)
  // 目标不支持旧档 → 不动
  assert.equal(shouldCarryEffort({ prev, next: { provider: 'q', model: 'b', reasoningEffort: 'high' }, supported: ['low'], defaultEffort: 'high' }), false)
  // 同一个模型内换档 → 不关我们的事
  assert.equal(shouldCarryEffort({ prev, next: { provider: 'p', model: 'a', reasoningEffort: 'high' }, supported, defaultEffort: 'high' }), false)
  // 没有旧档 / 没有默认档 → 不动
  assert.equal(shouldCarryEffort({ prev: { ...prev, reasoningEffort: null }, next: { provider: 'q', model: 'b', reasoningEffort: 'high' }, supported, defaultEffort: 'high' }), false)
  assert.equal(shouldCarryEffort({ prev, next: { provider: 'q', model: 'b', reasoningEffort: 'high' }, supported, defaultEffort: null }), false)
})

test('toModelSelection：档位为 null 时省略该字段', () => {
  assert.deepEqual(toModelSelection({ provider: 'p', model: 'm', reasoningEffort: null }), { provider: 'p', model: 'm' })
  assert.deepEqual(toModelSelection({ provider: 'p', model: 'm', reasoningEffort: 'max' }), { provider: 'p', model: 'm', reasoningEffort: 'max' })
})

test('新会话默认：写入模型选择，并记录 lastApply', async () => {
  const store = tempStore()
  store.update((state) => ({ ...state, defaults: { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' } }))
  const ctx = fakeCtx()
  const dispose = installHooks({ ctx, store, tuner: createTuner(ctx) })
  const agent = fakeAgent()
  await ctx.fire('agent/created', { agent, source: 'startup', signal: undefined })
  assert.deepEqual(agent.selects, [{ provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' }])
  assert.equal(store.read().state.lastApply.ok, true)
  assert.equal(store.read().state.lastApply.sessionId, 's1')
  dispose()
})

test('新会话默认：不设默认时完全不动，续跑/fork/子代理也不动', async () => {
  const store = tempStore() // 默认 defaults = null
  const ctx = fakeCtx()
  installHooks({ ctx, store, tuner: createTuner(ctx) })
  for (const scope of [
    { source: 'startup', agent: fakeAgent() },
    { source: 'resume', agent: fakeAgent({ id: 's2' }) },
    { source: 'startup', agent: fakeAgent({ id: 's3', isSeeded: true }) },
    { source: 'startup', agent: fakeAgent({ id: 's4', origin: 'subagent' }) },
  ]) {
    await ctx.fire('agent/created', { agent: scope.agent, source: scope.source })
    assert.deepEqual(scope.agent.selects, [], `${scope.source} 不应写入选择`)
  }
})

test('团队默认：开着才调 setEnabled，且只在根会话上', async () => {
  const store = tempStore()
  store.update((state) => ({ ...state, teamDefaultEnabled: true }))
  const calls = []
  const teams = { setEnabled: async (agent, enabled) => { calls.push([agent.id, enabled]) } }
  const subagents = { rootOf: (agent) => (agent.id === 'child' ? { id: 'parent' } : agent) }
  const ctx = fakeCtx({ teams, subagents })
  installHooks({ ctx, store, tuner: createTuner(ctx) })
  await ctx.fire('agent/created', { agent: fakeAgent({ id: 'root' }), source: 'startup' })
  assert.deepEqual(calls, [['root', true]])
  calls.length = 0
  await ctx.fire('agent/created', { agent: fakeAgent({ id: 'child' }), source: 'startup' })
  assert.deepEqual(calls, [], '非根会话不调 setEnabled（上游会抛 TEAM_LEAD_REQUIRED）')
})

test('档位保持：换模型后补回上一档，且同一目标只补一次', async () => {
  const store = tempStore() // carryEffort 默认 true
  const llm = {
    async resolveModelInfo(provider, model) {
      return { provider, model, reasoning: { efforts: ['low', 'high', 'max'], defaultEffort: 'high' } }
    },
  }
  const agent = fakeAgent({ id: 's9' })
  const agents = { get: (id) => (id === 's9' ? agent : undefined) }
  const ctx = fakeCtx({ llm, agents })
  installHooks({ ctx, store, tuner: createTuner(ctx) })
  const session = { id: 's9', header: { origin: 'user' }, append() {} }

  // 第一次：A/max 已是当前选择（仅仅是记录）
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'p', model: 'a', reasoningEffort: 'max' } })
  // 第二次：换到 q/b，上游自动塞了默认档 high
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'q', model: 'b', reasoningEffort: 'high' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(agent.selects, [{ provider: 'q', model: 'b', reasoningEffort: 'max' }], '应把 max 带过去')

  // 同样的切换再来一次：去重后不再补
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'p', model: 'a', reasoningEffort: 'max' } })
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'q', model: 'b', reasoningEffort: 'high' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(agent.selects.length, 1)
})

test('档位保持：开关关掉后不再补正', async () => {
  const store = tempStore()
  store.update((state) => ({ ...state, carryEffort: false }))
  const llm = { async resolveModelInfo() { return { reasoning: { efforts: ['high', 'max'], defaultEffort: 'high' } } } }
  const agent = fakeAgent({ id: 's10' })
  const ctx = fakeCtx({ llm, agents: { get: () => agent } })
  installHooks({ ctx, store, tuner: createTuner(ctx) })
  const session = { id: 's10', header: { origin: 'user' }, append() {} }
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'p', model: 'a', reasoningEffort: 'max' } })
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'q', model: 'b', reasoningEffort: 'high' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(agent.selects, [])
})

test('档位保持：用户显式挑档（不等于默认档）时不动', async () => {
  const store = tempStore()
  const llm = { async resolveModelInfo() { return { reasoning: { efforts: ['low', 'high', 'max'], defaultEffort: 'high' } } } }
  const agent = fakeAgent({ id: 's11' })
  const ctx = fakeCtx({ llm, agents: { get: () => agent } })
  installHooks({ ctx, store, tuner: createTuner(ctx) })
  const session = { id: 's11', header: { origin: 'user' }, append() {} }
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'p', model: 'a', reasoningEffort: 'max' } })
  ctx.fire('session/event', session, { type: 'model/selection', data: { provider: 'q', model: 'b', reasoningEffort: 'low' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(agent.selects, [])
})
