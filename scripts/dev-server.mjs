// Local server: serves deploy/vercel and implements /api/signal and /api/health with an in-memory store.
// Usage: node scripts/dev-server.mjs [port]     (default 5173)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(fileURLToPath(new URL('..', import.meta.url)), 'deploy/vercel');
const { handleSignal, makeMemoryKv } = require(join(root, 'api/_core.js'));
const kv = makeMemoryKv();
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, multiplayer: true }));
    return;
  }
  if (url.pathname === '/api/ice') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ turn: false, iceServers: null }));
    return;
  }
  if (url.pathname === '/api/signal') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Use POST.' }));
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* handled below */ }
    const out = await handleSignal(kv, url.searchParams.get('op') ?? '', body);
    res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out.json));
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, rel === '/' || rel === '\\' ? 'index.html' : rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});
server.listen(port, () => console.log(`Railhold at http://localhost:${port}`));
