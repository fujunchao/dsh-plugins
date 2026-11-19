/**
 * 供应商（provider）生命周期：新建一条 route、往里加模型、删模型、删 route。
 *
 * 为什么不塞进 `tune.js`：`tune.js` 的职责是「改一个已存在模型/提供商的字段」，
 * 越界就是 400；这里是「造/删整条 route」，语义是原子的结构变更——要么整条建成，
 * 要么什么都没发生。两者失败的形状不同，混在一起会让边界越来越难说清。
 * 依据见 docs/adr/0007（生命周期与密钥）与 docs/adr/0008（档位写到哪一层）。
 *
 * 本模块是纯函数：不碰 fs、不碰 ctx，输入输出都是普通对象，便于单测。
 */

/** `llm-pi-ai` 的 `api` 枚举（schema 只认这四个，没有第五个）。 */
export const PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]

/** 供应商头（身份字段）里本插件允许改的三个；route id 与 `apiKeyEnv` 引用名一律只读。 */
export const PROVIDER_FIELDS = ['displayName', 'baseURL', 'api']

/** route id：与上游 Models 页同一套规则（小写字母开头的 kebab-case）。 */
export const ROUTE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/** 档位全集，顺序即升级顺序（schema 的 `THINKING_LEVELS`）。 */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 模型输入模态。 */
export const MODALITIES = ['text', 'image']

/**
 * 家族模板：新建供应商的默认主路径。
 *
 * 只预填 `api`、`baseURL` 与档位映射——**不预填 `compat`**：`compat` 的键按协议
 * 有白名单，猜错会被 `llm-pi-ai` 在写入期拒绝（`catalog.ts:906-909`），而模板的
 * 价值是「少打字」，不是「替用户赌一个开关」。compat 留给高级字段编辑器。
 *
 * `efforts` 里的 `null` 表示「该档位支持、但不发送参数」（只有 `off` 允许为 null，
 * 这里给出的映射一律是非 off 档，所以值都是字符串）。
 */
export const TEMPLATES = [
  {
    id: 'relay',
    label: { zh: '中转站 / OpenAI 兼容（推荐）', en: 'Relay / OpenAI-compatible (recommended)' },
    api: 'openai-completions',
    baseURL: '',
    efforts: { low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'openai',
    label: { zh: 'OpenAI 官方', en: 'OpenAI' },
    api: 'openai-completions',
    baseURL: 'https://api.openai.com/v1',
    efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'anthropic',
    label: { zh: 'Anthropic 官方', en: 'Anthropic' },
    api: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com',
    efforts: { low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'gemini',
    label: { zh: 'Google Gemini 官方', en: 'Google Gemini' },
    api: 'google-generative-ai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    // Gemini 只认 minimal/low/medium/high 四个拼写，别的会被端点拒绝；
    // xhigh 还要宿主补丁在位（ADR 0001），所以模板里不出现。
    efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'deepseek',
    label: { zh: 'DeepSeek 官方', en: 'DeepSeek' },
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com',
    // DeepSeek 只认 low/high/max 三档（目录里 minimal 与 medium 是 null = 不支持，
    // 而 `reasoningEfforts` 里只有 off 可以写成 null，所以这里不能照抄那张表）。
    efforts: { low: 'low', high: 'high', max: 'max' },
  },
  {
    id: 'blank',
    label: { zh: '空白（全部自己填）', en: 'Blank (fill everything)' },
    api: 'openai-completions',
    baseURL: '',
    // 不给 efforts：空对象 `{}` 在 schema 里是非法值（既不是继承也不是禁用），
    // `undefined` 才是"这个模型不声明推理"。
  },
]

/** 按 id 取模板；未知 id 返回 `undefined`。 */
export function templateOf(id) {
  return TEMPLATES.find((template) => template.id === id)
}

/**
 * 派生凭据引用名。与上游 `deriveKeyRef` 同构：route 全大写、非字母数字折成 `_`，
 * 末尾加 `_API_KEY`。配置里只保存这个名字，值在凭据服务里。
 */
export function deriveKeyRef(route) {
  const normalized = String(route ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized.length === 0 ? '' : `${normalized}_API_KEY`
}

/** 是不是 http(s) 地址；空串不算（新建供应商必须给端点）。 */
export function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 正整数（模型的容量字段）。 */
function isPositiveInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

/**
 * 校验一组档位声明。
 *
 * 规则来自 `llm-pi-ai` 的 `catalog.ts:737-773`：
 * - `false` = 显式声明「这个模型不推理」，合法；
 * - 省略 = 继承（目录里有就继承，手写模型则不推理），合法；
 * - 对象 = 键限七档、值是线上拼写；`off` 允许 `null`，其余必须非空字符串；
 * - 至少要有一个非 `off` 的档位，只写 `off` 不算推理模型；
 * - `{}` 既不是继承也不是禁用，非法。
 *
 * @returns `{ ok, efforts, issue }`；`issue` 是给人看的一句话。
 */
export function normalizeEfforts(raw) {
  if (raw === undefined || raw === null) return { ok: true, efforts: undefined, issue: null }
  if (raw === false) return { ok: true, efforts: false, issue: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, efforts: null, issue: '思考等级必须是一个对象，或 false（声明不推理）' }
  }
  const entries = Object.entries(raw)
  if (entries.length === 0) {
    return { ok: false, efforts: null, issue: '思考等级不能是空对象：要么删掉它，要么至少写一档' }
  }
  const efforts = {}
  let reasoningLevels = 0
  for (const [level, wire] of entries) {
    if (!LEVELS.includes(level)) {
      return { ok: false, efforts: null, issue: `未知档位 ${level}（只能是 ${LEVELS.join(' / ')}）` }
    }
    if (wire === null) {
      if (level !== 'off') {
        return { ok: false, efforts: null, issue: `只有 off 档可以留空，${level} 必须给一个要发送的值` }
      }
      efforts[level] = null
      continue
    }
    if (typeof wire !== 'string' || wire.trim().length === 0) {
      return { ok: false, efforts: null, issue: `${level} 档必须是字符串，或者 off 档留空` }
    }
    efforts[level] = wire.trim()
    if (level !== 'off') reasoningLevels += 1
  }
  if (reasoningLevels === 0) {
    return { ok: false, efforts: null, issue: '至少要有一个非 off 的档位，否则它就不是推理模型（想要不推理请用 false）' }
  }
  return { ok: true, efforts, issue: null }
}

/**
 * 校验一条模型草稿并归一化。
 * @param draft 界面上的模型草稿
 * @param options.existingIds 同路由下已占用的 id（新建时用）
 * @returns `{ ok, model, issues: [{ field, message }] }`
 */
export function normalizeModel(draft, options = {}) {
  const issues = []
  const source = draft !== null && typeof draft === 'object' ? draft : {}
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (id.length === 0) issues.push({ field: 'id', message: '模型必须有 id（端点认的那个名字）' })
  const taken = Array.isArray(options.existingIds) ? options.existingIds : []
  if (id.length > 0 && taken.includes(id)) issues.push({ field: 'id', message: `已经有一个叫 ${id} 的模型了` })

  const model = {}
  if (id.length > 0) model.id = id
  if (typeof source.name === 'string' && source.name.trim().length > 0) model.name = source.name.trim()

  for (const field of ['contextWindow', 'maxTokens']) {
    const value = source[field]
    if (value === undefined || value === null || value === '') continue
    const number = typeof value === 'number' ? value : Number(value)
    if (!isPositiveInt(number)) issues.push({ field, message: `${field} 必须是正整数` })
    else model[field] = number
  }

  if (Array.isArray(source.input) && source.input.length > 0) {
    const input = source.input.filter((entry) => MODALITIES.includes(entry))
    if (input.length !== source.input.length) issues.push({ field: 'input', message: '输入模态只能是 text / image' })
    else model.input = input
  }

  const efforts = normalizeEfforts(source.reasoningEfforts)
  if (!efforts.ok) issues.push({ field: 'reasoningEfforts', message: efforts.issue })
  else if (efforts.efforts !== undefined) model.reasoningEfforts = efforts.efforts

  return { ok: issues.length === 0, model, issues }
}

/**
 * 校验一条供应商草稿。
 *
 * 硬约束（由 `llm-pi-ai` 在写入期执行，这里提前拦下来，免得用户看到一句
 * 「resolves no models」）：手写路由必须同时给 `api` + `baseURL` + **非空 models**。
 *
 * @param draft `{ route, displayName, api, baseURL, key, models[] }`
 * @param options.takenRoutes 已存在的 route id
 */
export function normalizeProvider(draft, options = {}) {
  const issues = []
  const source = draft !== null && typeof draft === 'object' ? draft : {}
  const route = typeof source.route === 'string' ? source.route.trim() : ''
  if (route.length === 0) issues.push({ field: 'route', message: 'route id 不能为空' })
  else if (!ROUTE_ID_PATTERN.test(route)) {
    issues.push({ field: 'route', message: 'route id 只能是小写字母开头、由小写字母/数字/连字符组成' })
  } else if (Array.isArray(options.takenRoutes) && options.takenRoutes.includes(route)) {
    issues.push({ field: 'route', message: `已经有一条叫 ${route} 的供应商了，换一个 id` })
  }

  const api = typeof source.api === 'string' ? source.api.trim() : ''
  if (!PROTOCOLS.includes(api)) {
    issues.push({ field: 'api', message: `协议只能是 ${PROTOCOLS.join(' / ')}` })
  }

  const baseURL = typeof source.baseURL === 'string' ? source.baseURL.trim() : ''
  if (!isHttpUrl(baseURL)) issues.push({ field: 'baseURL', message: 'baseURL 必须是一个 http(s) 地址' })

  const models = []
  const seen = []
  const rawModels = Array.isArray(source.models) ? source.models : []
  for (const raw of rawModels) {
    const normalized = normalizeModel(raw, { existingIds: seen })
    if (!normalized.ok) {
      // 把行号带进消息：一个供应商可能有八行，光说"id 重复"用户找不到是哪行。
      const index = rawModels.indexOf(raw) + 1
      for (const issue of normalized.issues) {
        issues.push({ field: `models[${index - 1}].${issue.field}`, message: `第 ${index} 行：${issue.message}` })
      }
      continue
    }
    seen.push(normalized.model.id)
    models.push(normalized.model)
  }
  if (models.length === 0) issues.push({ field: 'models', message: '至少要有一个模型：手写路由没有目录可继承' })

  const key = typeof source.key === 'string' ? source.key.trim() : ''
  const profile = {}
  if (typeof source.displayName === 'string' && source.displayName.trim().length > 0) {
    profile.displayName = source.displayName.trim()
  }
  if (key.length > 0) profile.apiKeyEnv = deriveKeyRef(route)
  profile.api = api
  profile.baseURL = baseURL
  profile.models = models

  return { ok: issues.length === 0, route, profile, key, issues }
}

/**
 * 校验「改一条已存在供应商的身份字段」的输入。
 *
 * 三条规则都是为了不让用户看到一句宿主的 `assertServiceable` 报错：
 * - 只认 `PROVIDER_FIELDS`，出现别的键**报错而不是静默丢弃**（静默丢弃会让界面以为存上了）；
 * - 空串直接拒：上游对空 `displayName`／`baseURL` 会抛错，等它半途炸不如提前说；
 * - `api` 必须是 schema 里那四个之一，否则写进去也发不出去。
 *
 * 「不改」用**不给这个键**表示，不用空串表示——空串在 schema 里是非法值，不是"继承"。
 *
 * @returns `{ ok, fields, issues: [{ field, message }] }`
 */
export function normalizeProviderEdit(raw) {
  const issues = []
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const fields = {}
  for (const [key, value] of Object.entries(source)) {
    if (!PROVIDER_FIELDS.includes(key)) {
      issues.push({ field: key, message: `只能改 ${PROVIDER_FIELDS.join(' / ')}，改不了 ${key}` })
      continue
    }
    if (key === 'api') {
      const api = typeof value === 'string' ? value.trim() : ''
      if (!PROTOCOLS.includes(api)) issues.push({ field: 'api', message: `协议只能是 ${PROTOCOLS.join(' / ')}` })
      else fields.api = api
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length === 0) {
      issues.push({ field: key, message: `${key} 不能是空串；不想改就别带这个字段` })
      continue
    }
    fields[key] = text
  }
  if (issues.length === 0 && Object.keys(fields).length === 0) {
    issues.push({ field: 'fields', message: '没有要写入的供应商字段' })
  }
  return { ok: issues.length === 0, fields, issues }
}

/** 改供应商身份字段的 ops：一个字段一条 `set`，顺序固定成 `PROVIDER_FIELDS` 的次序。 */
export function buildProviderFieldOps(route, fields) {
  const source = fields !== null && typeof fields === 'object' ? fields : {}
  return PROVIDER_FIELDS
    .filter((key) => source[key] !== undefined)
    .map((key) => ({ op: 'set', path: ['providers', route, key], value: source[key] }))
}

/** 新建一条供应商：整条 profile 一次 `set`（空壳会被 `assertServiceable` 拒，所以必须原子）。 */
export function buildProviderOps(route, profile) {
  return [{ op: 'set', path: ['providers', route], value: profile }]
}

/** 删除一条供应商。对 `base` 层也存在的目录路由，这只是「回到继承值」。 */
export function buildProviderUnsetOps(route) {
  return [{ op: 'unset', path: ['providers', route] }]
}

/**
 * 加一个模型行：整段替换 `models`（settings 的 op 只有 set/unset，
 * 没有"插入数组元素"这种语法；整段替换也是上游官方页的做法）。
 */
export function buildModelInsertOps(route, models, model) {
  const list = Array.isArray(models) ? models : []
  if (list.some((entry) => entry !== null && typeof entry === 'object' && entry.id === model.id)) {
    throw new Error(`模型 ${model.id} 已经在 ${route} 里了`)
  }
  return [{ op: 'set', path: ['providers', route, 'models'], value: [...list, model] }]
}

/**
 * 删一个模型行。
 *
 * 删到空时**不能**只写空数组：手写路由没有目录可继承，空 `models` 等价于
 * 「去服务目录」→ 没有目录 → 写入被拒。所以最后一行的删除升级为删整条供应商，
 * 由调用方在界面上把它说成「这会把供应商一起删掉」。
 *
 * @returns `{ ops, removesProvider }`
 */
export function buildModelRemoveOps(route, models, modelId) {
  const list = Array.isArray(models) ? models : []
  const next = list.filter((entry) => !(entry !== null && typeof entry === 'object' && entry.id === modelId))
  if (next.length === list.length) throw new Error(`模型 ${modelId} 不在 ${route} 里`)
  if (next.length === 0) return { ops: buildProviderUnsetOps(route), removesProvider: true }
  return { ops: [{ op: 'set', path: ['providers', route, 'models'], value: next }], removesProvider: false }
}

/**
 * 纯目录路由（配置层没有显式 `models`）改单个模型的字段：写 `modelOverrides.<id>`。
 *
 * 为什么不写 `models`：`models` 非空 = 整段替换目录，会把整张目录物化进
 * `cordis.patch.yml`，pi-ai 以后新增的模型被这份旧快照永久盖住（ADR 0008）。
 * `modelOverrides` 与 `models` 在同一 profile 里互斥，所以只能二选一。
 */
export function buildModelOverrideOps(route, overrides, modelId, patch) {
  const current = overrides !== null && typeof overrides === 'object' ? overrides[modelId] : undefined
  const merged = { ...(current !== null && typeof current === 'object' ? current : {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id') continue
    if (value === undefined || value === null) delete merged[key]
    else merged[key] = value
  }
  if (Object.keys(merged).length === 0) {
    return [{ op: 'unset', path: ['providers', route, 'modelOverrides', modelId] }]
  }
  return [{ op: 'set', path: ['providers', route, 'modelOverrides', modelId], value: merged }]
}

/**
 * 目录路由（配置层没有显式 `models`）改模型 id：把 `modelOverrides.<旧 id>` 搬到 `<新 id>`。
 *
 * 同一批 ops 里「先 set 新键、再 unset 旧键」：settings 的 op 没有"改键"这种语法，
 * 拆成两次写入会让中间态出现两条同名模型，而且第二次失败就留下半成品；
 * 一批 ops = 一个 revision，要么都成、要么都不成。
 *
 * 值里**不能带 `id`**：`modelOverrides` 的键本身就是 id，值里再写一遍会被 schema 拒。
 */
export function buildModelRenameOps(route, overrides, fromId, toId, patch = {}) {
  const current = overrides !== null && typeof overrides === 'object' ? overrides[fromId] : undefined
  const merged = { ...(current !== null && typeof current === 'object' ? current : {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id') continue
    if (value === undefined || value === null) delete merged[key]
    else merged[key] = value
  }
  return [
    { op: 'set', path: ['providers', route, 'modelOverrides', toId], value: merged },
    { op: 'unset', path: ['providers', route, 'modelOverrides', fromId] },
  ]
}

/**
 * 用两份 `providers` 子树算出把前者变成后者的 ops。
 *
 * 撤销快照时用它，而不是整棵 `set ['providers']`：逐条 route 的 set/unset 更容易
 * 单测、也不会因为「整棵设值」的边界语义没人验证过而踩空。
 */
export function diffProviderOps(before, after) {
  const left = before !== null && typeof before === 'object' ? before : {}
  const right = after !== null && typeof after === 'object' ? after : {}
  const ops = []
  for (const [route, profile] of Object.entries(right)) {
    if (JSON.stringify(left[route]) === JSON.stringify(profile)) continue
    ops.push({ op: 'set', path: ['providers', route], value: profile })
  }
  for (const route of Object.keys(left)) {
    if (Object.hasOwn(right, route)) continue
    ops.push({ op: 'unset', path: ['providers', route] })
  }
  return ops
}

/**
 * 这条路由的模型是不是"配置层显式写的"。
 *
 * 决定档位写到 `models` 还是 `modelOverrides`（ADR 0008）。注意**不能**用
 * `declared` 判断：本机的 `deepseek`/`google` 是目录路由，但它们自己手写了
 * `models`，那才是权威。
 */
export function modelsAreExplicit(profile) {
  return profile !== null && typeof profile === 'object' && Array.isArray(profile.models) && profile.models.length > 0
}
