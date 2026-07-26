const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const { version: PKG_VERSION } = require('./package.json');
function appVersion() { return process.env.APP_VERSION || PKG_VERSION; }
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const EXE = path.join(__dirname, 'dist', 'Luder Setup.exe');

// --- Rate limit (cleanup every 60s, not per-request) ---
const rateMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateMap) {
    const alive = times.filter(t => now - t < 60000);
    if (alive.length) rateMap.set(ip, alive);
    else rateMap.delete(ip);
  }
}, 60000).unref();

function checkRateLimit(ip, limit = 5) {
  const now = Date.now();
  const arr = (rateMap.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  rateMap.set(ip, arr);
  return arr.length <= limit;
}

// --- SQLite ---
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tier TEXT DEFAULT 'free', provider TEXT, registeredAt INTEGER, lastSeenAt INTEGER)`);
const stmtUpsert = db.prepare('INSERT INTO users (id, tier, provider, registeredAt, lastSeenAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, provider = excluded.provider');
const stmtGet = db.prepare('SELECT id, tier, registeredAt FROM users WHERE id = ?');

// --- Helpers ---
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 16384) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

function safe(v) { return typeof v === 'string' ? v.slice(0, 100) : null; }

// --- HTTP ---
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': INDEX.length });
    return res.end(INDEX);
  }
  if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url === '/update') {
    const host = req.headers.host || `localhost:${PORT}`;
    return json(res, 200, { version: appVersion(), downloadUrl: `http://${host}/luder.exe` });
  }
  if (req.method === 'GET' && url === '/luder.exe') {
    if (!fs.existsSync(EXE)) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="luder.exe"' });
    return fs.createReadStream(EXE).pipe(res);
  }

  if (req.method === 'POST' && url === '/register') {
    const ip = req.socket.remoteAddress;
    if (!checkRateLimit(ip)) return json(res, 429, { error: 'too many requests' });
    let body;
    try { body = await readBody(req); } catch (err) { return json(res, 413, { error: err.message }); }
    if (!body?.id || typeof body.id !== 'string' || body.id.length > 100) return json(res, 400, { error: 'invalid id' });
    const now = Date.now();
    const existing = stmtGet.get(body.id);
    stmtUpsert.run(body.id, 'free', safe(body.provider), now, now);
    return json(res, 200, { ok: true, tier: existing?.tier || 'free' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`ludr-server :${PORT}`));
