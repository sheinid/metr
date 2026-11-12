import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { activePlan, demoProject } from '../src/model.ts';
import { defaultBrief } from '../src/planner/layout.ts';
import { createApiHandler, plannerConfig } from '../server/handler.ts';
import type { PlannerConfig } from '../server/handler.ts';
async function host(config:PlannerConfig){const handler=createApiHandler(config),server=createServer((req,res)=>void handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};return {base:`http://127.0.0.1:${address.port}`,close:()=>{server.closeAllConnections();server.close();}};}
const payload=()=>{const plan=activePlan(demoProject());return {plan,brief:defaultBrief(plan),mode:'local'};};
async function post(base:string,path:string,body:unknown,origin=base){return fetch(base+'/api/planner/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});}
test('feature is off by default and only an explicit server flag enables it',()=>{
  assert.equal(plannerConfig({}).enabled,false);assert.equal(plannerConfig({METR_PLANNER_ENABLED:'1'}).enabled,false);assert.equal(plannerConfig({VITE_METR_PLANNER_ENABLED:'true'}).enabled,false);assert.equal(plannerConfig({METR_PLANNER_ENABLED:'true'}).enabled,true);
});
test('disabled feature hides status and rejects generation, shopping and direct URL bypasses',async()=>{
  let called=false;const app=await host({enabled:false,apiKey:'test-only',model:'test',fetch:(async()=>{called=true;throw new Error('Must not call');}) as typeof fetch});
  try{assert.deepEqual(await(await fetch(app.base+'/api/planner/status?enabled=true')).json(),{enabled:false});for(const path of ['generate','products','unknown?METR_PLANNER_ENABLED=true'])assert.equal((await post(app.base,path,payload())).status,403);assert.equal(called,false);}finally{app.close();}
});
test('local generation works when explicitly enabled and never requires an AI key',async()=>{
  const app=await host({enabled:true});try{const response=await post(app.base,'generate',payload());assert.equal(response.status,200);const result=await response.json();assert.equal(result.layouts.length,3);assert.ok(result.layouts.every((p:{improvement:{engine:string}})=>p.improvement.engine==='local'));assert.equal((await post(app.base,'generate',{...payload(),mode:'agent'})).status,503);}finally{app.close();}
});
test('foreign origins and invalid data are rejected before generation',async()=>{
  const app=await host({enabled:true});try{assert.equal((await post(app.base,'generate',payload(),'https://other.test')).status,403);assert.equal((await post(app.base,'generate',null)).status,400);assert.equal((await post(app.base,'generate',{...payload(),brief:{}})).status,400);assert.equal((await post(app.base,'products',{purchase:{},brief:{}})).status,400);}finally{app.close();}
});
test('agent only selects verified candidate IDs and gets no background or product URLs',async()=>{
  let called=0;const fake=(async(_url:unknown,init?:RequestInit)=>{called++;const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);assert.equal(body.store,false);assert.ok(!('background'in input.source));assert.ok(input.source.furniture.every((f:Record<string,unknown>)=>!('url'in f)));const candidate=input.candidates[0];return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({selections:[{candidateId:candidate.id,title:'Проверенный вариант',summary:'Test',tradeoffs:['Test']}]})}]}]}),{status:200});}) as typeof fetch;
  const app=await host({enabled:true,apiKey:'test-only',model:'test',fetch:fake});try{const response=await post(app.base,'generate',{...payload(),mode:'agent'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.layouts.length,1);assert.equal(data.layouts[0].improvement.engine,'agent');assert.equal(called,1);}finally{app.close();}
});
test('invented candidate IDs from the agent are rejected',async()=>{
  const fake=(async()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({selections:[{candidateId:'invented',title:'Test',summary:'Test',tradeoffs:[]}]})}]}]}))) as typeof fetch;
  const app=await host({enabled:true,apiKey:'test-only',model:'test',fetch:fake});try{assert.equal((await post(app.base,'generate',{...payload(),mode:'agent'})).status,400);}finally{app.close();}
});

test('local Codex is unavailable through a public Host even with the server flag enabled',async()=>{
  let called=false;
  const app=await host({enabled:true,provider:'codex',runCodex:async()=>{called=true;throw new Error('Must not call');}});
  try{
    const send=(path:string,method='GET')=>new Promise<{status:number;body:string}>((resolve,reject)=>{
      const req=request(app.base+path,{method,headers:{Host:'metr.example',Origin:'http://metr.example','Content-Type':'application/json'}},res=>{
        let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body}));
      });req.on('error',reject);req.end(method==='POST'?JSON.stringify({...payload(),mode:'agent'}):undefined);
    });
    assert.deepEqual(JSON.parse((await send('/api/planner/status')).body),{enabled:false});
    assert.equal((await send('/api/planner/generate','POST')).status,403);assert.equal(called,false);
  }finally{app.close();}
});
