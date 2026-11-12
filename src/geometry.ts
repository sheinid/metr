export interface Point { x: number; y: number }
export interface Segment { a: Point; b: Point }
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const round = (n: number, step = 1) => Number((Math.round(n / step) * step).toFixed(6));
export const uid = () => crypto.randomUUID();
export const samePoint = (a: Point, b: Point, tolerance = 0.1) => distance(a, b) < tolerance;
export function projectPoint(p: Point, a: Point, b: Point) {
  const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length2 ? clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length2, 0, 1) : 0;
  const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { ...point, t, distance: distance(p, point) };
}
export function intersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-8) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / cross;
  return t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7
    ? { x: a.x + t * rx, y: a.y + t * ry } : null;
}
export function polygonArea(points: Point[]) {
  return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
}
export function polygonCenter(points: Point[]): Point {
  const area = polygonArea(points);
  if (Math.abs(area) < 0.1) return points[0] ?? { x: 0, y: 0 };
  let x = 0, y = 0;
  points.forEach((p, i) => { const q = points[(i + 1) % points.length], f = p.x * q.y - q.x * p.y; x += (p.x + q.x) * f; y += (p.y + q.y) * f; });
  return { x: x / (6 * area), y: y / (6 * area) };
}
export function pointInPolygon(p: Point, vertices: Point[]) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function furnitureBounds(item: { x: number; y: number; width: number; depth: number; rotation: number }) {
  const angle = item.rotation * Math.PI / 180;
  return { width: Math.abs(Math.cos(angle)) * item.width + Math.abs(Math.sin(angle)) * item.depth,
    height: Math.abs(Math.sin(angle)) * item.width + Math.abs(Math.cos(angle)) * item.depth };
}
export const meters = (cm: number, digits = 2) => (cm / 100).toLocaleString('ru-RU', { maximumFractionDigits: digits });
export const squareMeters = (cm2: number) => (cm2 / 10000).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export function polygonInteriorPoint(points: Point[]): Point {
  const center = polygonCenter(points);
  if (pointInPolygon(center, points)) return center;
  const levels = [...new Set(points.map(p => p.y))].sort((a,b) => a - b);
  let best = points[0] ?? { x: 0, y: 0 }, clearance = -1;
  for (let i = 0; i < levels.length - 1; i++) {
    const y = (levels[i] + levels[i + 1]) / 2, crossings: number[] = [];
    points.forEach((a, index) => { const b = points[(index + 1) % points.length]; if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); });
    crossings.sort((a,b) => a - b);
    for (let j = 0; j < crossings.length - 1; j += 2) {
      const p = { x: (crossings[j] + crossings[j + 1]) / 2, y };
      const score = Math.min(...points.map((a, k) => projectPoint(p, a, points[(k + 1) % points.length]).distance));
      if (score > clearance) { best = p; clearance = score; }
    }
  }
  return best;
}
export function plural(n: number, one: string, few: string, many: string) {
  const last = Math.abs(n) % 100;
  return last > 10 && last < 20 ? many : last % 10 === 1 ? one : last % 10 >= 2 && last % 10 <= 4 ? few : many;
}
