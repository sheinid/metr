import type { Plan, Furniture, FurnitureKind } from '../src/model.ts';
import { CATALOG, findRooms } from '../src/model.ts';
import type { DesignBrief, PurchaseSpec } from '../src/planner/types.ts';
import { FIXED_KINDS, placementIssues, usabilityIssues, itemPolygon, useArea, polygonsOverlap, planObstacles, workspace, accessDiagnostics } from '../src/planner/validation.ts';
import { parseProject } from '../src/storage.ts';
import { distance, pointInPolygon, uid } from '../src/geometry.ts';

export interface LayoutIssue { itemId?:string; code:string; message:string; relatedIds?:string[]; area?:{x:number;y:number}[]; access?:ReturnType<typeof accessDiagnostics> }
export interface Placement { furnitureId:string; x:number; y:number; rotation:number; reason:string }
export interface Addition { key:string; kind:FurnitureKind; name:string; x:number; y:number; rotation:number; width:number; depth:number; budget:number; reason:string; search:string }
export interface Removal { furnitureId:string; reason:string; replacementKey:string|null }
export interface LayoutDraft { key:string; title:string; summary:string; tradeoffs:string[]; placements:Placement[]; additions:Addition[]; removals:Removal[] }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const number=(v:unknown,max=100000):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=max;
const pose=(v:Record<string,unknown>)=>number(v.x)&&number(v.y)&&number(v.rotation,3600);
const angle=(a:number,b:number)=>Math.abs(((a-b+540)%360+360)%360-180);
function same(a:Furniture,b:Furniture){return distance(a,b)<.01&&angle(a.rotation,b.rotation)<.01;}
export function inspectLayout(plan:Plan,brief:DesignBrief):LayoutIssue[] {
  const rooms=findRooms(plan).filter(r=>brief.roomIds.includes(r.id)),g=planObstacles(plan),issues:LayoutIssue[]=[];
  for(const f of plan.furniture){
    const room=rooms.find(r=>pointInPolygon(f,r.vertices));if(!room)continue;
    const codes=FIXED_KINDS.has(f.kind)?placementIssues(plan,f,room):usabilityIssues(plan,f,room);
    for(const code of codes){
      const usage=code.startsWith('use-')||code==='unreachable',pair=workspace(plan,f,room),owner=usage?(pair?.desk??f):f;
      const access=usage?accessDiagnostics(plan,f,room):undefined;
      const area=usage?(access?.zones.find(z=>z.blockedBy.length||z.doorIds.length||!z.insideRoom)?.polygon??access?.zones[0]?.polygon??useArea(owner)):itemPolygon(f),ignored=new Set([owner.id,...(pair?.chairs.map(p=>p.id)??[])]);
      const relatedIds=code==='furniture'||code==='use-furniture'?plan.furniture.filter(p=>p.id!==f.id&&!ignored.has(p.id)&&area&&polygonsOverlap(area,itemPolygon(p))).map(p=>p.id):code==='door'||code==='use-door'?g.doors.filter(d=>area&&polygonsOverlap(area,d.polygon)).map(d=>d.id):[];
      const message:Record<string,string>={outside:'Предмет выходит за границу комнаты',wall:'Предмет пересекает стену',door:'Предмет мешает открыванию двери',furniture:'Предметы пересекаются','use-wall':'Перед предметом недостаточно места из-за стены','use-door':'Место использования пересекает открывание двери','use-furniture':'Место использования занято другой мебелью',unreachable:'От входа нет прохода к зоне использования предмета на сетке 20 см'};
      if(issues.some(i=>i.itemId===owner.id&&i.code===code))continue;
      issues.push({itemId:owner.id,code,message:`${owner.name}: ${message[code]??code}`,relatedIds,...(area?{area}:{}),...(access?{access}:{})});
    }
  }
  return issues.slice(0,60);
}
export function compileDraft(source:Plan,brief:DesignBrief,value:unknown):{plan?:Plan;issues:LayoutIssue[]} {
  const issues:LayoutIssue[]=[],fail=(message:string,itemId?:string)=>issues.push({code:'contract',message,itemId});
  if(!object(value)||!text(value.key,100)||!text(value.title,80)||!text(value.summary,1500)||!Array.isArray(value.tradeoffs)||value.tradeoffs.length>6||!value.tradeoffs.every(t=>text(t,600))||!Array.isArray(value.placements)||value.placements.length>100||!Array.isArray(value.additions)||value.additions.length>5||!Array.isArray(value.removals)||value.removals.length>10)return {issues:[{code:'format',message:'Нужен полный вариант с key, title, summary, tradeoffs, placements, additions, removals.'}]};
  const draft=value as unknown as LayoutDraft,rooms=findRooms(source),selected=rooms.filter(r=>brief.roomIds.includes(r.id));
  const editable=(f:Furniture)=>!FIXED_KINDS.has(f.kind)&&!brief.lockedIds.includes(f.id)&&selected.some(r=>pointInPolygon(f,r.vertices));
  let furniture=structuredClone(source.furniture);const seen=new Set<string>(),changes:string[]=[],specs:PurchaseSpec[]=[],added=new Map<string,Furniture>();
  for(const v of draft.placements){
    if(!object(v)||!text(v.furnitureId,200)||!pose(v)||!text(v.reason,250)){fail('Некорректные координаты или причина перемещения');continue;}
    const old=source.furniture.find(f=>f.id===v.furnitureId);
    if(!old){fail('Неизвестный идентификатор существующего предмета',v.furnitureId);continue;}
    if(seen.has(old.id)){fail('Один предмет перемещён дважды',old.id);continue;}seen.add(old.id);
    const next={...old,x:v.x,y:v.y,rotation:((v.rotation%360)+360)%360};
    if(!same(old,next)&&!editable(old)){fail('Нельзя перемещать закреплённый предмет, коммуникации или мебель из невыбранной комнаты',old.id);continue;}
    if(!selected.some(r=>pointInPolygon(next,r.vertices))){fail('Новое положение должно быть внутри выбранных комнат',old.id);continue;}
    if(same(old,next))continue;
    furniture=furniture.map(f=>f.id===old.id?next:f);
    changes.push(`${old.name}: сдвиг на ${Math.round(distance(old,next))} см${angle(old.rotation,next.rotation)>.5?`, поворот на ${Math.round(angle(old.rotation,next.rotation))}°`:''}. ${v.reason}`);
  }
  let total=0;
  for(const v of draft.additions){
    if(!object(v)||!text(v.key,100)||!text(v.name,100)||!pose(v)||!number(v.width,1000)||v.width<10||!number(v.depth,1000)||v.depth<10||!number(v.budget,1000000)||v.budget<0||!text(v.reason,250)||!text(v.search,600)||!CATALOG.some(c=>c.kind===v.kind)||FIXED_KINDS.has(String(v.kind))){fail('Некорректное описание новой мебели');continue;}
    if(!brief.purchases){fail('Пользователь запретил покупки',v.key);continue;}
    if(added.has(v.key)||source.furniture.some(f=>f.id===v.key)){fail('Повторный ключ нового предмета',v.key);continue;}
    const item:Furniture={id:v.key,kind:v.kind,name:v.name,x:v.x,y:v.y,rotation:((v.rotation%360)+360)%360,width:v.width,depth:v.depth,color:brief.style==='warm'?'#d7bda0':brief.style==='calm'?'#d4d2cb':'#c8b5c9',url:''};
    if(!selected.some(r=>pointInPolygon(item,r.vertices)))fail('Новая мебель должна находиться в выбранной комнате',v.key);
    added.set(v.key,item);furniture.push(item);total+=v.budget;
    specs.push({id:uid(),furnitureId:item.id,name:item.name,width:item.width,depth:item.depth,budget:v.budget,reason:v.reason,search:v.search});
    changes.push(`${item.name}: новый предмет ${item.width} × ${item.depth} см. ${v.reason}`);
  }
  if(total>brief.budget)fail(`Лимиты покупок ${total} ₽ превышают общий бюджет ${brief.budget} ₽`);
  const removed=new Set<string>();
  for(const v of draft.removals){
    if(!object(v)||!text(v.furnitureId,200)||!text(v.reason,250)||!(v.replacementKey===null||text(v.replacementKey,100))){fail('Некорректное описание замены мебели');continue;}
    const old=source.furniture.find(f=>f.id===v.furnitureId);
    if(!old||!editable(old)||seen.has(v.furnitureId)||removed.has(v.furnitureId)){fail('Нельзя удалить этот предмет или одновременно перемещать и удалять его',v.furnitureId);continue;}
    const replacement=v.replacementKey?added.get(v.replacementKey):undefined;
    if(v.replacementKey&&!replacement){fail('Не указан предмет для замены',old.id);continue;}
    if(['bed','sofa'].includes(old.kind)&&replacement?.kind!==old.kind){fail('Спальное или основное место отдыха можно убрать только с заменой того же назначения',old.id);continue;}
    removed.add(old.id);furniture=furniture.filter(f=>f.id!==old.id);changes.push(`${old.name}: ${replacement?`заменён на ${replacement.name}`:'предложено убрать'}. ${v.reason}`);
  }
  if(furniture.length>100)fail('В варианте допускается до 100 предметов');
  if(!changes.length)fail('Вариант не содержит изменений');
  if(changes.length>100)fail('В одном варианте допускается до 100 изменений');
  const plan:Plan={...structuredClone(source),id:uid(),name:draft.title,furniture,improvement:{sourceId:source.id,createdAt:new Date().toISOString(),engine:'agent',title:draft.title,summary:draft.summary,tradeoffs:draft.tradeoffs,changes,purchases:specs,brief:structuredClone(brief)}};
  if(!issues.length){try{parseProject(JSON.stringify({version:1,name:'Проверка',activeId:plan.id,variants:[plan]}));}catch{fail('Вариант не соответствует формату проекта редактора');}}
  if(!issues.length)issues.push(...inspectLayout(plan,brief));
  return {plan,issues};
}
export function draftSignature(source:Plan,plan:Plan):string {return plan.furniture.map(f=>[source.furniture.some(p=>p.id===f.id)?f.id:f.kind,f.kind,f.x,f.y,f.rotation,f.width,f.depth].join(':')).sort().join(';');}
