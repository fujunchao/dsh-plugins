/**
 * `lib/snapshots.js` 的单测。
 *
 * 这个模块的失败模式很讨厌：它只在"用户删错了"那一刻才被用到，所以
 * 「能存、能找回、不会无限堆积」这三件事必须在平时就证明。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { KEEP, createSnapshots } from '../lib/snapshots.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'model-tuning-snapshots-'))

test('capture 落盘 → latest 能原样取回', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir)
  const providers = { cli: { api: 'anthropic-messages', models: [{ id: 'glm-5.3' }] } }
  const captured = snapshots.capture(providers, 'create-provider')

  assert.equal(existsSync(captured.path), true)
  const parsed = JSON.parse(readFileSync(captured.path, 'utf8'))
  assert.equal(parsed.label, 'create-provider')
  assert.match(parsed.at, /^\d{4}-\d{2}-\d{2}T/)

  const latest = snapshots.latest()
  assert.deepEqual(latest.providers, providers)
  assert.equal(latest.label, 'create-provider')
})

test('同一个标签连着存两份不会互相覆盖（文件名撞车要加序号）', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir)
  snapshots.capture({ a: { api: 'openai-completions' } }, 'add-model')
  snapshots.capture({ b: { api: 'openai-completions' } }, 'add-model')
  assert.equal(readdirSync(dir).filter((name) => name.endsWith('.json')).length, 2)
  assert.deepEqual(snapshots.latest().providers, { b: { api: 'openai-completions' } })
})

test('同一毫秒里的快照按捕获顺序排，不按标签字母序（latest 必须是最新那次）', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir)
  const RealDate = Date
  const frozen = 1795081690123
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [frozen] : args))
    }

    static now() {
      return frozen
    }
  }
  globalThis.Date = FrozenDate
  try {
    snapshots.capture({ 'relay-x': { api: 'openai-completions', models: [{ id: 'gpt-x' }] } }, 'remove-model')
    snapshots.capture({}, 'delete-provider')
  } finally {
    globalThis.Date = RealDate
  }
  // 字母序会把它排反：delete-provider < remove-model。
  assert.equal(snapshots.latest().label, 'delete-provider')
  assert.deepEqual(snapshots.latest().providers, {})
  assert.deepEqual(snapshots.list().map((entry) => entry.label), ['delete-provider', 'remove-model'])
})

test('list 新的在前，且能带出时间与标签', () => {  const dir = tmp()
  const snapshots = createSnapshots(dir)
  snapshots.capture({ a: {} }, 'first')
  snapshots.capture({ b: {} }, 'second')
  const list = snapshots.list()
  assert.equal(list.length, 2)
  assert.equal(list[0].label, 'second')
  assert.equal(list[1].label, 'first')
  assert.equal(typeof list[0].at, 'string')
})

test('超过保留份数时删最旧的，不留垃圾场', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir, { keep: 2 })
  for (let index = 0; index < 5; index += 1) snapshots.capture({ [`r${index}`]: {} }, `step-${index}`)
  const list = snapshots.list()
  assert.equal(list.length, 2)
  assert.equal(list[0].label, 'step-4', '最新的还在')
  assert.equal(list[1].label, 'step-3')
})

test('坏文件不影响回滚点：latest 会继续往前找', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir)
  snapshots.capture({ good: {} }, 'good')
  writeFileSync(join(dir, '9999999999999-broken.json'), '{ not json')
  const latest = snapshots.latest()
  assert.deepEqual(latest.providers, { good: {} })
  assert.equal(latest.label, 'good')
})

test('capture 落盘就有 after 键（先为空），attachAfter 能把写后子树补进去', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir)
  const before = { cli: { api: 'anthropic-messages' } }
  const after = { cli: { api: 'anthropic-messages', displayName: 'GLM 中转' } }
  const captured = snapshots.capture(before, 'edit-provider')
  assert.equal(JSON.parse(readFileSync(captured.path, 'utf8')).after, null, '写前不可能知道写完之后是什么')
  assert.equal(snapshots.latest().after, null)

  assert.equal(snapshots.attachAfter(captured.path, after), true)
  const latest = snapshots.latest()
  assert.deepEqual(latest.after, after, '写后子树用来复核"有没有被别人又改过"')
  assert.deepEqual(latest.providers, before, '撤销点仍然是写前的值')
  assert.equal(latest.label, 'edit-provider')
})

test('attachAfter：文件不在／不是本目录的快照就安静返回 false，不抛', () => {
  const dir = tmp()
  const snapshots = createSnapshots(dir)
  assert.equal(snapshots.attachAfter(join(dir, 'nope.json'), { a: {} }), false)
  assert.equal(snapshots.attachAfter(join(tmp(), '1700000000000-x.json'), { a: {} }), false)
  assert.equal(snapshots.attachAfter(undefined, { a: {} }), false)
})

test('旧快照没有 after 字段：latest 给 null（= 无法复核，不阻断撤销）', () => {
  const dir = tmp()
  writeFileSync(
    join(dir, '1700000000000-legacy.json'),
    JSON.stringify({ at: '2023-11-14T22:13:20.000Z', label: 'legacy', providers: { a: { api: 'openai-completions' } } }),
  )
  const latest = createSnapshots(dir).latest()
  assert.deepEqual(latest.providers, { a: { api: 'openai-completions' } })
  assert.equal(latest.after, null)
})

test('空目录：latest 返回 null，list 返回空数组', () => {
  const snapshots = createSnapshots(tmp())
  assert.equal(snapshots.latest(), null)
  assert.deepEqual(snapshots.list(), [])
  assert.equal(KEEP, 10)
})

test('目录不存在时也会被建出来', () => {
  const dir = join(tmp(), 'nested', 'backups')
  const snapshots = createSnapshots(dir)
  snapshots.capture({ a: {} }, 'create')
  assert.equal(existsSync(dir), true)
})
