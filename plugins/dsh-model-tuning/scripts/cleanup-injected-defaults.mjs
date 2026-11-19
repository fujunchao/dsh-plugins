// 修复一次写入事故：把适配器注入的空默认值从用户配置里剔除。
// 只处理两种形态：`input: []`（空模态列表）与只含两个空 kwargs 的 compat 块。
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const file = join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const raw = readFileSync(file, 'utf8')
const lines = raw.split(/\r?\n/)
const out = []
let removed = 0

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  if (/^\s*input:\s*\[\]\s*$/.test(line)) { removed++; continue }
  if (/^\s*compat:\s*$/.test(line)) {
    const block = []
    let j = i + 1
    while (j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*- /.test(lines[j])) {
      if (/^\s*chatTemplateKwargs:\s*\{\}\s*$/.test(lines[j]) || /^\s*chatTemplateArgs:\s*\{\}\s*$/.test(lines[j])) {
        block.push(j)
        j++
        continue
      }
      break
    }
    if (j > i + 1 && block.length === j - i - 1) {
      removed += block.length + 1
      i = j - 1
      continue
    }
  }
  out.push(line)
}

const next = out.join('\n')
if (next === raw) {
  console.log('无需修复')
} else {
  copyFileSync(file, `${file}.bak-before-junk-cleanup-${Date.now()}`)
  writeFileSync(file, next, 'utf8')
  console.log(`已移除 ${removed} 行注入默认值`)
}
