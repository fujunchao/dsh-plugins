/**
 * 团队任务先行提示的装配测试：验"什么时候出现、什么时候是空字符串"。
 *
 * 它只影响提示词前缀，所以边界比正文重要：默认关、非团队会话不出现、
 * 子代理异常不把它带崩。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createStore, shouldInjectHint } from '../lib/state.js'
import { SECTION_NAME, SECTION_TEXT, installTaskFirstHint } from '../lib/task-first.js'

const tempStore = () => createStore(join(mkdtempSync(join(tmpdir(), 'model-tuning-task-first-')), 'state.json'))

function fakeCtx({ enabled, throwUnauthorized = false, sectionOrder = 42 } = {}) {
  const registered = []
  return {
    registered,
    get(name) {
      if (name === 'systemPrompt') {
        return {
          section(definition) {
            registered.push(definition)
            return () => {}
          },
          getSectionOrder(name) {
            assert.equal(name, 'TEAM_POLICY')
            return sectionOrder
          },
        }
      }
      if (name === 'agentTeams') {
        return {
          isEnabled() {
            if (throwUnauthorized) throw new Error('UNAUTHORIZED')
            return enabled
          },
        }
      }
      return undefined
    },
  }
}

const agent = { id: 's1' }

test('shouldInjectHint：两个条件都成立才注入', () => {
  assert.equal(shouldInjectHint({ taskFirstHint: true, enabled: true }), true)
  assert.equal(shouldInjectHint({ taskFirstHint: true, enabled: false }), false)
  assert.equal(shouldInjectHint({ taskFirstHint: false, enabled: true }), false)
  assert.equal(shouldInjectHint({ taskFirstHint: false, enabled: false }), false)
  // 非布尔输入按"没开"处理，不要因为 undefined 就注入
  assert.equal(shouldInjectHint({ taskFirstHint: undefined, enabled: undefined }), false)
})

test('默认关：注册了 section，但文本为空', () => {
  const store = tempStore()
  const ctx = fakeCtx({ enabled: true })
  installTaskFirstHint({ ctx, store })
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].name, SECTION_NAME)
  assert.equal(ctx.registered[0].order, 43, '排在 TEAM_POLICY 之后')
  assert.equal(ctx.registered[0].text({ agent }), '')
})

test('开启且团队模式开：给出正文', () => {
  const store = tempStore()
  store.update((state) => ({ ...state, taskFirstHint: true }))
  const ctx = fakeCtx({ enabled: true })
  installTaskFirstHint({ ctx, store })
  assert.equal(ctx.registered[0].text({ agent }), SECTION_TEXT)
})

test('开启但团队模式关：仍然为空（不能给非团队会话塞团队规则）', () => {
  const store = tempStore()
  store.update((state) => ({ ...state, taskFirstHint: true }))
  const ctx = fakeCtx({ enabled: false })
  installTaskFirstHint({ ctx, store })
  assert.equal(ctx.registered[0].text({ agent }), '')
})

test('agentTeams.isEnabled 抛错时按"没开"处理，不让装配崩', () => {
  const store = tempStore()
  store.update((state) => ({ ...state, taskFirstHint: true }))
  const ctx = fakeCtx({ enabled: true, throwUnauthorized: true })
  installTaskFirstHint({ ctx, store })
  assert.equal(ctx.registered[0].text({ agent }), '')
})

test('没有 agent（装配期）时为空', () => {
  const store = tempStore()
  store.update((state) => ({ ...state, taskFirstHint: true }))
  const ctx = fakeCtx({ enabled: true })
  installTaskFirstHint({ ctx, store })
  assert.equal(ctx.registered[0].text({}), '')
})

test('没有 systemPrompt 服务时安全降级', () => {
  const store = tempStore()
  const dispose = installTaskFirstHint({ ctx: { get: () => undefined }, store })
  assert.equal(typeof dispose, 'function')
  assert.equal(dispose(), undefined)
})
