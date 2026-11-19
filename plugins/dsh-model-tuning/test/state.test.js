import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  STATE_VERSION,
  createStore,
  emptyState,
  normalizeSelection,
  normalizeState,
  readState,
  writeState,
} from '../lib/state.js'

const tempFile = (name = 'model-tuning.json') => join(mkdtempSync(join(tmpdir(), 'model-tuning-')), name)

test('空状态：不设默认、团队关、档位保持开', () => {
  const state = emptyState()
  assert.equal(state.version, STATE_VERSION)
  assert.equal(state.defaults, null)
  assert.equal(state.teamDefaultEnabled, false)
  assert.equal(state.carryEffort, true)
})

test('选择收敛：空串与缺失的档位都落成 null', () => {
  assert.deepEqual(normalizeSelection({ provider: ' deepseek ', model: 'deepseek-v4-pro', reasoningEffort: '' }), {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    reasoningEffort: null,
  })
  assert.equal(normalizeSelection({ provider: '', model: 'x' }), null)
  assert.equal(normalizeSelection(null), null)
})

test('状态收敛：未知字段丢弃，类型不对回到默认', () => {
  const state = normalizeState({ teamDefaultEnabled: 'yes', carryEffort: false, defaults: { provider: 'a', model: 'b', reasoningEffort: 'max' }, junk: 1 })
  assert.equal(state.teamDefaultEnabled, false)
  assert.equal(state.carryEffort, false)
  assert.deepEqual(state.defaults, { provider: 'a', model: 'b', reasoningEffort: 'max' })
  assert.equal('junk' in state, false)
})

test('文件不存在 = 用默认值且没有 warning', () => {
  const { state, warning } = readState(tempFile('missing.json'))
  assert.deepEqual(state, emptyState())
  assert.equal(warning, null)
})

test('文件损坏 = 用默认值并带回 warning', () => {
  const file = tempFile()
  writeFileSync(file, '{ this is not json', 'utf8')
  const { state, warning } = readState(file)
  assert.deepEqual(state, emptyState())
  assert.match(warning, /状态文件读取失败/)
})

test('写入是原子的：先写临时文件再 rename，且权限 0600', () => {
  const file = tempFile()
  const written = writeState({ ...emptyState(), teamDefaultEnabled: true }, file)
  assert.equal(written.teamDefaultEnabled, true)
  const raw = readFileSync(file, 'utf8')
  assert.match(raw, /"teamDefaultEnabled": true/)
  assert.equal(raw.endsWith('\n'), true)
})

test('存储缓存：写后读到新值', () => {
  const file = tempFile()
  const store = createStore(file)
  assert.equal(store.read().state.teamDefaultEnabled, false)
  store.update((state) => ({ ...state, teamDefaultEnabled: true }))
  assert.equal(store.read().state.teamDefaultEnabled, true)
})

test('reportApply 不影响其它字段', () => {
  const file = tempFile()
  const store = createStore(file)
  store.update((state) => ({ ...state, defaults: { provider: 'p', model: 'm', reasoningEffort: null } }))
  store.reportApply({ at: '2026-01-01T00:00:00.000Z', sessionId: 's', ok: true, error: null })
  const { state } = store.read()
  assert.equal(state.defaults.model, 'm')
  assert.equal(state.lastApply.sessionId, 's')
})

test('taskFirstHint：默认关，显式 true 才保留', () => {
  assert.equal(emptyState().taskFirstHint, false)
  assert.equal(normalizeState({ taskFirstHint: true }).taskFirstHint, true)
  assert.equal(normalizeState({ taskFirstHint: 'yes' }).taskFirstHint, false)
})
