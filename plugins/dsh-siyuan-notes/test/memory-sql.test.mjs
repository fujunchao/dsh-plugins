// 用真实 SQLite/FTS5 执行查询，不靠字符串模拟 SQL 的 WHERE/LIMIT 语义。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MEMORY_ATTRS, buildFilterStatement, buildFtsSearchStatement, buildListStatement } from '../lib/memory.js';

test('作用域和置信度在LIMIT之前过滤，FTS和列表使用同一规则', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE blocks(id TEXT,box TEXT,content TEXT,markdown TEXT,created TEXT); CREATE TABLE attributes(block_id TEXT,name TEXT,value TEXT); CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED,content,markdown,ial);');
    const block = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?)');
    const attr = db.prepare('INSERT INTO attributes VALUES(?,?,?)');
    const fts = db.prepare('INSERT INTO blocks_fts VALUES(?,?,?,?)');
    const add = (id, values) => {
      block.run(id, 'box', 'memory contract', 'memory contract', id);
      fts.run(id, 'memory contract', 'memory contract', '');
      for (const [key,value] of Object.entries(values)) attr.run(id, MEMORY_ATTRS[key], value);
    };
    const scope = { workspace: '/w1/p', project: 'p', projects: ['*','p'], projectRoots: { p: '/w1/p' } };
    add('001', { type:'decision', project:'p', workspace:'/w1/p', confidence:'verified', status:'active' });
    add('002', { type:'decision', project:'*', workspace:'*', confidence:'stated', status:'active' });
    for(let i=3;i<40;i++) add(String(i).padStart(3,'0'), { type:'decision', project:'p', workspace:'/w2/p', confidence:'verified', status:'active' });
    add('040', { type:'decision', project:'p', workspace:'/w1/p', confidence:'inferred', status:'active' });
    add('041', { type:'decision', project:'p', workspace:'/w1/p', confidence:'stated', status:'candidate' });
    add('042', { type:'decision', project:'p', confidence:'verified', status:'active' });
    const input = { box:'box', type:'decision', status:'active', trusted:true, scope, limit:2 };
    for(const sql of [buildFilterStatement(input), buildFtsSearchStatement({...input,expression:'"memory"'}),buildListStatement(input)]) {
      assert.deepEqual(db.prepare(sql).all().map(row=>row.id),['001','002'], '当前项目先于较新的全局条目');
    }
    assert.equal(db.prepare(buildFilterStatement({box:'box',status:'candidate',limit:25})).all()[0].id,'041');
  } finally { db.close(); }
});
