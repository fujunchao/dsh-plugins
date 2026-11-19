/**
 * asar 读写 + xhigh 补丁托管：端到端单测。
 *
 * 做法：在 tmpdir 里现场造一份最小但**格式合法**的 Electron asar（16 字节 pickle 头 +
 * JSON 目录树 + 顺序数据区），里面放一份真实 `google-shared.js` 的逐字节快照
 * （`test/fixtures/google-shared.original.js`，取自宿主 app.asar，SHA-256 与 recon
 * 里的抽取副本一致）。于是三件事都被真实文本覆盖：结构识别的锚点、写回后的归档完整性、
 * 以及「打完之后这三处改动在真代码里真的生效」。
 *
 * 最后一条靠 verify-xhigh.mjs 的同一招：把打完的 google-shared.js 抽到 harness 目录，
 * 把它的 import 改写成桩，再 import 进来断言行为。桩里的 @google/genai **故意没有**
 * ThinkingLevel.XHIGH——宿主装的那版就没有，所以补丁必须写裸字符串 "XHIGH"。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

import {
  BACKUP_PREFIX,
  archiveForm,
  closeHeader,
  readEntry,
  readHeader,
  readText,
  readTexts,
  readTextsIfPresent,
  replaceEntryText,
  walkFiles,
} from '../lib/asar.js'
import {
  applyPatch,
  googleSharedEntry,
  inspectSource,
  patchSource,
  patchStatus,
  resolveInstallDir,
  rollbackPatch,
} from '../lib/xhigh.js'

const here = dirname(fileURLToPath(import.meta.url))

/** 真实 google-shared.js 的逐字节快照（用 .txt 后缀，免得被 `node --test` 当成测试文件跑）。 */
const ORIGINAL_TEXT = readFileSync(join(here, 'fixtures', 'google-shared.original.js.txt'), 'utf8')

/** 补丁后的期望文本（由被测代码自己算，用来跟归档里的实测内容比对）。 */
const PATCHED_TEXT = patchSource(ORIGINAL_TEXT).source

/** 三处改动插入的原文片段——用来人为造「部分补过」的 fixture。 */
const INSERTED = {
  map: '\n    XHIGH: "XHIGH",',
  resolve: '        case "xhigh":\n',
  wire: '\n        case "xhigh":\n            return "XHIGH";',
}

/**
 * 清临时目录。
 *
 * Windows 上并行跑测试时 `rmSync` 会偶发 `ENOTEMPTY`/`EPERM`（索引器或杀毒短暂占着目录），
 * 这不是被测代码的问题，但它会让一条随机用例以一个看不懂的 hook 失败收场。
 * 这里带重试，最后仍失败就留给系统临时目录——清理失败不该把一个绿测试变红。
 */
function removeQuietly(root) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // 交给系统临时目录的清理
  }
}

// ---------------------------------------------------------------------------
// 造 asar / 造安装目录
// ---------------------------------------------------------------------------

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 写一份最小但合法的 asar：16 字节 pickle 头（0=4，4/8=含填充长度，12=JSON 长度）
 * + 4 字节对齐的 JSON 目录树 + 按偏移顺序拼接的数据区。
 *
 * @param {string} archivePath 输出路径
 * @param {[string, string][]} files 归档内路径 → 文本（顺序即数据区顺序）
 */
function writeAsar(archivePath, files) {
  const header = { files: {} }
  const buffers = []
  let offset = 0
  for (const [entryPath, text] of files) {
    const buffer = Buffer.from(text, 'utf8')
    const parts = entryPath.split('/')
    let node = header
    for (const part of parts.slice(0, -1)) {
      node.files[part] ??= { files: {} }
      node = node.files[part]
    }
    node.files[parts.at(-1)] = { size: buffer.length, offset: String(offset) }
    offset += buffer.length
    buffers.push(buffer)
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const pad = (4 - (json.length % 4)) % 4
  const paddedJson = pad === 0 ? json : Buffer.concat([json, Buffer.alloc(pad, 0x20)])
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(4 + 4 + paddedJson.length, 4)
  prefix.writeUInt32LE(4 + paddedJson.length, 8)
  prefix.writeUInt32LE(json.length, 12)
  writeFileSync(archivePath, Buffer.concat([prefix, paddedJson, ...buffers]))
}

/** 一份「像真安装」的文件树：目标条目之前与之后都有条目，便于验证偏移重基。 */
function fixtureTree({ googleShared = ORIGINAL_TEXT, includeTarget = true } = {}) {
  const version = JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.3', main: 'dsh/lib/index.js' }, null, 2) + '\n'
  const runtime = JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime', version: '0.2.2-rc.3' }, null, 2) + '\n'
  const files = [
    ['package.json', version],
    ['dsh/package.json', runtime],
    ['dsh/lib/index.js', 'export const boot = true\n'],
    [
      'dsh/node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js',
      'export function getJsonSchemaToolParameters() { return undefined }\n',
    ],
  ]
  if (includeTarget) files.push([googleSharedEntry, googleShared])
  files.push(
    ['dsh/node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js', 'export const provider = "google"\n'],
    ['dsh/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js', 'export function transformMessages(messages) { return messages }\n'],
    ['dsh/node_modules/@earendil-works/pi-ai/dist/pi-ai.js', 'export const version = "1.0.0-fixture"\n'],
  )
  return files
}

/** 造一份宿主安装目录：`<install>/resources/app.asar`。返回路径并登记清理。 */
function makeInstall(t, { googleShared = ORIGINAL_TEXT, includeTarget = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'model-tuning-xhigh-'))
  t.after(() => removeQuietly(root))
  const installDir = join(root, 'install')
  const resourcesDir = join(installDir, 'resources')
  mkdirSync(resourcesDir, { recursive: true })
  const archivePath = join(resourcesDir, 'app.asar')
  writeAsar(archivePath, fixtureTree({ googleShared, includeTarget }))
  return { root, installDir, resourcesDir, archivePath }
}

/** 造一份「app.asar 被解开成目录」的安装。 */
function makeUnpackedInstall(t, { googleShared = ORIGINAL_TEXT } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'model-tuning-xhigh-dir-'))
  t.after(() => removeQuietly(root))
  const installDir = join(root, 'install')
  const archivePath = join(installDir, 'resources', 'app.asar')
  for (const [entryPath, text] of fixtureTree({ googleShared })) {
    const file = join(archivePath, entryPath)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  }
  return { root, installDir, archivePath, entryFile: join(archivePath, googleSharedEntry) }
}

/** 把三处补丁片段里的若干处从「已打完」的文本里删掉，造 1/3、2/3 的部分状态。 */
function partiallyPatched(without) {
  let text = PATCHED_TEXT
  for (const key of without) {
    assert.ok(text.includes(INSERTED[key]), 'fixture 构造：文本里应有可删除的 ' + key + ' 片段')
    text = text.replace(INSERTED[key], '')
  }
  return text
}

/** 归档里的条目清单（路径 ↔ 文本）。 */
function archiveEntries(archivePath) {
  const handle = readHeader(archivePath)
  try {
    const out = new Map()
    for (const entry of walkFiles(handle.header)) out.set(entry.path, readEntry(handle, entry).toString('utf8'))
    return out
  } finally {
    closeHeader(handle)
  }
}

/** 归档旁有没有留下备份文件。 */
function backupNames(resourcesDir) {
  return readdirSync(resourcesDir).filter((name) => name.includes('.bak-model-tuning-'))
}

// ---------------------------------------------------------------------------
// asar 读写
// ---------------------------------------------------------------------------

test('asar：头部、条目清单、readEntry/readText/readTexts 都读得对', (t) => {
  const { archivePath } = makeInstall(t)
  assert.equal(archiveForm(archivePath), 'archive')

  const handle = readHeader(archivePath)
  try {
    const entries = walkFiles(handle.header)
    const paths = entries.map((entry) => entry.path)
    assert.equal(paths.length, 8)
    assert.ok(paths.includes(googleSharedEntry))
    assert.ok(paths.includes('package.json'))
    const target = entries.find((entry) => entry.path === googleSharedEntry)
    assert.equal(readEntry(handle, target).toString('utf8'), ORIGINAL_TEXT)
    assert.equal(Number(target.node.size), Buffer.byteLength(ORIGINAL_TEXT))
  } finally {
    closeHeader(handle)
  }

  assert.equal(readText(archivePath, googleSharedEntry), ORIGINAL_TEXT)
  const many = readTexts(archivePath, [googleSharedEntry, 'dsh/package.json'])
  assert.equal(many[googleSharedEntry], ORIGINAL_TEXT)
  assert.equal(JSON.parse(many['dsh/package.json']).version, '0.2.2-rc.3')

  const present = readTextsIfPresent(archivePath, ['package.json', 'nope/missing.js'])
  assert.equal(JSON.parse(present['package.json']).name, '@deepseek-ai/dsh-desktop')
  assert.equal(present['nope/missing.js'], undefined)

  assert.throws(
    () => readTexts(archivePath, ['nope/missing.js']),
    (error) => error.code === 'ASAR_ENTRY_MISSING' && /没有这个条目/.test(error.message),
  )
  assert.throws(() => readText(join(dirname(archivePath), 'nope.asar'), 'x.js'), (error) => error.code === 'ASAR_MISSING')
})

test('asar：替换条目后偏移重基正确（变长/变短都不伤其它条目）', (t) => {
  const { archivePath } = makeInstall(t)
  const before = archiveEntries(archivePath)

  const grown = replaceEntryText(archivePath, googleSharedEntry, PATCHED_TEXT, { backup: false })
  assert.equal(grown.form, 'archive')
  assert.ok(grown.delta > 0)
  assert.equal(grown.backup, null)
  const afterGrow = archiveEntries(archivePath)
  assert.equal(afterGrow.get(googleSharedEntry), PATCHED_TEXT)
  for (const [path, text] of before) {
    if (path === googleSharedEntry) continue
    assert.equal(afterGrow.get(path), text, '条目被改坏：' + path)
  }

  const shrunken = replaceEntryText(archivePath, googleSharedEntry, ORIGINAL_TEXT, { backup: false })
  assert.ok(shrunken.delta < 0)
  const afterShrink = archiveEntries(archivePath)
  for (const [path, text] of before) assert.equal(afterShrink.get(path), text, '条目被改坏：' + path)
})

test('asar：形态判断与挂载态拒写', (t) => {
  const { root, archivePath } = makeInstall(t)
  const asDirectory = join(root, 'unpacked.asar')
  mkdirSync(join(asDirectory, 'dsh'), { recursive: true })
  writeFileSync(join(asDirectory, 'dsh', 'x.js'), 'x', 'utf8')

  assert.equal(archiveForm(asDirectory, { electron: true }), 'mounted', 'Electron 下 .asar 是挂载点')
  assert.equal(archiveForm(asDirectory, { electron: false }), 'directory', '纯 Node 下同名目录是真的目录')
  assert.equal(archiveForm(join(root, 'missing.asar'), { electron: true }), 'missing')
  assert.equal(archiveForm(archivePath, { electron: true }), 'archive')

  assert.throws(
    () => replaceEntryText(asDirectory, 'dsh/x.js', 'y', { electron: true }),
    (error) => error.code === 'ASAR_MOUNTED' && /挂载状态/.test(error.message),
  )
  assert.equal(readFileSync(join(asDirectory, 'dsh', 'x.js'), 'utf8'), 'x', '挂载态拒写后文件应保持原样')
})

// ---------------------------------------------------------------------------
// 状态检测
// ---------------------------------------------------------------------------

test('干净 fixture：三处改动全缺 → missing（detail 逐条点名）', (t) => {
  const { installDir, archivePath } = makeInstall(t)
  const status = patchStatus({ installDir })

  assert.equal(status.state, 'missing')
  assert.equal(status.archivePath, archivePath)
  assert.equal(status.entryPath, googleSharedEntry)
  assert.equal(status.appVersion, '0.2.2-rc.3')
  assert.equal(status.backupPath, null)
  assert.equal(status.form, 'archive')
  assert.equal(status.edits.length, 3)
  assert.deepEqual(status.edits.map((edit) => edit.key), ['map', 'resolve', 'wire'])
  assert.deepEqual(status.edits.map((edit) => edit.applied), [false, false, false])
  assert.match(status.detail, /^missing: 3\/3/)
  for (const label of ['思考等级表', 'resolveGoogleThinkingLevel', 'toGoogleThinkingLevel']) {
    assert.ok(status.detail.includes(label), 'detail 应点名缺失的改动：' + label)
  }
})

test('结构检测是看结构、不是搜 XHIGH 字符串', () => {
  const clean = inspectSource(ORIGINAL_TEXT)
  assert.equal(clean.state, 'missing')
  assert.deepEqual(clean.problems, [])

  const patched = inspectSource(PATCHED_TEXT)
  assert.equal(patched.state, 'patched')
  assert.deepEqual(patched.edits.map((edit) => edit.applied), [true, true, true])

  // 真代码里别的注释/文案出现 XHIGH 字样也不算打过——只看三处结构。
  const mention = ORIGINAL_TEXT.replace('Shared utilities for Google Generative AI and Google Vertex providers.', 'Mentions XHIGH but is not patched.')
  assert.equal(inspectSource(mention).state, 'missing')

  // 等级表里的值必须是裸字符串：宿主的 @google/genai 没有 ThinkingLevel.XHIGH。
  const wrongValue = PATCHED_TEXT.replace('    XHIGH: "XHIGH",', '    XHIGH: GoogleSdkThinkingLevel.XHIGH,')
  const wrong = inspectSource(wrongValue)
  assert.equal(wrong.state, 'missing')
  assert.deepEqual(wrong.edits.map((edit) => edit.applied), [false, true, true])

  // 结构认不出（函数被重写）→ unsupported，不猜。
  const rewritten = 'export function resolveGoogleThinkingLevel(model, level) { return level }\n'
  assert.equal(inspectSource(rewritten).state, 'unsupported')
  assert.throws(() => patchSource(rewritten), (error) => error.code === 'XHIGH_UNSUPPORTED')
})

// ---------------------------------------------------------------------------
// 打补丁 / 幂等 / 补齐 / dryRun
// ---------------------------------------------------------------------------

test('打补丁：missing → patched，留下整份 asar 备份，条目内容逐字节等于补丁文本', (t) => {
  const { installDir, resourcesDir, archivePath } = makeInstall(t)
  const originalBytes = readFileSync(archivePath)

  const result = applyPatch({ installDir })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'patched')
  assert.equal(result.changed, true)
  assert.equal(result.dryRun, false)
  assert.equal(result.archivePath, archivePath)
  assert.ok(result.backupPath !== null, '应留下备份')
  assert.ok(result.backupPath.includes('.bak-model-tuning-'))
  assert.match(result.detail, /已补写 3 处改动/)
  assert.match(result.detail, /重启应用/)

  // 备份 = 打补丁前的整份归档。
  assert.equal(sha256(readFileSync(result.backupPath)), sha256(originalBytes))
  // 归档里的目标条目 = 期望补丁文本；其它条目原样。
  assert.equal(readText(archivePath, googleSharedEntry), PATCHED_TEXT)
  const entries = archiveEntries(archivePath)
  assert.equal(entries.get('dsh/lib/index.js'), 'export const boot = true\n')
  assert.equal(entries.get('dsh/node_modules/@earendil-works/pi-ai/dist/pi-ai.js'), 'export const version = "1.0.0-fixture"\n')
  // 状态转 patched，备份路径也在状态里。
  const status = patchStatus({ installDir })
  assert.equal(status.state, 'patched')
  assert.equal(status.backupPath, result.backupPath)
  assert.ok(status.detail.startsWith('patched:'))
  assert.equal(backupNames(resourcesDir).length, 1)
})

test('重复打补丁是空操作：归档字节与备份清单都不变', (t) => {
  const { installDir, resourcesDir, archivePath } = makeInstall(t)
  assert.equal(applyPatch({ installDir }).ok, true)
  const bytesAfterFirst = readFileSync(archivePath)
  const backupsAfterFirst = backupNames(resourcesDir)

  const again = applyPatch({ installDir })
  assert.equal(again.ok, true)
  assert.equal(again.state, 'patched')
  assert.equal(again.changed, false)
  assert.equal(again.backupPath, null)
  assert.match(again.detail, /补丁已在位/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(bytesAfterFirst), '幂等：归档不得被重写')
  assert.deepEqual(backupNames(resourcesDir), backupsAfterFirst, '幂等：不得新增备份')
})

test('部分补过（1/3、2/3）：报 missing 并点名缺口，apply 补齐到完整补丁文本', (t) => {
  const labelOf = {
    map: '思考等级表',
    resolve: 'resolveGoogleThinkingLevel',
    wire: 'toGoogleThinkingLevel',
  }
  const cases = [
    { without: ['resolve', 'wire'] },
    { without: ['wire'] },
  ]
  for (const shape of cases) {
    const partial = partiallyPatched(shape.without)
    const { installDir, archivePath } = makeInstall(t, { googleShared: partial })
    const absentKeys = shape.without
    const presentKeys = ['map', 'resolve', 'wire'].filter((key) => !absentKeys.includes(key))

    const status = patchStatus({ installDir })
    assert.equal(status.state, 'missing', '部分补过应报 missing')
    assert.equal(status.edits.filter((edit) => !edit.applied).length, absentKeys.length)
    assert.match(status.detail, new RegExp('^missing: ' + absentKeys.length + '/3'))
    for (const key of absentKeys) assert.ok(status.detail.includes(labelOf[key]), 'detail 应点名缺口：' + key)
    for (const key of presentKeys) assert.ok(!status.detail.includes(labelOf[key]), '已打过的改动不该出现在缺口里：' + key)

    const result = applyPatch({ installDir })
    assert.equal(result.ok, true)
    assert.equal(result.state, 'patched')
    assert.equal(result.changed, true)
    assert.match(result.detail, new RegExp('已补写 ' + absentKeys.length + ' 处改动'))
    assert.equal(readText(archivePath, googleSharedEntry), PATCHED_TEXT, '补齐结果应与一次性打补丁完全相同')
    assert.equal(patchStatus({ installDir }).state, 'patched')
  }
})

test('XHIGH 项值写错（非裸字符串）：报 missing，apply 就地改值、不插重复键', (t) => {
  const wrong = PATCHED_TEXT.replace('    XHIGH: "XHIGH",', '    XHIGH: GoogleSdkThinkingLevel.XHIGH,')
  const { installDir, archivePath } = makeInstall(t, { googleShared: wrong })
  assert.equal(patchStatus({ installDir }).state, 'missing')

  const result = applyPatch({ installDir })
  assert.equal(result.state, 'patched')
  const written = readText(archivePath, googleSharedEntry)
  assert.equal(written, PATCHED_TEXT)
  assert.equal((written.match(/XHIGH[ \t]*:/g) ?? []).length, 1, '不得出现重复的 XHIGH 键')
})

// ---------------------------------------------------------------------------
// dryRun
// ---------------------------------------------------------------------------

test('dryRun 不写任何文件（打补丁与回滚都不写）', (t) => {
  const { installDir, resourcesDir, archivePath } = makeInstall(t)
  const bytesBefore = readFileSync(archivePath)
  const listingBefore = readdirSync(resourcesDir).sort()

  const dry = applyPatch({ installDir, dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(dry.state, 'patched')
  assert.equal(dry.changed, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.backupPath, null)
  assert.match(dry.detail, /dry run/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(bytesBefore), 'dryRun 不得改写归档')
  assert.deepEqual(readdirSync(resourcesDir).sort(), listingBefore, 'dryRun 不得留下备份/暂存文件')
  assert.equal(patchStatus({ installDir }).state, 'missing', 'dryRun 之后状态应仍为 missing')

  // 真打一次，再 dryRun 回滚：同样不许写。
  assert.equal(applyPatch({ installDir }).ok, true)
  const patchedBytes = readFileSync(archivePath)
  const dryRollback = rollbackPatch({ installDir, dryRun: true })
  assert.equal(dryRollback.ok, true)
  assert.equal(dryRollback.changed, true)
  assert.match(dryRollback.detail, /dry run/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(patchedBytes), 'dryRun 回滚不得改写归档')
  assert.equal(patchStatus({ installDir }).state, 'patched')
})

// ---------------------------------------------------------------------------
// 回滚
// ---------------------------------------------------------------------------

test('回滚：从最新备份还原条目，归档逐字节回到原始', (t) => {
  const { installDir, resourcesDir, archivePath } = makeInstall(t)
  const originalBytes = readFileSync(archivePath)

  assert.equal(applyPatch({ installDir }).ok, true)
  assert.notEqual(sha256(readFileSync(archivePath)), sha256(originalBytes))

  const rolled = rollbackPatch({ installDir })
  assert.equal(rolled.ok, true)
  assert.equal(rolled.changed, true)
  assert.equal(rolled.state, 'missing')
  assert.ok(rolled.backupPath.includes('.bak-model-tuning-'))
  assert.match(rolled.detail, /还原目标条目/)
  assert.equal(readText(archivePath, googleSharedEntry), ORIGINAL_TEXT, '条目应逐字节还原')
  assert.equal(sha256(readFileSync(archivePath)), sha256(originalBytes), '整个归档应逐字节回到原始')
  assert.equal(patchStatus({ installDir }).state, 'missing')

  // 再回滚：已经与备份一致，什么都不做。
  const bytesNow = readFileSync(archivePath)
  const again = rollbackPatch({ installDir })
  assert.equal(again.ok, true)
  assert.equal(again.changed, false)
  assert.match(again.detail, /无需回滚/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(bytesNow))
  assert.equal(backupNames(resourcesDir).length, 1, '回滚不应产生新备份')
})

test('回滚只认最新一份备份（更旧的备份不会被选中）', (t) => {
  const { installDir, resourcesDir, archivePath } = makeInstall(t)
  const stale = join(resourcesDir, 'app.asar' + BACKUP_PREFIX + '2020-01-01T00-00-00-000Z')
  writeFileSync(stale, 'this is not a real asar backup', 'utf8')
  utimesSync(stale, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))

  const applied = applyPatch({ installDir })
  assert.equal(applied.ok, true)
  assert.notEqual(applied.backupPath, stale, '新备份应是刚才那次')

  const rolled = rollbackPatch({ installDir })
  assert.equal(rolled.ok, true)
  assert.equal(rolled.backupPath, applied.backupPath, '应回滚到最新备份，而不是更旧的那份')
  assert.equal(readText(archivePath, googleSharedEntry), ORIGINAL_TEXT)
})

test('回滚：没有备份时明确报错且不动归档', (t) => {
  const { installDir, archivePath } = makeInstall(t)
  const before = readFileSync(archivePath)
  const rolled = rollbackPatch({ installDir })
  assert.equal(rolled.ok, false)
  assert.equal(rolled.state, 'missing')
  assert.equal(rolled.changed, false)
  assert.match(rolled.detail, /没有找到备份/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(before))
})

// ---------------------------------------------------------------------------
// unsupported
// ---------------------------------------------------------------------------

test('unsupported：目标条目不存在时如实报告并拒绝打补丁', (t) => {
  const { installDir, archivePath } = makeInstall(t, { includeTarget: false })
  const before = readFileSync(archivePath)

  const status = patchStatus({ installDir })
  assert.equal(status.state, 'unsupported')
  assert.match(status.detail, /目标条目不存在/)
  assert.ok(status.detail.includes(googleSharedEntry))
  assert.equal(status.appVersion, '0.2.2-rc.3', '条目缺席也要能报出宿主版本')
  assert.equal(status.backupPath, null)

  const result = applyPatch({ installDir })
  assert.equal(result.ok, false)
  assert.equal(result.state, 'unsupported')
  assert.equal(result.backupPath, null)
  assert.match(result.detail, /目标条目不存在/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(before), '拒绝时不得写盘')
})

test('unsupported：条目在但结构认不出（新版 pi-ai 重写）时拒绝猜测', (t) => {
  const rewritten = 'export function resolveGoogleThinkingLevel(model, level) { return level }\n'
  const { installDir, archivePath } = makeInstall(t, { googleShared: rewritten })
  const before = readFileSync(archivePath)

  const status = patchStatus({ installDir })
  assert.equal(status.state, 'unsupported')
  assert.match(status.detail, /结构已变化/)

  const result = applyPatch({ installDir })
  assert.equal(result.ok, false)
  assert.equal(result.state, 'unsupported')
  assert.match(result.detail, /拒绝打补丁/)
  assert.equal(sha256(readFileSync(archivePath)), sha256(before), '拒绝时不得写盘')
})

test('安装目录不存在时如实报告', () => {
  const missing = join(tmpdir(), 'model-tuning-xhigh-definitely-missing-' + Date.now())
  const status = patchStatus({ installDir: missing })
  assert.equal(status.state, 'unsupported')
  assert.match(status.detail, /找不到宿主安装/)
  const result = applyPatch({ installDir: missing })
  assert.equal(result.ok, false)
  assert.equal(result.state, 'unsupported')
})

// ---------------------------------------------------------------------------
// 目录形态（app.asar 被解开）
// ---------------------------------------------------------------------------

test('目录形态：状态/打补丁/回滚都按普通文件处理', (t) => {
  const { installDir, archivePath, entryFile } = makeUnpackedInstall(t)
  assert.equal(archiveForm(archivePath), 'directory')

  const status = patchStatus({ installDir })
  assert.equal(status.state, 'missing')
  assert.equal(status.form, 'directory')
  assert.equal(status.appVersion, '0.2.2-rc.3')

  const applied = applyPatch({ installDir })
  assert.equal(applied.ok, true)
  assert.equal(applied.state, 'patched')
  assert.ok(applied.backupPath.startsWith(entryFile + '.bak-model-tuning-'))
  assert.equal(readFileSync(entryFile, 'utf8'), PATCHED_TEXT)
  assert.equal(readFileSync(applied.backupPath, 'utf8'), ORIGINAL_TEXT)
  assert.equal(patchStatus({ installDir }).state, 'patched')

  const rolled = rollbackPatch({ installDir })
  assert.equal(rolled.ok, true)
  assert.equal(rolled.changed, true)
  assert.equal(readFileSync(entryFile, 'utf8'), ORIGINAL_TEXT)
  assert.equal(patchStatus({ installDir }).state, 'missing')
})

// ---------------------------------------------------------------------------
// 行为验证：打出来的补丁在真代码里真的让 xhigh 走通
// ---------------------------------------------------------------------------

const HARNESS_IMPORT_REWRITES = [
  ['from "../models.js"', 'from "./stub-models.js"'],
  ['from "../utils/provider-retry.js"', 'from "./stub-misc.js"'],
  ['from "../utils/sanitize-unicode.js"', 'from "./stub-misc.js"'],
  ['from "../utils/transcript.js"', 'from "./stub-misc.js"'],
  ['from "./constrained-sampling.js"', 'from "./stub-misc.js"'],
  ['from "./transform-messages.js"', 'from "./stub-misc.js"'],
]

const STUB_MISC = `
export async function retryProviderRequest() { throw new Error("not used"); }
export function sanitizeSurrogates(value) { return value; }
export function collapseSystemMessages(value) { return value; }
export function withoutInitialSystemMessage(value) { return value; }
export function getJsonSchemaToolParameters() { return undefined; }
export function resolveJsonSchemaStrictSampling() { return undefined; }
export function transformMessages(value) { return value; }
`

/**
 * 与宿主装的那版 @google/genai 一致：ThinkingLevel 里**没有** XHIGH。
 * 所以补丁只能往映射表里写裸字符串 "XHIGH"，写成 GoogleSdkThinkingLevel.XHIGH 会 undefined。
 */
const STUB_SDK = `
export const ThinkingLevel = {
  THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
  MINIMAL: "MINIMAL",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};
export const FinishReason = {};
export const FunctionCallingConfigMode = {};
`

/** 把 google-shared.js 抄进 harness 目录并改写 import，返回可 import 的目录。 */
function writeHarness(root, label, googleSharedText) {
  const dir = join(root, label)
  const sdkDir = join(dir, 'node_modules', '@google', 'genai')
  mkdirSync(sdkDir, { recursive: true })
  let source = googleSharedText
  for (const [from, to] of HARNESS_IMPORT_REWRITES) {
    assert.ok(source.includes(from), 'harness 改写失败，源码里没有：' + from)
    source = source.replace(from, to)
  }
  writeFileSync(join(dir, 'google-shared.js'), source, 'utf8')
  writeFileSync(join(dir, 'stub-models.js'), 'export function clampThinkingLevel(model, level) { return level }\n', 'utf8')
  writeFileSync(join(dir, 'stub-misc.js'), STUB_MISC, 'utf8')
  writeFileSync(
    join(sdkDir, 'package.json'),
    JSON.stringify({ name: '@google/genai', version: '0.0.0-stub', type: 'module', main: 'index.js' }, null, 2),
    'utf8',
  )
  writeFileSync(join(sdkDir, 'index.js'), STUB_SDK, 'utf8')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'xhigh-harness-' + label, type: 'module' }, null, 2), 'utf8')
  return dir
}

test('打出来的补丁在真实代码路径上生效：xhigh 解析 + 线上档位 + SDK 取值', async (t) => {
  const { installDir, archivePath } = makeInstall(t)
  assert.equal(applyPatch({ installDir }).ok, true)
  const patchedText = readText(archivePath, googleSharedEntry)
  assert.equal(patchedText, PATCHED_TEXT)

  const root = mkdtempSync(join(tmpdir(), 'model-tuning-xhigh-harness-'))
  t.after(() => removeQuietly(root))
  const patchedDir = writeHarness(root, 'patched', patchedText)
  const originalDir = writeHarness(root, 'original', ORIGINAL_TEXT)

  // 与用户 profile 里声明的一模一样：gemini-4-hydrogen @ xhigh。
  const model = {
    provider: 'google',
    id: 'gemini-4-hydrogen',
    thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  }

  const original = await import(pathToFileURL(join(originalDir, 'google-shared.js')).href)
  assert.throws(
    () => original.resolveGoogleThinkingLevel(model, 'xhigh'),
    /Unsupported Google thinking level mapping/,
    '打补丁前 xhigh 必须抛错（复现宿主的真实缺口）',
  )

  const patched = await import(pathToFileURL(join(patchedDir, 'google-shared.js')).href)
  assert.equal(patched.resolveGoogleThinkingLevel(model, 'xhigh'), 'xhigh')
  assert.equal(patched.toGoogleThinkingLevel('xhigh'), 'XHIGH')
  assert.equal(patched.toGoogleSdkThinkingLevel(patched.toGoogleThinkingLevel('xhigh')), 'XHIGH')

  // 其它三档不受影响。
  for (const [level, wire] of [['minimal', 'MINIMAL'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]) {
    assert.equal(patched.resolveGoogleThinkingLevel(model, level), level)
    assert.equal(patched.toGoogleThinkingLevel(level), wire)
  }

  // 桩 SDK 确实没有 XHIGH —— 证明上面的 "XHIGH" 来自补丁写的裸字符串。
  const sdk = await import(pathToFileURL(join(patchedDir, 'node_modules', '@google', 'genai', 'index.js')).href)
  assert.equal(sdk.ThinkingLevel.XHIGH, undefined)
})

// ---------------------------------------------------------------------------
// 真实安装：只读观察（不写、不打补丁）
// ---------------------------------------------------------------------------

test('真实安装：只读状态可判定（当前应为 missing），读取与 dryRun 都不改动任何文件', (t) => {
  // 安装目录不再写死在源码里，而是从运行中的进程推导（纯 Node 下推不出来）。
  // 想在这台机器上覆盖这段，就把 DSH_INSTALL_DIR 指向真实的 DSH 安装目录。
  const installDir = resolveInstallDir()
  const archivePath = join(installDir, 'resources', 'app.asar')
  if (!existsSync(archivePath)) {
    t.skip('未发现宿主安装（可用 DSH_INSTALL_DIR 指定）：' + archivePath)
    return
  }
  const resourcesDir = join(installDir, 'resources')
  const before = statSync(archivePath)
  const listingBefore = readdirSync(resourcesDir).sort()

  const status = patchStatus({ installDir })
  const dry = applyPatch({ installDir, dryRun: true })
  const after = statSync(archivePath)

  t.diagnostic(`真实归档：state=${status.state} appVersion=${String(status.appVersion)} form=${status.form} backup=${String(status.backupPath)}`)
  t.diagnostic('detail: ' + status.detail)
  t.diagnostic(`dryRun：ok=${dry.ok} state=${dry.state} changed=${dry.changed} | ${dry.detail}`)

  assert.ok(status.state === 'missing' || status.state === 'patched', '真实归档状态应可判定：' + status.state)
  if (status.state === 'missing') assert.match(status.detail, /^missing: 3\/3/)
  assert.equal(status.entryPath, googleSharedEntry)
  assert.equal(typeof status.appVersion, 'string', '应能报出宿主版本')
  assert.equal(after.size, before.size, '只读操作不得改变归档大小')
  assert.equal(after.mtimeMs, before.mtimeMs, '只读操作不得改变归档 mtime')
  assert.deepEqual(readdirSync(resourcesDir).sort(), listingBefore, '只读操作不得新增/删除文件（含备份）')

  // 快照漂移提示（不判失败）：fixture 用的是固定快照，真实文本变了只提示。
  if (status.state === 'missing') {
    const live = readText(archivePath, googleSharedEntry)
    if (live !== ORIGINAL_TEXT) {
      t.diagnostic('注意：真实 google-shared.js 与 test/fixtures/google-shared.original.js 快照不同（上游版本漂移）；测试仍按快照跑。')
    }
  }
})
