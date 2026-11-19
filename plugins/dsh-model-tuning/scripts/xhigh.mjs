#!/usr/bin/env node
/**
 * xhigh 补丁的命令行入口。
 *
 * 为什么需要它：DSH 跑起来时 `app.asar` 以目录形态挂载，宿主进程内写不了它
 * （Windows 上 rename 还会撞 EPERM）。所以插件页在「宿主正在运行」时给出的
 * 正解是：完全退出 DSH，然后跑这条命令。
 *
 * 用法（在 dsh-model-tuning 目录下）：
 *   node scripts/xhigh.mjs status
 *   node scripts/xhigh.mjs apply      # 需先完全退出 DSH
 *   node scripts/xhigh.mjs rollback
 *   node scripts/xhigh.mjs apply --dry-run
 *   node scripts/xhigh.mjs status --install-dir "<DSH 安装目录>"
 *
 * 定位宿主的顺序：`--install-dir` 参数 > 环境变量 `DSH_INSTALL_DIR` > 从运行中的
 * Electron 进程推导（`process.resourcesPath` / `process.execPath`）。纯 Node 跑这条命令时
 * 推不出宿主目录，所以要么传参数，要么设 `DSH_INSTALL_DIR`。
 */
import { applyPatch, patchStatus, rollbackPatch } from '../lib/xhigh.js'

const args = process.argv.slice(2)
const command = args.find((arg) => !arg.startsWith('-')) ?? 'status'
const dryRun = args.includes('--dry-run') || args.includes('-n')
const installIndex = args.findIndex((arg) => arg === '--install-dir')
const installDir = installIndex >= 0 ? args[installIndex + 1] : undefined

const describe = (patch) => {
  const lines = [
    `状态：${patch.state}${patch.dryRun === true ? '（dry run）' : ''}`,
    patch.detail === undefined || patch.detail === '' ? null : `说明：${patch.detail}`,
    patch.appVersion === undefined ? null : `宿主版本：${patch.appVersion}`,
    patch.archivePath === undefined ? null : `归档：${patch.archivePath}`,
    patch.backupPath === null || patch.backupPath === undefined ? null : `备份：${patch.backupPath}`,
  ]
  return lines.filter((line) => line !== null).join('\n')
}

try {
  if (command === 'status') {
    console.log(describe(patchStatus({ installDir })))
  } else if (command === 'apply') {
    const result = applyPatch({ installDir, dryRun })
    console.log(describe(result))
    if (result.ok === true && dryRun !== true) console.log('已写入：请完全重启 DeepSeekRuntime 后 xhigh 才生效。')
    if (result.ok !== true) process.exitCode = 1
  } else if (command === 'rollback') {
    const result = rollbackPatch({ installDir, dryRun })
    console.log(describe(result))
    if (result.ok === true && dryRun !== true) console.log('已回滚：请完全重启 DeepSeekRuntime。')
    if (result.ok !== true) process.exitCode = 1
  } else {
    console.error(`未知命令：${command}（可用：status | apply | rollback）`)
    process.exitCode = 2
  }
} catch (error) {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
