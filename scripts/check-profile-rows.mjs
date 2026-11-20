#!/usr/bin/env node
// Checks the active DSH profile for plugin rows the Loader cannot resolve.
//
// A profile mounts a plugin in one of three ways: as a dependency whose package declares a bundle
// patch, as a row that a bundle's own patch inserts, or as a raw `insert` row in cordis.patch.yml
// that names the module directly. Only the first two are visible to the plugin market — it reads
// `pluginManager.listBundles()` — while the third keeps working purely because the file it names
// is still there. Move that directory and the row dangles: the market still reports the plugin as
// not installed, the Loader loses it on the next start, and nothing in the repo notices.
//
// This walks every insert row of the active profile and proves its target still resolves.
//
// Usage: node scripts/check-profile-rows.mjs [--strict] [--profile <dir>]
//   --strict   also fail on a mounted plugin the market cannot see (a raw row standing in for a bundle)
//   --profile  profile directory; defaults to $DSH_PROFILE_DIR, else ~/.dsh/profiles/$DSH_PROFILE or desktop
// Exits 0 without a profile, so a CI checkout with no DSH install stays green.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const strict = args.includes('--strict')
const named = args.indexOf('--profile')
const profile = named === -1
  ? (process.env.DSH_PROFILE_DIR ?? path.join(os.homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop'))
  : path.resolve(args[named + 1])

const manifestFile = path.join(profile, 'package.json')
if (!fs.existsSync(manifestFile)) {
  console.log(`check-profile-rows: no profile at ${profile}; skipped`)
  process.exit(0)
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const dependencies = Object.keys(manifest.dependencies ?? {})
const bundles = manifest.dsh?.profile?.bundles ?? []
const resolve = createRequire(manifestFile)

/** Every plugin the snapshot publishes, by package name. */
function snapshotPlugins() {
  const found = new Map()
  const directory = path.join(root, 'plugins')
  for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
    const file = path.join(directory, entry, 'package.json')
    if (!fs.existsSync(file)) continue
    const name = JSON.parse(fs.readFileSync(file, 'utf8')).name
    if (typeof name === 'string') found.set(name, { dir: path.join(directory, entry), file })
  }
  return found
}

/** Insert rows of a patch file: `- insert:` followed by nested `- id:` and `name:` lines. */
function insertRows(file) {
  const rows = []
  let current
  let inside = false
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '')
    if (/^- insert:\s*$/u.test(line)) { inside = true; current = undefined; continue }
    if (/^\S/u.test(line)) inside = false
    if (!inside) continue
    const id = /^\s*-\s+id:\s*(.+?)\s*$/u.exec(line)
    if (id) { current = { id: id[1].replace(/^['"]|['"]$/gu, '') }; rows.push(current); continue }
    const name = /^\s+name:\s*(.+?)\s*$/u.exec(line)
    if (name && current !== undefined) current.name = name[1].replace(/^['"]|['"]$/gu, '')
  }
  return rows.filter(row => row.name !== undefined)
}

/** Resolve one row the way the Loader would: a file URL, or a package in the profile. */
function resolveRow(name) {
  if (name.startsWith('file://')) {
    const file = decodeURIComponent(new URL(name).pathname).replace(/^\/([A-Za-z]:)/u, '$1')
    return fs.existsSync(file) ? { ok: true, kind: 'file', at: file } : { ok: false, kind: 'file', at: file }
  }
  for (const candidate of [name, `${name}/package.json`]) {
    try { return { ok: true, kind: 'package', at: resolve.resolve(candidate) } } catch { /* try the next form */ }
  }
  return { ok: false, kind: 'package', at: name }
}

/** The package behind a row: the row name itself, or the package directory a file URL points into. */
function packageOf(row) {
  if (!row.name.startsWith('file://')) return row.name
  const file = decodeURIComponent(new URL(row.name).pathname)
  const match = /[\\/]([^\\/]+)[\\/](?:lib|src|dist)[\\/]/u.exec(file)
  return match === null ? undefined : match[1]
}

/** Whether the market lists a package as installed: a dependency whose package declares a bundle patch, or a selected bundle. */
function marketVisible(name) {
  if (name === undefined || !dependencies.includes(name)) return false
  if (bundles.includes(name)) return true
  try {
    return JSON.parse(fs.readFileSync(resolve.resolve(`${name}/package.json`), 'utf8')).dsh?.bundle !== undefined
  } catch {
    return false
  }
}

const patchFile = path.join(profile, 'cordis.patch.yml')
if (!fs.existsSync(patchFile)) {
  console.log(`check-profile-rows: no cordis.patch.yml in ${profile}; nothing to check`)
  process.exit(0)
}

const plugins = snapshotPlugins()
const rows = insertRows(patchFile)
const broken = []
const blind = []
const pad = (value, width) => String(value).padEnd(width)
const rowWidth = Math.max(20, ...rows.map(row => row.id.length + 2))
const nameWidth = Math.max(18, ...rows.map(row => (packageOf(row) ?? '-').length + 2))

console.log(`profile: ${profile}`)
console.log(`${pad('row', rowWidth + 2)}${pad('target', 10)}${pad('snapshot plugin', nameWidth)}where`)
for (const row of rows) {
  const target = resolveRow(row.name)
  const name = packageOf(row)
  const known = name !== undefined && plugins.has(name)
  const hidden = known && !marketVisible(name)
  console.log(`  ${pad(row.id, rowWidth)}${pad(target.ok ? 'ok' : 'MISSING', 10)}${pad(known ? name : '-', nameWidth)}${target.at}`)
  if (!target.ok) broken.push(row)
  else if (hidden) blind.push({ row, name })
}

for (const { row, name } of blind) {
  console.log(`warn  ${row.id}: mounted by a raw row, but the market reads ${name} as not installed — its Discover card keeps offering 安装`)
}

if (broken.length > 0) {
  console.error('\ncheck-profile-rows: failed')
  for (const row of broken) console.error(`  - row "${row.id}" names ${row.name}, which does not exist: the plugin is gone on the next start`)
  process.exit(1)
}
if (strict && blind.length > 0) {
  console.error('\ncheck-profile-rows: failed (--strict)')
  for (const { row, name } of blind) console.error(`  - row "${row.id}" stands in for a bundle: make ${name} a dependency with a dsh.bundle patch`)
  process.exit(1)
}
console.log(`\ncheck-profile-rows: ok — ${rows.length} insert row(s), ${plugins.size} snapshot package(s) checked${blind.length === 0 ? '' : `, ${blind.length} raw row(s) invisible to the market`}`)
