// server.js — landing + version + download + registration
const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || '0.1.0';
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const EXE = path.join(__dirname, 'dist', 'ludr-clone.exe');

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

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': INDEX.length });
    return res.end(INDEX);
  }
  if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url === '/update') return json(res, 200, { version: APP_VERSION });

  if (req.method === 'GET' && url === '/ludr-clone.exe') {
    if (!fs.existsSync(EXE)) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="ludr-clone.exe"' });
    return fs.createReadStream(EXE).pipe(res);
  }

  if (req.method === 'GET' && url === '/users') return json(res, 200, stmtAll.all());

  if (req.method === 'POST' && url === '/register') {
    const body = await readBody(req);
    if (!body?.id) return json(res, 400, { error: 'id required' });
    const now = Date.now();
    const existing = stmtGet.get(body.id);
    if (existing) stmtUpdate.run(now, body.provider || null, body.id);
    else stmtInsert.run(body.id, body.username || null, body.os || null, body.version || null, body.tier || 'free', body.provider || null, now, now);
    return json(res, 200, { ok: true, tier: existing?.tier || body.tier || 'free' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`ludr-server :${PORT}`));
