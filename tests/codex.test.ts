import test from 'node:test';
import assert from 'node:assert/strict';
import { codexArguments, collectSearchSources } from '../server/codex.ts';
import { designLayouts, findProducts } from '../server/agent.ts';
import { fixture, draft } from './planner-fixture.ts';

test('Codex is read-only and ephemeral, receives images and has shell and plugins disabled',()=>{
 const args=codexArguments('schema','answer',false,undefined,['/tmp/plan.png']);
 for(const flag of ['--ignore-user-config','--ephemeral','--skip-git-repo-check'])assert.ok(args.includes(flag));
 assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.equal(args[args.indexOf('--image')+1],'/tmp/plan.png');
 for(const f of ['shell_tool','apps','plugins','browser_use','multi_agent'])assert.ok(args.some((v,i)=>v==='--disable'&&args[i+1]===f));
 assert.ok(args.includes('web_search="disabled"'));assert.ok(codexArguments('s','a',true).includes('web_search="live"'));
});
test('only completed web tool evidence authorizes product links',()=>{
 const url='https://www.divan.ru/product/test-desk';
 assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search',action:{type:'open_page',url}}}),[url]);
 assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search',query:url,action:{type:'other'}}}),[url]);
 assert.deepEqual(collectSearchSources({type:'item.started',item:{type:'web_search',query:url,action:{type:'other'}}}),[]);
 assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'agent_message',text:url,action:{url}}}),[]);
});
test('the model gets the source and diagram, with no generated candidates or private assets',async()=>{
 const {plan,brief}=fixture();plan.furniture[0].url='https://example.invalid/private';let called=0;
 const layouts=await designLayouts({provider:'codex',runCodex:async request=>{
  called++;const input=request.input as {candidates?:unknown;source:Record<string,unknown>};assert.ok(!('candidates'in input));assert.ok(!('background'in input.source));assert.ok(!JSON.stringify(input).includes('example.invalid/private'));assert.equal(request.images?.length,called===1?1:2);
  if(called===2){const review=request.input as {validationErrors:unknown[];previousDrafts:unknown[]};assert.deepEqual(review.validationErrors,[]);assert.equal(review.previousDrafts.length,1);}
  return {sources:new Set(),result:{variants:[draft()]}};
 }},plan,brief);
 assert.equal(called,2);assert.equal(layouts[0].furniture[1].x,400.7);assert.equal(layouts[0].improvement?.engine,'agent');
});
test('invalid model geometry is sent back with its diagram; the model fixes the coordinates',async()=>{
 const {plan,brief}=fixture(),bad=draft();bad.additions[0].x=150;bad.additions[0].y=100;let called=0;
 const layouts=await designLayouts({provider:'codex',runCodex:async request=>{
  called++;
  if(called===2){const input=request.input as {previousDrafts:unknown;validationErrors:unknown[]};assert.deepEqual(input.previousDrafts,[bad]);assert.ok(input.validationErrors.length);assert.equal(request.images?.length,2);}
  return {sources:new Set(),result:{variants:[called===1?bad:draft()]}};
 }},plan,brief);
 assert.equal(called,2);assert.equal(layouts[0].furniture[1].x,400.7);
});
test('failure after four model attempts never falls back to a geometric generator',async()=>{
 const {plan,brief}=fixture(),bad=draft();bad.additions[0].x=150;bad.additions[0].y=100;let calls=0;
 await assert.rejects(designLayouts({provider:'codex',runCodex:async()=>{calls++;return {sources:new Set(),result:{variants:[bad]}};}},plan,brief),/Готовые варианты не созданы/);assert.equal(calls,4);
});
test('shopping rejects cards without independent source evidence',async()=>{
 const {brief}=fixture(),url='https://www.divan.ru/product/test-desk';
 const result=await findProducts({provider:'codex',runCodex:async()=>({sources:new Set([url]),result:{offers:[{title:'Стол',url,shop:'divan.ru',price:5000,width:100,depth:50,note:''},{title:'Fake',url:'https://www.divan.ru/product/invented',shop:'divan.ru',price:5000,width:100,depth:50,note:''}]}})},
 {id:'one',furnitureId:'desk',name:'Стол',width:100,depth:50,reason:'Работа',search:'Стол',budget:10000},brief);
 assert.equal(result.offers.length,1);
});
