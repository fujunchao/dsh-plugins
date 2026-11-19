#!/usr/bin/env node
// Runs each package's own test (or check) script. Packages whose suites import published
// dependencies cannot run without an install, so a MODULE_NOT_FOUND is reported as skipped
// instead of failing; any other failure fails the build.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsRoot = path.join(root, 'plugins')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const MISSING_MODULE = /Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/u
// A test script whose runner binary comes from node_modules (vitest, tsx, ...) fails this way.
const MISSING_TOOL = /is not recognized as an internal or external command|command not found|: not found$/u

const packages = fs
  .readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const passed = []
const skipped = []
const failed = []

for (const directory of packages) {
  const packageDirectory = path.join(pluginsRoot, directory)
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'))
  if (manifest.scripts?.test === undefined && manifest.scripts?.check === undefined) {
    skipped.push(`${directory}: no test or check script`)
    continue
  }
  const command = manifest.scripts?.test === undefined ? ['run', 'check'] : ['test']
  const result = spawnSync(npm, [...command, '--silent'], {
    cwd: packageDirectory,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const summary = output
    .split('\n')
    .filter((line) => /^# (?:pass|fail|tests) /u.test(line))
    .join(' ')
  if (result.status === 0) {
    passed.push(`${directory}${summary === '' ? '' : ` (${summary.trim()})`}`)
    continue
  }
  if (MISSING_MODULE.test(output) || MISSING_TOOL.test(output)) {
    skipped.push(`${directory}: suite needs installed dependencies`)
    continue
  }
  failed.push({ directory, output })
}

for (const line of passed) console.log(`passed  ${line}`)
for (const line of skipped) console.log(`skipped ${line}`)
for (const { directory, output } of failed) {
  console.error(`\nFAILED ${directory}`)
  console.error(
    output
      .split('\n')
      .slice(-25)
      .map((line) => `  ${line}`)
      .join('\n'),
  )
}
console.log(`\ntest-all: ${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed`)
if (failed.length > 0) process.exit(1)
