import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, Check, ChevronDown, Copy, DoorOpen, Download, FilePlus2, FolderOpen, Grid2X2, Hand, ImagePlus, Keyboard, Layers2, Maximize2, MousePointer2, PanelTop, Pencil, Plus, Redo2, RotateCw, Ruler, Settings2, Sofa, Trash2, Undo2, Wallpaper, X, BrickWall, CheckCheck, AlertCircle, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Description, Dropdown, Input, Kbd, Label, Modal as HeroModal, SearchField, Separator, Slider, Switch, Tabs, TextField, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Toast, toast as notify } from '@heroui/react';
import { DimensionField as NumberField, IconButton } from './components/EditorControls';
import { PlanCanvas } from './components/PlanCanvas';
import type { CanvasHandle } from './components/PlanCanvas';
import { FurnitureGlyph } from './components/FurnitureGlyph';
import { activePlan, CATALOG, demoProject, duplicateVariant, emptyPlan, findRooms, newFurniture, PALETTE, removeSelection, resizeWall, updatePlan, moveNodes } from './model';
import type { FurnitureKind, Plan, Project, Selection, Tool, Furniture, Opening } from './model';
import { distance, meters, round, squareMeters, uid, clamp } from './geometry';
import type { Point } from './geometry';
import { downloadFile, parseProject, safeUrl, STORAGE_KEY } from './storage';
import { useHistory } from './useHistory';

const PlannerDialog = lazy(() => import('./components/PlannerDialog'));

const TOOLS: { id: Tool; name: string; key: string; Icon: LucideIcon }[] = [
  { id: 'select', name: 'Выбор', key: 'V', Icon: MousePointer2 },
  { id: 'wall', name: 'Стена', key: 'W', Icon: BrickWall },
  { id: 'door', name: 'Дверь', key: 'D', Icon: DoorOpen },
  { id: 'window', name: 'Окно', key: 'O', Icon: PanelTop },
  { id: 'measure', name: 'Размер', key: 'M', Icon: Ruler },
  { id: 'pan', name: 'Рука', key: 'H', Icon: Hand },
];
function loadInitial() {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return { project: parseProject(saved), warning: '' }; } catch { return { project: demoProject(), warning: 'Сохранённый план не удалось прочитать. Открыт демонстрационный проект' }; }
  return { project: demoProject(), warning: '' };
}
type Modal = { type: 'new' | 'variant' | 'rename' | 'help' | 'deleteVariant' } | { type: 'calibrate'; a: Point; b: Point } | null;
export default function App() {
  const [initial] = useState(loadInitial), history = useHistory<Project>(initial.project);
  const { value: project, update, ref: projectRef } = history;
  const plan = activePlan(project), rooms = findRooms(plan), area = rooms.reduce((sum, r) => sum + r.area, 0);
  const [plannerStatus,setPlannerStatus] = useState({enabled:false,agentAvailable:false}), [plannerOpen,setPlannerOpen] = useState(false);
  useEffect(() => { const controller = new AbortController(); void fetch('/api/planner/status',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(value=>{if(!controller.signal.aborted)setPlannerStatus({enabled:value?.enabled===true,agentAvailable:value?.agentAvailable===true});}).catch(()=>{});return ()=>controller.abort(); },[]);
  const [selection, setSelection] = useState<Selection>(null), [tool, setTool] = useState<Tool>('select');
  const [grid, setGrid] = useState(true), [dimensions, setDimensions] = useState(true), [snap, setSnap] = useState(true);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('Все'), [sideTab, setSideTab] = useState<'furniture' | 'rooms'>('furniture');
  const [compareId, setCompareId] = useState(''), [modal, setModal] = useState<Modal>(null), [modalValue, setModalValue] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [creatingDemo, setCreatingDemo] = useState(false), [mobilePanel, setMobilePanel] = useState<'catalog' | 'inspector' | null>(null);
  const variantList = useRef<HTMLDivElement>(null);
  const canvas = useRef<CanvasHandle>(null), projectInput = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null), gesture = useRef<Project | null>(null);
  const changePlan = useCallback((fn: (p: Plan) => Plan, record = true) => update(current => updatePlan(current, fn), record), [update]);
  const beginGesture = useCallback(() => { gesture.current = projectRef.current; }, [projectRef]);
  const endGesture = useCallback(() => { if (gesture.current) history.commit(gesture.current); gesture.current = null; }, [history.commit]);
  const notice = useCallback((message: string) => { notify(message, { timeout: 5000 }); }, []);
  const setActiveTool = (next: Tool) => { setTool(next); if (next !== 'select') setSelection(null); };
  useEffect(() => {
    setSaveStatus('saving');
    const timer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); setSaveStatus('saved'); } catch { setSaveStatus('error'); } }, 450);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    const list = variantList.current; if (!list) return;
    const reveal = () => list.querySelector<HTMLElement>('[role="tab"][data-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const observer = new ResizeObserver(reveal);
    observer.observe(list); reveal();
    return () => observer.disconnect();
  }, [plan.id]);
  useEffect(() => { if (initial.warning) notify.warning(initial.warning); }, [initial.warning]);
  const selectedFurniture = selection?.kind === 'furniture' ? plan.furniture.find(f => f.id === selection.id) : undefined;
  const selectedWall = selection?.kind === 'wall' ? plan.walls.find(w => w.id === selection.id) : undefined;
  const selectedOpening = selection?.kind === 'opening' ? plan.openings.find(o => o.id === selection.id) : undefined;
  const selectedRoom = selection?.kind === 'room' ? rooms.find(r => r.id === selection.id) : undefined;
  const openingWall = selectedOpening ? plan.walls.find(w => w.id === selectedOpening.wallId) : undefined;
  const changeFurniture = (changes: Partial<Furniture>) => changePlan(p => ({ ...p, furniture: p.furniture.map(f => f.id === selection?.id ? { ...f, ...changes } : f) }));
  const deleteSelected = useCallback(() => { if (selection && selection.kind !== 'room') { changePlan(p => removeSelection(p, selection)); setSelection(null); } }, [selection, changePlan]);
  const duplicateSelected = useCallback(() => {
    if (selection?.kind !== 'furniture') return;
    const item = activePlan(projectRef.current).furniture.find(f => f.id === selection.id); if (!item) return;
    const copy = { ...item, id: uid(), x: item.x + 30, y: item.y + 30 };
    changePlan(p => ({ ...p, furniture: [...p.furniture, copy] })); setSelection({ kind: 'furniture', id: copy.id });
  }, [selection, changePlan, projectRef]);
  const saveProject = useCallback(() => { const p = projectRef.current; downloadFile(JSON.stringify(p, null, 2), `${p.name || 'Квартира'}.metr.json`); notice('Проект сохранён в файл вместе со всеми вариантами'); }, [projectRef, notice]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (plannerOpen) return;
      if (modal) { if (e.key === 'Escape') setModal(null); return; }
      const editable = (e.target as HTMLElement).closest('input,textarea,select,[contenteditable],[role=menu],[role=listbox]');
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); saveProject(); return; }
      if (editable) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); setSelection(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); history.redo(); setSelection(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); duplicateSelected(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelected(); }
      if (e.code === 'Escape') { setSelection(null); setTool('select'); }
      if (e.code === 'KeyF') canvas.current?.fit();
      if (e.code === 'KeyR' && selectedFurniture) changeFurniture({ rotation: (selectedFurniture.rotation + 90) % 360 });
      const next = TOOLS.find(t => `Key${t.key}` === e.code); if (next) setActiveTool(next.id);
      if (e.code === 'Slash' && e.shiftKey) setModal({ type: 'help' });
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  const addFurniture = (kind: FurnitureKind, custom = false) => {
    const center = canvas.current?.center() ?? { x: 200, y: 200 };
    const item = newFurniture(kind, { x: round(center.x, 10), y: round(center.y, 10) }); if (custom) item.name = 'Мой предмет';
    changePlan(p => ({ ...p, furniture: [...p.furniture, item] })); setSelection({ kind: 'furniture', id: item.id }); setTool('select'); setMobilePanel('inspector');
  };
  const changeOpening = (changes: Partial<Opening>) => {
    if (!selectedOpening || !openingWall) return;
    const length = distance(plan.nodes[openingWall.a], plan.nodes[openingWall.b]);
    let next = { ...selectedOpening, ...changes };
    const width = Math.min(next.width, length - 4), margin = (width / 2 + 1) / length;
    next = { ...next, width, t: clamp(next.t, margin, 1 - margin) };
    if (plan.openings.some(o => o.id !== next.id && o.wallId === next.wallId && Math.abs(o.t - next.t) * length < (o.width + next.width) / 2 + 2)) { notice('Проёмы не должны пересекаться'); return; }
    changePlan(p => ({ ...p, openings: p.openings.map(o => o.id === next.id ? next : o) }));
  };
  const openModal = (type: 'new' | 'variant' | 'rename' | 'deleteVariant') => {
    setModalValue(type === 'new' ? 'Моя квартира' : type === 'variant' ? `${plan.name} — копия` : plan.name); setCreatingDemo(false); setModal({ type });
  };
  const importProject = async (file?: File) => {
    if (!file) return;
    try { if (file.size > 20000000) throw new Error('Размер файла проекта должен быть меньше 20 МБ'); const imported = parseProject(await file.text()); update(imported); setSelection(null); setTool('select'); setCompareId(''); notice('Проект открыт'); }
    catch (error) { notice(error instanceof Error ? error.message : 'Не удалось открыть проект'); }
  };
  const importBackground = async (file?: File) => {
    if (!file) return;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Выберите изображение PNG, JPG или WebP');
      if (file.size > 8000000) throw new Error('Для подложки выберите изображение меньше 8 МБ');
      const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file); });
      const image = new Image(); image.src = src; await image.decode();
      changePlan(p => ({ ...p, background: { src, x: 0, y: 0, width: 900, height: 900 * image.naturalHeight / image.naturalWidth, opacity: .4 } }));
      setSelection(null); setTool('calibrate'); notice('Отметьте на подложке два конца отрезка с известной длиной'); setTimeout(() => canvas.current?.fit(), 0);
    } catch (error) { notice(error instanceof Error ? error.message : 'Не удалось загрузить изображение'); }
  };
  const submitModal = () => {
    if (!modal) return;
    if (modal.type === 'new') {
      const p = creatingDemo ? demoProject() : (() => { const p = emptyPlan('Основной'); return { version: 1 as const, name: modalValue.trim() || 'Моя квартира', activeId: p.id, variants: [p] }; })();
      p.name = modalValue.trim() || 'Моя квартира'; update(p); setCompareId(''); setSelection(null); setTool(creatingDemo ? 'select' : 'wall');
    }
    if (modal.type === 'variant') {
      if (project.variants.length >= 30) { notice('В одном проекте может быть до 30 вариантов'); return; }
      update(p => duplicateVariant(p, modalValue.trim() || `Вариант ${p.variants.length + 1}`)); setSelection(null); setCompareId('');
    }
    if (modal.type === 'rename') changePlan(p => ({ ...p, name: modalValue.trim() || 'Без названия' }));
    if (modal.type === 'deleteVariant' && project.variants.length > 1) { const remaining = project.variants.filter(v => v.id !== project.activeId); update(p => ({ ...p, variants: remaining, activeId: remaining[0].id })); setSelection(null); setCompareId(''); }
    if (modal.type === 'calibrate' && plan.background) {
      const actual = Number(modalValue.replace(',', '.')), measured = distance(modal.a, modal.b), ratio = actual / measured;
      if (!Number.isFinite(actual) || actual <= 0 || actual > 100000 || measured < 1) { notice('Введите длину отрезка в сантиметрах'); return; }
      const bg = plan.background;
      if (bg.width * ratio > 100000 || bg.height * ratio > 100000 || bg.width * ratio < 1 || bg.height * ratio < 1) { notice('Получился слишком большой или маленький масштаб. Выберите другой отрезок'); return; }
      changePlan(p => ({ ...p, background: { ...bg, x: modal.a.x + (bg.x - modal.a.x) * ratio, y: modal.a.y + (bg.y - modal.a.y) * ratio, width: bg.width * ratio, height: bg.height * ratio } }));
      setTool('select'); setTimeout(() => canvas.current?.fit(), 0); notice('Масштаб подложки установлен. Теперь можно обвести стены');
    }
    setModal(null);
  };
  const exportImage = async (format: 'svg' | 'png') => {
    try { if (!canvas.current) return; const name = `${project.name} — ${plan.name}`;
      if (format === 'svg') downloadFile(canvas.current.exportSvg(), `${name}.svg`, 'image/svg+xml');
      else downloadFile(await canvas.current.exportPng(), `${name}.png`);
      notice(`План экспортирован в ${format.toUpperCase()}`);
    } catch { notice('Не удалось экспортировать изображение. Попробуйте SVG'); }
  };
  const categories = ['Все', 'Гостиная', 'Спальня', 'Кухня', 'Ванная'];
  const filtered = CATALOG.filter(c => (category === 'Все' || c.category === category) && c.name.toLowerCase().includes(query.toLowerCase()));
  const ghost = compareId && compareId !== plan.id ? project.variants.find(v => v.id === compareId) : undefined;
  const roomLabel = (changes: { name?: string; color?: string }) => {
    if (!selectedRoom) return;
    changePlan(p => {
      const label = selectedRoom.label ?? { id: uid(), ...selectedRoom.center, name: 'Комната', color: '#f2eee5' };
      return { ...p, labels: [...p.labels.filter(l => l.id !== label.id), { ...label, ...changes }] };
    });
  };
  const selectVariant = (id: string) => {
    update(p => ({ ...p, activeId: id }));
    setSelection(null); setTool('select');
    if (compareId === id) setCompareId('');
  };
  const modalTitle = !modal ? '' : modal.type === 'new' ? 'Новый проект' : modal.type === 'variant' ? 'Копия варианта'
    : modal.type === 'rename' ? 'Название варианта' : modal.type === 'deleteVariant' ? 'Удалить вариант?' : modal.type === 'help' ? 'Горячие клавиши' : 'Масштаб подложки';
  const modalDescription = !modal ? '' : modal.type === 'new' ? 'Начните с пустого плана или демонстрационной квартиры.'
    : modal.type === 'variant' ? 'Создадим отдельную копию текущего плана со всей мебелью.'
    : modal.type === 'deleteVariant' ? `Вариант «${plan.name}» будет удалён. Действие можно отменить.`
    : modal.type === 'calibrate' ? 'Введите реальную длину выбранного отрезка. Масштаб изменится относительно первой точки.' : '';

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="Метр">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M5 27V5h22v22H17V16H5m12 0V5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /></svg>
          <span>метр</span>
        </a>
        <Separator orientation="vertical" className="header-divider" />
        <div className="project-heading">
          <Input className="project-name" aria-label="Название проекта" value={project.name} maxLength={100} onChange={e => update(p => ({ ...p, name: e.target.value }))} />
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === 'saved' ? <CheckCheck size={12} /> : saveStatus === 'error' ? <AlertCircle size={12} /> : <span className="saving-dot" />}
            <span className="save-message">{saveStatus === 'saved' ? 'Сохранено в браузере' : saveStatus === 'error' ? 'Память заполнена — сохраните файл' : 'Сохраняем…'}</span>
          </span>
        </div>
        <div className="header-actions">
          <Button className="new-project-button" variant="ghost" size="sm" onPress={() => openModal('new')}><FilePlus2 size={16} />Новый</Button>
          <Button className="header-action" variant="ghost" size="sm" aria-label="Открыть проект" onPress={() => projectInput.current?.click()}><FolderOpen size={16} /><span>Открыть</span></Button>
          <Button className="header-action" variant="secondary" size="sm" aria-label="Сохранить проект" onPress={saveProject}><Download size={16} /><span>Сохранить файл</span></Button>
          <Dropdown>
            <Button className="header-action export-button" size="sm" aria-label="Экспорт"><ArrowUpFromLine size={16} /><span>Экспорт</span><ChevronDown size={14} /></Button>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Формат экспорта" onAction={key => { void exportImage(key as 'png' | 'svg'); }}>
                <Dropdown.Item id="png" textValue="Изображение PNG"><ImagePlus size={16} /><Label>Изображение PNG</Label><Description>Для переписки и презентаций</Description></Dropdown.Item>
                <Dropdown.Item id="svg" textValue="Векторный план SVG"><Wallpaper size={16} /><Label>Векторный план SVG</Label><Description>Для печати и редактирования</Description></Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>

      <Toolbar className="editor-toolbar" aria-label="Инструменты плана">
        <ToggleButtonGroup className="drawing-tools" aria-label="Инструмент" selectionMode="single" disallowEmptySelection isDetached
          selectedKeys={tool === 'calibrate' ? [] : [tool]} onSelectionChange={keys => { const key = [...keys][0]; if (key) setActiveTool(String(key) as Tool); }}>
          {TOOLS.map(({ id, name, key, Icon }) => <ToggleButton key={id} id={id} size="sm" aria-label={`${name} (${key})`}><Icon size={17} /><span>{name}</span><Kbd className="tool-shortcut">{key}</Kbd></ToggleButton>)}
        </ToggleButtonGroup>
        <div className="toolbar-actions">
          <IconButton label="Отменить" isDisabled={!history.canUndo} onPress={() => { history.undo(); setSelection(null); }}><Undo2 size={17} /></IconButton>
          <IconButton label="Повторить" isDisabled={!history.canRedo} onPress={() => { history.redo(); setSelection(null); }}><Redo2 size={17} /></IconButton>
          <Separator orientation="vertical" />
          <ToggleButton isIconOnly size="sm" aria-label="Показать сетку" isSelected={grid} onChange={setGrid}><Grid2X2 size={17} /></ToggleButton>
          <ToggleButton isIconOnly size="sm" aria-label="Показать размеры" isSelected={dimensions} onChange={setDimensions}><Ruler size={17} /></ToggleButton>
          <IconButton label="Горячие клавиши" onPress={() => setModal({ type: 'help' })}><Keyboard size={18} /></IconButton>
        </div>
      </Toolbar>

      <main className="workspace">
        <aside className={`left-sidebar ${mobilePanel === 'catalog' ? 'mobile-open' : ''}`} aria-label="Каталог">
          <Tabs className="catalog-tabs" variant="secondary" selectedKey={sideTab} onSelectionChange={key => setSideTab(key as 'furniture' | 'rooms')}>
            <Tabs.ListContainer className="sidebar-navigation"><Tabs.List aria-label="Каталог и помещения"><Tabs.Tab id="furniture"><Sofa size={16} />Мебель<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="rooms"><Layers2 size={16} />Комнаты<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer>
            <Tabs.Panel id="furniture" className="catalog-panel">
              <SearchField className="catalog-search" aria-label="Поиск мебели" value={query} onChange={setQuery} variant="secondary">
                <SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Найти предмет" /><SearchField.ClearButton aria-label="Очистить поиск" /></SearchField.Group>
              </SearchField>
              <div className="category-list" aria-label="Категории мебели">{categories.map(c => <Button key={c} size="sm" variant={category === c ? 'secondary' : 'ghost'} aria-pressed={category === c} onPress={() => setCategory(c)}>{c}</Button>)}</div>
              <div className="catalog-scroll">
                <p className="catalog-instruction">Нажмите или перетащите на план</p>
                <div className="catalog-grid">{filtered.map(item => <button key={item.kind} className="catalog-item" draggable aria-label={`Добавить: ${item.name}`}
                  onDragStart={e => { e.dataTransfer.setData('metr/furniture', item.kind); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addFurniture(item.kind)}>
                  <div className="catalog-preview"><svg viewBox={`${-item.width / 2 - 25} ${-item.depth / 2 - 25} ${item.width + 50} ${item.depth + 50}`} aria-hidden="true"><FurnitureGlyph item={{ ...item, id: '', x: 0, y: 0, rotation: 0, url: '' }} /></svg><Plus className="catalog-add" size={14} /></div>
                  <span className="catalog-name">{item.name}</span><small>{item.width} × {item.depth} см</small>
                </button>)}</div>
                {!filtered.length && <div className="empty-search"><p>Ничего не найдено</p><Button size="sm" variant="tertiary" onPress={() => { setQuery(''); setCategory('Все'); }}>Сбросить поиск</Button></div>}
                <Button className="custom-item" size="sm" variant="tertiary" fullWidth onPress={() => addFurniture('table', true)}><Plus size={16} />Свой предмет</Button>
              </div>
            </Tabs.Panel>
            <Tabs.Panel id="rooms" className="rooms-panel">
              <p className="panel-description">Площади по осевым линиям стен</p>
              {rooms.map((room, index) => <Button key={room.id} variant="ghost" className={`room-list-item ${selection?.id === room.id ? 'selected' : ''}`} onPress={() => { setSelection({ kind: 'room', id: room.id }); setTool('select'); }}><span className="room-color" style={{ background: room.label?.color ?? '#eeeade' }} /><span>{room.label?.name ?? `Комната ${index + 1}`}</span><small>{squareMeters(room.area)} м²</small></Button>)}
              {!rooms.length && <p className="panel-description">Замкните контур стен, чтобы создать комнату.</p>}
            </Tabs.Panel>
          </Tabs>
          <Button className="mobile-close catalog-close" variant="ghost" size="sm" isIconOnly aria-label="Закрыть каталог" onPress={() => setMobilePanel(null)}><X size={16} /></Button>
          <div className="sidebar-bottom"><Tooltip delay={500}><Button variant="secondary" size="sm" fullWidth onPress={() => imageInput.current?.click()}><ImagePlus size={16} />{plan.background ? 'Заменить подложку' : 'Подложка плана'}</Button><Tooltip.Content>PNG, JPG или WebP</Tooltip.Content></Tooltip></div>
        </aside>

        <Tabs className="editor" variant="secondary" selectedKey={plan.id} onSelectionChange={key => selectVariant(String(key))}>
          <Tabs.ListContainer ref={variantList} className="variant-list"><Tabs.List aria-label="Варианты планировки">{project.variants.map(variant => <Tabs.Tab key={variant.id} id={variant.id}><span className="variant-name" title={variant.name}>{variant.name}</span><Tabs.Indicator /></Tabs.Tab>)}</Tabs.List></Tabs.ListContainer>
          <div className="variant-actions">{plannerStatus.enabled && <Button className="planner-entry" size="sm" variant="secondary" aria-label="Улучшить план" onPress={()=>setPlannerOpen(true)}><SlidersHorizontal size={16}/><span>Улучшить план</span></Button>}<IconButton label="Создать копию варианта" onPress={() => openModal('variant')}><Plus size={16} /></IconButton>
            {project.variants.length > 1 && <div className="compare-control"><Dropdown><Button size="sm" variant={compareId ? 'secondary' : 'ghost'} aria-label="Наложить вариант"><Layers2 size={15} /><span>{ghost ? ghost.name : 'Сравнить'}</span><ChevronDown size={12} /></Button><Dropdown.Popover><Dropdown.Menu aria-label="Наложение вариантов" selectionMode="single" selectedKeys={[compareId || 'none']} onAction={key => setCompareId(key === 'none' ? '' : String(key))}><Dropdown.Item id="none" textValue="Без наложения"><Label>Без наложения</Label><Dropdown.ItemIndicator /></Dropdown.Item>{project.variants.filter(v => v.id !== plan.id).map(v => <Dropdown.Item key={v.id} id={v.id} textValue={v.name}><Label>{v.name}</Label><Dropdown.ItemIndicator /></Dropdown.Item>)}</Dropdown.Menu></Dropdown.Popover></Dropdown>{compareId && <IconButton label="Убрать сравнение" onPress={() => setCompareId('')}><X size={14} /></IconButton>}</div>}
          </div>
          {project.variants.map(variant => <Tabs.Panel key={variant.id} id={variant.id} className="editor-panel">{variant.id === plan.id && <PlanCanvas ref={canvas} plan={plan} ghost={ghost} tool={tool} selection={selection} grid={grid} dimensions={dimensions} snap={snap} onSelect={setSelection} onChange={changePlan} onBegin={beginGesture} onEnd={endGesture} onNotice={notice} onCalibrate={(a,b) => { setModalValue('100'); setModal({ type: 'calibrate', a,b }); }} />}</Tabs.Panel>)}
        </Tabs>

        <aside className={`right-sidebar ${mobilePanel === 'inspector' ? 'mobile-open' : ''}`} aria-label="Свойства объектов">
          <div className="inspector-heading"><h2><SlidersHorizontal size={16} />Свойства</h2><span className="units-label">см</span><Button className="mobile-close" variant="ghost" size="sm" isIconOnly aria-label="Закрыть свойства" onPress={() => setMobilePanel(null)}><X size={16} /></Button></div>
          <div className="inspector-scroll">
            {selectedFurniture ? <>
              <div className="selection-title"><span className="selection-kind">Предмет</span><Input aria-label="Название предмета" className="object-name" maxLength={100} value={selectedFurniture.name} onChange={e => changeFurniture({ name: e.target.value })} /></div>
              <section className="property-section"><h3>Размеры</h3><div className="field-row"><NumberField label="Ширина" value={selectedFurniture.width} min={10} onChange={width => changeFurniture({ width })} /><NumberField label="Глубина" value={selectedFurniture.depth} min={10} onChange={depth => changeFurniture({ depth })} /></div><div className="field-row"><NumberField label="Поворот" value={selectedFurniture.rotation} min={-360} max={360} suffix="°" step={15} onChange={rotation => changeFurniture({ rotation })} /><Button className="rotate-button" variant="secondary" size="sm" onPress={() => changeFurniture({ rotation: (selectedFurniture.rotation + 90) % 360 })}><RotateCw size={14} />На 90°</Button></div></section>
              <section className="property-section"><h3>Положение</h3><div className="field-row"><NumberField label="X" value={selectedFurniture.x} min={-100000} onChange={x => changeFurniture({ x })} /><NumberField label="Y" value={selectedFurniture.y} min={-100000} onChange={y => changeFurniture({ y })} /></div></section>
              <section className="property-section"><h3>Цвет</h3><div className="swatches">{PALETTE.map(color => <Button key={color} variant="ghost" size="sm" isIconOnly style={{ background: color }} aria-label={`Цвет ${color}`} aria-pressed={selectedFurniture.color === color} className={selectedFurniture.color === color ? 'selected' : ''} onPress={() => changeFurniture({ color })}>{selectedFurniture.color === color && <Check size={14} />}</Button>)}<label className="custom-color"><Plus size={14} /><input aria-label="Свой цвет предмета" type="color" value={selectedFurniture.color} onChange={e => changeFurniture({ color: e.target.value })} /></label></div></section>
              <section className="property-section"><TextField variant="secondary" value={selectedFurniture.url} onChange={url => changeFurniture({ url })}><Label>Ссылка на товар</Label><Input aria-label="Ссылка на товар" placeholder="https://…" /></TextField>{safeUrl(selectedFurniture.url) && <a className="external-link" href={safeUrl(selectedFurniture.url)} target="_blank" rel="noreferrer">Открыть товар ↗</a>}</section>
              <div className="selection-actions"><Button variant="secondary" size="sm" onPress={duplicateSelected}><Copy size={14} />Дублировать</Button><IconButton label="Удалить предмет" variant="danger-soft" onPress={deleteSelected}><Trash2 size={16} /></IconButton></div><p className="property-hint">Потяните за угол рамки, чтобы изменить размер. Круглая ручка поворачивает предмет.</p>
            </> : selectedWall ? <>
              <div className="selection-title"><span className="selection-kind">Конструкция</span><h2>Стена</h2><span className="object-dimensions">{meters(distance(plan.nodes[selectedWall.a], plan.nodes[selectedWall.b]))} м</span></div>
              <section className="property-section"><h3>Размеры</h3><NumberField label="Длина стены" min={10} value={distance(plan.nodes[selectedWall.a], plan.nodes[selectedWall.b])} onChange={length => changePlan(p => resizeWall(p, selectedWall.id, length))} /><NumberField label="Толщина стены" min={5} max={100} value={selectedWall.thickness} onChange={thickness => changePlan(p => ({ ...p, walls: p.walls.map(w => w.id === selectedWall.id ? { ...w, thickness } : w) }))} /></section>
              <section className="property-section"><h3>Начало стены</h3><div className="field-row"><NumberField label="Начало X" value={plan.nodes[selectedWall.a].x} min={-100000} onChange={x => changePlan(p => moveNodes(p, { [selectedWall.a]: { ...p.nodes[selectedWall.a], x } }))} /><NumberField label="Начало Y" value={plan.nodes[selectedWall.a].y} min={-100000} onChange={y => changePlan(p => moveNodes(p, { [selectedWall.a]: { ...p.nodes[selectedWall.a], y } }))} /></div></section>
              <section className="property-section"><h3>Конец стены</h3><div className="field-row"><NumberField label="Конец X" value={plan.nodes[selectedWall.b].x} min={-100000} onChange={x => changePlan(p => moveNodes(p, { [selectedWall.b]: { ...p.nodes[selectedWall.b], x } }))} /><NumberField label="Конец Y" value={plan.nodes[selectedWall.b].y} min={-100000} onChange={y => changePlan(p => moveNodes(p, { [selectedWall.b]: { ...p.nodes[selectedWall.b], y } }))} /></div></section>
              <p className="property-hint">Изменение длины сдвигает конец стены вместе с соседними стенами.</p><Button className="delete-object" variant="danger-soft" size="sm" fullWidth onPress={deleteSelected}><Trash2 size={14} />Удалить стену</Button>
            </> : selectedOpening && openingWall ? <>
              <div className="selection-title"><span className="selection-kind">Проём</span><h2>{selectedOpening.kind === 'door' ? 'Дверь' : 'Окно'}</h2></div>
              <section className="property-section"><h3>Размер и положение</h3><NumberField label="Ширина проёма" value={selectedOpening.width} min={20} max={Math.floor(distance(plan.nodes[openingWall.a], plan.nodes[openingWall.b]) - 4)} onChange={width => changeOpening({ width })} /><NumberField label="От начала стены" value={selectedOpening.t * distance(plan.nodes[openingWall.a], plan.nodes[openingWall.b])} min={0} onChange={n => changeOpening({ t: n / distance(plan.nodes[openingWall.a], plan.nodes[openingWall.b]) })} /><p className="property-hint">Расстояние до центра проёма. Перетаскивайте проём вдоль стены, чтобы изменить положение.</p></section>
              {selectedOpening.kind === 'door' && <Button variant="secondary" size="sm" fullWidth onPress={() => changeOpening({ swing: selectedOpening.swing === 1 ? -1 : 1 })}><RotateCw size={14} />Изменить открывание</Button>}<Button className="delete-object" variant="danger-soft" size="sm" fullWidth onPress={deleteSelected}><Trash2 size={14} />Удалить проём</Button>
            </> : selectedRoom ? <>
              <div className="selection-title"><span className="selection-kind">Помещение</span><h2>{selectedRoom.label?.name ?? 'Комната'}</h2><div className="area-value">{squareMeters(selectedRoom.area)}<span>м²</span></div></div>
              <section className="property-section"><TextField variant="secondary" value={selectedRoom.label?.name ?? ''} onChange={name => roomLabel({ name })}><Label>Название комнаты</Label><Input aria-label="Название комнаты" maxLength={100} placeholder="Комната" /></TextField></section>
              <section className="property-section"><h3>Цвет пола</h3><div className="swatches">{['#f2eee5','#eaf0ec','#f4ede3','#e9eff1','#f0eee9','#ede6ef'].map(color => <Button key={color} variant="ghost" size="sm" isIconOnly aria-label={`Цвет пола ${color}`} aria-pressed={selectedRoom.label?.color === color} style={{ background: color }} onPress={() => roomLabel({ color })} className={selectedRoom.label?.color === color ? 'selected' : ''}>{selectedRoom.label?.color === color && <Check size={14} />}</Button>)}</div></section>
              <p className="property-hint">Площадь считается по осевым линиям стен и меняется вместе с контуром.</p>
            </> : <>
              <div className="selection-title"><h2>План квартиры</h2><div className="area-value">{squareMeters(area)}<span>м²</span></div><p className="area-caption">Площадь по осевым линиям стен</p></div>
              {plannerStatus.enabled && plan.improvement && <section className="property-section improvement-summary"><h3>Идея варианта</h3><p>{plan.improvement.engine==='local'?plan.improvement.summary.replace(' Стены и существующая мебель сохранены.',''):plan.improvement.summary}</p><Button size="sm" variant="secondary" fullWidth onPress={()=>setPlannerOpen(true)}>Задание и покупки</Button></section>}
              <dl className="project-stats"><div><dt>Помещений</dt><dd>{rooms.length}</dd></div><div><dt>Предметов</dt><dd>{plan.furniture.length}</dd></div><div><dt>Стен</dt><dd>{plan.walls.length}</dd></div></dl>
              <section className="property-section"><div className="section-heading"><h3>Текущий вариант</h3><div className="inline-actions"><IconButton label="Переименовать вариант" onPress={() => openModal('rename')}><Pencil size={14} /></IconButton><IconButton label="Удалить вариант" isDisabled={project.variants.length < 2} onPress={() => openModal('deleteVariant')}><Trash2 size={14} /></IconButton></div></div><p className="current-variant">{plan.name}</p><Button variant="secondary" size="sm" fullWidth onPress={() => openModal('variant')}><Copy size={14} />Копировать вариант</Button></section>
              <p className="property-hint selection-tip">Выберите объект на плане, чтобы изменить его размеры и положение.</p>
            </>}

            {plan.background && <section className="property-section background-settings"><div className="section-heading"><h3>Подложка</h3><IconButton label="Удалить подложку" variant="danger-soft" onPress={() => { changePlan(p => { const next = { ...p }; delete next.background; return next; }); setTool('select'); }}><Trash2 size={14} /></IconButton></div><Slider aria-label="Видимость подложки" minValue={5} maxValue={100} step={5} value={Math.round(plan.background.opacity * 100)} onChange={value => changePlan(p => ({ ...p, background: { ...p.background!, opacity: Number(value) / 100 } }))}><Label>Видимость</Label><Slider.Output>{({ state }) => `${state.values[0]}%`}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><Button className="calibration-button" variant="secondary" size="sm" fullWidth onPress={() => { setActiveTool('calibrate'); notice('Отметьте два конца отрезка с известной длиной'); }}><Ruler size={14} />Задать масштаб</Button><details className="background-position"><summary>Положение подложки</summary><div className="field-row"><NumberField label="Подложка X" min={-100000} value={plan.background.x} onChange={x => changePlan(p => ({ ...p, background: { ...p.background!, x } }))} /><NumberField label="Подложка Y" min={-100000} value={plan.background.y} onChange={y => changePlan(p => ({ ...p, background: { ...p.background!, y } }))} /></div></details></section>}
          </div>
          <div className="inspector-footer"><Switch size="sm" isSelected={snap} onChange={setSnap}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><Label>Привязка к сетке</Label></Switch.Content></Switch><span>10 см</span></div>
        </aside>
      </main>

      <footer className="status-bar"><span>Размеры в сантиметрах</span><span className="footer-instruction">Alt — без привязки · Shift — прямой угол</span><Button variant="ghost" size="sm" onPress={() => setModal({ type: 'help' })}><Keyboard size={13} />Клавиши</Button></footer>
      <div className="mobile-controls"><Button variant="ghost" size="sm" onPress={() => openModal('new')}><FilePlus2 size={16} />Новый</Button><Button variant="ghost" size="sm" onPress={() => setMobilePanel('catalog')}><Sofa size={16} />Мебель</Button><Button variant="ghost" size="sm" onPress={() => setMobilePanel('inspector')}><Settings2 size={16} />Свойства</Button><Button variant="ghost" size="sm" onPress={() => canvas.current?.fit()}><Maximize2 size={16} />Весь план</Button></div>
      <input ref={projectInput} type="file" accept=".json,.metr.json" hidden onChange={e => { void importProject(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { void importBackground(e.target.files?.[0]); e.target.value = ''; }} />
      <Suspense fallback={null}>{plannerStatus.enabled && plannerOpen && <PlannerDialog plan={plan} comparisonSource={project.variants.find(p=>p.id===plan.improvement?.sourceId)} agentAvailable={plannerStatus.agentAvailable} capacity={30-project.variants.length} onClose={()=>setPlannerOpen(false)} onApply={(plans,activeId)=>{
        if(projectRef.current.variants.length+plans.length>30){notice('В одном проекте может быть до 30 вариантов');return;}
        const copies=plans.map(p=>({...structuredClone(p),id:uid()})), index=plans.findIndex(p=>p.id===activeId);
        update(p=>({...p,variants:[...p.variants,...copies],activeId:copies[Math.max(0,index)].id}));setSelection(null);setCompareId('');setTool('select');setPlannerOpen(false);notice('Добавлено в проект');
      }}/>}</Suspense>
      <Toast.Provider placement="bottom" maxVisibleToasts={2} width={420} />

      <HeroModal.Backdrop isOpen={modal !== null} onOpenChange={open => { if (!open) setModal(null); }}>
        <HeroModal.Container placement="center" size="sm"><HeroModal.Dialog className="editor-dialog">
          <HeroModal.CloseTrigger aria-label="Закрыть диалог" />
          <HeroModal.Header><HeroModal.Heading>{modalTitle}</HeroModal.Heading></HeroModal.Header>
          {modal?.type === 'help' ? <HeroModal.Body><div className="shortcut-list">{[...TOOLS.map(t => [t.name,t.key]), ['Повернуть предмет на 90°','R'], ['Показать весь план','F'], ['Отменить','⌘ / Ctrl + Z'], ['Повторить','⌘ / Ctrl + Shift + Z'], ['Дублировать предмет','⌘ / Ctrl + D'], ['Сохранить файл','⌘ / Ctrl + S'], ['Удалить выбранное','Delete'], ['Закончить стену / снять выбор','Esc'], ['Переместить холст','Пробел + мышь'], ['Без привязки','Alt'], ['Прямой угол','Shift']].map(([name,key]) => <div key={name}><span>{name}</span><Kbd>{key}</Kbd></div>)}</div></HeroModal.Body> : <form onSubmit={e => { e.preventDefault(); submitModal(); }}>
            <HeroModal.Body>
              {modalDescription && <p className="dialog-description">{modalDescription}</p>}
              {modal?.type !== 'deleteVariant' && <TextField variant="secondary" value={modalValue} onChange={setModalValue}><Label>{modal?.type === 'calibrate' ? 'Длина, см' : 'Название'}</Label><Input aria-label={modal?.type === 'calibrate' ? 'Длина отрезка' : 'Название'} autoFocus maxLength={modal?.type === 'calibrate' ? 10 : 100} /></TextField>}
              {modal?.type === 'new' && <ToggleButtonGroup className="new-plan-options" aria-label="Начальный план" selectionMode="single" disallowEmptySelection isDetached selectedKeys={[creatingDemo ? 'demo' : 'empty']} onSelectionChange={keys => setCreatingDemo([...keys][0] === 'demo')}><ToggleButton id="empty"><FilePlus2 size={20} /><span>Пустой план</span></ToggleButton><ToggleButton id="demo"><Layers2 size={20} /><span>Демо-квартира<small>63 м² с мебелью</small></span></ToggleButton></ToggleButtonGroup>}
            </HeroModal.Body>
            <HeroModal.Footer><Button variant="tertiary" type="button" onPress={() => setModal(null)}>Отмена</Button><Button variant={modal?.type === 'deleteVariant' ? 'danger' : 'primary'} type="submit">{modal?.type === 'new' ? 'Создать план' : modal?.type === 'variant' ? 'Создать копию' : modal?.type === 'deleteVariant' ? 'Удалить' : modal?.type === 'calibrate' ? 'Применить' : 'Сохранить'}</Button></HeroModal.Footer>
          </form>}
        </HeroModal.Dialog></HeroModal.Container>
      </HeroModal.Backdrop>
    </div>
  );
}
