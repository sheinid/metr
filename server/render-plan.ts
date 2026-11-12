import { Resvg } from '@resvg/resvg-js';
import type { Plan } from '../src/model.ts';
import { pointInPolygon } from '../src/geometry.ts';
import { findRooms } from '../src/model.ts';
import { accessDiagnostics, itemPolygon } from '../src/planner/validation.ts';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function planDiagramSvg(plan:Plan):string {
  const points=[...Object.values(plan.nodes),...plan.furniture];
  const left=Math.min(...points.map(p=>p.x))-100,top=Math.min(...points.map(p=>p.y))-100;
  const width=Math.max(...points.map(p=>p.x))-left+100,height=Math.max(...points.map(p=>p.y))-top+100;
  const shapes:string[]=[];
  for(const room of findRooms(plan))shapes.push(`<polygon points="${room.vertices.map(p=>`${p.x},${p.y}`).join(' ')}" fill="${room.label?.color??'#f3f3f0'}"/>`);
  for(const f of plan.furniture)shapes.push(`<polygon points="${itemPolygon(f,30).map(p=>`${p.x},${p.y}`).join(' ')}" fill="#64748b" fill-opacity=".07" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 4"/>`);
  for(const f of plan.furniture){const room=findRooms(plan).find(r=>pointInPolygon(f,r.vertices));if(!room)continue;for(const zone of accessDiagnostics(plan,f,room).zones)shapes.push(`<polygon points="${zone.polygon.map(p=>`${p.x},${p.y}`).join(' ')}" fill="#dbeafe" fill-opacity=".2" stroke="#94a3b8" stroke-width="1" stroke-dasharray="5 5"/>`);}
  plan.furniture.forEach((f,i)=>shapes.push(`<g transform="translate(${f.x} ${f.y}) rotate(${f.rotation})"><rect x="${-f.width/2}" y="${-f.depth/2}" width="${f.width}" height="${f.depth}" rx="4" fill="${f.color}" stroke="#475569" stroke-width="2"/><path d="M${-f.width/2+5} ${-f.depth/2+5}h${f.width-10}" stroke="#334155" stroke-width="5"/><path d="M0 0v${f.depth/2-3}m-6 -8l6 8 6 -8" fill="none" stroke="#334155" stroke-width="2"/><text transform="rotate(${-f.rotation})" text-anchor="middle" dominant-baseline="middle" font-size="19" fill="#0f172a" stroke="#ffffff" stroke-width="3" paint-order="stroke">${i+1}</text></g>`));
  for(const w of plan.walls){const a=plan.nodes[w.a],b=plan.nodes[w.b];shapes.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#333b35" stroke-width="${w.thickness}"/>`);}
  for(const o of plan.openings){const w=plan.walls.find(w=>w.id===o.wallId)!,a=plan.nodes[w.a],b=plan.nodes[w.b],angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;shapes.push(`<g transform="translate(${a.x+(b.x-a.x)*o.t} ${a.y+(b.y-a.y)*o.t}) rotate(${angle})"><rect x="${-o.width/2}" y="${-w.thickness/2-1}" width="${o.width}" height="${w.thickness+2}" fill="#fff"/>${o.kind==='window'?`<path d="M${-o.width/2} 0h${o.width}" stroke="#0284c7" stroke-width="4"/>`:`<path d="M${-o.width/2} 0v${o.width*o.swing}M${o.width/2} 0A${o.width} ${o.width} 0 0 ${o.swing===1?1:0} ${-o.width/2} ${o.width*o.swing}" fill="none" stroke="#64748b" stroke-width="2"/>`}</g>`);}
  for(const room of findRooms(plan))shapes.push(`<text x="${room.label?.x??room.center.x}" y="${room.label?.y??room.center.y}" font-size="17" fill="#334155" text-anchor="middle">${escape(room.label?.name??'Комната')}</text>`);
  const legend=plan.furniture.slice(0,28).map((f,i)=>`<text x="1030" y="${60+i*31}" font-size="15" fill="#0f172a">${i+1}. ${escape(f.name.slice(0,29))} · ${f.width}×${f.depth} · ${f.rotation}°</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" font-family="Arial, sans-serif"><rect width="1400" height="1000" fill="white"/><svg width="1000" height="1000" viewBox="${left} ${top} ${width} ${height}">${shapes.join('')}</svg><text x="1030" y="25" font-size="18">Размеры в сантиметрах</text>${legend}<text x="1030" y="930" font-size="14">Серый пунктир: отступ 30 см от мебели.</text><text x="1030" y="955" font-size="14">Синий пунктир: место использования.</text><text x="1030" y="980" font-size="14">Стрелка показывает переднюю сторону.</text></svg>`;
}
export function renderPlan(plan:Plan):Uint8Array {
  return new Resvg(planDiagramSvg(plan),{font:{loadSystemFonts:true,defaultFontFamily:'Arial'}}).render().asPng();
}
