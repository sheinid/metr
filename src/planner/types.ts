export const GOALS = [
  { id: 'cozy', name: 'Уютный отдых', description: 'Собрать место, где приятно проводить вечер' },
  { id: 'space', name: 'Больше воздуха', description: 'Освободить центр и проходы' },
  { id: 'storage', name: 'Удобное хранение', description: 'Найти место вещам без лишних шкафов' },
  { id: 'work', name: 'Работа из дома', description: 'Выделить отдельное рабочее место' },
  { id: 'guests', name: 'Встречи с друзьями', description: 'Собрать места для общения' },
] as const;
export type Goal = typeof GOALS[number]['id'];
export interface DesignBrief {
  roomIds: string[];
  goals: Goal[];
  household: string;
  wishes: string;
  style: 'warm' | 'calm' | 'expressive';
  avoid: string;
  budget: number;
  purchases: boolean;
  lockedIds: string[];
  city: string;
}
export interface PurchaseSpec {
  id: string;
  furnitureId: string;
  name: string;
  width: number;
  depth: number;
  reason: string;
  search: string;
  budget: number;
}
export interface Improvement {
  sourceId: string;
  createdAt: string;
  engine: 'local' | 'agent';
  title: string;
  summary: string;
  tradeoffs: string[];
  changes: string[];
  purchases: PurchaseSpec[];
  brief: DesignBrief;
}
export interface ProductOffer {
  title: string;
  url: string;
  shop: string;
  price: number | null;
  width: number | null;
  depth: number | null;
  fit: 'confirmed' | 'unknown';
  note: string;
  checkedAt: string;
}
export interface ProductSearch { offers: ProductOffer[]; checkedAt: string }
