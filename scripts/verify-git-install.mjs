#!/usr/bin/env node
// End-to-end check of the install path DSH uses from the market: take the generated index,
// ask pnpm to install the pinned git spec of each plugin (or of the names passed on the
// command line) into a throwaway directory, and confirm the installed manifest matches.
//
//   node scripts/verify-git-install.mjs [plugin-name ...]
//
// Requires pnpm on PATH and a pushed commit: the pinned commit has to exist on the remote.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { marketInstallTarget, parseMarketIndex } from './vendor/market-index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'market.config.json'), 'utf8'))
const index = parseMarketIndex(JSON.parse(fs.readFileSync(path.join(root, 'docs', 'index.json'), 'utf8')), config.url)

const wanted = process.argv.slice(2)
const selected = wanted.length === 0 ? index.plugins : index.plugins.filter((plugin) => wanted.includes(plugin.name))
if (selected.length === 0) {
  console.error(`verify-git-install: no plugin matched ${wanted.join(', ')}`)
  process.exit(1)
}

const pnpmCli =
  process.env.PNPM_CLI ??
  path.resolve(path.dirname(process.execPath), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
if (!fs.existsSync(pnpmCli)) {
  console.error(`verify-git-install: pnpm CLI not found at ${pnpmCli}; set PNPM_CLI to pnpm's bin/pnpm.cjs`)
  process.exit(1)
}
const failures = []

for (const plugin of selected) {
  const version = plugin.versions[0]
  const target = marketInstallTarget(plugin.name, version)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-'))
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name: 'market-verify', private: true }, null, 2)}\n`)
  console.log(`\n${plugin.name}@${version.version}`)
  console.log(`  spec: ${target.spec}`)
  try {
    // Never go through a shell: the spec contains "&", which cmd.exe would treat as a separator.
    execFileSync(process.execPath, [pnpmCli, 'add', target.spec, '--ignore-scripts', '--reporter=append-only'], {
      cwd: directory,
      stdio: 'inherit',
      timeout: 240000,
    })
    const installedFile = path.join(directory, 'node_modules', plugin.name, 'package.json')
    if (!fs.existsSync(installedFile)) {
      failures.push(`${plugin.name}: pnpm reported success but ${installedFile} is missing`)
    } else {
      const installed = JSON.parse(fs.readFileSync(installedFile, 'utf8'))
      const same = installed.version === version.version
      console.log(`  installed ${installed.name}@${installed.version} (${same ? 'matches the index' : 'DIFFERS from the index'})`)
      if (!same) failures.push(`${plugin.name}: installed ${installed.version}, index lists ${version.version}`)
      if (installed.dsh?.bundle?.patch === undefined) failures.push(`${plugin.name}: installed package declares no dsh.bundle.patch`)
    }
  } catch (error) {
    failures.push(`${plugin.name}: pnpm add failed (${error.message})`)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

if (failures.length > 0) {
  console.error('\nverify-git-install: failures')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`\nverify-git-install: ${selected.length} plugins installed from the pinned commits`)
