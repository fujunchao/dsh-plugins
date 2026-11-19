import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, normalizeOptions, buildContinuationMessage, ROUTES } from '../lib/index.js'
import { inspectSession } from '../lib/state.js'

/** 最小 Cordis 上下文替身：只提供 apply() 真正用到的那几个面。 */
function makeCtx(options = {}) {
  const registered = []
  const logger = { warn() {}, info() {}, error() {} }
  const sessions = options.sessions ?? []
  const agents = options.agents ?? new Map()
  const ctx = {
    logger,
    sessions: {
      get: (id) => sessions.find((session) => session.id === id),
      list: () => sessions.slice(),
    },
    webServer: {
      register(route) {
        registered.push(route)
        return () => {
          const index = registered.indexOf(route)
          if (index !== -1) registered.splice(index, 1)
        }
      },
    },
    effect(fn) {
      const dispose = fn()
      return dispose
    },
    get(name) {
      if (name === 'agents') return { get: (id) => agents.get(id) }
      if (name === 'sessionController') return options.sessionController
      if (name === 'sessionQuery') return options.sessionQuery
      return undefined
    },
  }
  return { ctx, registered, logger }
}

/** 造一个假的会话对象：snapshotEvents + seq + id。 */
function makeSession(id, events) {
  return {
    id,
    get seq() {
      const last = events[events.length - 1]
      return last === undefined ? 0 : last.seq + 1
    },
    snapshotEvents() {
      return events
    },
  }
}

let counter = 0
function ev(type, data) {
  counter += 1
  return { type, seq: counter, time: 1_700_000_000_000 + counter, data }
}

/** 直接调用注册进来的路由处理器。 */
function call(route, method, url, body) {
  const req = { method, url, headers: {}, async *[Symbol.asyncIterator]() {
    if (body !== undefined) yield Buffer.from(JSON.stringify(body))
  } }
  const chunks = []
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    end(chunk) {
      chunks.push(chunk)
    },
  }
  return route.handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse(chunks.join('') || 'null') }))
}

function boot(options = {}) {
  const built = makeCtx(options)
  apply(built.ctx, options.config ?? {})
  const route = built.registered[0]
  assert.ok(route, 'expected a registered route')
  assert.equal(route.path, '/dsh-resume')
  assert.equal(route.kind, 'prefix')
  return { route, ...built }
}

/** 一个"被 429 打断"的会话。 */
function interruptedSession(id = 'session-a') {
  return makeSession(id, [
    ev('turn/start', { turn: 3 }),
    ev('step/start', { turn: 3, step: 1 }),
    ev('todo/write', { todos: [{ status: 'pending' }, { status: 'in_progress' }] }),
    ev('turn/end', { turn: 3, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429 upstream' } } }),
  ])
}

test('normalizeOptions rejects junk and clamps bounds', () => {
  assert.deepEqual(normalizeOptions(undefined), {
    placement: 'seat',
    includeCompleted: false,
    promptLanguage: 'auto',
    maxPromptChars: 1200,
    ignoreErrorCodes: [],
  })
  assert.equal(normalizeOptions({ placement: 'nope' }).placement, 'seat')
  assert.equal(normalizeOptions({ placement: 'toolbar' }).placement, 'toolbar')
  assert.equal(normalizeOptions({ maxPromptChars: 999999 }).maxPromptChars, 12000)
  assert.equal(normalizeOptions({ maxPromptChars: 1 }).maxPromptChars, 200)
  assert.deepEqual(normalizeOptions({ ignoreErrorCodes: ['A', 3, ''] }).ignoreErrorCodes, ['A'])
  assert.equal(normalizeOptions({ promptLanguage: 'klingon' }).promptLanguage, 'auto')
})

test('health reports the effective options', async () => {
  const { route } = boot({ config: { placement: 'toolbar' } })
  const result = await call(route, 'GET', ROUTES.health)
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.options.placement, 'toolbar')
})

test('state explains an interrupted turn', async () => {
  const session = interruptedSession()
  const { route } = boot({ sessions: [session] })
  const result = await call(route, 'GET', `${ROUTES.state}?sessionId=session-a&lang=zh`)
  assert.equal(result.status, 200)
  assert.equal(result.json.state.eligible, true)
  assert.equal(result.json.state.code, 'RATE_LIMIT')
  assert.equal(result.json.state.turn, 3)
  assert.match(result.json.summary, /429|限流/)
  assert.equal(result.json.options.placement, 'seat')
})

test('state says nothing when the session cannot be read at all', async () => {
  const { route } = boot({ sessions: [] })
  const result = await call(route, 'GET', `${ROUTES.state}?sessionId=ghost`)
  assert.equal(result.status, 200)
  assert.equal(result.json.state, null)
  assert.equal(result.json.reason, 'session-unreadable')
})

test('state folds a cold session through sessionQuery without making it live', async () => {
  const session = interruptedSession('cool')
  const { route } = boot({
    sessions: [],
    sessionQuery: {
      readSession: async () => ({ session: { id: 'cool' }, inheritedEventCount: 0, events: session.snapshotEvents() }),
    },
  })
  const result = await call(route, 'GET', `${ROUTES.state}?sessionId=cool&lang=en`)
  assert.equal(result.status, 200)
  assert.equal(result.json.live, false)
  assert.equal(result.json.state.eligible, true)
  assert.equal(result.json.state.code, 'RATE_LIMIT')
  assert.match(result.json.summary, /rate limit/)
})

test('a running agent is never "interrupted"', async () => {
  const session = interruptedSession()
  const agent = { id: 'session-a', status: 'running', session }
  const { route } = boot({ sessions: [session], agents: new Map([['session-a', agent]]) })
  const result = await call(route, 'GET', `${ROUTES.state}?sessionId=session-a`)
  assert.equal(result.json.state.status, 'running')
  assert.equal(result.json.state.eligible, false)
  assert.equal(result.json.summary, null)
})

test('continue queues one resume message and answers with its identity', async () => {
  const session = interruptedSession()
  const sent = []
  const agent = { id: 'session-a', status: 'idle', session, inbox: { nextTurn: [], nextStep: [] }, followup: (message) => sent.push(message) }
  const { route } = boot({ sessions: [session], agents: new Map([['session-a', agent]]) })

  const result = await call(route, 'POST', ROUTES.continue, { sessionId: 'session-a', turn: 3, lang: 'zh' })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(sent.length, 1)

  const message = sent[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'resume')
  assert.equal(message.source.form, 'notice')
  assert.equal(message.source.turn, 3)
  assert.ok(message.source.summary.length <= 120)
  assert.match(message.content[0].text, /<resume_after_interruption>/)
  assert.match(message.content[0].text, /429 upstream/)
  assert.equal(Object.isFrozen(message), true)
  assert.equal(typeof message.id, 'string')
})

test('continue refuses a second click within the lock window', async () => {
  const session = interruptedSession()
  const agent = { id: 'session-a', status: 'idle', session, inbox: { nextTurn: [], nextStep: [] }, followup: () => {} }
  const { route } = boot({ sessions: [session], agents: new Map([['session-a', agent]]) })
  const first = await call(route, 'POST', ROUTES.continue, { sessionId: 'session-a' })
  const second = await call(route, 'POST', ROUTES.continue, { sessionId: 'session-a' })
  assert.equal(first.status, 200)
  assert.equal(second.status, 409)
  assert.equal(second.json.code, 'in-flight')
})

test('continue refuses a busy agent, queued input, and a clean turn', async () => {
  const session = interruptedSession()
  const busyAgent = { id: 'session-a', status: 'running', session, inbox: { nextTurn: [], nextStep: [] }, followup: () => {} }
  const busy = boot({ sessions: [session], agents: new Map([['session-a', busyAgent]]) })
  assert.equal((await call(busy.route, 'POST', ROUTES.continue, { sessionId: 'session-a' })).json.code, 'busy')

  const queuedAgent = { id: 'session-a', status: 'idle', session, inbox: { nextTurn: [{ id: 'x' }], nextStep: [] }, followup: () => {} }
  const queued = boot({ sessions: [session], agents: new Map([['session-a', queuedAgent]]) })
  assert.equal((await call(queued.route, 'POST', ROUTES.continue, { sessionId: 'session-a' })).json.code, 'queued')

  const clean = makeSession('session-b', [ev('turn/start', { turn: 1 }), ev('step/start', { turn: 1, step: 1 }), ev('turn/end', { turn: 1, reason: { kind: 'completed' } })])
  const cleanAgent = { id: 'session-b', status: 'idle', session: clean, inbox: { nextTurn: [], nextStep: [] }, followup: () => {} }
  const cleanBoot = boot({ sessions: [clean], agents: new Map([['session-b', cleanAgent]]) })
  assert.equal((await call(cleanBoot.route, 'POST', ROUTES.continue, { sessionId: 'session-b' })).json.code, 'not-interrupted')
})

test('continue rejects a stale turn', async () => {
  const session = interruptedSession()
  const agent = { id: 'session-a', status: 'idle', session, inbox: { nextTurn: [], nextStep: [] }, followup: () => {} }
  const { route } = boot({ sessions: [session], agents: new Map([['session-a', agent]]) })
  const result = await call(route, 'POST', ROUTES.continue, { sessionId: 'session-a', turn: 99 })
  assert.equal(result.status, 409)
  assert.equal(result.json.code, 'stale')
})

test('continue resumes a cold session through the session controller', async () => {
  const session = interruptedSession()
  const sent = []
  const agent = { id: 'session-a', status: 'idle', session, inbox: { nextTurn: [], nextStep: [] }, followup: (message) => sent.push(message) }
  const { route } = boot({ sessions: [], sessionController: { resolveAgent: async () => ({ agent }) } })
  const result = await call(route, 'POST', ROUTES.continue, { sessionId: 'session-a' })
  assert.equal(result.status, 200)
  assert.equal(sent.length, 1)
})

test('no route answers 404, wrong method answers 405', async () => {
  const { route } = boot({ sessions: [interruptedSession()] })
  assert.equal((await call(route, 'GET', '/dsh-resume/nope')).status, 404)
  assert.equal((await call(route, 'POST', ROUTES.state)).status, 405)
  assert.equal((await call(route, 'GET', ROUTES.continue)).status, 405)
})

test('buildContinuationMessage is self-contained and frozen', () => {
  const state = inspectSession([
    ev('turn/start', { turn: 2 }),
    ev('turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'slow' } } }),
  ])
  const message = buildContinuationMessage('hello', state, 'summary')
  assert.equal(message.role, 'user')
  assert.equal(message.content[0].text, 'hello')
  assert.equal(message.source.kind, 'resume')
  assert.equal(message.source.seq, state.seq)
  assert.equal(Object.isFrozen(message.content[0]), true)
})
