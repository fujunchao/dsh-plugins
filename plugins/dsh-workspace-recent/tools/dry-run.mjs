/**
 * 只读预演：用磁盘上的真实数据算一遍"按最近工作排序"的结果，**不写任何东西**。
 *
 * 数据来源（全部只读）：
 *   ~/.dsh/storages/workspace.json                     工作区、持久顺序、归档集合
 *   ~/.dsh/storages/session_projcache/sessions/*.json   每个会话的 identity.createdAt + lastPromptAt
 *
 * 与插件里的算法完全一致（复用 lib/order.js），只是把宿主 API 换成了磁盘文件：
 *   updatedAt = max(createdAt, lastPromptAt)
 *   子代理会话：从父会话的 subagentCatalog / subagent 投影反推后排除
 *   归档会话：用归档集合排除
 *
 * 用法：node tools/dry-run.mjs [--limit 12]
 */

import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { planMoves, sameOrder, targetOrder, workspaceRecency } from '../lib/order.js'

const HOME = homedir()
const WORKSPACE_STORE = join(HOME, '.dsh', 'storages', 'workspace.json')
const CACHE_DIR = join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions')

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 12 : 12

/** 读 JSON 文件。 */
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** 从父会话的投影里收集子会话 id。 */
function collectChildren(record, children) {
  const catalog = record?.rows?.subagentCatalog?.val
  if (Array.isArray(catalog)) {
    for (const child of catalog) {
      if (child?.id) children.add(String(child.id))
      else if (typeof child === 'string') children.add(child)
    }
  }
  const subagent = record?.rows?.subagent?.val
  if (subagent && typeof subagent === 'object') {
    for (const [key, value] of Object.entries(subagent)) {
      if (value && typeof value === 'object' && value.parentSessionId) children.add(key)
    }
  }
}

/** 把一个时间戳格式成本地时间。 */
function formatTime(ms) {
  const date = new Date(ms)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function main() {
  const store = await readJson(WORKSPACE_STORE)
  const global = store.global ?? {}
  const table = store.tables?.workspaces ?? {}
  const archived = new Set((global.archivedSessionIds ?? []).map(String))

  const names = await readdir(CACHE_DIR)
  const files = names.filter(name => name.endsWith('.json'))
  const summaries = new Map()
  const children = new Set()

  for (const name of files) {
    const path = join(CACHE_DIR, name)
    const sessionId = name.slice(0, -'.json'.length)
    let payload
    try {
      payload = await readJson(path)
    } catch {
      continue
    }
    const record = payload?.record ?? payload
    collectChildren(record, children)
    const createdAt = record?.identity?.createdAt
    const lastPromptAt = record?.rows?.sessionListMetadata?.val?.lastPromptAt ?? undefined
    const blank = record?.rows?.sessionListMetadata?.val?.blank ?? false
    const updatedAt = Math.max(Number.isFinite(createdAt) ? createdAt : 0, Number.isFinite(lastPromptAt) ? lastPromptAt : 0)
    summaries.set(sessionId, {
      sessionId,
      updatedAt,
      blank,
      // 预演阶段先把所有子会话当子代理（正式插件用 header.origin 判断）
      origin: children.has(sessionId) ? 'subagent' : undefined,
      createdAt,
    })
  }

  // 子会话可能先于父会话被读到，这里再补一遍标记
  for (const [sessionId, item] of summaries) {
    if (children.has(sessionId)) item.origin = 'subagent'
  }

  const currentOrder = (global.workspaceIds ?? []).map(String)
  const workspaces = currentOrder.map((id) => {
    const row = table[id] ?? {}
    return {
      id,
      title: row.title ?? id,
      sessionIds: (row.sessionIds ?? []).map(String),
    }
  })

  const target = targetOrder(workspaces, currentOrder, summaries, archived)
  const moves = sameOrder(currentOrder, target) ? [] : planMoves(currentOrder, target)

  console.log(`数据：${files.length} 个会话缓存、${workspaces.length} 个工作区、归档 ${archived.size} 个会话、子代理 ${children.size} 个会话（反推，只少不多）`)
  console.log(`\n当前前 ${Math.min(5, currentOrder.length)} 名：`)
  currentOrder.slice(0, 5).forEach((id, index) => {
    const workspace = workspaces.find(item => item.id === id)
    const at = workspaceRecency(workspace, summaries, archived)
    console.log(`  ${String(index + 1).padStart(2)}. ${workspace?.title ?? id}${at === undefined ? '（无工作时间）' : `   ${formatTime(at)}`}`)
  })

  const byId = new Map(workspaces.map(item => [item.id, item]))
  const rows = target.map((id) => {
    const workspace = byId.get(id)
    const at = workspaceRecency(workspace, summaries, archived)
    return { title: workspace?.title ?? id, at, sessions: workspace?.sessionIds.length ?? 0 }
  })
  const worked = rows.filter(row => row.at !== undefined)
  const never = rows.filter(row => row.at === undefined)
  const width = worked.slice(0, LIMIT).reduce((max, row) => Math.max(max, [...row.title].length), 0)

  console.log(`\n排序后前 ${Math.min(LIMIT, worked.length)} 名（预计）：`)
  worked.slice(0, LIMIT).forEach((row, index) => {
    console.log(`  ${String(index + 1).padStart(2)}. ${row.title.padEnd(width, ' ')}  ${formatTime(row.at)}  (${row.sessions} 个会话)`)
  })
  if (never.length > 0) {
    console.log(`\n无工作时间（沉底 ${never.length} 个）：${never.map(row => row.title).join('、')}`)
  }
  console.log(`\n落盘计划：${moves.length} 次 insertBefore`)
  for (const move of moves.slice(0, 10)) {
    console.log(`  ${byId.get(move.id)?.title ?? move.id} → 挪到 ${move.beforeId === undefined ? '末尾' : (byId.get(move.beforeId)?.title ?? move.beforeId)} 之前`)
  }
  if (moves.length > 10) console.log(`  … 其余 ${moves.length - 10} 次从略`)
  console.log('\n（本次预演只读，没有写入任何文件）')
}

await main()
