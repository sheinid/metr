import type { Project, Plan, FurnitureKind } from './model.ts';
import { CATALOG } from './model.ts';

export const STORAGE_KEY = 'metr.project.v1';
const finite = (v: unknown, min = -100000, max = 100000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const kinds = new Set(CATALOG.map(c => c.kind));
function validPlan(value: unknown): value is Plan {
  if (!object(value) || !text(value.id) || !text(value.name) || !object(value.nodes)) return false;
  if (!Array.isArray(value.walls) || !Array.isArray(value.openings) || !Array.isArray(value.furniture) || !Array.isArray(value.labels)) return false;
  if (Object.keys(value.nodes).length > 10000 || value.walls.length > 5000 || value.furniture.length > 3000 || value.openings.length > 3000 || value.labels.length > 2000) return false;
  const nodes = value.nodes;
  if (!Object.entries(nodes).every(([id, p]) => text(id) && object(p) && finite(p.x) && finite(p.y))) return false;
  const wallIds = new Set<string>();
  for (const w of value.walls) {
    if (!object(w) || !text(w.id) || wallIds.has(w.id) || !text(w.a) || !text(w.b) || w.a === w.b || !Object.hasOwn(nodes, w.a) || !Object.hasOwn(nodes, w.b) || !finite(w.thickness, 1, 200)) return false;
    const a = nodes[w.a] as { x: number; y: number }, b = nodes[w.b] as { x: number; y: number };
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.1) return false;
    wallIds.add(w.id);
  }
  const openingIds = new Set<string>();
  for (const o of value.openings) {
    if (!object(o) || !text(o.id) || openingIds.has(o.id) || !text(o.wallId) || !wallIds.has(o.wallId) || !['door', 'window'].includes(String(o.kind)) || !finite(o.width, 1, 10000) || !finite(o.t, 0, 1) || ![1, -1].includes(Number(o.swing))) return false;
    const w = value.walls.find(w => (w as { id: string }).id === o.wallId) as { a: string; b: string };
    const a = nodes[w.a] as { x: number; y: number }, b = nodes[w.b] as { x: number; y: number };
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    if (o.width > length || o.t * length < o.width / 2 - 0.1 || (1 - o.t) * length < o.width / 2 - 0.1) return false;
    openingIds.add(o.id);
  }
  const furnitureIds = new Set<string>();
  for (const f of value.furniture) {
    if (!object(f) || !text(f.id) || furnitureIds.has(f.id) || !kinds.has(f.kind as FurnitureKind) || !text(f.name) || !finite(f.x) || !finite(f.y) || !finite(f.width, 1, 10000) || !finite(f.depth, 1, 10000) || !finite(f.rotation, -36000, 36000) || !color(f.color) || !text(f.url, 3000)) return false;
    furnitureIds.add(f.id);
  }
  const labelIds = new Set<string>();
  for (const l of value.labels) {
    if (!object(l) || !text(l.id) || labelIds.has(l.id) || !text(l.name) || !finite(l.x) || !finite(l.y) || !color(l.color)) return false;
    labelIds.add(l.id);
  }
  const bg = value.background;
  if (bg !== undefined && (!object(bg) || typeof bg.src !== 'string' || bg.src.length > 15000000 || !/^data:image\/(png|jpeg|webp);base64,/.test(bg.src) || !finite(bg.x) || !finite(bg.y) || !finite(bg.width, 1) || !finite(bg.height, 1) || !finite(bg.opacity, 0, 1))) return false;
  return true;
}
export function parseProject(raw: string): Project {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Не удалось прочитать JSON. Выберите файл проекта .metr.json'); }
  if (!object(value) || value.version !== 1 || !text(value.name) || !text(value.activeId) || !Array.isArray(value.variants) || !value.variants.length || value.variants.length > 30 || !value.variants.every(validPlan)) throw new Error('Файл не похож на проект «Метра» или содержит некорректную геометрию');
  const ids = value.variants.map(v => v.id);
  if (new Set(ids).size !== ids.length || !ids.includes(value.activeId)) throw new Error('В файле некорректный список вариантов');
  return value as unknown as Project;
}
export function safeUrl(url: string): string | undefined {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}
export function downloadFile(content: Blob | string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
