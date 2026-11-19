/**
 * 读写 `llm-pi-ai` 的设置：只走 `ctx.settings.mutate`（路径 op + revision 围栏）。
 *
 * 为什么不用 `ctx.configEditor.edit`：那是整段替换 `config`，任何并发改动都会
 * 被静默吞掉，而且 `unset` 回退继承值的语义要自己复刻。`llm-pi-ai` 的
 * `providers` 整棵是 volatile，因此路径写入是热生效的（不重载插件）。
 * 详见 docs/adr/0003-write-llm-pi-ai-through-settings-mutate.md。
 */
import {
  PROTOCOLS,
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
  modelsAreExplicit,
  normalizeModel,
  normalizeProvider,
  normalizeProviderEdit,
} from './providers.js'

/** 设置命名空间：手写 pi-ai 路由都写在这里。 */
export const NS = 'llm-pi-ai'

/** `llm-pi-ai` schema 允许的档位键，按升级顺序。 */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Gemini 协议在宿主补丁在位时能真正发送的档位（其余会被 pi-ai 拒绝）。 */
export const GEMINI_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh']

/** Gemini 协议的标识符。 */
export const GEMINI_API = 'google-generative-ai'

/** 模型级 `compat` 里本插件暴露的键（其余仍可留在配置里，只是没有控件）。 */
export const COMPAT_KEYS = [
  'supportsReasoningEffort',
  'thinkingFormat',
  'maxTokensField',
  'supportsDeveloperRole',
  'supportsStore',
]

/** 提供商级、本插件暴露的字段。 */
export const ROUTE_FIELDS = [
  'defaultContextWindow',
  'defaultMaxTokens',
  'defaultInput',
  'thinkingBudgets',
  'reasoning',
]

/** 只挑出会出现在界面上的模型字段。 */
function modelView(model) {
  const out = { id: typeof model.id === 'string' ? model.id : '' }
  for (const key of ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat']) {
    if (model[key] !== undefined) out[key] = model[key]
  }
  return out
}

/** 只挑出会出现在界面上的提供商字段。 */
function routeView(route, profile, declared, meta) {
  const fields = {}
  for (const key of ROUTE_FIELDS) {
    if (profile[key] !== undefined) fields[key] = profile[key]
  }
  // 空字符串等于「这一层没写协议」：目录路由的协议由适配器目录决定，
  // 配置里只留可选的覆盖值。界面据 `api === null` 判断"不能按协议收窄"。
  const api = typeof profile.api === 'string' && profile.api.length > 0 ? profile.api : null
  const info = meta !== null && typeof meta === 'object' ? meta : {}
  return {
    id: route,
    displayName: typeof profile.displayName === 'string' ? profile.displayName : route,
    api,
    declared: declared === true,
    baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : null,
    // 「可删可改」的判定与上游 Models 页同源：用户配置层写了这条、继承层没有。
    // 用它而不是自己记一份「谁建的」，两个入口才不会各说各话（ADR 0007）。
    userOwned: info.userOwned === true,
    // 配置层有显式 models → 档位写 models；否则写 modelOverrides（ADR 0008）。
    modelsExplicit: info.modelsExplicit === true,
    keyRef: typeof info.keyRef === 'string' ? info.keyRef : null,
    models: Array.isArray(profile.models) ? profile.models.map(modelView) : [],
    fields,
  }
}

/**
 * 把设置里的 `providers` 拍平成界面要的形状。
 * @param providers 设置里 `providers` 的生效值（继承层 + 用户层合并后）
 */
export function providersView(providers, declaredRoutes = new Set(), meta = {}) {
  if (providers === null || typeof providers !== 'object') return []
  return Object.entries(providers)
    .filter(([, profile]) => profile !== null && typeof profile === 'object')
    .map(([route, profile]) => routeView(route, profile, declaredRoutes.has(route), meta[route]))
}

/**
 * 生成「整段替换某个提供商的 models 数组」的写入操作。
 *
 * 为什么整段替换而不是按下标改：用户层可能没有 models 数组（此时生效值来自
 * 继承层），按下标 `set` 会在用户层造出稀疏数组。整段替换是从生效值出发重建，
 * 语义与官方页对 DeepSeek 家族数组的处理一致；models 里不含机密，不需要担心
 * 把密钥写回。
 *
 * @param route 路由 id
 * @param models 生效的完整模型数组
 * @param modelId 要改的模型 id
 * @param patch 要合并进该模型的字段；`undefined`/`null` 表示删掉该字段
 *   （`reasoningEfforts: false` 是「显式非推理模型」，不是删除）
 */
export function buildModelOps(route, models, modelId, patch) {
  const list = Array.isArray(models) ? models : []
  const index = list.findIndex((model) => model !== null && typeof model === 'object' && model.id === modelId)
  if (index < 0) throw new Error(`模型 ${modelId} 不在 ${route} 的模型列表里`)
  const merged = { ...list[index] }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) delete merged[key]
    else merged[key] = value
  }
  if (typeof merged.id !== 'string' || merged.id.length === 0) throw new Error('模型必须有 id')
  const next = list.map((model, at) => (at === index ? merged : model))
  return [{ op: 'set', path: ['providers', route, 'models'], value: next }]
}

/**
 * 生成提供商级字段的写入操作：`null`/`undefined` 表示取消该字段
 * （`unset` 会回退到继承值，这正是「恢复默认」的意思）。
 */
export function buildRouteOps(route, fields) {
  const ops = []
  for (const [key, value] of Object.entries(fields)) {
    if (!ROUTE_FIELDS.includes(key)) continue
    if (value === null || value === undefined) ops.push({ op: 'unset', path: ['providers', route, key] })
    else ops.push({ op: 'set', path: ['providers', route, key], value })
  }
  return ops
}

/** 从解析结果里读出档位能力；解析不出就给空集合（调用方据此保守处理）。 */
export function reasoningOf(info) {
  const reasoning = info !== null && typeof info === 'object' ? info.reasoning : undefined
  if (reasoning === null || typeof reasoning !== 'object') return { supported: [], defaultEffort: null }
  const raw = Array.isArray(reasoning.efforts) ? reasoning.efforts : []
  const supported = raw
    .map((entry) => (typeof entry === 'string'
      ? entry
      : entry !== null && typeof entry === 'object'
        ? (typeof entry.effort === 'string' ? entry.effort : typeof entry.id === 'string' ? entry.id : null)
        : null))
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
  return {
    supported,
    defaultEffort: typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : null,
  }
}

/**
 * 取「生效的提供商配置」。
 *
 * `settings.describe()` 的视图有三个来源：`base`（继承层）、`user`（用户层）、
 * `value`（宿主算出来的生效值）。不同版本里 `value` 的完整度不一致，所以这里
 * 从 base+user 合并出底稿，再用 value 覆盖同名路由——三条路由都在时结果一致，
 * 只有一条在时也不会把有效的模型列表丢掉。
 *
 * 为什么必须拿到**完整**的模型数组：写模型字段时我们整段替换 `models`
 * （见 buildModelOps），底稿缺项会导致写出去的数组少模型。
 */
export function routeProfiles(view) {
  const collected = configProfiles(view)
  for (const layer of [view?.base, view?.user]) {
    const providers = layer?.providers
    if (providers === null || typeof providers !== 'object') continue
    for (const [route, profile] of Object.entries(providers)) {
      if (profile === null || typeof profile !== 'object') continue
      collected[route] = { ...(collected[route] ?? {}), ...profile }
    }
  }
  const effective = view?.value?.providers
  if (effective !== null && typeof effective === 'object') {
    for (const [route, profile] of Object.entries(effective)) {
      if (profile === null || typeof profile !== 'object') continue
      collected[route] = { ...(collected[route] ?? {}), ...profile }
    }
  }
  return collected
}

/**
 * 只合并**配置层**（继承层 + 用户层），不掺宿主算出来的生效值。
 *
 * 写回时必须用这个：`value` 里带着适配器注入的默认值（例如 `input: []`、
 * `compat.chatTemplateKwargs: {}`），照它回写会把一堆用户没写过的字段
 * 物化进 cordis.patch.yml。
 */
export function configProfiles(view) {
  const collected = {}
  for (const layer of [view?.base, view?.user]) {
    const providers = layer?.providers
    if (providers === null || typeof providers !== 'object') continue
    for (const [route, profile] of Object.entries(providers)) {
      if (profile === null || typeof profile !== 'object') continue
      collected[route] = { ...(collected[route] ?? {}), ...profile }
    }
  }
  return collected
}

/**
 * 稳定序列化：对象键排序后再比。
 *
 * 只用来判「值有没有变」。字段顺序不同不该算改动——原生页手改一次
 * `cordis.patch.yml` 就可能把键的顺序换掉，那不该让撤销被拦下来。
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

/** 两个配置子树是不是"值相同"（忽略键顺序）。 */
function sameConfig(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/**
 * 当前配置与快照 `after` 不一致的路由 id。
 * 撤销是**整条 provider 覆盖**，所以只要有哪条路由被别人又改过就得先问一声。
 */
export function changedRoutes(current, expected) {
  const left = current !== null && typeof current === 'object' ? current : {}
  const right = expected !== null && typeof expected === 'object' ? expected : {}
  const routes = new Set([...Object.keys(left), ...Object.keys(right)])
  const changed = []
  for (const route of routes) {
    if (!sameConfig(left[route], right[route])) changed.push(route)
  }
  return changed.sort()
}

/** 一组 ops 会碰到哪些路由（`path` 的第二段就是 route id）。 */
export function routesOfOps(ops) {
  const routes = new Set()
  for (const op of Array.isArray(ops) ? ops : []) {
    const route = Array.isArray(op?.path) ? op.path[1] : undefined
    if (typeof route === 'string' && route.length > 0) routes.add(route)
  }
  return [...routes].sort()
}

/**
 * 改名之后迁移插件状态里的「插件默认」。
 *
 * 只迁移插件能负责的那一条：`defaults.provider === route && defaults.model === 旧 id`。
 * 会话日志里的历史选择不迁移（原生页改 id 后同样如此，ADR 0009 第 2 条）。
 *
 * 纯函数：状态写回必须走 `routes.js` 里那个带缓存的 store，否则 `/state` 会读到旧值。
 *
 * @returns `{ state, migrated }`；没命中时原样返回同一个 `state` 引用。
 */
export function migrateDefaults(state, route, fromId, toId) {
  const selection = state !== null && typeof state === 'object' ? state.defaults : null
  if (selection === null || typeof selection !== 'object') return { state, migrated: false }
  if (selection.provider !== route || selection.model !== fromId) return { state, migrated: false }
  return { state: { ...state, defaults: { ...selection, model: toId } }, migrated: true }
}

/**
 * 设置读写器。`settings` 服务缺席时所有方法都抛一条可读的错误，
 * 由路由层翻译成界面上的提示。
 */
export function createTuner(ctx, options = {}) {
  const snapshots = options.snapshots ?? null
  const requireSettings = () => {
    const settings = ctx.get?.('settings')
    if (settings === undefined || typeof settings.mutate !== 'function') {
      throw new Error('宿主没有可用的 settings 服务：无法读写 llm-pi-ai 设置')
    }
    return settings
  }

  const describe = () => {
    const settings = requireSettings()
    const views = settings.describe()
    const view = Array.isArray(views) ? views.find((entry) => entry.ns === NS) : undefined
    if (view === undefined) {
      // 只有含 volatile 字段的 entry 才会出现在 describe 里；查不到说明
      // llm-pi-ai 没挂载或这一版改了 schema。
      throw new Error('设置里找不到 llm-pi-ai（该 namespace 未挂载或不含可写字段）')
    }
    return view
  }

  /**
   * 哪些路由是「手写路由」（pi-ai 目录里没有它）。只有适配器自己知道，
   * 所以我们问 llm 服务要它发布的配置目录；问不到就当作都不手写。
   */
  const declaredRoutes = () => {
    const llm = ctx.get?.('llm')
    const routes = new Set()
    if (llm === undefined || typeof llm.listConfigurableProviders !== 'function') return routes
    try {
      for (const entry of llm.listConfigurableProviders() ?? []) {
        if (entry?.declared === true && typeof entry.provider === 'string') routes.add(entry.provider)
      }
    } catch {
      // 目录探测失败不影响主流程：declared 只影响界面提示
    }
    return routes
  }

  /**
   * 每条路由的界面元信息：能不能删改、档位写到哪一层、凭据引用名叫什么。
   * 只用**配置层**判断——`value` 里带着适配器算出来的默认值，不能拿它当"用户写过"。
   */
  const routeMeta = (view) => {
    const configured = configProfiles(view)
    const base = view?.base?.providers
    const inherited = base !== null && typeof base === 'object' ? base : {}
    const meta = {}
    for (const [route, profile] of Object.entries(configured)) {
      meta[route] = {
        userOwned: inherited[route] === undefined,
        modelsExplicit: modelsAreExplicit(profile),
        keyRef: typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : null,
      }
    }
    return meta
  }

  /** 变更前的 `providers` 子树（写快照用）。只用配置层，别把适配器默认值存进去。 */
  const providersSubtree = (view) => configProfiles(view)

  /** 把一次失败翻译成界面能显示的一句话。 */
  const translate = (error) => {
    const code = error !== null && typeof error === 'object' ? error.code : undefined
    if (code === 'SETTINGS_CONFLICT' || /conflict/i.test(String(code))) {
      return {
        ok: false,
        code: 'conflict',
        message: '配置已被外部改动（另一个标签页或手改的 cordis.patch.yml），已载入最新值，请重试',
        expected: error.expected,
        actual: error.actual,
      }
    }
    return { ok: false, code: 'rejected', message: error instanceof Error ? error.message : String(error) }
  }

  /** 结构变更前落一份快照；没有快照器时安静跳过（插件半可单独使用）。 */
  const captureBefore = (view, label) => {
    if (snapshots === null) return null
    try {
      return snapshots.capture(providersSubtree(view), label)
    } catch (error) {
      // 快照失败不阻断写：它是兜底，不是前置条件
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 写成功之后把「写完之后的值」补进刚落的快照（撤销前复核要用它）。
   *
   * 失败静默：没有 `after` 的快照只是"无法复核"，撤销照常做——
   * 让快照补写失败去回滚一次已经成功的配置写入是本末倒置。
   */
  const captureAfter = (captured) => {
    if (snapshots === null) return null
    if (captured === null || typeof captured !== 'object' || typeof captured.path !== 'string') return null
    try {
      snapshots.attachAfter(captured.path, providersSubtree(describe()))
      return captured
    } catch {
      return null
    }
  }

  /** 最近一份结构快照的元信息（界面上的"撤销"按钮用它决定显示什么）。 */
  const listUndo = () => {
    if (snapshots === null) return null
    try {
      const [head] = snapshots.list()
      return head ?? null
    } catch {
      return null
    }
  }

  /** 一次写入 + 冲突翻译。所有结构变更都走这里，保持一把锁。 */
  const mutate = async (ops, revision) => {
    if (ops.length === 0) return { ok: false, code: 'invalid', message: '没有要写入的内容' }
    const settings = requireSettings()
    try {
      await settings.mutate(NS, ops, typeof revision === 'number' ? revision : undefined)
    } catch (error) {
      return translate(error)
    }
    const after = describe()
    return { ok: true, revision: typeof after.revision === 'number' ? after.revision : 0 }
  }

  /** 写/删凭据。凭据服务缺席时返回 `{ ok:false, message }`，由调用方决定怎么说。 */
  const keyWriter = () => {
    const credentials = ctx.get?.('credentials')
    if (credentials === undefined || typeof credentials.set !== 'function') return null
    return credentials
  }

  /**
   * 把密钥写进凭据服务。返回可展示的结果，不抛——半成品状态要说出来。
   * @param action 用在提示语里（新建是"已创建"，改字段是"已保存"）
   */
  const storeKey = async (route, keyRef, key, action = '已创建') => {
    if (typeof keyRef !== 'string' || keyRef.length === 0 || typeof key !== 'string' || key.length === 0) {
      return { ok: true, keyRef: null }
    }
    const credentials = keyWriter()
    if (credentials === null) {
      return { ok: false, keyRef, message: `${route} ${action}，但宿主没有可用的凭据服务：密钥没存下来` }
    }
    try {
      await credentials.set(keyRef, key)
      return { ok: true, keyRef }
    } catch (error) {
      return {
        ok: false,
        keyRef,
        message: `${route} ${action}，但密钥写入失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** 删除随路由派生的那条凭据；只删「名字正好等于派生值」的，避免顺手删掉共享凭据。 */
  const dropKey = async (route, profile) => {
    const ref = typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : null
    const derived = deriveKeyRef(route)
    if (ref === null || ref !== derived) return { ok: true, keyRef: null, skipped: true }
    const credentials = keyWriter()
    if (credentials === null || typeof credentials.unset !== 'function') {
      return { ok: false, keyRef: ref, message: '宿主没有可用的凭据服务：密钥没被删除' }
    }
    try {
      await credentials.unset(ref)
      return { ok: true, keyRef: ref }
    } catch (error) {
      return {
        ok: false,
        keyRef: ref,
        message: `供应商已删除，但密钥没删掉：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  return {
    NS,
    LEVELS,

    /** 当前生效的提供商视图 + revision。 */
    snapshot() {
      const view = describe()
      return {
        ns: NS,
        revision: typeof view.revision === 'number' ? view.revision : 0,
        levels: LEVELS,
        geminiApi: GEMINI_API,
        geminiLevels: GEMINI_LEVELS,
        compatKeys: COMPAT_KEYS,
        protocols: PROTOCOLS,
        templates: TEMPLATES,
        undo: listUndo(),
        providers: providersView(routeProfiles(view), declaredRoutes(), routeMeta(view)),
      }
    },

    /** 某个 provider/model 的档位能力（失败返回空集合，不抛）。 */
    async modelReasoning(provider, model, signal) {
      const llm = ctx.get?.('llm')
      if (llm === undefined || typeof llm.resolveModelInfo !== 'function') {
        return { supported: [], defaultEffort: null }
      }
      try {
        return reasoningOf(await llm.resolveModelInfo(provider, model, signal))
      } catch {
        return { supported: [], defaultEffort: null }
      }
    },

    /** 校验一组选择能不能用；返回 null 表示可用，否则返回原因。 */
    async validateSelection(selection, signal) {
      if (selection === null) return null
      const llm = ctx.get?.('llm')
      if (llm === undefined || typeof llm.resolveModelInfo !== 'function') {
        return '宿主没有可用的 llm 服务：无法校验这组选择'
      }
      try {
        const info = await llm.resolveModelInfo(selection.provider, selection.model, signal)
        const { supported } = reasoningOf(info)
        if (selection.reasoningEffort !== null && !supported.includes(selection.reasoningEffort)) {
          return `${selection.provider}/${selection.model} 不支持思考等级 ${selection.reasoningEffort}`
        }
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },

    /**
     * 写模型字段或提供商字段。
     *
     * `model.id` 与 `modelId` 不同即**改名**（ADR 0009 第 2 条）：
     * - 配置层有显式 `models` → 元素替换，顺序与其余模型都不动；
     * - 纯目录路由 → 同一批 ops 里 set 新键 + unset 旧键，override 值里不带 `id`。
     *
     * 改名只回报 `rename: { route, from, to }`：插件状态（`defaults`）的迁移必须由
     * 路由层用那个带缓存的 store 写回，否则 `/state` 会读到迁移前的值。
     *
     * @returns `{ ok: true, revision, rename? }` 或 `{ ok: false, code, message, expected, actual }`
     */
    async write({ route, revision, model, fields, modelId }, signal) {
      const view = describe()
      // 写回用配置层，不要用含适配器默认值的生效值（见 configProfiles 注释）
      const configured = configProfiles(view)
      // 正常路径：只用配置层。若这一版 describe() 不发布 base/user，就退回生效值——
      // 能用比"写不进去"重要，代价是可能把适配器注入的默认值物化一次。
      const providers = configured[route] === undefined ? routeProfiles(view) : configured
      const profileConfig = configured[route]
      const profile = providers[route]
      if (profile === undefined || profile === null || typeof profile !== 'object') {
        return { ok: false, code: 'invalid', message: `没有这个提供商：${route}` }
      }
      const ops = []
      let rename = null
      if (model !== undefined && model !== null) {
        const sourceId = typeof model.id === 'string' ? model.id.trim() : ''
        const targetId = typeof modelId === 'string' && modelId.trim().length > 0 ? modelId.trim() : sourceId
        if (targetId.length === 0) {
          return { ok: false, code: 'invalid', message: '缺少被编辑的模型 id：modelId 或 model.id 至少给一个' }
        }
        // 没给 model.id = 不改 id（与"model.id 等于 modelId"等价，旧客户端就是这样）
        const newId = sourceId.length > 0 ? sourceId : targetId
        const renaming = newId !== targetId
        // 写字段时 id 单独处理：改名走"新 id"，不改名就完全忽略它
        const patch = { ...model }
        delete patch.id
        try {
          if (modelsAreExplicit(profileConfig)) {
            // 配置层自己写了 models → 那张表就是权威，整段替换（ADR 0008 第 1 条）
            const list = Array.isArray(profileConfig.models) ? profileConfig.models : []
            if (renaming) {
              const taken = list.some((entry) => entry !== null && typeof entry === 'object' && entry.id === newId)
              if (taken) return { ok: false, code: 'invalid', message: `模型 id 已存在：${newId}` }
              // 元素替换：原字段 + model（id 在 patch 里，所以这一项换成了新 id）
              ops.push(...buildModelOps(route, list, targetId, { ...patch, id: newId }))
              rename = { route, from: targetId, to: newId }
            } else {
              ops.push(...buildModelOps(route, list, targetId, patch))
            }
          } else {
            // 纯目录路由：写 modelOverrides，别把整张目录物化进配置文件
            // 「有哪些模型」要看**生效值**：用户层只写了 modelOverrides 时它自己没有
            // models，目录里的模型在 value 层；拿配置层判断会误报"模型不在列表里"。
            const listed = routeProfiles(view)[route]?.models
            const knownModels = Array.isArray(listed) ? listed : []
            const known = knownModels.some((entry) => entry !== null && typeof entry === 'object' && entry.id === targetId)
            if (!known) return { ok: false, code: 'invalid', message: `模型 ${targetId} 不在 ${route} 的模型列表里` }
            const overrides = profileConfig?.modelOverrides
            if (renaming) {
              const overridden = overrides !== null && typeof overrides === 'object' && Object.hasOwn(overrides, newId)
              const listedNew = knownModels.some((entry) => entry !== null && typeof entry === 'object' && entry.id === newId)
              if (overridden || listedNew) return { ok: false, code: 'invalid', message: `模型 id 已存在：${newId}` }
              ops.push(...buildModelRenameOps(route, overrides, targetId, newId, patch))
              rename = { route, from: targetId, to: newId }
            } else {
              ops.push(...buildModelOverrideOps(route, overrides, targetId, patch))
            }
          }
        } catch (error) {
          return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
        }
      }
      if (fields !== undefined && fields !== null) {
        const routeOps = buildRouteOps(route, fields)
        if (routeOps.length === 0) return { ok: false, code: 'invalid', message: '没有要写入的提供商字段' }
        ops.push(...routeOps)
      }
      if (ops.length === 0) return { ok: false, code: 'invalid', message: '没有要写入的内容' }
      // 编辑也落快照：撤销按钮现在说「撤销上一次写入」，编辑必须同样可撤（ADR 0009 第 6 条）
      const snapshot = captureBefore(view, 'edit-model')
      const result = await mutate(ops, revision)
      if (result.ok !== true) return result
      captureAfter(snapshot)
      return {
        ok: true,
        revision: result.revision,
        snapshot,
        ...(rename === null ? {} : { rename }),
      }
    },

    /**
     * 改一条已存在供应商的身份字段（`displayName` / `baseURL` / `api`）与可选的密钥。
     *
     * 密钥写在**现有的** `apiKeyEnv` 引用名下：引用名与 route id 一样是派生出来的，
     * 本插件不允许改（改了等于换一条凭据，历史配置全断，ADR 0009 第 1 条）。
     *
     * 顺序是「先配置再凭据」：配置被 `assertServiceable` 拒时什么都不动（不留下
     * 半成品），凭据写失败则让用户看见"配置已存、密钥没存"这种半成品状态。
     */
    async editProvider({ route, revision, fields, key }) {
      const view = describe()
      const id = typeof route === 'string' ? route.trim() : ''
      if (id.length === 0) return { ok: false, code: 'invalid', message: 'route 不能为空' }
      const profile = configProfiles(view)[id]
      if (profile === undefined || profile === null || typeof profile !== 'object') {
        return { ok: false, code: 'invalid', message: `没有这条供应商：${id}` }
      }
      const normalized = normalizeProviderEdit(fields)
      if (!normalized.ok) {
        return {
          ok: false,
          code: 'invalid',
          message: normalized.issues.map((issue) => issue.message).join('；'),
          issues: normalized.issues,
        }
      }
      const keyRef = typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : null
      const trimmedKey = typeof key === 'string' ? key.trim() : ''
      if (trimmedKey.length > 0 && keyRef === null) {
        // 没有引用名就没有地方放密钥；先拒掉，别等写了一半才说
        return { ok: false, code: 'invalid', message: `${id} 没有凭据引用名（apiKeyEnv），无处保存密钥` }
      }
      const snapshot = captureBefore(view, 'edit-provider')
      const result = await mutate(buildProviderFieldOps(id, normalized.fields), revision)
      if (result.ok !== true) {
        // 宿主自己的 assertServiceable 拒绝（例如新协议与既有 models 不兼容）不是"冲突"，
        // 而是"这个值不能写"——翻成 invalid，界面才知道该让用户改值而不是刷新重试。
        return result.code === 'conflict' ? result : { ok: false, code: 'invalid', message: result.message }
      }
      captureAfter(snapshot)
      const credential = trimmedKey.length > 0 ? await storeKey(id, keyRef, trimmedKey, '已保存') : undefined
      return {
        ok: true,
        revision: result.revision,
        snapshot,
        ...(credential === undefined ? {} : { credential }),
      }
    },

    /**
     * 按一条**已存在**的供应商准备「检测连通」的探测请求。
     *
     * 端点优先用显式覆盖值（编辑表单里刚改完、还没保存的 `baseURL`/`api`），
     * 没有再退回 profile 里已保存的值——否则「改完地址点检测」探的还是旧地址，
     * 用户以为验过了其实没验。两者都没有就退回 `{ provider: route }` 让宿主查目录。
     *
     * 密钥优先用显式值（表单里刚输入的），否则按现有 `apiKeyEnv` 走 `credentials.resolve`。
     * 无论哪条来源，密钥都只在宿主侧交给 `llm.discoverModels`，**绝不回传**。
     *
     * @returns `{ ok: true, request }` 或 `{ ok: false, code, message }`
     */
    async discoveryRequest({ route, baseURL, api, apiKey }) {
      const id = typeof route === 'string' ? route.trim() : ''
      if (id.length === 0) return { ok: false, code: 'invalid', message: 'route 不能为空' }
      let view
      try {
        view = describe()
      } catch (error) {
        return { ok: false, code: 'unavailable', message: error instanceof Error ? error.message : String(error) }
      }
      const profile = configProfiles(view)[id] ?? routeProfiles(view)[id]
      if (profile === undefined || profile === null || typeof profile !== 'object') {
        return { ok: false, code: 'invalid', message: `没有这条供应商：${id}` }
      }
      const explicitBase = typeof baseURL === 'string' && baseURL.trim().length > 0 ? baseURL.trim() : null
      const savedBase = typeof profile.baseURL === 'string' && profile.baseURL.trim().length > 0 ? profile.baseURL.trim() : null
      const target = explicitBase ?? savedBase
      if (target === null) return { ok: true, request: { provider: id } }
      const request = { baseURL: target }
      const explicitApi = typeof api === 'string' && api.trim().length > 0 ? api.trim() : null
      const savedApi = typeof profile.api === 'string' && profile.api.trim().length > 0 ? profile.api.trim() : null
      const targetApi = explicitApi ?? savedApi
      if (targetApi !== null) request.api = targetApi
      const explicitKey = typeof apiKey === 'string' && apiKey.trim().length > 0 ? apiKey.trim() : null
      if (explicitKey !== null) {
        // 表单里刚敲的密钥优先：它还没进凭据服务，"测一下再保存"要靠这条
        request.apiKey = explicitKey
        return { ok: true, request }
      }
      const keyRef = typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : null
      if (keyRef !== null) {
        const credentials = ctx.get?.('credentials')
        if (credentials === undefined || typeof credentials.resolve !== 'function') {
          return {
            ok: false,
            code: 'unavailable',
            message: `密钥在凭据服务里（${keyRef}），但宿主没有可用的凭据服务：无法带上密钥探测`,
          }
        }
        try {
          const found = await credentials.resolve(keyRef)
          const value = typeof found === 'string'
            ? found
            : (found !== null && typeof found === 'object' && typeof found.value === 'string' ? found.value : '')
          if (value.length > 0) request.apiKey = value
        } catch (error) {
          return {
            ok: false,
            code: 'discover-failed',
            message: `读取密钥失败（${keyRef}）：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }
      return { ok: true, request }
    },

    /**
     * 新建一条供应商 + 它的首个模型 + 可选的密钥。
     *
     * 顺序是「先 profile 再凭据」：profile 里带着 `apiKeyEnv` 引用名，凭据写失败
     * 也要让用户看见"供应商已建、密钥没存"这种半成品状态，而不是两个都回滚——
     * 回滚需要第二次写，第二次也可能失败（ADR 0007）。
     */
    async createProvider({ route, revision, draft }) {
      const view = describe()
      const taken = Object.keys(configProfiles(view))
      const normalized = normalizeProvider({ ...draft, route: route ?? draft?.route }, { takenRoutes: taken })
      if (!normalized.ok) {
        return {
          ok: false,
          code: 'invalid',
          message: normalized.issues.map((issue) => issue.message).join('；'),
          issues: normalized.issues,
        }
      }
      const snapshot = captureBefore(view, 'create-provider')
      const result = await mutate(buildProviderOps(normalized.route, normalized.profile), revision)
      if (result.ok !== true) return result
      captureAfter(snapshot)
      const credential = await storeKey(normalized.route, normalized.profile.apiKeyEnv, normalized.key)
      return {
        ok: true,
        revision: result.revision,
        route: normalized.route,
        keyRef: normalized.profile.apiKeyEnv ?? null,
        credential,
        snapshot,
      }
    },

    /** 删除一条供应商：unset 整条 profile，并且只删它自己派生的那条凭据。 */
    async deleteProvider({ route, revision }) {
      const view = describe()
      const profile = configProfiles(view)[route]
      if (profile === undefined || profile === null) {
        return { ok: false, code: 'invalid', message: `没有这条供应商：${route}` }
      }
      const snapshot = captureBefore(view, 'delete-provider')
      const result = await mutate(buildProviderUnsetOps(route), revision)
      if (result.ok !== true) return result
      captureAfter(snapshot)
      const credential = await dropKey(route, profile)
      return {
        ok: true,
        revision: result.revision,
        removedModels: Array.isArray(profile.models) ? profile.models.length : 0,
        credential,
        snapshot,
      }
    },

    /** 往一条已存在的供应商里加一个模型行。 */
    async addModel({ route, revision, model }) {
      const view = describe()
      const profile = configProfiles(view)[route]
      if (profile === undefined || profile === null) {
        return { ok: false, code: 'invalid', message: `没有这条供应商：${route}` }
      }
      if (!modelsAreExplicit(profile)) {
        return {
          ok: false,
          code: 'invalid',
          message: `${route} 的模型来自已安装目录，直接追加会把整张目录替换成这一行；请改用「新建供应商」，或先显式接管它的模型列表`,
        }
      }
      const existingIds = (Array.isArray(profile.models) ? profile.models : [])
        .map((entry) => (entry !== null && typeof entry === 'object' ? entry.id : undefined))
        .filter((id) => typeof id === 'string')
      const normalized = normalizeModel(model, { existingIds })
      if (!normalized.ok) {
        return {
          ok: false,
          code: 'invalid',
          message: normalized.issues.map((issue) => issue.message).join('；'),
          issues: normalized.issues,
        }
      }
      const snapshot = captureBefore(view, 'add-model')
      let ops
      try {
        ops = buildModelInsertOps(route, profile.models, normalized.model)
      } catch (error) {
        return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
      }
      const result = await mutate(ops, revision)
      if (result.ok !== true) return result
      captureAfter(snapshot)
      return { ok: true, revision: result.revision, model: normalized.model, snapshot }
    },

    /**
     * 删一个模型行。删到空时升级为「删整条供应商」——空 models 对手写路由
     * 是不合法的，界面必须把这件事说成它真正的后果。
     */
    async removeModel({ route, revision, modelId }) {
      const view = describe()
      const profile = configProfiles(view)[route]
      if (profile === undefined || profile === null) {
        return { ok: false, code: 'invalid', message: `没有这条供应商：${route}` }
      }
      if (!modelsAreExplicit(profile)) {
        return {
          ok: false,
          code: 'invalid',
          message: `${route} 的模型来自已安装目录，删不掉；目录里有什么由 pi-ai 决定`,
        }
      }
      const snapshot = captureBefore(view, 'remove-model')
      let outcome
      try {
        outcome = buildModelRemoveOps(route, profile.models, modelId)
      } catch (error) {
        return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
      }
      const result = await mutate(outcome.ops, revision)
      if (result.ok !== true) return result
      captureAfter(snapshot)
      const credential = outcome.removesProvider ? await dropKey(route, profile) : { ok: true, keyRef: null }
      return {
        ok: true,
        revision: result.revision,
        removesProvider: outcome.removesProvider,
        credential,
        snapshot,
      }
    },

    /**
     * 用最近一份结构快照恢复 `providers` 子树。
     *
     * 撤销是**整条 provider 覆盖**：快照有 `after` 时先复核"这条供应商现在还是不是
     * 我上次写完的那个样子"，不等就要求 `force` 二次确认（ADR 0009 第 6 条）。
     * 旧快照没有 `after` → 无从复核，照常撤销。
     *
     * @param force 跳过复核（界面二次确认之后才传 true）
     */
    async undoStructure({ revision, force } = {}) {
      if (snapshots === null) return { ok: false, code: 'unavailable', message: '没有可用的快照目录' }
      const latest = snapshots.latest()
      if (latest === null) return { ok: false, code: 'empty', message: '还没有可撤销的结构变更' }
      const view = describe()
      const current = providersSubtree(view)
      if (force !== true && latest.after !== null && typeof latest.after === 'object') {
        const changed = changedRoutes(current, latest.after)
        if (changed.length > 0) {
          return {
            ok: false,
            code: 'stale',
            message: '上次写入后这条供应商又被改过，撤销会一并覆盖',
            routes: changed,
            label: latest.label,
          }
        }
      }
      const ops = diffProviderOps(current, latest.providers)
      if (ops.length === 0) return { ok: false, code: 'noop', message: '当前配置与快照一致，不需要撤销' }
      const result = await mutate(ops, revision)
      if (result.ok !== true) return result
      return {
        ok: true,
        revision: result.revision,
        applied: ops.length,
        from: latest.at,
        label: latest.label,
        routes: routesOfOps(ops),
      }
    },
  }
}
