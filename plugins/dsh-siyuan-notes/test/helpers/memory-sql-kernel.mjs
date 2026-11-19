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
  // 思源对中文是按「字符」建 FTS 索引的：2 个字以上的短语（含二元组）都能命中，
  // "忆插" 与 "记忆插件" 命中数相同。默认 unicode61 会把一整串汉字当一个词元，
  // 假内核照着建索引就会和真实内核差一个量级——长句检索在这里能过、真实环境里却 0 命中。
  // 这里把中文按字拆开写进 FTS 列（blocks.content 保持原文），行为与思源一致。
  const ftsText = value => String(value ?? '').replace(/[\u4e00-\u9fff]+/gu, (run) => [...run].join(' '));
  function sync() {
    db.exec('DELETE FROM blocks; DELETE FROM attributes; DELETE FROM blocks_fts;');
    for (const block of kernel.blocks.values()) {
      insertBlock.run(block.id, 'memory-box', block.body.replaceAll('<br>', '\n'), block.body, block.id.slice(0, 14), 'p', '');
      for (const [name, value] of Object.entries(block.attrs)) insertAttr.run(block.id, name, value);
      insertFts.run(block.id, ftsText(block.body), ftsText(block.body), ftsText(Object.values(block.attrs).join(' ')));
    }
  }
  // 真实思源的 blocks_fts 对中文是「按字建索引、按短语查」：`"记忆插件"` 与 `"忆插"`
  // 命中数相同（2026-11-19 实测 16 / 16）。默认 unicode61 会把查询里的 `"记忆插件"`
  // 当成一个词元，跟按字拆开的索引对不上——长句检索在假内核里必然 0 行、真实环境里却能命中。
  // 这里把 MATCH 里每个带引号的词元按字加空格，行为与真实内核对齐。
  const rewriteMatch = stmt => String(stmt).replace(/(MATCH\s+)(['"])([\s\S]*?)\2/iu, (_whole, lead, quote, expression) => {
    const spaced = String(expression).replace(/"([^"]*)"/gu, (_q, term) => '"' + term.replace(/[\u4e00-\u9fff]/gu, (ch) => ch + ' ').trim() + '"');
    return lead + quote + spaced + quote;
  });

  async function call(api, payload, options) {
    const injected = await control.before?.(api, payload, options);
    if (injected) return injected;
    let result;
    if (api.endsWith('/sql')) {
      if (control.indexed) sync();
      kernel.calls.push({ api, payload });
      const sql = rewriteMatch(/\bLIMIT\s+/iu.test(payload.stmt) ? payload.stmt : payload.stmt.replace(/;\s*$/u, '') + ' LIMIT 64');
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
