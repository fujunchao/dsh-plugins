import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';
import { memoryKernel } from './helpers/memory-kernel.mjs';

test('真实apply接线：首次装配、双会话、写入即生效与候选确认、撤销提醒、查询失败和压缩前捕获', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'memory-integration-'));
  const previousHome=process.env.DSH_SIYUAN_NOTES_HOME, previousFetch=globalThis.fetch, previousRecording=process.env.DSH_SIYUAN_MEMORY_RECORDING;
  process.env.DSH_SIYUAN_NOTES_HOME=dir;
  delete process.env.DSH_SIYUAN_MEMORY_RECORDING;
  const kernel=memoryKernel();
  const registry=new Map(), sections=[], contexts=[], listeners=new Map(), disposers=[], prompts=[];
  let handler;
  globalThis.fetch=async(url,init)=>{
    const result=await kernel.call(new URL(url).pathname,JSON.parse(init?.body??'{}'));
    return Response.json(result.ok?result.value:{code:-1,msg:result.error.message});
  };
  const ctx={
    webServer:{register(route){handler=route.handler;return ()=>{};}},
    systemPrompt:{section(value){sections.push(value);return ()=>{};},context(value){contexts.push(value);return ()=>{};}},
    effect(fn){const dispose=fn();if(typeof dispose==='function')disposers.push(dispose);return dispose;},
    inject(_deps,fn){return fn(ctx);},on(event,fn){listeners.set(event,fn);return ()=>listeners.delete(event);},
    get(name){
      if(name==='tools')return {register(tool){registry.set(tool.name,tool);return ()=>{};}};
      if(name==='tokenMeter')return {contextPressure:session=>({pressureTokens:session.ratio*100,contextWindow:100})};
      if(name==='llm')return {stream:async function*(input){prompts.push(input);yield {type:'text-delta',text:'[]'};}};
    },
  };
  const request=async(body,url='/siyuan/memory',method='POST')=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url});
    const res={writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};
    await handler(req,res);return res;
  };
  const agent=(id,ratio)=>({session:{id,header:{cwd:dir},ratio,deriveMessages(){return [{role:'user',content:[{type:'text',text:this.text??'会话内容'}]}];},requestHeader(){return {config:{provider:'fake',model:'fake'}};}}});
  const assemble=async agent=>{const value={sections:sections.map(item=>({name:item.name,text:item.text({agent})})),contexts:contexts.map(item=>({name:item.name,text:item.text({agent})}))};return listeners.get('system-prompt/assemble')(value,{agent},async()=>value);};
  try {
    apply(ctx,{baseUrl:'http://fake.invalid:6806',token:''});
    const a=agent('A',.1),b=agent('B',.7);
    assert.equal(listeners.get('agent/created')({agent:a}),undefined,'创建监听器只启动预热，不能返回阻塞 Promise');
    await assemble(a);
    const memory=sections.find(item=>item.name==='siyuan-notes-memory');
    const hint=contexts.find(item=>item.name==='siyuan-notes-memory-hint');
    const first=memory.text({agent:a});
    // 写入即生效：模型一次 memory_write 就落 active，不再有「候选 → 确认」的必经两步。
    const written=await registry.get('memory_write').execute({type:'preference',project:'*',text:'采用中文说明'}, {agent:a});
    assert.equal(written.ok,true,JSON.stringify(written));
    assert.equal(written.status,'active',JSON.stringify(written));
    let listed=await request(undefined,'/siyuan/memory?view=entries','GET');
    assert.equal(listed.body.value.entries[0].status,'active');
    // 面板确认仍然保留，但它只对候选有意义：inferred 的写入才需要人确认。
    const guessed=await registry.get('memory_write').execute({type:'decision',project:'*',text:'对外报表使用中文标题',confidence:'inferred'}, {agent:a});
    assert.equal(guessed.status,'candidate',JSON.stringify(guessed));
    const candidate=(await request(undefined,'/siyuan/memory?view=entries&status=candidate','GET')).body.value.entries[0];
    assert.equal(candidate.id,guessed.id);
    const approved=await request({action:'approve',id:candidate.id,expectedRevision:candidate.revision});
    assert.equal(approved.status,200,JSON.stringify(approved.body));
    assert.equal(approved.body.value.status,'active');
    // 已生效的条目不需要（也不允许）再确认一次，否则「确认」就又变成必经步骤了。
    const redundant=await request({action:'approve',id:written.id,expectedRevision:listed.body.value.entries[0].revision});
    assert.equal(redundant.status,400,JSON.stringify(redundant.body));
    assert.equal(redundant.body.error.code,'invalid_status');
    await listeners.get('agent/created')({agent:b});
    await assemble(b);
    assert.equal(memory.text({agent:a}),first,'已装配会话的冻结快照不因新写入变化');
    assert.ok(memory.text({agent:b}).includes('采用中文说明'));
    assert.ok(memory.text({agent:b}).includes('对外报表使用中文标题'),'面板确认后的条目进入新会话的常驻注入');
    assert.match(hint.text({agent:b}),/60%/);
    assert.ok(!hint.text({agent:a}).includes('60%'));
    listed=await request(undefined,'/siyuan/memory?view=entries','GET');
    const decision=listed.body.value.entries.find(entry=>entry.statement.includes('对外报表使用中文标题'));
    assert.equal((await request({action:'revoke',id:decision.id,expectedRevision:decision.revision})).status,200);
    assert.ok(hint.text({agent:b}).includes('已失效'));
    assert.equal((await request(undefined,'/siyuan/memory','GET')).body.value.sessionId,null);
    assert.equal((await request(undefined,'/siyuan/memory?sessionId=B','GET')).body.value.sessionId,'B');
    // 已存在会话没有经过created时，装配waterfall也必须在第一步补齐快照。
    const c=agent('C',.85);c.session.text='压缩前证据：已决定采用方案C';
    const assembly={sections:sections.map(item=>({...item,text:item.text({agent:c})})),contexts:contexts.map(item=>({...item,text:item.text({agent:c})}))};
    const result=await listeners.get('system-prompt/assemble')(assembly,{agent:c},async()=>assembly);
    assert.ok(!result.sections.find(item=>item.name==='siyuan-notes-memory').text.includes('正在读取'));
    c.session.ratio=.25;c.session.text='压缩后的摘要';
    listeners.get('agent/turn-stopping')({agent:c});
    for(let i=0;i<50&&!prompts.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(prompts.length,1);
    assert.ok(prompts[0].messages[0].content[0].text.includes('压缩前证据'));
    kernel.state.offline=true;
    assert.equal((await request(undefined,'/siyuan/memory?view=entries','GET')).body.ok,false);
    listeners.get('agent/disposed')({agent:a});
    assert.equal((await request(undefined,'/siyuan/memory?sessionId=A','GET')).body.ok,false);
  } finally {
    for(const dispose of disposers.reverse())dispose();
    globalThis.fetch=previousFetch;
    if(previousHome===undefined)delete process.env.DSH_SIYUAN_NOTES_HOME;else process.env.DSH_SIYUAN_NOTES_HOME=previousHome;
    if(previousRecording===undefined)delete process.env.DSH_SIYUAN_MEMORY_RECORDING;else process.env.DSH_SIYUAN_MEMORY_RECORDING=previousRecording;
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
