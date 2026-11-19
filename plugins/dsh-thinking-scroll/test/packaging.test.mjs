// Packaging contract for the bundle: the row this package inserts must stay inside the Config schema
// that lib/index.js declares, and every display asset the market card reads must keep its shape.
// Zero dependencies on purpose — it runs before `pnpm install` in a fresh checkout.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(packageDirectory, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))
const configSource = read('lib/index.js')
const patchText = read('cordis.patch.yml')

/**
 * Strict reader for the one-row patch this bundle ships. Deliberately narrow: if the file is
 * reformatted beyond this shape the test fails loudly instead of silently skipping the checks.
 */
function readRows(text) {
  const rows = []
  let row
  let inConfig = false
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const start = /^ *-[ ]+id:[ ]*(\S+)$/u.exec(line)
    if (start !== null) {
      row = { id: start[1], name: undefined, config: {} }
      rows.push(row)
      inConfig = false
      continue
    }
    if (row === undefined) continue
    const name = /^ {6}name:[ ]*'?([^']*?)'?$/u.exec(line)
    if (name !== null) {
      row.name = name[1]
      inConfig = false
      continue
    }
    if (/^ {6}config:[ ]*$/u.test(line)) {
      inConfig = true
      continue
    }
    if (inConfig) {
      const entry = /^ {8}([A-Za-z_][\w]*):[ ]*(.+)$/u.exec(line)
      assert.notEqual(entry, null, `unparsed config line in cordis.patch.yml: ${JSON.stringify(line)}`)
      row.config[entry[1]] = entry[2].trim()
    }
  }
  return rows
}

/** The `key: z.<...>` line of the Config schema, so bounds are read from the code, not restated here. */
function schemaField(name) {
  const hit = new RegExp(`^ +${name}: +(.+)$`, 'mu').exec(configSource)
  assert.notEqual(hit, null, `lib/index.js must declare ${name} in its Config schema`)
  return hit[1]
}

function numberBound(field, kind) {
  const hit = new RegExp(`\\.${kind}\\((-?[\\d.]+)\\)`, 'u').exec(field)
  return hit === null ? undefined : Number(hit[1])
}

const rows = readRows(patchText)

test('the patch inserts exactly one row and names this package', () => {
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'thinking-scroll')
  assert.equal(rows[0].name, manifest.name)
})

test('the row config keys are declared by the Config schema', () => {
  const declared = new Set(
    [...configSource.matchAll(/^ {2}([A-Za-z_][\w]*): z\./gmu)].map((match) => match[1]),
  )
  assert.ok(declared.size > 0, 'Config schema fields must be parseable from lib/index.js')
  for (const key of Object.keys(rows[0].config)) assert.ok(declared.has(key), `${key} is not in the Config schema`)
})

test('maxHeightVh stays inside the schema bounds', () => {
  const field = schemaField('maxHeightVh')
  const value = Number(rows[0].config.maxHeightVh)
  assert.ok(Number.isFinite(value), 'maxHeightVh must be a number')
  const min = numberBound(field, 'min')
  const max = numberBound(field, 'max')
  if (min !== undefined) assert.ok(value >= min, `maxHeightVh ${value} is below the schema minimum ${min}`)
  if (max !== undefined) assert.ok(value <= max, `maxHeightVh ${value} is above the schema maximum ${max}`)
})

test('autoFollow is a boolean literal', () => {
  assert.match(schemaField('autoFollow'), /z\.boolean\(\)/u)
  assert.match(rows[0].config.autoFollow, /^(?:true|false)$/u)
})

test('the manifest declares the bundle patch and everything a market card reads', () => {
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.market?.category, 'ui')
  assert.ok(typeof manifest.dsh?.market?.order === 'number')
  assert.ok(typeof manifest.engines?.dsh === 'string')
  for (const required of ['lib', 'locale', 'icon.svg', 'cordis.patch.yml']) {
    assert.ok(manifest.files?.includes(required), `files must list ${required}`)
  }
  assert.ok(manifest.exports?.['./locale/*.json'] !== undefined)
  assert.ok(manifest.exports?.['./icon'] !== undefined)
})

test('locale/en.json and locale/zh.json carry a title and a description within the card limits', () => {
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(read(`locale/${language}.json`)).meta
    assert.ok(meta?.title?.trim() !== '', `${language} title is required`)
    assert.ok(meta?.description?.trim() !== '', `${language} description is required`)
    assert.ok(meta.title.length <= 60, `${language} title is longer than 60 characters`)
    assert.ok(meta.description.length <= 140, `${language} description is longer than 140 characters`)
  }
})

test('icon.svg is a self-contained 32x32 drawing', () => {
  const icon = read('icon.svg')
  assert.ok(fs.statSync(path.join(packageDirectory, 'icon.svg')).size < 256 * 1024)
  assert.match(icon, /viewBox="0 0 32 32"/u)
  assert.match(icon, /width="32"/u)
  assert.match(icon, /height="32"/u)
  assert.doesNotMatch(icon, /<script|<style|<image|foreignObject|onload=/u)
})
