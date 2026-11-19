/**
 * 纯排序核心：不引用任何宿主 API，全部可在 `node --test` 里直接跑。
 *
 * 术语与 CONTEXT.md 保持一致：
 *   - 工作区（workspace）：侧边栏里的一个项目分组条目。
 *   - 最近工作：工作区内"参与计算"的会话里最大的 `updatedAt`。
 *   - 持久顺序：宿主 registry 里的 `workspaceIds` 顺序，侧边栏按它渲染。
 *
 * 所有的取舍都集中在这一个文件里，插件壳（index.js）只负责取数据与落盘。
 *
 * @module dsh-workspace-recent/order
 */

/**
 * 排序口径的默认值。
 * @type {{ excludeSubagent: boolean, excludeArchived: boolean }}
 */
export const ORDER_DEFAULTS = Object.freeze({
  excludeSubagent: true,
  excludeArchived: true,
})

/**
 * 一个会话对"工作"的投票。
 *
 * 口径（2026-11-17 与用户逐条确认）：
 *   - 子代理会话不算：那是助手的工作，不是人的工作；
 *   - 归档会话不算：已经收尾，不该继续把项目顶在前面；
 *   - 空白会话算：新建但没发言的会话，其 `updatedAt` 就是创建时间，
 *     表示"我刚在这个项目开了张"。
 *
 * @param {object | undefined} summary 会话摘要（宿主 SessionSummary 的子集）
 * @param {Set<string>} archived 归档会话集合
 * @param {object} [options] 口径开关，缺省 {@link ORDER_DEFAULTS}
 * @returns {number | undefined} 投票时间；会话不参与时返回 undefined
 */
export function sessionVote(summary, archived, options = ORDER_DEFAULTS) {
  if (summary === undefined || summary === null) return undefined
  if (options.excludeSubagent !== false && summary.origin === 'subagent') return undefined
  if (options.excludeArchived !== false && archived.has(String(summary.sessionId))) return undefined
  return Number.isFinite(summary.updatedAt) ? summary.updatedAt : undefined
}

/**
 * 工作区的"最近工作"时间：参与会话里的最大值。
 *
 * @param {{ id: string, sessionIds: readonly string[] }} workspace 工作区视图
 * @param {Map<string, object>} summaries 会话摘要表（按 sessionId 索引）
 * @param {Set<string>} archived 归档会话集合
 * @param {object} [options] 口径开关
 * @returns {number | undefined} 没有任何参与会话时返回 undefined
 */
export function workspaceRecency(workspace, summaries, archived, options = ORDER_DEFAULTS) {
  let best
  for (const sessionId of workspace.sessionIds) {
    const vote = sessionVote(summaries.get(String(sessionId)), archived, options)
    if (vote === undefined) continue
    if (best === undefined || vote > best) best = vote
  }
  return best
}

/**
 * 计算目标顺序。
 *
 * 规则：
 *   1. 有工作时间的按时间倒序；
 *   2. 没有工作时间的沉到底部，并保持它们在当前顺序里的先后（不打乱你原来的摆放）；
 *   3. 时间相同时，用当前顺序的先后决胜——稳定排序，避免同值抖动。
 *
 * @param {readonly { id: string, sessionIds: readonly string[] }[]} workspaces 工作区列表（顺序无关）
 * @param {readonly string[]} currentOrder 当前持久顺序
 * @param {Map<string, object>} summaries 会话摘要表
 * @param {Set<string>} archived 归档会话集合
 * @param {object} [options] 口径开关
 * @returns {string[]} 目标顺序（包含 workspaces 里的每个 id 一次）
 */
export function targetOrder(workspaces, currentOrder, summaries, archived, options = ORDER_DEFAULTS) {
  const rank = new Map(currentOrder.map((id, index) => [String(id), index]))
  const rankOf = id => rank.get(id) ?? Number.MAX_SAFE_INTEGER
  const entries = workspaces.map(workspace => ({
    id: String(workspace.id),
    at: workspaceRecency(workspace, summaries, archived, options),
  }))
  const worked = entries
    .filter(entry => entry.at !== undefined)
    .sort((left, right) => (right.at - left.at) || (rankOf(left.id) - rankOf(right.id)))
  const never = entries
    .filter(entry => entry.at === undefined)
    .sort((left, right) => rankOf(left.id) - rankOf(right.id))
  return [...worked, ...never].map(entry => entry.id)
}

/**
 * 求两个序列的最长公共子序列（按 id 集合返回）。
 *
 * 只用于**减少写盘次数**：LCS 内的条目在原位不动，只有其余条目需要移动。
 *
 * @param {readonly string[]} left 当前顺序
 * @param {readonly string[]} right 目标顺序
 * @returns {Set<string>} 可以原地保留的 id 集合
 */
export function longestCommonSubsequence(left, right) {
  const a = left.map(String)
  const b = right.map(String)
  const rows = a.length
  const cols = b.length
  const table = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const keep = new Set()
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      keep.add(a[i])
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  return keep
}

/**
 * 把"当前顺序 → 目标顺序"翻译成最少的 `insertBefore` 调用。
 *
 * **返回值就是执行顺序**：从目标末尾往前处理，每一项都挪到它右边那一项之前
 * （最末一项给 `beforeId: undefined` = 追加）。这样每个 move 落地后都不会被
 * 后面的 move 覆盖，且 LCS 内的条目一次都不会被写。
 *
 * @param {readonly string[]} currentOrder 当前持久顺序
 * @param {readonly string[]} target 目标顺序
 * @returns {{ id: string, beforeId?: string }[]} 可直接交给 registry.insertBefore 的移动清单
 */
export function planMoves(currentOrder, target) {
  const keep = longestCommonSubsequence(currentOrder, target)
  const moves = []
  let anchorId
  for (let index = target.length - 1; index >= 0; index -= 1) {
    const id = String(target[index])
    if (!keep.has(id)) moves.push({ id, beforeId: anchorId })
    anchorId = id
  }
  return moves
}

/**
 * 实时场景：把某个工作区顶到首位需要的那一次移动。
 *
 * @param {readonly string[]} currentOrder 当前持久顺序
 * @param {string} id 要顶上去的工作区
 * @returns {{ id: string, beforeId: string } | null} 已经在首位（或不在列表里）时返回 null
 */
export function moveToFront(currentOrder, id) {
  const order = currentOrder.map(String)
  const target = String(id)
  if (!order.includes(target) || order[0] === target) return null
  return { id: target, beforeId: order[0] }
}

/**
 * 判断两份顺序是否一致（用于"零写入"的快速短路）。
 *
 * @param {readonly string[]} left 序列 A
 * @param {readonly string[]} right 序列 B
 * @returns {boolean} 长度与逐项都相同才为 true
 */
export function sameOrder(left, right) {
  if (left.length !== right.length) return false
  return left.every((id, index) => String(id) === String(right[index]))
}
