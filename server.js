const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const BACKEND = (process.env.RESOLVER_ORIGIN || 'https://round-rock-1878.onrender.com').replace(/\/$/, '');
const indexPath = path.join(__dirname, 'index.html');

function json(res, status, obj) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
}

async function proxy(req, res, targetPath) {
  try {
    const chunks=[];
    for await (const chunk of req) chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const headers={};
    if (req.headers['content-type']) headers['content-type']=req.headers['content-type'];
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(), 70000);
    const upstream=await fetch(BACKEND + targetPath, {
      method:req.method,
      headers,
      body:(req.method==='GET'||req.method==='HEAD')?undefined:body,
      signal:controller.signal
    });
    clearTimeout(timer);
    const data=Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control':'no-store'
    });
    res.end(data);
  } catch (e) {
    json(res, 502, {ok:false,error:'resolver_proxy_failed',detail:e.name==='AbortError'?'backend wake/response timed out':String(e.message||e),backend:BACKEND});
  }
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url, `http://${req.headers.host}`);
  if(url.pathname==='/health') return json(res,200,{ok:true,service:'round-rock-1878-frontend',build:'field-play-1.10.1-connection-fix'});
  if(url.pathname==='/resolver/health') return proxy(req,res,'/health');
  if(url.pathname==='/resolver/resolve') return proxy(req,res,'/resolve');
  if(url.pathname==='/resolver/field-event') return proxy(req,res,'/field-event');
  if(url.pathname==='/'||url.pathname==='/index.html'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate'});
    return fs.createReadStream(indexPath).pipe(res);
  }
  json(res,404,{ok:false,error:'Not found'});
});
server.listen(PORT,()=>{
  console.log(`Round Rock frontend 1.10.1 listening on :${PORT}`);
  console.log(`Resolver proxy target: ${BACKEND}`);
});
