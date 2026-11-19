// 隔离记忆测试内核：即时直读与可延迟的 SQL 索引分开，不接触真实思源。
import { MEMORY_ATTRS } from '../../lib/memory.js';

export function memoryKernel() {
  let sequence = 0;
  const blocks = new Map();
  const calls = [];
  const state = { offline: false, indexed: true, failAttrs: false, notebooks: true };
  const ok = data => ({ ok: true, value: { code: 0, data } });
  const nextId = () => `20261109120000-${String(++sequence).padStart(7, '0')}`;
  const row = block => ({ id: block.id, box: 'memory-box', content: block.body.replaceAll('<br>', '\n'), markdown: block.body,
    created: block.id.slice(0, 14), ...Object.fromEntries(Object.entries(MEMORY_ATTRS).map(([key, attribute]) => [key, block.attrs[attribute] ?? ''])) });
  async function call(api, payload) {
    calls.push({ api, payload });
    if (state.offline) return { ok: false, error: { code: 'offline', message: '模拟内核不可达' } };
    if (api.endsWith('/lsNotebooks')) return ok({ notebooks: state.notebooks ? [{ id: 'memory-box', name: 'AI 记忆体' }] : [] });
    if (api.endsWith('/createNotebook')) { state.notebooks = true; return ok({ notebook: { id: 'memory-box' } }); }
    if (api.endsWith('/createDocWithMd')) return ok(nextId());
    if (api.endsWith('/appendBlock')) {
      const id = nextId(); blocks.set(id, { id, body: payload.data, attrs: {} });
      return ok([{ doOperations: [{ id }] }]);
    }
    if (api.endsWith('/setBlockAttrs')) {
      if (state.failAttrs) return { ok: true, value: { code: -1, msg: '模拟属性失败' } };
      const block = blocks.get(payload.id);
      if (!block) return { ok: true, value: { code: -1, msg: '块不存在' } };
      Object.assign(block.attrs, payload.attrs); return ok(null);
    }
    if (api.endsWith('/getBlockAttrs')) return blocks.has(payload.id) ? ok({ ...blocks.get(payload.id).attrs }) : { ok: false, error: { code: 'not_found', message: '块不存在' } };
    if (api.endsWith('/getBlockInfo')) return ok({ box: 'memory-box', rootID: 'memory-doc' });
    if (api.endsWith('/getBlockKramdown')) return ok({ id: payload.id, kramdown: blocks.get(payload.id)?.body ?? '' });
    if (api.endsWith('/sql')) {
      if (!state.indexed) return ok([]);
      const sql = payload.stmt;
      if (sql.includes('hpath =')) return ok([]);
      let selected = [...blocks.values()];
      const ids = /(?:b\.)?id IN \(([^)]+)\)/u.exec(sql);
      if (ids) selected = selected.filter(block => ids[1].includes(`'${block.id}'`));
      if (sql.includes('JOIN attributes a ON')) return ok(selected.flatMap(block => Object.entries(block.attrs).map(([name, value]) => ({ ...row(block), name, value }))));
      let rows = selected.map(row).reverse();
      for (const [alias, key] of [['t', 'type'], ['p', 'project'], ['s', 'status'], ['fp', 'fingerprint']]) {
        const match = new RegExp(`${alias === 'p' ? '^  AND ' : ''}${alias}\\.value = '((?:''|[^'])*)'`, 'm').exec(sql);
        if (match) rows = rows.filter(row => row[key] === match[1].replaceAll("''", "'"));
      }
      const statuses = /s\.value IN \(([^)]+)\)/u.exec(sql);
      if (statuses) rows = rows.filter(row => statuses[1].includes(`'${row.status}'`));
      if (sql.includes('COUNT(*)')) {
        const counts = new Map();
        for (const row of rows) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
        return ok([...counts].map(([type, n]) => ({ type, n, latest: '20261109120000' })));
      }
      const limit = /LIMIT (\d+)/u.exec(sql);
      return ok(limit ? rows.slice(0, Number(limit[1])) : rows);
    }
    return ok(null);
  }
  return { call, blocks, calls, state };
}
