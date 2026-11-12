import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOffers, productUrl } from '../src/planner/contracts.ts';
import { itemPolygon, polygonsOverlap, usabilityIssues } from '../src/planner/validation.ts';
import { newFurniture } from '../src/model.ts';
import { compileDraft, draftSignature } from '../server/layout-draft.ts';
import { planDiagramSvg, renderPlan } from '../server/render-plan.ts';
import { parseProject } from '../src/storage.ts';
import { fixture, draft } from './planner-fixture.ts';

test('model coordinates are applied exactly without a placement generator',()=>{
 const {plan,brief}=fixture(),d=draft(),before=JSON.stringify(plan);
 d.placements=[{furnitureId:plan.furniture[0].id,x:187.3,y:100,rotation:0,reason:'Зона отдыха сдвинута.'}];
 const result=compileDraft(plan,brief,d);assert.deepEqual(result.issues,[]);assert.equal(result.plan!.furniture[0].x,187.3);assert.equal(result.plan!.furniture[1].x,400.7);assert.equal(JSON.stringify(plan),before);
 assert.deepEqual(parseProject(JSON.stringify({version:1,name:'Test',activeId:result.plan!.id,variants:[result.plan]})).variants[0],result.plan);
});
test('colliding model coordinates are reported and never silently moved',()=>{
 const {plan,brief}=fixture(),d=draft();d.additions[0].x=150;d.additions[0].y=100;
 const result=compileDraft(plan,brief,d);assert.ok(result.issues.some(i=>i.code==='furniture'));assert.equal(result.plan!.furniture[1].x,150);
 assert.ok(result.issues.some(i=>i.relatedIds?.includes(plan.furniture[0].id)));
});
test('locked furniture, communication fixtures and unknown IDs cannot be changed',()=>{
 const {plan,brief}=fixture(),d=draft();brief.lockedIds=[plan.furniture[0].id];
 d.placements=[{furnitureId:plan.furniture[0].id,x:190,y:100,rotation:0,reason:'Test'}];assert.ok(compileDraft(plan,brief,d).issues.some(i=>i.code==='contract'));
 d.placements[0].furnitureId='invented';assert.ok(compileDraft(plan,brief,d).issues.some(i=>i.message.includes('Неизвестный')));
});
test('purchase permissions and the total proposed budget are enforced',()=>{
 const {plan,brief}=fixture(),d=draft();assert.ok(compileDraft(plan,{...brief,purchases:false},d).issues.length);
 d.additions[0].budget=25001;assert.ok(compileDraft(plan,brief,d).issues.some(i=>i.message.includes('бюджет')));
});
test('a sofa can only be removed through an explicit replacement',()=>{
 const {plan,brief}=fixture(),d=draft();d.removals=[{furnitureId:plan.furniture[0].id,reason:'Меньше габариты.',replacementKey:null}];
 assert.ok(compileDraft(plan,brief,d).issues.some(i=>i.message.includes('заменой')));
 d.additions.push({key:'new-sofa',kind:'sofa',name:'Новый диван',x:150,y:100,rotation:0,width:180,depth:80,budget:12000,reason:'Компактнее.',search:'Диван 180х80'});d.removals[0].replacementKey='new-sofa';
 const result=compileDraft(plan,brief,d);assert.deepEqual(result.issues,[]);assert.ok(!result.plan!.furniture.some(f=>f.id===plan.furniture[0].id));
});
test('duplicate geometry is recognized despite different model addition keys',()=>{
 const {plan,brief}=fixture(),a=draft(),b=draft();b.key='other';b.additions[0].key='different';
 assert.equal(draftSignature(plan,compileDraft(plan,brief,a).plan!),draftSignature(plan,compileDraft(plan,brief,b).plan!));
});
test('use space and the route from an entrance are checked',()=>{
 const {plan,brief,room}=fixture(),d=draft(),valid=compileDraft(plan,brief,d).plan!,desk=valid.furniture[1];
 assert.deepEqual(usabilityIssues(valid,desk,room),[]);
 valid.furniture.push(newFurniture('plant',{x:desk.x,y:115}));assert.ok(usabilityIssues(valid,desk,room).includes('use-furniture'));
 const empty=fixture();empty.plan.furniture=[];const blocked=compileDraft(empty.plan,empty.brief,draft()).plan!;
 blocked.furniture.push({...newFurniture('wardrobe',{x:250,y:230}),width:460,depth:40});assert.ok(usabilityIssues(blocked,blocked.furniture[0],empty.room).includes('unreachable'));
});
test('rotated item overlap is checked using the actual polygons',()=>{
 assert.ok(polygonsOverlap(itemPolygon({x:0,y:0,width:100,depth:20,rotation:45}),itemPolygon({x:0,y:0,width:100,depth:20,rotation:-45})));
 assert.ok(!polygonsOverlap(itemPolygon({x:0,y:0,width:20,depth:20,rotation:45}),itemPolygon({x:100,y:100,width:20,depth:20,rotation:45})));
});
test('agent diagrams never embed backgrounds, private links or project titles',()=>{
 const {plan}=fixture();plan.name='private-project-title';plan.background={src:'data:image/png;base64,private-background',x:0,y:0,width:500,height:400,opacity:1};plan.furniture[0].url='https://example.invalid/private';
 const svg=planDiagramSvg(plan);assert.ok(!svg.includes('private-'));assert.ok(!svg.includes('<image'));
 const png=Buffer.from(renderPlan(plan));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1400);assert.equal(png.readUInt32BE(20),1000);
});
test('product results require source evidence, fitting dimensions and budget',()=>{
 const spec={id:'one',furnitureId:'shelf',name:'Стеллаж',width:90,depth:30,reason:'Test',search:'Test',budget:12000},url='https://www.divan.ru/product/test-shelf';
 const offer={title:'Fits',url,shop:'Test',price:8000,width:90,depth:30,note:'Test'};
 assert.equal(parseOffers({offers:[offer,{...offer,url:'https://www.divan.ru/product/missing'}]},new Set([url]),spec,'now').length,1);
 assert.equal(parseOffers({offers:[{...offer,depth:35}]},new Set([url]),spec,'now').length,0);
 assert.equal(parseOffers({offers:[{...offer,price:12001}]},new Set([url]),spec,'now').length,0);
 assert.equal(parseOffers({offers:[{...offer,width:null,depth:null}]},new Set([url]),spec,'now')[0].fit,'unknown');
 for(const bad of ['javascript:alert(1)','https://evil.test/product/item','https://user:pass@www.divan.ru/product/item','https://www.divan.ru/search?q=test','https://www.divan.ru:444/product/item'])assert.equal(productUrl(bad),undefined);
});
