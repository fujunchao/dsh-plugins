import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

test('记忆面板展示候选，确认请求携带用户看到的版本', async () => {
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  const candidate={id:'20261109120000-0000001',statement:'使用中文',body:'使用中文',type:'preference',project:'*',workspace:'/workspace/p',status:'candidate',confidence:'inferred',revision:'viewed-revision',source:'distill:test',created:'20261109120000'};
  const values=[{catalog:[]},[candidate],false,null,'','','',candidate.id,null,null];let cursor=0;
  const React={Component:class{},createElement:(type,props,...children)=>({type,props:props??{},children}),
    useState:initial=>{const slot=cursor++;if(!(slot in values))values[slot]=initial;return [values[slot],next=>{values[slot]=typeof next==='function'?next(values[slot]):next;}];},useEffect:()=>{},useLayoutEffect:()=>{},useMemo:fn=>fn(),useCallback:fn=>fn,useRef:value=>({current:value}),useSyncExternalStore:(_s,get)=>get()};
  let exports;const win={__ModuleLoader__:{load({factory}){exports=factory(name=>name==='react'?React:{});}}};
  const calls=[];
  const fetch=async(url,init)=>{calls.push({url,init});return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,value:url.includes('view=approval')?{candidate,conflicts:[],topics:[]}:url.includes('view=entries')?{entries:[],complete:true}:{catalog:[]}})};};
  new Function('window','document','fetch',source)(win,{createElement:()=>({dataset:{}}),head:{appendChild(){}},querySelector:()=>null},fetch);
  const tree=exports.__panes.MemoryPage({t:key=>key});
  const nodes=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.children);};walk(tree);
  const confirm=nodes.find(node=>node.type==='button'&&node.children.includes('memoryApprove'));
  assert.ok(confirm,'展开候选必须有明确确认按钮');
  confirm.props.onClick();
  for(let i=0;i<20&&!values[10]?.approval;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.some(call=>call.init?.method==='POST'),false,'点击候选先展示全文与范围，不直接确认');
  cursor=0;nodes.length=0;walk(exports.__panes.MemoryPage({t:key=>key}));
  assert.ok(JSON.stringify(nodes).includes('工作区路径'));
  nodes.find(node=>node.type==='button'&&node.children.includes('确认合并并生效')).props.onClick();
  for(let i=0;i<20&&!calls.some(call=>call.init?.method==='POST');i++)await new Promise(resolve=>setImmediate(resolve));
  const posted=calls.find(call=>call.init?.method==='POST');
  assert.deepEqual(JSON.parse(posted.init.body),{action:'approve',id:candidate.id,expectedRevision:'viewed-revision',project:'*',workspace:'/workspace/p',global:false,body:'使用中文',supersedes:[],expectedRevisions:{}});
  assert.ok(JSON.stringify(tree).includes('memoryStatusCandidate'));
});

test('比较状态后提交用户合并的正文、候选版本和旧状态版本', async () => {
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  const candidate={id:'20261110120000-0000001',body:'新进展\n- 下一步：发布\n- 待决：无',statement:'新进展',type:'state',topic:'task',project:'p',workspace:'/workspace/p',status:'candidate',confidence:'inferred',revision:'candidate-version'};
  const old={id:'20261110120000-0000002',body:'旧进展\n- 下一步：补测试\n- 待决：无',revision:'old-version'};
  const body='合并进展\n- 下一步：补测试后发布\n- 待决：无';
  const manager={approval:{candidate,conflicts:[old]},selected:[old.id],body,recoveries:null,inspection:null};
  const values=[{catalog:[]},[candidate],false,null,'','','',candidate.id,null,null,manager];let cursor=0;
  const React={Component:class{},createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>[cursor<values.length?values[cursor++]:initial,()=>{}],useEffect:()=>{},useLayoutEffect:()=>{},useMemo:fn=>fn(),useCallback:fn=>fn,useRef:value=>({current:value}),useSyncExternalStore:(_s,get)=>get()};
  let exports;const win={__ModuleLoader__:{load({factory}){exports=factory(name=>name==='react'?React:{});}}};const calls=[];
  const fetch=async(url,init)=>{calls.push({url,init});return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,value:{entries:[],catalog:[]}})};};
  new Function('window','document','fetch',source)(win,{createElement:()=>({dataset:{}}),head:{appendChild(){}},querySelector:()=>null},fetch);
  const nodes=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.children);};walk(exports.__panes.MemoryPage({t:key=>key}));
  const button=nodes.find(node=>node.type==='button'&&node.children.includes('确认合并并生效'));
  assert.ok(button);button.props.onClick();
  for(let i=0;i<20&&!calls.some(call=>call.init?.method==='POST');i++)await new Promise(resolve=>setImmediate(resolve));
  const payload=JSON.parse(calls.find(call=>call.init?.method==='POST').init.body);
  assert.deepEqual(payload,{action:'approve',id:candidate.id,expectedRevision:'candidate-version',project:'p',workspace:'/workspace/p',global:false,body,supersedes:[old.id],expectedRevisions:{[old.id]:'old-version'}});
});
