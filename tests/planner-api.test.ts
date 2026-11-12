import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createApiHandler, plannerConfig } from '../server/handler.ts';
import type { PlannerConfig } from '../server/handler.ts';
import { fixture, draft } from './planner-fixture.ts';
async function host(config:PlannerConfig){const handler=createApiHandler(config),server=createServer((req,res)=>void handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};return {base:`http://127.0.0.1:${address.port}`,close:()=>{server.closeAllConnections();server.close();}};}
const payload=()=>{const {plan,brief}=fixture();return {plan,brief};};
async function post(base:string,path:string,body:unknown,origin=base){return fetch(base+'/api/planner/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});}
test('only an explicit server feature flag enables the planner',()=>{
 assert.equal(plannerConfig({}).enabled,false);assert.equal(plannerConfig({METR_PLANNER_ENABLED:'1'}).enabled,false);assert.equal(plannerConfig({VITE_METR_PLANNER_ENABLED:'true'}).enabled,false);assert.equal(plannerConfig({METR_PLANNER_ENABLED:'true'}).enabled,true);
});
test('disabled feature rejects direct generation and shopping without invoking a model',async()=>{
 let called=false;const app=await host({enabled:false,provider:'codex',runCodex:async()=>{called=true;throw new Error('Must not call');}});
 try{assert.deepEqual(await(await fetch(app.base+'/api/planner/status?enabled=true')).json(),{enabled:false});for(const path of ['generate','products','unknown?enabled=true'])assert.equal((await post(app.base,path,payload())).status,403);assert.equal(called,false);}finally{app.close();}
});
test('generation without an agent is unavailable, with no local fallback',async()=>{
 const app=await host({enabled:true});try{assert.equal((await post(app.base,'generate',payload())).status,503);}finally{app.close();}
});
test('the removed local mode is rejected before an external request',async()=>{
 let calls=0;const app=await host({enabled:true,provider:'codex',runCodex:async()=>{calls++;return {sources:new Set(),result:{variants:[draft()]}};}});
 try{assert.equal((await post(app.base,'generate',{...payload(),mode:'local'})).status,400);assert.equal(calls,0);}finally{app.close();}
});
test('the API returns actual model coordinates as a complete editor plan',async()=>{
 const app=await host({enabled:true,provider:'codex',runCodex:async()=>({sources:new Set(),result:{variants:[draft()]}})});
 try{const response=await post(app.base,'generate',payload());assert.equal(response.status,200);const data=await response.json();assert.equal(data.layouts[0].furniture[1].x,400.7);assert.equal(data.layouts[0].improvement.engine,'agent');}finally{app.close();}
});
test('foreign origins and invalid briefs are rejected before design',async()=>{
 const app=await host({enabled:true});try{assert.equal((await post(app.base,'generate',payload(),'https://other.test')).status,403);assert.equal((await post(app.base,'generate',null)).status,400);assert.equal((await post(app.base,'generate',{...payload(),brief:{}})).status,400);}finally{app.close();}
});
test('local Codex cannot be used through a public Host',async()=>{
 let called=false;const app=await host({enabled:true,provider:'codex',runCodex:async()=>{called=true;throw new Error('Must not call');}});
 try{
  const send=(path:string,method='GET')=>new Promise<{status:number;body:string}>((resolve,reject)=>{
   const req=request(app.base+path,{method,headers:{Host:'metr.example',Origin:'http://metr.example','Content-Type':'application/json'}},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end(method==='POST'?JSON.stringify(payload()):undefined);
  });
  assert.deepEqual(JSON.parse((await send('/api/planner/status')).body),{enabled:false});assert.equal((await send('/api/planner/generate','POST')).status,403);assert.equal(called,false);
 }finally{app.close();}
});
