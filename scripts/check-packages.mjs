#!/usr/bin/env node
// Pre-publication health check for every package under plugins/: a DSH bundle has to satisfy
// these rules before the market index may list it, and a public repository must not leak
// machine-specific paths. Exit code 1 means at least one package is not releasable.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import semver from 'semver'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'market.config.json'), 'utf8'))
const pluginsRoot = path.join(root, 'plugins')

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.md', '.yml', '.yaml'])
const MACHINE_PATH = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/[a-z])/u
const MAX_ICON_BYTES = 256 * 1024

/** Expand the package.json `files` whitelist into the paths npm would actually publish. */
function shippedFiles(packageDirectory, patterns) {
  const files = new Set()
  const addDirectory = (directory) => {
    for (const file of walk(path.join(packageDirectory, directory))) {
      files.add(path.relative(packageDirectory, file).split(path.sep).join('/'))
    }
  }
  for (const pattern of patterns) {
    const normalized = pattern.replace(/^\.\//u, '')
    if (normalized.includes('*')) {
      const directory = path.posix.dirname(normalized)
      const extension = path.posix.extname(normalized)
      if (!fs.existsSync(path.join(packageDirectory, directory))) continue
      for (const entry of fs.readdirSync(path.join(packageDirectory, directory))) {
        if (extension === '' || entry.endsWith(extension)) files.add(`${directory}/${entry}`)
      }
      continue
    }
    const absolute = path.join(packageDirectory, normalized)
    if (!fs.existsSync(absolute)) continue
    if (fs.statSync(absolute).isDirectory()) addDirectory(normalized)
    else files.add(normalized)
  }
  return files
}

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const packages = fs
  .readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

let failures = 0
let warnings = 0
const fail = (name, message) => {
  failures += 1
  console.log(`  FAIL  ${message}`)
}
const warn = (name, message) => {
  warnings += 1
  console.log(`  WARN  ${message}`)
}

for (const directory of packages) {
  const packageDirectory = path.join(pluginsRoot, directory)
  const manifestFile = path.join(packageDirectory, 'package.json')
  console.log(`\n${directory}`)
  if (!fs.existsSync(manifestFile)) {
    fail(directory, 'no package.json')
    continue
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))

  if (manifest.name.split('/').pop() !== directory) {
    fail(directory, `package name ${manifest.name} must end with the directory name ${directory}`)
  }
  if (!semver.valid(manifest.version)) fail(directory, `version ${manifest.version} is not exact SemVer`)
  if (typeof manifest.engines?.dsh !== 'string' || semver.validRange(manifest.engines.dsh) === null) {
    fail(directory, 'engines.dsh must be a SemVer range so DSH can check compatibility')
  }
  for (const field of ['description', 'license', 'homepage', 'keywords', 'author']) {
    if (!manifest[field] || (Array.isArray(manifest[field]) && manifest[field].length === 0)) {
      fail(directory, `package.json needs ${field}`)
    }
  }
  if (manifest.repository?.url !== `git+${config.repositoryUrl}.git`) {
    fail(directory, `repository.url must be git+${config.repositoryUrl}.git`)
  }
  if (manifest.repository?.directory !== `plugins/${directory}`) {
    fail(directory, `repository.directory must be plugins/${directory}`)
  }

  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string') fail(directory, 'dsh.bundle.patch is required for a market-listed bundle')
  else if (!fs.existsSync(path.join(packageDirectory, patch))) fail(directory, `dsh.bundle.patch names a missing file: ${patch}`)

  const main = manifest.main ?? manifest.exports?.['.']?.default ?? manifest.exports?.['.']
  if (typeof main === 'string' && !fs.existsSync(path.join(packageDirectory, main))) {
    fail(directory, `main entry is missing: ${main}`)
  }
  const client = manifest.exports?.['./client']?.default ?? manifest.exports?.['./client']
  if (typeof client === 'string' && !fs.existsSync(path.join(packageDirectory, client))) {
    fail(directory, `client entry is missing: ${client}`)
  }

  const icon = ['icon.svg', 'icon.png', 'icon.webp', 'icon.jpg'].find((file) =>
    fs.existsSync(path.join(packageDirectory, file)),
  )
  if (icon === undefined) {
    fail(directory, 'icon.svg is required so the market card and the plugin row show artwork')
  } else {
    const iconFile = path.join(packageDirectory, icon)
    if (fs.statSync(iconFile).size > MAX_ICON_BYTES) fail(directory, `${icon} exceeds 256 KiB`)
    if (icon.endsWith('.svg')) {
      const svg = fs.readFileSync(iconFile, 'utf8')
      if (!svg.includes('viewBox')) fail(directory, `${icon} needs a viewBox`)
      if (/(?:<script|<style|<image|foreignObject|onload=)/u.test(svg)) fail(directory, `${icon} must not carry scripts, style, raster images or handlers`)
    }
  }

  for (const language of ['en', 'zh']) {
    const localeFile = path.join(packageDirectory, 'locale', `${language}.json`)
    if (!fs.existsSync(localeFile)) {
      fail(directory, `locale/${language}.json is required for the plugin page title and description`)
      continue
    }
    let meta
    try {
      meta = JSON.parse(fs.readFileSync(localeFile, 'utf8')).meta
    } catch {
      fail(directory, `locale/${language}.json is not valid JSON`)
      continue
    }
    if (typeof meta?.title !== 'string' || meta.title.trim() === '') fail(directory, `locale/${language}.json needs meta.title`)
    if (typeof meta?.description !== 'string' || meta.description.trim() === '') {
      fail(directory, `locale/${language}.json needs meta.description`)
    }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : []
  for (const required of ['cordis.patch.yml', 'locale', 'icon.svg']) {
    if (!files.includes(required)) fail(directory, `package.json files must list ${required}`)
  }
  for (const subpath of ['./locale/*.json', './icon']) {
    if (manifest.exports?.[subpath] === undefined) {
      fail(directory, `package.json exports must declare ${subpath} so Plugin Manager can read the display metadata`)
    }
  }
  if (typeof main === 'string' && !files.includes(path.posix.dirname(main.replace(/^\.\//u, '')))) {
    fail(directory, `package.json files must list ${path.posix.dirname(main.replace(/^\.\//u, ''))}`)
  }
  if (fs.existsSync(path.join(packageDirectory, 'docs')) && !files.includes('docs')) {
    fail(directory, 'package.json files must list docs because the directory exists')
  }

  for (const file of ['README.md', 'LICENSE', '.gitignore']) {
    if (!fs.existsSync(path.join(packageDirectory, file))) fail(directory, `${file} is required`)
  }
  const readme = path.join(packageDirectory, 'README.md')
  if (fs.existsSync(readme) && !fs.readFileSync(readme, 'utf8').startsWith('# ')) {
    fail(directory, 'README.md must start with a level-one heading')
  }

  const market = manifest.dsh?.market
  if (market === undefined) {
    fail(directory, 'dsh.market must declare a category from market.config.json')
  } else if (market.category !== undefined && !Object.hasOwn(config.categories, market.category)) {
    fail(directory, `dsh.market.category ${market.category} is not declared in market.config.json`)
  }

  for (const file of walk(packageDirectory)) {
    const relative = path.relative(packageDirectory, file).split(path.sep).join('/')
    if (/\bbak-/u.test(path.basename(file)) || path.basename(file).endsWith('.bak')) {
      fail(directory, `backup file must not be published: ${relative}`)
    }
  }

  for (const relative of shippedFiles(packageDirectory, files)) {
    if (!TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) continue
    const file = path.join(packageDirectory, relative)
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const hit = MACHINE_PATH.exec(text)
    if (hit === null) continue
    const sample = text.slice(hit.index, hit.index + 40)
    // `C:\Users\<you>\...` in a README is a placeholder, not a leak of this machine.
    if (sample.includes('<')) continue
    const line = text.slice(0, hit.index).split('\n').length
    fail(directory, `machine-specific path in ${relative}:${line} (${JSON.stringify(sample)})`)
  }

  if (!fs.existsSync(path.join(packageDirectory, 'test')) && !fs.existsSync(path.join(packageDirectory, 'tests'))) {
    warn(directory, 'no test directory')
  }
}

console.log(`\ncheck-packages: ${packages.length} packages, ${failures} failures, ${warnings} warnings`)
if (failures > 0) process.exit(1)
