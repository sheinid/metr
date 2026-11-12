import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createApiHandler, plannerConfig } from './handler.ts';
const api=createApiHandler(plannerConfig()),root=resolve('dist');
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const server=createServer((req,res)=>{void api(req,res,()=>{void(async()=>{
  try {const pathname=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname),file=resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const target=extname(file)?file:resolve(root,'index.html'),bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'"});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
})()});});
server.listen(Number(process.env.PORT??3000),process.env.HOST??'127.0.0.1',()=>console.log('Метр запущен. Подбор планировок '+(plannerConfig().enabled?'включён':'выключен')+'.'));
