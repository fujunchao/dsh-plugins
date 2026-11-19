/**
 * 客户端半的**接线**测试（不渲染真实 DOM）：
 *   - 模块 id 与 factory 形态（浏览器侧的 __ModuleLoader__ 协议）；
 *   - 导出的 NS / inject / apply；
 *   - apply 是否在 plugins.row.config 上注册了正确的 key；
 *   - `/state` 信封 → 插件状态这层解析（曾经把信封当插件状态，导致开关"勾了又变回没勾"）。
 *
 * 页面渲染的细节仍由 client.js 自己的空壳渲染覆盖；这里守住"装得上"和"数据没接错层"两层。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

/** 够用的 React 空壳：只要 client.js 顶层不炸即可。 */
function reactStub() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const useMemo = (factory) => factory()
  const useCallback = (fn) => fn
  const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
  const useEffect = () => {}
  const useRef = (value) => ({ current: value })
  return { createElement, useMemo, useCallback, useState, useEffect, useRef, Fragment: 'Fragment' }
}

/** 按顺序吐出预设值的 React 空壳：用来把页面"喂"到一个已经加载完的状态。 */
function presetReact(values) {
  let cursor = 0
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  return {
    createElement,
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useState: () => {
      const value = values[cursor]
      cursor += 1
      return [value, () => {}]
    },
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    Fragment: 'Fragment',
  }
}

/** 模块只加载一次；factory 可以反复调用，每次都是一个独立实例。 */
let cachedEntry

async function loadEntry() {
  if (cachedEntry !== undefined) return cachedEntry
  const registrations = []
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        registrations.push(entry)
        return entry
      },
    },
  }
  globalThis.document = {
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        dataset: {},
        style: {},
        setAttribute() {},
        appendChild() {},
        textContent: '',
      }
    },
    head: { appendChild() {} },
    querySelector: () => null,
    getElementById: () => null,
  }
  // Node 里 navigator 是只读 getter，用 defineProperty 覆盖。
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
  })

  await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'client.js')).href)

  assert.equal(registrations.length, 1)
  cachedEntry = registrations[0]
  return cachedEntry
}

/** 装一个假 ctx，返回 apply 时注册进去的组件与调用记录。 */
function install(entry, react) {
  const exportsObject = entry.factory((name) => {
    if (name === 'react') return react
    throw new Error(`客户端半不该 require(${name})`)
  })
  const slotCalls = []
  const localeCalls = []
  const ctx = {
    locale: {
      register(namespace, dictionaries) {
        localeCalls.push({ namespace, dictionaries })
        return () => {}
      },
      bind: () => (key) => key,
    },
    slots: {
      inject(slotName, factory) {
        slotCalls.push({ kind: 'inject', slotName })
        return factory()
      },
      register(registration, component) {
        slotCalls.push({ kind: 'register', registration, component })
        return () => {}
      },
    },
    effect(fn) {
      fn()
      return () => {}
    },
  }
  exportsObject.apply(ctx)
  return { exportsObject, slotCalls, localeCalls }
}

/** 把页面树摊平成一维元素数组（组件自己返回的嵌套数组也要摊开）。 */
function flatten(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) flatten(child, out)
  return out
}

test('client.js 按 __ModuleLoader__ 协议注册，并在插件页行配置槽挂上自己', async () => {
  const entry = await loadEntry()
  assert.equal(entry.id, 'dsh-model-tuning')
  assert.equal(typeof entry.factory, 'function')

  const { exportsObject, slotCalls, localeCalls } = install(entry, reactStub())
  assert.equal(exportsObject.NS, 'model-tuning')
  assert.deepEqual([...exportsObject.inject], ['slots', 'locale'])
  assert.equal(typeof exportsObject.apply, 'function')

  assert.equal(localeCalls.length, 1)
  assert.equal(localeCalls[0].namespace, 'model-tuning')
  assert.equal(typeof localeCalls[0].dictionaries.zh.summary, 'string')
  assert.equal(typeof localeCalls[0].dictionaries.en.summary, 'string')

  const injection = slotCalls.find((call) => call.kind === 'inject')
  assert.equal(injection.slotName, 'plugins.row.config')
  const registration = slotCalls.find((call) => call.kind === 'register')
  assert.equal(registration.registration.name, 'plugins.row.config')
  assert.equal(registration.registration.key, 'dsh-model-tuning#model-tuning')
  assert.equal(registration.registration.locale, 'model-tuning')
  assert.equal(typeof registration.component, 'function')

  // 两份字典必须键对齐：少一个键在界面上就是直接显示键名（或被吞掉），页面上很难发现。
  const zhKeys = Object.keys(localeCalls[0].dictionaries.zh).sort()
  const enKeys = Object.keys(localeCalls[0].dictionaries.en).sort()
  assert.deepEqual(enKeys, zhKeys, 'zh / en 字典的键集合必须一致')
})

test('空壳渲染：state 还没回来时页面与摘要都能出壳，不抛异常', async () => {
  const entry = await loadEntry()
  const { slotCalls } = install(entry, reactStub())
  const registration = slotCalls.find((call) => call.kind === 'register')
  const translate = (key) => key

  const card = registration.component({ view: 'page', t: translate })
  assert.equal(typeof card.type, 'function', 'page 视图应是页面组件本身')
  assert.equal(card.type(card.props).type, 'div')

  const summary = registration.component({ view: 'summary', t: translate })
  assert.equal(summary.type(summary.props), 'summaryLoading')
})

test('信封 → 插件状态：payloadState 只取 state 那一层', async () => {
  const entry = await loadEntry()
  const { exportsObject } = install(entry, reactStub())
  const { payloadState } = exportsObject.__internals

  assert.deepEqual(payloadState({ state: { teamDefaultEnabled: true, carryEffort: true } }), {
    teamDefaultEnabled: true,
    carryEffort: true,
  })
  assert.deepEqual(payloadState({ warning: null, capabilities: {} }), {}, '没有 state 字段时返回空对象，而不是信封本身')
  assert.deepEqual(payloadState({ state: null }), {})
  assert.deepEqual(payloadState(null), {})
})

test('页面把「插件状态」而不是整个信封交给「新会话默认」块（勾选不会假掉）', async () => {
  const entry = await loadEntry()
  const payload = {
    state: {
      defaults: { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' },
      teamDefaultEnabled: true,
      carryEffort: true,
      taskFirstHint: true,
      lastApply: null,
    },
    warning: null,
    dshDefault: { provider: 'google', model: 'gemini-4-hydrogen', reasoningEffort: 'high' },
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    patch: { state: 'patched', detail: '', archivePath: '', appVersion: '', backupPath: null },
    capabilities: { settings: true, llm: true, agentTeams: true },
    routePrefix: '/model-tuning',
    statePath: 'C:/tmp/state.json',
    backupDir: 'C:/tmp/backups',
    externalManager: false,
  }
  const providersPayload = {
    ns: 'llm-pi-ai',
    revision: 3,
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    protocols: ['openai-completions'],
    templates: [{ id: 'relay', api: 'openai-completions', baseURL: '', efforts: { low: 'low' } }],
    undo: null,
    providers: [],
  }
  // ModelTuningPage 的四个 useState：state / stateError / providers / providersError
  const react = presetReact([payload, null, providersPayload, null])
  const { slotCalls } = install(entry, react)
  const registration = slotCalls.find((call) => call.kind === 'register')

  const translate = (key) => key
  const card = registration.component({ view: 'page', t: translate })
  const nodes = flatten(card.type(card.props))
  const defaultsBlock = nodes.find((node) => typeof node.type === 'function' && node.type.name === 'DefaultsBlock')
  assert.ok(defaultsBlock !== undefined, '页面里应当渲染出「新会话默认」块')

  // 这就是那个 bug：传信封下去时这里读到的是 undefined，三个勾选框永远显示未勾选。
  assert.deepEqual(defaultsBlock.props.state, payload.state)
  assert.equal(defaultsBlock.props.state.teamDefaultEnabled, true)
  assert.equal(defaultsBlock.props.state.carryEffort, true)
  assert.equal(defaultsBlock.props.state.taskFirstHint, true)

  // 补丁三态属于信封，不属于插件状态：PatchBlock 必须拿得到它。
  const patchBlock = nodes.find((node) => typeof node.type === 'function' && node.type.name === 'PatchBlock')
  assert.equal(patchBlock.props.patch.state, 'patched')
})

/* ---------- v3 第一批（编辑）：字典键、请求体形状、撤销的 stale 分支 ---------- */

/** 取工厂挂出来的测试入口（每次 install 都是独立实例）。 */
async function internals() {
  const entry = await loadEntry()
  const { exportsObject } = install(entry, reactStub())
  return exportsObject.__internals
}

/** 摊平后所有直接挂在节点下的字符串：按钮文案、提示行都在这里。 */
function texts(node) {
  return flatten(node).flatMap((item) => (item.children ?? []).filter((child) => typeof child === 'string'))
}

/** 按组件函数名找元素（组件还没被调用，拿到的就是它的 props）。 */
function byName(node, name) {
  return flatten(node).filter((item) => typeof item.type === 'function' && item.type.name === name)
}

/**
 * 把函数组件一层层调用掉，直到只剩原生元素。
 * 只用在这批无 hook 的控件上（Field / TextInput / Select / Button / Tag / Msg…），
 * 好让断言能看到真正的 `<input>` / `<select>`，而不是没被调用的组件元素。
 * 注意要按真实 React 的样子把 children 塞回 props，否则 Field / Button 这类组件收到的 children 是空的。
 */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand)
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const children = node.children.length === 1 ? node.children[0] : node.children
    return expand(node.type({ ...node.props, children }))
  }
  return { ...node, children: (node.children ?? []).map(expand) }
}

/**
 * presetReact 的宽松版：前几个槽位按预设喂（把页面喂到"已加载"），之后的 useState 走组件自己的初值。
 *
 * 需要它是因为组件里的 `useState` 是在 factory 阶段从同一个 React 对象上解构出来的：
 * 装第二次（例如单独调 ProvidersBlock）时换不了桩，只能让同一个桩"喂完预设就恢复本色"。
 */
function hybridReact(values) {
  let cursor = 0
  return {
    ...reactStub(),
    useState: (initial) => {
      const index = cursor
      cursor += 1
      if (index < values.length) return [values[index], () => {}]
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
  }
}

/**
 * 能"点得动"的最小状态壳：useState 用槽位存值，setState 直接写槽位；
 * 每次渲染前调 `begin()` 把游标归零。给需要「改输入框 → 点按钮」的用例用（不改真实 DOM）。
 */
function liveReact() {
  const slots = []
  let cursor = 0
  const react = {
    ...reactStub(),
    useState: (initial) => {
      const index = cursor
      cursor += 1
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      const write = (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      }
      return [slots[index], write]
    },
  }
  return {
    react,
    begin: () => {
      cursor = 0
    },
  }
}

test('就地编辑的字典键：zh / en 同名同数，撤销文案改成「写入」', async () => {
  const entry = await loadEntry()
  const { localeCalls } = install(entry, reactStub())
  const { zh, en } = localeCalls[0].dictionaries

  const added = [
    'edit',
    'save',
    'modelRenameWarn',
    'modelUpdated',
    'defaultsMigrated',
    'providerUpdated',
    'reachable',
    'keyKeepHint',
    'needsField',
    'undoneNoLabel',
    'undoStaleConfirm',
    'undoneWithObject',
    'undoLabelCreate',
    'undoLabelDelete',
    'undoLabelAddModel',
    'undoLabelRemoveModel',
    'undoLabelEditModel',
    'undoLabelEditProvider',
    'confirmSaveUnchecked',
  ]
  for (const key of added) {
    assert.equal(typeof zh[key], 'string', `zh 缺少新增键 ${key}`)
    assert.equal(typeof en[key], 'string', `en 缺少新增键 ${key}`)
    assert.notEqual(zh[key], '', `zh 的 ${key} 不能是空串`)
    assert.notEqual(en[key], '', `en 的 ${key} 不能是空串`)
  }
  // 撤销提示要「动作 + 对象」，不能把 slug 直接摆给用户看。
  assert.equal(zh.undoLabelEditModel, '编辑模型')
  assert.equal(zh.undoLabelCreate, '新建供应商')
  assert.equal(zh.confirmSaveUnchecked, '还没检测连通，仍要保存吗？')
  assert.match(zh.undoneWithObject, /\{label\}.*\{object\}/)
  // 撤销现在也覆盖编辑，文案不能再只说「结构变更」。
  assert.equal(zh.undo, '撤销上一次写入')
  assert.equal(en.undo, 'Undo the last write')
  assert.match(zh.undone, /\{label\}/, '撤销成功的提示要带后端给的 label')
  assert.match(en.undone, /\{label\}/)
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), '两份字典的键集合必须一致')
})

test('宿主两种失败形状都收口成 failure.code（撤销的 stale 才不会退化成「请求失败」）', async () => {
  const { call } = await internals()
  const queue = [
    // 平铺形状：撤销的 stale 要把 routes 一起带出来
    { status: 400, body: { ok: false, code: 'stale', message: '上次写入后这条供应商又被改过', routes: ['cli'] } },
    // 信封形状：/model 的 id 撞车
    { status: 400, body: { ok: false, error: { code: 'invalid', message: '模型 id 已存在：glm-5.3-pro' } } },
    // 成功
    { status: 200, body: { ok: true, revision: 13, defaultsMigrated: true } },
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    const next = queue.shift()
    return { ok: next.status === 200, status: next.status, json: async () => next.body }
  }
  try {
    await assert.rejects(
      call('/provider/undo', { method: 'POST' }),
      (failure) => failure.code === 'stale' && /又被改过/.test(failure.message) && failure.payload.routes[0] === 'cli',
    )
    await assert.rejects(
      call('/model', { method: 'POST' }),
      (failure) => failure.code === 'invalid' && /已存在/.test(failure.message),
    )
    const payload = await call('/model', { method: 'POST' })
    assert.equal(payload.revision, 13)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('模型行编辑：表单取自存量模型，请求体同时带旧 id 与新 id（改名靠这个差）', async () => {
  const { modelFormFromModel, modelEditBody } = await internals()
  const model = {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 128000,
    maxTokens: 8192,
    input: ['text', 'image'],
    reasoningEfforts: { off: null, high: 'high' },
  }
  const row = modelFormFromModel(model)
  assert.equal(row.id, 'glm-5.3')
  assert.equal(row.cw, '128000')
  assert.equal(row.mt, '8192')
  assert.deepEqual(row.input, { text: true, image: true })
  assert.deepEqual(row.levels, { off: true, high: true })

  const edited = { ...row, id: 'glm-5.3-pro', name: 'GLM-5.3 Pro', levels: { ...row.levels, low: true } }
  const body = modelEditBody({ id: 'cli' }, model, 12, edited)
  assert.equal(body.route, 'cli')
  assert.equal(body.revision, 12)
  assert.equal(body.modelId, 'glm-5.3', 'modelId 必须是被编辑模型的当前 id')
  assert.equal(body.model.id, 'glm-5.3-pro', 'model.id 是新 id')
  assert.equal(body.model.name, 'GLM-5.3 Pro')
  assert.deepEqual(body.model.reasoningEfforts, { off: null, low: 'low', high: 'high' })

  // 空字段一律不写：宿主按「原字段 + 新值」合并，清空输入框不该把库存值抹掉。
  const sparse = modelEditBody({ id: 'cli' }, { id: 'm' }, 3, {
    id: 'm',
    name: '',
    cw: '',
    mt: '',
    input: { text: false, image: false },
    levels: {},
  })
  assert.equal('name' in sparse.model, false)
  assert.equal('contextWindow' in sparse.model, false)
  assert.equal('reasoningEfforts' in sparse.model, false)

  // 高级字段里手写的 API 参数值不能被这张勾选表顺手改写掉（勾选框只说"声明了哪几档"）。
  const custom = modelFormFromModel({ id: 'm', reasoningEfforts: { high: 'reasoning_effort=high' } })
  assert.deepEqual(modelEditBody({ id: 'cli' }, { id: 'm' }, 1, custom).model.reasoningEfforts, {
    high: 'reasoning_effort=high',
  })
})

test('供应商头编辑：只发改过的键，密钥留空 = 不改，目录路由不被钉上协议', async () => {
  const { providerEditFields, providerEditBody, providerEditIssues } = await internals()
  const t = (key) => key
  const provider = { id: 'cli', displayName: 'GLM 中转', baseURL: 'https://a.example/v1', api: 'openai-completions' }
  const untouched = { displayName: 'GLM 中转', baseURL: 'https://a.example/v1', api: 'openai-completions', key: '' }
  assert.deepEqual(providerEditFields(provider, untouched), {}, '一个字没改就不发 fields')
  assert.deepEqual(providerEditBody(provider, 7, untouched), { route: 'cli', revision: 7, fields: {} }, '密钥留空时 key 不该出现')

  const edited = { displayName: 'GLM 二号中转', baseURL: 'https://b.example/v1', api: 'anthropic-messages', key: 'sk-new' }
  assert.deepEqual(providerEditFields(provider, edited), {
    displayName: 'GLM 二号中转',
    baseURL: 'https://b.example/v1',
    api: 'anthropic-messages',
  })
  assert.equal(providerEditBody(provider, 7, edited).key, 'sk-new', '填了密钥才发 key')

  // 目录路由：端点/协议本来就没写进配置（宿主回报 null），只改显示名时不能把它们当空串发出去。
  const catalog = { id: 'google', displayName: null, baseURL: null, api: null }
  assert.deepEqual(providerEditFields(catalog, { displayName: 'Google', baseURL: '', api: '', key: '' }), {
    displayName: 'Google',
  })

  assert.deepEqual(providerEditIssues({ fields: {} }, t), [], '没改字段时不该有本地错误')
  assert.deepEqual(providerEditIssues({ fields: { displayName: '' } }, t), ['needsField'])
  assert.deepEqual(providerEditIssues({ fields: { baseURL: '' } }, t), ['needsField'])
})

test('撤销：stale 先二次确认，确认后带 force:true 重发；拒绝就一次都不写', async () => {
  const { undoWithForce } = await internals()
  const stale = () => {
    const failure = new Error('上次写入后这条供应商又被改过，撤销会一并覆盖')
    failure.code = 'stale'
    return failure
  }

  const sent = []
  let asked = 0
  const done = await undoWithForce(
    async (extra) => {
      sent.push(extra)
      if (sent.length === 1) throw stale()
      return { ok: true, label: '编辑 glm-5.3 的档位' }
    },
    () => {
      asked += 1
      return true
    },
  )
  assert.deepEqual(sent, [{}, { force: true }], '第二次必须带 force:true')
  assert.equal(asked, 1, '只弹一次确认')
  assert.deepEqual(done, { ok: true, payload: { ok: true, label: '编辑 glm-5.3 的档位' } })

  const declined = []
  const cancelled = await undoWithForce(
    async (extra) => {
      declined.push(extra)
      throw stale()
    },
    () => false,
  )
  assert.deepEqual(declined, [{}], '用户拒绝后不能再发一次')
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.stale, true)
  assert.match(cancelled.message, /又被改过/, '拒绝时把宿主的原因原样留给界面')

  // 不是 stale 的失败（例如 revision 冲突）原样抛，不弹确认。
  await assert.rejects(
    undoWithForce(
      async () => {
        const failure = new Error('配置已被外部改动')
        failure.code = 'conflict'
        throw failure
      },
      () => {
        throw new Error('不该弹确认')
      },
    ),
    /外部改动/,
  )
})

test('模型行编辑表单：id 输入框可改，旁边挂着改名警告，按行保存/取消', async () => {
  const { EditModelForm } = await internals()
  const model = {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 128000,
    maxTokens: 8192,
    input: ['text'],
    reasoningEfforts: { high: 'high' },
  }
  const t = (key) => key
  const form = EditModelForm({
    t,
    provider: { id: 'cli', models: [model] },
    model,
    index: 0,
    levels: ['off', 'low', 'high', 'max'],
    revision: 4,
    onSaved: () => {},
    onCancel: () => {},
  })

  const rows = byName(form, 'ModelFormRow')
  assert.equal(rows.length, 1, '编辑表就是「+ 添加模型」那张表')
  assert.equal(rows[0].props.idHint, 'modelRenameWarn')
  assert.equal(rows[0].props.canRemove, false, '编辑不该顺手给一个删除按钮')

  const rowTree = rows[0].type(rows[0].props)
  const rowNodes = flatten(expand(rowTree))
  assert.ok(texts(rowTree).includes('modelRenameWarn'), '改名警告要真的渲染在 id 输入框下面')
  const idInput = rowNodes.find((node) => node.type === 'input' && node.props.value === 'glm-5.3')
  assert.ok(idInput !== undefined, 'id 输入框带出当前 id，说明它是可改的')
  assert.ok(
    rowNodes.some((node) => node.type === 'input' && node.props.value === '128000'),
    '上下文窗口按存量值预填',
  )
  assert.deepEqual(byName(form, 'Button').map((node) => node.children[0]), ['save', 'cancel'])
})

test('供应商头编辑表单：显示名/端点/协议/密钥 + 已有供应商的检测连通', async () => {
  const { EditProviderForm } = await internals()
  const t = (key) => key
  const provider = {
    id: 'cli',
    displayName: 'GLM 中转',
    baseURL: 'https://a.example/v1',
    api: 'openai-completions',
    keyRef: 'CLI_API_KEY',
  }
  const form = EditProviderForm({
    t,
    provider,
    protocols: ['openai-completions', 'anthropic-messages'],
    revision: 7,
    onSaved: () => {},
    onCancel: () => {},
  })
  const nodes = flatten(expand(form))
  const inputs = nodes.filter((node) => node.type === 'input')
  assert.deepEqual(
    inputs.map((node) => node.props.value),
    ['GLM 中转', 'https://a.example/v1', ''],
    '密钥框永远是空的：留空 = 不改',
  )
  assert.equal(inputs[2].props.type, 'password')
  assert.ok(texts(form).includes('keyKeepHint'), '密钥框旁边要说明留空等于不改')

  const selects = nodes.filter((node) => node.type === 'select')
  assert.equal(selects.length, 1)
  assert.equal(selects[0].props.value, 'openai-completions')

  const buttons = byName(form, 'Button')
  assert.deepEqual(buttons.map((node) => node.children[0]), ['save', 'discover', 'cancel'])
  assert.equal(buttons[0].props.disabled, true, '没改任何字段时保存按钮应当是灰的')
  assert.equal(buttons[1].props.disabled, false, '检测连通随时可点（已有供应商不需要先填端点）')

  // 目录路由：协议本来就没写进配置，默认必须停在「不设置」，不能替用户挑一个。
  const catalog = EditProviderForm({
    t,
    provider: { id: 'google', displayName: null, baseURL: null, api: null, keyRef: null },
    protocols: ['openai-completions'],
    revision: 7,
    onSaved: () => {},
    onCancel: () => {},
  })
  const catalogSelect = flatten(expand(catalog)).find((node) => node.type === 'select')
  assert.equal(catalogSelect.props.value, '')
  assert.ok(
    flatten(catalogSelect).some((node) => node.type === 'option' && node.props.value === ''),
    '「不设置」那一项要在，否则下拉会显示成空值',
  )
})

test('保存与探测真的按契约发请求：POST /model 带旧 modelId，POST /discover 带 route + 表单当前值', async () => {
  const { EditModelForm, EditProviderForm } = await internals()
  const t = (key) => key
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, revision: 9, defaultsMigrated: true, models: [{ id: 'glm-5.3' }] }),
    }
  }
  let saved = null
  try {
    const model = { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 128000, maxTokens: 8192, input: ['text'] }
    const modelForm = EditModelForm({
      t,
      provider: { id: 'cli', models: [model] },
      model,
      index: 0,
      levels: ['off', 'low', 'high'],
      revision: 5,
      onSaved: (payload) => {
        saved = payload
      },
      onCancel: () => {},
    })
    const save = flatten(expand(modelForm)).find((node) => node.type === 'button' && node.children[0] === 'save')
    save.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/model-tuning\/model$/)
    assert.deepEqual(Object.keys(requests[0].body).sort(), ['model', 'modelId', 'revision', 'route'])
    assert.equal(requests[0].body.route, 'cli')
    assert.equal(requests[0].body.revision, 5)
    assert.equal(requests[0].body.modelId, 'glm-5.3')
    assert.equal(requests[0].body.model.id, 'glm-5.3')
    assert.deepEqual(saved, { ok: true, revision: 9, defaultsMigrated: true, models: [{ id: 'glm-5.3' }] })

    const providerForm = EditProviderForm({
      t,
      provider: { id: 'cli', displayName: 'GLM 中转', baseURL: 'https://a.example/v1', api: 'openai-completions', keyRef: 'CLI_API_KEY' },
      protocols: ['openai-completions'],
      revision: 5,
      onSaved: () => {},
      onCancel: () => {},
    })
    const discover = flatten(expand(providerForm)).find((node) => node.type === 'button' && node.children[0] === 'discover')
    discover.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(requests.length, 2)
    assert.match(requests[1].url, /\/model-tuning\/discover$/)
    assert.deepEqual(
      requests[1].body,
      { route: 'cli', baseURL: 'https://a.example/v1', api: 'openai-completions' },
      '已有供应商的探测要带 route + 表单当前值（否则宿主探的是已保存的旧地址）；密钥不经过客户端',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('供应商区块接线：供应商头与每个模型行都有「编辑」，撤销按钮改成「撤销上一次写入」', async () => {
  const entry = await loadEntry()
  const payload = {
    state: { defaults: null, teamDefaultEnabled: false, carryEffort: false, taskFirstHint: false },
    warning: null,
    dshDefault: null,
    levels: ['off', 'low', 'high'],
    patch: { state: 'patched', detail: '', archivePath: '', appVersion: '', backupPath: null },
    capabilities: { settings: true },
    externalManager: false,
  }
  const providersPayload = {
    ns: 'llm-pi-ai',
    revision: 3,
    levels: ['off', 'low', 'high'],
    protocols: ['openai-completions'],
    templates: [],
    undo: { at: '2026-11-19T08:00:00.000Z', label: '新建供应商 cli' },
    providers: [
      {
        id: 'cli',
        displayName: 'GLM 中转',
        api: 'openai-completions',
        baseURL: 'https://a.example/v1',
        declared: true,
        modelsExplicit: true,
        userOwned: true,
        keyRef: 'CLI_API_KEY',
        models: [{ id: 'glm-5.3', name: 'GLM-5.3' }],
      },
      {
        id: 'google',
        displayName: 'Google',
        api: null,
        baseURL: null,
        declared: false,
        modelsExplicit: false,
        userOwned: false,
        keyRef: null,
        models: [{ id: 'gemini-4-hydrogen' }],
      },
    ],
  }
  const react = hybridReact([payload, null, providersPayload, null])
  const { slotCalls } = install(entry, react)
  const registration = slotCalls.find((call) => call.kind === 'register')
  const card = registration.component({ view: 'page', t: (key) => key })
  const pageNodes = flatten(card.type(card.props))
  const providersBlock = pageNodes.find((node) => typeof node.type === 'function' && node.type.name === 'ProvidersBlock')
  assert.ok(providersBlock !== undefined)

  const tree = providersBlock.type(providersBlock.props)
  const nodes = flatten(tree)
  const buttons = byName(tree, 'Button')
  assert.deepEqual(
    buttons.map((node) => node.children[0]),
    [
      'edit', // 供应商头 cli
      'removeProvider', // 自建供应商才给删除
      'edit', // 模型行 glm-5.3
      'remove', // 显式 models 才给删模型
      'addModel', // 只有显式 models 的供应商能加模型
      'edit', // 供应商头 google（目录路由也能改显示名/端点）
      'edit', // 目录路由的模型行也能编辑（写的是 override）
      'addProvider',
      'undo',
    ],
    '供应商区块里「编辑」与既有按钮的相对位置变了就要重新确认一遍',
  )
  const undoButton = buttons[buttons.length - 1]
  assert.equal(typeof undoButton.props.onClick, 'function')
  // 快照提示还在，撤销按钮的文案由字典决定（zh 是「撤销上一次写入」）。
  assert.ok(texts(tree).some((text) => text.includes('undoAt')))
})

test('撤销提示说人话：快照 slug → 动作+对象，带上被撤销的 route；认不出的退回固定文案', async () => {
  const entry = await loadEntry()
  const { localeCalls } = install(entry, reactStub())
  const zh = localeCalls[0].dictionaries.zh
  const { exportsObject } = install(entry, reactStub())
  const { undoNoticeText, undoActionText } = exportsObject.__internals
  const t = (key) => zh[key]

  assert.equal(undoActionText(t, 'edit-model'), '编辑模型')
  assert.equal(undoActionText(t, 'future-thing'), null, '认不出的 slug 不硬翻')

  assert.equal(undoNoticeText(t, { label: 'create-provider' }), '已撤销：新建供应商')
  assert.equal(undoNoticeText(t, { label: 'edit-model', routes: ['cli'] }), '已撤销：编辑模型（cli）')
  assert.equal(
    undoNoticeText(t, { label: 'edit-provider', routes: ['cli', 'google'] }),
    '已撤销：编辑供应商（cli, google）',
  )
  // 拿不到 routes 就只说动作
  assert.equal(undoNoticeText(t, { label: 'add-model', routes: [] }), '已撤销：添加模型')
  // 认不出的 label / 没有 label：slug 与时间戳都不许塞进「已撤销：」
  assert.equal(undoNoticeText(t, { label: 'whatever', routes: ['cli'] }), zh.undoneNoLabel)
  assert.equal(undoNoticeText(t, { from: '2026-11-19T08:00:00.000Z' }), zh.undoneNoLabel)
  assert.equal(undoNoticeText(t, null), zh.undoneNoLabel)
})

test('软门禁：改过端点/协议又没检测过才问，取消就什么都不发；只改密钥不问', async () => {
  const entry = await loadEntry()
  const originalConfirm = globalThis.window.confirm
  const originalFetch = globalThis.fetch
  const asked = []
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => ({ ok: true, revision: 5 }) }
  }
  try {
    const live = liveReact()
    const { exportsObject } = install(entry, live.react)
    const { EditProviderForm, needsUncheckedConfirm } = exportsObject.__internals

    // 判据：只改显示名 / 只改密钥都不拦；端点或协议改过、而这次编辑没检测成功才拦。
    assert.equal(needsUncheckedConfirm({ fields: { displayName: 'X' } }, false), false)
    assert.equal(needsUncheckedConfirm({ fields: {} }, false), false)
    assert.equal(needsUncheckedConfirm({ fields: { baseURL: 'https://b.example/v1' } }, false), true)
    assert.equal(needsUncheckedConfirm({ fields: { api: 'anthropic-messages' } }, false), true)
    assert.equal(needsUncheckedConfirm({ fields: { api: 'anthropic-messages' } }, true), false)

    const props = {
      t: (key) => key,
      provider: { id: 'cli', displayName: 'GLM 中转', baseURL: 'https://a.example/v1', api: 'openai-completions', keyRef: 'CLI_API_KEY' },
      protocols: ['openai-completions', 'anthropic-messages'],
      revision: 4,
      onSaved: () => {},
      onCancel: () => {},
    }
    const render = () => {
      live.begin()
      return flatten(expand(EditProviderForm(props)))
    }
    // 保存按钮的文案会从「save」变成「saving」：两次点击之间 saving 一直是 true，两个都要认。
    const click = (...labels) =>
      render().find((node) => node.type === 'button' && labels.includes(node.children[0])).props.onClick()
    const clickSave = () => click('save', 'saving')

    // 改掉 baseURL，但一次都没点过「检测连通」
    render()
      .find((node) => node.type === 'input' && node.props.value === 'https://a.example/v1')
      .props.onChange({ target: { value: 'https://b.example/v1' } })

    globalThis.window.confirm = (message) => {
      asked.push(message)
      return false
    }
    clickSave()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(asked, ['confirmSaveUnchecked'])
    assert.equal(requests.length, 0, '用户取消后一个请求都不发，也不报错')

    // 确认之后才真的写，且只发改过的那个字段
    globalThis.window.confirm = (message) => {
      asked.push(message)
      return true
    }
    clickSave()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(asked.length, 2)
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/model-tuning\/provider\/edit$/)
    assert.deepEqual(requests[0].body.fields, { baseURL: 'https://b.example/v1' })

    // 改完端点先点「检测连通」：探测请求要带表单里的新值，成功之后保存不再多问一句。
    globalThis.window.confirm = () => {
      throw new Error('检测成功之后不该再弹确认')
    }
    click('discover')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests.length, 2)
    assert.match(requests[1].url, /\/model-tuning\/discover$/)
    assert.deepEqual(
      requests[1].body,
      { route: 'cli', baseURL: 'https://b.example/v1', api: 'openai-completions' },
      '探测必须带表单当前值：只按 route 探会验到已保存的旧地址',
    )
    clickSave()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests.length, 3)
    assert.match(requests[2].url, /\/model-tuning\/provider\/edit$/)
  } finally {
    globalThis.window.confirm = originalConfirm
    globalThis.fetch = originalFetch
  }

  // 只改密钥：不弹确认，直接发（key 非空才出现，fields 保持空）
  const liveKey = liveReact()
  const { exportsObject: keyExports } = install(entry, liveKey.react)
  const EditProviderForm = keyExports.__internals.EditProviderForm
  const keyRequests = []
  globalThis.fetch = async (url, options) => {
    keyRequests.push({ url: String(url), body: JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  globalThis.window.confirm = () => {
    throw new Error('只改密钥不该弹确认')
  }
  try {
    const props = {
      t: (key) => key,
      provider: { id: 'cli', displayName: 'GLM 中转', baseURL: 'https://a.example/v1', api: 'openai-completions', keyRef: 'CLI_API_KEY' },
      protocols: ['openai-completions'],
      revision: 4,
      onSaved: () => {},
      onCancel: () => {},
    }
    const render = () => {
      liveKey.begin()
      return flatten(expand(EditProviderForm(props)))
    }
    render()
      .find((node) => node.type === 'input' && node.props.type === 'password')
      .props.onChange({ target: { value: 'sk-new' } })
    render().find((node) => node.type === 'button' && node.children[0] === 'save').props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(keyRequests.length, 1)
    assert.deepEqual(keyRequests[0].body, { route: 'cli', revision: 4, fields: {}, key: 'sk-new' })
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window.confirm = originalConfirm
  }
})
