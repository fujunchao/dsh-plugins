#!/usr/bin/env node
// Fails when a package's published snapshot (plugins/<name>) no longer matches the working copy
// this machine publishes from — the drift that made the market offer "有新版本" for plugins that
// had never left this laptop.
//
// Compares the code the working copy owns (lib/, src/, and test/ when it keeps one), the version,
// and the manifest `sync-snapshot` would write — so a hand-edited snapshot field cannot be
// silently overwritten by the next publish. README, locale/, icon, LICENSE, cordis.patch.yml and
// the rest of the packaging fields are the snapshot's own: they are never copied back.
//
// Without market.sources.local.json there is nothing to compare — CI runs this and passes, so
// the gate lives where the working copies are.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  exportCoverage, firstDifference, manifestFieldsDiffering, mergeManifest, nextVersion, normaliseEol,
  ownedDirectories, ownedFiles, readJson, readLocalSources, scrubText, snapshotDirectories,
} from './local-sources.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let sources
try {
  sources = readLocalSources(root)
} catch (error) {
  console.error(`check-drift: ${error.message}`)
  process.exit(1)
}
if (sources === undefined) {
  console.log('check-drift: no market.sources.local.json — nothing to compare here (the working copies live on the authoring machine)')
  process.exit(0)
}

const drift = []
const notes = []
const read = (file) => fs.readFileSync(file, 'utf8')

const snapshotOf = snapshotDirectories(root)

for (const [name, working] of sources.plugins) {
  const snapshot = snapshotOf.get(name)
  if (snapshot === undefined) {
    drift.push(`${name}: no package under plugins/ is named ${name}`)
    continue
  }
  if (!fs.existsSync(path.join(working, 'package.json'))) {
    drift.push(`${name}: ${working}/package.json does not exist`)
    continue
  }

  const snapshotManifest = readJson(path.join(snapshot, 'package.json'))
  const workingManifest = readJson(path.join(working, 'package.json'))
  for (const line of exportCoverage(snapshotManifest.exports, workingManifest.exports)) {
    drift.push(`${name}: ${line}`)
  }
  const published = String(snapshotManifest.version ?? '')
  const local = String(workingManifest.version ?? '')
  if (published !== local) {
    drift.push(`${name}: version — snapshot ${published}, working copy ${local}; run npm run sync:snapshot`)
  }
  // Exactly what sync-snapshot would write, compared field by field.
  const warnings = []
  const target = mergeManifest(name, snapshotManifest, workingManifest, nextVersion(published, local), warnings)
  for (const field of manifestFieldsDiffering(snapshotManifest, target)) {
    if (field === 'version') continue
    drift.push(`${name}: package.json ${field} — the working copy would publish ${JSON.stringify(target[field])}; run npm run sync:snapshot`)
  }

  const directories = ownedDirectories(working)
  const workingCode = ownedFiles(working, directories)
  const snapshotCode = ownedFiles(snapshot, directories)
  const workingSet = new Set(workingCode)
  const snapshotSet = new Set(snapshotCode)
  for (const relative of workingCode) {
    if (!snapshotSet.has(relative)) {
      drift.push(`${name}: ${relative} is in the working copy but not in ${path.relative(root, snapshot)}; run npm run sync:snapshot`)
      continue
    }
    const workingText = scrubText(read(path.join(working, relative)), sources.scrub)
    const snapshotText = read(path.join(snapshot, relative))
    if (normaliseEol(workingText) === normaliseEol(snapshotText)) continue
    const line = firstDifference(workingText, snapshotText)
    drift.push(`${name}: ${relative} differs from line ${String(line)}; run npm run sync:snapshot`)
  }
  for (const relative of snapshotCode) {
    if (!workingSet.has(relative)) {
      drift.push(`${name}: ${relative} is published but gone from the working copy; run npm run sync:snapshot`)
    }
  }

  for (const [real] of sources.scrub) {
    for (const relative of snapshotCode) {
      if (read(path.join(snapshot, relative)).includes(real)) {
        drift.push(`${name}: ${relative} publishes ${'scrub["' + real + '"]'}; the value must never leave this machine`)
      }
    }
  }
}

const mapped = new Set([...snapshotOf.values()])
for (const directory of fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true })) {
  if (!directory.isDirectory()) continue
  if (mapped.has(path.join(root, 'plugins', directory.name))) continue
  notes.push(`plugins/${directory.name} is not named in market.sources.local.json; its code is not compared`)
}

for (const note of notes) console.log(`note  ${note}`)

if (drift.length > 0) {
  console.error('check-drift: the published snapshot and the working copies disagree:')
  for (const line of drift) console.error(`  - ${line}`)
  process.exit(1)
}
console.log(`check-drift: ok — ${sources.plugins.size} package(s) match their working copies`)
