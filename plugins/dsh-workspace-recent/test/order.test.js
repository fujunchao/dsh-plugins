/**
 * 排序核心的单测：全部是纯函数，不碰宿主。
 *
 * 重点覆盖三类东西：
 *   1. 口径（哪些会话投票、哪些不投）；
 *   2. 目标顺序（时间倒序 / 沉底 / 同值稳定）；
 *   3. 移动规划（能落地成目标顺序，且不多写盘）。
 *
 * 运行：`node --test`
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ORDER_DEFAULTS,
  longestCommonSubsequence,
  moveToFront,
  planMoves,
  sameOrder,
  sessionVote,
  targetOrder,
  workspaceRecency,
} from '../lib/order.js'

/** 造一个会话摘要。 */
function summary(sessionId, updatedAt, extra = {}) {
  return { sessionId, updatedAt, blank: false, ...extra }
}

/** 造一张摘要表。 */
function table(...items) {
  return new Map(items.map(item => [String(item.sessionId), item]))
}

/** 模拟宿主 insertBefore 的语义（删除后插到锚点之前；无锚点则追加）。 */
function applyMoves(currentOrder, moves) {
  const order = [...currentOrder]
  for (const move of moves) {
    const from = order.indexOf(move.id)
    if (from < 0) continue
    order.splice(from, 1)
    const at = move.beforeId === undefined ? order.length : order.indexOf(move.beforeId)
    order.splice(at < 0 ? order.length : at, 0, move.id)
  }
  return order
}

test('默认口径：排除子代理与归档，空白会话计入', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 1_800_000_000_000
  const archived = new Set(['s-archived'])

  assert.equal(sessionVote(summary('s-user', now), archived), now)
  assert.equal(sessionVote(summary('s-blank', now, { blank: true }), archived), now, '空白会话要计入')
  assert.equal(sessionVote(summary('s-sub', now, { origin: 'subagent' }), archived), undefined, '子代理不算')
  assert.equal(sessionVote(summary('s-archived', now - day), archived), undefined, '归档不算')
  assert.equal(sessionVote(undefined, archived), undefined, '摘要还没到时不当成 0')
  assert.equal(sessionVote(summary('s-bad', Number.NaN), archived), undefined, '坏时间不投票')
})

test('口径可关：把开关关掉后子代理与归档也投票', () => {
  const now = 1_800_000_000_000
  const archived = new Set(['s-archived'])
  const options = { excludeSubagent: false, excludeArchived: false }
  assert.equal(sessionVote(summary('s-sub', now, { origin: 'subagent' }), archived, options), now)
  assert.equal(sessionVote(summary('s-archived', now), archived, options), now)
  assert.deepEqual(ORDER_DEFAULTS, { excludeSubagent: true, excludeArchived: true })
})

test('工作区时间取参与会话的最大值', () => {
  const now = 1_800_000_000_000
  const archived = new Set(['s-old-archived'])
  const summaries = table(
    summary('s-a', now - 3000),
    summary('s-b', now),
    summary('s-sub', now + 5000, { origin: 'subagent' }),
    summary('s-old-archived', now + 9000),
  )
  const workspace = { id: 'w1', sessionIds: ['s-a', 's-b', 's-sub', 's-old-archived'] }
  assert.equal(workspaceRecency(workspace, summaries, archived), now)
  assert.equal(workspaceRecency({ id: 'w2', sessionIds: [] }, summaries, archived), undefined)
})

test('目标顺序：有工作的按时间倒序，没工作的沉底且保持原先后', () => {
  const now = 1_800_000_000_000
  const workspaces = [
    { id: 'w-old', sessionIds: ['s1'] },
    { id: 'w-never-a', sessionIds: ['s-missing'] },
    { id: 'w-new', sessionIds: ['s2'] },
    { id: 'w-mid', sessionIds: ['s3'] },
    { id: 'w-never-b', sessionIds: [] },
  ]
  const currentOrder = ['w-old', 'w-never-a', 'w-new', 'w-mid', 'w-never-b']
  const summaries = table(
    summary('s1', now - 7200_000),
    summary('s2', now),
    summary('s3', now - 600_000),
  )
  const target = targetOrder(workspaces, currentOrder, summaries, new Set())
  assert.deepEqual(target, ['w-new', 'w-mid', 'w-old', 'w-never-a', 'w-never-b'])
})

test('目标顺序：时间相同用当前先后决胜（稳定，不抖动）', () => {
  const now = 1_800_000_000_000
  const workspaces = [
    { id: 'w1', sessionIds: ['s1'] },
    { id: 'w2', sessionIds: ['s2'] },
    { id: 'w3', sessionIds: ['s3'] },
  ]
  const summaries = table(summary('s1', now), summary('s2', now), summary('s3', now))
  const currentOrder = ['w3', 'w1', 'w2']
  assert.deepEqual(targetOrder(workspaces, currentOrder, summaries, new Set()), ['w3', 'w1', 'w2'])
})

test('目标顺序：新工作区不在当前顺序里也不会炸（排到沉底组末尾）', () => {
  const workspaces = [{ id: 'w1', sessionIds: [] }, { id: 'w-new', sessionIds: [] }]
  assert.deepEqual(targetOrder(workspaces, ['w1'], new Map(), new Set()), ['w1', 'w-new'])
})

test('LCS：已排好时全部保留，顺序全反时只保留一项', () => {
  assert.deepEqual([...longestCommonSubsequence(['a', 'b', 'c'], ['a', 'b', 'c'])], ['a', 'b', 'c'])
  assert.equal(longestCommonSubsequence(['a', 'b', 'c'], ['c', 'b', 'a']).size, 1)
})

test('移动规划：已经就位时一个都不挪（零写盘）', () => {
  const order = ['a', 'b', 'c']
  assert.deepEqual(planMoves(order, ['a', 'b', 'c']), [])
})

test('移动规划：单次顶到首位只挪一次', () => {
  const order = ['a', 'b', 'c', 'd']
  const moves = planMoves(order, ['d', 'a', 'b', 'c'])
  assert.equal(moves.length, 1)
  assert.deepEqual(moves[0], { id: 'd', beforeId: 'a' })
  assert.deepEqual(applyMoves(order, moves), ['d', 'a', 'b', 'c'])
})

test('移动规划：落地结果一定等于目标顺序（多种排列）', () => {
  const cases = [
    [['a', 'b', 'c', 'd'], ['b', 'a', 'd', 'c']],
    [['a', 'b', 'c'], ['c', 'b', 'a']],
    [['a', 'b', 'c', 'd', 'e'], ['e', 'a', 'b', 'c', 'd']],
    [['e', 'd', 'c', 'b', 'a'], ['a', 'b', 'c', 'd', 'e']],
    [['a', 'b', 'c', 'd', 'e', 'f'], ['b', 'd', 'f', 'a', 'c', 'e']],
  ]
  for (const [current, target] of cases) {
    assert.deepEqual(applyMoves(current, planMoves(current, target)), target, `${current} -> ${target}`)
  }
})

test('移动规划：不做无用写盘（移动次数不超过需要移动的条目数）', () => {
  const current = ['a', 'b', 'c', 'd', 'e']
  const target = ['b', 'c', 'd', 'e', 'a'] // 只把 a 移到末尾
  const moves = planMoves(current, target)
  assert.equal(moves.length, 1)
  assert.deepEqual(applyMoves(current, moves), target)
})

test('移动规划：随机排列也能正确落地且次数有界', () => {
  // 固定种子的伪随机，保证可重复
  let seed = 42
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']
  for (let round = 0; round < 50; round += 1) {
    const current = [...ids].sort(() => random() - 0.5)
    const target = [...ids].sort(() => random() - 0.5)
    const moves = planMoves(current, target)
    assert.deepEqual(applyMoves(current, moves), target, `${current.join(',')} -> ${target.join(',')}`)
    assert.ok(moves.length <= target.length, '移动次数不可能超过条目数')
  }
})

test('实时置顶：已在首位返回 null，否则给出一次移动', () => {
  const order = ['a', 'b', 'c']
  assert.equal(moveToFront(order, 'a'), null)
  assert.deepEqual(moveToFront(order, 'c'), { id: 'c', beforeId: 'a' })
  assert.equal(moveToFront(order, 'missing'), null, '不认识的工作区不动')
})

test('sameOrder：长度或顺序不同都算不同', () => {
  assert.equal(sameOrder(['a', 'b'], ['a', 'b']), true)
  assert.equal(sameOrder(['a', 'b'], ['b', 'a']), false)
  assert.equal(sameOrder(['a'], ['a', 'b']), false)
})
