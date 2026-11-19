import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Config, DEFAULTS, createConfigSchema } from '../lib/index.js'

test('配置导出不会让 dsh 设置页把 JSON Schema 当作 Schemastery', () => {
  // dsh-settings.schema() 用 toJSON 判断是否可遍历，随后直接读取节点 meta。
  if (!('toJSON' in Config)) return
  function inspect(node) {
    assert.ok(node.meta, '提供 toJSON 的配置必须具备 Schemastery meta')
    if (node.meta.volatile) return
    if (node.type === 'object') Object.values(node.dict ?? {}).forEach(inspect)
  }
  inspect(Config)
})

test('配置兼容修复保留原有默认值及归一化行为', () => {
  assert.deepEqual(Config['~standard'].validate({}), { value: DEFAULTS })
  const result = Config['~standard'].validate({ placement: 'unknown', maxPromptChars: 1 })
  assert.equal(result.value.placement, 'seat')
  assert.equal(result.value.maxPromptChars, 200)
})

test('缺少可选依赖时保留标准校验且不会误入宿主表单遍历', () => {
  const fallback = createConfigSchema(null)
  assert.equal('toJSON' in fallback, false)
  assert.deepEqual(fallback['~standard'].validate({}), { value: DEFAULTS })
  assert.equal(fallback['~standard'].jsonSchema.input().type, 'object')
})

test('原生配置能通过 Schemastery 的真实序列化与重建', async (t) => {
  let z
  try {
    z = (await import('@deepseek-ai/schemastery')).default
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    t.skip('独立源码未安装可选依赖；仍测试无依赖回退')
    return
  }
  assert.equal(Config.type, 'object')
  const restored = new z(JSON.parse(JSON.stringify(Config.toJSON())))
  assert.deepEqual(restored['~standard'].validate({}), { value: DEFAULTS })
  assert.deepEqual(Object.keys(restored.dict), Object.keys(DEFAULTS))
  assert.equal(restored.meta.volatile, undefined)
})
