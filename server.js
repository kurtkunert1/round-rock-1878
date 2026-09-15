const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const indexPath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({ok:true, service:'round-rock-1878-frontend', build:'field-play-1.10-earned-integrity-behaviors'}));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
        res.end('Unable to load Contentstream frontend.');
        return;
      }
      res.writeHead(200, {
        'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma':'no-cache',
        'Expires':'0'
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Contentstream Round Rock frontend 1.10 listening on :${PORT}`);
  console.log('Resolver target is configured in the frontend; backend remains separate.');
});
