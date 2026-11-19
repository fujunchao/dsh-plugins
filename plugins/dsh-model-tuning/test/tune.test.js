import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createSnapshots } from '../lib/snapshots.js'
import {
  buildModelOps,
  buildRouteOps,
  changedRoutes,
  createTuner,
  migrateDefaults,
  providersView,
  reasoningOf,
  routeProfiles,
  routesOfOps,
} from '../lib/tune.js'

/**
 * 在假配置上执行一组路径 op：让 `describe()` 能反映"写完之后的值"。
 * 只实现本插件会用的 `set`／`unset` 两种（settings 的 op 语法就这两种）。
 */
function applyOps(root, ops) {
  for (const op of ops) {
    const path = op.path.slice(1) // 去掉 'providers'
    let node = root
    for (const key of path.slice(0, -1)) {
      if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
      node = node[key]
    }
    const last = path[path.length - 1]
    if (op.op === 'set') node[last] = structuredClone(op.value)
    else delete node[last]
  }
}

/**
 * 假宿主：`settings.describe()` 的 user 层就是可写配置，`mutate` 按路径 op 改它。
 * `base` 是继承层（目录里自带的端点），`value` 是宿主算出来的生效值（目录里的模型在
 * 这一层，配置层看不到），两者都只为"目录路由"的用例准备。
 */
function fakeHost({ user = {}, base = {}, value = {}, keys = {}, mutate } = {}) {
  const providers = structuredClone(user)
  const calls = []
  let revision = 1
  const settings = {
    describe() {
      return [{
        ns: 'llm-pi-ai',
        revision,
        base: { providers: structuredClone(base) },
        user: { providers },
        value: { providers: structuredClone(value) },
      }]
    },
    async mutate(ns, ops, expected) {
      calls.push({ ns, ops, revision: expected })
      if (typeof mutate === 'function') {
        await mutate(ns, ops, expected)
        return
      }
      applyOps(providers, ops)
      revision += 1
    },
  }
  const credentials = {
    refs: new Map(Object.entries(keys)),
    async set(ref, stored) { credentials.refs.set(ref, stored) },
    async unset(ref) { credentials.refs.delete(ref) },
    async resolve(ref) { return credentials.refs.has(ref) ? { value: credentials.refs.get(ref) } : undefined },
  }
  const ctx = {
    get(name) {
      if (name === 'settings') return settings
      if (name === 'credentials') return credentials
      return undefined
    },
  }
  const snapshots = createSnapshots(mkdtempSync(join(tmpdir(), 'model-tuning-tune-')))
  return { ctx, providers, calls, credentials, snapshots, tuner: createTuner(ctx, { snapshots }) }
}

/** 一条带显式 models 的供应商（改名走"元素替换"分支）。 */
function explicitProvider() {
  return {
    cli: {
      displayName: 'cli',
      api: 'anthropic-messages',
      baseURL: 'https://gw.example',
      apiKeyEnv: 'CLI_API_KEY',
      models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', contextWindow: 1000 }],
    },
  }
}

/** 一条纯目录路由：端点在继承层，模型在 value 层，用户层只有 override。 */
function directoryHost() {
  return fakeHost({
    user: { dir: { modelOverrides: { 'm-1': { name: '旧名字' } } } },
    base: { dir: { api: 'openai-completions', baseURL: 'https://relay.example/v1' } },
    value: { dir: { models: [{ id: 'm-1' }, { id: 'm-2' }] } },
  })
}

test('providersView：只挑界面上的字段，缺 models 时给空数组', () => {
  const view = providersView({
    cli: {
      displayName: 'cli',
      api: 'anthropic-messages',
      baseURL: 'https://gw.example',
      apiKeyEnv: 'CLI_API_KEY',
      compat: { forceAdaptiveThinking: true },
      models: [{ id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, reasoningEfforts: { low: 'low', high: 'high' } }],
    },
    bare: {},
  })
  assert.equal(view.length, 2)
  const cli = view.find((entry) => entry.id === 'cli')
  assert.equal(cli.api, 'anthropic-messages')
  assert.equal('apiKeyEnv' in cli, false)
  assert.deepEqual(cli.models[0].reasoningEfforts, { low: 'low', high: 'high' })
  const bare = view.find((entry) => entry.id === 'bare')
  assert.deepEqual(bare.models, [])
  assert.equal(bare.displayName, 'bare')
})

test('buildModelOps：整段替换 models 数组，删字段用 undefined', () => {
  const models = [
    { id: 'a', reasoningEfforts: { low: 'low' } },
    { id: 'b', contextWindow: 1000 },
  ]
  const ops = buildModelOps('deepseek', models, 'a', { reasoningEfforts: { off: null, max: 'max' }, name: 'A' })
  assert.equal(ops.length, 1)
  assert.deepEqual(ops[0].path, ['providers', 'deepseek', 'models'])
  assert.deepEqual(ops[0].value[0], { id: 'a', reasoningEfforts: { off: null, max: 'max' }, name: 'A' })
  // 未触及的模型原样保留
  assert.deepEqual(ops[0].value[1], { id: 'b', contextWindow: 1000 })

  const removed = buildModelOps('deepseek', models, 'a', { reasoningEfforts: undefined })
  assert.deepEqual(removed[0].value[0], { id: 'a' })
})

test('buildModelOps：reasoningEfforts=false 是"显式非推理"，不是删除', () => {
  const ops = buildModelOps('google', [{ id: 'g' }], 'g', { reasoningEfforts: false })
  assert.equal(ops[0].value[0].reasoningEfforts, false)
})

test('buildModelOps：模型不存在时报错，不静默写', () => {
  assert.throws(() => buildModelOps('google', [{ id: 'g' }], 'nope', { name: 'x' }), /不在 google/)
})

test('buildRouteOps：null 走 unset（回退继承值），值走 set', () => {
  const ops = buildRouteOps('cli', { defaultContextWindow: 200000, thinkingBudgets: null, reasoning: 'max', bogus: 1 })
  assert.deepEqual(ops, [
    { op: 'set', path: ['providers', 'cli', 'defaultContextWindow'], value: 200000 },
    { op: 'unset', path: ['providers', 'cli', 'thinkingBudgets'] },
    { op: 'set', path: ['providers', 'cli', 'reasoning'], value: 'max' },
  ])
})

test('reasoningOf：容忍 efforts 是字符串或对象两种形状', () => {
  assert.deepEqual(reasoningOf({ reasoning: { efforts: ['low', { effort: 'high' }, { id: 'max' }], defaultEffort: 'high' } }), {
    supported: ['low', 'high', 'max'],
    defaultEffort: 'high',
  })
  assert.deepEqual(reasoningOf({}), { supported: [], defaultEffort: null })
  assert.deepEqual(reasoningOf(null), { supported: [], defaultEffort: null })
})

test('routeProfiles：base/user/value 三层合并，value 覆盖同名路由', () => {
  const view = {
    base: { providers: { deepseek: { models: [{ id: 'a', contextWindow: 1000 }], reasoning: 'max' } } },
    user: { providers: { deepseek: { models: [{ id: 'a', reasoningEfforts: { low: 'low' } }] } } },
    value: { providers: { cli: { displayName: 'cli' } } },
  }
  const routes = routeProfiles(view)
  // user 层的 models 整段覆盖 base 的（数组按值替换），reasoning 仍从 base 继承
  assert.deepEqual(routes.deepseek.models, [{ id: 'a', reasoningEfforts: { low: 'low' } }])
  assert.equal(routes.deepseek.reasoning, 'max')
  assert.equal(routes.cli.displayName, 'cli')
})

test('routeProfiles：value 缺 models 时不丢底稿', () => {
  const view = {
    base: { providers: { google: { models: [{ id: 'gemini-4-hydrogen' }] } } },
    value: { providers: { google: { api: 'google-generative-ai' } } },
  }
  const routes = routeProfiles(view)
  assert.equal(routes.google.api, 'google-generative-ai')
  assert.deepEqual(routes.google.models, [{ id: 'gemini-4-hydrogen' }])
})

test('routeProfiles：空视图给空对象，不抛', () => {
  assert.deepEqual(routeProfiles(undefined), {})
  assert.deepEqual(routeProfiles({}), {})
})

/* ---------- 改名（ADR 0009 第 2 条） ---------- */

test('write：显式 models 改名 = 元素替换，其余模型与顺序不动', async () => {
  const host = fakeHost({ user: explicitProvider() })
  const result = await host.tuner.write({ route: 'cli', revision: 1, modelId: 'a', model: { id: 'a-pro', name: 'A2' } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.rename, { route: 'cli', from: 'a', to: 'a-pro' })
  assert.deepEqual(host.calls[0].ops, [{
    op: 'set',
    path: ['providers', 'cli', 'models'],
    value: [{ id: 'a-pro', name: 'A2' }, { id: 'b', name: 'B', contextWindow: 1000 }],
  }])
  assert.deepEqual(host.providers.cli.models.map((model) => model.id), ['a-pro', 'b'], '顺序不变，另一个模型没被碰')
})

test('write：目录路由改名 = 同一批 ops 里 set 新键 + unset 旧键，override 不带 id', async () => {
  const host = directoryHost()
  const result = await host.tuner.write({ route: 'dir', revision: 1, modelId: 'm-1', model: { id: 'm-1x', name: '新名字' } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.rename, { route: 'dir', from: 'm-1', to: 'm-1x' })
  assert.equal(host.calls.length, 1, '改名必须一次写完（一个 revision），不能拆成两次')
  assert.deepEqual(host.calls[0].ops, [
    { op: 'set', path: ['providers', 'dir', 'modelOverrides', 'm-1x'], value: { name: '新名字' } },
    { op: 'unset', path: ['providers', 'dir', 'modelOverrides', 'm-1'] },
  ])
  assert.equal('id' in host.calls[0].ops[0].value, false)
  assert.deepEqual(host.providers.dir.modelOverrides, { 'm-1x': { name: '新名字' } })
})

test('write：目录路由不改名时仍只写 modelOverrides.<id>（形状不变）', async () => {
  const host = directoryHost()
  const result = await host.tuner.write({ route: 'dir', revision: 1, model: { id: 'm-1', name: '新名字' } })
  assert.equal(result.ok, true)
  assert.equal('rename' in result, false)
  assert.deepEqual(host.calls[0].ops, [
    { op: 'set', path: ['providers', 'dir', 'modelOverrides', 'm-1'], value: { name: '新名字' } },
  ])
})

test('write：model.id 等于 modelId（或不给 modelId）时不是改名', async () => {
  const host = fakeHost({ user: explicitProvider() })
  const result = await host.tuner.write({ route: 'cli', revision: 1, modelId: 'a', model: { id: 'a', name: 'A2' } })
  assert.equal(result.ok, true)
  assert.equal('rename' in result, false)
  assert.deepEqual(host.calls[0].ops[0].value[0], { id: 'a', name: 'A2' })
})

test('write：两个 id 都缺时说人话，不猜', async () => {
  const host = fakeHost({ user: explicitProvider() })
  const result = await host.tuner.write({ route: 'cli', revision: 1, model: { name: 'X' } })
  assert.equal(result.code, 'invalid')
  assert.match(result.message, /缺少被编辑的模型 id/)
  assert.equal(host.calls.length, 0, '参数不齐时不落快照也不写配置')
})

test('write：新 id 撞车报 invalid，且一条 op 都不写', async () => {
  const host = fakeHost({ user: explicitProvider() })
  const explicit = await host.tuner.write({ route: 'cli', revision: 1, modelId: 'a', model: { id: 'b', name: 'B2' } })
  assert.equal(explicit.code, 'invalid')
  assert.match(explicit.message, /模型 id 已存在：b/)
  assert.equal(host.calls.length, 0)

  const dirHost = directoryHost()
  const listed = await dirHost.tuner.write({ route: 'dir', revision: 1, modelId: 'm-1', model: { id: 'm-2' } })
  assert.equal(listed.code, 'invalid')
  assert.match(listed.message, /模型 id 已存在：m-2/)
  assert.equal(dirHost.calls.length, 0)
})

test('migrateDefaults：只迁移命中 provider 与旧 id 的那一条', () => {
  const state = { version: 1, defaults: { provider: 'cli', model: 'a', reasoningEffort: 'high' }, carryEffort: true }
  const hit = migrateDefaults(state, 'cli', 'a', 'a-pro')
  assert.equal(hit.migrated, true)
  assert.deepEqual(hit.state.defaults, { provider: 'cli', model: 'a-pro', reasoningEffort: 'high' })
  assert.equal(hit.state.carryEffort, true, '其余状态原样保留')

  const otherProvider = migrateDefaults(state, 'deepseek', 'a', 'a-pro')
  assert.equal(otherProvider.migrated, false)
  assert.equal(otherProvider.state, state, '没命中就别造新对象')
  assert.equal(migrateDefaults(state, 'cli', 'other', 'x').migrated, false)
  assert.equal(migrateDefaults({ defaults: null }, 'cli', 'a', 'x').migrated, false)
})

test('changedRoutes / routesOfOps：撤销复核只认真的变过（键顺序不算）', () => {
  assert.deepEqual(changedRoutes({ a: { x: 1 }, b: { y: 1 } }, { a: { x: 1 }, b: { y: 2 } }), ['b'])
  assert.deepEqual(changedRoutes({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }), [], '只是键顺序不同不算改动')
  assert.deepEqual(changedRoutes({ a: { x: 1 } }, {}), ['a'], '被删掉的路由也要算')
  assert.deepEqual(changedRoutes({}, { c: {} }), ['c'])
  assert.deepEqual(routesOfOps([
    { op: 'set', path: ['providers', 'cli', 'models'] },
    { op: 'unset', path: ['providers', 'a'] },
    { op: 'set', path: ['providers', 'cli', 'api'] },
  ]), ['a', 'cli'], '按路由去重')
})

/* ---------- 供应商身份字段（POST /provider/edit） ---------- */

test('editProvider：逐键 set，密钥写在现有引用名下（引用名不许改）', async () => {
  const host = fakeHost({ user: explicitProvider(), keys: { CLI_API_KEY: 'sk-old' } })
  const result = await host.tuner.editProvider({
    route: 'cli',
    revision: 1,
    fields: { displayName: ' GLM 中转 ', baseURL: 'https://gw2.example', api: 'openai-completions' },
    key: ' sk-new ',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.credential, { ok: true, keyRef: 'CLI_API_KEY' })
  assert.deepEqual(host.calls[0].ops, [
    { op: 'set', path: ['providers', 'cli', 'displayName'], value: 'GLM 中转' },
    { op: 'set', path: ['providers', 'cli', 'baseURL'], value: 'https://gw2.example' },
    { op: 'set', path: ['providers', 'cli', 'api'], value: 'openai-completions' },
  ])
  assert.equal(host.calls[0].revision, 1, 'revision 围栏原样传下去')
  assert.equal(host.credentials.refs.get('CLI_API_KEY'), 'sk-new')
  assert.equal(host.providers.cli.apiKeyEnv, 'CLI_API_KEY', '引用名保持原样')

  const latest = host.snapshots.latest()
  assert.equal(latest.label, 'edit-provider')
  assert.deepEqual(latest.providers.cli.models.map((model) => model.id), ['a', 'b'], '撤销点是写前的值')
  assert.equal(latest.after.cli.displayName, 'GLM 中转')
})

test('editProvider：不认识的字段／空串／非法协议／未知路由都不写配置', async () => {
  const host = fakeHost({ user: explicitProvider() })
  const extra = await host.tuner.editProvider({ route: 'cli', fields: { displayName: 'x', apiKeyEnv: 'HACK' } })
  assert.equal(extra.code, 'invalid')
  assert.match(extra.message, /改不了 apiKeyEnv/)

  const empty = await host.tuner.editProvider({ route: 'cli', fields: { baseURL: '' } })
  assert.equal(empty.code, 'invalid')
  const badApi = await host.tuner.editProvider({ route: 'cli', fields: { api: 'openai-chat' } })
  assert.equal(badApi.code, 'invalid')
  const missing = await host.tuner.editProvider({ route: 'nope', fields: { displayName: 'x' } })
  assert.equal(missing.code, 'invalid')
  assert.match(missing.message, /没有这条供应商/)
  assert.equal(host.calls.length, 0, '输入不合法时一条 op 都不写')
})

test('editProvider：没有引用名就无处存密钥；宿主拒绝时翻成 invalid 且不留半成品', async () => {
  const noRef = fakeHost({
    user: { local: { api: 'openai-completions', baseURL: 'http://127.0.0.1:11434/v1', models: [{ id: 'qwen' }] } },
  })
  const refused = await noRef.tuner.editProvider({ route: 'local', revision: 1, fields: { displayName: '本机' }, key: 'sk-x' })
  assert.equal(refused.code, 'invalid')
  assert.match(refused.message, /没有凭据引用名/)
  assert.equal(noRef.calls.length, 0, '先拒掉，别写一半')

  const host = fakeHost({
    user: explicitProvider(),
    mutate: async () => { throw new Error('llm-pi-ai: 新协议与现有模型不兼容') },
  })
  const result = await host.tuner.editProvider({
    route: 'cli',
    revision: 1,
    fields: { api: 'google-generative-ai' },
    key: 'sk-x',
  })
  assert.equal(result.code, 'invalid', '宿主的 assertServiceable 拒绝是"值不能写"，不是冲突')
  assert.match(result.message, /不兼容/)
  assert.equal(host.credentials.refs.size, 0, '配置没写成就别动密钥')
})

/* ---------- 按已存在的供应商检测连通（POST /discover {route}） ---------- */

test('discoveryRequest：按配置拼请求，密钥从凭据服务取明文（只在宿主侧）', async () => {
  const host = fakeHost({ user: explicitProvider(), keys: { CLI_API_KEY: 'sk-cli' } })
  const prepared = await host.tuner.discoveryRequest({ route: 'cli' })
  assert.equal(prepared.ok, true)
  assert.deepEqual(prepared.request, {
    baseURL: 'https://gw.example',
    api: 'anthropic-messages',
    apiKey: 'sk-cli',
  })
  assert.equal('CLI_API_KEY' in prepared.request, false, '请求里带明文，不带引用名')
})

test('discoveryRequest：没有 baseURL 退回 provider 探测，未知 route 报 invalid', async () => {
  const host = fakeHost({ user: { local: { api: 'openai-completions', models: [{ id: 'qwen' }] } } })
  const fallback = await host.tuner.discoveryRequest({ route: 'local' })
  assert.equal(fallback.ok, true)
  assert.deepEqual(fallback.request, { provider: 'local' })

  const missing = await host.tuner.discoveryRequest({ route: 'nope' })
  assert.equal(missing.code, 'invalid')
  assert.equal((await host.tuner.discoveryRequest({ route: '' })).code, 'invalid')
})

test('discoveryRequest：显式端点覆盖已保存的值，显式密钥优先于凭据服务', async () => {
  const host = fakeHost({ user: explicitProvider(), keys: { CLI_API_KEY: 'sk-saved' } })
  // 只给 route：用 profile 里已保存的端点与凭据服务里的密钥（回归）
  assert.deepEqual((await host.tuner.discoveryRequest({ route: 'cli' })).request, {
    baseURL: 'https://gw.example',
    api: 'anthropic-messages',
    apiKey: 'sk-saved',
  })
  // 显式端点（编辑表单里还没保存的值）优先，两端空白会被 trim
  assert.deepEqual((await host.tuner.discoveryRequest({
    route: 'cli',
    baseURL: ' https://draft.example/v2 ',
    api: 'openai-completions',
  })).request, {
    baseURL: 'https://draft.example/v2',
    api: 'openai-completions',
    apiKey: 'sk-saved',
  })
  // 显式密钥压过凭据服务
  const typed = await host.tuner.discoveryRequest({ route: 'cli', apiKey: ' sk-typed ' })
  assert.equal(typed.request.apiKey, 'sk-typed')
  // 显式与已保存都没有 baseURL 时才退回 provider
  const blank = fakeHost({ user: { local: { api: 'openai-completions', models: [{ id: 'qwen' }] } } })
  assert.deepEqual((await blank.tuner.discoveryRequest({ route: 'local' })).request, { provider: 'local' })
})

/* ---------- 快照 after 子树与撤销复核（ADR 0009 第 6 条） ---------- */

test('五个捕获点都写 after：新建 / 加模型 / 删模型 / 删供应商', async () => {
  const host = fakeHost({})
  const created = await host.tuner.createProvider({
    route: 'relay-x',
    revision: 1,
    draft: { api: 'openai-completions', baseURL: 'https://relay.example/v1', models: [{ id: 'gpt-x' }] },
  })
  assert.equal(created.ok, true)
  const afterCreate = host.snapshots.latest()
  assert.equal(afterCreate.label, 'create-provider')
  assert.deepEqual(afterCreate.providers, {}, '撤销点是写前的空配置')
  assert.deepEqual(afterCreate.after['relay-x'].models.map((model) => model.id), ['gpt-x'])

  const added = await host.tuner.addModel({ route: 'relay-x', revision: 2, model: { id: 'gpt-y' } })
  assert.equal(added.ok, true)
  const afterAdd = host.snapshots.latest()
  assert.equal(afterAdd.label, 'add-model')
  assert.deepEqual(afterAdd.providers['relay-x'].models.map((model) => model.id), ['gpt-x'])
  assert.deepEqual(afterAdd.after['relay-x'].models.map((model) => model.id), ['gpt-x', 'gpt-y'])

  const removed = await host.tuner.removeModel({ route: 'relay-x', revision: 3, modelId: 'gpt-y' })
  assert.equal(removed.ok, true)
  const afterRemove = host.snapshots.latest()
  assert.equal(afterRemove.label, 'remove-model')
  assert.deepEqual(afterRemove.after['relay-x'].models.map((model) => model.id), ['gpt-x'])

  const deleted = await host.tuner.deleteProvider({ route: 'relay-x', revision: 4 })
  assert.equal(deleted.ok, true)
  const afterDelete = host.snapshots.latest()
  assert.equal(afterDelete.label, 'delete-provider')
  assert.deepEqual(Object.keys(afterDelete.providers), ['relay-x'])
  assert.deepEqual(afterDelete.after, {})
})

test('undoStructure：当前值与 after 一致时照常撤销，成功带 label 与 routes', async () => {
  const host = fakeHost({ user: explicitProvider() })
  await host.tuner.write({ route: 'cli', revision: 1, model: { id: 'a', name: 'A2' } })
  const latest = host.snapshots.latest()
  assert.equal(latest.label, 'edit-model')
  assert.deepEqual(latest.after.cli.models.map((model) => model.name), ['A2', 'B'])

  const result = await host.tuner.undoStructure({ revision: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.label, 'edit-model')
  assert.deepEqual(result.routes, ['cli'])
  assert.deepEqual(host.providers.cli.models.map((model) => model.name), ['A', 'B'], '回到写前的值')
})

test('undoStructure：当前值 ≠ after 报 stale 且不写，force 才照常撤销', async () => {
  const host = fakeHost({ user: { cli: { api: 'anthropic-messages', models: [{ id: 'a' }] } } })
  await host.tuner.write({ route: 'cli', revision: 1, model: { id: 'a', name: 'A2' } })
  // 模拟原生页/手改在快照之后又动了同一条供应商（没走我们的快照）
  host.providers.cli.displayName = '被原生页改过'
  const writes = host.calls.length

  const stale = await host.tuner.undoStructure({ revision: 2 })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'stale')
  assert.deepEqual(stale.routes, ['cli'])
  assert.match(stale.message, /又被改过/)
  assert.equal(stale.label, 'edit-model', '告诉界面这是哪一次写入')
  assert.equal(host.calls.length, writes, 'stale 时一条 op 都不能写')

  const forced = await host.tuner.undoStructure({ revision: 2, force: true })
  assert.equal(forced.ok, true)
  assert.equal(host.providers.cli.displayName, undefined, '整条 provider 覆盖回写前的值')
  assert.deepEqual(host.providers.cli.models, [{ id: 'a' }])
})

test('undoStructure：旧快照没有 after 时不阻断撤销', async () => {
  const host = fakeHost({ user: { cli: { api: 'anthropic-messages', models: [{ id: 'a' }] } } })
  host.snapshots.capture({ cli: { api: 'anthropic-messages', models: [{ id: 'a' }] } }, 'legacy')
  host.providers.cli.displayName = '手改'
  const result = await host.tuner.undoStructure({ revision: 1 })
  assert.equal(result.ok, true)
  assert.equal(result.label, 'legacy')
  assert.deepEqual(host.providers.cli.displayName, undefined)
})

