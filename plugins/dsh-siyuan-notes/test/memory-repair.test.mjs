import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmedSqlKernel as memorySqlKernel } from './helpers/memory-sql-kernel.mjs';
import { MEMORY_ATTRS as A } from '../lib/memory.js';
import { memoryOptOut, validateMemory } from '../lib/memory-policy.js';
import { checkupRender } from '../lib/index.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryRecording } from '../lib/memory-recording.js';

const scope = { workspace: '/workspace/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/workspace/p' } };
const trusted = { scope, project: 'p', source: 'user:repair-test', confidence: 'stated' };
const save = async (store, spec) => { const result = await store.write(spec); assert.equal(result.ok, true, JSON.stringify(result)); return result.value.id; };
const readOne = async (store, id) => { const result = await store.read([id]); assert.equal(result.ok, true); assert.ok(result.value.entries[0]); return result.value.entries[0]; };

test('批量读取二十条记忆时，所有正文和属性均完整', async () => {
  const fixture = memorySqlKernel();
  try {
    const ids = [];
    for (let index = 0; index < 20; index++) ids.push(await save(fixture.store, { ...trusted, type: 'fact', body: `批量核验条目 ${index}` }));
    const restarted = fixture.makeStore();
    const result = await restarted.read(ids);
    assert.equal(result.ok, true);
    assert.equal(result.value.entries.length, 20);
    assert.deepEqual(result.value.missing, []);
    assert.ok(result.value.entries.every(entry => entry.workspace === '/workspace/p' && entry.confidence === 'stated'));
    assert.equal(result.value.complete, true);
  } finally { fixture.close(); }
});

test('确认取代时写入成功后的校验失败，恢复旧状态并允许原样重试', async () => {
  const fixture = memorySqlKernel();
  try {
    const body = title => `${title}\n- 下一步：验收\n- 待决：无`;
    const oldId = await save(fixture.store, { ...trusted, type: 'state', topic: 'task', body: body('旧状态') });
    const id = await save(fixture.store, { ...trusted, type: 'state', topic: 'task', body: body('新状态'), confidence: 'inferred' });
    const old = await readOne(fixture.store, oldId), candidate = await readOne(fixture.store, id);
    let armed = false, injected = false;
    fixture.control.after = (api, payload) => { if (!injected && api.endsWith('/setBlockAttrs') && payload.id === oldId && payload.attrs[A.status] === 'superseded') armed = true; };
    fixture.control.before = (api, payload) => { if (armed && api.endsWith('/getBlockAttrs') && payload.id === oldId) { armed = false; injected = true; return { ok: false, error: { code: 'network', message: '确认读取失败' } }; } };
    const input = { id, confidence: 'stated', expectedRevision: candidate.revision, supersedes: [oldId], expectedRevisions: { [oldId]: old.revision } };
    assert.equal((await fixture.store.approve(input)).ok, false);
    const after = (await fixture.makeStore().read([oldId, id])).value.entries;
    assert.equal(after[0].status, 'active');
    assert.equal(after[0].supersededBy, '');
    assert.equal(after[1].status, 'candidate');
    assert.equal((await fixture.store.approve(input)).ok, true);
  } finally { fixture.close(); }
});

test('含内联代码的候选可以按列表版本确认、撤销、恢复和取代', async () => {
  const fixture = memorySqlKernel({ zeroWidth: true });
  try {
    const id = await save(fixture.store, { ...trusted, type: 'decision', body: '使用 `SQLite` 保存数据', confidence: 'inferred' });
    const entry = (await fixture.store.list()).value.entries.find(item => item.id === id);
    assert.equal((await fixture.store.approve({ id, expectedRevision: entry.revision, confidence: 'stated' })).ok, true);
    const approved = await readOne(fixture.store, id);
    assert.equal((await fixture.store.setStatus({ id, status: 'revoked', expectedRevision: approved.revision })).ok, true);
    const revoked = await readOne(fixture.store, id);
    assert.equal((await fixture.store.setStatus({ id, status: 'active', expectedRevision: revoked.revision })).ok, true);
    const restored = await readOne(fixture.store, id);
    const nextId = await save(fixture.store, { ...trusted, type: 'decision', body: '升级 `SQLite` 存储', supersedes: [id], expectedRevisions: { [id]: restored.revision } });
    assert.equal((await readOne(fixture.store, id)).supersededBy, nextId);
  } finally { fixture.close(); }
});

test('撤销被取代条目失败时，两个方向的取代链接都保留', async () => {
  const fixture = memorySqlKernel();
  try {
    const oldId = await save(fixture.store, { ...trusted, type: 'decision', body: '旧方案' });
    const old = await readOne(fixture.store, oldId);
    const id = await save(fixture.store, { ...trusted, type: 'decision', body: '新方案', supersedes: [oldId], expectedRevisions: { [oldId]: old.revision } });
    const previous = await readOne(fixture.store, oldId);
    fixture.control.before = (api, payload) => api.endsWith('/setBlockAttrs') && payload.id === oldId && payload.attrs[A.status] === 'revoked' ? { ok: false, error: { code: 'network', message: '模拟撤销失败' } } : undefined;
    assert.equal((await fixture.store.setStatus({ id: oldId, status: 'revoked', expectedRevision: previous.revision })).ok, false);
    const after = (await fixture.makeStore().read([oldId, id])).value.entries;
    assert.equal(after[0].supersededBy, id);
    assert.equal(after[1].supersedes, oldId);
  } finally { fixture.close(); }
});

test('最终凭据保存失败后重试，实际状态与成功结果一致', async () => {
  const saved = new Map(); let failFinal = false;
  const receipts = { get: async key => structuredClone(saved.get(key) ?? null), set: async (key, value) => {
    if (failFinal && value.complete) { failFinal = false; throw new Error('模拟凭据保存失败'); }
    saved.set(key, structuredClone(value));
  } };
  const fixture = memorySqlKernel({ receipts });
  try {
    const oldId = await save(fixture.store, { ...trusted, type: 'decision', body: '原有决定' }), old = await readOne(fixture.store, oldId);
    const spec = { ...trusted, type: 'decision', body: '替换决定', supersedes: [oldId], expectedRevisions: { [oldId]: old.revision } };
    failFinal = true;
    assert.equal((await fixture.store.write(spec)).ok, false);
    const repeated = await fixture.store.write(spec);
    assert.equal(repeated.ok, true, JSON.stringify(repeated));
    const pair = (await fixture.makeStore().read([oldId, repeated.value.id])).value.entries;
    assert.equal(pair[0].status, 'superseded');
    assert.equal(pair[1].status, 'active');
    assert.equal(pair[0].supersededBy, pair[1].id);
    assert.equal(pair[1].supersedes, pair[0].id);
  } finally { fixture.close(); }
});

test('确认后读取旧 SQL 列表，不丢失可信搜索与新会话索引中的条目', async () => {
  const fixture = memorySqlKernel({ indexed: false });
  try {
    const id = await save(fixture.store, { ...trusted, type: 'preference', confidence: 'inferred', body: '需要立即生效的偏好' });
    fixture.sync();
    const candidate = await readOne(fixture.store, id);
    assert.equal((await fixture.store.approve({ id, confidence: 'stated', expectedRevision: candidate.revision })).ok, true);
    await fixture.store.list();
    assert.ok((await fixture.store.search({ scope, trusted: true, status: 'active' })).value.results.some(entry => entry.id === id));
    assert.ok((await fixture.store.sectionText({ scope, force: true })).includes('需要立即生效的偏好'));
  } finally { fixture.close(); }
});

test('索引延迟期间超过二十次无关写入，同主题新状态仍取代旧状态而不是并列', async () => {
  const fixture = memorySqlKernel({ indexed: false });
  try {
    const spec = { ...trusted, type: 'state', topic: 'same-task', body: '阶段一\n- 下一步：核验\n- 待决：无' };
    const id = await save(fixture.store, spec);
    for (let index = 0; index < 21; index++) await save(fixture.store, { ...trusted, type: 'fact', body: `无关条目 ${index}` });
    const next = await fixture.store.write({ ...spec, body: '阶段二\n- 下一步：交付\n- 待决：无' });
    assert.equal(next.ok, true, JSON.stringify(next));
    assert.deepEqual(next.value.superseded, [id]);
    assert.equal((await readOne(fixture.store, id)).status, 'superseded');
    assert.equal((await readOne(fixture.store, next.value.id)).status, 'active');
  } finally { fixture.close(); }
});

test('等待写入队列时取消，取消的内容不会被追加', async () => {
  const fixture = memorySqlKernel();
  let release, entered;
  const gate = new Promise(resolve => release = resolve), reached = new Promise(resolve => entered = resolve);
  const controller = new AbortController(); let blocked = false;
  fixture.control.before = async api => { if (!blocked && api.endsWith('/appendBlock')) { blocked = true; entered(); await gate; } };
  try {
    const first = fixture.store.write({ ...trusted, type: 'fact', body: '占用队列' });
    await reached;
    const cancelled = fixture.store.write({ ...trusted, type: 'fact', body: '不应保存的内容', signal: controller.signal });
    controller.abort(); release();
    assert.equal((await first).ok, true);
    assert.equal((await cancelled).ok, false);
    assert.equal((await fixture.makeStore().list()).value.entries.length, 1);
  } finally { release(); fixture.close(); }
});

test('其他工作区超过二百条状态，不影响本工作区的合法新主题', async () => {
  const fixture = memorySqlKernel();
  try {
    fixture.seed(Array.from({ length: 205 }, (_, index) => ({ type: 'state', project: 'p', workspace: '/other/p', topic: 'task-' + index, status: 'active', confidence: 'stated', source: 'fixture', body: '其它工作区状态' })));
    assert.equal((await fixture.store.write({ ...trusted, type: 'state', topic: 'local', body: '本地状态\n- 下一步：继续\n- 待决：无' })).ok, true);
  } finally { fixture.close(); }
});

test('撤销后同文可以重新保存；同文再写一次 stated 会把候选升级为有效', async () => {
  const fixture = memorySqlKernel();
  try {
    const spec = { ...trusted, type: 'preference', body: '回答先给结论' };
    const id = await save(fixture.store, spec);
    await fixture.store.setStatus({ id, status: 'revoked' });
    const second = await fixture.store.write(spec);
    assert.equal(second.ok, true); assert.notEqual(second.value.id, id); assert.equal(second.value.status, 'active');
    // 契约 §1：只有显式 inferred 才落候选。同文再写一次、且这次是 stated，
    // 就把候选就地升级为有效（promoted:true / duplicate:false），不重复追加，也不停在候选。
    const candidate = await save(fixture.store, { ...trusted, type: 'fact', confidence: 'inferred', body: '待确认事实' });
    const repeated = await fixture.store.write({ ...trusted, type: 'fact', body: '待确认事实' });
    assert.equal(repeated.ok, true, JSON.stringify(repeated));
    assert.equal(repeated.value.id, candidate);
    assert.equal(repeated.value.promoted, true);
    assert.equal(repeated.value.duplicate, false);
    const promoted = await readOne(fixture.store, candidate);
    assert.equal(promoted.status, 'active');
    assert.equal(promoted.confidence, 'stated');
    // 已是 active 的同文再写一次仍然只报告「已存在有效记忆」，不追加第三条。
    const again = await fixture.store.write({ ...trusted, type: 'fact', body: '待确认事实' });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.value.id, candidate);
    assert.equal(again.value.duplicate, true);
    assert.equal(again.value.disposition, 'active_exists');
  } finally { fixture.close(); }
});

test('内核明确拒绝追加后，同内容重试不被不确定凭据永久锁住', async () => {
  const fixture = memorySqlKernel(); let once = true;
  fixture.control.before = api => { if (once && api.endsWith('/appendBlock')) { once = false; return { ok: true, value: { code: -1, msg: '明确拒绝写入' } }; } };
  try {
    const spec = { ...trusted, type: 'fact', body: '可重试的内容' };
    assert.equal((await fixture.store.write(spec)).ok, false);
    assert.equal((await fixture.store.write(spec)).ok, true);
    assert.equal((await fixture.makeStore().list()).value.entries.length, 1);
  } finally { fixture.close(); }
});

test('响应丢失后可检查并续写已经落盘的块，不会重复追加', async () => {
  const fixture = memorySqlKernel(); let lost = false;
  fixture.control.after = (api, _payload, result) => { if (!lost && api.endsWith('/appendBlock')) { lost = true; result.ok = false; result.error = { code: 'network', message: '模拟响应丢失' }; } };
  try {
    const failed = await fixture.store.write({ ...trusted, type: 'fact', body: '响应未知的条目' });
    assert.equal(failed.ok, false);
    const inspected = await fixture.store.recoverReceipt({ key: failed.recovery.key, action: 'inspect' });
    assert.equal(inspected.ok, true); assert.equal(inspected.value.matches.length, 1);
    const forgotten = await fixture.store.recoverReceipt({ key: failed.recovery.key, action: 'forget', expectedVersion: inspected.value.version, confirmedMissing: true });
    assert.equal(forgotten.ok, false); assert.equal(forgotten.error.code, 'existing_append');
    const recovered = await fixture.store.recoverReceipt({ key: failed.recovery.key, action: 'resume', expectedVersion: inspected.value.version });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal((await fixture.makeStore().list()).value.entries.length, 1);
    assert.equal((await fixture.makeStore().list()).value.entries[0].status, 'active');
  } finally { fixture.close(); }
});

test('记录开关跨实例保存，环境变量关闭时不能从面板开启', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'memory-policy-'));const file=path.join(directory,'policy.json');
  try{
    const first=createMemoryRecording(file);assert.equal(first.state().enabled,true);await first.set(false);
    const restarted=createMemoryRecording(file);assert.equal(restarted.state().enabled,false);await restarted.set(true);
    const locked=createMemoryRecording(file,()=>true);assert.equal(locked.state().enabled,false);await assert.rejects(locked.set(true),/环境变量/u);
    assert.equal(createMemoryRecording(file).state().enabled,true);
  }finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('禁止保存临时文件不关闭记忆，明确会话不记录仍生效', () => {
  const user = text => [{ role: 'user', content: [{ type: 'text', text }] }];
  assert.equal(memoryOptOut(user('不要保存这个临时文件，继续分析代码')), false);
  assert.equal(memoryOptOut(user('不要记录调试日志')), false);
  assert.equal(memoryOptOut(user('这段不要记录，测试一个想法')), true);
  assert.equal(memoryOptOut(user('不要把这段对话保存到长期记忆')), true);
  assert.equal(memoryOptOut(user("don't store this conversation")), true);
  for (const text of ['不要记录这次对话', '这次对话不要记录。', '别把这个写进记忆体', '不要写记忆', '别记', '这个不要记住。', '不要记住这次聊天的任何内容', "please don't remember this.", 'never save this to memory'])
    assert.equal(memoryOptOut(user(text)), true, text);
  // 开发中的常见说法都不是对记忆功能的指令：误判一次，整场会话就不再记录。
  for (const text of ["I don't remember where the config file lives", '登录页不要记住密码', '别保存会话 cookie 到 localStorage', '不要记录聊天内容到日志文件里',
    '不要保存内容到磁盘', '这个函数别记忆化', '改完配置之后，不要保存。', 'The API should never remember the previous page token', '这次不要保存，直接预览', "we don't save the session to disk"])
    assert.equal(memoryOptOut(user(text)), false, text);
  // 面板恢复记录时，把触发停止的那几句话列入忽略。
  assert.equal(memoryOptOut(user('不要记录这次对话'), new Set(['不要记录这次对话'])), false);
});

test('状态接受常见冒号和列表格式，并明确提示允许的项目', () => {
  const entry = validateMemory({ ...trusted, type: 'state', topic: 'task', body: '完成核验\n* 下一步: 交付\n• 待决： 无' });
  assert.equal(entry.body, '完成核验\n- 下一步：交付\n- 待决：无');
  assert.throws(() => validateMemory({ ...trusted, type: 'fact', project: 'invented', body: '结论' }), /可选.*p/u);
});

test('确认候选时合并旧待办，保留原候选与旧状态的历史和双向关系', async () => {
  const fixture = memorySqlKernel();
  try {
    const oldId = await save(fixture.store, { ...trusted, type: 'state', topic: 'merge', body: '旧状态\n- 下一步：补测试\n- 待决：无' });
    const id = await save(fixture.store, { ...trusted, type: 'state', topic: 'merge', confidence: 'inferred', body: '新进展\n- 下一步：发布\n- 待决：无' });
    const view = await fixture.store.approvalContext(id);
    assert.equal(view.ok, true); assert.equal(view.value.conflicts[0].id, oldId);
    const merged = '合并后的进展\n- 下一步：补测试后发布\n- 待决：无';
    const result = await fixture.store.approve({ id, expectedRevision: view.value.candidate.revision, confidence: 'stated', body: merged,
      supersedes: [oldId], expectedRevisions: { [oldId]: view.value.conflicts[0].revision } });
    assert.equal(result.ok, true, JSON.stringify(result));
    const entries = (await fixture.makeStore().read([oldId, id, result.value.id])).value.entries;
    assert.equal(entries.length, 3); assert.equal(entries[2].body, merged); assert.equal(entries[2].status, 'active');
    assert.equal(entries[0].supersededBy, result.value.id); assert.equal(entries[1].supersededBy, result.value.id);
    assert.equal(entries[1].body, '新进展\n- 下一步：发布\n- 待决：无');
  } finally { fixture.close(); }
});

test('新缓存只匹配一个词时，不能挤掉数据库中匹配全部词的记忆', async () => {
  const fixture = memorySqlKernel({ indexed: false });
  try {
    const exact = await save(fixture.store, { ...trusted, type: 'fact', body: 'login cookie persists across restarts' });
    fixture.sync(); await readOne(fixture.store, exact);
    await save(fixture.store, { ...trusted, type: 'fact', body: 'login page stylesheet updated' });
    const result = await fixture.store.search({ query: 'login cookie', limit: 1 });
    assert.equal(result.value.results[0].id, exact);
    fixture.sync();
    assert.equal((await fixture.store.search({ query: 'login cookie', limit: 1 })).value.results[0].id, exact);
  } finally { fixture.close(); }
});

test('常驻索引优先保留当前状态，并显示事实和候选目录', async () => {
  const fixture = memorySqlKernel();
  const project = 'dsh-siyuan-notes', localScope = { workspace: '/workspace/plugin', project, projects: ['*', project], projectRoots: { [project]: '/workspace/plugin' } };
  try {
    const base = { ...trusted, scope: localScope, project };
    for (let index = 0; index < 6; index++) await save(fixture.store, { ...base, type: 'preference', body: `偏好${index}：` + '必须保留的偏好描述'.repeat(18) });
    const id = await save(fixture.store, { ...base, type: 'state', topic: 'important', body: '当前任务必须可见\n- 下一步：交付\n- 待决：无' });
    await save(fixture.store, { ...base, type: 'fact', body: '目录中的事实' });
    await save(fixture.store, { ...base, type: 'decision', body: '待确认的决定', confidence: 'inferred' });
    const section = await fixture.store.sectionText({ scope: localScope, force: true });
    // 契约 §3：注入只放语句文本，不再带条目 id——所以「当前状态还在」要用语句证明，并且 id 一律不得出现。
    assert.ok(section.includes('当前任务必须可见'));
    assert.ok(!section.includes(id));
    assert.doesNotMatch(section, /\b[0-9]{14}-[a-z0-9]{7}\b/u);
    // 当前状态优先于偏好：待办标题段先于第一条偏好。
    assert.ok(section.indexOf('当前任务必须可见') < section.indexOf('偏好：'));
    assert.match(section, /目录：事实 1 · 决策 0 · 状态 1 · 候选 1。/u);
    // 候选仍要露出（未核实），但不再有「待AI复核」这种复核叙事。
    assert.match(section, /候选（未核实）：\n- \[dsh-siyuan-notes \| inferred\] 待确认的决定/u);
    assert.ok(!section.includes('待AI复核'));
    assert.ok(section.length <= 1500, '预算 1500 字以内，实际 ' + section.length);
    // 标题每类只写一次；事实（踩过的坑）进入常驻注入；结尾提示不被截掉。
    assert.equal(section.split('偏好：').length, 2);
    assert.match(section, /踩过的坑与事实：\n- dsh-siyuan-notes\n  - 目录中的事实/u);
    assert.ok(section.endsWith('未命中不代表从未记录。'), section.slice(-40));
  } finally { fixture.close(); }
});

test('交接卡遵循工作区和项目范围，体检明确显示截断', async () => {
  const fixture = memorySqlKernel();
  try {
    await save(fixture.store, { ...trusted, type: 'preference', body: '本项目专用偏好' });
    await save(fixture.store, { project: 'q', workspace: '/other/q', confidence: 'stated', source: 'fixture', type: 'preference', body: '其它项目专用偏好' });
    await save(fixture.store, { ...trusted, project: '*', type: 'preference', body: '跨项目通用偏好' });
    const card = await fixture.store.handoff({ scope, project: 'p' });
    assert.match(card.value.markdown, /本项目专用偏好/u); assert.match(card.value.markdown, /跨项目通用偏好/u); assert.doesNotMatch(card.value.markdown, /其它项目专用偏好/u);
    const rendered = checkupRender({}, { total: 200, active: 200, complete: false, scannedLimit: 200 });
    assert.match(rendered[0].text, /不完整/u); assert.doesNotMatch(rendered[0].text, /共 200 条/u);
  } finally { fixture.close(); }
});

test('旧记忆成组绑定真实项目时，保留正文状态并补齐既有取代关系', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-migrate-'));
  const project = path.basename(directory); await fs.writeFile(path.join(directory, 'package.json'), '{}');
  const fixture = memorySqlKernel();
  try {
    const oldId = '20261110120000-0000991', id = '20261110120000-0000992';
    fixture.seed([{id:oldId,type:'state',project:'legacy',status:'superseded',confidence:'stated',source:'fixture',body:'旧进展',supersededBy:id},
      {id,type:'state',project:'legacy',status:'active',confidence:'stated',source:'fixture',body:'新进展'}]);
    const before = (await fixture.store.read([oldId,id])).value.entries;
    const result = await fixture.store.migrateLegacy({ entries: before.map(entry => ({id:entry.id,expectedRevision:entry.revision,project,workspace:directory,topic:'legacy-task'})), repairLinks:true });
    assert.equal(result.ok,true,JSON.stringify(result));
    const after = (await fixture.makeStore().read([oldId,id])).value.entries;
    assert.equal(after[0].body,'旧进展');assert.equal(after[0].status,'superseded');assert.equal(after[1].status,'active');
    assert.equal(after[1].supersedes,oldId);assert.equal(after[0].supersededBy,id);assert.ok(after.every(entry=>entry.project===project&&entry.topic==='legacy-task'&&entry.workspace));
  } finally { fixture.close(); assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('迁移显式保留既有跨项目链接并报告警告，不擅自重写历史归属', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'memory-legacy-link-'));await fs.writeFile(path.join(directory,'package.json'),'{}');
  const fixture=memorySqlKernel();
  try{
    const oldId='20261110120000-0000981',id='20261110120000-0000982';
    fixture.seed([{id:oldId,type:'decision',project:'legacy',status:'superseded',confidence:'stated',body:'历史决定',supersededBy:id},{id,type:'decision',project:'*',status:'active',confidence:'stated',body:'全局决定'}]);
    const before=await readOne(fixture.store,oldId);
    const result=await fixture.store.migrateLegacy({entries:[{id:oldId,expectedRevision:before.revision,project:path.basename(directory),workspace:directory}],repairLinks:true,preserveLegacyLinks:true});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.legacyLinks.length,1);
    const after=(await fixture.makeStore().read([oldId,id])).value.entries;
    assert.equal(after[0].supersededBy,id);assert.equal(after[1].project,'*');assert.equal(after[1].supersedes,'');
  }finally{fixture.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
