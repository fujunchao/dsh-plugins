// 使用真实 SQLite，模拟思源默认 64 行限制、索引延迟及 kramdown 的零宽字符。
import { DatabaseSync } from 'node:sqlite';
import { memoryKernel } from './memory-kernel.mjs';
import { createMemoryStore, MEMORY_ATTRS } from '../../lib/memory.js';
import { createConfirmedMemoryStore } from './confirmed-memory-store.mjs';

export function memorySqlKernel({ indexed = true, zeroWidth = false, receipts, now, confirmedWrites = false } = {}) {
  const kernel = memoryKernel(), db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE blocks(id TEXT,box TEXT,content TEXT,markdown TEXT,created TEXT,type TEXT,hpath TEXT); CREATE TABLE attributes(block_id TEXT,name TEXT,value TEXT); CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED,content,markdown,ial);');
  const insertBlock = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?,?)');
  const insertAttr = db.prepare('INSERT INTO attributes VALUES(?,?,?)');
  const insertFts = db.prepare('INSERT INTO blocks_fts VALUES(?,?,?,?)');
  const control = { indexed, before: null, after: null };
  function sync() {
    db.exec('DELETE FROM blocks; DELETE FROM attributes; DELETE FROM blocks_fts;');
    for (const block of kernel.blocks.values()) {
      insertBlock.run(block.id, 'memory-box', block.body.replaceAll('<br>', '\n'), block.body, block.id.slice(0, 14), 'p', '');
      for (const [name, value] of Object.entries(block.attrs)) insertAttr.run(block.id, name, value);
      insertFts.run(block.id, block.body, block.body, Object.values(block.attrs).join(' '));
    }
  }
  async function call(api, payload, options) {
    const injected = await control.before?.(api, payload, options);
    if (injected) return injected;
    let result;
    if (api.endsWith('/sql')) {
      if (control.indexed) sync();
      kernel.calls.push({ api, payload });
      const sql = /\bLIMIT\s+/iu.test(payload.stmt) ? payload.stmt : payload.stmt.replace(/;\s*$/u, '') + ' LIMIT 64';
      result = { ok: true, value: { code: 0, data: db.prepare(sql).all() } };
    } else if (api.endsWith('/getChildBlocks')) {
      result = { ok: true, value: { code: 0, data: [...kernel.blocks.values()].filter(b => !b.parentID || b.parentID === payload.id).map(b => ({ id: b.id, type: 'p' })) } };
    } else {
      result = await kernel.call(api, payload);
      if (api.endsWith('/appendBlock') && result.ok) {
        const id = result.value.data?.[0]?.doOperations?.[0]?.id;
        if (kernel.blocks.has(id)) kernel.blocks.get(id).parentID = payload.parentID;
      }
      if (zeroWidth && api.endsWith('/getBlockKramdown') && result.ok) result.value.data.kramdown = result.value.data.kramdown.replace(/`[^`\n]+`/gu, text => '\u200b' + text + '\u200b');
    }
    await control.after?.(api, payload, result);
    return result;
  }
  const makeStore = () => (confirmedWrites ? createConfirmedMemoryStore : createMemoryStore)({ call, receipts, now });
  return { call, control, sync, makeStore, store: makeStore(), kernel, close: () => db.close(),
    seed(entries) { for (const [index, entry] of entries.entries()) { const id = entry.id ?? `20261110120000-${String(index + 10000).padStart(7, '0')}`; kernel.blocks.set(id, { id, body: entry.body ?? '测试条目', attrs: Object.fromEntries(Object.entries(entry).filter(([key]) => MEMORY_ATTRS[key]).map(([key, value]) => [MEMORY_ATTRS[key], String(value)])) }); } sync(); } };
}

export const confirmedSqlKernel = options => memorySqlKernel({ ...options, confirmedWrites: true });
