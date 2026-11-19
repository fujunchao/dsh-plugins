/**
 * 结构变更前的快照：`~/.dsh/model-tuning-backups/`。
 *
 * 为什么需要它：`settings.mutate` 的 revision 只防并发，不防「我删错了」。
 * 新建/删除供应商与模型是**结构变更**，错了没有 undo 就只能去翻
 * `cordis.patch.yml` 的 `.bak-*`。这里存一份刚变更前的 `providers` 子树，
 * 界面上一键恢复（ADR 0007）。
 *
 * 快照里只有凭据的**引用名**（`apiKeyEnv`），没有密钥本身——密钥在凭据服务里，
 * 从来不出现在这份配置里。
 *
 * 每份快照有两个子树：`providers` 是**写之前**的值（撤销点），`after` 是**写完之后**
 * 的值（撤销前复核用）。`after` 只能事后补：写前不可能知道写完之后是什么
 * （见 {@link createSnapshots} 的 `attachAfter`）。旧快照没有 `after` → 视为
 * 「无法复核」，撤销照常做（ADR 0009 第 6 条）。
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** 保留几份。10 份足够覆盖"我昨天手滑了"，也不至于把目录撑成垃圾场。 */
export const KEEP = 10

/** 快照目录；`DSH_MODEL_TUNING_BACKUPS` 可覆盖（测试用）。 */
export function snapshotDir() {
  const override = process.env.DSH_MODEL_TUNING_BACKUPS
  if (typeof override === 'string' && override.length > 0) return override
  return join(homedir(), '.dsh', 'model-tuning-backups')
}

/** 把标签折成安全的文件名片段。 */
function slug(label) {
  const text = String(label ?? 'snapshot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text.length === 0 ? 'snapshot' : text.slice(0, 40)
}

/** 目录里所有快照文件名，按时间（文件名前缀）升序。 */
function files(directory) {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}

/**
 * 造一个快照器。
 * @param directory 目录本身（省略则用 {@link snapshotDir}）
 * @param options.keep 保留份数
 */
export function createSnapshots(directory = snapshotDir(), options = {}) {
  const keep = Number.isInteger(options.keep) && options.keep > 0 ? options.keep : KEEP
  const ensure = () => {
    // 0700：里面是配置结构，没必要给别的账户看（Windows 上等价语义不完整，尽力而为）。
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  return {
    dir: directory,

    /**
     * 存一份。
     * @param providers 变更前的 `providers` 子树
     * @param label 这次变更是什么（`create-provider` 之类），只用来在界面上区分
     * @param after 已知的写后子树（一般给 null，写完再用 {@link attachAfter} 补）
     * @returns `{ path, at }`
     */
    capture(providers, label, after = null) {
      const at = new Date()
      const stamp = String(at.getTime()).padStart(13, '0')
      const base = `${stamp}-${slug(label)}`
      ensure()
      // 同一毫秒里连着两次结构变更会撞名：撞到就加序号，别让后一份覆盖前一份。
      let name = `${base}.json`
      for (let index = 1; existsSync(join(directory, name)); index += 1) {
        name = `${base}-${index}.json`
      }
      const path = join(directory, name)
      // after 先留空：写完才可能知道"写完之后的值"，由 attachAfter 补进来。
      const body = `${JSON.stringify({
        at: at.toISOString(),
        label: String(label ?? ''),
        providers,
        after: after !== null && typeof after === 'object' ? after : null,
      }, null, 2)}\n`
      const temp = `${path}.${process.pid}.tmp`
      try {
        writeFileSync(temp, body, { mode: 0o600 })
        renameSync(temp, path)
      } catch (error) {
        rmSync(temp, { force: true })
        throw error
      }
      this.prune()
      return { path, at: at.toISOString() }
    },

    /**
     * 把「写完之后的值」补进一份已经落盘的快照。
     *
     * 为什么要事后补：写前 `capture` 拿不到写后状态；写下之后再 `capture` 一份又会把
     * 撤销点挪成"写完的那一刻"，撤销就变成空操作。补写同一份文件两头都对。
     *
     * 补写失败不是错误：没有 `after` 的快照只是"无法复核"，仍然可以撤销。
     * 只接受**本目录里**的快照路径，避免拿任意路径去改写（路径只来自 capture）。
     *
     * @param path `capture` 返回的路径
     * @param after 写完之后生效的 `providers` 子树
     * @returns 补写成功为 true；文件不在／不是本目录的快照则为 false
     */
    attachAfter(path, after) {
      if (typeof path !== 'string' || path.length === 0) return false
      if (resolve(dirname(path)) !== resolve(directory)) return false
      let parsed
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        return false
      }
      if (parsed === null || typeof parsed !== 'object') return false
      parsed.after = after !== null && typeof after === 'object' ? after : {}
      const temp = `${path}.${process.pid}.after.tmp`
      try {
        writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
        renameSync(temp, path)
        return true
      } catch {
        rmSync(temp, { force: true })
        return false
      }
    },

    /** 只留最新 N 份。删不掉不是错误：磁盘上多几份旧快照不影响正确性。 */
    prune() {
      const list = files(directory)
      const extra = list.length - keep
      if (extra <= 0) return 0
      let removed = 0
      for (const name of list.slice(0, extra)) {
        try {
          rmSync(join(directory, name), { force: true })
          removed += 1
        } catch {
          // 忽略
        }
      }
      return removed
    },

    /** 元信息列表，新的在前。损坏的文件跳过。 */
    list() {
      const out = []
      for (const name of files(directory).reverse()) {
        try {
          const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8'))
          out.push({
            name,
            at: typeof parsed.at === 'string' ? parsed.at : name.slice(0, 13),
            label: typeof parsed.label === 'string' ? parsed.label : '',
          })
        } catch {
          // 坏文件跳过：它已经不可能是可用的回滚点了
        }
      }
      return out
    },

    /**
     * 最新一份的完整内容（含 providers 与 after）；没有可用快照时返回 null。
     * `after` 缺失（旧文件／写入失败／补写失败）时为 `null`，调用方据此跳过复核。
     */
    latest() {
      for (const name of files(directory).reverse()) {
        try {
          const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8'))
          if (parsed.providers !== null && typeof parsed.providers === 'object') {
            return {
              name,
              at: typeof parsed.at === 'string' ? parsed.at : '',
              label: typeof parsed.label === 'string' ? parsed.label : '',
              providers: parsed.providers,
              after: parsed.after !== null && typeof parsed.after === 'object' ? parsed.after : null,
            }
          }
        } catch {
          // 继续往前找
        }
      }
      return null
    },
  }
}
