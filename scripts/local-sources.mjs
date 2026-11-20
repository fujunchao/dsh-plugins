// Shared plumbing for the two scripts that keep plugins/<name> in step with the working
// copies named in market.sources.local.json: where those copies are, which files are code,
// and which values must never be published. The list itself is local-only (gitignored)
// because it holds absolute paths and the real values behind the demo ones.
import fs from 'node:fs'
import path from 'node:path'

import semver from 'semver'

/** The local-only configuration file, relative to the repository root. */
export const SOURCES_FILE = 'market.sources.local.json'

/** Directories the working copy always owns; everything else in a package is the snapshot's. */
export const CODE_DIRECTORIES = ['lib', 'src']

/** Directories the working copy owns only when it keeps them itself (a package may ship its own suite). */
export const OPTIONAL_DIRECTORIES = ['test', 'tests']

/**
 * Read `market.sources.local.json`.
 * @param root - Repository root.
 * @returns The parsed sources, or `undefined` when this machine has no working copies configured.
 */
export function readLocalSources(root) {
  const file = path.join(root, SOURCES_FILE)
  if (!fs.existsSync(file)) return undefined
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${SOURCES_FILE}: ${error.message}`)
  }
  if (raw.plugins === null || typeof raw.plugins !== 'object' || Array.isArray(raw.plugins) || Object.keys(raw.plugins).length === 0) {
    throw new Error(`${SOURCES_FILE}: "plugins" must map at least one package name to its working copy`)
  }
  const plugins = new Map()
  for (const [name, directory] of Object.entries(raw.plugins)) {
    if (typeof directory !== 'string' || directory.trim() === '') {
      throw new Error(`${SOURCES_FILE}: plugins.${name} must be a directory path`)
    }
    if (!path.isAbsolute(directory)) {
      throw new Error(`${SOURCES_FILE}: plugins.${name} must be absolute, got ${directory}`)
    }
    plugins.set(name, path.resolve(directory))
  }
  const scrub = Object.entries(raw.scrub ?? {})
  for (const [real, demo] of scrub) {
    if (typeof demo !== 'string' || demo === '') {
      throw new Error(`${SOURCES_FILE}: scrub["${real}"] must name the value to publish instead`)
    }
  }
  return { file, plugins, scrub }
}

/**
 * Map every package name to its directory under plugins/, which is not always the name itself
 * (a scoped package such as @dsh-external/dsh-research-team sits in plugins/dsh-research-team).
 * @param root - Repository root.
 * @returns Package name to absolute directory.
 */
export function snapshotDirectories(root) {
  const pluginsRoot = path.join(root, 'plugins')
  const directories = new Map()
  for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestFile = path.join(pluginsRoot, entry.name, 'package.json')
    if (!fs.existsSync(manifestFile)) continue
    const manifest = readJson(manifestFile)
    if (typeof manifest.name !== 'string') continue
    const seen = directories.get(manifest.name)
    if (seen !== undefined) {
      throw new Error(`${manifest.name} is declared twice: ${path.relative(root, seen)} and ${path.relative(root, pluginsRoot + '/' + entry.name)}`)
    }
    directories.set(manifest.name, path.join(pluginsRoot, entry.name))
  }
  return directories
}

/** Backup, editor and shell leftovers that are never part of a package. */
export function isScratch(name) {
  return /\.(bak|orig|rej|tmp|log|swp)$/u.test(name)
    || name.endsWith('~')
    || name.includes('.bak-')
    || name === '.DS_Store'
    || name === 'Thumbs.db'
    || name === 'desktop.ini'
}

/**
 * List every file below a directory as a `/`-separated relative path.
 * @param directory - Directory to walk.
 * @param relative - Prefix used internally.
 * @param out - Accumulator used internally.
 * @returns Relative paths, sorted.
 */
export function walkFiles(directory, relative = '', out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || isScratch(entry.name)) continue
    const next = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) walkFiles(path.join(directory, entry.name), next, out)
    else out.push(next)
  }
  return out.sort()
}

/** The directories of a package the working copy owns, judging by what it actually holds. */
export function ownedDirectories(working) {
  const directories = []
  for (const nested of CODE_DIRECTORIES) {
    const absolute = path.join(working, nested)
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) directories.push(nested)
  }
  for (const nested of OPTIONAL_DIRECTORIES) {
    const absolute = path.join(working, nested)
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) directories.push(nested)
  }
  return directories
}

/** Every file below the owned directories of a package, as `/`-separated relative paths. */
export function ownedFiles(directory, directories) {
  const files = []
  for (const nested of directories) {
    const absolute = path.join(directory, nested)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) continue
    for (const file of walkFiles(absolute)) files.push(`${nested}/${file}`)
  }
  return files.sort()
}

/** Replace CRLF and lone CR with LF so two checkouts of one file compare equal. */
export function normaliseEol(text) {
  return text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')
}

/** Whether a buffer is text that may be scrubbed and EOL-normalised. */
export function isText(buffer) {
  const probe = buffer.subarray(0, Math.min(buffer.length, 8192))
  return !probe.includes(0)
}

/** Apply the scrub pairs: the real values never leave this machine. */
export function scrubText(text, pairs) {
  let out = text
  for (const [real, demo] of pairs) out = out.split(real).join(demo)
  return out
}

/** The end-of-line style a file uses, so a rewrite keeps the checkout's shape. */
export function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Restore a given end-of-line style to LF-normalised text. */
export function withEol(text, eol) {
  return eol === '\n' ? text : text.split('\n').join(eol)
}

/** Read a JSON file and name it in the error when it is broken. */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file}: ${error.message}`)
  }
}

/** Fields copied from the working copy when it declares them. */
const RUNTIME_SCALARS = ['main', 'type', 'bin']

/**
 * The version to publish: the higher of the two, so a release is never un-published and a stale
 * working copy cannot hold the market back. Both scripts read this one rule.
 * @param published - `plugins/<name>/package.json` version.
 * @param local - The working copy's version.
 * @returns The version both sides should carry.
 */
export function nextVersion(published, local) {
  if (semver.valid(published) === null) return local
  if (semver.valid(local) === null) return published
  return semver.gt(published, local) ? published : local
}

/** `base`'s entries in `base`'s order, then whatever only `extra` declares. */
function orderedMerge(base, extra) {
  const merged = {}
  for (const [key, value] of Object.entries(base ?? {})) merged[key] = value
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (merged[key] === undefined) merged[key] = value
  }
  return merged
}
/** Fields copied verbatim from the working copy, deletion included. */
const RUNTIME_MAPS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'peerDependenciesMeta']

/**
 * The published manifest: the snapshot's packaging fields plus the working copy's runtime truth.
 * One function so `sync-snapshot` writes exactly what `check-drift` expects to find.
 * @param name - Package name, for warnings.
 * @param snapshotManifest - plugins/<name>/package.json as it stands.
 * @param workingManifest - The working copy's manifest.
 * @param version - The version to publish.
 * @param warnings - Collector for every decision the merge had to make.
 */
export function mergeManifest(name, snapshotManifest, workingManifest, version, warnings) {
  const next = { ...snapshotManifest, version }
  for (const field of RUNTIME_SCALARS) {
    if (workingManifest[field] !== undefined) next[field] = workingManifest[field]
  }
  // Keywords are search material the market curated; a keyword the working copy adds is new
  // search material, so the lists merge instead of one replacing the other.
  const keywords = [...new Set([...(snapshotManifest.keywords ?? []), ...(workingManifest.keywords ?? [])])]
  if (keywords.length > 0) next.keywords = keywords
  else delete next.keywords
  for (const field of RUNTIME_MAPS) {
    const published = snapshotManifest[field] ?? {}
    const local = workingManifest[field] ?? {}
    if (Object.keys(published).length === 0 && Object.keys(local).length === 0) {
      delete next[field]
      continue
    }
    next[field] = orderedMerge(published, local)
    for (const dependency of Object.keys(local)) {
      if (published[dependency] === undefined) {
        warnings.push(`${name}: ${field}.${dependency} is new; publishes as ${String(local[dependency])}`)
      } else if (published[dependency] !== local[dependency]) {
        warnings.push(`${name}: ${field}.${dependency} — published ${String(published[dependency])} wins over the working copy's ${String(local[dependency])}`)
      }
    }
    for (const dependency of Object.keys(published)) {
      if (local[dependency] === undefined) {
        warnings.push(`${name}: ${field}.${dependency} is published but absent from the working copy; kept`)
      }
    }
  }
  // engines.dsh is what the market reads for compatibility, so the snapshot owns it.
  if (workingManifest.engines !== undefined || snapshotManifest.engines !== undefined) {
    next.engines = orderedMerge(snapshotManifest.engines, workingManifest.engines)
  }
  // dsh.bundle / dsh.market belong to the market; dsh.client describes how the code runs.
  if (workingManifest.dsh?.client !== undefined || snapshotManifest.dsh !== undefined) {
    next.dsh = { ...snapshotManifest.dsh, ...workingManifest.dsh?.client === undefined ? {} : { client: workingManifest.dsh.client } }
  }
  return next
}

/**
 * Top-level manifest fields where two manifests differ, ignoring key order.
 * @param left - One manifest.
 * @param right - The other manifest.
 */
export function manifestFieldsDiffering(left, right) {
  const fields = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...fields].filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field])).sort()
}

/**
 * The first line two texts disagree on, for reports that point somewhere.
 * @returns A 1-based line number, or `undefined` when the texts are equal.
 */
export function firstDifference(left, right) {
  const a = normaliseEol(left).split('\n')
  const b = normaliseEol(right).split('\n')
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return index + 1
  }
  return undefined
}

/** Every path an `exports` value points at, however the conditions wrap it. */
function exportTargets(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) exportTargets(nested, out)
  }
  return out.sort()
}

/**
 * `exports` is packaging shape and stays the snapshot's; this reports when the working copy
 * declares an entry point the published package would not expose, which breaks an install.
 * @returns One line per uncovered key or retargeted path.
 */
export function exportCoverage(snapshotExports, workingExports) {
  if (workingExports === undefined || workingExports === null) return []
  if (snapshotExports === undefined || snapshotExports === null) {
    return ['the snapshot publishes no exports while the working copy declares some']
  }
  const problems = []
  for (const key of Object.keys(workingExports)) {
    if (!(key in snapshotExports)) {
      problems.push(`exports["${key}"] is missing from the published package.json`)
      continue
    }
    const working = exportTargets(workingExports[key]).join(', ')
    const published = exportTargets(snapshotExports[key]).join(', ')
    if (working !== published) {
      problems.push(`exports["${key}"] points at ${working} locally but ${published} in the snapshot`)
    }
  }
  return problems
}