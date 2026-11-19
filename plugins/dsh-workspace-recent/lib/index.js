/**
 * dsh-workspace-recent — Host 半。
 *
 * 让侧边栏的项目（工作区）按"最近工作"排序：最近发过消息的项目自己浮到最上面，
 * 不用再一个个翻。**不改写任何 UI**——侧边栏的分组顺序本来就来自宿主持久顺序
 * （`workspace.json` 的 `workspaceIds`），这里只负责把它排好，浏览器侧收到
 * `domain/changed` 推送的 follow 帧后自动重排（与拖拽排序走同一条路）。
 *
 * 触发点：
 *   1. 插件加载后延时一次（把历史数据算一遍，覆盖"上次关掉时还没排序"的情况）；
 *   2. `api-session/activity`（用户真的发了一条消息）→ 该项目顶到首位；
 *   3. `api-session/added`（空白新会话出现）→ 该项目顶到首位；
 *   4. 设置页改了插件配置 → 重新排一次；
 *   5. 斜杠命令 `/sort-projects` → 立即整理一次并回报结果。
 *
 * 口径（2026-11-17 与用户逐条确认，详见 CONTEXT.md 与 ADR 0001）：
 *   会话时间 = `max(创建时间, 最后一次用户消息时间)`（= 侧边栏「最近更新」用的同一把尺子）；
 *   项目时间 = 其参与会话的最大值；
 *   子代理会话、归档会话不参与；空白新会话参与。
 *
 * @module dsh-workspace-recent
 */

import { moveToFront, planMoves, sameOrder, targetOrder, workspaceRecency } from './order.js'

/**
 * Cordis entry name（必须与 cordis.patch.yml 里的行 id 一致）。
 * @type {string}
 */
export const name = 'workspace-recent'

/**
 * 硬依赖：要读工作区与会话、要注册斜杠命令。
 * @type {string[]}
 */
export const inject = ['workspaceRegistry', 'sessionController', 'commands']

/**
 * 斜杠命令名（不带斜杠）。
 * @type {string}
 */
export const COMMAND_NAME = 'sort-projects'

/**
 * 插件加载后延时多久跑第一次排序（毫秒）。
 * 留出一点时间给客户端自己的首屏会话列表请求，避免抢 IO。
 * @type {number}
 */
export const BOOT_SORT_DELAY_MS = 1500

/**
 * 命令输出里最多列几个项目。
 * @type {number}
 */
export const COMMAND_LIST_LIMIT = 12

/** 配置默认值。 */
export const DEFAULTS = Object.freeze({ mode: 'recent' })

/** 两种模式。 */
const MODES = new Set(['recent', 'manual'])

/**
 * Config 用 Schemastery 声明（设置页据此渲染表单）。
 * `volatile()`：改完立即生效、不重载插件。
 * 依赖不可用时导出 undefined，配置仍可从 profile patch 原样传入。
 */
let z
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = undefined
}

export const Config = z === undefined
  ? undefined
  : z.object({
    mode: z.union([z.const('recent'), z.const('manual')])
      .default('recent')
      .volatile()
      .description('recent=按最近工作自动排序；manual=完全不碰顺序，拖拽是唯一真相'),
  }).description('按最近工作顺序整理侧边栏项目（工作区）')

/** 把任意错误压成一行文本。 */
function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 读归档会话集合：优先用 registry 上现成的属性，退路是 storage 域。 */
function archivedSessionIds(ctx) {
  const registry = ctx.workspaceRegistry
  const direct = registry?.archivedSessionIds
  if (Array.isArray(direct)) return new Set(direct.map(String))
  try {
    const state = ctx.get('storageDomain')?.get('workspace')?.global?.get()
    const list = state?.archivedSessionIds
    return new Set(Array.isArray(list) ? list.map(String) : [])
  } catch {
    return new Set()
  }
}

/** 把宿主的 Workspace 实体投影成纯数据（只留排序用得到的字段）。 */
function projectWorkspace(workspace) {
  return {
    id: String(workspace.id),
    title: workspace.title,
    sessionIds: (workspace.sessionIds ?? []).map(String),
  }
}

/** 读一份完整快照：工作区视图、当前持久顺序、会话摘要、归档集合。 */
async function snapshot(ctx) {
  const workspaces = (ctx.workspaceRegistry.list() ?? []).map(projectWorkspace)
  const currentOrder = workspaces.map(workspace => workspace.id)
  const list = await ctx.sessionController.list({})
  const summaries = new Map()
  for (const item of list?.items ?? []) summaries.set(String(item.sessionId), item)
  return {
    workspaces,
    currentOrder,
    summaries,
    archived: archivedSessionIds(ctx),
  }
}

/** 按计划逐条落盘；每条 `insertBefore` 自带幂等短路（顺序没变就不写）。 */
async function applyMoves(ctx, moves) {
  for (const move of moves) {
    await ctx.workspaceRegistry.insertBefore(move.id, move.beforeId)
  }
}

/** 排一次：算目标顺序 → 规划最少移动 → 落盘。 */
async function sortOnce(ctx) {
  const { workspaces, currentOrder, summaries, archived } = await snapshot(ctx)
  const target = targetOrder(workspaces, currentOrder, summaries, archived)
  const moves = sameOrder(currentOrder, target) ? [] : planMoves(currentOrder, target)
  await applyMoves(ctx, moves)
  return { workspaces, currentOrder, summaries, archived, target, moves }
}

/** 把一个时间戳格式成本地时间。 */
function formatTime(ms) {
  const date = new Date(ms)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 把一个时间戳格式成"多久以前"。 */
function formatAgo(ms, now = Date.now()) {
  const delta = Math.max(0, now - ms)
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 命令输出：前 N 个项目带时间，沉底项目单列一行。 */
function describeSort(result) {
  const { workspaces, summaries, archived, moves } = result
  const byId = new Map(workspaces.map(workspace => [workspace.id, workspace]))
  const order = result.target
  const worked = []
  const never = []
  for (const id of order) {
    const workspace = byId.get(id)
    const at = workspaceRecency(workspace, summaries, archived)
    if (at === undefined) never.push(workspace.title ?? id)
    else worked.push({ title: workspace.title ?? id, at })
  }
  const shown = worked.slice(0, COMMAND_LIST_LIMIT)
  const width = shown.reduce((max, row) => Math.max(max, [...row.title].length), 0)
  const lines = [`按最近工作整理完成：${order.length} 个项目，移动 ${moves.length} 个。`]
  shown.forEach((row, index) => {
    const label = row.title.padEnd(width, ' ')
    lines.push(`${String(index + 1).padStart(2, ' ')}. ${label}  ${formatTime(row.at)}（${formatAgo(row.at)}）`)
  })
  if (worked.length > shown.length) lines.push(`… 其余 ${worked.length - shown.length} 个从略`)
  if (never.length > 0) lines.push(`无工作时间（沉底 ${never.length} 个）：${never.join('、')}`)
  return lines.join('\n')
}

/**
 * 注册插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文
 * @param {{ mode?: string } | undefined} config 行配置
 */
export function apply(ctx, config) {
  const readMode = () => (MODES.has(config?.mode) ? config.mode : DEFAULTS.mode)

  // 一条串行链：启动排序、实时置顶、命令、设置变更互不打架。
  let chain = Promise.resolve()
  const run = (task) => {
    const next = chain.then(task)
    chain = next.then(() => {}, () => {})
    return next
  }
  const runQuietly = (task) => {
    void run(task).catch((error) => {
      ctx.logger?.warn?.(`[workspace-recent] ${describeError(error)}`)
    })
  }

  // 1) 启动排序：延后一点，别和首屏列表抢 IO。
  ctx.effect(() => {
    let disposed = false
    const timer = setTimeout(() => {
      if (disposed || readMode() === 'manual') return
      runQuietly(() => sortOnce(ctx))
    }, BOOT_SORT_DELAY_MS)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  })

  // 2) 实时：用户真的发了一条消息 → 该项目顶到首位（已在首位则零写入）。
  ctx.on('api-session/activity', (sessionId) => {
    if (readMode() === 'manual') return
    runQuietly(async () => {
      const workspaces = (ctx.workspaceRegistry.list() ?? []).map(projectWorkspace)
      const order = workspaces.map(workspace => workspace.id)
      const owner = workspaces.find(workspace => workspace.sessionIds.includes(String(sessionId)))
      if (owner === undefined) return
      const move = moveToFront(order, owner.id)
      if (move === null) return
      await ctx.workspaceRegistry.insertBefore(move.id, move.beforeId)
    })
  })

  // 3) 实时：空白新会话出现 → 也算"刚在这个项目开工"。
  ctx.on('api-session/added', (summary) => {
    if (readMode() === 'manual') return
    if (summary?.blank !== true) return
    if (archivedSessionIds(ctx).has(String(summary.sessionId))) return
    runQuietly(async () => {
      const workspaces = (ctx.workspaceRegistry.list() ?? []).map(projectWorkspace)
      const order = workspaces.map(workspace => workspace.id)
      const owner = workspaces.find(workspace => workspace.sessionIds.includes(String(summary.sessionId)))
      if (owner === undefined) return
      const move = moveToFront(order, owner.id)
      if (move === null) return
      await ctx.workspaceRegistry.insertBefore(move.id, move.beforeId)
    })
  })

  // 4) 设置页改了配置（例如从手动切回自动）→ 重新排一次；排序本身幂等，不会瞎写盘。
  ctx.on('settings/document-updated', () => {
    if (readMode() === 'manual') return
    runQuietly(() => sortOnce(ctx))
  })

  // 5) 手动入口：斜杠命令立即整理一次并回报结果。
  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: '按最近工作顺序立即整理侧边栏项目（工作区）',
    handler: async () => {
      try {
        const result = await run(() => sortOnce(ctx))
        return { kind: 'success', text: describeSort(result) }
      } catch (error) {
        return { kind: 'error', text: `整理失败：${describeError(error)}` }
      }
    },
  }))
}
