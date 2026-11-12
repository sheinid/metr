import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseProject } from '../src/storage.ts';
import { generateLayouts, validateBrief } from '../src/planner/layout.ts';
import { isBrief, isPurchase } from '../src/planner/contracts.ts';
import { findProducts, reviewLayouts } from './agent.ts';
import type { AgentConfig } from './agent.ts';
export interface PlannerConfig extends AgentConfig { enabled: boolean }
export function plannerConfig(env:Record<string,string|undefined>=process.env):PlannerConfig {
  return {enabled:env.METR_PLANNER_ENABLED==='true',apiKey:env.OPENAI_API_KEY,model:env.METR_AI_MODEL};
}
export function createApiHandler(config:PlannerConfig){
  const limits=new Map<string,{count:number;until:number}>();let pending=0;
  const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  return async(req:IncomingMessage,res:ServerResponse,next?:()=>void)=>{
    const path=(req.url??'').split('?')[0];if(!path.startsWith('/api/planner/')){if(next)next();else send(res,404,{error:'Страница не найдена'});return;}
    if(path==='/api/planner/status'&&req.method==='GET'){send(res,200,config.enabled?{enabled:true,agentAvailable:!!(config.apiKey&&config.model)}:{enabled:false});return;}
    if(!config.enabled){send(res,403,{error:'Подбор планировки пока недоступен'});return;}
    if(req.method!=='POST'||!['/api/planner/generate','/api/planner/products'].includes(path)){send(res,404,{error:'Метод не найден'});return;}
    const origin=req.headers.origin;
    if(!origin||(()=>{try{return new URL(origin).host!==req.headers.host;}catch{return true;}})()){send(res,403,{error:'Запрос должен прийти из редактора'});return;}
    if(!req.headers['content-type']?.startsWith('application/json')){send(res,415,{error:'Ожидался JSON'});return;}
    const now=Date.now(),ip=req.socket.remoteAddress??'local';
    for(const [key,value]of limits)if(value.until<now)limits.delete(key);
    const usage=limits.get(ip)??{count:0,until:now+600000};
    if(usage.count>=12||pending>=2){send(res,429,{error:'Слишком много запросов. Попробуйте через несколько минут.'});return;}
    usage.count++;limits.set(ip,usage);pending++;
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      req.setEncoding('utf8');
      let body='';for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>512000){send(res,413,{error:'План слишком большой для подбора'});return;}}
      let data;try{data=JSON.parse(body);}catch{send(res,400,{error:'Не удалось прочитать задание'});return;}
      if(!data||typeof data!=='object'||Array.isArray(data)){send(res,400,{error:'Некорректное задание'});return;}
      if(path.endsWith('/generate')){
        const plan=parseProject(JSON.stringify({version:1,name:'Подбор',activeId:data.plan?.id,variants:[data.plan]})).variants[0];
        const brief=validateBrief(plan,data.brief);if(!['local','agent'].includes(data.mode)){send(res,400,{error:'Выберите способ подбора'});return;}
        if(data.mode==='agent'&&(!config.apiKey||!config.model)){send(res,503,{error:'Агент не подключён. Используйте подбор по размерам.'});return;}
        const candidates=generateLayouts(plan,brief,data.mode==='agent'?6:3);
        const layouts=data.mode==='agent'?await reviewLayouts(config,plan,brief,candidates,controller.signal):candidates;
        send(res,200,{layouts});
      }else{
        if(!isPurchase(data.purchase)||!isBrief(data.brief)){send(res,400,{error:'Некорректное задание на подбор мебели'});return;}
        if(!data.brief.purchases||data.purchase.budget>data.brief.budget){send(res,400,{error:'Покупка выходит за рамки задания'});return;}
        if(!config.apiKey||!config.model){send(res,503,{error:'Поиск товаров агентом не подключён'});return;}
        send(res,200,await findProducts(config,data.purchase,data.brief,controller.signal));
      }
    }catch(error){if(!controller.signal.aborted&&!res.writableEnded)send(res,400,{error:error instanceof Error&&error.name!=='SyntaxError'?error.message:'Не удалось обработать ответ. Попробуйте ещё раз.'});}
    finally{pending--;}
  };
}
