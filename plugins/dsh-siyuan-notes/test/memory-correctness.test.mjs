import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfirmedMemoryStore as createMemoryStore } from './helpers/confirmed-memory-store.mjs';
import { runDistill, renderTranscript } from '../lib/distill.js';
import { memoryKernel } from './helpers/memory-kernel.mjs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryReceipts } from '../lib/memory-receipts.js';

const scope = { workspace: '/workspace/p', project: 'p', projects: ['*', 'p'], projectRoots: { p: '/workspace/p' } };
const trusted = { confidence: 'stated', source: 'user:test', scope, project: 'p' };
const stateBody = title => `${title}\n- 下一步：验收\n- 待决：无`;

test('未核实和其他项目的条目不能进入常驻提示', async () => {
  const kernel = memoryKernel();
  const store = createMemoryStore({ call: kernel.call });
  await store.write({ ...trusted, type: 'preference', statement: '合法的当前项目偏好' });
  await store.write({ type: 'preference', project: 'other', workspace: '/workspace/other', confidence: 'inferred', source: 'distill:test', statement: '不该自动生效的偏好' });
  const text = await store.sectionText({ scope });
  assert.ok(text.includes('合法的当前项目偏好'));
  assert.ok(!text.includes('不该自动生效的偏好'));
  // P2-2 瘦身：stated 是默认可信度，不再写进常驻注入；v7 起项目名只写在组头，条目行两空格缩进。
  assert.ok(text.includes('- p\n  - 合法的当前项目偏好'), text);
});

test('经过一分钟并发生写入后，已生成的快照仍冻结', async () => {
  let clock = Date.parse('2026-11-09T04:00:00Z');
  const kernel = memoryKernel();
  const store = createMemoryStore({ call: kernel.call, now: () => clock });
  await store.write({ ...trusted, type: 'preference', statement: '初始偏好' });
  const before = await store.sectionText({ scope });
  clock += 61_000;
  await store.write({ ...trusted, type: 'decision', statement: '本轮新决定' });
  assert.equal(await store.sectionText({ scope }), before);
});

test('内核不可达不能冒充成功的未命中', async () => {
  const kernel = memoryKernel(); kernel.state.offline = true;
  const store = createMemoryStore({ call: kernel.call });
  assert.equal((await store.search({ query: '旧决定' })).ok, false);
  assert.match(await store.sectionText({ scope }), /不可用/);
  assert.equal((await store.list()).ok, false);
});

test('蒸馏写出的状态只取代同一任务主题的旧状态，不动同项目其他任务', async () => {
  const kernel = memoryKernel();
  const store = createMemoryStore({ call: kernel.call });
  const editor = await store.write({ ...trusted, type: 'state', topic: 'editor', body: stateBody('编辑器完成') });
  const memory = await store.write({ ...trusted, type: 'state', topic: 'memory', body: stateBody('记忆完成') });
  assert.equal(editor.ok, true); assert.equal(memory.ok, true);
  const result = await runDistill({ provider: 'fake', model: 'fake', sessionId: 'test', transcript: '记忆任务有进展', scope, projects: ['*', 'p'],
    activeStates: new Map([['p', [editor.value.id, memory.value.id]]]), write: spec => store.write(spec),
    stream: async function* () { yield { type: 'text-delta', text: JSON.stringify([{ type: 'state', project: 'p', topic: 'memory', text: stateBody('记忆验收完成') }]) }; } });
  assert.equal(result.ok, true);
  const entries = (await store.list()).value.entries;
  const active = entries.filter(entry => entry.status === 'active');
  assert.equal(active.length, 2);
  assert.ok(active.some(entry => entry.id === editor.value.id), '另一个任务的状态不受影响');
  assert.ok(active.some(entry => entry.statement === '记忆验收完成'), '新状态直接生效');
  assert.equal(entries.find(entry => entry.id === memory.value.id).status, 'superseded');
  assert.equal(entries.filter(entry => entry.status === 'candidate').length, 0);
});

test('蒸馏拒绝虚构项目和不完整状态', async () => {
  const written = [];
  const result = await runDistill({ provider: 'fake', model: 'fake', transcript: '讨论进度', projects: ['*', 'p'],
    write: async spec => { written.push(spec); return { ok: true }; },
    stream: async function* () { yield { type: 'text-delta', text: '[{"type":"state","project":"invented","text":"只有一行"}]' }; } });
  // 不合格的条目被丢弃并说明原因，不写入；整理本身不因此卡住。
  assert.equal(result.ok, true);
  assert.equal(result.dropped.length, 1);
  assert.equal(written.length, 0);
});

test('重复重试不追加第二块，且可读正文保留换行', async () => {
  const kernel = memoryKernel();
  const store = createMemoryStore({ call: kernel.call });
  const input = { ...trusted, type: 'decision', body: '采用方案A\n- 理由：实测可用' };
  const [a, b] = await Promise.all([store.write(input), store.write(input)]);
  assert.equal(a.value.id, b.value.id);
  assert.equal(kernel.blocks.size, 1);
  const entry = (await store.read([a.value.id])).value.entries[0];
  assert.equal(entry.statement, '采用方案A');
  assert.match(entry.body, /\n- 理由/);
});

test('超长末条消息仍保留末尾纠正，并满足长度预算', () => {
  const text = renderTranscript([{ role: 'user', content: [{ type: 'text', text: '旧内容'.repeat(1000) + '最终纠正：使用方案B' }] }], 200);
  assert.ok(text.length <= 200);
  assert.ok(text.includes('最终纠正：使用方案B'));
});

test('候选确认校验正文版本，恢复旧状态前必须处理有效的新状态', async () => {
  const kernel=memoryKernel(), store=createMemoryStore({call:kernel.call});
  const created=await store.write({...trusted,type:'state',topic:'memory',body:stateBody('旧进展'),confidence:'inferred'});
  let entry=(await store.read([created.value.id])).value.entries[0];
  assert.equal((await store.approve({id:entry.id,expectedRevision:'stale',confidence:'stated'})).ok,false);
  assert.equal((await store.approve({id:entry.id,expectedRevision:entry.revision,confidence:'stated'})).ok,true);
  entry=(await store.read([entry.id])).value.entries[0];
  const newer=await store.write({...trusted,type:'state',topic:'memory',body:stateBody('新进展'),supersedes:[entry.id],expectedRevisions:{[entry.id]:entry.revision}});
  assert.equal(newer.ok,true,JSON.stringify(newer));
  const pair=(await store.read([entry.id,newer.value.id])).value.entries;
  assert.equal(pair[0].supersededBy,newer.value.id);
  assert.equal(pair[1].supersedes,entry.id);
  assert.equal((await store.setStatus({id:entry.id,status:'active'})).ok,false);
  assert.equal((await store.setStatus({id:newer.value.id,status:'revoked'})).ok,true);
  assert.equal((await store.setStatus({id:entry.id,status:'active'})).ok,true);
  const restored=(await store.read([entry.id,newer.value.id])).value.entries;
  assert.equal(restored[0].supersededBy,'');
  assert.equal(restored[1].supersedes,'');
});

test('部分属性失败在新存储实例中续写原块，凭据不含正文', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'memory-receipts-'));
  try {
    const kernel=memoryKernel();kernel.state.failAttrs=true;
    const input={...trusted,type:'fact',body:'私有正文标记abc'};
    const store=createMemoryStore({call:kernel.call,receipts:createMemoryReceipts(directory)});
    const failed=await store.write(input);
    assert.equal(failed.ok,false);assert.ok(failed.partial.id);
    const files=await fs.readdir(directory);
    assert.equal(files.length,1);
    assert.ok(!(await fs.readFile(path.join(directory,files[0]),'utf8')).includes(input.body));
    kernel.state.failAttrs=false;
    const restarted=createMemoryStore({call:kernel.call,receipts:createMemoryReceipts(directory)});
    const completed=await restarted.write(input);
    assert.equal(completed.ok,true,JSON.stringify(completed));
    assert.equal(completed.value.id,failed.partial.id);
    assert.equal(kernel.blocks.size,1);
  } finally { assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('追加响应丢失后重试被阻止，不冒险再写一块', async () => {
  const kernel=memoryKernel();let appends=0;
  const store=createMemoryStore({call:async(api,payload)=>{
    const result=await kernel.call(api,payload);
    if(api.endsWith('/appendBlock')) { appends++;return {ok:false,error:{code:'network',message:'响应丢失'}}; }
    return result;
  }});
  const input={...trusted,type:'fact',body:'只允许一块'};
  assert.equal((await store.write(input)).ok,false);
  const retry=await store.write(input);
  assert.equal(retry.error.code,'append_uncertain');
  assert.equal(appends,1);assert.equal(kernel.blocks.size,1);
});

test('离线缓存明确标记不完整，交接卡保留下一步，体检使用指定过期天数', async () => {
  const kernel=memoryKernel();
  const at=Date.parse('2026-11-09T04:00:00Z');
  const store=createMemoryStore({call:kernel.call,now:()=>at});
  const written=await store.write({...trusted,type:'state',topic:'memory',body:stateBody('本周进度')});
  kernel.state.offline=true;
  const cached=await store.search({query:'本周'});
  assert.equal(cached.ok,true);assert.equal(cached.value.complete,false);
  assert.equal(cached.value.availability,'partial');
  kernel.state.offline=false;
  const card=await store.handoff();assert.match(card.value.markdown,/- 下一步：验收/);
  const report=await store.checkup({now:at+8*86400000,staleStateDays:7});
  assert.ok(report.value.staleStates.some(entry=>entry.id===written.value.id));
});

test('索引延迟时刚确认的候选立即可见，状态缓存中每个ID只有一份', async () => {
  const kernel=memoryKernel(), store=createMemoryStore({call:kernel.call});
  const written=await store.write({...trusted,type:'preference',confidence:'inferred',body:'待确认偏好'});
  const candidate=(await store.read([written.value.id])).value.entries[0];
  assert.equal(store.peekRing().length,0,'模拟正文已入索引后缓存退出');
  kernel.state.indexed=false;
  assert.equal((await store.approve({id:candidate.id,confidence:'stated',expectedRevision:candidate.revision})).ok,true);
  assert.ok((await store.sectionText({scope,force:true})).includes('待确认偏好'));
  await store.setStatus({id:candidate.id,status:'revoked'});
  assert.equal((await store.search({status:'active'})).value.results.length,0);
  assert.equal(store.peekRing().filter(entry=>entry.id===candidate.id).length,1);
});
