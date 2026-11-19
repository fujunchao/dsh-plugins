/**
 * 宿主半的端到端冒烟测试：用假 ctx 装整插件，再用真的 http 服务器跑路由。
 *
 * 这里不测 UI，只测「客户端能拿到什么、错误怎么翻译」这条合同——
 * 它是宿主半与客户端半之间唯一的接触面。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const stateFile = join(mkdtempSync(join(tmpdir(), 'model-tuning-routes-')), 'state.json')
process.env.DSH_MODEL_TUNING_STATE = stateFile
// 结构变更会写快照；测试绝不能往真实的 ~/.dsh/model-tuning-backups 里丢东西
process.env.DSH_MODEL_TUNING_BACKUPS = mkdtempSync(join(tmpdir(), 'model-tuning-backups-'))

const { apply } = await import('../lib/index.js')

/** 一个只实现本插件会碰到的服务的假宿主。 */
function fakeCtx({ mutate, providers: seed } = {}) {
  const disposers = []
  const handlers = new Map()
  // 可写配置放在外面：测试要模拟"原生页/手改在快照之后又动了一次"（撤销复核用例）。
  const providers = seed ?? {
    cli: {
      displayName: 'cli',
      api: 'anthropic-messages',
      baseURL: 'https://gw.example',
      apiKeyEnv: 'CLI_API_KEY',
      models: [{ id: 'glm-5.3', contextWindow: 1000000, reasoningEfforts: { low: 'low', max: 'max' } }],
    },
  }
  const settings = {
    describe() {
      return [{
        ns: 'llm-pi-ai',
        revision: 7,
        user: { providers },
      }]
    },
    async mutate(ns, ops, revision) {
      if (typeof mutate === 'function') return mutate(ns, ops, revision)
      return undefined
    },
  }
  const llm = {
    discoveries: [],
    async resolveModelInfo(provider, model) {
      if (model === 'unknown') throw new Error('模型不可用')
      return { provider, model, reasoning: { efforts: ['off', 'low', 'high', 'max'], defaultEffort: 'high' } }
    },
    async discoverModels(settingsNs, request) {
      llm.discoveries.push({ settingsNs, request })
      return [{ id: 'm-1', name: 'Model One' }, { id: 'm-2' }]
    },
  }
  const credentials = {
    refs: new Map(),
    async set(ref, value) { credentials.refs.set(ref, value) },
    async unset(ref) { credentials.refs.delete(ref) },
    async resolve(ref) { return credentials.refs.has(ref) ? { value: credentials.refs.get(ref) } : undefined },
  }
  const ctx = {
    handlers,
    providers,
    llm,
    credentials,
    logger: { warn() {}, info() {} },
    effect(fn) {
      disposers.push(fn())
      return () => {}
    },
    on(name, fn) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn])
      return () => {}
    },
    get(name) {
      if (name === 'settings') return settings
      if (name === 'llm') return llm
      if (name === 'credentials') return credentials
      if (name === 'agents') return { get: () => undefined }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' }) }
      return undefined
    },
    webServer: {
      register({ handler }) {
        ctx.routeHandler = handler
        return () => { ctx.routeHandler = undefined }
      },
    },
  }
  return ctx
}

/** 起一个真服务器，把插件注册的 handler 挂上去。 */
async function serve(ctx) {
  const server = createServer((req, res) => { void ctx.routeHandler(req, res) })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}/model-tuning` }
}

const servers = []
after(() => { for (const server of servers) server.close() })

async function withPlugin(options = {}) {
  const ctx = fakeCtx(options)
  apply(ctx)
  const { server, base } = await serve(ctx)
  servers.push(server)
  return { ctx, base }
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

test('GET /state：空状态 + DSH 当前默认 + 补丁状态可读', async () => {
  const { base } = await withPlugin()
  const response = await fetch(`${base}/state`)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.state.defaults, null)
  assert.equal(payload.state.teamDefaultEnabled, false)
  assert.equal(payload.state.carryEffort, true)
  assert.deepEqual(payload.dshDefault, { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })
  assert.deepEqual(payload.levels, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(typeof payload.patch.state, 'string')
  assert.equal(payload.statePath, stateFile)
})

test('GET /providers：只暴露界面字段与 revision', async () => {
  const { base } = await withPlugin()
  const payload = await (await fetch(`${base}/providers`)).json()
  assert.equal(payload.ns, 'llm-pi-ai')
  assert.equal(payload.revision, 7)
  assert.equal(payload.providers.length, 1)
  assert.equal(payload.providers[0].id, 'cli')
  assert.equal('apiKeyEnv' in payload.providers[0], false)
  assert.deepEqual(payload.providers[0].models[0].reasoningEfforts, { low: 'low', max: 'max' })
})

test('POST /defaults：能存，且非法/不可用的选择被拒', async () => {
  const { base } = await withPlugin()
  const ok = await post(`${base}/defaults`, { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })
  assert.equal(ok.status, 200)
  assert.deepEqual((await ok.json()).state.defaults, { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })

  const missing = await post(`${base}/defaults`, { provider: '', model: '' })
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).error.code, 'invalid')

  const unsupported = await post(`${base}/defaults`, { provider: 'deepseek', model: 'unknown' })
  assert.equal(unsupported.status, 400)

  const badEffort = await post(`${base}/defaults`, { provider: 'deepseek', model: 'x', reasoningEffort: 'xhigh' })
  assert.equal(badEffort.status, 400)
  assert.match((await badEffort.json()).error.message, /不支持思考等级/)
})

test('POST /team-default 与 /carry-effort：写状态文件', async () => {
  const { base } = await withPlugin()
  assert.equal((await post(`${base}/team-default`, { enabled: true })).status, 200)
  assert.equal((await post(`${base}/carry-effort`, { enabled: false })).status, 200)
  const payload = await (await fetch(`${base}/state`)).json()
  assert.equal(payload.state.teamDefaultEnabled, true)
  assert.equal(payload.state.carryEffort, false)
})

test('POST /model：成功时回新 revision 与 providers', async () => {
  const seen = []
  const { base } = await withPlugin({ mutate: async (ns, ops, revision) => { seen.push({ ns, ops, revision }) } })
  const response = await post(`${base}/model`, {
    route: 'cli',
    revision: 7,
    model: { id: 'glm-5.3', reasoningEfforts: { off: null, low: 'low', high: 'high' } },
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.revision, 7)
  assert.equal(payload.providers.length, 1)
  assert.equal(seen[0].ns, 'llm-pi-ai')
  assert.deepEqual(seen[0].ops[0].path, ['providers', 'cli', 'models'])
  assert.deepEqual(seen[0].ops[0].value[0].reasoningEfforts, { off: null, low: 'low', high: 'high' })
})

test('POST /model：revision 冲突翻译成 409（不自动重试）', async () => {
  const conflict = Object.assign(new Error('expected 9 actual 7'), { code: 'SETTINGS_CONFLICT', expected: 9, actual: 7 })
  const { base } = await withPlugin({ mutate: async () => { throw conflict } })
  const response = await post(`${base}/model`, { route: 'cli', revision: 9, model: { id: 'glm-5.3', name: 'GLM' } })
  assert.equal(response.status, 409)
  const payload = await response.json()
  assert.equal(payload.error.code, 'conflict')
  assert.match(payload.error.message, /已被外部改动/)
})

test('POST /model：未知路由与未知模型都是 400', async () => {
  const { base } = await withPlugin()
  const unknownRoute = await post(`${base}/model`, { route: 'nope', model: { id: 'x', name: 'X' } })
  assert.equal(unknownRoute.status, 400)
  const unknownModel = await post(`${base}/model`, { route: 'cli', model: { id: 'nope', name: 'X' } })
  assert.equal(unknownModel.status, 400)
  assert.match((await unknownModel.json()).error.message, /不在 cli/)
})

test('未知端点 404，方法不对 404（前缀路由只认自己那几条）', async () => {
  const { base } = await withPlugin()
  assert.equal((await fetch(`${base}/nope`)).status, 404)
})

test('POST /task-first-hint：默认关，能打开也能关掉', async () => {
  const { base } = await withPlugin()
  const initial = await (await fetch(`${base}/state`)).json()
  assert.equal(initial.state.taskFirstHint, false)
  assert.equal((await post(`${base}/task-first-hint`, { enabled: true })).status, 200)
  assert.equal((await (await fetch(`${base}/state`)).json()).state.taskFirstHint, true)
  assert.equal((await post(`${base}/task-first-hint`, { enabled: false })).status, 200)
  assert.equal((await (await fetch(`${base}/state`)).json()).state.taskFirstHint, false)
})

test('GET /providers：带上协议、模板与「可删可改/档位写到哪层」', async () => {
  const { base } = await withPlugin()
  const payload = await (await fetch(`${base}/providers`)).json()
  assert.deepEqual(payload.protocols, ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
  assert.ok(payload.templates.some((template) => template.id === 'relay'))
  const cli = payload.providers[0]
  assert.equal(cli.userOwned, true, 'user 层写了、继承层没有 → 可删可改')
  assert.equal(cli.modelsExplicit, true, '它有显式 models → 档位写 models')
  assert.equal(cli.keyRef, 'CLI_API_KEY')
})

test('GET /state：带上快照目录与外部工具提示位', async () => {
  const { base } = await withPlugin()
  const payload = await (await fetch(`${base}/state`)).json()
  assert.equal(typeof payload.backupDir, 'string')
  assert.match(payload.backupDir, /model-tuning-backups/)
  assert.equal(typeof payload.externalManager, 'boolean')
  assert.equal(payload.capabilities.credentials, true)
})

test('POST /provider：整条原子写入，并把密钥存进凭据服务', async () => {
  const seen = []
  const ctx = fakeCtx({ mutate: async (ns, ops, revision) => { seen.push({ ns, ops, revision }) } })
  apply(ctx)
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/provider`, {
    route: 'relay-x',
    displayName: '中转站',
    api: 'openai-completions',
    baseURL: 'https://relay.example/v1',
    key: 'sk-test',
    revision: 7,
    models: [{ id: 'gpt-x', contextWindow: 200000, reasoningEfforts: { low: 'low', high: 'high' } }],
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.route, 'relay-x')
  assert.equal(payload.keyRef, 'RELAY_X_API_KEY')
  assert.equal(payload.credential.ok, true)

  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].ops, [{
    op: 'set',
    path: ['providers', 'relay-x'],
    value: {
      displayName: '中转站',
      apiKeyEnv: 'RELAY_X_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://relay.example/v1',
      models: [{ id: 'gpt-x', contextWindow: 200000, reasoningEfforts: { low: 'low', high: 'high' } }],
    },
  }])
  assert.equal(ctx.credentials.refs.get('RELAY_X_API_KEY'), 'sk-test')
})

test('POST /provider：没有模型、route 撞车、缺 baseURL 都是 400 且说人话', async () => {
  const { base } = await withPlugin()
  const noModels = await post(`${base}/provider`, { route: 'empty', api: 'openai-completions', baseURL: 'https://x.example', models: [] })
  assert.equal(noModels.status, 400)
  assert.match((await noModels.json()).error.message, /至少要有一个模型/)

  const taken = await post(`${base}/provider`, { route: 'cli', api: 'openai-completions', baseURL: 'https://x.example', models: [{ id: 'm' }] })
  assert.equal(taken.status, 400)
  assert.match((await taken.json()).error.message, /已经有一条叫 cli/)

  const noBase = await post(`${base}/provider`, { route: 'nobase', api: 'openai-completions', baseURL: '', models: [{ id: 'm' }] })
  assert.equal(noBase.status, 400)
  assert.match((await noBase.json()).error.message, /baseURL/)
})

test('POST /provider：revision 冲突是 409，且此时不写凭据', async () => {
  const conflict = Object.assign(new Error('expected 9 actual 7'), { code: 'SETTINGS_CONFLICT', expected: 9, actual: 7 })
  const ctx = fakeCtx({ mutate: async () => { throw conflict } })
  apply(ctx)
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/provider`, {
    route: 'relay-y', api: 'openai-completions', baseURL: 'https://x.example', key: 'sk', revision: 9, models: [{ id: 'm' }],
  })
  assert.equal(response.status, 409)
  assert.equal(ctx.credentials.refs.size, 0, 'profile 都没写成，密钥不该落库')
})

test('DELETE /provider：unset 整条，并只删自己派生的那条凭据', async () => {
  const seen = []
  const ctx = fakeCtx({ mutate: async (ns, ops) => { seen.push(ops) } })
  apply(ctx)
  ctx.credentials.refs.set('CLI_API_KEY', 'sk-cli')
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await fetch(`${base}/provider`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: 'cli', revision: 7 }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.removedModels, 1)
  assert.equal(payload.credential.keyRef, 'CLI_API_KEY')
  assert.deepEqual(seen[0], [{ op: 'unset', path: ['providers', 'cli'] }])
  assert.equal(ctx.credentials.refs.has('CLI_API_KEY'), false)
})

test('DELETE /provider：不存在的 route 是 400', async () => {
  const { base } = await withPlugin()
  const response = await fetch(`${base}/provider`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: 'nope' }),
  })
  assert.equal(response.status, 400)
})

test('POST /model/add：整段替换 models，追加一行', async () => {
  const seen = []
  const { base } = await withPlugin({ mutate: async (ns, ops) => { seen.push(ops) } })
  const response = await post(`${base}/model/add`, {
    route: 'cli',
    revision: 7,
    model: { id: 'glm-6', contextWindow: 2000000, reasoningEfforts: { low: 'low', high: 'high' } },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(seen[0][0].path, ['providers', 'cli', 'models'])
  assert.deepEqual(seen[0][0].value.map((model) => model.id), ['glm-5.3', 'glm-6'])
})

test('POST /model/add：重复 id 与非法档位都是 400', async () => {
  const { base } = await withPlugin()
  const duplicate = await post(`${base}/model/add`, { route: 'cli', model: { id: 'glm-5.3' } })
  assert.equal(duplicate.status, 400)
  assert.match((await duplicate.json()).error.message, /已经有一个叫 glm-5.3/)

  const badEfforts = await post(`${base}/model/add`, { route: 'cli', model: { id: 'new', reasoningEfforts: { low: null } } })
  assert.equal(badEfforts.status, 400)
  assert.match((await badEfforts.json()).error.message, /只有 off 档可以留空/)
})

test('POST /model/remove：删掉最后一个模型 → 连供应商一起删，并报告这件事', async () => {
  const seen = []
  const ctx = fakeCtx({ mutate: async (ns, ops) => { seen.push(ops) } })
  apply(ctx)
  ctx.credentials.refs.set('CLI_API_KEY', 'sk-cli')
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/model/remove`, { route: 'cli', revision: 7, modelId: 'glm-5.3' })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.removesProvider, true)
  assert.deepEqual(seen[0], [{ op: 'unset', path: ['providers', 'cli'] }])
  assert.equal(ctx.credentials.refs.has('CLI_API_KEY'), false, '供应商没了，它的凭据也不该留着')
})

test('POST /discover：代理到宿主的模型发现，不回显密钥', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/discover`, {
    baseURL: 'https://relay.example/v1', api: 'openai-completions', apiKey: 'sk-test',
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.models.map((model) => model.id), ['m-1', 'm-2'])
  assert.equal(ctx.llm.discoveries[0].settingsNs, 'llm-pi-ai')
  assert.deepEqual(ctx.llm.discoveries[0].request, {
    baseURL: 'https://relay.example/v1', api: 'openai-completions', apiKey: 'sk-test',
  })
})

test('POST /provider/edit：逐键 set 身份字段，密钥写在原引用名下', async () => {
  const seen = []
  const ctx = fakeCtx({ mutate: async (ns, ops, revision) => { seen.push({ ns, ops, revision }) } })
  apply(ctx)
  ctx.credentials.refs.set('CLI_API_KEY', 'sk-old')
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/provider/edit`, {
    route: 'cli',
    revision: 7,
    fields: { displayName: 'GLM 中转', baseURL: 'https://gw2.example', api: 'openai-completions' },
    key: 'sk-new',
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.credential, { ok: true, keyRef: 'CLI_API_KEY' })
  assert.deepEqual(seen[0].ops, [
    { op: 'set', path: ['providers', 'cli', 'displayName'], value: 'GLM 中转' },
    { op: 'set', path: ['providers', 'cli', 'baseURL'], value: 'https://gw2.example' },
    { op: 'set', path: ['providers', 'cli', 'api'], value: 'openai-completions' },
  ])
  assert.equal(seen[0].revision, 7, 'revision 围栏必须原样传下去')
  assert.equal(ctx.credentials.refs.get('CLI_API_KEY'), 'sk-new')
})

test('POST /provider/edit：不认识的字段／空串／非法协议／未知路由都是 400，且不写配置', async () => {
  const seen = []
  const { base } = await withPlugin({ mutate: async (ns, ops) => { seen.push(ops) } })

  const extra = await post(`${base}/provider/edit`, { route: 'cli', fields: { displayName: 'x', apiKeyEnv: 'HACK' } })
  assert.equal(extra.status, 400)
  assert.match((await extra.json()).error.message, /改不了 apiKeyEnv/)

  assert.equal((await post(`${base}/provider/edit`, { route: 'cli', fields: { baseURL: '' } })).status, 400)
  assert.equal((await post(`${base}/provider/edit`, { route: 'cli', fields: { api: 'openai-chat' } })).status, 400)
  const missing = await post(`${base}/provider/edit`, { route: 'nope', fields: { displayName: 'x' } })
  assert.equal(missing.status, 400)
  assert.match((await missing.json()).error.message, /没有这条供应商/)
  assert.equal(seen.length, 0)
})

test('POST /provider/edit：宿主拒绝（assertServiceable）翻成 invalid，且不让密钥落库', async () => {
  const ctx = fakeCtx({
    mutate: async () => { throw new Error('llm-pi-ai: 新协议与现有模型不兼容') },
  })
  apply(ctx)
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/provider/edit`, {
    route: 'cli', revision: 7, fields: { api: 'google-generative-ai' }, key: 'sk-x',
  })
  assert.equal(response.status, 400)
  const payload = await response.json()
  assert.equal(payload.error.code, 'invalid', '不是冲突，是"这个值不能写"')
  assert.match(payload.error.message, /不兼容/)
  assert.equal(ctx.credentials.refs.size, 0, '配置没写成就别动密钥')
})

test('POST /discover {route}：密钥从凭据服务取，只在宿主侧用，不回传', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  ctx.credentials.refs.set('CLI_API_KEY', 'sk-cli')
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/discover`, { route: 'cli' })
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.equal(text.includes('sk-cli'), false, '明文密钥绝不能出现在响应里')
  const payload = JSON.parse(text)
  assert.deepEqual(payload.models.map((model) => model.id), ['m-1', 'm-2'])
  assert.deepEqual(ctx.llm.discoveries[0].request, {
    baseURL: 'https://gw.example',
    api: 'anthropic-messages',
    apiKey: 'sk-cli',
  })
})

test('POST /discover {route}：没有 baseURL 退回 provider 探测，未知 route 是 400', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  delete ctx.providers.cli.baseURL
  const { server, base } = await serve(ctx)
  servers.push(server)

  const fallback = await post(`${base}/discover`, { route: 'cli' })
  assert.equal(fallback.status, 200)
  assert.deepEqual(ctx.llm.discoveries[0].request, { provider: 'cli' })

  const missing = await post(`${base}/discover`, { route: 'nope' })
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).error.code, 'invalid')
})

test('POST /discover {route, baseURL}：探表单里的新地址，密钥仍来自凭据服务', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  ctx.credentials.refs.set('CLI_API_KEY', 'sk-cli')
  const { server, base } = await serve(ctx)
  servers.push(server)

  // 编辑表单里改了 baseURL/协议但还没保存：探测必须用表单值，否则"验过了"是假的
  const response = await post(`${base}/discover`, {
    route: 'cli',
    baseURL: 'https://draft.example/v2',
    api: 'openai-completions',
  })
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.equal(text.includes('sk-cli'), false, '密钥仍只在宿主侧')
  assert.deepEqual(ctx.llm.discoveries[0].request, {
    baseURL: 'https://draft.example/v2',
    api: 'openai-completions',
    apiKey: 'sk-cli',
  })
})

test('POST /discover {route, apiKey}：显式密钥优先于凭据服务，响应里没有任何密钥字段', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  ctx.credentials.refs.set('CLI_API_KEY', 'sk-saved')
  const { server, base } = await serve(ctx)
  servers.push(server)

  const response = await post(`${base}/discover`, { route: 'cli', apiKey: 'sk-typed' })
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.equal(text.includes('sk-typed'), false, '表单里敲的密钥也不能回显')
  assert.equal(text.includes('sk-saved'), false)
  const payload = JSON.parse(text)
  assert.deepEqual(Object.keys(payload).sort(), ['models', 'ok'], '响应只有 ok 与 models')
  assert.deepEqual(ctx.llm.discoveries[0].request, {
    baseURL: 'https://gw.example',
    api: 'anthropic-messages',
    apiKey: 'sk-typed',
  })
})

test('POST /model：改名后迁移插件默认，响应带 defaultsMigrated', async () => {
  const { base } = await withPlugin()
  const saved = await post(`${base}/defaults`, { provider: 'cli', model: 'glm-5.3', reasoningEffort: 'high' })
  assert.equal(saved.status, 200)

  const response = await post(`${base}/model`, {
    route: 'cli',
    revision: 7,
    modelId: 'glm-5.3',
    model: { id: 'glm-5.4', name: 'GLM-5.4' },
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.defaultsMigrated, true)

  const state = await (await fetch(`${base}/state`)).json()
  assert.equal(state.state.defaults.provider, 'cli')
  assert.equal(state.state.defaults.model, 'glm-5.4', '插件默认跟着新 id 走')
  assert.equal(state.state.defaults.reasoningEffort, 'high', '档位原样保留')
})

test('POST /model：不改名时 defaultsMigrated 是 false，插件默认不动', async () => {
  const { base } = await withPlugin()
  const response = await post(`${base}/model`, { route: 'cli', revision: 7, model: { id: 'glm-5.3', name: 'GLM' } })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.defaultsMigrated, false)
})

test('POST /provider/undo：当前值与 after 不一致时 stale（不写），force 才撤销', async () => {
  // 每个用例用自己的快照目录：上一个用例的残留不该影响撤销点
  process.env.DSH_MODEL_TUNING_BACKUPS = mkdtempSync(join(tmpdir(), 'model-tuning-undo-'))
  const { ctx, base } = await withPlugin()

  // 先编辑一次 → 落一份带 after 的快照
  const edited = await post(`${base}/model`, { route: 'cli', revision: 7, model: { id: 'glm-5.3', name: 'GLM-5.3' } })
  assert.equal(edited.status, 200)
  // 模拟原生页/手改在快照之后又改了一次同一条供应商
  ctx.providers.cli.displayName = '手工改的名字'

  const stale = await post(`${base}/provider/undo`, { revision: 7 })
  assert.equal(stale.status, 400)
  const payload = await stale.json()
  assert.equal(payload.error.code, 'stale')
  assert.equal(payload.code, 'stale', '顶层也带一份：两种读法都能用')
  assert.deepEqual(payload.routes, ['cli'])
  assert.match(payload.error.message, /又被改过/)

  const forced = await post(`${base}/provider/undo`, { revision: 7, force: true })
  assert.equal(forced.status, 200)
  const done = await forced.json()
  assert.equal(done.ok, true)
  assert.equal(done.label, 'edit-model')
  assert.deepEqual(done.routes, ['cli'])
})

test('POST /provider/undo：没有快照时 400 并说明原因', async () => {
  process.env.DSH_MODEL_TUNING_BACKUPS = mkdtempSync(join(tmpdir(), 'model-tuning-empty-'))
  const { base } = await withPlugin()
  const response = await post(`${base}/provider/undo`, {})
  assert.equal(response.status, 400)
  assert.match((await response.json()).error.message, /还没有可撤销/)
})

