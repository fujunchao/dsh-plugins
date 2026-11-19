/**
 * 宿主路由：`/model-tuning/*`，同源 fetch 调用（与本工作区 clean-route / siyuan-notes
 * 一致的做法：不引入 typert RPC 层）。
 *
 * 所有端点都返回 JSON；失败一律 `{ ok: false, error: { code, message } }`，
 * 让界面能把原因显示成一行字，而不是白屏。
 */
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { migrateDefaults } from './tune.js'

/** 路由前缀（客户端半与服务端注册共用）。 */
export const ROUTE_PREFIX = '/model-tuning'

/** 写一行 JSON 响应。 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读请求体 JSON；空体当作 `{}`。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** 安装目录：优先用 Electron 给的 resources 路径。 */
export function resolveInstallDir() {
  const resources = process.resourcesPath
  if (typeof resources === 'string' && resources.length > 0) return dirname(resources)
  return dirname(process.execPath)
}

/**
 * 补丁模块是可选依赖：它读写 app.asar，开发期可能还没就位。
 * 用动态 import + 缓存把「模块缺席」翻译成界面能显示的状态。
 */
function createPatcher(logger) {
  let modulePromise
  const load = () => {
    modulePromise ??= import('./xhigh.js').catch((error) => {
      logger?.warn?.(`model-tuning: 补丁模块不可用：${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    return modulePromise
  }
  const unavailable = {
    state: 'error',
    detail: '补丁模块不可用：lib/xhigh.js 未能加载',
    archivePath: '',
    appVersion: '',
    backupPath: null,
  }
  return {
    async status() {
      const module = await load()
      if (module === null || typeof module.patchStatus !== 'function') return unavailable
      try {
        return await module.patchStatus({ installDir: resolveInstallDir() })
      } catch (error) {
        return { ...unavailable, detail: error instanceof Error ? error.message : String(error) }
      }
    },
    async apply() {
      const module = await load()
      if (module === null || typeof module.applyPatch !== 'function') {
        return { ok: false, code: 'unavailable', message: unavailable.detail }
      }
      try {
        return await module.applyPatch({ installDir: resolveInstallDir() })
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    },
    async rollback() {
      const module = await load()
      if (module === null || typeof module.rollbackPatch !== 'function') {
        return { ok: false, code: 'unavailable', message: unavailable.detail }
      }
      try {
        return await module.rollbackPatch({ installDir: resolveInstallDir() })
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/**
 * 造路由表。
 * @param deps.ctx 宿主 ctx
 * @param deps.store 状态存储
 * @param deps.tuner 设置读写器
 */
export function createRoutes({ ctx, store, tuner }) {
  const logger = ctx.get?.('logger') ?? ctx.logger
  const patcher = createPatcher(logger)

  /**
   * 宿主跑起来时 `app.asar` 是挂载只读的，写它必须先完全退出应用、再跑命令。
   * 因此把「可执行的命令」随状态一起下发，界面才能给出动作而不是一句"失败"。
   */
  const withCommand = (patch) => {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'xhigh.mjs')
    const verb = patch.state === 'patched' ? 'rollback' : 'apply'
    return { ...patch, command: `node "${script}" ${verb}` }
  }

  const capabilities = () => ({    settings: ctx.get?.('settings') !== undefined,
    llm: ctx.get?.('llm') !== undefined,
    agents: ctx.get?.('agents') !== undefined,
    agentTeams: ctx.get?.('agentTeams') !== undefined,
    subagents: ctx.get?.('subagents') !== undefined,
    agentDefaultModel: ctx.get?.('agentDefaultModel') !== undefined,
    // 新建供应商要写密钥；凭据服务缺席就只能建空的引用名，界面据此禁用密钥输入
    credentials: ctx.get?.('credentials') !== undefined,
  })

  /**
   * 外部工具 cc-switch 也在改写同一份 profile 的 providers（`liveConfigManaged`）。
   * 我们只检测它在不在，**不解析它的数据库**——把 28MB 第三方 SQLite 的结构
   * 变成依赖，它改版那天我们就是坏的（ADR 0007）。
   */
  const externalManager = () => {
    const home = homedir()
    const markers = [
      join(home, '.cc-switch', 'cc-switch.db'),
      join(home, '.dsh', '.cc-switch-profile-sync.json'),
    ]
    return markers.some((path) => existsSync(path))
  }

  /** DSH 自己的默认模型（只读展示，用来解释两套默认的差别）。 */
  const dshDefault = () => {
    const service = ctx.get?.('agentDefaultModel')
    if (service === undefined || typeof service.currentSelection !== 'function') return null
    try {
      const selection = normalizeSelectionOf(service.currentSelection())
      return selection
    } catch {
      return null
    }
  }

  const statePayload = async () => {
    const { state, warning } = store.read()
    return {
      state,
      warning,
      dshDefault: dshDefault(),
      levels: tuner.LEVELS,
      patch: withCommand(await patcher.status()),
      capabilities: capabilities(),
      routePrefix: ROUTE_PREFIX,
      statePath: store.path,
      backupDir: join(dirname(store.path), 'model-tuning-backups'),
      externalManager: externalManager(),
    }
  }

  /** 结构变更端点的统一回包：冲突 409，其余 400，理由原样带回去。 */
  const sendResult = (res, result) => {
    if (result.ok === true) {
      sendJson(res, 200, result)
      return
    }
    sendJson(res, result.code === 'conflict' ? 409 : 400, { ok: false, error: result })
  }

  /**
   * 把改名结果落到插件状态的 `defaults` 上（只迁"插件默认"这一条引用）。
   * @param rename `tuner.write` 回报的 `{ route, from, to }`；没改名时为 undefined
   * @returns 真的迁移过为 true
   */
  const migrateDefaultsInStore = (rename) => {
    if (rename === undefined || rename === null || typeof rename !== 'object') return false
    const outcome = migrateDefaults(store.read().state, rename.route, rename.from, rename.to)
    if (!outcome.migrated) return false
    store.update(() => outcome.state)
    return true
  }

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const suffix = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname
    try {
      if (suffix === '/state' && req.method === 'GET') {
        sendJson(res, 200, await statePayload())
        return
      }
      if (suffix === '/providers' && req.method === 'GET') {
        sendJson(res, 200, tuner.snapshot())
        return
      }
      if (suffix === '/defaults' && req.method === 'POST') {
        const body = await readJson(req)
        const selection = normalizeSelectionOf({ provider: body.provider, model: body.model, reasoningEffort: body.reasoningEffort })
        if (selection === null) {
          sendJson(res, 400, { ok: false, error: { code: 'invalid', message: 'provider/model 不能为空' } })
          return
        }
        const failure = await tuner.validateSelection(selection)
        if (failure !== null) {
          sendJson(res, 400, { ok: false, error: { code: 'invalid', message: failure } })
          return
        }
        store.update((state) => ({ ...state, defaults: selection }))
        sendJson(res, 200, { ok: true, state: store.read().state })
        return
      }
      if (suffix === '/team-default' && req.method === 'POST') {
        const body = await readJson(req)
        store.update((state) => ({ ...state, teamDefaultEnabled: body.enabled === true }))
        sendJson(res, 200, { ok: true, state: store.read().state })
        return
      }
      if (suffix === '/task-first-hint' && req.method === 'POST') {
        const body = await readJson(req)
        store.update((state) => ({ ...state, taskFirstHint: body.enabled === true }))
        sendJson(res, 200, { ok: true, state: store.read().state })
        return
      }
      if (suffix === '/carry-effort' && req.method === 'POST') {
        const body = await readJson(req)
        store.update((state) => ({ ...state, carryEffort: body.enabled !== false }))
        sendJson(res, 200, { ok: true, state: store.read().state })
        return
      }
      if (suffix === '/model' && req.method === 'POST') {
        const body = await readJson(req)
        const result = await tuner.write({
          route: body.route,
          revision: body.revision,
          modelId: body.modelId,
          model: body.model,
          fields: body.fields,
        })
        if (result.ok === true) {
          // 改名要顺带迁移「插件默认」：状态文件写回必须用这个带缓存的 store，
          // 否则 /state 会一直显示旧 id（tuner 里没有 store 实例，所以在这里做）。
          const defaultsMigrated = migrateDefaultsInStore(result.rename)
          const snapshot = tuner.snapshot()
          sendJson(res, 200, {
            ok: true,
            revision: snapshot.revision,
            providers: snapshot.providers,
            defaultsMigrated,
          })
          return
        }
        sendJson(res, result.code === 'conflict' ? 409 : 400, { ok: false, error: result })
        return
      }
      if (suffix === '/provider' && req.method === 'POST') {
        const body = await readJson(req)
        sendResult(res, await tuner.createProvider({ route: body.route, revision: body.revision, draft: body }))
        return
      }
      if (suffix === '/provider' && req.method === 'DELETE') {
        const body = await readJson(req)
        sendResult(res, await tuner.deleteProvider({ route: body.route, revision: body.revision }))
        return
      }
      if (suffix === '/provider/edit' && req.method === 'POST') {
        const body = await readJson(req)
        sendResult(res, await tuner.editProvider({
          route: body.route,
          revision: body.revision,
          fields: body.fields,
          key: body.key,
        }))
        return
      }
      if (suffix === '/provider/undo' && req.method === 'POST') {
        const body = await readJson(req)
        const result = await tuner.undoStructure({ revision: body.revision, force: body.force === true })
        if (result.ok !== true && result.code === 'stale') {
          // stale 同时给两种读法：统一信封 error{code,message,routes}（既有客户端按这个读），
          // 以及契约 §4 写的顶层 code/message/routes（新客户端可能直接读顶层）。
          sendJson(res, 400, {
            ok: false,
            error: result,
            code: result.code,
            message: result.message,
            routes: result.routes,
          })
          return
        }
        sendResult(res, result)
        return
      }
      if (suffix === '/model/add' && req.method === 'POST') {
        const body = await readJson(req)
        sendResult(res, await tuner.addModel({ route: body.route, revision: body.revision, model: body.model }))
        return
      }
      if (suffix === '/model/remove' && req.method === 'POST') {
        const body = await readJson(req)
        sendResult(res, await tuner.removeModel({ route: body.route, revision: body.revision, modelId: body.modelId }))
        return
      }
      if (suffix === '/discover' && req.method === 'POST') {
        const body = await readJson(req)
        const llm = ctx.get?.('llm')
        if (llm === undefined || typeof llm.discoverModels !== 'function') {
          sendJson(res, 400, { ok: false, error: { code: 'unavailable', message: '宿主没有可用的 llm 服务：无法探测端点' } })
          return
        }
        let request
        if (typeof body.route === 'string' && body.route.length > 0) {
          // 按已存在的供应商探测：端点与密钥都从配置/凭据服务里取。
          // 显式的 baseURL/api/apiKey 是编辑表单里**还没保存**的值，用来"改完先测一下"；
          // 只给 route 时行为与以前一样（用已保存的配置）。
          // 密钥只在宿主侧用于这一次请求，不进响应（响应只有模型列表）。
          const prepared = await tuner.discoveryRequest({
            route: body.route,
            baseURL: body.baseURL,
            api: body.api,
            apiKey: body.apiKey,
          })
          if (prepared.ok !== true) {
            sendJson(res, 400, {
              ok: false,
              error: { code: prepared.code ?? 'invalid', message: prepared.message },
            })
            return
          }
          request = prepared.request
        } else {
          request = {}
          if (typeof body.provider === 'string' && body.provider.length > 0) request.provider = body.provider
          if (typeof body.baseURL === 'string' && body.baseURL.length > 0) request.baseURL = body.baseURL
          if (typeof body.api === 'string' && body.api.length > 0) request.api = body.api
          if (typeof body.apiKey === 'string' && body.apiKey.length > 0) request.apiKey = body.apiKey
        }
        try {
          const models = await llm.discoverModels(tuner.NS, request)
          sendJson(res, 200, { ok: true, models: Array.isArray(models) ? models : [] })
        } catch (error) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'discover-failed', message: error instanceof Error ? error.message : String(error) },
          })
        }
        return
      }
      if (suffix === '/patch/apply' && req.method === 'POST') {
        const result = await patcher.apply()
        if (result.ok !== true) {
          sendJson(res, 500, { ok: false, error: { code: result.code ?? 'failed', message: result.message ?? result.detail ?? '打补丁失败' } })
          return
        }
        sendJson(res, 200, { ok: true, patch: withCommand(await patcher.status()), requiresRestart: true })
        return
      }
      if (suffix === '/patch/rollback' && req.method === 'POST') {
        const result = await patcher.rollback()
        if (result.ok !== true) {
          sendJson(res, 500, { ok: false, error: { code: result.code ?? 'failed', message: result.message ?? result.detail ?? '回滚失败' } })
          return
        }
        sendJson(res, 200, { ok: true, patch: withCommand(await patcher.status()), requiresRestart: true })
        return
      }
      sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `未知端点：${suffix}` } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 500, { ok: false, error: { code: 'exception', message } })
    }
  }

  return { handler, patcher, statePayload }
}

/** 收敛一组选择（保留 null 档位语义）。 */
function normalizeSelectionOf(value) {
  if (value === null || value === undefined) return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return null
  const effort = value.reasoningEffort
  return {
    provider,
    model,
    reasoningEffort: typeof effort === 'string' && effort.length > 0 ? effort : null,
  }
}
