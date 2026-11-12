import type { Furniture, Plan, Room } from '../model.ts';
import { findRooms } from '../model.ts';
import { distance, intersection, pointInPolygon, projectPoint } from '../geometry.ts';
import type { Point } from '../geometry.ts';
import { GOALS } from './types.ts';
import { isBrief } from './contracts.ts';
import type { DesignBrief } from './types.ts';

export const FIXED_KINDS = new Set(['kitchen', 'fridge', 'bath', 'toilet', 'sink']);
export function defaultBrief(plan: Plan): DesignBrief {
  return { roomIds: findRooms(plan).map(r => r.id), goals: ['cozy', 'space'], household: 'Один или двое', wishes: '', style: 'warm', avoid: '', budget: 30000, purchases: true, lockedIds: plan.furniture.filter(f => FIXED_KINDS.has(f.kind)).map(f => f.id), city: '' };
}
export function validateBrief(plan: Plan, value: unknown): DesignBrief {
  const b = value as DesignBrief;
  const rooms = new Set(findRooms(plan).map(r => r.id)), items = new Set(plan.furniture.map(f => f.id));
  const strings = ['household','wishes','avoid','city'] as const;
  if (!isBrief(b) || !Array.isArray(b.roomIds) || !b.roomIds.length || !b.roomIds.every(id => rooms.has(id)) ||
    !Array.isArray(b.goals) || !b.goals.length || b.goals.length > 3 || !b.goals.every(id => GOALS.some(g => g.id === id)) ||
    !Array.isArray(b.lockedIds) || !b.lockedIds.every(id => items.has(id)) || !['warm','calm','expressive'].includes(b.style) ||
    typeof b.purchases !== 'boolean' || !Number.isFinite(b.budget) || b.budget < 0 || b.budget > 1000000 ||
    !strings.every(k => typeof b[k] === 'string' && b[k].length <= (k === 'wishes' || k === 'avoid' ? 600 : 100))) {
    throw new Error('Проверьте комнаты, цели и бюджет в задании');
  }
  if (plan.furniture.length > 100 || plan.walls.length > 300 || rooms.size > 20) throw new Error('Пока подбор поддерживает до 100 предметов и 20 комнат');
  return structuredClone(b);
}
export function itemPolygon(f: Pick<Furniture,'x'|'y'|'width'|'depth'|'rotation'>, padding = 0): Point[] {
  const angle = f.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => ({ x: f.x + x * (f.width / 2 + padding) * c - y * (f.depth / 2 + padding) * s, y: f.y + x * (f.width / 2 + padding) * s + y * (f.depth / 2 + padding) * c }));
}
export function polygonsOverlap(a: Point[], b: Point[], tolerance = .5): boolean {
  for (const poly of [a,b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], length = distance(p,q);
    if (!length) continue;
    const axis = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
    const aa = a.map(v => v.x * axis.x + v.y * axis.y), bb = b.map(v => v.x * axis.x + v.y * axis.y);
    if (Math.min(Math.max(...aa),Math.max(...bb)) - Math.max(Math.min(...aa),Math.min(...bb)) <= tolerance) return false;
  }
  return true;
}
export function polygonInside(poly: Point[], room: Room) {
  if (!poly.every(p => pointInPolygon(p,room.vertices))) return false;
  return poly.every((p,i) => room.vertices.every((a,j) => {
    const hit = intersection(p,poly[(i + 1) % poly.length],a,room.vertices[(j + 1) % room.vertices.length]);
    return !hit || distance(hit,p) < .1 || distance(hit,poly[(i + 1) % poly.length]) < .1;
  }));
}
export function planObstacles(plan: Plan) {
  const walls = plan.walls.map(w => { const a = plan.nodes[w.a], b = plan.nodes[w.b]; return itemPolygon({ x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:distance(a,b),depth:w.thickness,rotation:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI }); });
  const doors = plan.openings.filter(o => o.kind === 'door').map(o => {
    const w = plan.walls.find(w => w.id === o.wallId)!, a = plan.nodes[w.a], b = plan.nodes[w.b], angle = Math.atan2(b.y-a.y,b.x-a.x), c = Math.cos(angle), s = Math.sin(angle);
    const center = { x:a.x+(b.x-a.x)*o.t,y:a.y+(b.y-a.y)*o.t };
    return { id:o.id, center, width:o.width, normal:{x:-s,y:c}, polygon:itemPolygon({x:center.x-s*o.swing*o.width/2,y:center.y+c*o.swing*o.width/2,width:o.width+8,depth:o.width+16,rotation:angle*180/Math.PI}) };
  });
  return { walls, doors };
}
export function placementIssues(plan: Plan, item: Furniture, room?: Room): string[] {
  const poly = itemPolygon(item), g = planObstacles(plan), issues: string[] = [];
  if (room && !polygonInside(poly,room)) issues.push('outside');
  if (g.walls.some(w => polygonsOverlap(poly,w,1.5))) issues.push('wall');
  if (g.doors.some(d => polygonsOverlap(poly,d.polygon))) issues.push('door');
  if (plan.furniture.some(f => f.id !== item.id && polygonsOverlap(poly,itemPolygon(f)))) issues.push('furniture');
  return issues;
}
function roomBounds(room: Room) {
  return { minX:Math.min(...room.vertices.map(p=>p.x)),maxX:Math.max(...room.vertices.map(p=>p.x)),minY:Math.min(...room.vertices.map(p=>p.y)),maxY:Math.max(...room.vertices.map(p=>p.y)) };
}
const forward = (f: Furniture) => { const a = f.rotation * Math.PI / 180; return { x: -Math.sin(a), y: Math.cos(a) }; };
export function useArea(item: Furniture): Point[] | undefined {
  const depth = item.kind==='desk' ? 75 : ['wardrobe','shelf'].includes(item.kind) ? 60 : ['chair','sofa'].includes(item.kind) ? 50 : 0;
  if (!depth) return;
  const direction = forward(item), width = Math.min(item.width,item.kind==='sofa'?140:70);
  return itemPolygon({...item,x:item.x+direction.x*(item.depth/2+depth/2),y:item.y+direction.y*(item.depth/2+depth/2),width,depth});
}
function workChairs(plan: Plan, desk: Furniture, room: Room): Furniture[] {
  const area=useArea(desk);
  if(desk.kind!=='desk'||!area||!pointInPolygon(desk,room.vertices))return [];
  return plan.furniture.filter(chair=>{
    if(chair.kind!=='chair'||!pointInPolygon(chair,room.vertices)||!itemPolygon(chair).every(p=>pointInPolygon(p,area)||area.some((a,i)=>projectPoint(p,a,area[(i+1)%area.length]).distance<=.5)))return false;
    const direction=forward(chair),toward={x:desk.x-chair.x,y:desk.y-chair.y},length=distance(desk,chair);
    if(!length||(direction.x*toward.x+direction.y*toward.y)/length<.8)return false;
    return !placementIssues(plan,desk,room).length&&!placementIssues(plan,chair,room).length;
  });
}
export function workspace(plan: Plan, item: Furniture, room: Room): { desk:Furniture; chairs:Furniture[] } | undefined {
  if(item.kind==='desk')return {desk:item,chairs:workChairs(plan,item,room)};
  if(item.kind!=='chair')return;
  for(const desk of plan.furniture.filter(f=>f.kind==='desk')){
    const chairs=workChairs(plan,desk,room);
    if(chairs.some(chair=>chair.id===item.id))return {desk,chairs};
  }
}
export function diningSeat(plan: Plan, chair: Furniture, room: Room): { table:Furniture; areas:Point[][] } | undefined {
  if(chair.kind!=='chair'||!pointInPolygon(chair,room.vertices)||placementIssues(plan,chair,room).length)return;
  const direction=forward(chair),front={x:chair.x+direction.x*chair.depth/2,y:chair.y+direction.y*chair.depth/2};
  const tables=plan.furniture.filter(f=>f.kind==='dining'&&pointInPolygon(f,room.vertices));
  let closest:Furniture|undefined,gap=Infinity;
  for(const table of tables){
    if(placementIssues(plan,table,room).length)continue;
    const poly=itemPolygon(table),near=poly.map((a,i)=>projectPoint(front,a,poly[(i+1)%poly.length])).sort((a,b)=>a.distance-b.distance)[0];
    const toward={x:near.x-chair.x,y:near.y-chair.y},length=Math.hypot(toward.x,toward.y);
    if(!length||(direction.x*toward.x+direction.y*toward.y)/length<.8||near.distance>60||near.distance>=gap)continue;
    closest=table;gap=near.distance;
  }
  if(!closest)return;
  const right={x:direction.y,y:-direction.x};
  const sides=[{direction:{x:-direction.x,y:-direction.y},half:chair.depth/2,width:chair.width},
    {direction:right,half:chair.width/2,width:chair.depth},{direction:{x:-right.x,y:-right.y},half:chair.width/2,width:chair.depth}];
  const areas=sides.map(side=>itemPolygon({x:chair.x+side.direction.x*(side.half+30),y:chair.y+side.direction.y*(side.half+30),width:Math.min(side.width,70),depth:60,rotation:Math.atan2(-side.direction.x,side.direction.y)*180/Math.PI}));
  return {table:closest,areas};
}
function spaceIssues(plan: Plan, item: Furniture, room: Room, area:Point[], companions: Set<string> = new Set()): string[] {
  const g = planObstacles(plan), issues: string[] = [];
  if (!polygonInside(area,room)||g.walls.some(w=>polygonsOverlap(area,w))) issues.push('use-wall');
  if (plan.furniture.some(f=>f.id!==item.id&&!companions.has(f.id)&&polygonsOverlap(area,itemPolygon(f)))) issues.push('use-furniture');
  if (g.doors.some(d=>polygonsOverlap(area,d.polygon))) issues.push('use-door');
  return issues;
}
function areaIssues(plan: Plan, item: Furniture, room: Room, companions: Set<string> = new Set()): string[] {
  const area=useArea(item);return area?spaceIssues(plan,item,room,area,companions):[];
}
export function accessDiagnostics(plan:Plan,item:Furniture,room:Room) {
  const pair=workspace(plan,item,room),dining=pair?undefined:diningSeat(plan,item,room),target=pair?.desk??item;
  const companions=new Set(pair?.chairs.map(f=>f.id)??[]),area=useArea(target);
  const zones=dining?dining.areas.map((polygon,index)=>({label:['chair-back','chair-side-right','chair-side-left'][index],polygon})):
    area?[{label:pair?'workspace':'front',polygon:area}]:[];
  const doors=planObstacles(plan).doors;
  return {
    zones:zones.map(zone=>({...zone,insideRoom:polygonInside(zone.polygon,room),blockedBy:plan.furniture.filter(f=>f.id!==target.id&&!companions.has(f.id)&&polygonsOverlap(zone.polygon,itemPolygon(f))).map(f=>f.id),doorIds:doors.filter(d=>polygonsOverlap(zone.polygon,d.polygon)).map(d=>d.id)})),
    entrances:doors.flatMap(d=>[-1,1].map(sign=>({doorId:d.id,point:{x:d.center.x+d.normal.x*sign*55,y:d.center.y+d.normal.y*sign*55}})).filter(entry=>pointInPolygon(entry.point,room.vertices))).map(entry=>({...entry,blockedBy:plan.furniture.filter(f=>pointInPolygon(entry.point,itemPolygon(f,30))).map(f=>f.id)})),
  };
}
function roomRoutes(room: Room, furniture: Furniture[], plan: Plan, required: Furniture[] = [],accessAreas?:Point[][],anyArea=false): boolean {
  const b=roomBounds(room), step=20, wallMargin=30+Math.max(...plan.walls.map(w=>w.thickness))/2, nx=Math.ceil((b.maxX-b.minX)/step), ny=Math.ceil((b.maxY-b.minY)/step);
  if(nx*ny>30000) return false;
  const blocks=furniture.filter(f=>pointInPolygon(f,room.vertices)).map(f=>itemPolygon(f,30));
  const free=new Set<number>(), centers=new Map<number,Point>();
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const p={x:b.minX+(x+.5)*step,y:b.minY+(y+.5)*step};
    if(pointInPolygon(p,room.vertices)&&room.vertices.every((a,i)=>projectPoint(p,a,room.vertices[(i+1)%room.vertices.length]).distance>=wallMargin)&&!blocks.some(poly=>pointInPolygon(p,poly))){const id=y*nx+x;free.add(id);centers.set(id,p);}
  }
  if(!free.size)return false;
  const components=new Map<number,number>(), sizes:number[]=[];
  for(const id of free)if(!components.has(id)){
    const component=sizes.length,queue=[id];components.set(id,component);
    for(let i=0;i<queue.length;i++){const current=queue[i],x=current%nx;for(const next of [x>0?current-1:-1,x<nx-1?current+1:-1,current-nx,current+nx])if(free.has(next)&&!components.has(next)){components.set(next,component);queue.push(next);}}
    sizes.push(queue.length);
  }
  const portals=planObstacles(plan).doors.flatMap(d=>[-1,1].map(sign=>({x:d.center.x+d.normal.x*sign*55,y:d.center.y+d.normal.y*sign*55})).filter(p=>pointInPolygon(p,room.vertices)));
  const near=(p:Point,area?:Point[])=>{
    let best=-1,delta=area?Infinity:35;
    for(const [id,c]of centers){const d=distance(p,c);if(d<delta&&(!area||pointInPolygon(c,area))){delta=d;best=id;}}
    return components.get(best);
  };
  const entranceBlocks=plan.furniture.filter(f=>pointInPolygon(f,room.vertices)).map(f=>itemPolygon(f,30));
  const entrances=portals.map(p=>{let best=-1,delta=35;for(const [id,c]of centers){const d=distance(p,c);if(d<delta&&!entranceBlocks.some(poly=>pointInPolygon(c,poly))){delta=d;best=id;}}return components.get(best);});
  if(entrances.some(g=>g===undefined)||new Set(entrances).size>1)return false;
  const entry=entrances[0]??sizes.indexOf(Math.max(...sizes));
  const targets=accessAreas??required.flatMap(f=>{const area=useArea(f);return area?[area]:[];});
  const reached=targets.map(area=>{const p=area.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0});return near(p,area)===entry;});
  return anyArea?reached.some(Boolean):reached.every(Boolean);
}
export function usabilityIssues(plan: Plan, item: Furniture, room: Room): string[] {
  const dining=diningSeat(plan,item,room);
  if(dining){
    const issues=placementIssues(plan,item,room),areas=dining.areas.filter(area=>!spaceIssues(plan,item,room,area).length);
    if(!issues.length&&(!areas.length||!roomRoutes(room,plan.furniture,plan,[],areas,true)))issues.push('unreachable');
    return issues;
  }
  const pair=workspace(plan,item,room),target=pair?.desk??item;
  const companions=new Set(pair?.chairs.map(f=>f.id)??[]);
  const issues=[...placementIssues(plan,item,room),...areaIssues(plan,target,room,companions)];
  const obstacles=companions.size?plan.furniture.filter(f=>!companions.has(f.id)):plan.furniture;
  if(!issues.length&&!roomRoutes(room,obstacles,plan,[target]))issues.push('unreachable');
  return issues;
}
