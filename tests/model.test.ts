import test from 'node:test';
import assert from 'node:assert/strict';
import { addOpening, addWall, demoProject, duplicateVariant, emptyPlan, findRooms, removeSelection, resizeWall, activePlan, moveNodes, mergeCoincidentNodes } from '../src/model.ts';
import { distance, intersection, polygonArea, pointInPolygon, polygonInteriorPoint, round } from '../src/geometry.ts';
import { parseProject, safeUrl } from '../src/storage.ts';

test('demo has five closed rooms totaling 63 square meters', () => {
  const project = demoProject(), rooms = findRooms(activePlan(project));
  assert.equal(rooms.length, 5);
  assert.equal(rooms.reduce((n,r) => n + r.area, 0), 630000);
  assert.equal(rooms.filter(r => r.label).length, 5);
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
});
test('drawing a dividing wall splits the original boundary and creates two rooms', () => {
  let plan = emptyPlan();
  for (const [a,b] of [[{x:0,y:0},{x:500,y:0}], [{x:500,y:0},{x:500,y:400}], [{x:500,y:400},{x:0,y:400}], [{x:0,y:400},{x:0,y:0}]]) plan = addWall(plan,a,b);
  assert.equal(findRooms(plan).length, 1);
  plan = addWall(plan, {x:250,y:0},{x:250,y:400});
  assert.equal(plan.walls.length, 7);
  assert.equal(findRooms(plan).length, 2);
  assert.equal(findRooms(plan).reduce((n,r) => n + r.area, 0), 200000);
});
test('crossings create shared nodes and collinear redraws do not duplicate walls', () => {
  let plan = addWall(emptyPlan(),{x:0,y:200},{x:400,y:200});
  plan = addWall(plan,{x:200,y:0},{x:200,y:400});
  const center = Object.entries(plan.nodes).find(([,p]) => p.x === 200 && p.y === 200)![0];
  assert.equal(plan.walls.filter(w => w.a === center || w.b === center).length, 4);
  const repeated = addWall(plan,{x:0,y:200},{x:400,y:200});
  assert.equal(repeated.walls.length, 4);
});
test('splitting a wall preserves an existing door at its absolute position', () => {
  let plan = addWall(emptyPlan(),{x:0,y:0},{x:600,y:0});
  plan = addOpening(plan,'door',{x:150,y:0}).plan;
  const updated = addWall(plan,{x:400,y:0},{x:400,y:300});
  const o = updated.openings[0], wall = updated.walls.find(w => w.id === o.wallId)!;
  const a = updated.nodes[wall.a], b = updated.nodes[wall.b];
  assert.equal(a.x + (b.x - a.x) * o.t, 150);
  assert.equal(o.width, 85);
});
test('wall length edits move the shared endpoint, maintain connections and fit openings', () => {
  const p = activePlan(demoProject()), wall = p.walls.find(w => w.id === 'w1')!;
  const next = resizeWall(p,wall.id,200);
  assert.equal(distance(next.nodes[wall.a],next.nodes[wall.b]),200);
  assert.notDeepEqual(next.nodes.c,p.nodes.c);
  assert.equal(next.walls.find(w => w.id === 'w2')!.a,wall.b);
  assert.notEqual(next.nodes,p.nodes);
  assert.equal(p.nodes.c.x,900);
});
test('duplicated variants are independent, deleting a wall also removes its doors', () => {
  const initial = demoProject(), next = duplicateVariant(initial,'Другой диван');
  activePlan(next).furniture[0].width = 300;
  assert.equal(activePlan(initial).furniture[0].width,240);
  const plan = removeSelection(activePlan(next),{kind:'wall',id:'w11'});
  assert.equal(plan.openings.some(o => o.wallId === 'w11'),false);
  assert.equal(findRooms(plan).length,4);
});
test('openings refuse overlapping placements and absent walls', () => {
  let plan = addWall(emptyPlan(),{x:0,y:0},{x:500,y:0});
  plan = addOpening(plan,'door',{x:200,y:0}).plan;
  assert.ok(addOpening(plan,'door',{x:220,y:0}).error);
  assert.ok(addOpening(plan,'door',{x:220,y:200}).error);
});
test('file imports reject broken references, invalid dimensions and duplicate identities', () => {
  const p = demoProject();
  const broken = structuredClone(p); activePlan(broken).walls[0].a = 'missing'; assert.throws(() => parseProject(JSON.stringify(broken)));
  const negative = structuredClone(p); activePlan(negative).furniture[0].width = -10; assert.throws(() => parseProject(JSON.stringify(negative)));
  const duplicate = structuredClone(p); duplicate.variants.push(structuredClone(duplicate.variants[0])); assert.throws(() => parseProject(JSON.stringify(duplicate)));
  const zeroWall = structuredClone(p); activePlan(zeroWall).nodes.b = { ...activePlan(zeroWall).nodes.a }; assert.throws(() => parseProject(JSON.stringify(zeroWall)));
  const nan = structuredClone(p); activePlan(nan).nodes.a.x = Number.NaN; assert.throws(() => parseProject(JSON.stringify(nan)));
  assert.throws(() => parseProject('not json'));
});
test('unsafe links are never used as external navigation', () => {
  assert.equal(safeUrl('javascript:alert(1)'),undefined);
  assert.equal(safeUrl('data:text/html,hi'),undefined);
  assert.equal(safeUrl('https://example.com/item'),'https://example.com/item');
});
test('basic geometry handles concave shapes and finite segment intersections', () => {
  assert.deepEqual(intersection({x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}),{x:10,y:10});
  assert.equal(intersection({x:0,y:0},{x:1,y:0},{x:2,y:-1},{x:2,y:1}),null);
  const shape = [{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}];
  assert.equal(polygonArea(shape),12); assert.equal(pointInPolygon({x:1,y:3},shape),true); assert.equal(pointInPolygon({x:3,y:3},shape),false);
});

test('editing nodes cannot collapse an existing wall', () => {
  const p = activePlan(demoProject());
  const same = moveNodes(p,{b:{...p.nodes.a}});
  assert.equal(same,p);
  assert.equal(round(230.70000000000002,.1),230.7);
});
test('a label anchor stays inside a concave room', () => {
  const shape = [{x:0,y:0},{x:500,y:0},{x:500,y:100},{x:100,y:100},{x:100,y:500},{x:0,y:500}];
  assert.ok(pointInPolygon(polygonInteriorPoint(shape),shape));
});
test('coincident endpoints from separate walls are joined into a room', () => {
  const p = emptyPlan();
  p.nodes = {a:{x:0,y:0},b:{x:300,y:0},c:{x:300,y:0},d:{x:300,y:300},e:{x:300,y:300},f:{x:0,y:300},g:{x:0,y:300},h:{x:0,y:0}};
  p.walls = [{id:'a',a:'a',b:'b',thickness:14},{id:'b',a:'c',b:'d',thickness:14},{id:'c',a:'e',b:'f',thickness:14},{id:'d',a:'g',b:'h',thickness:14}];
  const merged = mergeCoincidentNodes(p);
  assert.equal(Object.keys(merged.nodes).length,4);
  assert.equal(findRooms(merged).length,1);
  assert.equal(findRooms(merged)[0].area,90000);
});

test('shortening a wall cannot silently shrink or remove its door', () => {
  let p = addWall(emptyPlan(),{x:0,y:0},{x:500,y:0});
  p = addOpening(p,'door',{x:250,y:0}).plan;
  assert.equal(resizeWall(p,p.walls[0].id,30),p);
});
