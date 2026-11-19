/**
 * 宿主钩子：新会话默认（模型 + 团队）与换模型时的档位保持。
 *
 * 机制依据（见 docs/adr/0002、0005）：
 *   - `agent/created` 是 serial 且被 await 的事件，发生在第一次 prompt 组装之前，
 *     因此在这里 `agent.model.select()` 一定先于首个请求生效；它写的是会话内的
 *     `model/selection`，优先于 `agentDefaultModel`，且只在新建会话时发生一次。
 *   - 团队走 `ctx.agentTeams.setEnabled()`（与上游 defaultEnabled 同一实现），
 *     不写 `agent-team` 的 loader 配置（那需要重载插件行）。
 */
import { normalizeSelection } from './state.js'

/**
 * 这个 agent 该不该被插件默认处理。
 * 只认真正新建的根会话：
 *   - `resume`：续跑既有会话，尊重它自己的选择；
 *   - `isSeeded`：从别的会话 fork 出来的，应继承父会话的选择；
 *   - `origin === 'subagent'`：子代理会话不参与。
 */
export function isEligibleForDefaults({ source, header }) {
  if (source !== 'startup') return false
  if (header !== null && typeof header === 'object') {
    if (header.origin === 'subagent') return false
    if (header.isSeeded === true) return false
  }
  return true
}

/**
 * 换模型后要不要把上一档补回来。
 *
 * 只在「上游替我做了选择」时出手：新提交的档位正好等于目标模型的默认档，
 * 说明那是 `ModelSelect` 自动塞进去的，不是用户挑的。用户显式挑过的档位
 * （不等于默认档）一律不动。
 */
export function shouldCarryEffort({ prev, next, supported, defaultEffort }) {
  if (prev === null || next === null) return false
  if (prev.provider === next.provider && prev.model === next.model) return false
  if (typeof prev.reasoningEffort !== 'string' || prev.reasoningEffort.length === 0) return false
  if (typeof next.reasoningEffort !== 'string' || next.reasoningEffort.length === 0) return false
  if (defaultEffort === null || next.reasoningEffort !== defaultEffort) return false
  if (prev.reasoningEffort === next.reasoningEffort) return false
  return Array.isArray(supported) && supported.includes(prev.reasoningEffort)
}

/** 把内部选择整理成 `agent.model.select()` 要的形状（省略 null 档位）。 */
export function toModelSelection(selection) {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === null ? {} : { reasoningEffort: selection.reasoningEffort },
  }
}

/**
 * 装钩子。
 * @param deps.ctx 宿主 ctx
 * @param deps.store 状态存储（createStore 的返回值）
 * @param deps.tuner 设置读写器（createTuner 的返回值）
 * @param deps.logger 可选日志器
 * @returns 卸载函数
 */
export function installHooks({ ctx, store, tuner, logger }) {
  const disposers = []
  /** 每个会话最后一次被观测到的选择，用于判断"上一档"。 */
  const lastSelection = new Map()
  /** 已补正过的切换，避免同一目标反复补。 */
  const corrected = new Set()

  const warn = (message) => {
    try {
      logger?.warn?.(`model-tuning: ${message}`)
    } catch {
      // 日志器缺席时保持安静
    }
  }
  const agentOf = (session) => {
    try {
      return ctx.get?.('agents')?.get?.(session.id)
    } catch {
      return undefined
    }
  }
  const now = () => new Date().toISOString()

  // ── 新会话默认 ──────────────────────────────────────────────────────────
  disposers.push(ctx.on('agent/created', async ({ agent, source, signal }) => {
    const { state } = store.read()
    const header = agent.session?.header ?? null
    if (!isEligibleForDefaults({ source, header })) return
    const sessionId = agent.session?.id ?? agent.id ?? ''

    if (state.defaults !== null) {
      try {
        agent.model.select(toModelSelection(state.defaults))
        store.reportApply({ at: now(), sessionId, ok: true, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        store.reportApply({ at: now(), sessionId, ok: false, error: message })
        warn(`默认模型写入失败：${message}`)
      }
    }

    if (state.teamDefaultEnabled) {
      const teams = ctx.get?.('agentTeams')
      const subagents = ctx.get?.('subagents')
      if (teams === undefined || typeof teams.setEnabled !== 'function') {
        warn('团队默认已开启，但宿主没有 agentTeams 服务')
        return
      }
      try {
        if (subagents !== undefined && typeof subagents.rootOf === 'function' && subagents.rootOf(agent) !== agent) return
        await teams.setEnabled(agent, true, signal)
      } catch (error) {
        warn(`团队默认开启失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }))

  // ── 换模型时保持档位 ────────────────────────────────────────────────────
  disposers.push(ctx.on('session/event', (session, event) => {
    if (event?.type !== 'model/selection') return
    const next = normalizeSelection(event.data)
    if (next === null) return
    const prev = lastSelection.get(session.id) ?? null
    lastSelection.set(session.id, next)
    if (lastSelection.size > 2000) lastSelection.clear()
    if (prev === null) return
    const { state } = store.read()
    if (!state.carryEffort) return
    if (session.header?.origin === 'subagent') return
    // 不在事件分发栈里同步 append：推到微任务，并在里面再判一次。
    queueMicrotask(() => {
      void (async () => {
        const support = await tuner.modelReasoning(next.provider, next.model)
        if (!shouldCarryEffort({ prev, next, supported: support.supported, defaultEffort: support.defaultEffort })) return
        const key = `${session.id}|${next.provider}|${next.model}|${prev.reasoningEffort}`
        if (corrected.has(key)) return
        corrected.add(key)
        if (corrected.size > 500) corrected.clear()
        const agent = agentOf(session)
        if (agent === undefined || agent.model === undefined) return
        try {
          agent.model.select({
            provider: next.provider,
            model: next.model,
            reasoningEffort: prev.reasoningEffort,
          })
        } catch (error) {
          warn(`档位保持失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })().catch((error) => {
        warn(`档位保持异常：${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        // 卸载期的错误不掩盖其它清理
      }
    }
  }
}
