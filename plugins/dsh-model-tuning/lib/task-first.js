/**
 * 「团队任务先行提示」：给开了团队模式的会话补一段系统提示词。
 *
 * 为什么需要它：上游的 `TEAM_POLICY`（`dsh-tool-agent-team/src/index.ts:27-33`）
 * 只讲了「list → get → claim → 干活 → complete」这套消费流程，**没有讲"派活前
 * 先建任务"**。于是 Lead 可能直接派活，子智能体去查任务板拿到空数组，那一次调用
 * 就白烧了，还可能据此推断出错误结论。默认开团队（本插件的功能）会放大这个缺口。
 *
 * 为什么默认关：它改变提示词前缀。走指纹敏感中转站（本工作区有 clean-route 就是
 * 为此存在）时，前缀变更需要用户自己评估，所以必须是显式开启、且能单独关掉。
 */
import { shouldInjectHint } from './state.js'

/** 这段提示词在系统提示里的名字（唯一，便于排查）。 */
export const SECTION_NAME = 'model-tuning:team-task-first'

/**
 * 提示词正文。写成英文是有意的：它紧邻上游的英文 `TEAM_POLICY`，与其同语言时不
 * 会被模型当成两套规则拼接。
 */
export const SECTION_TEXT = `Team board discipline: create the shared task with team_task_create BEFORE delegating work, and record the expected write scope on it. An empty board means the Lead has not created tasks yet — report that to the Lead and wait, instead of guessing at the work.`

/**
 * 装这段提示词。
 *
 * 它按「每次装配时读一次状态」的方式工作，所以插件页一开就对新的一次性装配生效，
 * 不需要重载插件；关掉后下一装配就消失（空字符串不占位）。
 *
 * @param deps.ctx 宿主 ctx
 * @param deps.store 状态存储
 * @param deps.logger 可选日志器
 * @returns 卸载函数
 */
export function installTaskFirstHint({ ctx, store, logger }) {
  const prompt = ctx.get?.('systemPrompt')
  if (prompt === undefined || typeof prompt.section !== 'function') {
    logger?.warn?.('model-tuning: 没有 systemPrompt 服务，团队任务先行提示不可用')
    return () => {}
  }
  const base = typeof prompt.getSectionOrder === 'function'
    ? (() => {
        try {
          return prompt.getSectionOrder('TEAM_POLICY')
        } catch {
          return 100
        }
      })()
    : 100
  const order = Number.isFinite(base) ? base + 1 : 100

  const dispose = prompt.section({
    name: SECTION_NAME,
    order,
    text: ({ agent }) => {
      const { state } = store.read()
      if (state.taskFirstHint !== true) return ''
      if (agent === undefined || agent === null) return ''
      let enabled = false
      try {
        const teams = ctx.get?.('agentTeams')
        enabled = teams !== undefined && typeof teams.isEnabled === 'function' && teams.isEnabled(agent) === true
      } catch {
        // 子代理会话或未授权情形：上游自己也把 UNAUTHORIZED 当成"没开"
        enabled = false
      }
      return shouldInjectHint({ taskFirstHint: state.taskFirstHint, enabled }) ? SECTION_TEXT : ''
    },
  })

  return () => {
    try {
      dispose?.()
    } catch {
      // 卸载期不再上抛
    }
  }
}
