// server.js — landing + version + download + registration
const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || require('./package.json').version;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const EXE = path.join(__dirname, 'dist', 'luder.exe');

// --- Rate limit ---
const rateMap = new Map();
function checkRateLimit(ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  if (rateMap.size > 10000) {
    for (const [key, values] of rateMap) {
      if (!values.some((t) => now - t < windowMs)) rateMap.delete(key);
    }
  }
  const arr = (rateMap.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  rateMap.set(ip, arr);
  return arr.length <= limit;
}

// --- SQLite ---
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, os TEXT, version TEXT, tier TEXT DEFAULT 'free', provider TEXT, registeredAt INTEGER, lastSeenAt INTEGER)`);
const stmtInsert = db.prepare('INSERT INTO users (id, username, os, version, tier, provider, registeredAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const stmtUpdate = db.prepare('UPDATE users SET lastSeenAt = ?, provider = ? WHERE id = ?');
const stmtGet = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtAll = db.prepare('SELECT * FROM users ORDER BY registeredAt DESC');

// --- HTTP ---
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': INDEX.length });
    return res.end(INDEX);
  }
  if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url === '/update') return json(res, 200, { version: APP_VERSION, downloadUrl: `http://100.102.160.84:${PORT}/luder.exe` });

  if (req.method === 'GET' && url === '/luder.exe') {
    if (!fs.existsSync(EXE)) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="luder.exe"' });
    return fs.createReadStream(EXE).pipe(res);
  }

  // /users — admin only
  if (req.method === 'GET' && url === '/users') {
    if (!ADMIN_TOKEN) return json(res, 503, { error: 'admin endpoint is disabled' });
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return json(res, 403, { error: 'forbidden' });
    return json(res, 200, stmtAll.all());
  }

  // /register — rate limit + validation
  if (req.method === 'POST' && url === '/register') {
    const ip = req.socket.remoteAddress;
    if (!checkRateLimit(ip)) return json(res, 429, { error: 'too many requests' });
    let body;
    try { body = await readBody(req); } catch (err) { return json(res, 413, { error: err.message }); }
    if (!body?.id || typeof body.id !== 'string' || body.id.length > 100) return json(res, 400, { error: 'invalid id' });
    const safe = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : null);
    const now = Date.now();
    const existing = stmtGet.get(body.id);
    if (existing) stmtUpdate.run(now, safe(body.provider), body.id);
    else stmtInsert.run(body.id, safe(body.username), safe(body.os), safe(body.version), 'free', safe(body.provider), now, now);
    return json(res, 200, { ok: true, tier: existing?.tier || 'free' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`ludr-server :${PORT}`));
