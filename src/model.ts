import { distance, intersection, polygonArea, polygonInteriorPoint, projectPoint, samePoint, uid, clamp, pointInPolygon } from './geometry.ts';
import type { Point } from './geometry.ts';

export interface Wall { id: string; a: string; b: string; thickness: number }
export interface Opening { id: string; wallId: string; kind: 'door' | 'window'; t: number; width: number; swing: 1 | -1 }
export type FurnitureKind = 'sofa' | 'bed' | 'table' | 'dining' | 'chair' | 'wardrobe' | 'kitchen' | 'fridge' | 'bath' | 'toilet' | 'sink' | 'plant';
export interface Furniture { id: string; kind: FurnitureKind; name: string; x: number; y: number; width: number; depth: number; rotation: number; color: string; url: string }
export interface RoomLabel { id: string; x: number; y: number; name: string; color: string }
export interface Background { src: string; x: number; y: number; width: number; height: number; opacity: number }
export interface Plan { id: string; name: string; nodes: Record<string, Point>; walls: Wall[]; openings: Opening[]; furniture: Furniture[]; labels: RoomLabel[]; background?: Background }
export interface Project { version: 1; name: string; activeId: string; variants: Plan[] }
export interface Room { id: string; vertices: Point[]; nodeIds: string[]; area: number; center: Point; label?: RoomLabel }
export type Selection = { kind: 'wall' | 'opening' | 'furniture' | 'room'; id: string } | null;
export type Tool = 'select' | 'wall' | 'door' | 'window' | 'measure' | 'pan' | 'calibrate';
export const PALETTE = ['#d7bda0', '#b7c9b4', '#aebfc9', '#c8b5c9', '#e4d7b8', '#d4d2cb'];
export const CATALOG: { kind: FurnitureKind; name: string; width: number; depth: number; color: string; category: string }[] = [
  { kind: 'sofa', name: 'Диван', width: 240, depth: 95, color: '#b7c9b4', category: 'Гостиная' },
  { kind: 'table', name: 'Журнальный стол', width: 110, depth: 60, color: '#d7bda0', category: 'Гостиная' },
  { kind: 'chair', name: 'Кресло', width: 80, depth: 80, color: '#c8b5c9', category: 'Гостиная' },
  { kind: 'plant', name: 'Растение', width: 50, depth: 50, color: '#a5bda0', category: 'Гостиная' },
  { kind: 'bed', name: 'Кровать', width: 160, depth: 200, color: '#aebfc9', category: 'Спальня' },
  { kind: 'wardrobe', name: 'Шкаф', width: 180, depth: 60, color: '#d7bda0', category: 'Спальня' },
  { kind: 'dining', name: 'Обеденный стол', width: 140, depth: 85, color: '#d7bda0', category: 'Кухня' },
  { kind: 'kitchen', name: 'Кухонный модуль', width: 180, depth: 60, color: '#d4d2cb', category: 'Кухня' },
  { kind: 'fridge', name: 'Холодильник', width: 60, depth: 65, color: '#d4d2cb', category: 'Кухня' },
  { kind: 'bath', name: 'Ванна', width: 75, depth: 170, color: '#c5d7d9', category: 'Ванная' },
  { kind: 'toilet', name: 'Унитаз', width: 40, depth: 65, color: '#dce4e1', category: 'Ванная' },
  { kind: 'sink', name: 'Раковина', width: 60, depth: 45, color: '#dce4e1', category: 'Ванная' },
];
export function emptyPlan(name = 'Вариант 1'): Plan { return { id: uid(), name, nodes: {}, walls: [], openings: [], furniture: [], labels: [] }; }
export function activePlan(project: Project) { return project.variants.find(v => v.id === project.activeId) ?? project.variants[0]; }
export function updatePlan(project: Project, fn: (plan: Plan) => Plan): Project { return { ...project, variants: project.variants.map(v => v.id === project.activeId ? fn(v) : v) }; }
export function duplicateVariant(project: Project, name: string): Project {
  const plan = structuredClone(activePlan(project)); plan.id = uid(); plan.name = name;
  return { ...project, activeId: plan.id, variants: [...project.variants, plan] };
}
export function findRooms(plan: Plan): Room[] {
  const adjacency: Record<string, string[]> = Object.create(null);
  for (const wall of plan.walls) {
    (adjacency[wall.a] ??= []).push(wall.b); (adjacency[wall.b] ??= []).push(wall.a);
  }
  for (const [id, neighbors] of Object.entries(adjacency)) {
    const p = plan.nodes[id];
    neighbors.sort((a, b) => Math.atan2(plan.nodes[a].y - p.y, plan.nodes[a].x - p.x) - Math.atan2(plan.nodes[b].y - p.y, plan.nodes[b].x - p.x));
  }
  const visited = new Set<string>(), rooms: Room[] = [];
  for (const wall of plan.walls) for (const [start, next] of [[wall.a, wall.b], [wall.b, wall.a]]) {
    if (visited.has(`${start}>${next}`)) continue;
    const ids: string[] = []; let from = start, to = next, closed = false;
    for (let step = 0; step <= plan.walls.length * 2; step++) {
      const key = `${from}>${to}`;
      if (visited.has(key)) { closed = from === start && to === next; break; }
      visited.add(key); ids.push(from);
      const neighbors = adjacency[to], index = neighbors.indexOf(from);
      const following = neighbors[(index - 1 + neighbors.length) % neighbors.length];
      from = to; to = following;
    }
    const vertices = ids.map(id => plan.nodes[id]), area = polygonArea(vertices);
    if (closed && area > 100) {
      const center = polygonInteriorPoint(vertices);
      rooms.push({ id: [...ids].sort().join('|'), vertices, nodeIds: ids, area, center, label: plan.labels.find(l => pointInPolygon(l, vertices)) });
    }
  }
  return rooms;
}
export function addWall(source: Plan, a: Point, b: Point, thickness = 14): Plan {
  if (distance(a, b) < 10) return source;
  const plan = structuredClone(source);
  const nodeAt = (p: Point) => {
    const existing = Object.entries(plan.nodes).find(([, n]) => samePoint(n, p));
    if (existing) return existing[0];
    const id = uid(); plan.nodes[id] = { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }; return id;
  };
  const candidatePoints: Point[] = [a, b], rebuilt: Wall[] = [], openings: Opening[] = [];
  for (const wall of source.walls) {
    const c = source.nodes[wall.a], d = source.nodes[wall.b], points = [c, d];
    const crossing = intersection(a, b, c, d);
    if (crossing) { points.push(crossing); candidatePoints.push(crossing); }
    for (const p of [a, b]) if (projectPoint(p, c, d).distance < 0.1) points.push(p);
    for (const p of [c, d]) if (projectPoint(p, a, b).distance < 0.1) candidatePoints.push(p);
    const sorted = points.map(p => ({ p, t: projectPoint(p, c, d).t })).sort((l, r) => l.t - r.t).filter((entry, i, arr) => !i || entry.t - arr[i - 1].t > 1e-6);
    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i], hi = sorted[i + 1], length = distance(lo.p, hi.p);
      const id = i === 0 ? wall.id : uid();
      rebuilt.push({ ...wall, id, a: nodeAt(lo.p), b: nodeAt(hi.p) });
      for (const o of source.openings.filter(o => o.wallId === wall.id)) {
        if (o.t >= lo.t && (o.t < hi.t || i === sorted.length - 2) && length >= 25) {
          const width = Math.min(o.width, length - 4), margin = width / (2 * length) + 1 / length;
          openings.push({ ...o, wallId: id, width, t: clamp((o.t - lo.t) / (hi.t - lo.t), margin, 1 - margin) });
        }
      }
    }
  }
  const sorted = candidatePoints.map(p => ({ p, t: projectPoint(p, a, b).t })).sort((l, r) => l.t - r.t).filter((entry, i, arr) => !i || entry.t - arr[i - 1].t > 1e-6);
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i].p, end = sorted[i + 1].p;
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (distance(start, end) < 0.1 || rebuilt.some(w => projectPoint(middle, plan.nodes[w.a], plan.nodes[w.b]).distance < 0.1)) continue;
    rebuilt.push({ id: uid(), a: nodeAt(start), b: nodeAt(end), thickness });
  }
  plan.walls = rebuilt; plan.openings = openings; return plan;
}
export function removeSelection(plan: Plan, selection: Selection): Plan {
  if (!selection) return plan;
  const next = structuredClone(plan);
  if (selection.kind === 'wall') {
    next.walls = next.walls.filter(w => w.id !== selection.id);
    next.openings = next.openings.filter(o => o.wallId !== selection.id);
    const used = new Set(next.walls.flatMap(w => [w.a, w.b]));
    Object.keys(next.nodes).forEach(id => { if (!used.has(id)) delete next.nodes[id]; });
  }
  if (selection.kind === 'furniture') next.furniture = next.furniture.filter(f => f.id !== selection.id);
  if (selection.kind === 'opening') next.openings = next.openings.filter(o => o.id !== selection.id);
  return next;
}
export function resizeWall(plan: Plan, wallId: string, length: number): Plan {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall || length < 10 || !Number.isFinite(length)) return plan;
  const a = plan.nodes[wall.a], b = plan.nodes[wall.b], current = distance(a, b);
  if (current < 0.1) return plan;
  return moveNodes(plan, { [wall.b]: { x: a.x + (b.x - a.x) * length / current, y: a.y + (b.y - a.y) * length / current } });
}
export function openingsOverlap(plan: Plan): boolean {
  return plan.openings.some((a, index) => plan.openings.slice(index + 1).some(b => {
    if (a.wallId !== b.wallId) return false;
    const wall = plan.walls.find(w => w.id === a.wallId); if (!wall) return false;
    return Math.abs(a.t - b.t) * distance(plan.nodes[wall.a], plan.nodes[wall.b]) < (a.width + b.width) / 2 + 1;
  }));
}
export function moveNodes(plan: Plan, changes: Record<string, Point>): Plan {
  if (Object.values(changes).some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000)) return plan;
  const nodes = { ...plan.nodes, ...changes };
  if (plan.walls.some(w => distance(nodes[w.a], nodes[w.b]) < 10)) return plan;
  const candidate = fitOpenings({ ...plan, nodes });
  return openingsOverlap(candidate) || candidate.openings.length !== plan.openings.length || candidate.openings.some(o => o.width !== plan.openings.find(original => original.id === o.id)?.width) ? plan : candidate;
}
export function mergeCoincidentNodes(plan: Plan): Plan {
  const nodes: Record<string, Point> = {}, aliases: Record<string, string> = {};
  for (const [id, p] of Object.entries(plan.nodes)) {
    const match = Object.entries(nodes).find(([, q]) => samePoint(p, q));
    if (match) aliases[id] = match[0]; else { nodes[id] = p; aliases[id] = id; }
  }
  const walls: Wall[] = [], wallAliases: Record<string, { id: string; reverse: boolean }> = {};
  for (const wall of plan.walls) {
    const next = { ...wall, a: aliases[wall.a], b: aliases[wall.b] };
    if (next.a === next.b) continue;
    const existing = walls.find(w => w.a === next.a && w.b === next.b || w.a === next.b && w.b === next.a);
    if (existing) wallAliases[wall.id] = { id: existing.id, reverse: existing.a !== next.a }; else walls.push(next);
  }
  const candidate = { ...plan, nodes, walls, openings: plan.openings.map(o => wallAliases[o.wallId] ? { ...o, wallId: wallAliases[o.wallId].id, t: wallAliases[o.wallId].reverse ? 1 - o.t : o.t } : o) };
  return openingsOverlap(candidate) ? plan : candidate;
}
export function fitOpenings(plan: Plan): Plan {
  const openings: Opening[] = [];
  for (const o of plan.openings) {
    const wall = plan.walls.find(w => w.id === o.wallId);
    if (!wall) continue;
    const length = distance(plan.nodes[wall.a], plan.nodes[wall.b]);
    if (length < 25) continue;
    const width = Math.min(o.width, length - 4), margin = width / (2 * length) + 1 / length;
    openings.push({ ...o, width, t: clamp(o.t, margin, 1 - margin) });
  }
  return { ...plan, openings };
}
export function addOpening(plan: Plan, kind: 'door' | 'window', p: Point): { plan: Plan; id?: string; error?: string } {
  const nearest = plan.walls.map(wall => ({ wall, ...projectPoint(p, plan.nodes[wall.a], plan.nodes[wall.b]) })).sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || nearest.distance > 35) return { plan, error: 'Нажмите на стену, чтобы добавить проём' };
  const length = distance(plan.nodes[nearest.wall.a], plan.nodes[nearest.wall.b]);
  if (length < 35) return { plan, error: 'Эта стена слишком короткая для проёма' };
  const width = Math.min(kind === 'door' ? 85 : 140, length - 10), margin = (width / 2 + 2) / length;
  const t = clamp(nearest.t, margin, 1 - margin);
  if (plan.openings.some(o => o.wallId === nearest.wall.id && Math.abs(o.t - t) * length < (o.width + width) / 2 + 4)) return { plan, error: 'Здесь уже есть проём. Выберите другое место' };
  const id = uid(); return { plan: { ...plan, openings: [...plan.openings, { id, kind, wallId: nearest.wall.id, t, width, swing: 1 }] }, id };
}
export function newFurniture(kind: FurnitureKind, p: Point): Furniture {
  const source = CATALOG.find(c => c.kind === kind)!;
  return { id: uid(), kind, name: source.name, width: source.width, depth: source.depth, color: source.color, x: p.x, y: p.y, rotation: 0, url: '' };
}
export function demoProject(): Project {
  const nodes: Record<string, Point> = { a: { x: 0, y: 0 }, b: { x: 540, y: 0 }, c: { x: 900, y: 0 }, d: { x: 900, y: 360 }, e: { x: 900, y: 700 }, f: { x: 540, y: 700 }, g: { x: 0, y: 700 }, h: { x: 0, y: 450 }, i: { x: 540, y: 450 }, j: { x: 540, y: 360 }, k: { x: 720, y: 450 }, l: { x: 720, y: 700 }, r: { x: 900, y: 450 } };
  const edges = [['a','b'],['b','c'],['c','d'],['d','r'],['r','e'],['e','l'],['l','f'],['f','g'],['g','h'],['h','a'],['b','j'],['j','i'],['i','f'],['h','i'],['j','d'],['k','r'],['k','l']];
  const walls = edges.map(([a,b], index) => ({ id: `w${index}`, a, b, thickness: index < 10 ? 18 : 12 }));
  const openings: Opening[] = [
    { id: 'o1', wallId: 'w0', kind: 'window', t: 0.48, width: 220, swing: 1 },
    { id: 'o2', wallId: 'w1', kind: 'window', t: 0.5, width: 150, swing: 1 },
    { id: 'o3', wallId: 'w2', kind: 'window', t: 0.5, width: 140, swing: 1 },
    { id: 'o4', wallId: 'w8', kind: 'window', t: 0.5, width: 120, swing: 1 },
    { id: 'o5', wallId: 'w11', kind: 'door', t: 0.5, width: 80, swing: 1 },
    { id: 'o6', wallId: 'w13', kind: 'door', t: 0.8, width: 85, swing: -1 },
    { id: 'o7', wallId: 'w14', kind: 'door', t: 0.35, width: 85, swing: -1 },
    { id: 'o8', wallId: 'w16', kind: 'door', t: 0.35, width: 70, swing: -1 },
    { id: 'o9', wallId: 'w6', kind: 'door', t: 0.5, width: 90, swing: 1 },
  ];
  const item = (kind: FurnitureKind, x: number, y: number, overrides: Partial<Furniture> = {}) => ({ ...newFurniture(kind, { x, y }), ...overrides });
  const plan: Plan = { id: uid(), name: 'Основной', nodes, walls, openings, labels: [
    { id: 'living', x: 270, y: 395, name: 'Гостиная', color: '#f2eee5' },
    { id: 'bedroom', x: 720, y: 92, name: 'Спальня', color: '#eaf0ec' },
    { id: 'kitchen', x: 165, y: 550, name: 'Кухня', color: '#f4ede3' },
    { id: 'bathroom', x: 770, y: 555, name: 'Ванная', color: '#e9eff1' },
    { id: 'hall', x: 630, y: 550, name: 'Прихожая', color: '#f0eee9' },
  ], furniture: [
    item('sofa', 200, 145), item('table', 200, 275), item('wardrobe', 490, 180, { width: 180, depth: 35, rotation: 90, name: 'Тумба под ТВ' }),
    item('plant', 65, 65), item('chair', 390, 300, { rotation: -25 }),
    item('bed', 720, 220), item('wardrobe', 720, 35, { width: 220 }),
    item('table', 610, 145, { width: 40, depth: 40, name: 'Тумбочка' }),
    item('kitchen', 240, 660, { width: 350 }), item('fridge', 65, 535), item('dining', 320, 565),
    item('bath', 850, 560, { width: 65, depth: 155 }), item('toilet', 760, 630, { rotation: 0 }),
    item('sink', 765, 475, { width: 65, depth: 40 }),
  ] };
  return { version: 1, name: 'Квартира на двоих', activeId: plan.id, variants: [plan] };
}
