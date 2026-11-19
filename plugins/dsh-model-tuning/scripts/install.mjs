#!/usr/bin/env node
/**
 * 把本插件装进 desktop profile（幂等，可重复运行）。
 *
 * 为什么不用 `pnpm install`：在 profile 目录跑 pnpm 会因为「想删 node_modules
 * 但没有 TTY」直接 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY 中止；设 CI=true
 * 会真重装整棵树（风险高）。手工 junction 与 `link:` 依赖装出来的形态一致。
 *
 * 做四件事：
 *   1. `~/.dsh/profiles/desktop/node_modules/dsh-model-tuning` → 本目录的 junction；
 *   2. package.json 的 dependencies 加 `link:`（绝对路径，跨盘符安全）；
 *   3. package.json 的 `dsh.profile.bundles` 加本包名；
 *   4. cordis.patch.yml 末尾补 `- insert: - id: model-tuning`（已存在则跳过）。
 * 每一步改动前都会备份到 `.bak-before-model-tuning-<时间戳>`。
 *
 * 用法：node scripts/install.mjs [--profile <profile 目录>] [--dry-run]
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const profileFlag = args.findIndex((arg) => arg === '--profile')
const profileDir = profileFlag >= 0
  ? resolve(args[profileFlag + 1])
  : join(homedir(), '.dsh', 'profiles', 'desktop')

const packageName = 'dsh-model-tuning'
const rowId = 'model-tuning'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

const log = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`)

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`找不到 profile：${profileDir}`)
  process.exit(1)
}

const backup = (file) => {
  const target = `${file}.bak-before-model-tuning-${stamp}`
  if (!dryRun) copyFileSync(file, target)
  log(`备份 ${file} → ${target}`)
}

// 1) junction
const modulesDir = join(profileDir, 'node_modules')
const linkPath = join(modulesDir, packageName)
const linkExists = (() => {
  try {
    lstatSync(linkPath)
    return true
  } catch {
    return false
  }
})()
if (linkExists) {
  log(`已存在 ${linkPath}（跳过）`)
} else {
  log(`建立 junction ${linkPath} → ${pluginDir}`)
  if (!dryRun) {
    mkdirSync(modulesDir, { recursive: true })
    symlinkSync(pluginDir, linkPath, 'junction')
  }
}

// 2+3) package.json
const packagePath = join(profileDir, 'package.json')
const packageRaw = readFileSync(packagePath, 'utf8')
const manifest = JSON.parse(packageRaw)
let packageChanged = false

manifest.dependencies ??= {}
const dependencySpec = `link:${pluginDir.replace(/\\/g, '/')}`
if (manifest.dependencies[packageName] !== dependencySpec) {
  manifest.dependencies[packageName] = dependencySpec
  packageChanged = true
  log(`dependencies.${packageName} = ${dependencySpec}`)
}

manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
if (!manifest.dsh.profile.bundles.includes(packageName)) {
  manifest.dsh.profile.bundles.push(packageName)
  packageChanged = true
  log(`dsh.profile.bundles += ${packageName}`)
}

if (packageChanged) {
  backup(packagePath)
  if (!dryRun) writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
} else {
  log('package.json 已是目标状态（跳过）')
}

// 4) cordis.patch.yml：不要在这里插行。
// 本包自带 bundle patch（package.json 的 dsh.bundle.patch），profile 只认 `dsh.profile.bundles`
// 这一处声明。两处都插同一个 id 会让该行变成「不可寻址行」，plugin_manager 无法开关它。

log('完成。若插件页里看不到新行，把该行关一次再开一次（或重启 DSH）。')
if (dryRun) {
  // dry-run 不该留下任何东西；junction 分支已经跳过写入，这里再确认一次
  rmSync(join(modulesDir, '.model-tuning-dry-run'), { force: true })
}
