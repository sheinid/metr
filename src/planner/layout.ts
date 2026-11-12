import type { Furniture, Plan, Room } from '../model.ts';
import { findRooms, newFurniture } from '../model.ts';
import { distance, intersection, pointInPolygon, projectPoint, round, uid } from '../geometry.ts';
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
const angleDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);
const forward = (f: Furniture) => { const a = f.rotation * Math.PI / 180; return { x: -Math.sin(a), y: Math.cos(a) }; };
const moved = (a: Furniture, b: Furniture) => distance(a,b) > .5 || angleDistance(a.rotation,b.rotation) > .5;
const isTv = (f: Furniture) => /телевиз|(?:^|\s)(?:тв|tv)(?:\s|$)/iu.test(f.name);
function candidates(item: Furniture, room: Room, items: Furniture[] = []): Furniture[] {
  const b = roomBounds(room), step = Math.max(25,Math.ceil(Math.sqrt(room.area/150)/5)*5);
  const out: Furniture[] = [item];
  for (const rotation of new Set([item.rotation,0,90,180,270])) {
    const size = itemPolygon({...item,x:0,y:0,rotation}), hw = Math.max(...size.map(p=>Math.abs(p.x))), hd = Math.max(...size.map(p=>Math.abs(p.y)));
    const xs = new Set([item.x,room.center.x,b.minX+hw+12,b.maxX-hw-12]);
    const ys = new Set([item.y,room.center.y,b.minY+hd+12,b.maxY-hd-12]);
    for (let x=b.minX+hw+12;x<=b.maxX-hw-12;x+=step) xs.add(round(x));
    for (let y=b.minY+hd+12;y<=b.maxY-hd-12;y+=step) ys.add(round(y));
    for (const x of xs) for (const y of ys) out.push({...item,x:round(x),y:round(y),rotation});
  }
  if (item.kind === 'chair') {
    const sofa = items.find(f=>f.kind==='sofa'&&pointInPolygon(f,room.vertices));
    if (sofa) for (const f of [...out]) out.push({...f,rotation:Math.atan2(f.x-sofa.x,sofa.y-f.y)*180/Math.PI});
  }
  return out;
}
export function useArea(item: Furniture): Point[] | undefined {
  const depth = item.kind==='desk' ? 75 : ['wardrobe','shelf'].includes(item.kind) ? 60 : ['chair','sofa'].includes(item.kind) ? 50 : 0;
  if (!depth) return;
  const direction = forward(item), width = Math.min(item.width,item.kind==='sofa'?140:70);
  return itemPolygon({...item,x:item.x+direction.x*(item.depth/2+depth/2),y:item.y+direction.y*(item.depth/2+depth/2),width,depth});
}
function areaIssues(plan: Plan, item: Furniture, room: Room): string[] {
  const area = useArea(item); if (!area) return [];
  const g = geometry(plan), issues: string[] = [];
  if (!polygonInside(area,room)||g.walls.some(w=>polygonsOverlap(area,w))) issues.push('use-wall');
  if (plan.furniture.some(f=>f.id!==item.id&&polygonsOverlap(area,itemPolygon(f)))) issues.push('use-furniture');
  if (g.doors.some(d=>polygonsOverlap(area,d.polygon))) issues.push('use-door');
  return issues;
}
function roomRoutes(room: Room, furniture: Furniture[], plan: Plan, required: Furniture[] = []): boolean {
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
  const portals=geometry(plan).doors.flatMap(d=>[-1,1].map(sign=>({x:d.center.x+d.normal.x*sign*55,y:d.center.y+d.normal.y*sign*55})).filter(p=>pointInPolygon(p,room.vertices)));
  const near=(p:Point,area?:Point[])=>{
    let best=-1,delta=area?Infinity:35;
    for(const [id,c]of centers){const d=distance(p,c);if(d<delta&&(!area||pointInPolygon(c,area))){delta=d;best=id;}}
    return components.get(best);
  };
  const entrances=portals.map(p=>near(p));
  if(entrances.some(g=>g===undefined)||new Set(entrances).size>1)return false;
  const entry=entrances[0]??sizes.indexOf(Math.max(...sizes));
  return required.every(f=>{
    const area=useArea(f);if(!area)return true;
    const p=area.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0});
    return near(p,area)===entry;
  });
}
export function usabilityIssues(plan: Plan, item: Furniture, room: Room): string[] {
  const issues=[...placementIssues(plan,item,room),...areaIssues(plan,item,room)];
  if(!issues.length&&!roomRoutes(room,plan.furniture,plan,[item]))issues.push('unreachable');
  return issues;
}
function wallDistance(item: Furniture, room: Room) {
  const back=backPoint(item);
  return Math.min(...room.vertices.map((p,i)=>projectPoint(back,p,room.vertices[(i+1)%room.vertices.length]).distance));
}
function roomWindows(plan: Plan, room: Room): Point[] {
  return plan.openings.filter(o=>o.kind==='window').flatMap(o=>{
    const w=plan.walls.find(w=>w.id===o.wallId)!,a=plan.nodes[w.a],b=plan.nodes[w.b],p={x:a.x+(b.x-a.x)*o.t,y:a.y+(b.y-a.y)*o.t};
    return room.vertices.some((a,i)=>projectPoint(p,a,room.vertices[(i+1)%room.vertices.length]).distance<2)?[p]:[];
  });
}
function movementCost(source: Plan, plan: Plan): number {
  return source.furniture.reduce((sum,old)=>{
    const f=plan.furniture.find(f=>f.id===old.id)!;if(!moved(old,f))return sum;
    const weight=['bed','sofa','wardrobe','dining'].includes(f.kind)?2:1;
    return sum+20+distance(old,f)/12*weight+angleDistance(old.rotation,f.rotation)/20;
  },0);
}
function zonePenalty(plan: Plan, room: Room): number {
  const items=plan.furniture.filter(f=>pointInPolygon(f,room.vertices)),sofa=items.find(f=>f.kind==='sofa');
  if(!sofa)return 0;
  const direction=forward(sofa);
  return items.reduce((score,f)=>{
    if(f.kind==='table'&&!/тумбоч/i.test(f.name)){
      const dx=f.x-sofa.x,dy=f.y-sofa.y,front=dx*direction.x+dy*direction.y;
      const lateral=Math.abs(dx*direction.y-dy*direction.x);
      return score+Math.max(0,lateral-sofa.width/2)/15+Math.abs(front-sofa.depth/2-f.depth/2-45)/20+(front<0?25:0);
    }
    if(f.kind==='chair'||isTv(f)){
      const d=distance(f,sofa)||1,look=forward(f),toward=(look.x*(sofa.x-f.x)+look.y*(sofa.y-f.y))/d;
      return score+(1-toward)*12+(isTv(f)?(1-(direction.x*(f.x-sofa.x)+direction.y*(f.y-sofa.y))/d)*12:Math.abs(d-210)/70);
    }
    return score;
  },0);
}
function spacePenalty(plan: Plan, room: Room): number {
  return plan.furniture.filter(f=>pointInPolygon(f,room.vertices)&&!['table','dining'].includes(f.kind)).reduce((n,f)=>n+Math.max(0,120-distance(f,room.center))/15,0);
}
function repairBaseline(source: Plan, selected: Room[], locked: Set<string>): Plan {
  const plan=structuredClone(source);
  for(const original of [...plan.furniture].sort((a,b)=>a.width*a.depth-b.width*b.depth)){
    const room=roomOf(original,selected);if(!room||!placementIssues(plan,original,room).length)continue;
    if(locked.has(original.id))throw new Error(`Неподвижный предмет пересекает стену, мебель или дверь: ${original.name}. Исправьте план или снимите фиксацию.`);
    const options=candidates(original,room).filter(f=>!placementIssues({...plan,furniture:plan.furniture.filter(p=>p.id!==f.id)},f,room).length)
      .sort((a,b)=>(distance(a,original)+angleDistance(a.rotation,original.rotation)*6)-(distance(b,original)+angleDistance(b.rotation,original.rotation)*6));
    if(!options[0])throw new Error(`Не удалось убрать пересечение у предмета «${original.name}», сохранив остальную мебель.`);
    plan.furniture=plan.furniture.map(f=>f.id===original.id?options[0]:f);
  }
  return plan;
}
function purchaseFor(brief: DesignBrief, room: Room, source: Plan): {item:Furniture;spec:PurchaseSpec}|undefined {
  if(!brief.purchases||brief.budget<4000||!brief.goals.some(g=>['work','storage','cozy'].includes(g)))return;
  const work=brief.goals.includes('work'),storage=brief.goals.includes('storage'),kind=work?'desk':storage?'shelf':'lamp';
  if(work&&source.furniture.some(f=>f.kind==='desk'&&pointInPolygon(f,room.vertices)))return;
  const item=newFurniture(kind,room.center),budget=Math.min(brief.budget,kind==='desk'?20000:kind==='shelf'?16000:10000);
  item.color=brief.style==='warm'?'#d7bda0':brief.style==='calm'?'#d4d2cb':'#c8b5c9';
  const reason=work?'Отдельное рабочее место с местом для кресла':storage?'Дополнительное хранение с доступом к полкам':'Свет рядом с существующим местом для отдыха';
  const style={warm:'дерево тёплые оттенки',calm:'светлый минимализм',expressive:'выразительный цвет'}[brief.style];
  return {item,spec:{id:uid(),furnitureId:item.id,name:item.name,width:item.width,depth:item.depth,reason,search:`${item.name} ${item.width}х${item.depth} см ${style}`,budget}};
}
function roomPriority(room: Room, source: Plan, kind: string): number {
  const items=source.furniture.filter(f=>pointInPolygon(f,room.vertices)),name=room.label?.name??'';
  if(items.some(f=>['bath','toilet'].includes(f.kind))||/ванн|сануз|туалет/i.test(name))return -100;
  if(kind==='desk')return items.some(f=>f.kind==='desk')?100:/кабинет|рабоч/i.test(name)?90:items.some(f=>f.kind==='sofa')?80:items.some(f=>f.kind==='kitchen')?-50:/прихож|корид/i.test(name)?-20:20;
  if(kind==='shelf')return /прихож|гардероб/i.test(name)?90:items.some(f=>f.kind==='wardrobe')?80:items.some(f=>f.kind==='sofa')?60:10;
  return items.some(f=>f.kind==='sofa')?90:items.some(f=>f.kind==='bed'||f.kind==='chair')?70:0;
}
interface Proposal { plan: Plan; score: number; focus?: Furniture }
function assemble(source: Plan, furniture: Furniture[], brief: DesignBrief, room: Room, addition?: {item:Furniture;spec:PurchaseSpec}): Plan {
  const changed=source.furniture.filter(f=>moved(f,furniture.find(p=>p.id===f.id)!));
  const changes=changed.map(f=>{
    const next=furniture.find(p=>p.id===f.id)!,cm=Math.round(distance(f,next)),angle=Math.round(angleDistance(f.rotation,next.rotation));
    const repair=placementIssues(source,f,roomOf(f,findRooms(source))).length>0;
    return `${f.name}: ${cm?`сдвиг на ${cm} см`:''}${cm&&angle?', ':''}${angle?`поворот на ${angle}°`:''}${repair?', устранено пересечение':addition?', освобождён подход к новому предмету':''}`;
  });
  if(addition)changes.push(`${addition.item.name}: добавлен в комнату «${room.label?.name??'без названия'}»${addition.item.kind==='desk'?', перед столом свободно 75 см для кресла':''}`);
  const title=addition?`${addition.item.name} без ${changed.filter(f=>distance(f,furniture.find(p=>p.id===f.id)!)>15).length?'большой перестановки':'перестановки'}`:'Удобнее пользоваться мебелью';
  return {...structuredClone(source),id:uid(),name:title,furniture:structuredClone(furniture),improvement:{sourceId:source.id,createdAt:new Date().toISOString(),engine:'local',title,summary:changes.join('. '),tradeoffs:['Проходы проверены на сетке 20 см. Розетки, высоты и освещённость нужно проверить на месте.'],changes,purchases:addition?[addition.spec]:[],brief}};
}
function signature(source: Plan, plan: Plan): string {
  const originals=source.furniture.map(f=>plan.furniture.find(p=>p.id===f.id)!);
  const added=plan.furniture.filter(f=>!source.furniture.some(p=>p.id===f.id)).sort((a,b)=>a.kind.localeCompare(b.kind));
  return [...originals,...added].map(f=>`${f.kind}:${round(f.x)},${round(f.y)},${round(f.rotation)}`).join(';');
}
function different(a: Proposal, b: Proposal, source: Plan): boolean {
  if(a.focus&&b.focus&&a.focus.kind===b.focus.kind)return distance(a.focus,b.focus)>=(a.focus.kind==='desk'?160:70)||angleDistance(a.focus.rotation,b.focus.rotation)>=45;
  if(!!a.focus!==!!b.focus)return true;
  return source.furniture.some(f=>{const x=a.plan.furniture.find(p=>p.id===f.id)!,y=b.plan.furniture.find(p=>p.id===f.id)!;return distance(x,y)>=60||angleDistance(x.rotation,y.rotation)>=45;});
}
export function layoutFacts(source: Plan, plan: Plan) {
  const rooms=findRooms(source),changed=source.furniture.filter(f=>moved(f,plan.furniture.find(p=>p.id===f.id)!));
  return {movedExisting:changed.length,totalMovementCm:Math.round(changed.reduce((n,f)=>n+distance(f,plan.furniture.find(p=>p.id===f.id)!),0)),
    affectedRooms:[...new Set(changed.map(f=>roomOf(f,rooms)?.label?.name??'Без названия'))],
    preservedRooms:rooms.filter(r=>!changed.some(f=>pointInPolygon(f,r.vertices))&&!plan.improvement?.purchases.some(s=>pointInPolygon(plan.furniture.find(f=>f.id===s.furnitureId)!,r.vertices))).map(r=>r.label?.name??'Без названия'),
    additions:(plan.improvement?.purchases??[]).map(s=>{const f=plan.furniture.find(f=>f.id===s.furnitureId)!,room=roomOf(f,rooms)!;return {name:f.name,room:room.label?.name??'Без названия',chairSpaceCm:f.kind==='desk'?75:undefined,accessFromDoor:geometry(source).doors.some(d=>room.vertices.some((a,i)=>projectPoint(d.center,a,room.vertices[(i+1)%room.vertices.length]).distance<2))?usabilityIssues(plan,f,room).length===0:null};})};
}
export function generateLayouts(source: Plan, input: DesignBrief, limit = 3): Plan[] {
  const brief=validateBrief(source,input),rooms=findRooms(source),selected=rooms.filter(r=>brief.roomIds.includes(r.id));
  if(!selected.length)throw new Error('Сначала замкните стены хотя бы одной комнаты');
  const locked=new Set([...brief.lockedIds,...source.furniture.filter(f=>FIXED_KINDS.has(f.kind)).map(f=>f.id)]);
  const proposals:Proposal[]=[];
  if(source.furniture.every(f=>locked.has(f.id)||!selected.some(r=>pointInPolygon(f,r.vertices)))&&(!brief.purchases||brief.budget<4000))throw new Error('Разрешите переставить мебель или добавить новый предмет.');
  const kind=brief.goals.includes('work')?'desk':brief.goals.includes('storage')?'shelf':'lamp';
  const ranked=[...selected].sort((a,b)=>roomPriority(b,source,kind)-roomPriority(a,source,kind));
  for(const room of ranked){
    if(roomPriority(room,source,kind)<0)continue;
    if(kind==='desk'&&selected.some(r=>source.furniture.some(f=>f.kind==='desk'&&pointInPolygon(f,r.vertices))))continue;
    const base=repairBaseline(source,[room],locked);
    const addition=purchaseFor(brief,room,base);if(!addition)continue;
    const options=candidates(addition.item,room).filter(f=>wallDistance(f,room)<=40);
    for(const allowMoves of [false,true]){
      for(const f of options){
        const area=useArea(f),g=geometry(base),poly=itemPolygon(f);
        if(!polygonInside(poly,room)||g.walls.some(w=>polygonsOverlap(poly,w))||g.doors.some(d=>polygonsOverlap(poly,d.polygon))||area&&(!polygonInside(area,room)||g.walls.some(w=>polygonsOverlap(area,w))||g.doors.some(d=>polygonsOverlap(area,d.polygon))))continue;
        const conflicts=base.furniture.filter(p=>polygonsOverlap(poly,itemPolygon(p))||area&&polygonsOverlap(area,itemPolygon(p)));
        if(conflicts.length&&(!allowMoves||conflicts.length>2||conflicts.some(p=>locked.has(p.id)||!['plant','chair','table','lamp'].includes(p.kind))))continue;
        if(allowMoves&&!conflicts.length)continue;
        let trial:Plan={...base,furniture:[...base.furniture,f]},failed=false;
        for(const blocker of conflicts){
          const destinations=candidates(blocker,room,base.furniture).filter(p=>distance(p,blocker)<=120&&(!area||!polygonsOverlap(itemPolygon(p),area))&&!placementIssues(trial,p,room).length&&!areaIssues(trial,p,room).length)
            .sort((a,b)=>(distance(a,blocker)+angleDistance(a.rotation,blocker.rotation)/2)-(distance(b,blocker)+angleDistance(b.rotation,blocker.rotation)/2));
          if(!destinations[0]){failed=true;break;}
          trial={...trial,furniture:trial.furniture.map(p=>p.id===blocker.id?destinations[0]:p)};
        }
        if(failed||zonePenalty(trial,room)>zonePenalty(base,room)+1||usabilityIssues(trial,f,room).length||conflicts.length&&!roomRoutes(room,trial.furniture,trial,[f,...conflicts.map(p=>trial.furniture.find(q=>q.id===p.id)!)]))continue;
        const protectedAreas=base.furniture.filter(p=>pointInPolygon(p,room.vertices)&&!areaIssues(base,p,room).length).flatMap(p=>{const current=trial.furniture.find(q=>q.id===p.id)!,zone=useArea(current);return zone?[zone]:[];});
        if(protectedAreas.some(zone=>polygonsOverlap(poly,zone)||area&&polygonsOverlap(area,zone)))continue;
        const windows=roomWindows(source,room),windowDistance=windows.length?Math.min(...windows.map(p=>distance(p,f))):0;
        const sofa=base.furniture.find(p=>p.kind==='sofa'&&pointInPolygon(p,room.vertices));
        if(f.kind==='lamp'&&(!sofa||distance(f,sofa)>210))continue;
        const score=movementCost(source,trial)+wallDistance(f,room)/30+windowDistance/(kind==='desk'?150:500)+(f.kind==='lamp'&&sofa?Math.abs(distance(f,sofa)-100)/20:0);
        proposals.push({plan:assemble(source,trial.furniture,brief,room,{...addition,item:f}),score,focus:f});
      }
      if(proposals.length)break;
    }
    if(proposals.length)break;
  }
  if(!proposals.length){
    for(const room of ranked){
      if(roomPriority(room,source,kind)<0)continue;
      if(kind==='desk'&&!source.furniture.some(f=>f.kind==='desk'&&pointInPolygon(f,room.vertices)))continue;
      const base=repairBaseline(source,[room],locked);
      const seating=brief.goals.some(g=>g==='cozy'||g==='guests'),space=brief.goals.includes('space');
      const before=(seating?zonePenalty(base,room):0)+(space?spacePenalty(base,room):0);
      for(const original of base.furniture.filter(f=>!locked.has(f.id)&&pointInPolygon(f,room.vertices)&&(kind==='desk'&&f.kind==='desk'||kind==='shelf'&&['wardrobe','shelf'].includes(f.kind)&&!isTv(f)||(seating||space)&&(['table','chair','desk'].includes(f.kind)||isTv(f))))){
        const oldUse=['desk','shelf','wardrobe'].includes(original.kind)?usabilityIssues(base,original,room).length*25:0;
        for(const f of candidates(original,room,base.furniture)){
          if(!moved(original,f))continue;
          const trial={...base,furniture:base.furniture.map(p=>p.id===f.id?f:p)};
          if(placementIssues(trial,f,room).length||areaIssues(trial,f,room).length)continue;
          const after=(seating?zonePenalty(trial,room):0)+(space?spacePenalty(trial,room):0);
          if(!seating&&zonePenalty(trial,room)>zonePenalty(base,room)+1)continue;
          const benefit=before-after+oldUse,cost=movementCost(source,trial)*.2;
          if(benefit-cost<2||!roomRoutes(room,trial.furniture,trial,useArea(f)?[f]:[]))continue;
          proposals.push({plan:assemble(source,trial.furniture,brief,room),score:cost-benefit});
        }
      }
      if(proposals.length)break;
    }
  }
  const results:Proposal[]=[],seen=new Set<string>();
  for(const candidate of proposals.sort((a,b)=>a.score-b.score)){
    const key=signature(source,candidate.plan);if(seen.has(key))continue;seen.add(key);
    if(results.some(p=>!different(p,candidate,source)))continue;
    results.push(candidate);if(results.length>=Math.min(6,Math.max(1,limit)))break;
  }
  if(!results.length)throw new Error('Не нашлось улучшения с достаточным местом для использования мебели и прохода. Попробуйте выбрать другую комнату или изменить ограничения.');
  return results.map(p=>p.plan);
}
