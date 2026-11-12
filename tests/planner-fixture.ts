import { emptyPlan, addWall, findRooms, newFurniture } from '../src/model.ts';
import { defaultBrief } from '../src/planner/validation.ts';
import type { LayoutDraft } from '../server/layout-draft.ts';
export function fixture(){
  let plan=emptyPlan();const p=[{x:0,y:0},{x:500,y:0},{x:500,y:400},{x:0,y:400}];
  for(let i=0;i<4;i++)plan=addWall(plan,p[i],p[(i+1)%4]);
  const wall=plan.walls.find(w=>plan.nodes[w.a].y===400&&plan.nodes[w.b].y===400)!;
  plan.openings=[{id:'entry',wallId:wall.id,kind:'door',t:.5,width:80,swing:1}];
  plan.furniture=[{...newFurniture('sofa',{x:150,y:100}),width:200,depth:80}];
  const brief={...defaultBrief(plan),goals:['work'] as const,budget:25000};
  return {plan,brief:{...brief,goals:[...brief.goals]},room:findRooms(plan)[0]};
}
export function draft():LayoutDraft{return {key:'workspace',title:'Работа у окна',summary:'Рабочее место отделено от дивана.',tradeoffs:['Розетки нужно проверить.'],placements:[],removals:[],additions:[{key:'desk-window',kind:'desk',name:'Стол',x:400.7,y:50,rotation:0,width:100,depth:50,budget:10000,reason:'Отдельное место для работы.',search:'Письменный стол 100х50 дерево'}]};}
