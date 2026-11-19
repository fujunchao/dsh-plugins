/**
 * 插件自有状态：~/.dsh/model-tuning.json
 *
 * 为什么不用 loader 配置、也不写 agent-default-model：
 *   - agent-default-model 会被任意一次会话内模型切换静默改写（见 ADR 0002），
 *     放那里等于「设了等于没设」；
 *   - loader 配置需要 Config schema，改动还会触发插件重挂；
 *   - 本工作区既有插件（clean-route / siyuan-notes）都用自己的 JSON 文件，形态一致。
 *
 * 写入用「临时文件 + rename」原子替换，权限 0600：状态文件可能记录 provider/model
 * 组合，不值得给别的用户读。
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** 状态文件格式版本；升级时按版本迁移。 */
export const STATE_VERSION = 1

/**
 * 状态文件路径（`~/.dsh/model-tuning.json`）。
 * 环境变量 `DSH_MODEL_TUNING_STATE` 可覆盖它——测试与多实例部署要用。
 */
export function stateFilePath() {
  const override = process.env.DSH_MODEL_TUNING_STATE
  if (typeof override === 'string' && override.length > 0) return override
  return join(homedir(), '.dsh', 'model-tuning.json')
}

/** 一份空状态：不设默认、团队默认关、档位保持开。 */
export function emptyState() {
  return {
    version: STATE_VERSION,
    defaults: null,
    teamDefaultEnabled: false,
    carryEffort: true,
    taskFirstHint: false,
    lastApply: null,
  }
}

/**
 * 把一组选择收敛成可存储的形状：provider/model 必须是非空字符串，
 * 档位为空串或缺失一律存成 `null`（= 跟随模型默认）。
 */
export function normalizeSelection(value) {
  if (value === null || typeof value !== 'object') return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return null
  const effort = value.reasoningEffort
  return {
    provider,
    model,
    reasoningEffort: typeof effort === 'string' && effort.length > 0 ? effort : null,
  }
}

/** 把任意输入收敛成一份合法状态：缺字段补默认，类型不对丢弃。 */
export function normalizeState(raw) {
  const base = emptyState()
  if (raw === null || typeof raw !== 'object') return base
  const lastApply = raw.lastApply
  return {
    version: STATE_VERSION,
    defaults: normalizeSelection(raw.defaults),
    teamDefaultEnabled: raw.teamDefaultEnabled === true,
    carryEffort: raw.carryEffort !== false,
    taskFirstHint: raw.taskFirstHint === true,
    lastApply: lastApply !== null && typeof lastApply === 'object'
      ? {
          at: typeof lastApply.at === 'string' ? lastApply.at : '',
          sessionId: typeof lastApply.sessionId === 'string' ? lastApply.sessionId : '',
          ok: lastApply.ok === true,
          error: typeof lastApply.error === 'string' ? lastApply.error : null,
        }
      : null,
  }
}

/**
 * 读状态。文件不存在是正常情况；文件损坏也不阻塞启动——用默认值并带回一条
 * warning，让它出现在插件页上，而不是只躺在日志里。
 */
export function readState(file = stateFilePath()) {
  try {
    return { state: normalizeState(JSON.parse(readFileSync(file, 'utf8'))), warning: null }
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { state: emptyState(), warning: null }
    }
    return {
      state: emptyState(),
      warning: `状态文件读取失败，已使用默认值：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** 原子写状态：先写临时文件再 rename，避免半个文件。 */
export function writeState(next, file = stateFilePath()) {
  const state = normalizeState(next)
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return state
}

/**
 * 带缓存的状态存储。外部不会改这个文件，所以读到内存即可；
 * `update` 走「读 — 改 — 写」，写成功后刷新缓存。
 */
export function createStore(file = stateFilePath()) {
  let cache = null
  return {
    path: file,
    read() {
      if (cache === null) cache = readState(file)
      return cache
    },
    /** @param {(state: object) => object} mutate */
    update(mutate) {
      const current = this.read()
      const next = writeState(mutate(structuredClone(current.state)), file)
      cache = { state: next, warning: null }
      return next
    },
    /** 只更新 lastApply，失败静默（诊断信息不值得打断会话创建）。 */
    reportApply(entry) {
      try {
        this.update((state) => ({ ...state, lastApply: entry }))
      } catch {
        // 状态文件写不进去时不影响主流程
      }
    },
  }
}

/**
 * 这段提示词该不该出现。
 *
 * 只认「用户显式开启」+「这个 agent 所在会话确实开了团队模式」两个条件同时成立：
 * 前者保证不偷偷改前缀，后者保证它只出现在真正有任务板的会话里。
 * @param input.taskFirstHint 插件页开关
 * @param input.enabled 该 agent 的团队模式是否开启
 */
export function shouldInjectHint({ taskFirstHint, enabled }) {
  return taskFirstHint === true && enabled === true
}
