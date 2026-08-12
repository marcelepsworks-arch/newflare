'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const root = __dirname;

const mime = {
  '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webm':'video/webm', '.mp4':'video/mp4', '.svg':'image/svg+xml'
};

const server = http.createServer((req,res)=>{
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if(reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(root, reqPath);

  fs.stat(filePath, (err, stats)=>{
    if(err || !stats.isFile()){
      // fallback to index.html for SPA
      const indexPath = path.join(root,'index.html');
      fs.readFile(indexPath, (err2,data)=>{
        if(err2){ res.writeHead(500); res.end('Server error'); return; }
        res.writeHead(200, {'Content-Type':'text/html'});
        res.end(data);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = mime[ext] || 'application/octet-stream';
    // ES modules are cached aggressively; during development a stale module graph looks
    // exactly like "the app is broken", so never let the browser reuse one.
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store, must-revalidate'});
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(port, ()=>{
  console.log(`Newflare static server running at http://localhost:${port}`);
});
