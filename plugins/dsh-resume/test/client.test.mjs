import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 浏览器半的冒烟测试：不渲染 React，只验证
 *  - 模块体能在「__ModuleLoader__ + require 种子模块」的约束下加载；
 *  - apply() 能把 overlay / toolbar / chat row 三处注册都装上；
 *  - 缺少 uiConversation 时静默降级，不抛错、不影响发送键。
 */

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClient() {
  let factory = null
  const appendedStyles = []
  const elements = []

  const documentStub = {
    head: {
      appendChild(node) {
        elements.push(node)
      },
    },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
  }

  const windowStub = {
    __ModuleLoader__: {
      load(options) {
        factory = options.factory
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    getComputedStyle: () => ({ backgroundColor: 'rgb(0,0,0)', color: 'rgb(255,255,255)', borderRadius: '999px' }),
    innerWidth: 1200,
    innerHeight: 800,
    __DSH_RESUME__: null,
  }

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    memo: (component) => component,
  }

  const reactDom = {
    createPortal: (child) => child,
  }

  const modules = { react: React, 'react-dom': reactDom }
  const require = (name) => {
    if (modules[name] === undefined) throw new Error(`unexpected require("${name}")`)
    return modules[name]
  }

  globalThis.window = windowStub
  globalThis.document = documentStub
  new Function('window', 'document', SOURCE)(windowStub, documentStub)
  assert.ok(factory, 'the bundle must register a factory')
  const module = factory(require)
  return { module, windowStub, elements, appendedStyles }
}

function fakeCtx(options = {}) {
  const registrations = []
  const effects = []
  const localeDicts = []
  return {
    registrations,
    effects,
    localeDicts,
    ctx: {
      effect(fn) {
        effects.push(fn)
        return fn()
      },
      locale: {
        register(ns, dicts) {
          localeDicts.push({ ns, dicts })
          return () => {}
        },
        bind: () => (key, vars) => (vars && vars.code ? `${key}:${vars.code}` : key),
      },
      slots: {
        inject(key, callback) {
          return callback()
        },
        register(descriptor, component) {
          registrations.push({ descriptor, component })
          return () => {}
        },
      },
      get(name) {
        if (name === 'uiConversation') return options.uiConversation ?? null
        return undefined
      },
    },
  }
}

test('the bundle loads under the module loader and exposes apply/inject', () => {
  const { module, elements } = loadClient()
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(module.inject, ['slots', 'locale'])
  const built = fakeCtx()
  module.apply(built.ctx)
  // 样式必须注入到 head
  assert.equal(elements.length, 1)
  assert.match(elements[0].dataset.pluginCss, /dsh-resume/)
})

test('apply registers the seat and the toolbar fallback', () => {
  const { module } = loadClient()
  const built = fakeCtx()
  module.apply(built.ctx)
  const names = built.registrations.map((entry) => entry.descriptor.name)
  assert.ok(names.includes('conversation.input.overlay'), `missing seat: ${names.join(',')}`)
  assert.ok(names.includes('conversation.input.right'), `missing toolbar: ${names.join(',')}`)
  assert.ok(built.localeDicts.length >= 1)
  assert.ok(built.localeDicts[0].dicts.zh && built.localeDicts[0].dicts.en)
})

test('the chat row stays absent when uiConversation is unavailable', () => {
  const { module, windowStub } = loadClient()
  const built = fakeCtx()
  module.apply(built.ctx)
  assert.equal(built.registrations.some((entry) => entry.descriptor.name === 'conversation.chat.node'), false)
  assert.deepEqual(windowStub.__DSH_RESUME__.caps(), { definition: false, renderer: false, error: null })
})

test('the chat row registers definition and renderer when uiConversation exists', () => {
  const definitions = []
  const { module, windowStub } = loadClient()
  const built = fakeCtx({
    uiConversation: { events: { register: (definition) => definitions.push(definition) } },
  })
  module.apply(built.ctx)
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].kind, 'resume-continue')
  assert.equal(definitions[0].target, 'chat')
  const row = built.registrations.find((entry) => entry.descriptor.name === 'conversation.chat.node')
  assert.ok(row, 'chat node renderer must be registered')
  assert.equal(row.descriptor.key, 'resume-continue')
  assert.equal(windowStub.__DSH_RESUME__.caps().definition, true)
  assert.equal(windowStub.__DSH_RESUME__.caps().renderer, true)
})

test('a throwing definition registration degrades instead of breaking the seat', () => {
  const { module } = loadClient()
  const built = fakeCtx({
    uiConversation: {
      events: {
        register() {
          throw new Error('kind already registered')
        },
      },
    },
  })
  module.apply(built.ctx)
  assert.ok(built.registrations.some((entry) => entry.descriptor.name === 'conversation.input.overlay'))
  assert.equal(built.registrations.some((entry) => entry.descriptor.name === 'conversation.chat.node'), false)
})

test('the definition only matches interrupted turn endings', () => {
  const definitions = []
  const { module } = loadClient()
  const built = fakeCtx({
    uiConversation: { events: { register: (definition) => definitions.push(definition) } },
  })
  module.apply(built.ctx)
  const definition = definitions[0]
  const turnEnd = (reason) => ({ type: 'turn/end', seq: 9, time: 1, data: { turn: 3, reason } })
  assert.equal(definition.match(turnEnd({ kind: 'completed' })), null)
  assert.equal(definition.match(turnEnd({ kind: 'blocked' })), null)
  assert.deepEqual(definition.match(turnEnd({ kind: 'error', error: { code: 'RATE_LIMIT' } })), {
    id: '3',
    role: 'start',
  })
  assert.deepEqual(definition.match({ type: 'turn/start', seq: 1, time: 1, data: { turn: 3 } }), null)

  const state = definition.start(null, { event: turnEnd({ kind: 'aborted', reason: { kind: 'user' } }) })
  assert.equal(state.turn, 3)
  assert.equal(state.seq, 9)
  assert.equal(state.reasonCode, 'ABORTED')
  const node = definition.buildViewNode({ key: 'k', id: '3', state, start: { location: { kind: 'unresolved' } } })
  assert.equal(node.kind, 'resume-continue')
  assert.equal(node.target, 'chat')
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.anchorSeq, 9)
  assert.equal(node.visibility, 'visible')
})
