const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (e) {
    failed++;
    failures.push({ name, message: e.message });
    process.stdout.write(`  FAIL  ${name}\n        ${e.message}\n`);
  }
}

function get(pathname, opts = {}) {
  return fetch(BASE + pathname, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
}

async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'luder-srv-test-'));
  for (const f of ['server.js', 'index.html', 'package.json']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  }
  fs.mkdirSync(path.join(tmp, 'config'));
  fs.mkdirSync(path.join(tmp, 'dist'));

  const exeContent = crypto.randomBytes(2 * 1024 * 1024);
  const appImageContent = crypto.randomBytes(3 * 1024 * 1024);
  fs.writeFileSync(path.join(tmp, 'dist', 'Luder Setup.exe'), exeContent);
  fs.writeFileSync(path.join(tmp, 'dist', 'Luder-1.0.0.AppImage'), appImageContent);
  fs.writeFileSync(path.join(tmp, 'secret-config.json'), '{"secret":"do-not-leak"}');

  fs.writeFileSync(path.join(tmp, 'config', 'release.json'), JSON.stringify({
    version: '1.0.0',
    minSupportedVersion: '0.10.0',
    mandatory: false,
    releaseNotes: 'test notes',
    builds: {
      'win32-x64': { url: '/download/Luder%20Setup.exe', sha256: crypto.createHash('sha256').update(exeContent).digest('hex') },
      'linux-x64': { url: '/download/Luder-1.0.0.AppImage', sha256: crypto.createHash('sha256').update(appImageContent).digest('hex') },
    },
  }));

  const server = spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'), PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/health'); break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  return { server, tmp };
}

(async () => {
  const { server, tmp } = await setup();

  // ---------- GET / ----------
  await check('GET / → 200 text/html', async () => {
    const res = await get('/');
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/html'));
  });

  // ---------- /health ----------
  await check('GET /health → 200 {ok:true}', async () => {
    const res = await get('/health');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
  });

  // ---------- /api/update/latest ----------
  await check('/latest: валидный запрос win32-x64 → 200, полная схема', async () => {
    const res = await get('/api/update/latest?platform=win32&arch=x64&current=0.15.0');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.version, '1.0.0');
    assert.strictEqual(data.minSupportedVersion, '0.10.0');
    assert.strictEqual(data.mandatory, false);
    assert.strictEqual(data.releaseNotes, 'test notes');
    assert.ok(data.builds['win32-x64'], 'builds по ключу платформы');
    assert.ok(data.builds['win32-x64'].url.includes('Luder%20Setup.exe'));
    assert.match(data.builds['win32-x64'].sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(Object.keys(data.builds).length, 1, 'только запрошенный билд');
  });

  await check('/latest: linux-x64 тоже работает', async () => {
    const res = await get('/api/update/latest?platform=linux&arch=x64&current=0.15.0');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.builds['linux-x64']);
  });

  await check('/latest: без platform → 400', async () => {
    const res = await get('/api/update/latest?arch=x64');
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error, 'platform and arch are required');
  });

  await check('/latest: без arch → 400', async () => {
    const res = await get('/api/update/latest?platform=win32');
    assert.strictEqual(res.status, 400);
  });

  await check('/latest: совсем без параметров → 400', async () => {
    const res = await get('/api/update/latest');
    assert.strictEqual(res.status, 400);
  });

  await check('/latest: неизвестная платформа → 404', async () => {
    const res = await get('/api/update/latest?platform=win32&arch=arm64');
    assert.strictEqual(res.status, 404);
  });

  await check('/latest: unknown platform-arch combo → 404', async () => {
    const res = await get('/api/update/latest?platform=dos&arch=8086');
    assert.strictEqual(res.status, 404);
  });

  await check('/latest: только GET (POST → 404)', async () => {
    const res = await get('/api/update/latest', { method: 'POST' });
    assert.strictEqual(res.status, 404);
  });

  await check('/latest: не-числовой current не валится', async () => {
    const res = await get('/api/update/latest?platform=win32&arch=x64&current=garbage');
    assert.strictEqual(res.status, 200);
  });

  await check('/latest: без current (необязательный) → 200', async () => {
    const res = await get('/api/update/latest?platform=win32&arch=x64');
    assert.strictEqual(res.status, 200);
  });

  await check('/latest: URL-эскейп платформы не обходит 400', async () => {
    const res = await get('/api/update/latest?platform=%20&arch=x64');
    assert.strictEqual(res.status, 404, 'пробел → битый ключ → 404');
  });

  // ---------- /update (legacy) ----------
  await check('/update: 200 + версия', async () => {
    const res = await get('/update');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.version, '1.0.0');
    assert.ok(data.downloadUrl, 'downloadUrl есть');
  });

  // ---------- /download/* ----------
  await check('/download: существующий файл GET → 200 + Content-Length', async () => {
    const res = await get('/download/Luder-1.0.0.AppImage');
    assert.strictEqual(res.status, 200);
    const body = await res.arrayBuffer();
    assert.strictEqual(body.byteLength, 3 * 1024 * 1024, 'тело полное');
    assert.strictEqual(Number(res.headers.get('content-length')), 3 * 1024 * 1024);
  });

  await check('/download: существующий файл HEAD → 200, пустое тело', async () => {
    const res = await get('/download/Luder-1.0.0.AppImage', { method: 'HEAD' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Number(res.headers.get('content-length')), 3 * 1024 * 1024);
    assert.strictEqual(await res.text(), '', 'HEAD не отдаёт тело');
  });

  await check('/download: URL-эскейпированный пробел (Luder%20Setup.exe)', async () => {
    const res = await get('/download/Luder%20Setup.exe');
    assert.strictEqual(res.status, 200);
    const body = await res.arrayBuffer();
    assert.strictEqual(body.byteLength, 2 * 1024 * 1024);
  });

  await check('/download: несуществующий файл → 404', async () => {
    const res = await get('/download/nope.bin');
    assert.strictEqual(res.status, 404);
  });

  await check('/download: файл вне dist не отдаётся (traversal ../secret-config.json)', async () => {
    const res = await get('/download/..%2Fsecret-config.json');
    assert.strictEqual(res.status, 404, 'выход за dist заблокирован');
  });

  await check('/download: путь за пределами dist не отдаётся', async () => {
    const res = await get('/download/..%2Fpackage.json');
    assert.strictEqual(res.status, 404, 'path traversal заблокирован');
  });

  await check('/download: полный traversal ../..%2Fconfig%2Frelease.json', async () => {
    const res = await get('/download/..%2F..%2Fconfig%2Frelease.json');
    assert.strictEqual(res.status, 404, 'выход за dist заблокирован');
  });

  await check('/download: data.db сервера недоступен', async () => {
    const res = await get('/download/..%2Fdata.db');
    assert.strictEqual(res.status, 404, 'база недоступна');
  });

  // ---------- /luder.exe ----------
  await check('/luder.exe: GET → 200 (апгрейд с Luder Setup.exe)', async () => {
    const res = await get('/luder.exe');
    assert.strictEqual(res.status, 200);
  });

  await check('/luder.exe: HEAD → 200 пустое тело', async () => {
    const res = await get('/luder.exe', { method: 'HEAD' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), '');
  });

  // ---------- /register ----------
  await check('/register: тело > 16KB → 413 (первым, до rate limit)', async () => {
    const res = await get('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'big-' + 'a'.repeat(20 * 1024) }) });
    assert.strictEqual(res.status, 413);
  });

  await check('/register: валидный → 200 {ok:true,tier}', async () => {
    const res = await get('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'dev-' + Date.now(), provider: 'openrouter' }) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.tier, 'free');
  });

  await check('/register: без id → 400', async () => {
    const res = await get('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.strictEqual(res.status, 400);
  });

  await check('/register: id не строка → 400', async () => {
    const res = await get('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 123 }) });
    assert.strictEqual(res.status, 400);
  });

  await check('/register: id > 100 символов → 400', async () => {
    const res = await get('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x'.repeat(101) }) });
    assert.strictEqual(res.status, 400);
  });

  // ---------- rate limit (отдельный сервер, чтобы счётчик был чистый) ----------
  await check('rate limit: 6-й запрос подряд → 429', async () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'luder-rl-test-'));
    fs.copyFileSync(path.join(tmp, 'server.js'), path.join(tmp2, 'server.js'));
    fs.copyFileSync(path.join(tmp, 'index.html'), path.join(tmp2, 'index.html'));
    fs.copyFileSync(path.join(tmp, 'package.json'), path.join(tmp2, 'package.json'));
    fs.mkdirSync(path.join(tmp2, 'config'));
    fs.mkdirSync(path.join(tmp2, 'dist'));
    fs.copyFileSync(path.join(tmp, 'config', 'release.json'), path.join(tmp2, 'config', 'release.json'));
    const PORT2 = 3198;
    const server2 = spawn('node', ['server.js'], { cwd: tmp2, env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'), PORT: String(PORT2), HOST: '127.0.0.1' }, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      try { await fetch(`http://127.0.0.1:${PORT2}/health`); break; } catch { await new Promise(r => setTimeout(r, 200)); }
    }
    const reg = (id) => fetch(`http://127.0.0.1:${PORT2}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });

    const bad = await fetch(`http://127.0.0.1:${PORT2}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json{' });
    assert.strictEqual(bad.status, 400, 'битое JSON-тело → 400 invalid id');

    for (let i = 0; i < 4; i++) {
      const res = await reg('rl-' + i + '-' + Date.now());
      assert.strictEqual(res.status, 200, `запрос ${i + 1} должен пройти`);
    }
    const res6 = await reg('rl-6-' + Date.now());
    assert.strictEqual(res6.status, 429, '6-й запрос в минуту блокируется');
    server2.kill('SIGTERM');
    fs.rmSync(tmp2, { recursive: true, force: true });
  });

  // ---------- несуществующий роут ----------
  await check('несуществующий роут → 404 json', async () => {
    const res = await get('/api/whatever');
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).error, 'not found');
  });

  // ---------- server.log ----------
  await check('server.log: пишутся запросы update/latest', async () => {
    const log = fs.readFileSync(path.join(tmp, 'server.log'), 'utf8');
    assert.ok(log.includes('update/latest'), 'событие записано');
    assert.ok(log.includes('platform=win32'), 'platform в логе');
    assert.ok(log.includes('status=200'), 'статус в логе');
    assert.ok(log.includes('status=400'), '400 тоже логируется');
    assert.ok(log.includes('status=404'), '404 тоже логируется');
  });

  server.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.error('\nFAILURES:');
    for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
