import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { createHash } from "node:crypto";
import { createNativeEditorGateway } from "../lib/native-editor.js";
import { createTextInsertTool } from "../lib/insert-text.js";
import { normalizeContext, contextToolValue } from "../lib/index.js";
import { readFile } from "node:fs/promises";

const docId = "20261109000000-doc0001";
const anchor = "20261109000000-block01";
const other = "20261109000000-doc0002";
const get = (session, requestPath, { method = "GET", body, origin, host, site } = {}) => new Promise((resolve, reject) => {
  const url = new URL(session.url);
  const req = http.request({hostname:"127.0.0.1",port:url.port,path:requestPath,method,headers:{host:host||url.host,...(origin?{origin}:{}),...(site?{"sec-fetch-site":site}:{}),...(body?{"content-type":"application/json"}:{})}}, res=>{
    const chunks=[];res.on("data",x=>chunks.push(x));res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
  });req.on("error",reject);req.end(body?JSON.stringify(body):undefined);
});

test("原生网关隔离来源、凭据、配置、布局及生命周期", async () => {
  const requests=[];
  let loginCount=0;
  const upstream=http.createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    requests.push({path:req.url,headers:req.headers,body});
    res.setHeader("content-type","application/json");
    if(req.url==="/api/system/loginAuth"){
      loginCount++;assert.equal(JSON.parse(body).authCode,"user-entered-password");
      res.setHeader("set-cookie","siyuan=upstream-session; HttpOnly; Path=/");res.end(JSON.stringify({code:0}));
    }else if(req.url==="/api/system/getConf")res.end(JSON.stringify({code:0,data:{conf:{api:{token:"kernel-secret"},accessAuthCode:"*******",appearance:{themeLight:"custom"},uiLayout:{private:"layout"}}}}));
    else if(req.url==="/api/notebook/lsNotebooks"){
      assert.equal(req.headers.authorization,undefined,"会话校验不得借用 API token");
      assert.equal(req.headers.cookie,"siyuan=upstream-session");
      res.end(JSON.stringify({code:0,data:{notebooks:[]}}));
    }
    else if(req.url==="/stage/build/desktop/"){res.setHeader("content-type","text/html");res.end("<!doctype html><html><head></head><body>upstream</body></html>");}
    else res.end(JSON.stringify({code:0,data:"forwarded"}));
  });
  await new Promise(r=>upstream.listen(0,"127.0.0.1",r));
  const settings={baseUrl:"http://127.0.0.1:"+upstream.address().port,token:"kernel-secret"};
  const gateway=createNativeEditorGateway({getSettings:()=>settings,call:async(_s,p)=>p.endsWith("getBlockInfo")?{rootID:docId}:p.endsWith("version")?"3.8.3":p.endsWith("getConf")?{conf:{accessAuthCode:"*******"}}:{kramdown:"before"}});
  try {
    const session=await gateway.open({docId,title:"测试",parentOrigin:"http://127.0.0.1:9000"});
    assert.equal((await get(session,"/api/query/sql",{method:"POST",body:{}})).status,401,"登录前不得借 API token 访问原生接口");
    const loginPage=await get(session,"/stage/build/desktop/",{site:"cross-site"});
    assert.ok(loginPage.body.includes("思源锁屏密码"));assert.ok(!loginPage.body.includes("kernel-secret"));
    assert.equal((await get(session,"/stage/build/desktop/",{host:"attacker.local"})).status,403);
    assert.equal((await get(session,"/__dsh/login",{method:"POST",origin:"https://attacker.test",body:{channel:session.channel,authCode:"bad"}})).status,403);
    const login=await get(session,"/__dsh/login",{method:"POST",origin:session.origin,body:{channel:session.channel,authCode:"user-entered-password"}});
    assert.equal(JSON.parse(login.body).code,0);assert.equal(login.headers["set-cookie"],undefined,"上游登录凭据不下发浏览器");
    const page=await get(session,"/stage/build/desktop/");assert.ok(page.body.includes("__DSH_NATIVE__"));assert.ok(!page.body.includes("kernel-secret"));
    const conf=JSON.parse((await get(session,"/api/system/getConf",{method:"POST",origin:session.origin,body:{}})).body);
    assert.equal(conf.data.conf.api.token,"");assert.equal(conf.data.conf.accessAuthCode,"");assert.deepEqual(conf.data.conf.uiLayout,{});
    assert.equal(conf.data.conf.appearance.themeLight,"daylight");
    assert.equal((await get(session,"/api/query/sql",{method:"POST",site:"cross-site",body:{}})).status,403);
    const before=requests.length;
    await get(session,"/api/system/setUILayout",{method:"POST",origin:session.origin,body:{layout:"isolated"}});
    assert.equal(requests.length,before,"内嵌布局不写入思源");
    const plugins=JSON.parse((await get(session,"/api/petal/loadPetals",{method:"POST",origin:session.origin,body:{}})).body);
    assert.equal(plugins.data.length,1);assert.equal(plugins.data[0].name,"dsh-native-editor-bridge");
    const second=await gateway.open({docId,parentOrigin:"http://127.0.0.1:9000"});
    assert.ok((await get(second,"/stage/build/desktop/")).body.includes("upstream"));assert.equal(loginCount,1,"只复用内存会话，不保存密码");
    assert.equal(gateway.close(session.id),true);assert.equal(gateway.touch(session.id),false);
    gateway.reset();assert.equal(gateway.touch(second.id),false);
    const third=await gateway.open({docId,parentOrigin:"dsh-app://app"});
    assert.ok((await get(third,"/stage/build/desktop/")).body.includes("思源锁屏密码"),"换连接后清除登录会话");
  }finally{gateway.dispose();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});

test("原生 WebSocket 透传握手，拒绝跨源并清理连接", async () => {
  let upgraded=0;
  const upstream=http.createServer();
  const upstreamSockets=new Set();
  upstream.on("upgrade",(req,socket)=>{
    upgraded++;assert.equal(req.headers.authorization,"Token token");assert.equal(req.headers.origin,"http://127.0.0.1:"+upstream.address().port);
    upstreamSockets.add(socket);socket.on("close",()=>upstreamSockets.delete(socket));
    const accept=createHash("sha1").update(req.headers["sec-websocket-key"]+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n");
  });
  await new Promise(r=>upstream.listen(0,"127.0.0.1",r));
  const gateway=createNativeEditorGateway({getSettings:()=>({baseUrl:"http://127.0.0.1:"+upstream.address().port,token:"token"}),call:async(_s,p)=>p.endsWith("version")?"3.8.3":p.endsWith("getConf")?{conf:{}}:p.endsWith("getBlockInfo")?{rootID:docId}:{kramdown:"text"}});
  try{
    const session=await gateway.open({docId,parentOrigin:"null"});
    const connect=origin=>new Promise(resolve=>{
      const u=new URL(session.origin);const req=http.request({hostname:"127.0.0.1",port:u.port,path:"/ws?app=test&id=one&type=protyle",headers:{host:u.host,origin,connection:"Upgrade",upgrade:"websocket","sec-websocket-version":"13","sec-websocket-key":"dGhlIHNhbXBsZSBub25jZQ=="}});
      req.on("upgrade",(_res,socket)=>resolve(socket));req.on("error",()=>resolve(null));req.end();
    });
    assert.equal(await connect("https://attacker.test"),null);assert.equal(upgraded,0);
    const socket=await connect(session.origin);assert.ok(socket);assert.equal(upgraded,1);
    const closed=new Promise(r=>socket.once("close",r));gateway.close(session.id);await closed;
  }finally{gateway.dispose();for(const socket of upstreamSockets)socket.destroy();await new Promise(r=>upstream.close(r));}
});

test("原生消息必须来自当前 iframe、当前来源和当前文档", async()=>{
  let bundle;const React={Component:class{},createElement:()=>({})};
  const window={__ModuleLoader__:{load({factory}){bundle=factory(()=>React)}}};
  new Function("window",await readFile(new URL("../lib/client.js",import.meta.url),"utf8"))(window);
  const accept=bundle.__panes.acceptNativeMessage;const source={};const session={origin:"http://one.localhost:1",channel:"one",docId};
  const event={source,origin:session.origin,data:{source:"dsh-siyuan-native",channel:"one",docId,type:"quote"}};
  assert.ok(accept(event,{contentWindow:source},session));
  for(const changed of [{source:{}},{origin:"http://wrong.localhost:1"},{data:{...event.data,docId:other}},{data:{...event.data,channel:"other"}}])assert.equal(accept({...event,...changed},{contentWindow:source},session),false);
  const normalized=normalizeContext({docId,view:"native",blockId:anchor,pending:true,selection:{text:"选区",blockId:anchor,endBlockId:anchor}});
  assert.equal(contextToolValue(normalized.value).blockId,anchor);assert.equal(normalized.value.selection.blockId,anchor);assert.equal(normalized.value.pending,true);
});

test("文字插入校验目标、备份和读回，不重放未确认写入", async()=>{
  let writes=0,backupFails=false,confirm=true,captured;
  const call=async(p,x)=>{
    let data;
    if(p.endsWith("getBlockInfo"))data={rootID:x.id===other?other:docId};
    else if(p.endsWith("getBlockKramdown"))data={kramdown:"旧文档"};
    else if(p.endsWith("insertBlock")||p.endsWith("appendBlock")){writes++;captured=x;data=[];}
    else if(p.endsWith("getBlockDOM"))data={dom:confirm?captured.data:""};
    else if(p.endsWith("getBlockRelevantIDs"))data={previousID:anchor,parentID:docId};
    return {ok:true,value:{code:0,data}};
  };
  const tool=createTextInsertTool({call,backup:async()=>backupFails?{ok:false,error:{message:"disk full"}}:{ok:true},editorContext:()=>({docId})});
  assert.equal((await tool.execute({doc:docId,after:other,text:"错误目标"})).error.code,"invalid_anchor");assert.equal(writes,0);
  backupFails=true;assert.equal((await tool.execute({text:"备份失败"})).error.code,"backup_failed");assert.equal(writes,0);
  backupFails=false;const result=await tool.execute({text:'<script>&\n第二行',after:anchor});assert.equal(result.ok,true);assert.ok(captured.data.includes("&lt;script&gt;&amp;<br>第二行"));assert.equal(writes,1);
  confirm=false;const pending=await tool.execute({text:"无法确认",after:anchor});assert.equal(pending.error.code,"insert_unconfirmed");assert.ok(pending.blockId);assert.equal(writes,2,"确认重试只读，不重复写入");
});

test("原生桥接保存失败、组合输入或上传时不确认退出", async()=>{
  const module={exports:{}};
  new Function("require","module",await readFile(new URL("../lib/native-bridge.cjs",import.meta.url),"utf8"))(()=>({Plugin:class{},Protyle:class{}}),module);
  const bridge=new module.exports();const events=[];bridge.send=(type,payload)=>events.push({type,payload});
  bridge.revision=2;bridge.savedRevision=1;bridge.requests=new Set();bridge.currentTitle=()=>"标题";
  bridge.editor={isUploading:()=>false,flushPendingTransactions:async()=>{throw new Error("连接失败")}};
  await assert.rejects(bridge.flush(),/连接失败/);assert.equal(bridge.savedRevision,1);assert.ok(!events.some(x=>x.type==="saved"));
  bridge.composing=true;await assert.rejects(bridge.flush(),/输入法/);bridge.composing=false;
  bridge.editor.isUploading=()=>true;await assert.rejects(bridge.flush(),/上传/);bridge.editor.isUploading=()=>false;
  bridge.editor.flushPendingTransactions=async()=>{bridge.revision++};await assert.rejects(bridge.flush(),/新输入/);
  bridge.editor.flushPendingTransactions=async()=>{};bridge.saveError="回执未确认";await assert.rejects(bridge.flush(),/未确认/);
  bridge.saveError=null;await bridge.flush();assert.equal(bridge.savedRevision,bridge.revision);assert.equal(events.at(-1).type,"saved");
});
