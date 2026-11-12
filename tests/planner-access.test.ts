import test from 'node:test';
import assert from 'node:assert/strict';
import { addWall, emptyPlan, findRooms, newFurniture } from '../src/model.ts';
import { fixture } from './planner-fixture.ts';
import { placementIssues, usabilityIssues, diningSeat, accessDiagnostics } from '../src/planner/validation.ts';

function deskAndChair(rotation=0){
  const {plan,room}=fixture();
  const desk={...newFurniture('desk',{x:350,y:80}),width:100,depth:50,rotation};
  const chair={...newFurniture('chair',{x:350,y:142.5}),width:55,depth:55,rotation:180};
  plan.furniture=[desk,chair];
  return {plan,room,desk,chair};
}
test('a chair inside the desk use area is a valid workspace when facing the desk',()=>{
  const {plan,room,desk,chair}=deskAndChair();
  assert.deepEqual(usabilityIssues(plan,desk,room),[]);
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
});
test('a chair can reach the boundary of the reserved desk area',()=>{
  const {plan,room,desk,chair}=deskAndChair();chair.width=60;chair.depth=60;chair.y=150;
  assert.deepEqual(usabilityIssues(plan,desk,room),[]);
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
});
test('workspace recognition also works for rotated desks and chairs',()=>{
  const {plan,room,desk,chair}=deskAndChair();
  desk.x=350;desk.y=180;desk.rotation=90;
  chair.x=287.5;chair.y=180;chair.rotation=270;
  assert.deepEqual(usabilityIssues(plan,desk,room),[]);
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
});
test('a chair facing away from the desk remains an obstacle',()=>{
  const {plan,room,desk,chair}=deskAndChair();chair.rotation=0;
  assert.ok(usabilityIssues(plan,desk,room).includes('use-furniture'));
});
test('a chair outside the local workspace does not receive an exemption',()=>{
  const {plan,room,desk,chair}=deskAndChair();chair.x+=30;
  assert.ok(usabilityIssues(plan,desk,room).includes('use-furniture'));
});
test('a workspace never exempts physical body, wall or door collisions',()=>{
  const {plan,room,desk,chair}=deskAndChair();chair.y=100;
  assert.ok(usabilityIssues(plan,desk,room).includes('furniture'));
  assert.ok(usabilityIssues(plan,chair,room).includes('furniture'));
  desk.x=40;desk.y=80;chair.x=40;chair.y=142.5;
  assert.ok(placementIssues(plan,desk,room).includes('wall'));
  const doorCase=deskAndChair();doorCase.desk.x=250;doorCase.desk.y=270;doorCase.chair.x=250;doorCase.chair.y=332.5;
  assert.ok(usabilityIssues(doorCase.plan,doorCase.chair,doorCase.room).includes('door'));
});
test('a chair across a dividing wall is not part of the same workspace',()=>{
  const {plan,desk,chair}=deskAndChair();desk.x=350;desk.y=180;desk.rotation=90;chair.x=287.5;chair.y=180;chair.rotation=270;
  const divided=addWall(plan,{x:320,y:0},{x:320,y:400},6),room=findRooms(divided).find(r=>r.vertices.some(p=>p.x===500))!;
  assert.ok(usabilityIssues(divided,desk,room).includes('use-furniture'));
});
test('a valid work chair still blocks access to other furniture',()=>{
  let plan=emptyPlan();const p=[{x:0,y:0},{x:500,y:0},{x:500,y:500},{x:0,y:500}];
  for(let i=0;i<4;i++)plan=addWall(plan,p[i],p[(i+1)%4]);
  const wall=plan.walls.find(w=>plan.nodes[w.a].y===500&&plan.nodes[w.b].y===500)!;
  plan.openings=[{id:'entry',wallId:wall.id,kind:'door',t:.5,width:80,swing:1}];
  const desk={...newFurniture('desk',{x:350,y:250}),width:100,depth:50,rotation:90};
  const chair={...newFurniture('chair',{x:287.5,y:250}),width:55,depth:55,rotation:270};
  const shelf={...newFurniture('shelf',{x:250,y:80}),width:80,depth:30};
  const left={...newFurniture('wardrobe',{x:130,y:250}),width:240,depth:80};
  const right={...newFurniture('wardrobe',{x:432.5,y:250}),width:115,depth:80};
  plan.furniture=[desk,chair,shelf,left,right];const room=findRooms(plan)[0];
  assert.deepEqual(usabilityIssues(plan,desk,room),[]);
  assert.ok(usabilityIssues(plan,shelf,room).includes('unreachable'));
  const withoutChair={...plan,furniture:plan.furniture.filter(f=>f.id!==chair.id)};
  assert.deepEqual(usabilityIssues(withoutChair,shelf,room),[]);
});

function diningAndChair(){
  const {plan,room}=fixture();
  const table={...newFurniture('dining',{x:200,y:200}),width:140,depth:85};
  const chair={...newFurniture('chair',{x:200,y:270}),width:45,depth:45,rotation:180};
  plan.furniture=[table,chair];return {plan,room,table,chair};
}
test('a dining chair is reached from outside the table group, not through the tabletop',()=>{
  const {plan,room,table,chair}=diningAndChair();
  assert.equal(diningSeat(plan,chair,room)?.table.id,table.id);
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
  const diagnostics=accessDiagnostics(plan,chair,room);
  assert.deepEqual(diagnostics.zones.map(zone=>zone.label),['chair-back','chair-side-right','chair-side-left']);
  assert.ok(!diagnostics.zones[0].blockedBy.includes(table.id));
});
test('chairs on rotated and opposite sides of a dining table remain usable',()=>{
  const {plan,room,table,chair}=diningAndChair();
  chair.y=130;chair.rotation=0;
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
  table.rotation=90;chair.x=270;chair.y=200;chair.rotation=90;
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
});
test('a distant or outward-facing chair is not exempted as a dining seat',()=>{
  const {plan,room,chair}=diningAndChair();chair.rotation=0;
  assert.equal(diningSeat(plan,chair,room),undefined);
  assert.equal(accessDiagnostics(plan,chair,room).zones[0].label,'front');
  chair.x=400;chair.y=200;chair.rotation=90;
  assert.deepEqual(placementIssues(plan,chair,room),[]);
  assert.equal(diningSeat(plan,chair,room),undefined);
});
test('a dining pair does not bypass physical table and chair collisions',()=>{
  const {plan,room,chair}=diningAndChair();chair.y=245;
  assert.ok(placementIssues(plan,chair,room).includes('furniture'));
  assert.equal(diningSeat(plan,chair,room),undefined);
  assert.ok(usabilityIssues(plan,chair,room).includes('furniture'));
});
test('a dining chair with all exterior approaches blocked is unreachable',()=>{
  const {plan,room,chair}=diningAndChair();
  plan.furniture.push({...newFurniture('wardrobe',{x:200,y:330}),width:180,depth:40},
    {...newFurniture('wardrobe',{x:130,y:275}),width:70,depth:40},
    {...newFurniture('wardrobe',{x:270,y:275}),width:70,depth:40});
  assert.deepEqual(placementIssues(plan,chair,room),[]);
  assert.ok(diningSeat(plan,chair,room));
  assert.ok(usabilityIssues(plan,chair,room).includes('unreachable'));
});
test('a chair that blocks an inward entrance is not ignored just because it belongs to a table',()=>{
  const {plan,room,table,chair}=diningAndChair();plan.openings[0].swing=-1;
  table.x=170;table.y=350;table.width=80;table.depth=60;table.rotation=90;
  chair.x=250;chair.y=350;chair.rotation=90;
  assert.deepEqual(placementIssues(plan,table,room),[]);
  assert.deepEqual(placementIssues(plan,chair,room),[]);
  assert.ok(diningSeat(plan,chair,room));
  assert.ok(usabilityIssues(plan,chair,room).includes('unreachable'));
  const diagnostics=accessDiagnostics(plan,chair,room);
  assert.equal(diagnostics.entrances[0].doorId,'entry');
  assert.deepEqual(diagnostics.entrances[0].point,{x:250,y:345});
  assert.ok(diagnostics.entrances[0].blockedBy.includes(chair.id));
});
test('dining chairs remain obstacles in routes to unrelated furniture',()=>{
  let plan=emptyPlan();const p=[{x:0,y:0},{x:500,y:0},{x:500,y:500},{x:0,y:500}];
  for(let i=0;i<4;i++)plan=addWall(plan,p[i],p[(i+1)%4]);
  const wall=plan.walls.find(w=>plan.nodes[w.a].y===500&&plan.nodes[w.b].y===500)!;
  plan.openings=[{id:'entry',wallId:wall.id,kind:'door',t:.5,width:80,swing:1}];
  const table={...newFurniture('dining',{x:350,y:250}),width:100,depth:50,rotation:90};
  const chair={...newFurniture('chair',{x:287.5,y:250}),width:55,depth:55,rotation:270};
  const shelf={...newFurniture('shelf',{x:250,y:80}),width:80,depth:30};
  const left={...newFurniture('wardrobe',{x:130,y:250}),width:240,depth:80};
  const right={...newFurniture('wardrobe',{x:432.5,y:250}),width:115,depth:80};
  plan.furniture=[table,chair,shelf,left,right];const room=findRooms(plan)[0];
  assert.deepEqual(usabilityIssues(plan,chair,room),[]);
  assert.ok(usabilityIssues(plan,shelf,room).includes('unreachable'));
  assert.deepEqual(usabilityIssues({...plan,furniture:plan.furniture.filter(f=>f.id!==chair.id)},shelf,room),[]);
});
