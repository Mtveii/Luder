const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// --- Minimal .env loader (zero deps, silent if absent) ---
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] === undefined) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  } catch (_) {}
})();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const MAX_DOWNLOADS = Math.max(1, Number(process.env.MAX_DOWNLOADS) || 5);
const MAX_DOWNLOAD_QUEUE = Math.max(1, Number(process.env.MAX_DOWNLOAD_QUEUE) || 20);
const REGISTER_LIMIT = Math.max(1, Number(process.env.REGISTER_LIMIT) || 5);
const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024;
const SSL_CERT = process.env.SSL_CERT || '';
const SSL_KEY = process.env.SSL_KEY || '';

const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const RELEASE_PATH = path.join(__dirname, 'config', 'release.json');
const LOG_PATH = path.join(__dirname, 'server.log');

// --- Release manifest (mtime-cached) ---
let releaseCache = null;
let releaseMtime = 0;
let releaseJson = null;
let releaseEtag = null;

function getReleaseManifest() {
  try {
    const st = fs.statSync(RELEASE_PATH);
    if (releaseCache && st.mtimeMs === releaseMtime) return releaseCache;
    releaseMtime = st.mtimeMs;
    releaseCache = JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8'));
    releaseJson = JSON.stringify(releaseCache);
    releaseEtag = '"' + crypto.createHash('md5').update(releaseJson).digest('hex') + '"';
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

// --- Precompressed index.html (gzip + brotli, computed once) ---
const indexEtag = '"' + crypto.createHash('md5').update(INDEX).digest('hex') + '"';
const INDEX_GZIP = zlib.gzipSync(INDEX);
const INDEX_BR = zlib.brotliCompressSync(INDEX);

// --- Compression helpers ---
function compressible(acceptEncoding, len) {
  if (!acceptEncoding || len < 1024) return null;
  if (acceptEncoding.includes('br')) return 'br';
  if (acceptEncoding.includes('gzip')) return 'gzip';
  return null;
}

function zipBuffer(buf, encoding) {
  return encoding === 'br' ? zlib.brotliCompressSync(buf) : zlib.gzipSync(buf);
}

// --- Rate limit (per-IP token window, cleanup every 60s) ---
const rateMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateMap) {
    const alive = times.filter(t => now - t < 60000);
    if (alive.length) rateMap.set(ip, alive);
    else rateMap.delete(ip);
  }
}, 60000).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

function checkRateLimit(ip, limit) {
  const now = Date.now();
  const arr = (rateMap.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  rateMap.set(ip, arr);
  return arr.length <= limit;
}

// --- Download concurrency limiter (protect from download storms) ---
let activeDownloads = 0;
const downloadQueue = [];

function acquireDownload() {
  if (activeDownloads < MAX_DOWNLOADS) {
    activeDownloads++;
    return null;
  }
  if (downloadQueue.length >= MAX_DOWNLOAD_QUEUE) return 'busy';
  return new Promise((resolve) => downloadQueue.push(resolve));
}

function releaseDownload() {
  activeDownloads--;
  const next = downloadQueue.shift();
  if (next) {
    activeDownloads++;
    next();
  }
}

// Захват слота на время ответа; освобождение ровно один раз (завершение/обрыв клиента)
async function withDownloadSlot(req, res, fn) {
  const gate = await acquireDownload();
  if (gate === 'busy') return sendJson(req, res, 503, { error: 'server busy, retry later' });
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    releaseDownload();
  };
  res.on('close', releaseOnce);
  try {
    return await fn();
  } catch (err) {
    releaseOnce();
    throw err;
  }
}

// --- SQLite (WAL + tuned pragmas) ---
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -16384');
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('mmap_size = 268435456');
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tier TEXT DEFAULT 'free', provider TEXT, registeredAt INTEGER, lastSeenAt INTEGER)`);
const stmtUpsert = db.prepare('INSERT INTO users (id, tier, provider, registeredAt, lastSeenAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, provider = excluded.provider');
const stmtGet = db.prepare('SELECT id, tier, registeredAt FROM users WHERE id = ?');

// --- Log with rotation (keep last .1) ---
function writeLog(line) {
  try {
    const st = fs.statSync(LOG_PATH);
    if (st.size > LOG_MAX_BYTES) {
      fs.renameSync(LOG_PATH, LOG_PATH + '.1');
    }
  } catch (_) {}
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (_) {}
}

function logUpdateRequest({ platform, arch, current, status, version }) {
  writeLog(`${new Date().toISOString()} update/latest platform=${platform || '-'} arch=${arch || '-'} current=${current || '-'} status=${status}${version ? ' version=' + version : ''}\n`);
}

// --- Response helpers ---
function sendJson(req, res, code, data, etag) {
  const body = Buffer.from(JSON.stringify(data));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
  if (etag) {
    headers['ETag'] = etag;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'X-Content-Type-Options': 'nosniff' });
      return res.end();
    }
  }
  const enc = compressible(req.headers['accept-encoding'], body.length);
  if (enc) {
    headers['Content-Encoding'] = enc;
    const zipped = zipBuffer(body, enc);
    headers['Content-Length'] = zipped.length;
    res.writeHead(code, headers);
    return res.end(zipped);
  }
  headers['Content-Length'] = body.length;
  res.writeHead(code, headers);
  res.end(body);
}

function sendIndex(req, res, code = 200) {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  };
  if (req.headers['if-none-match'] === indexEtag) {
    res.writeHead(304, { 'ETag': indexEtag });
    return res.end();
  }
  headers['ETag'] = indexEtag;
  const enc = compressible(req.headers['accept-encoding'], INDEX.length);
  if (enc) {
    headers['Content-Encoding'] = enc;
    res.writeHead(code, headers);
    return res.end(enc === 'br' ? INDEX_BR : INDEX_GZIP);
  }
  headers['Content-Length'] = INDEX.length;
  res.writeHead(code, headers);
  res.end(INDEX);
}

function serveFile(req, res, filepath, filename, method = 'GET') {
  let stat;
  try { stat = fs.statSync(filepath); } catch { return sendJson(req, res, 404, { error: 'not found' }); }
  const etag = '"' + stat.size + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
  const base = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'ETag': etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.end();
  }
  res.writeHead(200, base);
  if (method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filepath);
  stream.on('error', () => {
    if (!res.headersSent) {
      try { sendJson(req, res, 500, { error: 'read failed' }); } catch (_) {}
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    const onData = (c) => {
      if (rejected) return;
      size += c.length;
      if (size > 16384) {
        rejected = true;
        req.removeListener('data', onData);
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => { if (!rejected) { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } } });
    req.on('error', reject);
  });
}

function safe(v) { return typeof v === 'string' ? v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50) : null; }

// --- HTTP(S) ---
const handler = async (req, res) => {
  try {
    let url;
    try { url = req.url.split('?')[0]; } catch { url = '/'; }

    if ((req.method === 'GET' || req.method === 'HEAD') && url === '/') return sendIndex(req, res);

    if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health') return sendJson(req, res, 200, { ok: true });

    if (req.method === 'GET' && url === '/api/update/latest') {
      let parsed;
      try { parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return sendJson(req, res, 400, { error: 'bad request' }); }
      const platform = parsed.searchParams.get('platform');
      const arch = parsed.searchParams.get('arch');
      const current = parsed.searchParams.get('current') || '';
      const key = `${platform}-${arch}`;
      const release = getReleaseManifest();
      if (!release) return sendJson(req, res, 500, { error: 'no release manifest' });
      if (!platform || !arch) {
        logUpdateRequest({ platform, arch, current, status: 400 });
        return sendJson(req, res, 400, { error: 'platform and arch are required' });
      }
      const build = release.builds ? release.builds[key] : null;
      if (!build) {
        logUpdateRequest({ platform, arch, current, status: 404 });
        return sendJson(req, res, 404, { error: `no build for ${key}` });
      }
      logUpdateRequest({ platform, arch, current, status: 200, version: release.version });
      return sendJson(req, res, 200, {
        version: release.version,
        minSupportedVersion: release.minSupportedVersion,
        mandatory: release.mandatory,
        releaseNotes: release.releaseNotes || '',
        builds: { [key]: { url: build.url, sha256: build.sha256 } },
      }, releaseEtag);
    }

    if (req.method === 'GET' && url === '/update') {
      const host = req.headers.host || `localhost:${PORT}`;
      const release = getReleaseManifest() || (() => {
        const r = getLatestRelease();
        if (r) return { version: r.version, builds: { linux: { url: `http://${host}/download/${r.file}`, sha256: '' } } };
        return null;
      })();
      if (release) {
        return sendJson(req, res, 200, { version: release.version, downloadUrl: release.builds ? release.builds[Object.keys(release.builds)[0]]?.url : `http://${host}/luder.exe`, notes: release.releaseNotes || '' });
      }
      return sendJson(req, res, 200, { version: serverVersion(), downloadUrl: `http://${host}/luder.exe` });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.startsWith('/download/')) {
      let filename;
      try { filename = decodeURIComponent(url.slice('/download/'.length)); } catch { return sendJson(req, res, 400, { error: 'bad request' }); }
      const filepath = path.normalize(path.join(__dirname, 'dist', filename));
      const distDir = path.join(__dirname, 'dist') + path.sep;
      if (!filepath.startsWith(distDir)) return sendJson(req, res, 404, { error: 'not found' });

      return withDownloadSlot(req, res, () => serveFile(req, res, filepath, filename, req.method));
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url === '/luder.exe') {
      const release = getReleaseManifest();
      let file = release?.builds?.['win32-x64']?.url?.replace(/^\/download\//, '');
      if (file) { try { file = decodeURIComponent(file); } catch { file = null; } }
      if (!file) {
        const r = getLatestRelease();
        if (r && r.file.endsWith('.exe')) file = r.file;
      }
      if (!file) return sendJson(req, res, 404, { error: 'no windows build' });

      return withDownloadSlot(req, res, () => serveFile(req, res, path.join(__dirname, 'dist', file), file, req.method));
    }

    if (req.method === 'POST' && url === '/register') {
      const ip = clientIp(req);
      if (!checkRateLimit(ip, REGISTER_LIMIT)) return sendJson(req, res, 429, { error: 'too many requests' });
      let body;
      try { body = await readBody(req); } catch (err) { return sendJson(req, res, 413, { error: err.message }); }
      if (!body?.id || typeof body.id !== 'string' || body.id.length > 100) return sendJson(req, res, 400, { error: 'invalid id' });
      const now = Date.now();
      const existing = stmtGet.get(body.id);
      const registeredAt = existing?.registeredAt || now;
      stmtUpsert.run(body.id, 'free', safe(body.provider), registeredAt, now);
      return sendJson(req, res, 200, { ok: true, tier: existing?.tier || 'free' });
    }

    return sendJson(req, res, 404, { error: 'not found' });
  } catch (err) {
    try { sendJson(req, res, 500, { error: 'internal error' }); } catch (_) {}
  }
};

const server = SSL_CERT && SSL_KEY
  ? https.createServer({ cert: fs.readFileSync(SSL_CERT), key: fs.readFileSync(SSL_KEY) }, handler)
  : http.createServer(handler);

server.keepAliveTimeout = 5000;
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.maxRequestsPerSocket = 200;

server.listen(PORT, HOST, () => {
  console.log(`ludr-server ${SSL_CERT ? 'https' : 'http'} :${PORT} (downloads=${MAX_DOWNLOADS} proxy=${TRUST_PROXY})`);
});

// --- Graceful shutdown ---
function shutdown(sig) {
  console.log(`received ${sig}, shutting down`);
  server.close(() => {
    try { db.close(); } catch (_) {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => writeLog(`${new Date().toISOString()} unhandledRejection ${(err && err.stack) || err}\n`));
