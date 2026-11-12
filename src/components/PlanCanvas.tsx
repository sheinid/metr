import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Crosshair, Minus, Plus, Maximize2, MousePointer2 } from 'lucide-react';
import type { Plan, Selection, Tool, Furniture, FurnitureKind, Opening } from '../model';
import type { Point } from '../geometry';
import { CATALOG, addOpening, addWall, findRooms, fitOpenings, newFurniture, moveNodes, mergeCoincidentNodes, openingsOverlap } from '../model';
import { clamp, distance, furnitureBounds, meters, projectPoint, round, squareMeters, plural } from '../geometry';
import { FurnitureGlyph } from './FurnitureGlyph';
import { IconButton } from './EditorControls';

export interface CatalogPointer { clientX: number; clientY: number; altKey?: boolean }
export interface CanvasHandle {
  fit: () => void; center: () => Point; exportSvg: () => string; exportPng: () => Promise<Blob>;
  previewFurniture: (kind: FurnitureKind, point: CatalogPointer) => boolean;
  dropFurniture: (kind: FurnitureKind, point: CatalogPointer) => boolean;
  cancelFurniturePreview: () => void;
}
interface Props {
  plan: Plan; ghost?: Plan; tool: Tool; selection: Selection; grid: boolean; dimensions: boolean; snap: boolean;
  onSelect: (selection: Selection) => void; onChange: (fn: (plan: Plan) => Plan, record?: boolean) => void;
  onBegin: () => void; onEnd: () => void; onNotice: (message: string) => void;
  onCalibrate: (a: Point, b: Point) => void;
}
interface View { x: number; y: number; zoom: number }
type Drag = { type: 'pan'; screen: Point; view: View } | { type: 'furniture' | 'wall' | 'node' | 'opening' | 'resize' | 'rotate'; id: string; start: Point; base: Plan; handle?: Point };
function planBounds(plan: Plan) {
  const points = [...Object.values(plan.nodes), ...plan.furniture.flatMap(f => { const b = furnitureBounds(f); return [{ x: f.x - b.width / 2, y: f.y - b.height / 2 }, { x: f.x + b.width / 2, y: f.y + b.height / 2 }]; })];
  if (plan.background) points.push({ x: plan.background.x, y: plan.background.y }, { x: plan.background.x + plan.background.width, y: plan.background.y + plan.background.height });
  return points.length ? { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) } : { minX: 0, minY: 0, maxX: 900, maxY: 700 };
}
function Dimension({ a, b, offset = 0, zoom = 1, color = '#656b73', label }: { a: Point; b: Point; offset?: number; zoom?: number; color?: string; label?: string }) {
  const length = distance(a, b); if (length < 1) return null;
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const flip = angle > 90 || angle < -90;
  return <g transform={`translate(${a.x} ${a.y}) rotate(${angle})`} pointerEvents="none" stroke={color} strokeWidth={.8 / zoom}>
    <path d={`M0 ${offset - 7 / zoom}v${14 / zoom}M${length} ${offset - 7 / zoom}v${14 / zoom}M0 ${offset}H${length}`} fill="none"/>
    {offset !== 0 && <path d={`M0 0V${offset}M${length} 0V${offset}`} strokeDasharray={`${3 / zoom} ${4 / zoom}`} opacity={.5}/>}
    <g transform={`translate(${length / 2} ${offset - 7 / zoom})${flip ? ' rotate(180)' : ''}`}><rect x={-36 / zoom} y={-12 / zoom} width={72 / zoom} height={17 / zoom} fill="#fafafa" stroke="none" rx={3 / zoom}/><text textAnchor="middle" fill={color} stroke="none" fontSize={11 / zoom} fontFamily="inherit">{label ?? `${meters(length)} м`}</text></g>
  </g>;
}
function OpeningShape({ opening: o, plan, selected, zoom }: { opening: Opening; plan: Plan; selected?: boolean; zoom: number }) {
  const wall = plan.walls.find(w => w.id === o.wallId); if (!wall) return null;
  const a = plan.nodes[wall.a], b = plan.nodes[wall.b], angle = Math.atan2(b.y - a.y, b.x - a.x), length = distance(a, b);
  const start = { x: a.x + Math.cos(angle) * (length * o.t - o.width / 2), y: a.y + Math.sin(angle) * (length * o.t - o.width / 2) };
  return <g data-kind="opening" data-id={o.id} transform={`translate(${start.x} ${start.y}) rotate(${angle * 180 / Math.PI})`} style={{ cursor: 'pointer' }}>
    <rect x={-1} y={-wall.thickness / 2 - 1} width={o.width + 2} height={wall.thickness + 2} fill="#fafafa"/>
    {o.kind === 'window' ? <g fill="none" stroke={selected ? 'var(--accent)' : '#71878b'} strokeWidth={selected ? 2.5 : 1.5}><rect width={o.width} y={-wall.thickness / 2 + 2} height={wall.thickness - 4}/><path d={`M0 0H${o.width}M${o.width / 2} ${-wall.thickness / 2}v${wall.thickness}`}/></g> : <g fill="none" stroke={selected ? 'var(--accent)' : '#7b7c72'} strokeWidth={1.3}><path d={`M0 0V${o.width * o.swing}`} strokeWidth={3}/><path d={`M${o.width} 0A${o.width} ${o.width} 0 0 ${o.swing === 1 ? 1 : 0} 0 ${o.width * o.swing}`} strokeDasharray="3 3"/></g>}
    <rect data-editor-only="true" x={-3} y={-Math.max(wall.thickness / 2, 9 / zoom)} width={o.width + 6} height={Math.max(wall.thickness, 18 / zoom)} fill="transparent" stroke={selected ? 'var(--accent)' : 'none'} strokeWidth={1.5 / zoom} rx={2}/>
  </g>;
}
export const PlanCanvas = forwardRef<CanvasHandle, Props>(function PlanCanvas(props, forwardedRef) {
  const { plan, ghost, tool, selection, grid, dimensions, snap, onSelect, onChange, onBegin, onEnd, onNotice, onCalibrate } = props;
  const svgRef = useRef<SVGSVGElement>(null), containerRef = useRef<HTMLDivElement>(null), planRef = useRef(plan), drag = useRef<Drag | null>(null);
  planRef.current = plan;
  const [view, setView] = useState<View>({ x: 80, y: 80, zoom: .65 });
  const [size, setSize] = useState({ width: 1000, height: 800 });
  const [anchor, setAnchor] = useState<Point | null>(null), [hover, setHover] = useState<Point | null>(null);
  const [measurement, setMeasurement] = useState<{ a: Point; b: Point } | null>(null), [space, setSpace] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const [catalogPreview, setCatalogPreview] = useState<Furniture | null>(null);
  const rooms = findRooms(plan), bounds = planBounds(plan), area = rooms.reduce((sum, r) => sum + r.area, 0);
  const fit = () => {
    const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
    const b = planBounds(planRef.current), width = Math.max(200, b.maxX - b.minX), height = Math.max(200, b.maxY - b.minY);
    const horizontalPadding = rect.width < 520 ? 140 : 170;
    const topPadding = Math.min(128, rect.height * .35), bottomPadding = Math.min(72, rect.height * .2);
    const availableHeight = rect.height - topPadding - bottomPadding;
    const zoom = clamp(Math.min((rect.width - horizontalPadding) / width, availableHeight / height), .08, 1.4);
    setView({ zoom, x: (rect.width - width * zoom) / 2 - b.minX * zoom, y: topPadding + (availableHeight - height * zoom) / 2 - b.minY * zoom });
  };
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSize({ width, height }); fit(); });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { fit(); setAnchor(null); setMeasurement(null); setCatalogPreview(null); }, [plan.id]);
  useEffect(() => { setAnchor(null); setMeasurement(null); }, [tool]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if (e.code === 'Space' && !(e.target as Element).closest('button,a[href],[role=button],[role=slider],[role=switch],[role=radio],[role=tab],[role=menuitem],[role=checkbox]')) { e.preventDefault(); setSpace(true); }
      if (e.code === 'Escape') { setAnchor(null); setMeasurement(null); if (drag.current && drag.current.type !== 'pan') { onChange(() => drag.current && drag.current.type !== 'pan' ? drag.current.base : planRef.current, false); onEnd(); } drag.current = null; setDragging(false); }
    };
    const keyup = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [onChange, onEnd]);
  const toScreen = (event: { clientX: number; clientY: number }) => { const rect = svgRef.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const toWorld = (event: { clientX: number; clientY: number }) => { const p = toScreen(event); return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom }; };
  const snapPoint = (p: Point, fine = false, exclude: string[] = []): Point => {
    if (fine || !snap) return { x: round(p.x), y: round(p.y) };
    const nodes = Object.entries(plan.nodes).filter(([id]) => !exclude.includes(id)).map(([, n]) => n).sort((a, b) => distance(a, p) - distance(b, p));
    if (nodes[0] && distance(nodes[0], p) < 13 / view.zoom) return nodes[0];
    const projections = plan.walls.filter(w => !exclude.includes(w.a) && !exclude.includes(w.b)).map(w => projectPoint(p, plan.nodes[w.a], plan.nodes[w.b])).sort((a,b) => a.distance - b.distance);
    if (projections[0]?.distance < 9 / view.zoom) return { x: projections[0].x, y: projections[0].y };
    return { x: round(p.x, 10), y: round(p.y, 10) };
  };
  const catalogPoint = (point: CatalogPointer): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || point.clientX < rect.left || point.clientX > rect.right || point.clientY < rect.top || point.clientY > rect.bottom) return null;
    const target = document.elementFromPoint(point.clientX, point.clientY);
    if (!target || !svgRef.current?.contains(target)) return null;
    return snapPoint(toWorld(point), point.altKey);
  };
  const previewFurniture = (kind: FurnitureKind, point: CatalogPointer) => {
    const position = catalogPoint(point), item = CATALOG.find(f => f.kind === kind);
    if (!position || !item) { setCatalogPreview(null); return false; }
    setCatalogPreview({ ...item, ...position, id: 'catalog-preview', rotation: 0, url: '' });
    return true;
  };
  const dropFurniture = (kind: FurnitureKind, point: CatalogPointer) => {
    const position = catalogPoint(point); setCatalogPreview(null);
    if (!position || !CATALOG.some(f => f.kind === kind)) return false;
    const item = newFurniture(kind, position);
    onChange(current => ({ ...current, furniture: [...current.furniture, item] }));
    onSelect({ kind: 'furniture', id: item.id });
    return true;
  };
  const zoomAt = (factor: number, point: Point = { x: size.width / 2, y: size.height / 2 }) => setView(old => {
    const zoom = clamp(old.zoom * factor, .08, 4);
    return { zoom, x: point.x - (point.x - old.x) * zoom / old.zoom, y: point.y - (point.y - old.y) * zoom / old.zoom };
  });
  useEffect(() => {
    const element = svgRef.current; if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * .01), { x: e.clientX - rect.left, y: e.clientY - rect.top });
      else if (e.shiftKey) setView(old => ({ ...old, x: old.x - e.deltaY, y: old.y - e.deltaX }));
      else zoomAt(Math.exp(-e.deltaY * .0015), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [size.width, size.height]);
  const exportSvg = () => {
    const clone = svgRef.current!.cloneNode(true) as SVGSVGElement, b = planBounds(planRef.current), padding = Math.max(100, 80 / view.zoom);
    clone.querySelectorAll('[data-editor-only]').forEach(el => el.remove());
    clone.querySelector('[data-world]')?.removeAttribute('transform');
    const roomColors = new Map(findRooms(planRef.current).map(room => [room.id, room.label?.color ?? '#efeee8']));
    clone.querySelectorAll('[data-kind="room"]').forEach(room => room.setAttribute('fill', roomColors.get(room.getAttribute('data-id') ?? '') ?? '#efeee8'));
    clone.querySelectorAll('[data-room-name]').forEach(text => { text.setAttribute('font-size', '22'); text.setAttribute('y', '-4'); });
    clone.querySelectorAll('[data-room-area]').forEach(text => { text.removeAttribute('display'); text.setAttribute('font-size', '18'); text.setAttribute('y', '23'); });
    const width = Math.ceil(b.maxX - b.minX + padding * 2), height = Math.ceil(b.maxY - b.minY + padding * 2);
    clone.setAttribute('viewBox', `${b.minX - padding} ${b.minY - padding} ${width} ${height}`); clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height)); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.removeAttribute('class'); clone.style.background = '#fafafa'; clone.style.fontFamily = 'system-ui, sans-serif';
    clone.querySelectorAll('[data-kind="wall"] > line').forEach(line => line.setAttribute('stroke', '#464a43'));
    clone.querySelectorAll('[data-kind="opening"]').forEach(group => { const opening = planRef.current.openings.find(o => o.id === group.getAttribute('data-id')); group.querySelectorAll('[stroke="var(--accent)"]').forEach(el => el.setAttribute('stroke', opening?.kind === 'window' ? '#71878b' : '#7b7c72')); });
    const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backdrop.setAttribute('x', String(b.minX - padding)); backdrop.setAttribute('y', String(b.minY - padding)); backdrop.setAttribute('width', String(width)); backdrop.setAttribute('height', String(height)); backdrop.setAttribute('fill', '#fafafa'); clone.insertBefore(backdrop, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  };
  useImperativeHandle(forwardedRef, () => ({ fit, previewFurniture, dropFurniture, cancelFurniturePreview: () => setCatalogPreview(null), center: () => ({ x: (size.width / 2 - view.x) / view.zoom, y: (size.height / 2 - view.y) / view.zoom }), exportSvg,
    exportPng: async () => {
      const svg = exportSvg(), blob = new Blob([svg], { type: 'image/svg+xml' }), url = URL.createObjectURL(blob);
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'), scale = Math.min(2, 4000 / Math.max(image.width, image.height));
        canvas.width = Math.ceil(image.width * scale); canvas.height = Math.ceil(image.height * scale);
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось создать PNG')), 'image/png'));
      } finally { URL.revokeObjectURL(url); }
    },
  }));
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toWorld(event), screen = toScreen(event), target = event.target as Element;
    if (tool === 'pan' || space || event.button === 1) { drag.current = { type: 'pan', screen, view }; setDragging(true); return; }
    let point = snapPoint(p, event.altKey);
    if ((tool === 'wall' || tool === 'measure' || tool === 'calibrate') && anchor && event.shiftKey) {
      if (Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y)) point = { ...point, y: anchor.y }; else point = { ...point, x: anchor.x };
    }
    if (tool === 'wall') { onSelect(null); if (!anchor) setAnchor(point); else if (distance(anchor, point) >= 10) { onChange(current => addWall(current, anchor, point)); setAnchor(point); } return; }
    if (tool === 'measure' || tool === 'calibrate') {
      if (!anchor) { setAnchor(point); setMeasurement(null); } else if (distance(anchor, point) > 1) { if (tool === 'calibrate') onCalibrate(anchor, point); else setMeasurement({ a: anchor, b: point }); setAnchor(null); }
      return;
    }
    if (tool === 'door' || tool === 'window') {
      const result = addOpening(plan, tool, p); if (result.error) onNotice(result.error); else { onChange(() => result.plan); onSelect({ kind: 'opening', id: result.id! }); } return;
    }
    const node = target.closest('[data-node]')?.getAttribute('data-node');
    const entity = target.closest('[data-kind]'), kind = entity?.getAttribute('data-kind'), id = entity?.getAttribute('data-id');
    if (node) { onBegin(); drag.current = { type: 'node', id: node, start: p, base: plan }; setDragging(true); return; }
    if (kind && id) {
      onSelect({ kind: kind as NonNullable<Selection>['kind'], id });
      if (kind !== 'room') {
        onBegin(); const resize = target.closest('[data-resize]')?.getAttribute('data-resize'), rotate = target.closest('[data-rotate]');
        drag.current = { type: rotate ? 'rotate' : resize ? 'resize' : kind as 'wall' | 'furniture' | 'opening', id, start: p, base: plan, handle: resize ? JSON.parse(resize) as Point : undefined }; setDragging(true);
      }
    } else onSelect(null);
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const p = toWorld(event), d = drag.current;
    let point = snapPoint(p, event.altKey, d?.type === 'node' ? [d.id] : []);
    if (anchor && event.shiftKey) point = Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y) ? { ...point, y: anchor.y } : { ...point, x: anchor.x };
    setHover(point);
    if (!d) return;
    if (d.type === 'pan') { const screen = toScreen(event); setView({ ...d.view, x: d.view.x + screen.x - d.screen.x, y: d.view.y + screen.y - d.screen.y }); return; }
    const step = event.altKey || !snap ? 1 : 10, dx = round(p.x - d.start.x, step), dy = round(p.y - d.start.y, step);
    if (d.type === 'node') {
      onChange(() => moveNodes(d.base, { [d.id]: point }), false);
    } else if (d.type === 'wall') {
      const wall = d.base.walls.find(w => w.id === d.id)!;
      const nodes = { ...d.base.nodes }; for (const id of [wall.a, wall.b]) nodes[id] = { x: d.base.nodes[id].x + dx, y: d.base.nodes[id].y + dy };
      onChange(() => moveNodes(d.base, nodes), false);
    } else if (d.type === 'opening') {
      const opening = d.base.openings.find(o => o.id === d.id)!, wall = d.base.walls.find(w => w.id === opening.wallId)!;
      const t = projectPoint(p, d.base.nodes[wall.a], d.base.nodes[wall.b]).t;
      const candidate = fitOpenings({ ...d.base, openings: d.base.openings.map(o => o.id === d.id ? { ...o, t } : o) });
      if (!openingsOverlap(candidate)) onChange(() => candidate, false);
    } else {
      const f = d.base.furniture.find(f => f.id === d.id)!;
      let changes: Partial<Furniture> = {};
      if (d.type === 'furniture') changes = { x: f.x + dx, y: f.y + dy };
      if (d.type === 'rotate') changes = { rotation: round(Math.atan2(p.y - f.y, p.x - f.x) * 180 / Math.PI + 90, event.altKey ? 1 : 15) };
      if (d.type === 'resize' && d.handle) {
        const angle = f.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        const local = { x: (p.x - f.x) * cos + (p.y - f.y) * sin, y: -(p.x - f.x) * sin + (p.y - f.y) * cos };
        const opposite = { x: -d.handle.x * f.width / 2, y: -d.handle.y * f.depth / 2 };
        const width = Math.max(10, round((local.x - opposite.x) * d.handle.x, step)), depth = Math.max(10, round((local.y - opposite.y) * d.handle.y, step));
        const center = { x: opposite.x + d.handle.x * width / 2, y: opposite.y + d.handle.y * depth / 2 };
        changes = { width, depth, x: round(f.x + center.x * cos - center.y * sin), y: round(f.y + center.x * sin + center.y * cos) };
      }
      onChange(() => ({ ...d.base, furniture: d.base.furniture.map(item => item.id === d.id ? { ...item, ...changes } : item) }), false);
    }
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current && drag.current.type !== 'pan') { onChange(mergeCoincidentNodes, false); onEnd(); }
    drag.current = null; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const selectedFurniture = selection?.kind === 'furniture' ? plan.furniture.find(f => f.id === selection.id) : undefined;
  const selectedWall = selection?.kind === 'wall' ? plan.walls.find(w => w.id === selection.id) : undefined;
  const hint = tool === 'wall' ? anchor ? 'Выберите конец стены · Shift — прямой угол · Esc — закончить' : 'Нажмите, чтобы начать стену · Shift — прямой угол' : tool === 'door' || tool === 'window' ? 'Нажмите на стену, чтобы разместить проём' : tool === 'measure' || tool === 'calibrate' ? anchor ? 'Выберите вторую точку' : 'Выберите первую точку' : 'Пробел + перетаскивание — панорама · Колесо — масштаб';
  return <div className={`canvas-container tool-${tool}${space ? ' space-pan' : ''}${isDragging ? ' dragging' : ''}`} ref={containerRef}>
    <svg ref={svgRef} className="plan-svg" aria-label="План квартиры" role="application" tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onContextMenu={e => e.preventDefault()} onDragOver={e => { if (e.dataTransfer.types.includes('metr/furniture')) e.preventDefault(); }} onDrop={e => {
      const kind = e.dataTransfer.getData('metr/furniture');
      if (CATALOG.some(item => item.kind === kind)) { e.preventDefault(); dropFurniture(kind as FurnitureKind, e); }
    }}>
      <defs><pattern id="metr-grid" width={50} height={50} patternUnits="userSpaceOnUse"><circle cx={0} cy={0} r={.8 / view.zoom} fill="#b6b9ad"/>{view.zoom > .9 && <path d="M10 0v1M20 0v1M30 0v1M40 0v1M0 10h1M0 20h1M0 30h1M0 40h1" stroke="#d7d9d0" strokeWidth={.7}/>}</pattern></defs>
      <g data-world="true" transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {grid && <rect data-editor-only="true" x={-100000} y={-100000} width={200000} height={200000} fill="url(#metr-grid)" pointerEvents="none"/>}
        {plan.background && <image href={plan.background.src} x={plan.background.x} y={plan.background.y} width={plan.background.width} height={plan.background.height} opacity={plan.background.opacity} pointerEvents="none"/>}
        {rooms.map(room => <polygon key={room.id} data-kind="room" data-id={room.id} points={room.vertices.map(p => `${p.x},${p.y}`).join(' ')} fill={selection?.id === room.id ? 'var(--accent-soft)' : room.label?.color ?? '#efeee8'} fillOpacity={plan.background ? .45 : 1} stroke="none"/>)}
        {ghost && <g data-editor-only="true" opacity={.38} pointerEvents="none">{ghost.walls.map(w => <line key={w.id} x1={ghost.nodes[w.a].x} y1={ghost.nodes[w.a].y} x2={ghost.nodes[w.b].x} y2={ghost.nodes[w.b].y} stroke="#9b78ab" strokeWidth={w.thickness} strokeDasharray="10 6"/>)}{ghost.furniture.map(f => <g key={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}><rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth} rx={5} fill="#c8a6db" stroke="#79508e" strokeWidth={2} strokeDasharray="6 4"/></g>)}</g>}
        {plan.furniture.map(f => <g key={f.id} data-kind="furniture" data-id={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`} style={{ cursor: tool === 'select' ? 'move' : undefined }}>
          <rect x={-f.width / 2 - 2} y={-f.depth / 2 - 2} width={f.width + 4} height={f.depth + 4} fill="transparent"/>
          <FurnitureGlyph item={f}/>
        </g>)}
        {plan.walls.map(w => <g key={w.id} data-kind="wall" data-id={w.id} style={{ cursor: tool === 'select' ? 'move' : undefined }}><line x1={plan.nodes[w.a].x} y1={plan.nodes[w.a].y} x2={plan.nodes[w.b].x} y2={plan.nodes[w.b].y} stroke={selection?.id === w.id ? 'var(--accent)' : '#464a43'} strokeWidth={w.thickness} strokeLinecap="square"/><line data-editor-only="true" x1={plan.nodes[w.a].x} y1={plan.nodes[w.a].y} x2={plan.nodes[w.b].x} y2={plan.nodes[w.b].y} stroke="transparent" strokeWidth={Math.max(w.thickness, 14 / view.zoom)}/></g>)}
        {plan.openings.map(o => <OpeningShape key={o.id} opening={o} plan={plan} selected={selection?.id === o.id} zoom={view.zoom}/>)}
        {rooms.map((room, index) => { const p = room.label ?? room.center; return <g key={`label-${room.id}`} data-room-label="true" pointerEvents="none" transform={`translate(${p.x} ${p.y})`} fill="#515a52" fontFamily="system-ui, sans-serif" textAnchor="middle"><text data-room-name="true" y={(view.zoom < .35 ? 2 : -2) / view.zoom} fontSize={(view.zoom < .35 ? 8 : 11) / view.zoom} fontWeight={500}>{room.label?.name ?? `Комната ${index + 1}`}</text><text data-room-area="true" display={view.zoom < .35 ? 'none' : undefined} y={11 / view.zoom} fontSize={9 / view.zoom} fill="#626b63">{squareMeters(room.area)} м²</text></g>; })}
        {dimensions && plan.walls.length > 0 && <><Dimension a={{ x: bounds.minX, y: bounds.minY }} b={{ x: bounds.maxX, y: bounds.minY }} offset={-50 / view.zoom} zoom={view.zoom}/><Dimension a={{ x: bounds.minX, y: bounds.maxY }} b={{ x: bounds.minX, y: bounds.minY }} offset={-50 / view.zoom} zoom={view.zoom}/></>}
        {catalogPreview && <g data-editor-only="true" data-catalog-preview="true" pointerEvents="none" transform={`translate(${catalogPreview.x} ${catalogPreview.y})`} opacity={.8}>
          <FurnitureGlyph item={catalogPreview}/>
          <rect x={-catalogPreview.width / 2 - 3 / view.zoom} y={-catalogPreview.depth / 2 - 3 / view.zoom} width={catalogPreview.width + 6 / view.zoom} height={catalogPreview.depth + 6 / view.zoom} rx={4 / view.zoom} fill="none" stroke="var(--accent)" strokeWidth={1.5 / view.zoom} strokeDasharray={`${5 / view.zoom} ${3 / view.zoom}`}/>
        </g>}
        {selectedWall && <g data-editor-only="true"><Dimension a={plan.nodes[selectedWall.a]} b={plan.nodes[selectedWall.b]} offset={-25 / view.zoom - selectedWall.thickness / 2} zoom={view.zoom} color="var(--accent)"/>{[selectedWall.a, selectedWall.b].map(id => <circle key={id} data-node={id} cx={plan.nodes[id].x} cy={plan.nodes[id].y} r={6 / view.zoom} fill="#ffffff" stroke="var(--accent)" strokeWidth={2 / view.zoom} style={{ cursor: 'crosshair' }}/>)}</g>}
        {selectedFurniture && <g data-editor-only="true" data-kind="furniture" data-id={selectedFurniture.id} transform={`translate(${selectedFurniture.x} ${selectedFurniture.y}) rotate(${selectedFurniture.rotation})`}>
          <rect x={-selectedFurniture.width / 2 - 5 / view.zoom} y={-selectedFurniture.depth / 2 - 5 / view.zoom} width={selectedFurniture.width + 10 / view.zoom} height={selectedFurniture.depth + 10 / view.zoom} fill="none" stroke="var(--accent)" strokeWidth={1.5 / view.zoom}/>
          {[-1,1].flatMap(x => [-1,1].map(y => <rect key={`${x}-${y}`} data-resize={JSON.stringify({x,y})} x={x * selectedFurniture.width / 2 - 4 / view.zoom} y={y * selectedFurniture.depth / 2 - 4 / view.zoom} width={8 / view.zoom} height={8 / view.zoom} fill="#ffffff" stroke="var(--accent)" strokeWidth={1.5 / view.zoom} style={{ cursor: x === y ? 'nwse-resize' : 'nesw-resize' }}/>))}
          <path d={`M0 ${-selectedFurniture.depth / 2}v${-27 / view.zoom}`} stroke="var(--accent)" strokeWidth={1 / view.zoom}/><circle data-rotate="true" cx={0} cy={-selectedFurniture.depth / 2 - 30 / view.zoom} r={5 / view.zoom} fill="#ffffff" stroke="var(--accent)" strokeWidth={1.5 / view.zoom} style={{ cursor: 'grab' }}/>
          <Dimension a={{ x: -selectedFurniture.width / 2, y: selectedFurniture.depth / 2 }} b={{ x: selectedFurniture.width / 2, y: selectedFurniture.depth / 2 }} offset={25 / view.zoom} zoom={view.zoom} color="var(--accent)"/>
        </g>}
        {anchor && hover && <g data-editor-only="true" pointerEvents="none"><line x1={anchor.x} y1={anchor.y} x2={hover.x} y2={hover.y} stroke="var(--accent)" strokeWidth={tool === 'wall' ? 14 : 1.5 / view.zoom} strokeDasharray={tool === 'wall' ? 'none' : '5 4'} opacity={.6}/><circle cx={anchor.x} cy={anchor.y} r={4 / view.zoom} fill="var(--accent)"/><circle cx={hover.x} cy={hover.y} r={4 / view.zoom} fill="#ffffff" stroke="var(--accent)" strokeWidth={1.5 / view.zoom}/><Dimension a={anchor} b={hover} offset={-25 / view.zoom} zoom={view.zoom} color="var(--accent)"/></g>}
        {measurement && <g data-editor-only="true"><Dimension a={measurement.a} b={measurement.b} zoom={view.zoom} color="var(--accent)"/><circle cx={measurement.a.x} cy={measurement.a.y} r={3 / view.zoom} fill="var(--accent)"/><circle cx={measurement.b.x} cy={measurement.b.y} r={3 / view.zoom} fill="var(--accent)"/></g>}
      </g>
    </svg>
    <div className="canvas-meta"><strong>Планировка</strong><span>{rooms.length ? `${rooms.length} ${plural(rooms.length, 'помещение', 'помещения', 'помещений')} · ${squareMeters(area)} м²` : 'Стены и размеры в сантиметрах'}</span></div>
    {ghost && <div className="comparison-badge"><span/>Наложение: {ghost.name}</div>}
    {plan.walls.length === 0 && !plan.background && <div className="empty-canvas"><MousePointer2 size={28}/><h2>Новый план</h2><p>Выберите «Стена» и отметьте углы комнаты.<br/>Готовый чертёж можно загрузить как подложку.</p></div>}
    <div className="canvas-hint"><Crosshair size={13}/><span>{hint}</span></div>
    <div className="zoom-controls"><IconButton label="Уменьшить" onPress={() => zoomAt(1 / 1.2)}><Minus size={15}/></IconButton><span>{Math.round(view.zoom * 100)}%</span><IconButton label="Увеличить" onPress={() => zoomAt(1.2)}><Plus size={15}/></IconButton><i/><IconButton label="Показать весь план" onPress={fit}><Maximize2 size={15}/></IconButton></div>
  </div>;
});
