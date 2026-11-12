import test from 'node:test';
import assert from 'node:assert/strict';
import { activePlan, demoProject, emptyPlan, findRooms, addWall } from '../src/model.ts';
import { defaultBrief, generateLayouts, itemPolygon, placementIssues, polygonsOverlap, FIXED_KINDS } from '../src/planner/layout.ts';
import { parseProject } from '../src/storage.ts';
import { parseOffers, productUrl } from '../src/planner/contracts.ts';

const source=()=>activePlan(demoProject());
test('generation creates distinct complete plans without changing the source',()=>{
  const p=source(),original=JSON.stringify(p),layouts=generateLayouts(p,defaultBrief(p));
  assert.equal(layouts.length,3);assert.equal(JSON.stringify(p),original);
  assert.equal(new Set(layouts.map(p=>JSON.stringify(p.furniture.map(f=>[f.x,f.y,f.rotation])))).size,3);
  for(const next of layouts){
    assert.notEqual(next.id,p.id);assert.deepEqual(next.nodes,p.nodes);assert.deepEqual(next.walls,p.walls);assert.deepEqual(next.openings,p.openings);
    assert.ok(p.furniture.every(f=>next.furniture.some(n=>n.id===f.id&&n.width===f.width&&n.depth===f.depth)));
    for(const item of next.furniture.filter(f=>!FIXED_KINDS.has(f.kind))){const room=findRooms(next).find(r=>placementIssues(next,item,r).length===0);assert.ok(room,`${item.name} must fit a room without collisions`);}
    const asProject={version:1 as const,name:'Test',activeId:next.id,variants:[next]};assert.deepEqual(parseProject(JSON.stringify(asProject)),asProject);
  }
  const kitchen=layouts[0].furniture.find(f=>f.kind==='kitchen')!;kitchen.x+=500;
  assert.equal(JSON.stringify(p),original);assert.notEqual(kitchen.x,layouts[1].furniture.find(f=>f.kind==='kitchen')!.x);
});
test('no-purchase mode and zero budget never add furniture',()=>{
  for(const change of [{purchases:false},{budget:0}]){const p=source(),layouts=generateLayouts(p,{...defaultBrief(p),...change});for(const next of layouts){assert.equal(next.furniture.length,p.furniture.length);assert.equal(next.improvement!.purchases.length,0);}}
});
test('locked furniture and rooms outside the assignment keep their positions',()=>{
  const p=source(),room=findRooms(p).find(r=>r.label?.name==='Гостиная')!,sofa=p.furniture.find(f=>f.kind==='sofa')!;
  const layouts=generateLayouts(p,{...defaultBrief(p),roomIds:[room.id],lockedIds:[...defaultBrief(p).lockedIds,sofa.id],purchases:false});
  for(const next of layouts){assert.deepEqual(next.furniture.find(f=>f.id===sofa.id),sofa);assert.deepEqual(next.furniture.find(f=>f.kind==='bed'),p.furniture.find(f=>f.kind==='bed'));}
});
test('work and storage needs produce fitting items within the total budget',()=>{
  for(const [goal,kind]of [['work','desk'],['storage','shelf']]as const){const p=source(),layouts=generateLayouts(p,{...defaultBrief(p),goals:[goal],budget:14000});const withPurchase=layouts.filter(p=>p.improvement!.purchases.length);assert.ok(withPurchase.length);for(const next of withPurchase){const specs=next.improvement!.purchases;assert.ok(specs.reduce((n,s)=>n+s.budget,0)<=14000);assert.ok(specs.every(s=>next.furniture.find(f=>f.id===s.furnitureId)?.kind===kind));}}
});
test('rotated furniture collision and crossing a concave room boundary are rejected',()=>{
  assert.ok(polygonsOverlap(itemPolygon({x:0,y:0,width:100,depth:20,rotation:45}),itemPolygon({x:0,y:0,width:100,depth:20,rotation:-45})));
  assert.ok(!polygonsOverlap(itemPolygon({x:0,y:0,width:20,depth:20,rotation:45}),itemPolygon({x:100,y:100,width:20,depth:20,rotation:45})));
  let p=emptyPlan();const points=[{x:0,y:0},{x:400,y:0},{x:400,y:100},{x:100,y:100},{x:100,y:400},{x:0,y:400}];for(let i=0;i<points.length;i++)p=addWall(p,points[i],points[(i+1)%points.length]);
  const item={id:'cross',kind:'desk' as const,name:'Test',x:120,y:120,width:180,depth:180,rotation:45,color:'#ffffff',url:''};assert.ok(placementIssues(p,item,findRooms(p)[0]).includes('outside'));
});
test('incomplete plans, impossible briefs and fully locked furniture fail explicitly',()=>{
  const p=source(),b=defaultBrief(p);assert.throws(()=>generateLayouts(emptyPlan(),b));assert.throws(()=>generateLayouts(p,{...b,budget:NaN}));assert.throws(()=>generateLayouts(p,{...b,roomIds:['missing']}));assert.throws(()=>generateLayouts(p,{...b,lockedIds:p.furniture.map(f=>f.id)}),/Разрешите/);
});
test('product results require a real source, fitting dimensions and budget',()=>{
  const spec={id:'one',furnitureId:'shelf',name:'Стеллаж',width:90,depth:30,reason:'Test',search:'Test',budget:12000},url='https://www.divan.ru/product/test-shelf';
  const value={offers:[{title:'Fits',url,shop:'Test',price:8000,width:90,depth:30,note:'Test'},{title:'Invented',url:'https://www.divan.ru/product/missing',shop:'Test',price:7000,width:90,depth:30,note:'Test'}]};
  const offers=parseOffers(value,new Set([url]),spec,'2026-11-12T10:00:00Z');assert.equal(offers.length,1);assert.equal(offers[0].fit,'confirmed');
  assert.equal(parseOffers({offers:[{...value.offers[0],depth:35}]},new Set([url]),spec,'now').length,0);
  assert.equal(parseOffers({offers:[{...value.offers[0],price:12001}]},new Set([url]),spec,'now').length,0);
  assert.equal(parseOffers({offers:[{...value.offers[0],width:null,depth:null}]},new Set([url]),spec,'now')[0].fit,'unknown');
  for(const bad of ['javascript:alert(1)','https://evil.test/product/item','https://user:pass@www.divan.ru/product/item','https://www.divan.ru/search?q=test','https://www.divan.ru:444/product/item'])assert.equal(productUrl(bad),undefined);
});
test('malformed imported recommendations cannot enter the editor',()=>{
  const p=source(),project={version:1,name:'Test',activeId:p.id,variants:[{...p,improvement:{summary:'untrusted'}}]};assert.throws(()=>parseProject(JSON.stringify(project)),/некорректную/);
});
test('a fixed item colliding with a wall produces a useful error',()=>{
  const p=source(),wardrobe=p.furniture.find(f=>f.kind==='wardrobe'&&f.name==='Шкаф')!;
  assert.throws(()=>generateLayouts(p,{...defaultBrief(p),lockedIds:[...defaultBrief(p).lockedIds,wardrobe.id]}),/снимите фиксацию/);
});
