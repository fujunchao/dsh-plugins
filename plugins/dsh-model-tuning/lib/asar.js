/**
 * 最小 asar 读写：读条目、原位替换一个条目（含偏移重基与头部重建）。
 *
 * 为什么自己写：宿主把依赖打进 app.asar（归档形态），Electron 的 fs 能读不能写；
 * 打补丁必须在宿主关闭时对归档做「替换条目 → 重排偏移 → 重建头部 → self-swap」。
 * 算法与实现移植自 dsh-clean-route/lib/asar.js（那里沿自已实战验证的
 * reapply-xhigh-patch.cjs），本插件只换了备份/暂存文件名与错误码，行为保持一致。
 *
 * 三种形态都支持：
 *  - "archive"   普通 Node 里看到的 app.asar 文件；
 *  - "mounted"   Electron 宿主里被挂载的 asar（读得到、写不了，statSync 会谎报目录）；
 *  - "directory" 真正解开的安装目录（直接读写普通文件）。
 *
 * 错误码（调用方据此区分「条目不存在」与「读失败」）：
 *  - ASAR_MISSING        归档/安装目录不存在
 *  - ASAR_ENTRY_MISSING  归档里没有这个条目（多半是上游改了目录结构）
 *  - ASAR_MOUNTED        宿主正把 app.asar 挂载在进程里，只能读不能写
 *
 * @module dsh-model-tuning/asar
 */
import {
  closeSync,
  copyFileSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

/** 暂存文件后缀：写新归档时先落到这里，成功后再改名覆盖。 */
const STAGING_SUFFIX = '.model-tuning-new'

/** 备份文件后缀：`<路径>.bak-model-tuning-<时间戳>`。 */
export const BACKUP_PREFIX = '.bak-model-tuning-'

/** 归档内路径统一成 / 分隔。 */
export function normalizeEntry(path) {
  return path.split('\\').join('/')
}

/** 时间戳后缀，用于备份文件名（ISO 里的 `:`/`.` 换成 `-`，名字可直接排序）。 */
export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** 「归档/安装目录不存在」错误。 */
function archiveMissing(archivePath) {
  const error = new Error('宿主目录不存在：' + archivePath)
  error.code = 'ASAR_MISSING'
  return error
}

/** 「归档里没有这个条目」错误。 */
function entryMissing(entryPath) {
  const error = new Error('归档里没有这个条目：' + entryPath)
  error.code = 'ASAR_ENTRY_MISSING'
  return error
}

/**
 * 判断路径形态：
 *  - "archive"：普通 Node 里看到的 app.asar 文件；
 *  - "mounted"：Electron 宿主里被挂载的 asar（读得到、写不了，`statSync` 会谎报目录）；
 *  - "directory"：真正解开的安装目录；
 *  - "missing"：不存在。
 */
export function archiveForm(archivePath, options = {}) {
  const electron = options.electron ?? typeof process.versions.electron === 'string'
  let stat
  try {
    stat = statSync(archivePath)
  } catch {
    return 'missing'
  }
  const looksLikeArchive = /\.asar$/i.test(archivePath) || archivePath.includes('.asar/') || archivePath.includes('.asar\\')
  if (!stat.isDirectory()) return 'archive'
  // Electron 里 .asar 永远是挂载点；纯 Node 里同名目录更可能是真的解开了。
  if (electron && looksLikeArchive) return 'mounted'
  return 'directory'
}

/** 读归档头部：返回文件描述符、header、数据区起点与归档大小。用完必须 closeHeader。 */
export function readHeader(archivePath) {
  const fd = openSync(archivePath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    readSync(fd, json, 0, jsonLength, 16)
    return {
      fd,
      header: JSON.parse(json.toString('utf8')),
      dataStart: 16 + Math.ceil(jsonLength / 4) * 4,
      size: fstatSync(fd).size,
      jsonLength,
    }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

/** 关掉 readHeader 打开的文件描述符（可重复调用）。 */
export function closeHeader(handle) {
  if (handle === null || handle === undefined) return
  if (handle.fd === null || handle.fd === undefined) return
  const fd = handle.fd
  handle.fd = null
  closeSync(fd)
}

/** 深度优先遍历头部，产出 `{ path, node }`（node 带 offset/size 或 unpacked）。 */
export function walkFiles(header) {
  const out = []
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node.files ?? {})) {
      const path = prefix === '' ? key : prefix + '/' + key
      if (value.files !== undefined) walk(value, path)
      else out.push({ path: normalizeEntry(path), node: value })
    }
  }
  walk(header, '')
  return out
}

/** 读取一个条目的字节。 */
export function readEntry(handle, entry) {
  const buffer = Buffer.alloc(entry.node.size)
  readSync(handle.fd, buffer, 0, entry.node.size, handle.dataStart + Number(entry.node.offset))
  return buffer
}

/** 目录/挂载形态下的普通文件读取；缺文件统一翻成 ASAR_ENTRY_MISSING。 */
function readFileText(base, target) {
  // 用 `/` 拼：Electron 挂载态下 asar 内的路径两种分隔符都认，与 clean-route 保持一致。
  const file = base + '/' + target
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR')) {
      throw entryMissing(target)
    }
    throw error
  }
}

/**
 * 一次读若干条目（归档形态只解析一次头部）。
 *
 * @param {string} archivePath app.asar（或解开的目录）
 * @param {string[]} entryPaths 归档内路径（/ 分隔）
 * @param {{ onMissing?: 'throw' | 'skip' }} [options] 缺条目时抛错还是跳过（默认抛错）
 * @returns {Record<string, string>} 路径 → 文本（skip 模式下只含存在的条目）
 */
function readTextsImpl(archivePath, entryPaths, { onMissing = 'throw' } = {}) {
  const form = archiveForm(archivePath)
  if (form === 'missing') throw archiveMissing(archivePath)
  const targets = entryPaths.map(normalizeEntry)
  const out = {}
  if (form === 'directory' || form === 'mounted') {
    for (const target of targets) {
      try {
        out[target] = readFileText(archivePath, target)
      } catch (error) {
        if (onMissing === 'throw' || error?.code !== 'ASAR_ENTRY_MISSING') throw error
      }
    }
    return out
  }
  const handle = readHeader(archivePath)
  try {
    const index = new Map(walkFiles(handle.header).map((entry) => [entry.path, entry]))
    for (const target of targets) {
      const entry = index.get(target)
      if (entry === undefined) {
        if (onMissing === 'throw') throw entryMissing(target)
        continue
      }
      out[target] = readEntry(handle, entry).toString('utf8')
    }
    return out
  } finally {
    closeHeader(handle)
  }
}

/**
 * 读若干条目的文本；任一缺失即抛 ASAR_ENTRY_MISSING。
 *
 * @param {string} archivePath app.asar（或解开的目录）
 * @param {string[]} entryPaths 归档内路径（/ 分隔）
 * @returns {Record<string, string>} 路径 → 文本
 */
export function readTexts(archivePath, entryPaths) {
  return readTextsImpl(archivePath, entryPaths, { onMissing: 'throw' })
}

/**
 * 读若干条目的文本，缺失的条目直接略过（状态查询用：目标条目缺席也是一种可报告的状态）。
 *
 * @param {string} archivePath app.asar（或解开的目录）
 * @param {string[]} entryPaths 归档内路径（/ 分隔）
 * @returns {Record<string, string>} 路径 → 文本（只含存在的条目）
 */
export function readTextsIfPresent(archivePath, entryPaths) {
  return readTextsImpl(archivePath, entryPaths, { onMissing: 'skip' })
}

/** 读归档（或解开的目录）里的一个文本文件。 */
export function readText(archivePath, entryPath) {
  const target = normalizeEntry(entryPath)
  return readTexts(archivePath, [target])[target]
}

/**
 * 替换一个条目的文本。
 *
 * 目录形态：备份后直接写文件。
 * 归档形态：按条目新旧长度重排后续偏移、重建头部、流式写出新归档，最后 self-swap。
 *
 * @param {string} archivePath app.asar（或解开的目录）
 * @param {string} entryPath 归档内路径（/ 分隔）
 * @param {string} nextText 新内容
 * @param {{ backup?: boolean, electron?: boolean, dryRun?: boolean }} [options]
 *   backup 是否留一份备份（默认 true）；dryRun 只计算 delta，不写任何文件。
 */
export function replaceEntryText(archivePath, entryPath, nextText, { backup = true, electron, dryRun = false } = {}) {
  const form = archiveForm(archivePath, electron === undefined ? undefined : { electron })
  if (form === 'missing') throw archiveMissing(archivePath)
  if (form === 'mounted') {
    const error = new Error('宿主正在运行：app.asar 处于挂载状态，只能读不能写')
    error.code = 'ASAR_MOUNTED'
    throw error
  }
  const targetPath = normalizeEntry(entryPath)

  if (form === 'directory') {
    const file = join(archivePath, targetPath)
    const original = readFileSync(file, 'utf8')
    const delta = Buffer.byteLength(nextText) - Buffer.byteLength(original)
    if (dryRun) return { changed: false, dryRun: true, form, path: file, backup: null, delta }
    const backupPath = backup ? file + BACKUP_PREFIX + stamp() : null
    if (backupPath !== null) copyFileSync(file, backupPath)
    writeFileSync(file, nextText, 'utf8')
    return { changed: true, dryRun: false, form, path: file, backup: backupPath, delta }
  }

  const handle = readHeader(archivePath)
  const entries = walkFiles(handle.header)
  const target = entries.find((entry) => entry.path === targetPath)
  if (target === undefined) {
    closeHeader(handle)
    throw entryMissing(targetPath)
  }
  let result
  try {
    result = rewriteArchive(handle, entries, target, nextText, { archivePath, backup, dryRun })
  } finally {
    closeHeader(handle)
  }
  return result
}

/** 归档形态的替换主体：重排偏移 → 重建头部 → 落暂存文件 → self-swap。 */
function rewriteArchive(handle, entries, target, nextText, { archivePath, backup, dryRun }) {
  const oldBuffer = readEntry(handle, target)
  const newBuffer = Buffer.from(nextText, 'utf8')
  const delta = newBuffer.length - oldBuffer.length
  const patchedStart = handle.dataStart + Number(target.node.offset)
  const patchedEnd = patchedStart + oldBuffer.length

  if (dryRun) return { changed: false, dryRun: true, form: 'archive', path: archivePath, backup: null, delta }

  // 偏移是相对数据区起点的：被替换内容之后的所有条目按 delta 平移即可，
  // 头部大小变化只影响数据区在文件里的绝对位置，不影响条目偏移。
  const oldEndOffset = Number(target.node.offset) + oldBuffer.length
  target.node.size = newBuffer.length
  for (const entry of entries) {
    if (entry.node.offset === undefined) continue
    if (Number(entry.node.offset) >= oldEndOffset) entry.node.offset = String(Number(entry.node.offset) + delta)
  }
  const json = Buffer.from(JSON.stringify(handle.header), 'utf8')

  // asar 头部：0=4（pickle 头长度），4/8 按“含空格填充”的长度记录，12 记录未填充的 JSON 长度。
  const unpaddedLength = json.length
  const padLength = (4 - (unpaddedLength % 4)) % 4
  const paddedJson = padLength === 0 ? json : Buffer.concat([json, Buffer.alloc(padLength, 0x20)])
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(4 + 4 + paddedJson.length, 4)
  prefix.writeUInt32LE(4 + paddedJson.length, 8)
  prefix.writeUInt32LE(unpaddedLength, 12)

  const staging = archivePath + STAGING_SUFFIX
  const out = openSync(staging, 'w')
  try {
    writeSync(out, prefix)
    writeSync(out, paddedJson)
    const CHUNK = 4 * 1024 * 1024
    let position = handle.dataStart
    const copyUntil = (endExclusive) => {
      while (position < endExclusive) {
        const length = Math.min(CHUNK, endExclusive - position)
        const buffer = Buffer.alloc(length)
        readSync(handle.fd, buffer, 0, length, position)
        writeSync(out, buffer)
        position += length
      }
    }
    copyUntil(patchedStart)
    writeSync(out, newBuffer)
    position = patchedEnd
    copyUntil(handle.size)
  } finally {
    closeSync(out)
  }

  // Windows 上目标文件还被读句柄占着时 rename 会 EPERM：先关读句柄再 self-swap。
  closeHeader(handle)
  const backupPath = backup ? archivePath + BACKUP_PREFIX + stamp() : null
  if (backupPath !== null) copyFileSync(archivePath, backupPath)
  try {
    renameSync(staging, archivePath)
  } catch (error) {
    // 换不进去（几乎总是宿主还在跑、app.asar 被占用）：把 staging 与这份没用上的
    // 备份一起清掉。留下 200MB 垃圾文件和一个"看着像补丁过"的备份，比失败更糟。
    try {
      rmSync(staging, { force: true })
    } catch {
      // 清理失败不掩盖原错误
    }
    if (backupPath !== null) {
      try {
        rmSync(backupPath, { force: true })
      } catch {
        // 同上
      }
    }
    throw error
  }
  return { changed: true, dryRun: false, form: 'archive', path: archivePath, backup: backupPath, delta }
}
