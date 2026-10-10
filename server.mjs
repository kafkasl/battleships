// Production server: serves the built site and proxies the two model APIs with the keys kept server-side.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const PORT = process.env.PORT || 8080;
const DIST = new URL('./dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

const PROXIES = {
  '/jev': { url: 'https://api.typesafe.ai/v1/systemone', headers: () => ({ Authorization: `Bearer ${process.env.TYPESAFE_API_KEY ?? ''}` }) },
  '/claude': { url: 'https://api.anthropic.com/v1/messages', headers: () => ({ 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }) },
};

http.createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const proxy = PROXIES[path];
  if (proxy && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const r = await fetch(proxy.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...proxy.headers() }, body });
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(await r.text());
    } catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: String(e) })); }
    return;
  }
  let file = join(DIST, path === '/' ? 'index.html' : path);
  try { if (!(await stat(file)).isFile()) file = join(DIST, 'index.html'); } catch { file = join(DIST, 'index.html'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log(`battlefleet on :${PORT}`));
