/**
 * 插件壳的集成测试：用一个假的 Cordis 上下文把 `apply()` 真的跑起来。
 *
 * 覆盖：
 *   - 启动排序（延时的首次排序）；
 *   - 会话活动 → 项目实时顶到首位；
 *   - 空白新会话 → 也算开工；
 *   - manual 模式 → 一次都不碰顺序；
 *   - 斜杠命令 → 幂等（第二次零写入）且输出可读。
 *
 * 这不替代真实宿主验证，但能保证壳与核心的接线是通的。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

/** 等几轮事件循环，让串行链跑完。 */
async function flush(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/** 造一个假上下文：registry 会真的按 insertBefore 语义改动顺序。 */
function makeHarness({ workspaces, sessions, archived = [] }) {
  const calls = []
  const order = workspaces.map(workspace => workspace.id)
  const sessionsById = new Map(sessions.map(session => [String(session.sessionId), session]))

  const registry = {
    archivedSessionIds: archived,
    list: () => order.map((id) => {
      const workspace = workspaces.find(item => item.id === id)
      return { id, title: workspace.title, sessionIds: [...workspace.sessionIds] }
    }),
    insertBefore: async (id, beforeId) => {
      calls.push({ id, beforeId })
      const from = order.indexOf(id)
      if (from < 0) return [...order]
      order.splice(from, 1)
      const at = beforeId === undefined ? order.length : order.indexOf(beforeId)
      order.splice(at < 0 ? order.length : at, 0, id)
      return [...order]
    },
  }

  const sessionController = {
    list: async () => ({ items: [...sessionsById.values()] }),
  }

  const commands = {
    definition: undefined,
    register(definition) {
      commands.definition = definition
      return () => {}
    },
  }

  const listeners = new Map()
  const effects = []

  const ctx = {
    workspaceRegistry: registry,
    sessionController,
    commands,
    logger: { warn() {} },
    get: () => undefined,
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return () => {}
    },
    on(name, handler) {
      const list = listeners.get(name) ?? []
      list.push(handler)
      listeners.set(name, list)
      return () => {}
    },
  }

  return {
    ctx,
    calls,
    order,
    commands,
    effects,
    emit(name, ...args) {
      for (const handler of listeners.get(name) ?? []) handler(...args)
    },
  }
}

const NOW = 1_800_000_000_000
const MINUTE = 60_000

/** 三个工作区：c 最新、a 其次、b 从没工作过。 */
function fixtures() {
  const workspaces = [
    { id: 'w-a', title: 'alpha', sessionIds: ['s-a'] },
    { id: 'w-b', title: 'beta', sessionIds: ['s-b'] },
    { id: 'w-c', title: 'gamma', sessionIds: ['s-c'] },
  ]
  const sessions = [
    { sessionId: 's-a', updatedAt: NOW - 120 * MINUTE, blank: false },
    { sessionId: 's-c', updatedAt: NOW - 5 * MINUTE, blank: false },
  ]
  return { workspaces, sessions }
}

test('启动排序：按最近工作重排，且只挪必要的项目', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions })
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, _delay, ...args) => realSetTimeout(callback, 0, ...args)
  try {
    apply(harness.ctx, { mode: 'recent' })
    await flush()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  assert.deepEqual(harness.order, ['w-c', 'w-a', 'w-b'])
  assert.equal(harness.calls.length, 1, '只有 gamma 需要挪到最前')
})

test('会话活动：发消息的项目立刻顶到首位；已在首位时不写', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions })
  apply(harness.ctx, { mode: 'recent' })

  harness.emit('api-session/activity', 's-c')
  await flush()
  assert.deepEqual(harness.order, ['w-c', 'w-a', 'w-b'])
  assert.equal(harness.calls.length, 1)

  harness.emit('api-session/activity', 's-c')
  await flush()
  assert.equal(harness.calls.length, 1, '已经在首位，不该再写盘')
})

test('不认识归属的会话活动：什么都不动', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions, archived: ['s-a'] })
  apply(harness.ctx, { mode: 'recent' })

  harness.emit('api-session/activity', 's-unknown')
  await flush()
  assert.equal(harness.calls.length, 0, '不认识归属的会话不动任何东西')
})

test('空白新会话出现：把它所属项目顶到首位；非空白的不触发', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions })
  apply(harness.ctx, { mode: 'recent' })

  harness.emit('api-session/added', { sessionId: 's-b', blank: false })
  await flush()
  assert.equal(harness.calls.length, 0, '非空白不触发')

  harness.emit('api-session/added', { sessionId: 's-b', blank: true })
  await flush()
  assert.deepEqual(harness.order, ['w-b', 'w-a', 'w-c'])
  assert.equal(harness.calls.length, 1)
})

test('manual 模式：启动排序、活动、新会话都不碰顺序', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions })
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, _delay, ...args) => realSetTimeout(callback, 0, ...args)
  try {
    apply(harness.ctx, { mode: 'manual' })
    await flush()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  harness.emit('api-session/activity', 's-c')
  harness.emit('api-session/added', { sessionId: 's-b', blank: true })
  await flush()
  assert.deepEqual(harness.order, ['w-a', 'w-b', 'w-c'])
  assert.equal(harness.calls.length, 0)
})

test('斜杠命令：立即整理、返回可读文本、第二次零写入', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions })
  apply(harness.ctx, { mode: 'manual' })

  assert.equal(harness.commands.definition?.name, 'sort-projects')
  const first = await harness.commands.definition.handler({})
  assert.equal(first.kind, 'success')
  assert.match(first.text, /按最近工作整理完成/)
  assert.match(first.text, /gamma/)
  assert.match(first.text, /beta/)
  assert.deepEqual(harness.order, ['w-c', 'w-a', 'w-b'])

  const callsAfterFirst = harness.calls.length
  await harness.commands.definition.handler({})
  assert.equal(harness.calls.length, callsAfterFirst, '第二次整理不该再写盘')
})

test('命令遇到宿主出错时返回 error 而不是抛出', async () => {
  const { workspaces, sessions } = fixtures()
  const harness = makeHarness({ workspaces, sessions })
  harness.ctx.sessionController.list = async () => { throw new Error('会话库挂了') }
  apply(harness.ctx, { mode: 'manual' })

  const result = await harness.commands.definition.handler({})
  assert.equal(result.kind, 'error')
  assert.match(result.text, /会话库挂了/)
})
