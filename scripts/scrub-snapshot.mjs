#!/usr/bin/env node
// Applies the local scrub table to every published file of every named package — including the
// ones the snapshot owns and `sync-snapshot` must not rewrite (README, docs, locale, tests the
// snapshot keeps). `sync-snapshot` scrubs what it copies; this is the pass over everything else,
// so a value that must never leave the machine cannot survive in a market-owned file either.
//
// Idempotent, and it keeps each file's end-of-line style, so a second run changes nothing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOURCES_FILE, isText, normaliseEol, readLocalSources, snapshotDirectories, walkFiles } from './local-sources.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const named = args.filter((argument) => !argument.startsWith('-'))

let sources
try {
  sources = readLocalSources(root)
} catch (error) {
  console.error(`scrub-snapshot: ${error.message}`)
  process.exit(1)
}
if (sources === undefined) {
  console.error(`scrub-snapshot: no ${SOURCES_FILE} here, so there is no table to apply.`)
  process.exit(1)
}
if (sources.scrub.length === 0) {
  console.log('scrub-snapshot: the scrub table is empty; nothing to do')
  process.exit(0)
}

const snapshotOf = snapshotDirectories(root)
const names = named.length > 0 ? named : [...snapshotOf.keys()]
let touchedFiles = 0
let touchedValues = 0

for (const name of names) {
  const snapshot = snapshotOf.get(name)
  if (snapshot === undefined) {
    console.error(`scrub-snapshot: no package under plugins/ is named ${name}`)
    process.exit(1)
  }
  const changed = []
  for (const relative of walkFiles(snapshot)) {
    const file = path.join(snapshot, relative)
    const buffer = fs.readFileSync(file)
    if (!isText(buffer)) continue
    const before = buffer.toString('utf8')
    let after = before
    for (const [real, demo] of sources.scrub) after = after.split(real).join(demo)
    if (after === before) continue
    if (!dryRun) fs.writeFileSync(file, after)
    const hits = sources.scrub.reduce((count, [real]) => count + before.split(real).length - 1, 0)
    touchedValues += hits
    changed.push(`${relative} (${String(hits)})`)
  }
  if (changed.length > 0) {
    touchedFiles += changed.length
    console.log(`${name}: ${changed.join(', ')}`)
  }
}

for (const [real] of sources.scrub) {
  if (real.length < 6) console.log(`warn  the scrub key ${JSON.stringify(real)} is short enough to hit unrelated text`)
}

console.log(`\nscrub-snapshot: ${names.length} package(s), ${touchedFiles} file(s), ${touchedValues} value(s) scrubbed${dryRun ? ' (dry run)' : ''}`)
