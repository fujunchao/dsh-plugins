#!/usr/bin/env node
// Refreshes scripts/vendor/market-index.mjs from the installed DSH, so this repository
// validates its index with exactly the rules the running DSH applies.
//
//   node scripts/refresh-vendor.mjs [path/to/app.asar]
//
// Default: %LOCALAPPDATA%/Programs/... is not portable, so pass the archive path explicitly
// or set DSH_ASAR.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const archivePath = process.argv[2] ?? process.env.DSH_ASAR
if (archivePath === undefined) {
  console.error('refresh-vendor: pass the app.asar path or set DSH_ASAR')
  process.exit(1)
}

const ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'

const handle = fs.openSync(archivePath, 'r')
const header = Buffer.alloc(16)
fs.readSync(handle, header, 0, 16, 0)
const payloadSize = header.readUInt32LE(4)
const jsonLength = header.readUInt32LE(12)
const json = Buffer.alloc(jsonLength)
fs.readSync(handle, json, 0, jsonLength, 16)
const tree = JSON.parse(json.toString('utf8'))
const base = 8 + payloadSize

let node = tree
for (const segment of ENTRY.split('/')) {
  node = node.files?.[segment]
  if (node === undefined) {
    console.error(`refresh-vendor: ${ENTRY} is not in ${archivePath}`)
    process.exit(1)
  }
}
const body = Buffer.alloc(Number(node.size))
fs.readSync(handle, body, 0, body.length, base + Number(node.offset))
fs.closeSync(handle)

const banner = [
  '// Vendored from the DSH installation so this repository can validate its own index with',
  '// the exact rules DSH applies. Source package: @deepseek-ai/dsh-plugin-market-index',
  '// (MIT, https://github.com/deepseek-ai/deepseek-harness, packages/util/plugin-market-index).',
  '// Regenerate with scripts/refresh-vendor.mjs instead of editing by hand.',
].join('\n')

fs.writeFileSync(path.join(root, 'scripts', 'vendor', 'market-index.mjs'), `${banner}\n${body.toString('utf8')}`)
console.log(`refreshed scripts/vendor/market-index.mjs from ${ENTRY} (${body.length} bytes)`)
