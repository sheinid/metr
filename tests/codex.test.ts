import test from 'node:test';
import assert from 'node:assert/strict';
import { codexArguments, collectSearchSources } from '../server/codex.ts';
import { reviewLayouts, findProducts } from '../server/agent.ts';
import { activePlan, demoProject } from '../src/model.ts';
import { defaultBrief, generateLayouts } from '../src/planner/layout.ts';

test('Codex runs an ephemeral read-only job with tools and user configuration disabled',()=>{
  const args=codexArguments('/tmp/schema.json','/tmp/answer.json',false);
  for(const flag of ['--ignore-user-config','--ephemeral','--skip-git-repo-check'])assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
  for(const feature of ['shell_tool','apps','plugins','browser_use','multi_agent'])assert.ok(args.some((v,i)=>v==='--disable'&&args[i+1]===feature));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(codexArguments('schema','answer',true).includes('web_search="live"'));
});
test('only web tool evidence can authorize product links, never final agent text',()=>{
  const url='https://www.divan.ru/product/test-desk';
  assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search',action:{type:'open_page',url}}}),[url]);
  assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search_call',action:{type:'search',sources:[{url}]}}}),[url]);
  assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search',query:url,action:{type:'other'}}}),[url]);
  assert.deepEqual(collectSearchSources({type:'item.started',item:{type:'web_search',query:url,action:{type:'other'}}}),[]);
  assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search',query:url,action:{type:'search'}}}),[]);
  assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'agent_message',text:url,action:{url}}}),[]);
  assert.deepEqual(collectSearchSources({type:'item.completed',item:{type:'web_search',action:{url:'https://evil.test/product/item'}}}),[]);
});
test('Codex receives geometry and brief without background or product URLs',async()=>{
  const plan=activePlan(demoProject()),brief=defaultBrief(plan),candidates=generateLayouts(plan,brief,6);
  plan.furniture[0].url='https://example.test/private';
  let called=false;
  const layouts=await reviewLayouts({provider:'codex',runCodex:async request=>{
    called=true;const input=request.input as {source:Record<string,unknown>;candidates:unknown[]};
    assert.equal(request.search,false);assert.ok(!('background'in input.source));
    assert.ok(!JSON.stringify(input).includes('example.test/private'));
    return {sources:new Set(),result:{selections:[{candidateId:candidates[0].id,title:'Рабочее место',summary:'Отдельный стол',tradeoffs:['Проверить розетки']}]}};
  }},plan,brief,candidates);
  assert.ok(called);assert.equal(layouts[0].improvement?.engine,'agent');
});
test('Codex shopping filters unvisited cards and items outside the allotted footprint',async()=>{
  const plan=activePlan(demoProject()),brief=defaultBrief(plan);
  const spec={id:'one',furnitureId:'desk',name:'Стол',width:100,depth:60,reason:'Работа',search:'Стол',budget:10000};
  const url='https://www.divan.ru/product/test-desk';
  const good={title:'Стол',url,shop:'divan.ru',price:5000,width:100,depth:60,note:''};
  const result=await findProducts({provider:'codex',runCodex:async request=>{
    assert.equal(request.search,true);
    return {sources:new Set([url]),result:{offers:[good,{...good,url:'https://www.divan.ru/product/not-visited'}]}};
  }},spec,brief);
  assert.equal(result.offers.length,1);assert.equal(result.offers[0].fit,'confirmed');
});
