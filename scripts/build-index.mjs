#!/usr/bin/env node
// Builds docs/index.json: the plugin market index (format 1) that DSH's Discover page reads.
//
// Every listed version is pinned to the commit running this build, with `path` naming the
// package directory inside this monorepo, so DSH installs
//   git+https://github.com/fujunchao/dsh-plugins.git#<commit>&path:/plugins/<name>
// A plugin package participates by declaring dsh.bundle.patch, exactly like any other bundle.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'market.config.json'), 'utf8'))
const argv = process.argv.slice(2)
const option = (name) => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

const siteUrl = option('--url') ?? config.url
const commit =
  option('--commit') ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/u.test(commit)) {
  console.error(`build-index: --commit must be a full 40-hex commit, got ${JSON.stringify(commit)}`)
  process.exit(1)
}

const pluginsRoot = path.join(root, 'plugins')
const docsDir = path.join(root, 'docs')
const iconsDir = path.join(docsDir, 'icons')
fs.rmSync(iconsDir, { recursive: true, force: true })
fs.mkdirSync(iconsDir, { recursive: true })

const ICON_FILES = ['icon.svg', 'icon.png', 'icon.webp', 'icon.jpg', 'icon.jpeg']
const now = Math.floor(Date.now() / 1000)

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const git = (gitArgs) =>
  execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function lastCommitSeconds(directory) {
  const relative = path.relative(root, directory).split(path.sep).join('/')
  try {
    const seconds = git(['log', '-1', '--format=%ct', '--', relative])
    return seconds === '' ? undefined : Number(seconds)
  } catch {
    return undefined
  }
}

/** meta.title / meta.description from locale/<lang>.json, the same fields Plugin Manager shows. */
function localizedMeta(directory, field) {
  const text = {}
  for (const language of ['en', 'zh']) {
    const file = path.join(directory, 'locale', `${language}.json`)
    if (!fs.existsSync(file)) continue
    const meta = readJson(file).meta ?? {}
    const value = meta[field]
    if (typeof value === 'string' && value.trim() !== '') text[language] = value
  }
  return text
}

function iconOf(directory, fileStem) {
  for (const candidate of ICON_FILES) {
    const file = path.join(directory, candidate)
    if (!fs.existsSync(file)) continue
    const extension = path.extname(candidate)
    const target = `${fileStem}${extension}`
    fs.copyFileSync(file, path.join(iconsDir, target))
    return `icons/${target}`
  }
  return undefined
}

const pluginDirectories = fs
  .readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const plugins = []
const problems = []

for (const directory of pluginDirectories) {
  const packageDirectory = path.join(pluginsRoot, directory)
  const manifestFile = path.join(packageDirectory, 'package.json')
  if (!fs.existsSync(manifestFile)) {
    problems.push(`${directory}: no package.json`)
    continue
  }
  const manifest = readJson(manifestFile)
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    problems.push(`${directory}: dsh.bundle.patch is missing, so DSH cannot install it as a bundle`)
    continue
  }
  if (!fs.existsSync(path.join(packageDirectory, patch))) {
    problems.push(`${directory}: dsh.bundle.patch names a missing file: ${patch}`)
    continue
  }

  const market = manifest.dsh?.market ?? {}
  if (market.category !== undefined && !Object.hasOwn(config.categories, market.category)) {
    problems.push(`${directory}: dsh.market.category ${JSON.stringify(market.category)} is not declared in market.config.json`)
    continue
  }

  const title = localizedMeta(packageDirectory, 'title')
  const description = localizedMeta(packageDirectory, 'description')
  const icon = iconOf(packageDirectory, directory)
  const author =
    typeof manifest.author === 'string' ? manifest.author : manifest.author?.name
  const publishTimestamp = lastCommitSeconds(packageDirectory) ?? now

  plugins.push({
    order: typeof market.order === 'number' ? market.order : 1000,
    entry: {
      name: manifest.name,
      ...(Object.keys(title).length > 0 ? { title } : {}),
      ...(Object.keys(description).length > 0 ? { description } : {}),
      ...(icon === undefined ? {} : { icon }),
      ...(typeof author === 'string' && author !== '' ? { author } : {}),
      ...(typeof manifest.homepage === 'string' ? { homepage: manifest.homepage } : {}),
      repository: { url: config.repositoryUrl, directory: `plugins/${directory}` },
      metadata: {
        ...(market.category === undefined ? {} : { category: market.category }),
        ...(Array.isArray(market.labels) ? { labels: market.labels } : {}),
        keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
      },
      versions: [
        {
          version: manifest.version,
          publishTimestamp,
          source: {
            type: 'git',
            url: config.repositoryUrl,
            commit,
            path: `plugins/${directory}`,
          },
          ...(typeof manifest.engines?.dsh === 'string'
            ? { engines: { dsh: manifest.engines.dsh } }
            : {}),
        },
      ],
    },
  })
}

if (problems.length > 0) {
  console.error('build-index: refusing to write an index with unlistable packages:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

plugins.sort((left, right) => left.order - right.order || left.entry.name.localeCompare(right.entry.name))

const index = {
  format: 1,
  title: config.title,
  description: config.description,
  metadata: { categories: config.categories },
  plugins: plugins.map((item) => item.entry),
}

fs.mkdirSync(docsDir, { recursive: true })
fs.writeFileSync(path.join(docsDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

console.log(`index written: docs/index.json (${index.plugins.length} plugins, commit ${commit})`)
for (const entry of index.plugins) {
  console.log(`  ${entry.name.padEnd(24)} ${entry.versions[0].version.padEnd(10)} ${entry.icon ?? '(no icon)'}`)
}
console.log(`index url: ${siteUrl}`)
