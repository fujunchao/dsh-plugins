#!/usr/bin/env node
// Copies code from the working copies named in market.sources.local.json into plugins/<name>,
// and carries the version plus the runtime fields from those manifests.
//
// The split this enforces: the working copy owns code, version and what the package needs to
// run (entry points, dependencies, dsh.client); the snapshot owns everything a market listing
// needs on its own (README, locale/, icon, LICENSE, cordis.patch.yml, homepage/repository,
// files, scripts, dsh.bundle, dsh.market, engines.dsh). Nothing here rewrites those.
//
// Versions only go up: when the snapshot already publishes a higher version than the working
// copy, the working copy is raised to match — that is the incident this exists to prevent.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SOURCES_FILE, eolOf, exportCoverage, isText, mergeManifest, nextVersion, normaliseEol, ownedDirectories,
  ownedFiles, readJson, readLocalSources, scrubText, snapshotDirectories, withEol,
} from './local-sources.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const raise = !args.includes('--no-raise')
const named = args.filter((argument) => !argument.startsWith('-'))

let sources
try {
  sources = readLocalSources(root)
} catch (error) {
  console.error(`sync-snapshot: ${error.message}`)
  process.exit(1)
}
if (sources === undefined) {
  console.error(`sync-snapshot: no ${SOURCES_FILE} here.`)
  console.error('sync-snapshot: copy market.sources.example.json, name the absolute path of each working copy, rerun.')
  process.exit(1)
}

const problems = []
const warnings = []
let touched = 0

/** Replace only the version string, so the working copy keeps its own formatting. */
function raiseWorkingVersion(manifestFile, version) {
  const before = fs.readFileSync(manifestFile, 'utf8')
  const after = before.replace(/("version"\s*:\s*")[^"]*(")/u, `$1${version}$2`)
  if (before === after) throw new Error(`${manifestFile}: no "version" field to raise`)
  if (!dryRun) fs.writeFileSync(manifestFile, after)
}

/** Copy one code file, scrubbed, keeping the destination's end-of-line style. */
function copyCodeFile(working, snapshot, relative, pairs) {
  const sourceFile = path.join(working, relative)
  const targetFile = path.join(snapshot, relative)
  const buffer = fs.readFileSync(sourceFile)
  if (!isText(buffer)) {
    const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile) : undefined
    if (current !== undefined && current.equals(buffer)) return undefined
    if (!dryRun) {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true })
      fs.writeFileSync(targetFile, buffer)
    }
    return `${relative} (binary)`
  }
  const scrubbed = scrubText(buffer.toString('utf8'), pairs)
  if (fs.existsSync(targetFile)) {
    const current = fs.readFileSync(targetFile, 'utf8')
    if (normaliseEol(current) === normaliseEol(scrubbed)) return undefined
    if (!dryRun) fs.writeFileSync(targetFile, withEol(normaliseEol(scrubbed), eolOf(current)))
    return relative
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.writeFileSync(targetFile, normaliseEol(scrubbed))
  }
  return `${relative} (new)`
}

const names = named.length > 0 ? named : [...sources.plugins.keys()]
const snapshotOf = snapshotDirectories(root)

for (const name of names) {
  const working = sources.plugins.get(name)
  if (working === undefined) {
    problems.push(`${name}: not named in ${SOURCES_FILE}`)
    continue
  }
  const snapshot = snapshotOf.get(name)
  if (snapshot === undefined) {
    problems.push(`${name}: no package under plugins/ is named ${name}`)
    continue
  }
  const workingManifestFile = path.join(working, 'package.json')
  const snapshotManifestFile = path.join(snapshot, 'package.json')
  if (!fs.existsSync(workingManifestFile)) {
    problems.push(`${name}: ${workingManifestFile} does not exist`)
    continue
  }
  if (!fs.existsSync(snapshotManifestFile)) {
    problems.push(`${name}: ${snapshotManifestFile} does not exist`)
    continue
  }

  const workingManifest = readJson(workingManifestFile)
  const snapshotManifest = readJson(snapshotManifestFile)
  if (snapshotManifest.name !== name) {
    problems.push(`${name}: ${path.relative(root, snapshotManifestFile)} is named ${String(snapshotManifest.name)}`)
    continue
  }

  const published = String(snapshotManifest.version ?? '')
  const local = String(workingManifest.version ?? '')
  // The published version is never lowered, so a stale working copy cannot un-publish a release.
  const version = nextVersion(published, local)
  if (version !== local) {
    if (raise) {
      raiseWorkingVersion(workingManifestFile, version)
      console.log(`${name}: working copy ${local} -> ${version} (raised to the published version)${dryRun ? ' (dry run)' : ''}`)
    } else {
      problems.push(`${name}: working copy still says ${local} while ${published} is published; published as ${published} and the working copy was left alone`)
    }
  }

  const changed = []
  const directories = ownedDirectories(working)
  const workingFiles = ownedFiles(working, directories)
  for (const relative of workingFiles) {
    const result = copyCodeFile(working, snapshot, relative, sources.scrub)
    if (result !== undefined) changed.push(result)
  }
  const workingSet = new Set(workingFiles)
  for (const relative of ownedFiles(snapshot, directories)) {
    if (workingSet.has(relative)) continue
    if (!dryRun) fs.rmSync(path.join(snapshot, relative), { force: true })
    changed.push(`${relative} (removed)`)
  }

  for (const line of exportCoverage(snapshotManifest.exports, workingManifest.exports)) {
    warnings.push(`${name}: ${line} — edit ${path.relative(root, snapshotManifestFile)} by hand`)
  }
  // The manifest comes from the working copy too, so it goes through the same scrub table.
  const merged = mergeManifest(name, snapshotManifest, workingManifest, version, warnings)
  const serialised = scrubText(`${JSON.stringify(merged, null, 2)}\n`, sources.scrub)
  for (const [real] of sources.scrub) {
    if (serialised.includes(real)) problems.push(`${name}: ${real} survived the scrub in package.json`)
  }
  const currentManifest = fs.readFileSync(snapshotManifestFile, 'utf8')
  if (currentManifest !== serialised && normaliseEol(currentManifest) !== normaliseEol(serialised)) {
    if (!dryRun) fs.writeFileSync(snapshotManifestFile, withEol(normaliseEol(serialised), eolOf(currentManifest)))
    changed.push('package.json')
  }

  if (changed.length > 0 || version !== local) {
    touched += 1
    console.log(`${name}: ${local} -> ${version}${changed.length === 0 ? ' (no code change)' : `  |  ${changed.join(', ')}`}`)
  }
}

for (const warning of warnings) console.log(`warn  ${warning}`)

if (problems.length > 0) {
  console.error('\nsync-snapshot: problems:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`\nsync-snapshot: ${names.length} package(s) checked, ${touched} changed${dryRun ? ' (dry run)' : ''}`)