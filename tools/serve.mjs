/* 临时静态服务器（只用于自动化测试）：node tools/serve.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = Number(process.env.PORT || 8931);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/slow')) {
    const ms = Number(new URL(req.url, 'http://x').searchParams.get('ms') || 300);
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); }, ms);
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/report')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fs.writeFileSync(path.join('tools', 'report.txt'), body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!target.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('serving http://127.0.0.1:' + PORT));

process.on('uncaughtException', (e) => {
  console.error('serve 失败：' + e.message);
  process.exit(1);
});
