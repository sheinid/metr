import type { DesignBrief, Improvement, ProductOffer, PurchaseSpec } from './types.ts';
import { GOALS } from './types.ts';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=600):v is string=>typeof v==='string'&&v.length<=max;
const number=(v:unknown,max=1000000):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const texts=(v:unknown,max:number,length=600):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(x=>text(x,length));
export function isBrief(v:unknown):v is DesignBrief {
  return object(v)&&texts(v.roomIds,20,20000)&&v.roomIds.length>0&&texts(v.goals,3)&&v.goals.length>0&&v.goals.every(id=>GOALS.some(g=>g.id===id))&&texts(v.lockedIds,100)&&['warm','calm','expressive'].includes(String(v.style))&&text(v.household,100)&&text(v.wishes)&&text(v.avoid)&&text(v.city,100)&&number(v.budget)&&typeof v.purchases==='boolean';
}
export function isPurchase(v:unknown):v is PurchaseSpec {
  return object(v)&&text(v.id,200)&&text(v.furnitureId,200)&&text(v.name,200)&&number(v.width,10000)&&v.width>=10&&number(v.depth,10000)&&v.depth>=10&&text(v.reason)&&text(v.search)&&number(v.budget);
}
export function isImprovement(v:unknown):v is Improvement {
  return object(v)&&text(v.sourceId,200)&&text(v.createdAt,40)&&Number.isFinite(Date.parse(v.createdAt))&&['local','agent'].includes(String(v.engine))&&text(v.title,100)&&text(v.summary,1500)&&texts(v.tradeoffs,8)&&texts(v.changes,100)&&Array.isArray(v.purchases)&&v.purchases.length<=5&&v.purchases.every(isPurchase)&&isBrief(v.brief);
}
export const SHOPS=['divan.ru','hoff.ru','inmyroom.ru','thefurnish.ru','market.yandex.ru','ozon.ru'];
export function productUrl(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>3000)return;
  try {const u=new URL(value),host=u.hostname.replace(/^www\./,'');
    if(u.protocol!=='https:'||u.username||u.password||u.port||!SHOPS.includes(host))return;
    if(!/\/products?[-/]|\/items\/|_id\d|\/store\/items\//i.test(u.pathname))return;
    u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(yclid|gclid|fbclid)$/.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return;}
}
export function parseOffers(value:unknown,sources:Set<string>,spec:PurchaseSpec,checkedAt:string):ProductOffer[] {
  if(!object(value)||!Array.isArray(value.offers))throw new Error('Не удалось прочитать результаты поиска товаров');
  const seen=new Set<string>(),offers:ProductOffer[]=[];
  for(const v of value.offers.slice(0,8)){
    if(!object(v)||!text(v.title,300)||!text(v.note)||!text(v.shop,100))continue;
    const url=productUrl(v.url);
    if(!url||!sources.has(url)||seen.has(url))continue;
    const price=number(v.price)?v.price:null,width=number(v.width,10000)&&v.width>0?v.width:null,depth=number(v.depth,10000)&&v.depth>0?v.depth:null;
    if(price!==null&&price>spec.budget)continue;
    if((width!==null&&width>spec.width+1)||(depth!==null&&depth>spec.depth+1))continue;
    seen.add(url);offers.push({title:v.title,url,shop:new URL(url).hostname.replace(/^www\./,''),price,width,depth,fit:width!==null&&depth!==null?'confirmed':'unknown',note:v.note,checkedAt});
  }
  return offers.slice(0,3);
}
