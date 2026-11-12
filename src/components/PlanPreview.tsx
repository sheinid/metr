import type { Plan } from '../model';
import { findRooms } from '../model';
import { FurnitureGlyph } from './FurnitureGlyph';
import { distance } from '../geometry';
export function PlanPreview({ plan, source }: { plan: Plan; source?: Plan }) {
  const rooms=findRooms(plan),points=Object.keys(plan.nodes).length?Object.values(plan.nodes):[{x:0,y:0},{x:900,y:700}];
  const minX=Math.min(...points.map(p=>p.x))-50,minY=Math.min(...points.map(p=>p.y))-50;
  const width=Math.max(...points.map(p=>p.x))-minX+50,height=Math.max(...points.map(p=>p.y))-minY+50;
  const stroke=Math.max(width,height)/280;
  return <svg className="plan-preview" role="img" aria-label={`Планировка: ${plan.name}`} viewBox={`${minX} ${minY} ${width} ${height}`}>
    {rooms.map(r=><polygon key={r.id} points={r.vertices.map(p=>`${p.x},${p.y}`).join(' ')} fill={r.label?.color??'#efeee8'}/>)}
    {plan.furniture.map(f=>{const old=source?.furniture.find(p=>p.id===f.id),changed=source&&(!old||distance(old,f)>10||Math.abs(old.rotation-f.rotation)>5);return <g key={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}><FurnitureGlyph item={f}/>{changed&&<rect x={-f.width/2-5} y={-f.depth/2-5} width={f.width+10} height={f.depth+10} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeDasharray={`${stroke*3} ${stroke*2}`} rx={3}/>}</g>;})}
    {plan.walls.map(w=><line key={w.id} x1={plan.nodes[w.a].x} y1={plan.nodes[w.a].y} x2={plan.nodes[w.b].x} y2={plan.nodes[w.b].y} stroke="#464a43" strokeWidth={w.thickness} strokeLinecap="square"/>)}
    {plan.openings.map(o=>{const w=plan.walls.find(w=>w.id===o.wallId)!,a=plan.nodes[w.a],b=plan.nodes[w.b],angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;return <g key={o.id} transform={`translate(${a.x+(b.x-a.x)*o.t} ${a.y+(b.y-a.y)*o.t}) rotate(${angle})`}><rect x={-o.width/2} y={-w.thickness/2-1} width={o.width} height={w.thickness+2} fill="#fafafa"/>{o.kind==='window'?<path d={`M${-o.width/2} 0H${o.width/2}`} stroke="#71878b" strokeWidth={3}/>:<path d={`M${-o.width/2} 0v${o.width*o.swing}M${o.width/2} 0A${o.width} ${o.width} 0 0 ${o.swing===1?1:0} ${-o.width/2} ${o.width*o.swing}`} fill="none" stroke="#7b7c72" strokeWidth={stroke*.65}/>}</g>;})}
  </svg>;
}
