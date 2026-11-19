/**
 * dsh-model-tuning —— 模型调校
 *
 * 三件事：
 *   1. 每个模型的思考等级（含 Gemini 的 xhigh：托管 pi-ai 的 asar 补丁）；
 *   2. 新会话的默认模型与档位（`agent/created` 钩子，不写上游默认）；
 *   3. 新会话默认开启智能体团队（同一钩子，`agentTeams.setEnabled`）。
 * 外加一件修正：换模型时把上一档带过去（只在"上游自动重置"时出手）。
 *
 * 本插件不导出 Config：全部设置放在 `~/.dsh/model-tuning.json`，由插件页读写，
 * 避免 loader 配置与插件状态两套真源（也避免手写 plain schema 的坑）。
 */
import { createStore } from './state.js'
import { createTuner } from './tune.js'
import { createSnapshots, snapshotDir } from './snapshots.js'
import { installHooks } from './hooks.js'
import { installTaskFirstHint } from './task-first.js'
import { createRoutes, ROUTE_PREFIX } from './routes.js'

export const name = 'model-tuning'

/** 配置页挂在 webServer 上；其余服务（settings/llm/agentTeams）都是可选探测。 */
export const inject = ['webServer']

/** @param {import('@deepseek-ai/cordis').Context} ctx 宿主上下文 */
export function apply(ctx) {
  const logger = ctx.logger
  const store = createStore()
  const { warning } = store.read()
  if (warning !== null) logger?.warn?.(`model-tuning: ${warning}`)

  const tuner = createTuner(ctx, { snapshots: createSnapshots(snapshotDir()) })
  const routes = createRoutes({ ctx, store, tuner })

  ctx.effect(() => installHooks({ ctx, store, tuner, logger }), 'model-tuning: hooks')
  ctx.effect(() => installTaskFirstHint({ ctx, store, logger }), 'model-tuning: task-first hint')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (webServer === undefined || typeof webServer.register !== 'function') {
      logger?.warn?.('model-tuning: 没有可用的 webServer，配置页不可用')
      return () => {}
    }
    const dispose = webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: routes.handler })
    logger?.info?.(`model-tuning: 配置页已挂在 ${ROUTE_PREFIX}`)
    return () => {
      try {
        dispose?.()
      } catch {
        // 卸载期的错误不再上抛
      }
    }
  }, 'model-tuning: routes')
}
