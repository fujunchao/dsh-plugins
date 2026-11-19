/**
 * xhigh 补丁托管：检测宿主 pi-ai 的第四档支持，必要时写入三处改动。
 *
 * 为什么补丁必须落在 asar 里：第四档的缺口在 @earendil-works/pi-ai 内部（一张
 * thinking level 表 + 两个 switch），DSH 插件层没有可用关口——`llm/stream` 只能改
 * 已有档位名，fetch 改写发生在抛错之后。所以本模块只做「发现 + 写回 + 状态展示」。
 *
 * 目标条目（归档内路径）：
 *   dsh/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js
 *
 * 三处改动（都必须结构可辨，不做裸字符串搜索）：
 *   1. GOOGLE_SDK_THINKING_LEVEL_MAP 里补 `XHIGH: "XHIGH"`（宿主装的 @google/genai
 *      没有 ThinkingLevel.XHIGH，所以值只能是裸字符串）；
 *   2. resolveGoogleThinkingLevel 的 switch 补 `case "xhigh":`；
 *   3. toGoogleThinkingLevel 的 switch 补 `case "xhigh": return "XHIGH";`。
 *
 * @module dsh-model-tuning/xhigh
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  BACKUP_PREFIX,
  archiveForm,
  normalizeEntry,
  readText,
  readTextsIfPresent,
  replaceEntryText,
} from './asar.js'

/**
 * 候选安装目录：DSH 是 Electron 应用，路径从运行中的进程/DSH 注入的环境里取，不写死。
 *
 *  - 宿主进程内：`process.resourcesPath` = `<安装目录>/resources`（最准）
 *  - 在 DSH 开的 shell 里跑 CLI：`DSH_NODE_EXECUTABLE` = `<安装目录>/DeepSeekRuntime.exe`
 *  - 兜底：`process.execPath` 所在目录（Electron 里同 `DSH_NODE_EXECUTABLE`，
 *    个别布局把可执行文件放得再深一层，所以也看它的上一级）
 *
 * 纯 Node 跑本模块（单测、自己开终端跑 CLI）时这些都不指向宿主，推导会失败；
 * 那种情况用 `installDir` 参数或 `DSH_MODEL_TUNING_INSTALL_DIR` 指定，见 `resolveInstallDir`。
 */
function installDirCandidates() {
  const candidates = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(dirname(process.resourcesPath))
  }
  const hostExecutable = process.env.DSH_NODE_EXECUTABLE
  if (typeof hostExecutable === 'string' && hostExecutable.length > 0) {
    candidates.push(dirname(hostExecutable))
  }
  if (typeof process.execPath === 'string' && process.execPath.length > 0) {
    candidates.push(dirname(process.execPath))
    candidates.push(dirname(dirname(process.execPath)))
  }
  return candidates
}

/** 这个目录像不像一份 DSH 安装：`resources/app.asar`（归档形态与目录形态都算）。 */
function looksLikeInstallDir(directory) {
  return existsSync(join(directory, 'resources', 'app.asar'))
}

/** 从运行中的进程推导宿主编译安装目录；推不出来就退回第一个候选。 */
function deriveInstallDir() {
  const candidates = installDirCandidates()
  for (const candidate of candidates) {
    if (looksLikeInstallDir(candidate)) return candidate
  }
  return candidates[0] ?? dirname(process.execPath ?? '')
}

/**
 * 宿主编译安装目录的默认位置：从 `process.resourcesPath` / `DSH_NODE_EXECUTABLE` /
 * `process.execPath` 推导，不写死任何一台机器的路径。参数或环境变量优先，见 `resolveInstallDir`。
 */
export const DEFAULT_INSTALL_DIR = deriveInstallDir()

/** 宿主归档/目录里的目标条目。 */
export const googleSharedEntry = 'dsh/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js'

/** 旧名兼容（clean-route 里叫 TARGET_ENTRY）。 */
export const TARGET_ENTRY = googleSharedEntry

/** 宿主应用版本所在的条目（先根、再 dsh 运行时）。 */
const VERSION_ENTRIES = ['package.json', 'dsh/package.json']

/** 三处改动的展示名（detail 里点名用）。 */
export const EDITS = [
  { key: 'map', label: '思考等级表 XHIGH 项（XHIGH: "XHIGH"）' },
  { key: 'resolve', label: 'resolveGoogleThinkingLevel 的 case "xhigh"' },
  { key: 'wire', label: 'toGoogleThinkingLevel 的 case "xhigh" → "XHIGH"' },
]

// ---------------------------------------------------------------------------
// 轻量 JS 词法扫描：只为「认出结构」服务，不解析语法树
// ---------------------------------------------------------------------------

/** 跳过 `// …` 行注释，返回下一个待看字符的下标。 */
function skipLineComment(source, index) {
  const end = source.indexOf('\n', index)
  return end < 0 ? source.length : end
}

/** 跳过 `/* … *\/` 块注释。 */
function skipBlockComment(source, index) {
  const end = source.indexOf('*/', index + 2)
  return end < 0 ? source.length : end + 2
}

/** 跳过一段 '…' / "…" 字符串（未闭合时停在换行，避免吞掉后续代码）。 */
function skipString(source, index, quote) {
  for (let i = index + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === quote) return i + 1
    if (ch === '\n') return i
  }
  return source.length
}

/** 跳过一段 `…` 模板字符串（含 `${}` 里的嵌套代码）。 */
function skipTemplate(source, index) {
  for (let i = index + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '`') return i + 1
    if (ch === '$' && source[i + 1] === '{') {
      const close = matchBracket(source, i + 1)
      if (close < 0) return source.length
      i = close
    }
  }
  return source.length
}

/** 跳过一段正则字面量 `/…/flags`。 */
function skipRegex(source, index) {
  let inClass = false
  for (let i = index + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '\n') return i
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) {
      i += 1
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1
      return i
    }
  }
  return source.length
}

/** `/` 是正则开头还是除号：看前一个有效字符。 */
function looksLikeRegexStart(source, index) {
  let i = index - 1
  while (i >= 0 && /\s/.test(source[i])) i -= 1
  if (i < 0) return true
  return !/[)\]}"'`A-Za-z0-9_$]/.test(source[i])
}

/**
 * 从开括号（`{` 或 `(`）出发找配对的闭括号下标；字符串/注释/模板/正则里的括号不算。
 * 找不到返回 -1。
 */
function matchBracket(source, openIndex) {
  const open = source[openIndex]
  const close = open === '{' ? '}' : open === '(' ? ')' : null
  if (close === null) return -1
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i)
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i)
      continue
    }
    if (ch === '"' || ch === "'") {
      i = skipString(source, i, ch)
      continue
    }
    if (ch === '`') {
      i = skipTemplate(source, i)
      continue
    }
    if (ch === '/' && looksLikeRegexStart(source, i)) {
      i = skipRegex(source, i)
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

// ---------------------------------------------------------------------------
// 结构定位：等级表、两个函数
// ---------------------------------------------------------------------------

/** 等级表里应有的键（用来确认「这就是那张表」，名字被改也认得出）。 */
const LEVEL_MAP_KEYS = ['THINKING_LEVEL_UNSPECIFIED', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH']

/** 有没有 `KEY:` 这样的对象键。 */
function hasKey(body, key) {
  return new RegExp('(^|[\\s,{])' + key + '[ \\t]*:', 'm').test(body)
}

/**
 * 找 Google 思考等级表：形如 `const <NAME> = { … }` 且对象体里含 MINIMAL…HIGH 这些键。
 * 名字像 LEVEL_MAP 的优先，其次取认得出的键最多的对象（容忍上游改个变量名）。
 */
function locateLevelMap(source) {
  const declaration = /(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*\{/g
  let best = null
  let match
  while ((match = declaration.exec(source)) !== null) {
    const openIndex = match.index + match[0].length - 1
    const closeIndex = matchBracket(source, openIndex)
    if (closeIndex < 0) continue
    const bodyStart = openIndex + 1
    const body = source.slice(bodyStart, closeIndex)
    const keys = LEVEL_MAP_KEYS.filter((key) => hasKey(body, key))
    if (keys.length < 4 || !keys.includes('HIGH')) continue
    const candidate = { name: match[1], bodyStart, bodyEnd: closeIndex, body, keyCount: keys.length }
    if (/THINKING_LEVEL_MAP|LEVEL_MAP/.test(match[1])) return candidate
    if (best === null || candidate.keyCount > best.keyCount) best = candidate
  }
  return best
}

/** 找具名函数声明（`function name(`，允许 export/async 前缀），返回函数体范围。 */
function locateFunction(source, name) {
  const pattern = new RegExp('\\b(?:export[ \\t]+)?(?:default[ \\t]+)?(?:async[ \\t]+)?function[ \\t*]+' + name + '[ \\t]*\\(', 'g')
  const match = pattern.exec(source)
  if (match === null) return null
  const openParen = match.index + match[0].length - 1
  const closeParen = matchBracket(source, openParen)
  if (closeParen < 0) return null
  const braceOpen = source.indexOf('{', closeParen + 1)
  if (braceOpen < 0) return null
  const braceClose = matchBracket(source, braceOpen)
  if (braceClose < 0) return null
  return { bodyStart: braceOpen + 1, bodyEnd: braceClose, body: source.slice(braceOpen + 1, braceClose) }
}

/**
 * 改动 1 的锚点：等级表里的 `XHIGH` 项。
 *
 * 只有「XHIGH 键 + 裸字符串 "XHIGH"」才算已打：宿主装的 @google/genai 没有
 * `ThinkingLevel.XHIGH`，写成 `GoogleSdkThinkingLevel.XHIGH` 会是 undefined，等于没打。
 * 键在但值不对 → 就地改值（绝不插第二个同名键）；键不在 → 在 HIGH 项之后补一行。
 */
function locateMapAnchor(source) {
  const map = locateLevelMap(source)
  if (map === null) return null
  const body = map.body

  const existing = /(^|[\s,{])(XHIGH[ \t]*:[ \t]*)([^,\n}]*)/.exec(body)
  if (existing !== null) {
    const value = existing[3].trim()
    if (value === '"XHIGH"' || value === "'XHIGH'") return { hasXhigh: true }
    const valueStart = map.bodyStart + existing.index + existing[1].length + existing[2].length
    return { hasXhigh: false, edit: { start: valueStart, end: valueStart + existing[3].length, text: '"XHIGH"' } }
  }

  // 键不在：在 `HIGH: …` 那一项之后补一行，缩进照抄 HIGH 那行。
  const line = /(^|\n)([ \t]*)(HIGH[ \t]*:[^\n]*)/.exec(body)
  if (line !== null) {
    const indent = line[2]
    const needsComma = !/[ \t]*,\s*$/.test(line[3])
    const at = map.bodyStart + line.index + line[0].length
    return { hasXhigh: false, edit: { start: at, end: at, text: (needsComma ? ',' : '') + '\n' + indent + 'XHIGH: "XHIGH",' } }
  }

  // 一行写完的对象字面量：退化成「HIGH: 值」定位。
  const inline = /\bHIGH[ \t]*:[^,\n}]*[ \t]*,?/.exec(body)
  if (inline === null) return null
  const lineStart = body.lastIndexOf('\n', inline.index) + 1
  const indent = /^[ \t]*/.exec(body.slice(lineStart))[0]
  const needsComma = !/[ \t]*,\s*$/.test(inline[0])
  const at = map.bodyStart + inline.index + inline[0].length
  return { hasXhigh: false, edit: { start: at, end: at, text: (needsComma ? ',' : '') + '\n' + indent + 'XHIGH: "XHIGH",' } }
}

/** 改动 2 的锚点：resolveGoogleThinkingLevel 里 `case "high":` 之前插 `case "xhigh":`。 */
function locateResolveAnchor(source) {
  const fn = locateFunction(source, 'resolveGoogleThinkingLevel')
  if (fn === null) return null
  if (/(^|\n)[ \t]*case[ \t]+["']xhigh["'][ \t]*:/.test(fn.body)) return { hasXhigh: true }
  const highCase = /(^|\n)([ \t]*)case[ \t]+["']high["'][ \t]*:/.exec(fn.body)
  if (highCase === null) return null
  const at = fn.bodyStart + highCase.index + highCase[1].length
  return { hasXhigh: false, edit: { start: at, end: at, text: highCase[2] + 'case "xhigh":\n' } }
}

/** 改动 3 的锚点：toGoogleThinkingLevel 里 `case "high": return "HIGH";` 之后插 xhigh 分支。 */
function locateWireAnchor(source) {
  const fn = locateFunction(source, 'toGoogleThinkingLevel')
  if (fn === null) return null

  // 已经有 xhigh 分支：看它返回什么；返回别的档位就地改成 "XHIGH"。
  const existing = /(^|\n)[ \t]*case[ \t]+["']xhigh["'][ \t]*:([\s\S]{0,120}?)\breturn[ \t]+(["'])([A-Z]+)\3/.exec(fn.body)
  if (existing !== null) {
    if (existing[4] === 'XHIGH') return { hasXhigh: true }
    const literalStart = fn.bodyStart + existing.index + existing[0].length - (existing[4].length + 2)
    return { hasXhigh: false, edit: { start: literalStart, end: literalStart + existing[4].length + 2, text: '"XHIGH"' } }
  }
  if (/(^|\n)[ \t]*case[ \t]+["']xhigh["'][ \t]*:/.test(fn.body)) {
    return { hasXhigh: false, problem: 'toGoogleThinkingLevel 里已有 case "xhigh" 但认不出它返回什么' }
  }

  const high = /(^|\n)([ \t]*)case[ \t]+["']high["'][ \t]*:([ \t]*\r?\n)?([ \t]*)return[ \t]+["']HIGH["'][ \t]*;?/.exec(fn.body)
  if (high === null) return null
  const caseIndent = high[2]
  const returnIndent = high[4] !== '' ? high[4] : caseIndent + '    '
  const at = fn.bodyStart + high.index + high[0].length
  return {
    hasXhigh: false,
    edit: { start: at, end: at, text: '\n' + caseIndent + 'case "xhigh":\n' + returnIndent + 'return "XHIGH";' },
  }
}

/** 三处改动各自的定位器（结构识别 + 插桩位置）。 */
const LOCATORS = [
  { key: 'map', locate: locateMapAnchor, missing: '找不到 Google 思考等级表（含 MINIMAL…HIGH 键的对象字面量）' },
  { key: 'resolve', locate: locateResolveAnchor, missing: '找不到 resolveGoogleThinkingLevel 及其 switch' },
  { key: 'wire', locate: locateWireAnchor, missing: '找不到 toGoogleThinkingLevel 及其 switch' },
]

// ---------------------------------------------------------------------------
// 检测
// ---------------------------------------------------------------------------

/**
 * 只读检测源码状态。
 *
 * @param {string} source google-shared.js 文本
 * @returns {{ state: 'patched'|'missing'|'unsupported', detail: string, edits: {key: string, label: string, applied: boolean}[], problems: string[] }}
 */
export function inspectSource(source) {
  const problems = []
  const edits = []
  for (const spec of LOCATORS) {
    const label = EDITS.find((edit) => edit.key === spec.key).label
    const anchor = spec.locate(source)
    if (anchor === null || anchor.problem !== undefined) {
      problems.push(anchor?.problem ?? spec.missing)
      edits.push({ key: spec.key, label, applied: false })
      continue
    }
    edits.push({ key: spec.key, label, applied: anchor.hasXhigh })
  }
  if (problems.length > 0) {
    return {
      state: 'unsupported',
      detail: 'unsupported: 目标文件结构已变化，无法识别补丁位置 — ' + problems.join('；'),
      edits,
      problems,
    }
  }
  const absent = edits.filter((edit) => !edit.applied)
  if (absent.length === 0) {
    return {
      state: 'patched',
      detail: 'patched: 三处改动齐全 — ' + edits.map((edit) => edit.label).join('；'),
      edits,
      problems,
    }
  }
  return {
    state: 'missing',
    detail: 'missing: ' + absent.length + '/3 处改动缺失 — ' + absent.map((edit) => edit.label).join('；'),
    edits,
    problems,
  }
}

/**
 * 计算补丁后的源码。已打过 → changed=false；结构认不出 → 抛错（且不产生任何写入）。
 *
 * @param {string} source google-shared.js 文本
 * @returns {{ source: string, changed: boolean, applied: string[] }}
 */
export function patchSource(source) {
  const before = inspectSource(source)
  if (before.state === 'unsupported') {
    const error = new Error('宿主 pi-ai 结构无法识别，拒绝猜测：' + before.problems.join('；'))
    error.code = 'XHIGH_UNSUPPORTED'
    throw error
  }
  let next = source
  const applied = []
  for (const spec of LOCATORS) {
    const current = before.edits.find((edit) => edit.key === spec.key)
    if (current !== undefined && current.applied) continue
    const anchor = spec.locate(next)
    if (anchor === null || anchor.edit === undefined) {
      const error = new Error('补丁失败：认不出 ' + EDITS.find((edit) => edit.key === spec.key).label + ' 的位置')
      error.code = 'XHIGH_UNSUPPORTED'
      throw error
    }
    const { start, end, text } = anchor.edit
    next = next.slice(0, start) + text + next.slice(end)
    applied.push(EDITS.find((edit) => edit.key === spec.key).label)
  }
  // 自检：写盘前先确认三处都真的成了。
  const after = inspectSource(next)
  if (after.state !== 'patched') {
    const error = new Error('补丁后自检未通过：' + after.detail)
    error.code = 'XHIGH_SELFCHECK'
    throw error
  }
  return { source: next, changed: applied.length > 0, applied }
}

// ---------------------------------------------------------------------------
// 路径与备份
// ---------------------------------------------------------------------------

/**
 * 解析安装目录：参数 > 插件自己的环境变量 > 推导出的默认位置。
 *
 * `DSH_MODEL_TUNING_INSTALL_DIR` 是本插件的显式覆盖。DSH 给子进程也会设一个
 * `DSH_INSTALL_DIR`，但它指向归档里的 dsh 包目录（不是宿主编译安装目录），语义不同 ——
 * 所以只有在它确实指向一份安装（含 `resources/app.asar`）时才采用。
 */
export function resolveInstallDir(options = {}) {
  const explicit = options.installDir ?? process.env.DSH_MODEL_TUNING_INSTALL_DIR
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim()
  const shared = process.env.DSH_INSTALL_DIR
  if (typeof shared === 'string' && shared.trim().length > 0 && looksLikeInstallDir(shared.trim())) return shared.trim()
  return DEFAULT_INSTALL_DIR
}

/**
 * 解析 app.asar 路径：正常是 `<installDir>/resources/app.asar`；
 * 若调用方直接给了 resources 目录（里面有 app.asar），也认。
 */
export function resolveArchivePath(installDir) {
  const asResources = join(installDir, 'app.asar')
  if (archiveForm(asResources) !== 'missing') return asResources
  return join(installDir, 'resources', 'app.asar')
}

/**
 * 列出某路径的备份（`<路径>.bak-model-tuning-<时间戳>`），最新在前。
 *
 * @param {string} targetPath 归档路径（整份 asar 备份）或条目文件路径（目录形态）
 */
export function listBackups(targetPath) {
  const dir = dirname(targetPath)
  const prefix = basename(targetPath) + BACKUP_PREFIX
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const path = join(dir, name)
    try {
      const info = statSync(path)
      if (!info.isFile()) continue
      out.push({ path, size: info.size, mtimeMs: info.mtimeMs, stamp: name.slice(prefix.length) })
    } catch {
      /* 列目录后被删掉就算了 */
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || b.stamp.localeCompare(a.stamp))
  return out
}

/** 最新一份备份的路径，没有则 null。 */
export function newestBackup(targetPath) {
  const backups = listBackups(targetPath)
  return backups.length === 0 ? null : backups[0].path
}

/** 目录形态下目标条目在磁盘上的普通文件路径。 */
function entryFile(archivePath) {
  return join(archivePath, normalizeEntry(googleSharedEntry))
}

/** 从归档里读宿主应用版本（根 package.json，退到 dsh/package.json）。 */
function appVersionOf(texts) {
  for (const entry of VERSION_ENTRIES) {
    const raw = texts[normalizeEntry(entry)]
    if (typeof raw !== 'string') continue
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.version === 'string' && parsed.version.length > 0) return parsed.version
    } catch {
      /* 读不出就当没有 */
    }
  }
  return null
}

/** 读状态所需的三个条目（只解析一次头部）。 */
function readStatusTexts(archivePath) {
  return readTextsIfPresent(archivePath, [...VERSION_ENTRIES, googleSharedEntry])
}

// ---------------------------------------------------------------------------
// 对外 API：状态 / 打补丁 / 回滚
// ---------------------------------------------------------------------------

/**
 * 只读状态：三处改动是否齐全、宿主版本、归档路径、最新备份。
 * 永不写文件。
 *
 * @param {{ installDir?: string }} [options]
 * @returns {{ state: 'patched'|'missing'|'unsupported'|'error', detail: string, archivePath: string,
 *   appVersion: string|null, entryPath: string, backupPath: string|null, form: string,
 *   edits: {key: string, label: string, applied: boolean}[] }}
 */
export function patchStatus({ installDir } = {}) {
  const dir = resolveInstallDir({ installDir })
  const archivePath = resolveArchivePath(dir)
  const form = archiveForm(archivePath)
  const base = {
    archivePath,
    appVersion: null,
    entryPath: googleSharedEntry,
    backupPath: null,
    form,
    edits: [],
  }

  // 归档形态：整份 asar 的备份在归档旁边；目录形态：备份在条目文件旁边。
  const backupTarget = form === 'directory' ? entryFile(archivePath) : archivePath
  const backupPath = newestBackup(backupTarget)

  if (form === 'missing') {
    return {
      ...base,
      state: 'unsupported',
      detail: '找不到宿主安装：' + archivePath + '（可用 installDir 指定安装目录）',
    }
  }

  let texts
  try {
    texts = readStatusTexts(archivePath)
  } catch (error) {
    return {
      ...base,
      state: 'error',
      detail: '读取宿主归档失败：' + (error instanceof Error ? error.message : String(error)),
      backupPath,
    }
  }

  const appVersion = appVersionOf(texts)
  const source = texts[normalizeEntry(googleSharedEntry)]
  if (typeof source !== 'string') {
    return {
      ...base,
      appVersion,
      backupPath,
      state: 'unsupported',
      detail: '目标条目不存在：' + googleSharedEntry + '（pi-ai 的目录结构可能已变化）',
    }
  }

  const inspection = inspectSource(source)
  return {
    ...base,
    appVersion,
    backupPath,
    state: inspection.state,
    detail: inspection.detail,
    edits: inspection.edits,
  }
}

/**
 * 打补丁：已打过 → 什么都不改；结构认不出 → 拒绝；否则补齐缺失的改动并校验。
 *
 * @param {{ installDir?: string, dryRun?: boolean }} [options] dryRun 只算不做，不写任何文件
 * @returns {{ ok: boolean, state: string, archivePath: string, backupPath: string|null, detail: string,
 *   changed: boolean, dryRun: boolean }}
 */
export function applyPatch({ installDir, dryRun = false } = {}) {
  const dir = resolveInstallDir({ installDir })
  const archivePath = resolveArchivePath(dir)
  const form = archiveForm(archivePath)
  const base = { ok: false, state: 'error', archivePath, backupPath: null, changed: false, dryRun }

  if (form === 'missing') {
    return { ...base, state: 'unsupported', detail: '找不到宿主安装：' + archivePath + '（可用 installDir 指定安装目录）' }
  }
  if (form === 'mounted') {
    return {
      ...base,
      detail: '宿主正在运行：app.asar 处于挂载状态，只能读不能写。请完全退出宿主后再打补丁。',
    }
  }

  let source
  try {
    source = readText(archivePath, googleSharedEntry)
  } catch (error) {
    if (error?.code === 'ASAR_ENTRY_MISSING') {
      return { ...base, state: 'unsupported', detail: '目标条目不存在：' + googleSharedEntry + '（pi-ai 的目录结构可能已变化）' }
    }
    return { ...base, detail: '读取宿主归档失败：' + (error instanceof Error ? error.message : String(error)) }
  }

  const inspection = inspectSource(source)
  if (inspection.state === 'unsupported') {
    return { ...base, state: 'unsupported', detail: '拒绝打补丁：' + inspection.detail }
  }
  if (inspection.state === 'patched') {
    return {
      ...base,
      ok: true,
      state: 'patched',
      detail: '补丁已在位：三处改动齐全，本次未改动任何文件',
    }
  }

  let patched
  try {
    patched = patchSource(source)
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? error.code : undefined
    const message = error instanceof Error ? error.message : String(error)
    return { ...base, state: code === 'XHIGH_UNSUPPORTED' ? 'unsupported' : 'error', detail: message }
  }

  if (dryRun) {
    return {
      ...base,
      ok: true,
      state: 'patched',
      changed: true,
      dryRun: true,
      detail: 'dry run：将补写 ' + patched.applied.length + ' 处改动（' + patched.applied.join('；') + '），未写入任何文件',
    }
  }

  let result
  try {
    result = replaceEntryText(archivePath, googleSharedEntry, patched.source, { backup: true })
  } catch (error) {
    return {
      ...base,
      detail: '写入失败：' + (error instanceof Error ? error.message : String(error)),
    }
  }

  // 校验：重读落盘内容再检测一遍，别拿内存里的字符串自证。
  let verified
  try {
    verified = inspectSource(readText(archivePath, googleSharedEntry))
  } catch (error) {
    return {
      ...base,
      backupPath: result.backup,
      detail: '写入后无法重读校验：' + (error instanceof Error ? error.message : String(error)),
    }
  }
  if (verified.state !== 'patched') {
    return {
      ...base,
      backupPath: result.backup,
      detail: '写入后自检未通过（' + verified.detail + '）。可用备份回滚：' + String(result.backup),
    }
  }

  return {
    ...base,
    ok: true,
    state: 'patched',
    changed: true,
    backupPath: result.backup,
    detail:
      '已补写 ' + patched.applied.length + ' 处改动（' + patched.applied.join('；') + '）；备份：' +
      String(result.backup) + '；需重启应用生效',
  }
}

/**
 * 回滚：用最新一份备份还原目标条目。只还原条目，不整份覆盖 asar
 * （整份覆盖会把之后的 app 升级一起吞掉）。
 *
 * @param {{ installDir?: string, dryRun?: boolean }} [options]
 * @returns {{ ok: boolean, state: string, archivePath: string, backupPath: string|null, detail: string,
 *   changed: boolean, dryRun: boolean }}
 */
export function rollbackPatch({ installDir, dryRun = false } = {}) {
  const dir = resolveInstallDir({ installDir })
  const archivePath = resolveArchivePath(dir)
  const form = archiveForm(archivePath)
  const base = { ok: false, state: 'error', archivePath, backupPath: null, changed: false, dryRun }

  if (form === 'missing') {
    return { ...base, state: 'unsupported', detail: '找不到宿主安装：' + archivePath + '（可用 installDir 指定安装目录）' }
  }
  if (form === 'mounted') {
    return {
      ...base,
      detail: '宿主正在运行：app.asar 处于挂载状态，只能读不能写。请完全退出宿主后再回滚。',
    }
  }

  const target = form === 'directory' ? entryFile(archivePath) : archivePath
  const backups = listBackups(target)
  if (backups.length === 0) {
    return {
      ...base,
      state: 'missing',
      detail: '没有找到备份（' + basename(target) + BACKUP_PREFIX + '*），无法回滚。可重装或从安装包恢复 ' + googleSharedEntry,
    }
  }
  const backupPath = backups[0].path

  // 备份形态：归档备份 = 整份 asar；目录形态备份 = 条目文件本身。
  let original
  try {
    original = form === 'directory' ? readFileSync(backupPath, 'utf8') : readText(backupPath, googleSharedEntry)
  } catch (error) {
    return { ...base, backupPath, detail: '备份读不出来：' + (error instanceof Error ? error.message : String(error)) }
  }

  let current
  try {
    current = form === 'directory' ? readFileSync(target, 'utf8') : readText(archivePath, googleSharedEntry)
  } catch (error) {
    return { ...base, backupPath, detail: '当前条目读不出来：' + (error instanceof Error ? error.message : String(error)) }
  }

  const backupInspection = inspectSource(original)
  if (current === original) {
    return {
      ...base,
      ok: true,
      state: backupInspection.state,
      backupPath,
      changed: false,
      detail: '当前条目已是最新备份的内容（' + backupInspection.state + '），无需回滚',
    }
  }
  if (dryRun) {
    return {
      ...base,
      ok: true,
      state: backupInspection.state,
      backupPath,
      changed: true,
      dryRun: true,
      detail: 'dry run：将用备份 ' + basename(backupPath) + ' 还原条目（还原后状态 ' + backupInspection.state + '），未写入任何文件',
    }
  }

  try {
    if (form === 'directory') {
      copyFileSync(backupPath, target)
    } else {
      replaceEntryText(archivePath, googleSharedEntry, original, { backup: false })
    }
  } catch (error) {
    return { ...base, backupPath, detail: '回滚写入失败：' + (error instanceof Error ? error.message : String(error)) }
  }

  let restored
  try {
    restored = form === 'directory' ? readFileSync(target, 'utf8') : readText(archivePath, googleSharedEntry)
  } catch (error) {
    return { ...base, backupPath, detail: '回滚后无法重读校验：' + (error instanceof Error ? error.message : String(error)) }
  }
  if (restored !== original) {
    return { ...base, backupPath, detail: '回滚后校验失败：条目内容与备份不一致（' + backupPath + '）' }
  }

  return {
    ...base,
    ok: true,
    state: backupInspection.state,
    backupPath,
    changed: true,
    detail: '已用备份 ' + basename(backupPath) + ' 还原目标条目（现在状态 ' + backupInspection.state + '）；需重启应用生效',
  }
}
