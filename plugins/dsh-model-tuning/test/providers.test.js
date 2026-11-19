/**
 * `lib/providers.js` 的单测：全是纯函数，不需要假宿主。
 *
 * 重点不是"能跑"，而是把 `llm-pi-ai` 会**拒写**的几种形状提前钉死——
 * 这些错误如果漏到运行时，用户看到的是「settings.mutate 拒绝了」，很难归因。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PROTOCOLS,
  PROVIDER_FIELDS,
  ROUTE_ID_PATTERN,
  TEMPLATES,
  buildModelInsertOps,
  buildModelOverrideOps,
  buildModelRemoveOps,
  buildModelRenameOps,
  buildProviderFieldOps,
  buildProviderOps,
  buildProviderUnsetOps,
  deriveKeyRef,
  diffProviderOps,
  isHttpUrl,
  modelsAreExplicit,
  normalizeEfforts,
  normalizeModel,
  normalizeProvider,
  normalizeProviderEdit,
  templateOf,
} from '../lib/providers.js'

test('deriveKeyRef：与上游同构的引用名', () => {
  assert.equal(deriveKeyRef('cli'), 'CLI_API_KEY')
  assert.equal(deriveKeyRef('my-relay'), 'MY_RELAY_API_KEY')
  assert.equal(deriveKeyRef('relay_2'), 'RELAY_2_API_KEY')
  assert.equal(deriveKeyRef(''), '')
  assert.equal(deriveKeyRef(undefined), '')
})

test('isHttpUrl：只认 http(s)，空串不算', () => {
  assert.equal(isHttpUrl('https://gw.example/v1'), true)
  assert.equal(isHttpUrl('http://127.0.0.1:8080'), true)
  assert.equal(isHttpUrl('gw.example'), false)
  assert.equal(isHttpUrl('ftp://gw.example'), false)
  assert.equal(isHttpUrl(''), false)
})

test('ROUTE_ID_PATTERN：小写 kebab-case，与上游 Models 页同规则', () => {
  for (const ok of ['cli', 'my-relay', 'relay2', 'a-b-c']) assert.match(ok, ROUTE_ID_PATTERN)
  for (const bad of ['Cli', 'my_relay', '-cli', 'cli-', '2relay', '']) assert.doesNotMatch(bad, ROUTE_ID_PATTERN)
})

test('normalizeEfforts：省略与 false 都合法', () => {
  assert.deepEqual(normalizeEfforts(undefined), { ok: true, efforts: undefined, issue: null })
  assert.deepEqual(normalizeEfforts(null), { ok: true, efforts: undefined, issue: null })
  assert.deepEqual(normalizeEfforts(false), { ok: true, efforts: false, issue: null })
})

test('normalizeEfforts：off 可留空，其余档必须给字符串', () => {
  const ok = normalizeEfforts({ off: null, low: 'low', high: 'high' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.efforts, { off: null, low: 'low', high: 'high' })

  assert.equal(normalizeEfforts({ low: null, high: 'high' }).ok, false, '只有 off 能留空')
  assert.equal(normalizeEfforts({ high: '   ' }).ok, false, '空串不是合法拼写')
  assert.equal(normalizeEfforts({ bogus: 'x' }).ok, false, '未知档位')
})

test('normalizeEfforts：只写 off 不算推理模型，空对象也不合法', () => {
  const onlyOff = normalizeEfforts({ off: null })
  assert.equal(onlyOff.ok, false)
  assert.match(onlyOff.issue, /非 off/)
  assert.equal(normalizeEfforts({}).ok, false)
})

test('normalizeModel：容量与模态按 schema 收窄', () => {
  const ok = normalizeModel({ id: 'glm-5.3', name: 'GLM 5.3', contextWindow: '128000', maxTokens: 8192, input: ['text', 'image'] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.model, { id: 'glm-5.3', name: 'GLM 5.3', contextWindow: 128000, maxTokens: 8192, input: ['text', 'image'] })

  assert.equal(normalizeModel({ id: '' }).ok, false, 'id 必填')
  assert.equal(normalizeModel({ id: 'x', contextWindow: 0 }).ok, false, '容量必须 ≥1')
  assert.equal(normalizeModel({ id: 'x', input: ['text', 'audio'] }).ok, false, '未知模态')
  assert.equal(normalizeModel({ id: 'x' }, { existingIds: ['x'] }).ok, false, '同路由内 id 不能重复')
})

test('normalizeProvider：一条最小合法供应商', () => {
  const result = normalizeProvider({
    route: 'relay-x',
    displayName: '中转站',
    api: 'openai-completions',
    baseURL: 'https://relay.example/v1',
    key: 'sk-test',
    models: [{ id: 'gpt-x', contextWindow: 200000, reasoningEfforts: { low: 'low', high: 'high' } }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.profile.apiKeyEnv, 'RELAY_X_API_KEY')
  assert.equal(result.profile.api, 'openai-completions')
  assert.equal(result.profile.baseURL, 'https://relay.example/v1')
  assert.equal(result.profile.models.length, 1)
  assert.equal(result.key, 'sk-test')
})

test('normalizeProvider：不填密钥就不写 apiKeyEnv（走供应商自带凭据发现）', () => {
  const result = normalizeProvider({
    route: 'local',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: [{ id: 'qwen' }],
  })
  assert.equal(result.ok, true)
  assert.equal('apiKeyEnv' in result.profile, false)
})

test('normalizeProvider：撞已有 route 一律报错，不自动改 id', () => {
  const result = normalizeProvider({ route: 'cli', api: 'openai-completions', baseURL: 'https://x.example', models: [{ id: 'm' }] }, { takenRoutes: ['cli'] })
  assert.equal(result.ok, false)
  assert.match(result.issues.map((issue) => issue.message).join(), /已经有一条叫 cli/)
})

test('normalizeProvider：没有模型是不可能合法的（schema 会拒）', () => {
  const result = normalizeProvider({ route: 'empty', api: 'openai-completions', baseURL: 'https://x.example', models: [] })
  assert.equal(result.ok, false)
  assert.match(result.issues.map((issue) => issue.message).join(), /至少要有一个模型/)
})

test('normalizeProvider：坏行会带行号，用户找得到是哪一行', () => {
  const result = normalizeProvider({
    route: 'two',
    api: 'openai-completions',
    baseURL: 'https://x.example',
    models: [{ id: 'ok-1' }, { id: 'ok-1' }],
  })
  assert.equal(result.ok, false)
  assert.match(result.issues.map((issue) => issue.message).join('；'), /第 2 行/)
})

test('normalizeProviderEdit：只认 displayName／baseURL／api，别的键不静默丢弃', () => {
  const ok = normalizeProviderEdit({ displayName: ' GLM 中转 ', baseURL: 'https://gw2.example', api: 'anthropic-messages' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.fields, { displayName: 'GLM 中转', baseURL: 'https://gw2.example', api: 'anthropic-messages' })
  assert.deepEqual(PROVIDER_FIELDS, ['displayName', 'baseURL', 'api'], 'route id 与 apiKeyEnv 引用名不在可改之列')

  const extra = normalizeProviderEdit({ displayName: 'x', route: 'other', apiKeyEnv: 'EVIL_KEY' })
  assert.equal(extra.ok, false)
  const messages = extra.issues.map((issue) => issue.message).join('；')
  assert.match(messages, /改不了 route/)
  assert.match(messages, /改不了 apiKeyEnv/)
})

test('normalizeProviderEdit：空串与非法协议都是错，不是"恢复默认"', () => {
  assert.equal(normalizeProviderEdit({ displayName: '' }).ok, false)
  assert.equal(normalizeProviderEdit({ baseURL: '   ' }).ok, false)
  const badApi = normalizeProviderEdit({ api: 'openai-chat' })
  assert.equal(badApi.ok, false)
  assert.match(badApi.issues[0].message, /协议只能是/)
  assert.equal(normalizeProviderEdit({}).ok, false, '什么都没给等于没有要写的字段')
  assert.equal(normalizeProviderEdit(null).ok, false)
})

test('buildProviderOps / buildProviderUnsetOps：整条 set，整条 unset', () => {
  assert.deepEqual(buildProviderOps('relay', { api: 'openai-completions' }), [
    { op: 'set', path: ['providers', 'relay'], value: { api: 'openai-completions' } },
  ])
  assert.deepEqual(buildProviderUnsetOps('relay'), [{ op: 'unset', path: ['providers', 'relay'] }])
})

test('buildProviderFieldOps：一个字段一条 set，顺序固定成 displayName→baseURL→api', () => {
  const ops = buildProviderFieldOps('cli', { api: 'openai-responses', displayName: 'GLM 中转' })
  assert.deepEqual(ops, [
    { op: 'set', path: ['providers', 'cli', 'displayName'], value: 'GLM 中转' },
    { op: 'set', path: ['providers', 'cli', 'api'], value: 'openai-responses' },
  ])
  assert.deepEqual(buildProviderFieldOps('cli', {}), [])
})

test('buildModelInsertOps：整段替换 models，重复 id 抛错', () => {
  const ops = buildModelInsertOps('cli', [{ id: 'a' }], { id: 'b' })
  assert.deepEqual(ops[0].path, ['providers', 'cli', 'models'])
  assert.deepEqual(ops[0].value.map((model) => model.id), ['a', 'b'])
  assert.throws(() => buildModelInsertOps('cli', [{ id: 'a' }], { id: 'a' }), /已经在 cli 里/)
})

test('buildModelRemoveOps：删最后一个模型升级为删整条供应商', () => {
  const kept = buildModelRemoveOps('cli', [{ id: 'a' }, { id: 'b' }], 'a')
  assert.equal(kept.removesProvider, false)
  assert.deepEqual(kept.ops[0].value.map((model) => model.id), ['b'])

  const last = buildModelRemoveOps('cli', [{ id: 'a' }], 'a')
  assert.equal(last.removesProvider, true)
  assert.deepEqual(last.ops, [{ op: 'unset', path: ['providers', 'cli'] }])

  assert.throws(() => buildModelRemoveOps('cli', [{ id: 'a' }], 'nope'), /不在 cli 里/)
})

test('buildModelOverrideOps：合并到 modelOverrides，空则 unset', () => {
  const ops = buildModelOverrideOps('deepseek', { 'm-1': { name: '旧名字' } }, 'm-1', { reasoningEfforts: { high: 'high' } })
  assert.deepEqual(ops[0].path, ['providers', 'deepseek', 'modelOverrides', 'm-1'])
  assert.deepEqual(ops[0].value, { name: '旧名字', reasoningEfforts: { high: 'high' } })

  const cleared = buildModelOverrideOps('deepseek', { 'm-1': { name: '旧名字' } }, 'm-1', { name: null })
  assert.deepEqual(cleared, [{ op: 'unset', path: ['providers', 'deepseek', 'modelOverrides', 'm-1'] }])
})

test('buildModelRenameOps：set 新键 + unset 旧键，值里不带 id', () => {
  const ops = buildModelRenameOps('deepseek', { 'm-1': { name: '旧', contextWindow: 1000 } }, 'm-1', 'm-1x', { id: 'm-1x', name: '新' })
  assert.deepEqual(ops, [
    { op: 'set', path: ['providers', 'deepseek', 'modelOverrides', 'm-1x'], value: { name: '新', contextWindow: 1000 } },
    { op: 'unset', path: ['providers', 'deepseek', 'modelOverrides', 'm-1'] },
  ])
  assert.equal('id' in ops[0].value, false, 'modelOverrides 的键就是 id，值里再写会被 schema 拒')

  // 旧键从来没有 override 时也照写：改名本身不产生字段，只是把"键"跟着搬
  const fresh = buildModelRenameOps('deepseek', undefined, 'm-2', 'm-2x', { id: 'm-2x' })
  assert.deepEqual(fresh[0].value, {})
  assert.deepEqual(fresh[1], { op: 'unset', path: ['providers', 'deepseek', 'modelOverrides', 'm-2'] })
})

test('diffProviderOps：增／改／删各出一条 op，未变的不写', () => {
  const before = { a: { api: 'openai-completions' }, b: { api: 'anthropic-messages' } }
  const after = { a: { api: 'openai-completions' }, c: { api: 'openai-responses' } }
  const ops = diffProviderOps(before, after)
  assert.deepEqual(ops, [
    { op: 'set', path: ['providers', 'c'], value: { api: 'openai-responses' } },
    { op: 'unset', path: ['providers', 'b'] },
  ])
  assert.deepEqual(diffProviderOps(before, before), [])
})

test('modelsAreExplicit：只有非空 models 才算显式接管', () => {
  assert.equal(modelsAreExplicit({ models: [{ id: 'a' }] }), true)
  assert.equal(modelsAreExplicit({ models: [] }), false, '空数组等于"服务目录"')
  assert.equal(modelsAreExplicit({}), false)
  assert.equal(modelsAreExplicit(null), false)
})

test('模板：每个协议都合法，档位映射都能通过 schema 校验', () => {
  assert.deepEqual(PROTOCOLS, ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
  for (const template of TEMPLATES) {
    assert.ok(PROTOCOLS.includes(template.api), `${template.id} 的协议不在枚举里`)
    assert.equal(isHttpUrl(template.baseURL) || template.baseURL === '', true, `${template.id} 的 baseURL 不合法`)
    const efforts = normalizeEfforts(template.efforts)
    assert.equal(efforts.ok, true, `${template.id} 的档位模板非法：${efforts.issue}`)
    assert.ok(template.label.zh.length > 0 && template.label.en.length > 0)
  }
  assert.equal(templateOf('relay').api, 'openai-completions')
  assert.equal(templateOf('nope'), undefined)
  assert.equal(TEMPLATES[0].id, 'relay', '中转站是默认项')
})

test('模板：DeepSeek 只给 low/high/max（它的 medium 在目录里是 null）', () => {
  assert.deepEqual(templateOf('deepseek').efforts, { low: 'low', high: 'high', max: 'max' })
})

test('模板：Gemini 不出现 xhigh（那要宿主补丁在位，ADR 0001）', () => {
  assert.equal('xhigh' in templateOf('gemini').efforts, false)
})
