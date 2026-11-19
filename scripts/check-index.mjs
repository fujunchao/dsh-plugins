#!/usr/bin/env node
// Validates docs/index.json with the exact validator DSH uses, then prints what each
// version installs as. Run after build-index.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { marketInstallTarget, parseMarketIndex } from './vendor/market-index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'market.config.json'), 'utf8'))
const indexFile = path.join(root, 'docs', 'index.json')

if (!fs.existsSync(indexFile)) {
  console.error('check-index: docs/index.json is missing; run scripts/build-index.mjs first')
  process.exit(1)
}

const document = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
let index
try {
  index = parseMarketIndex(document, config.url)
} catch (error) {
  console.error(`check-index: DSH would reject this index — ${error.message}`)
  process.exit(1)
}

const problems = []
const packages = fs
  .readdirSync(path.join(root, 'plugins'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

if (index.plugins.length !== packages.length) {
  problems.push(`index lists ${index.plugins.length} plugins but plugins/ holds ${packages.length} directories`)
}

console.log(`format ${index.format} — ${index.plugins.length} plugins, url ${config.url}`)
for (const plugin of index.plugins) {
  const lines = []
  for (const version of plugin.versions) {
    let target
    try {
      target = marketInstallTarget(plugin.name, version)
    } catch (error) {
      problems.push(`${plugin.name}@${version.version}: ${error.message}`)
      continue
    }
    lines.push(`    ${version.version.padEnd(10)} ${target.spec}`)
    if (target.registry !== undefined) lines.push(`      registry: ${target.registry}`)
  }
  const title = typeof plugin.title === 'string' ? plugin.title : plugin.title?.en
  console.log(`  ${plugin.name}  ${title === undefined ? '' : `— ${title}`}`)
  for (const line of lines) console.log(line)

  // The index must describe the package exactly as it stands in this monorepo.
  const sourcePath = plugin.versions[0]?.source?.path
  const directory = typeof sourcePath === 'string' ? sourcePath.replace(/^plugins\//u, '') : undefined
  const manifestFile =
    directory === undefined ? '' : path.join(root, 'plugins', directory, 'package.json')
  if (manifestFile === '' || !fs.existsSync(manifestFile)) {
    problems.push(`${plugin.name}: no package directory at ${String(sourcePath)}`)
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    const listed = plugin.versions[0]?.version
    if (manifest.name !== plugin.name) {
      problems.push(`${plugin.name}: package.json names ${manifest.name}`)
    }
    if (manifest.version !== listed) {
      problems.push(`${plugin.name}: index lists ${listed} but package.json says ${manifest.version}`)
    }
    const declared = plugin.versions[0]?.engines?.dsh
    if (manifest.engines?.dsh !== declared) {
      problems.push(`${plugin.name}: engines.dsh differs between index and package.json`)
    }
    if (plugin.repository?.directory !== sourcePath) {
      problems.push(`${plugin.name}: repository.directory is ${plugin.repository?.directory}, source path is ${sourcePath}`)
    }
  }
}

if (problems.length > 0) {
  console.error('\ncheck-index: problems found:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\ncheck-index: ok — format 1 is valid and every version matches its package')
