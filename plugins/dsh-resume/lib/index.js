/**
 * dsh-resume — Host 半。
 *
 * 让"被中断的会话"可以一键继续：浏览器半画出 ▶ 之后，调这里的路由；这里在**宿主侧**
 * 组一条续跑指令，用 `agent.followup()` 入队并唤醒驱动（与官方 `dsh-goal-round-driver`
 * 同一套机制），因此：
 *   - 不重放上一条用户消息（不会重复已成功的工具调用）；
 *   - 指令以 `source.kind = 'resume'` 记录，Chat 渲染成一行折叠的"上下文注入"，
 *     模型看得到全文，用户不被打扰。
 *
 * 路由（挂在 web carrier 的 `/dsh-resume` 前缀下）：
 *
 * | Method | Path                    | Purpose                                   |
 * |--------|-------------------------|-------------------------------------------|
 * | GET    | `/dsh-resume/state`     | 某会话当前的中断状态 + 剩余工作              |
 * | POST   | `/dsh-resume/continue`  | 对某会话入队一条续跑指令                     |
 * | GET    | `/dsh-resume/health`    | 自检：路由是否活着、配置是否生效              |
 *
 * 配置优先使用 Schemastery；依赖不可用时回退到仅供校验的 Standard Schema v1。
 *
 * @module dsh-resume
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

import { inspectSession, STATE_VERSION } from './state.js'
import { continuationPrompt, continuationSummary, normalizeLanguage } from './prompt.js'

/** Cordis entry name（必须与 bundle 行 id 一致）。 */
export const name = 'resume'

/** 硬依赖：浏览器 HTTP 载体 + 会话存储；agent 注册表按需取。 */
export const inject = ['webServer', 'sessions']

/** 路由前缀（浏览器半用同一个常量）。 */
export const ROUTE_PREFIX = '/dsh-resume'

/** 各路由的完整路径。 */
export const ROUTES = Object.freeze({
  state: `${ROUTE_PREFIX}/state`,
  continue: `${ROUTE_PREFIX}/continue`,
  health: `${ROUTE_PREFIX}/health`,
  debugCancel: `${ROUTE_PREFIX}/debug/cancel`,
})

/** 一次续跑的服务端去抖时长：防连点造成两条回合。 */
const SEND_LOCK_MS = 5000

/** 错误码：这些错误继续也没意义，默认不提供 ▶。 */
const DEFAULT_IGNORE_ERROR_CODES = Object.freeze([])

/** 折叠行摘要上限（与 dsh-llm 的 CONTEXT_SUMMARY_MAX_CHARS 对齐）。 */
const SUMMARY_MAX = 120

/** 配置默认值。 */
export const DEFAULTS = Object.freeze({
  placement: 'seat',
  includeCompleted: false,
  promptLanguage: 'auto',
  maxPromptChars: 1200,
  ignoreErrorCodes: DEFAULT_IGNORE_ERROR_CODES,
})

const PLACEMENTS = new Set(['seat', 'toolbar'])
const LANGUAGES = new Set(['auto', 'zh', 'en'])

/** 标准 JSON Schema；不作为 dsh 设置页使用的 Schemastery 序列化格式。 */
const CONFIG_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  title: 'dsh-resume',
  description: '中断后续跑：把发送键变成可点的「▶ 继续」',
  properties: {
    placement: {
      type: 'string',
      enum: ['seat', 'toolbar'],
      default: 'seat',
      description: '▶ 的位置：seat=精确覆盖发送键；toolbar=发送键左侧新增一个（宿主改版时的兜底）',
    },
    includeCompleted: {
      type: 'boolean',
      default: false,
      description: '回合正常结束、但仍有未完成待办/目标时，也提供继续',
    },
    promptLanguage: {
      type: 'string',
      enum: ['auto', 'zh', 'en'],
      default: 'auto',
      description: '续跑指令的语言：auto 跟随界面语言',
    },
    maxPromptChars: {
      type: 'integer',
      minimum: 200,
      maximum: 12000,
      default: 1200,
      description: '续跑指令的字符上限（超长时压缩错误原文，护栏不截断）',
    },
    ignoreErrorCodes: {
      type: 'array',
      items: { type: 'string' },
      default: [],
      description: '这些错误码永远不提供继续（例如 CONTEXT_LENGTH_EXCEEDED）',
    },
  },
  additionalProperties: false,
}

/** 把任意输入收敛成合法配置。 */
export function normalizeOptions(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const placement = PLACEMENTS.has(raw.placement) ? raw.placement : DEFAULTS.placement
  const promptLanguage = LANGUAGES.has(raw.promptLanguage) ? raw.promptLanguage : DEFAULTS.promptLanguage
  const maxPromptCharsRaw = Number(raw.maxPromptChars)
  const maxPromptChars = Number.isFinite(maxPromptCharsRaw)
    ? Math.max(200, Math.min(12000, Math.floor(maxPromptCharsRaw)))
    : DEFAULTS.maxPromptChars
  const ignoreErrorCodes = Array.isArray(raw.ignoreErrorCodes)
    ? raw.ignoreErrorCodes.filter((code) => typeof code === 'string' && code !== '')
    : [...DEFAULT_IGNORE_ERROR_CODES]
  return {
    placement,
    includeCompleted: raw.includeCompleted === true,
    promptLanguage,
    maxPromptChars,
    ignoreErrorCodes,
  }
}

/** 读取可选依赖；直接链接源码且尚未安装依赖时也能安全启动。 */
function loadSchemastery() {
  try {
    const loaded = createRequire(import.meta.url)('@deepseek-ai/schemastery')
    return loaded.default ?? loaded
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return null
    throw error
  }
}

/** 宿主配置描述与 Standard Schema 校验共存，保留已有的宽容归一化行为。 */
export function createConfigSchema(z = loadSchemastery()) {
  const standard = {
    version: 1,
    vendor: 'dsh-resume',
    validate(value) {
      try {
        return { value: normalizeOptions(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error), path: [] }] }
      }
    },
    jsonSchema: {
      input: () => CONFIG_JSON_SCHEMA,
      output: () => CONFIG_JSON_SCHEMA,
    },
  }
  if (z === null) {
    // dsh-settings 以 toJSON 为 Schemastery 判据；回退对象不能暴露这个方法。
    return { '~standard': standard, toString: () => JSON.stringify(CONFIG_JSON_SCHEMA) }
  }
  const fields = {}
  for (const [key, field] of Object.entries(CONFIG_JSON_SCHEMA.properties)) {
    let schema
    if (field.enum) schema = z.union(field.enum.map((value) => z.const(value)))
    else if (field.type === 'boolean') schema = z.boolean()
    else if (field.type === 'integer') schema = z.number().min(field.minimum).max(field.maximum).step(1)
    else schema = z.array(z.string())
    fields[key] = schema.default(field.default).description(field.description)
  }
  // apply() 在挂载时读取配置，字段不能标记为支持热更新的 volatile。
  const schema = z.object(fields).description(CONFIG_JSON_SCHEMA.description)
  Object.defineProperty(schema, '~standard', { value: standard })
  return schema
}

export const Config = createConfigSchema()

// ------------------------------------------------------------------ HTTP 小工具

/** 统一 JSON 响应。 */
function sendJson(res, status, value, extraHeaders) {
  let body
  try {
    body = JSON.stringify(value)
  } catch {
    body = JSON.stringify({ ok: false, code: 'serialize-failed' })
    status = 500
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (extraHeaders !== undefined) for (const [key, headerValue] of Object.entries(extraHeaders)) res.setHeader(key, headerValue)
  res.end(body)
}

/** 读 JSON 请求体（上限 64KB）；坏 JSON 返回 undefined。 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 65536) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** 去掉 query string，返回路径。 */
function pathnameOf(url) {
  const raw = typeof url === 'string' ? url : '/'
  const index = raw.indexOf('?')
  return index === -1 ? raw : raw.slice(0, index)
}

/** 从 URL 取 query 参数。 */
function queryOf(url) {
  const raw = typeof url === 'string' ? url : ''
  const index = raw.indexOf('?')
  if (index === -1) return new URLSearchParams()
  return new URLSearchParams(raw.slice(index + 1))
}

/** 递归冻结，确保入队的消息不可再被改动。 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return value
}

/** 组一条带 `resume` 来源的用户消息（等价 dsh-llm 的 createUserMessage）。 */
export function buildContinuationMessage(text, state, summary) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'resume',
      form: 'notice',
      summary,
      version: STATE_VERSION,
      turn: state.turn ?? null,
      step: state.step ?? null,
      seq: state.seq ?? null,
      at: state.at ?? null,
      code: state.code ?? null,
    },
  })
}

// ------------------------------------------------------------------ 插件主体

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply(ctx, config) {
  const options = normalizeOptions(config)
  const states = new Map()
  const coldStates = new Map()
  const locks = new Map()

  /** 当前会话的中断状态（按 session.seq 缓存，日志没变就不重算）。 */
  function readState(session) {
    const seq = Number(session.seq)
    const cached = states.get(session.id)
    if (cached !== undefined && cached.seq === seq) return cached.state
    let events = []
    try {
      events = session.snapshotEvents()
    } catch (error) {
      ctx.logger?.warn?.(`dsh-resume: cannot read session ${session.id}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    const state = inspectSession(events, {
      includeCompleted: options.includeCompleted,
      ignoreErrorCodes: options.ignoreErrorCodes,
    })
    states.set(session.id, { seq, state })
    return state
  }

  /**
   * 折叠结果 + 运行态修正：正在跑的一轮本来就没有 turn/end，别把它当成"进程死过"。
   */
  function stateOf(session) {
    const state = readState(session)
    if (state === null) return null
    const agents = ctx.get('agents')
    const agent = agents?.get?.(session.id)
    if (agent !== undefined && agent.status === 'running') {
      return { ...state, status: 'running', eligible: false }
    }
    return state
  }

  /** 冷会话（不在内存里）也能给出状态：直接读持久化日志，不把它变成 live。 */
  async function coldStateOf(sessionId) {
    const cached = coldStates.get(sessionId)
    if (cached !== undefined && Date.now() - cached.at < 5000) return cached.state
    const query = ctx.get('sessionQuery')
    if (query === undefined || typeof query.readSession !== 'function') return null
    let state = null
    try {
      const snapshot = await query.readSession(sessionId)
      state = inspectSession(snapshot?.events ?? [], {
        includeCompleted: options.includeCompleted,
        ignoreErrorCodes: options.ignoreErrorCodes,
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-resume: cold read failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    coldStates.set(sessionId, { at: Date.now(), state })
    return state
  }

  /** 取活会话；不在内存里就算了（只有"正开着的会话"才需要 ▶）。 */
  function sessionOf(sessionId) {
    return ctx.sessions.get(sessionId)
  }

  /** 取活 agent；必要时让 session controller 恢复它。 */
  async function agentOf(sessionId) {
    const agents = ctx.get('agents')
    const live = agents?.get?.(sessionId)
    if (live !== undefined) return live
    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.resolveAgent !== 'function') return undefined
    try {
      const resolved = await controller.resolveAgent(sessionId)
      if (resolved && resolved.agent !== undefined) return resolved.agent
    } catch (error) {
      ctx.logger?.warn?.(`dsh-resume: resolveAgent failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
  }

  /** 会话里是否已有排队中的输入（有就别再插一条）。 */
  function hasQueuedInput(agent) {
    const inbox = agent?.inbox
    if (inbox === undefined || inbox === null) return false
    const nextTurn = Array.isArray(inbox.nextTurn) ? inbox.nextTurn.length : 0
    const nextStep = Array.isArray(inbox.nextStep) ? inbox.nextStep.length : 0
    return nextTurn + nextStep > 0
  }

  /** 语言：显式参数 > Accept-Language > en（Host 不碰 locale 服务，避免注入依赖）。 */
  function languageFor(req, explicit) {
    if (options.promptLanguage !== 'auto') return options.promptLanguage
    if (explicit === 'zh' || explicit === 'en') return explicit
    const header = typeof req.headers?.['accept-language'] === 'string' ? req.headers['accept-language'] : ''
    return normalizeLanguage(undefined, header)
  }

  async function handleState(req, res) {
    const sessionId = queryOf(req.url).get('sessionId') ?? ''
    const lang = queryOf(req.url).get('lang') ?? undefined
    if (sessionId === '') {
      sendJson(res, 400, { ok: false, code: 'missing-session' })
      return
    }
    const session = sessionOf(sessionId)
    const state = session === undefined ? await coldStateOf(sessionId) : stateOf(session)
    if (state === null) {
      sendJson(res, 200, { ok: true, sessionId, state: null, reason: 'session-unreadable' })
      return
    }
    const language = languageFor(req, lang)
    sendJson(res, 200, {
      ok: true,
      sessionId,
      live: session !== undefined,
      options: { placement: options.placement },
      summary: state.eligible ? continuationSummary(state, language) : null,
      state,
    })
  }

  async function handleContinue(req, res) {
    const body = await readJsonBody(req)
    if (body === undefined) {
      sendJson(res, 400, { ok: false, code: 'invalid-json' })
      return
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (sessionId === '') {
      sendJson(res, 400, { ok: false, code: 'missing-session' })
      return
    }
    const lockedAt = locks.get(sessionId)
    if (lockedAt !== undefined && Date.now() - lockedAt < SEND_LOCK_MS) {
      sendJson(res, 409, { ok: false, code: 'in-flight', message: '上一次继续还没落定' })
      return
    }

    const agent = await agentOf(sessionId)
    if (agent === undefined) {
      sendJson(res, 409, { ok: false, code: 'no-agent', message: '这个会话当前不在运行，无法继续' })
      return
    }
    if (agent.status !== 'idle') {
      sendJson(res, 409, { ok: false, code: 'busy', message: '会话正在运行' })
      return
    }
    if (hasQueuedInput(agent)) {
      sendJson(res, 409, { ok: false, code: 'queued', message: '已有排队中的消息，先让它跑完' })
      return
    }

    const session = agent.session ?? sessionOf(sessionId)
    if (session === undefined) {
      sendJson(res, 409, { ok: false, code: 'no-session' })
      return
    }
    const state = readState(session)
    if (state === null) {
      sendJson(res, 500, { ok: false, code: 'state-unreadable' })
      return
    }
    if (!state.eligible) {
      sendJson(res, 409, { ok: false, code: 'not-interrupted', message: '这一轮没有被中断' })
      return
    }
    // 用 turn 做"仍是同一次中断"的判据：冷会话被 resume 时宿主会补写 turn/end，
    // seq 会变，但 turn 不变。
    const expectTurn = Number(body.turn)
    if (Number.isFinite(expectTurn) && state.turn !== null && state.turn !== expectTurn) {
      sendJson(res, 409, { ok: false, code: 'stale', message: '会话已经变化，请重试' })
      return
    }

    const language = languageFor(req, typeof body.lang === 'string' ? body.lang : undefined)
    const text = continuationPrompt(state, { language, maxChars: options.maxPromptChars })
    const summary = continuationSummary(state, language)
    const message = buildContinuationMessage(text, state, summary)
    try {
      agent.followup(message)
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        code: 'followup-failed',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }
    locks.set(sessionId, Date.now())
    ctx.logger?.info?.(`dsh-resume: queued continuation for ${sessionId} (turn ${state.turn ?? '?'}, code ${state.code ?? '?'})`)
    sendJson(res, 200, { ok: true, messageId: message.id, turn: state.turn, seq: state.seq, summary })
  }

  async function handler(req, res) {
    const pathname = pathnameOf(req.url)
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
    try {
      if (pathname === ROUTES.health) {
        let clientPath = null
        try {
          const clientModules = ctx.get('clientModules')
          if (clientModules !== undefined && typeof clientModules.clientPath === 'function') {
            clientPath = clientModules.clientPath('dsh-resume') ?? null
          }
        } catch (error) {
          clientPath = `error: ${error instanceof Error ? error.message : String(error)}`
        }
        sendJson(res, 200, {
          ok: true,
          version: 1,
          options,
          liveSessions: ctx.sessions.list().length,
          client: { pluginId: 'dsh-resume', path: clientPath },
        })
        return
      }
      if (pathname === ROUTES.state) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, code: 'method-not-allowed' }, { Allow: 'GET, HEAD' })
          return
        }
        await handleState(req, res)
        return
      }
      if (pathname === ROUTES.continue) {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'method-not-allowed' }, { Allow: 'POST' })
          return
        }
        await handleContinue(req, res)
        return
      }
      // 自测开关：只允许取消"子会话（subagent）"的当前回合，永远碰不到用户的顶层会话。
      // 用来在没有真实 429 的情况下验中途断点 → ▶ 的完整链路。
      if (pathname === ROUTES.debugCancel) {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'method-not-allowed' }, { Allow: 'POST' })
          return
        }
        const body = await readJsonBody(req)
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        const session = sessionOf(sessionId)
        if (session === undefined) {
          sendJson(res, 409, { ok: false, code: 'no-session' })
          return
        }
        const header = session.header ?? {}
        const isChild = header.origin === 'subagent' || header.parentSession !== undefined
        if (!isChild) {
          sendJson(res, 403, { ok: false, code: 'not-a-child-session', message: '只允许对子会话做测试性取消' })
          return
        }
        const agent = await agentOf(sessionId)
        if (agent === undefined) {
          sendJson(res, 409, { ok: false, code: 'no-agent' })
          return
        }
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        sendJson(res, 200, { ok: true, cancelled: sessionId })
        return
      }
      sendJson(res, 404, { ok: false, code: 'not-found' })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-resume: route failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      try {
        sendJson(res, 500, { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) })
      } catch {
        /* response already settled */
      }
    }
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
    return () => {
      try {
        dispose?.()
      } catch {
        /* carrier already dropped the route */
      }
    }
  }, 'dsh-resume: /dsh-resume routes')

  ctx.logger?.info?.(`dsh-resume: routes ready at ${ROUTE_PREFIX} (placement=${options.placement})`)
}

export default { name, inject, Config, apply }
