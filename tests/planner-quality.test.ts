import test from 'node:test';
import assert from 'node:assert/strict';
import { activePlan, demoProject, emptyPlan, addWall, findRooms, newFurniture } from '../src/model.ts';
import { defaultBrief, generateLayouts, layoutFacts, usabilityIssues } from '../src/planner/layout.ts';
import type { DesignBrief } from '../src/planner/types.ts';

function work() {
  const plan=activePlan(demoProject());
  const brief:DesignBrief={...defaultBrief(plan),goals:['work','cozy'],budget:25000};
  return {plan,brief};
}
function roomPlan(size=400) {
  let plan=emptyPlan();
  const points=[{x:0,y:0},{x:size,y:0},{x:size,y:size},{x:0,y:size}];
  for(let i=0;i<4;i++)plan=addWall(plan,points[i],points[(i+1)%4]);
  const wall=plan.walls.find(w=>plan.nodes[w.a].y===size&&plan.nodes[w.b].y===size)!;
  plan.openings=[{id:'entry',wallId:wall.id,kind:'door',t:.5,width:70,swing:1}];
  return plan;
}

test('a home-office request adds a usable desk while preserving every existing item',()=>{
  const {plan,brief}=work(),layouts=generateLayouts(plan,brief,6);
  assert.ok(layouts.length>0);
  for(const next of layouts){
    for(const original of plan.furniture)assert.deepEqual(next.furniture.find(f=>f.id===original.id),original,original.name);
    assert.deepEqual(next.nodes,plan.nodes);assert.deepEqual(next.walls,plan.walls);assert.deepEqual(next.openings,plan.openings);
    const desk=next.furniture.find(f=>f.kind==='desk')!,room=findRooms(next).find(r=>r.label?.name==='Гостиная')!;
    assert.deepEqual(usabilityIssues(next,desk,room),[]);
    assert.equal(layoutFacts(plan,next).movedExisting,0);
    assert.deepEqual(layoutFacts(plan,next).preservedRooms.sort(),['Ванная','Кухня','Прихожая','Спальня'].sort());
  }
});
test('alternatives do not repeat the same geometry under different generated IDs',()=>{
  const {plan,brief}=work(),layouts=generateLayouts(plan,brief,6);
  const geometry=layouts.map(p=>JSON.stringify(p.furniture.map(f=>[f.kind,f.x,f.y,f.rotation])));
  assert.equal(new Set(geometry).size,layouts.length);
  assert.ok(layouts.length<=3,'this room has three distinct usable work zones; do not pad six candidates');
  for(let i=0;i<layouts.length;i++)for(let j=i+1;j<layouts.length;j++){
    const a=layouts[i].furniture.find(f=>f.kind==='desk')!,b=layouts[j].furniture.find(f=>f.kind==='desk')!;
    assert.ok(a.rotation!==b.rotation||Math.hypot(a.x-b.x,a.y-b.y)>=160);
  }
});
test('identical geometry produces identical results even when project UUIDs change',()=>{
  const one=work(),two=work();
  const geometry=(plans:ReturnType<typeof generateLayouts>)=>plans.map(p=>p.furniture.map(f=>[f.kind,f.x,f.y,f.rotation,f.width,f.depth]));
  assert.deepEqual(geometry(generateLayouts(one.plan,one.brief,6)),geometry(generateLayouts(two.plan,two.brief,6)));
});
test('a clear footprint is insufficient when a chair cannot fit in front of a desk',()=>{
  const plan=roomPlan(),desk={...newFurniture('desk',{x:150,y:40}),rotation:0};
  plan.furniture=[desk,newFurniture('plant',{x:150,y:115})];
  assert.ok(usabilityIssues(plan,desk,findRooms(plan)[0]).includes('use-furniture'));
  plan.furniture=[{...desk,rotation:180}];
  assert.ok(usabilityIssues(plan,plan.furniture[0],findRooms(plan)[0]).includes('use-wall'));
});
test('the desk must be reachable from the only entrance, not merely free of collisions',()=>{
  const plan=roomPlan(),desk={...newFurniture('desk',{x:150,y:40}),rotation:0},room=findRooms(plan)[0];
  plan.furniture=[desk];assert.deepEqual(usabilityIssues(plan,desk,room),[]);
  plan.furniture.push({...newFurniture('wardrobe',{x:200,y:230}),width:360,depth:40});
  assert.deepEqual(usabilityIssues(plan,desk,room),['unreachable']);
});
test('locking existing furniture still allows a new desk without moving anything',()=>{
  const {plan,brief}=work();
  const layouts=generateLayouts(plan,{...brief,lockedIds:plan.furniture.map(f=>f.id)});
  for(const next of layouts){for(const f of plan.furniture)assert.deepEqual(next.furniture.find(p=>p.id===f.id),f);assert.equal(next.furniture.length,plan.furniture.length+1);}
});
test('an impossible or already fulfilled office request does not produce unrelated shuffles',()=>{
  const tiny=roomPlan(100);assert.throws(()=>generateLayouts(tiny,{...defaultBrief(tiny),goals:['work']}),/Не нашлось/);
  const {plan,brief}=work(),adequate=generateLayouts(plan,brief,1)[0];
  assert.throws(()=>generateLayouts(adequate,{...brief,goals:['work']}),/Не нашлось/);
  assert.throws(()=>generateLayouts(plan,{...brief,goals:['work'],purchases:false}),/Не нашлось/);
});

test('a space-only request does not introduce decorative purchases',()=>{
  const {plan,brief}=work();
  try{for(const next of generateLayouts(plan,{...brief,goals:['space']}))assert.equal(next.improvement!.purchases.length,0);}
  catch(error){assert.match(String(error),/Не нашлось/);}
});
test('storage without purchases does not shuffle the living-room seating',()=>{
  const {plan,brief}=work();
  try{for(const next of generateLayouts(plan,{...brief,goals:['storage'],purchases:false}))for(const f of plan.furniture.filter(f=>['sofa','chair','dining'].includes(f.kind)))assert.deepEqual(next.furniture.find(p=>p.id===f.id),f);}
  catch(error){assert.match(String(error),/Не нашлось/);}
});
test('a plan without a modeled door never claims verified access from an entrance',()=>{
  const source=roomPlan();source.openings=[];
  const next=generateLayouts(source,{...defaultBrief(source),goals:['work']},1)[0];
  assert.equal(layoutFacts(source,next).additions[0].accessFromDoor,null);
});
