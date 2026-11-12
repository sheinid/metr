import type { Furniture, Plan, Room } from '../model.ts';
import { findRooms, newFurniture } from '../model.ts';
import { distance, intersection, pointInPolygon, projectPoint, round, uid, plural } from '../geometry.ts';
import type { Point } from '../geometry.ts';
import { GOALS } from './types.ts';
import { isBrief } from './contracts.ts';
import type { DesignBrief, PurchaseSpec } from './types.ts';

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
function polygonInside(poly: Point[], room: Room) {
  if (!poly.every(p => pointInPolygon(p,room.vertices))) return false;
  return poly.every((p,i) => room.vertices.every((a,j) => {
    const hit = intersection(p,poly[(i + 1) % poly.length],a,room.vertices[(j + 1) % room.vertices.length]);
    return !hit || distance(hit,p) < .1 || distance(hit,poly[(i + 1) % poly.length]) < .1;
  }));
}
function geometry(plan: Plan) {
  const walls = plan.walls.map(w => { const a = plan.nodes[w.a], b = plan.nodes[w.b]; return itemPolygon({ x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:distance(a,b),depth:w.thickness,rotation:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI }); });
  const doors = plan.openings.filter(o => o.kind === 'door').map(o => {
    const w = plan.walls.find(w => w.id === o.wallId)!, a = plan.nodes[w.a], b = plan.nodes[w.b], angle = Math.atan2(b.y-a.y,b.x-a.x), c = Math.cos(angle), s = Math.sin(angle);
    const center = { x:a.x+(b.x-a.x)*o.t,y:a.y+(b.y-a.y)*o.t };
    return { center, width:o.width, normal:{x:-s,y:c}, polygon:itemPolygon({x:center.x-s*o.swing*o.width/2,y:center.y+c*o.swing*o.width/2,width:o.width+8,depth:o.width+16,rotation:angle*180/Math.PI}) };
  });
  return { walls, doors };
}
export function placementIssues(plan: Plan, item: Furniture, room?: Room): string[] {
  const poly = itemPolygon(item), g = geometry(plan), issues: string[] = [];
  if (room && !polygonInside(poly,room)) issues.push('outside');
  if (g.walls.some(w => polygonsOverlap(poly,w,1.5))) issues.push('wall');
  if (g.doors.some(d => polygonsOverlap(poly,d.polygon))) issues.push('door');
  if (plan.furniture.some(f => f.id !== item.id && polygonsOverlap(poly,itemPolygon(f)))) issues.push('furniture');
  return issues;
}
function roomOf(item: Point, rooms: Room[]) { return rooms.find(r => pointInPolygon(item,r.vertices)); }
function roomBounds(room: Room) {
  return { minX:Math.min(...room.vertices.map(p=>p.x)),maxX:Math.max(...room.vertices.map(p=>p.x)),minY:Math.min(...room.vertices.map(p=>p.y)),maxY:Math.max(...room.vertices.map(p=>p.y)) };
}
function backPoint(f: Furniture) { const a=f.rotation*Math.PI/180; return {x:f.x+Math.sin(a)*f.depth/2,y:f.y-Math.cos(a)*f.depth/2}; }
function candidates(item: Furniture, room: Room) {
  const b = roomBounds(room), step = Math.max(25,Math.ceil(Math.sqrt(room.area/130)/5)*5);
  const out: Furniture[] = [item];
  for (const rotation of new Set([item.rotation,0,90,180,270])) {
    const size = itemPolygon({...item,x:0,y:0,rotation}), hw = Math.max(...size.map(p=>Math.abs(p.x))), hd = Math.max(...size.map(p=>Math.abs(p.y)));
    const xs = new Set([item.x,room.center.x,b.minX+hw+12,b.maxX-hw-12]);
    const ys = new Set([item.y,room.center.y,b.minY+hd+12,b.maxY-hd-12]);
    for (let x=b.minX+hw+12;x<=b.maxX-hw-12;x+=step) xs.add(round(x));
    for (let y=b.minY+hd+12;y<=b.maxY-hd-12;y+=step) ys.add(round(y));
    for (const x of xs) for (const y of ys) out.push({...item,x:round(x),y:round(y),rotation});
  }
  return out;
}
function positionScore(f: Furniture, original: Furniture, room: Room, placed: Furniture[], plan: Plan, brief: DesignBrief, seed: number) {
  const b=roomBounds(room), back=backPoint(f);
  const wallDistance=Math.min(...room.vertices.map((p,i)=>projectPoint(back,p,room.vertices[(i+1)%room.vertices.length]).distance));
  const move=distance(f,original)/100 + Math.abs(f.rotation-original.rotation)/180;
  let score = move * (seed===0 ? 2.4 : .25);
  const wallItem=['sofa','bed','wardrobe','shelf','desk'].includes(f.kind);
  if (wallItem) {
    score += wallDistance / 30;
    const side = (seed + (f.kind==='bed'?1:0)) % 4;
    const target=[{x:room.center.x,y:b.minY},{x:b.maxX,y:room.center.y},{x:room.center.x,y:b.maxY},{x:b.minX,y:room.center.y}][side];
    score += distance(back,target) / (seed===0 ? 500 : 95);
  }
  if (brief.goals.includes('space') && !['table','dining'].includes(f.kind)) score += Math.max(0,110-distance(f,room.center))/35;
  if (f.kind==='table') {
    const anchor=placed.find(p=>p.kind===(/тумбоч/i.test(f.name)?'bed':'sofa')&&pointInPolygon(p,room.vertices));
    if (anchor) { const a=anchor.rotation*Math.PI/180, gap=/тумбоч/i.test(f.name)?20:45; const target={x:anchor.x-Math.sin(a)*(anchor.depth/2+f.depth/2+gap),y:anchor.y+Math.cos(a)*(anchor.depth/2+f.depth/2+gap)}; score+=distance(f,target)/35; }
  }
  if (f.kind==='chair'||f.kind==='lamp') { const seat=placed.find(p=>p.kind==='sofa'&&pointInPolygon(p,room.vertices)); if(seat) score+=Math.abs(distance(f,seat)-(f.kind==='lamp'?145:205))/55; }
  if (f.kind==='dining') score+=distance(f,room.center)/80;
  if (f.kind==='desk'||f.kind==='plant') {
    const windows=plan.openings.filter(o=>o.kind==='window').map(o=>{const w=plan.walls.find(w=>w.id===o.wallId)!,a=plan.nodes[w.a],b=plan.nodes[w.b];return{x:a.x+(b.x-a.x)*o.t,y:a.y+(b.y-a.y)*o.t};}).filter(p=>projectPoint(p,room.vertices[0],room.vertices[1]).distance<100||distance(p,room.center)<400);
    if(windows.length) score+=Math.min(...windows.map(p=>distance(f,p)))/(f.kind==='desk'?70:100);
  }
  return score;
}
function roomRoutes(room: Room, furniture: Furniture[], plan: Plan) {
  const b=roomBounds(room), step=25, nx=Math.ceil((b.maxX-b.minX)/step), ny=Math.ceil((b.maxY-b.minY)/step);
  if(nx*ny>30000) return false;
  const blocks=furniture.filter(f=>pointInPolygon(f,room.vertices)).map(f=>itemPolygon(f,18));
  const free=new Set<number>(), centers=new Map<number,Point>();
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const p={x:b.minX+(x+.5)*step,y:b.minY+(y+.5)*step};
    if(pointInPolygon(p,room.vertices)&&!blocks.some(poly=>pointInPolygon(p,poly))){const id=y*nx+x;free.add(id);centers.set(id,p);}
  }
  if(!free.size)return false;
  const components=new Map<number,number>();let component=0;
  for(const id of free)if(!components.has(id)){const queue=[id];components.set(id,component);for(let i=0;i<queue.length;i++){const current=queue[i],x=current%nx;for(const next of [x>0?current-1:-1,x<nx-1?current+1:-1,current-nx,current+nx])if(free.has(next)&&!components.has(next)){components.set(next,component);queue.push(next);}}component++;}
  const portals=geometry(plan).doors.flatMap(d=>[-1,1].map(sign=>({x:d.center.x+d.normal.x*sign*55,y:d.center.y+d.normal.y*sign*55})).filter(p=>pointInPolygon(p,room.vertices)));
  const groups=portals.map(p=>{let best=-1,near=55;for(const [id,c]of centers){const delta=distance(p,c);if(delta<near){near=delta;best=id;}}return components.get(best);});
  return groups.every(g=>g!==undefined)&&(groups.length<2||new Set(groups).size===1);
}
function purchaseFor(brief: DesignBrief, room: Room, seed: number): {item:Furniture;spec:PurchaseSpec}|undefined {
  if(!brief.purchases||brief.budget<4000||seed===0)return;
  const work=brief.goals.includes('work'), storage=brief.goals.includes('storage');
  const kind=work?'desk':storage?'shelf':'lamp';
  const budget=Math.min(brief.budget,kind==='desk'?20000:kind==='shelf'?16000:10000);
  const item=newFurniture(kind,room.center);
  item.color=brief.style==='warm'?'#d7bda0':brief.style==='calm'?'#d4d2cb':'#c8b5c9';
  const reason=work?'Отдельное место для работы, подобранное по свободному месту в комнате':storage?'Неглубокое хранение вдоль стены с сохранением места для прохода':'Отдельный свет рядом с зоной отдыха для вечера';
  const style={warm:'дерево тёплые оттенки',calm:'светлый минимализм',expressive:'выразительный цвет'}[brief.style];
  return {item,spec:{id:uid(),furnitureId:item.id,name:item.name,width:item.width,depth:item.depth,reason,search:`${item.name} ${item.width}х${item.depth} см ${style}`,budget}};
}
export function generateLayouts(source: Plan, input: DesignBrief, limit = 3): Plan[] {
  const brief=validateBrief(source,input), rooms=findRooms(source), selected=rooms.filter(r=>brief.roomIds.includes(r.id));
  if(!selected.length)throw new Error('Сначала замкните стены хотя бы одной комнаты');
  const movable=source.furniture.filter(f=>!FIXED_KINDS.has(f.kind)&&!brief.lockedIds.includes(f.id)&&selected.some(r=>pointInPolygon(f,r.vertices)));
  if(!movable.length)throw new Error('Разрешите переставить хотя бы один предмет в выбранных комнатах');
  const movableIds=new Set(movable.map(f=>f.id)), fixed=source.furniture.filter(f=>!movableIds.has(f.id));
  const g=geometry(source), existingProblems=fixed.filter(f=>selected.some(r=>pointInPolygon(f,r.vertices))&&g.doors.some(d=>polygonsOverlap(itemPolygon(f),d.polygon))).map(f=>f.name);
  if(existingProblems.length)throw new Error(`Неизменяемый предмет перекрывает открывание двери: ${existingProblems[0]}. Проверьте план или разрешите его переставить.`);
  const fixedConflict=fixed.find(f=>selected.some(r=>pointInPolygon(f,r.vertices))&&(g.walls.some(w=>polygonsOverlap(itemPolygon(f),w,1.5))||fixed.some(other=>other.id!==f.id&&polygonsOverlap(itemPolygon(f),itemPolygon(other)))));
  if(fixedConflict)throw new Error(`Неподвижный предмет пересекает стену или другую мебель: ${fixedConflict.name}. Исправьте исходный план или снимите фиксацию.`);
  const results:Plan[]=[]; const signatures=new Set<string>();
  for(let seed=0;seed<12&&results.length<Math.min(6,limit);seed++){
    const placed=[...fixed], allSpecs:PurchaseSpec[]=[]; let failed=false;
    const addition=selected.length?purchaseFor(brief,selected.find(r=>r.area>100000)??selected[0],seed):undefined;
    const jobs=[...movable,...(addition?[addition.item]:[])].sort((a,b)=>b.width*b.depth-a.width*a.depth);
    for(const original of jobs){
      const room=roomOf(original,selected); if(!room){failed=true;break;}
      let best:Furniture|undefined, score=Infinity;
      for(const f of candidates(original,room)){
        const poly=itemPolygon(f);
        if(!polygonInside(poly,room)||g.walls.some(w=>polygonsOverlap(poly,w,1.5))||g.doors.some(d=>polygonsOverlap(poly,d.polygon))||placed.some(p=>polygonsOverlap(poly,itemPolygon(p),1)))continue;
        const s=positionScore(f,original,room,placed,source,brief,seed);
        if(s<score){score=s;best=f;}
      }
      if(!best){failed=true;break;} placed.push(best);
      if(addition&&best.id===addition.item.id)allSpecs.push(addition.spec);
    }
    if(failed||!selected.every(room=>roomRoutes(room,placed,source)))continue;
    const changed=movable.filter(f=>{const next=placed.find(p=>p.id===f.id)!;return distance(f,next)>10||Math.abs(f.rotation-next.rotation)>5;});
    if(!changed.length&&!allSpecs.length)continue;
    const signature=placed.filter(f=>movableIds.has(f.id)||!source.furniture.some(old=>old.id===f.id)).sort((a,b)=>a.id.localeCompare(b.id)).map(f=>`${round(f.x,25)},${round(f.y,25)},${round(f.rotation,45)}`).join(';')+allSpecs.map(p=>p.name).join();
    if(signatures.has(signature))continue;signatures.add(signature);
    const title=!allSpecs.length&&results.length===0?'Из того, что есть':brief.goals.includes('work')?(results.length===1?'С местом для работы':'Работа и отдых'):brief.goals.includes('storage')?(results.length===1?'Вещи на своих местах':'Другая организация хранения'):results.length===1?'Вечер дома':'Больше пространства';
    const changes=changed.map(f=>{const next=placed.find(p=>p.id===f.id)!,m=Math.round(distance(f,next)),angle=Math.abs(round(f.rotation-next.rotation));return `${f.name}: ${m>10?`перемещение на ${m} см`:''}${m>10&&angle>5?', ':''}${angle>5?`поворот на ${angle}°`:''}`;});
    const tradeoffs=[seed===0?'Сохраняем всю мебель. Изменения касаются только её положения.':'Для другой расстановки нужно передвинуть крупные предметы.'];
    if(allSpecs.length)tradeoffs.push('Бюджет покупки указан как ориентир. Конкретный товар ещё предстоит подобрать.');
    const plan:Plan={...structuredClone(source),id:uid(),name:title,furniture:structuredClone(placed),improvement:{sourceId:source.id,createdAt:new Date().toISOString(),engine:'local',title,summary:`${plural(changed.length,'Переставлен','Переставлены','Переставлено')} ${changed.length} ${plural(changed.length,'предмет','предмета','предметов')}${allSpecs.length?`, добавлен ${allSpecs[0].name.toLowerCase()}`:''}. Стены и существующая мебель сохранены.`,tradeoffs,changes,purchases:allSpecs,brief}};
    results.push(plan);
  }
  if(!results.length)throw new Error('Не удалось собрать подходящую расстановку. Попробуйте выбрать одну комнату или разрешить переставлять больше предметов.');
  return results;
}
