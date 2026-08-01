const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const RELEASE_PATH = path.join(__dirname, 'config', 'release.json');

// --- Release manifest ---
let releaseCache = null;
let releaseMtime = 0;

function getReleaseManifest() {
  try {
    const st = fs.statSync(RELEASE_PATH);
    if (releaseCache && st.mtimeMs === releaseMtime) return releaseCache;
    releaseMtime = st.mtimeMs;
    releaseCache = JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8'));
    return releaseCache;
  } catch {
    return null;
  }
}

// --- Legacy release detection (fallback if release.json missing) ---
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function getLatestRelease() {
  const distDir = path.join(__dirname, 'dist');
  try {
    const files = fs.readdirSync(distDir);
    const patterns = [
      /^Luder-(\d+\.\d+\.\d+)\.AppImage$/,
      /^Luder-Setup-(\d+\.\d+\.\d+)-x64\.exe$/,
      /^Luder Setup (\d+\.\d+\.\d+)\.exe$/,
      /^luder_(\d+\.\d+\.\d+)_amd64\.snap$/,
    ];
    let best = null;
    for (const f of files) {
      for (const p of patterns) {
        const m = f.match(p);
        if (m && (!best || compareVersions(m[1], best.version) > 0)) {
          best = { version: m[1], file: f };
        }
      }
    }
    return best;
  } catch {
    return null;
  }
}

function serverVersion() {
  return process.env.LATEST_VERSION || process.env.APP_VERSION || JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
}

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
      if (size > 16384) { req.resume(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

function safe(v) { return typeof v === 'string' ? v.slice(0, 100) : null; }

function serveFile(res, filepath, filename, method = 'GET') {
  if (!fs.existsSync(filepath)) return json(res, 404, { error: 'not found' });
  const stat = fs.statSync(filepath);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  if (method === 'HEAD') return res.end();
  return fs.createReadStream(filepath).pipe(res);
}

function logUpdateRequest({ platform, arch, current, status, version }) {
  try {
    fs.appendFileSync(path.join(__dirname, 'server.log'), `${new Date().toISOString()} update/latest platform=${platform || '-'} arch=${arch || '-'} current=${current || '-'} status=${status}${version ? ' version=' + version : ''}\n`);
  } catch (_) {}
}

// --- HTTP ---
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': INDEX.length });
    return res.end(INDEX);
  }
  if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true });

  if (req.method === 'GET' && url === '/api/update/latest') {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const platform = parsed.searchParams.get('platform');
    const arch = parsed.searchParams.get('arch');
    const current = parsed.searchParams.get('current') || '';
    const key = `${platform}-${arch}`;
    const release = getReleaseManifest();
    if (!release) return json(res, 500, { error: 'no release manifest' });
    if (!platform || !arch) {
      logUpdateRequest({ platform, arch, current, status: 400 });
      return json(res, 400, { error: 'platform and arch are required' });
    }
    const build = release.builds ? release.builds[key] : null;
    if (!build) {
      logUpdateRequest({ platform, arch, current, status: 404 });
      return json(res, 404, { error: `no build for ${key}` });
    }
    logUpdateRequest({ platform, arch, current, status: 200, version: release.version });
    return json(res, 200, {
      version: release.version,
      minSupportedVersion: release.minSupportedVersion,
      mandatory: release.mandatory,
      releaseNotes: release.releaseNotes || '',
      builds: { [key]: { url: build.url, sha256: build.sha256 } },
    });
  }

  if (req.method === 'GET' && url === '/update') {
    const host = req.headers.host || `localhost:${PORT}`;
    const release = getReleaseManifest() || (() => {
      const r = getLatestRelease();
      if (r) return { version: r.version, builds: { linux: { url: `http://${host}/download/${r.file}`, sha256: '' } } };
      return null;
    })();
    if (release) {
      return json(res, 200, { version: release.version, downloadUrl: release.builds ? release.builds[Object.keys(release.builds)[0]]?.url : `http://${host}/luder.exe`, notes: release.releaseNotes || '' });
    }
    return json(res, 200, { version: serverVersion(), downloadUrl: `http://${host}/luder.exe` });
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && url.startsWith('/download/')) {
    const filename = decodeURIComponent(url.slice('/download/'.length));
    const filepath = path.normalize(path.join(__dirname, 'dist', filename));
    const distDir = path.join(__dirname, 'dist') + path.sep;
    if (!filepath.startsWith(distDir)) return json(res, 404, { error: 'not found' });
    return serveFile(res, filepath, filename, req.method);
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && url === '/luder.exe') {
    const release = getReleaseManifest();
    let file = release?.builds?.['win32-x64']?.url?.replace(/^\/download\//, '');
    if (!file) {
      const r = getLatestRelease();
      if (r && r.file.endsWith('.exe')) file = r.file;
    }
    if (!file) return json(res, 404, { error: 'no windows build' });
    return serveFile(res, path.join(__dirname, 'dist', file), file, req.method);
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

server.listen(PORT, HOST, () => console.log(`ludr-server :${PORT}`));
