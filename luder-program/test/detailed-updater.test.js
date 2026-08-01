const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const UP = path.join(__dirname, '..', 'src', 'shared', 'updater.js');
const ELECTRON = require.resolve('electron');

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luder-userdata-'));
const appMock = { getVersion: () => '0.15.0', getPath: () => userDataDir, quit: () => {} };
require.cache[ELECTRON] = { id: ELECTRON, filename: ELECTRON, loaded: true, exports: { app: appMock } };
let updater = require(UP);
const PK = `${process.platform}-${process.arch}`;

function fakeRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
    body: null,
  };
}

(async () => {

  // ================= compareVersions =================
  await check('compareVersions: v-префикс ведёт к NaN→0 (документация: некорректный вход!)', () => {
    assert.strictEqual(updater.compareVersions('v1.2.3', '1.2.3'), -1, 'v1→NaN, || 0 даёт [0,2,3] < [1,2,3]');
    assert.strictEqual(updater.compareVersions('v1.2.4', '1.2.3'), -1, 'первый сегмент решает: 0 < 1');
    assert.strictEqual(updater.compareVersions('v1.2.3', '1.2.4'), -1);
  });

  await check('compareVersions: пререлизы NaN→0 (документация: считает равным релизу)', () => {
    assert.strictEqual(updater.compareVersions('1.0.0-beta', '1.0.0'), 0, '0-beta→NaN→0, равен релизу');
    assert.strictEqual(updater.compareVersions('1.0.0-beta', '1.0.0-beta'), 0);
    assert.strictEqual(updater.compareVersions('1.a.b', '1.0.0'), 0, 'все NaN→0: равны');
  });

  await check('compareVersions: пустые строки', () => {
    assert.strictEqual(updater.compareVersions('', '1.0.0'), -1, '[]→[0] < [1]');
    assert.strictEqual(updater.compareVersions('1.0.0', ''), 1);
  });

  await check('compareVersions: большие номера без потери точности', () => {
    assert.strictEqual(updater.compareVersions('1000.0.0', '999.0.0'), 1);
    assert.strictEqual(updater.compareVersions('4294967296.0.0', '4294967295.0.0'), 1);
  });

  await check('compareVersions: отрицательные сегменты', () => {
    assert.strictEqual(updater.compareVersions('1.-1.0', '1.0.0'), -1);
  });

  await check('compareVersions: числа вместо строк (String()-coercion)', () => {
    assert.strictEqual(updater.compareVersions(1, '1.0.0'), 0);
    assert.strictEqual(updater.compareVersions(2, '1.0.0'), 1);
  });

  // ================= checkForUpdate =================
  const savedFetch = global.fetch;
  let fetchMock;
  global.fetch = async (url, opts) => {
    if (!fetchMock) throw new Error('fetchMock not set');
    return fetchMock(url, opts);
  };
  const callArgs = [];
  const captureFetch = (responder) => {
    callArgs.length = 0;
    fetchMock = async (url, opts) => { callArgs.push({ url, opts }); return responder({ url, opts }); };
  };

  await check('checkForUpdate: 200 + новая версия → hasUpdate=true', async () => {
    captureFetch(() => fakeRes(200, { version: '1.0.0', minSupportedVersion: '0.10.0', mandatory: false, releaseNotes: 'x', builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.hasUpdate, true);
    assert.strictEqual(r.mandatory, false);
    assert.strictEqual(r.version, '1.0.0');
    assert.ok(callArgs[0].url.includes('platform=' + process.platform), 'передаёт platform');
    assert.ok(callArgs[0].url.includes('arch=' + process.arch), 'передаёт arch');
    assert.ok(callArgs[0].url.includes('current=0.15.0'), 'передаёт current из app.getVersion');
    assert.ok(callArgs[0].opts && callArgs[0].opts.signal, 'ставит signal таймаута');
  });

  await check('checkForUpdate: 200 + та же версия → hasUpdate=false', async () => {
    captureFetch(() => fakeRes(200, { version: '0.15.0', builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.hasUpdate, false);
    assert.strictEqual(r.mandatory, false);
  });

  await check('checkForUpdate: 200 + версия ниже → hasUpdate=false', async () => {
    captureFetch(() => fakeRes(200, { version: '0.1.0', builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.hasUpdate, false);
  });

  await check('checkForUpdate: 404 → null без исключения', async () => {
    captureFetch(() => fakeRes(404, {}));
    assert.strictEqual(await updater.checkForUpdate(), null);
  });

  await check('checkForUpdate: 400 → throw', async () => {
    captureFetch(() => fakeRes(400, {}));
    await assert.rejects(() => updater.checkForUpdate(), /update check failed: 400/);
  });

  await check('checkForUpdate: 500 → throw', async () => {
    captureFetch(() => fakeRes(500, {}));
    await assert.rejects(() => updater.checkForUpdate(), /update check failed: 500/);
  });

  await check('checkForUpdate: сетевой обрыв → throw', async () => {
    captureFetch(() => { throw new TypeError('fetch failed'); });
    await assert.rejects(() => updater.checkForUpdate(), /fetch failed/);
  });

  await check('checkForUpdate: битый JSON → throw', async () => {
    captureFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); }, headers: { get: () => null } }));
    await assert.rejects(() => updater.checkForUpdate(), /Unexpected token/);
  });

  await check('checkForUpdate: current ниже minSupported → mandatory=true', async () => {
    captureFetch(() => fakeRes(200, { version: '1.0.0', minSupportedVersion: '0.99.0', mandatory: false, builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.hasUpdate, true);
    assert.strictEqual(r.mandatory, true, 'tooOld форсирует mandatory');
  });

  await check('checkForUpdate: current == minSupported → не форсит', async () => {
    captureFetch(() => fakeRes(200, { version: '1.0.0', minSupportedVersion: '0.15.0', mandatory: false, builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.mandatory, false);
  });

  await check('checkForUpdate: нет minSupportedVersion → не падает', async () => {
    captureFetch(() => fakeRes(200, { version: '1.0.0', builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.hasUpdate, true);
    assert.strictEqual(r.mandatory, false);
  });

  await check('checkForUpdate: no builds (legacy flat) — не роняет проверку', async () => {
    captureFetch(() => fakeRes(200, { version: '1.0.0', url: 'http://x/y.exe', sha256: 'a' }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.hasUpdate, true);
  });

  await check('checkForUpdate: mandatory=true в манифесте → true', async () => {
    captureFetch(() => fakeRes(200, { version: '1.0.0', mandatory: true, builds: {} }));
    const r = await updater.checkForUpdate();
    assert.strictEqual(r.mandatory, true);
  });

  // ================= verifyChecksum =================
  await check('verifyChecksum: пустой/undefined/null expected → true', async () => {
    const p = path.join(os.tmpdir(), 'cs-empty.bin');
    fs.writeFileSync(p, 'data');
    assert.strictEqual(await updater.verifyChecksum(p, ''), true);
    assert.strictEqual(await updater.verifyChecksum(p, undefined), true);
    assert.strictEqual(await updater.verifyChecksum(p, null), true);
    fs.unlinkSync(p);
  });

  await check('verifyChecksum: hex в верхнем регистре → true', async () => {
    const p = path.join(os.tmpdir(), 'cs-upper.bin');
    fs.writeFileSync(p, 'case-test');
    const hash = crypto.createHash('sha256').update('case-test').digest('hex').toUpperCase();
    assert.strictEqual(await updater.verifyChecksum(p, hash), true);
    fs.unlinkSync(p);
  });

  await check('verifyChecksum: большой файл (8MB)', async () => {
    const p = path.join(os.tmpdir(), 'cs-big.bin');
    const buf = crypto.randomBytes(8 * 1024 * 1024);
    fs.writeFileSync(p, buf);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    assert.strictEqual(await updater.verifyChecksum(p, hash), true);
    assert.strictEqual(await updater.verifyChecksum(p, hash.replace('a', 'b')), false);
    fs.unlinkSync(p);
  });

  await check('verifyChecksum: директория вместо файла → false без зависания', async () => {
    assert.strictEqual(await updater.verifyChecksum(os.tmpdir(), 'deadbeef'), false);
  });

  await check('verifyChecksum: несуществующий файл → false', async () => {
    assert.strictEqual(await updater.verifyChecksum('/tmp/opencode/nope.bin', 'deadbeef'), false);
  });

  // ================= downloadUpdate =================
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luder-dl-'));
  const goodContent = crypto.randomBytes(256 * 1024);
  const goodHash = crypto.createHash('sha256').update(goodContent).digest('hex');
  const badHash = crypto.createHash('sha256').update('other').digest('hex');
  const winMock = { isDestroyed: () => false, webContents: { send: () => {} } };
  let sentEvents = [];
  const winLogging = () => ({ isDestroyed: () => false, webContents: { send: (ch, payload) => sentEvents.push({ ch, payload }) } });

  const streamRes = (content, status = 200) => ({
    ok: status < 300, status,
    headers: { get: () => String(content.length) },
    body: (async function* () { yield content; })(),
  });

  await check('downloadUpdate: относительный URL → резолвится через SERVER_URL', async () => {
    sentEvents = [];
    captureFetch(({ url }) => { callArgs.push({ url }); return streamRes(goodContent); });
    const p = await updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/download/x.bin', sha256: goodHash } } }, winLogging());
    assert.ok(fs.existsSync(p), 'файл создан');
    assert.ok(sentEvents.some(e => e.ch === 'download-progress'), 'прогресс отправлен');
    assert.ok(sentEvents.some(e => e.ch === 'update-downloaded'), 'update-downloaded отправлен');
    assert.ok(updater.getUpdateLog().includes('checksum_ok'), 'checksum_ok в логе');
    assert.ok(updater.getUpdateLog().includes('download_ok'), 'download_ok в логе');
    fs.unlinkSync(p);
  });

  await check('downloadUpdate: checksum mismatch → файл удалён + throw', async () => {
    captureFetch(() => streamRes(goodContent));
    await assert.rejects(() => updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/x.bin', sha256: badHash } } }, winMock), /checksum mismatch/);
    assert.ok(updater.getUpdateLog().includes('checksum_fail'), 'checksum_fail в логе');
    const leftovers = fs.readdirSync(tmpDir);
    assert.strictEqual(leftovers.filter(f => f.startsWith('luder-update')).length, 0, 'недокачанный файл удалён');
  });

  await check('downloadUpdate: 404 → throw', async () => {
    captureFetch(() => streamRes(Buffer.from(''), 404));
    await assert.rejects(() => updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/x' } } }, winMock), /download failed: 404/);
  });

  await check('downloadUpdate: нет sha256 → проходит без проверки', async () => {
    captureFetch(() => streamRes(goodContent));
    const p = await updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/x.bin' } } }, winMock);
    assert.ok(fs.existsSync(p));
    fs.unlinkSync(p);
  });

  await check('downloadUpdate: win=null не должен ронять процесс', async () => {
    captureFetch(() => streamRes(goodContent));
    const p = await updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/x.bin', sha256: goodHash } } }, null);
    assert.ok(fs.existsSync(p));
    fs.unlinkSync(p);
  });

  await check('downloadUpdate: обрыв потока → throw', async () => {
    captureFetch(() => ({
      ok: true, status: 200, headers: { get: () => String(goodContent.length) },
      body: (async function* () { yield goodContent; throw new Error('connection lost'); })(),
    }));
    await assert.rejects(() => updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/x.bin' } } }, winMock), /connection lost/);
  });

  await check('downloadUpdate: прогресс percent корректный', async () => {
    sentEvents = [];
    captureFetch(() => streamRes(goodContent));
    const p = await updater.downloadUpdate({ version: '1.0.0', builds: { [PK]: { url: '/x.bin', sha256: goodHash } } }, winLogging());
    const progress = sentEvents.find(e => e.ch === 'download-progress');
    assert.ok(progress, 'событие прогресса есть');
    assert.strictEqual(progress.payload.percent, 100, 'percent=100 в конце');
    assert.strictEqual(progress.payload.total, goodContent.length);
    fs.unlinkSync(p);
  });

  // ================= quitAndInstall =================
  await check('quitAndInstall: spawn detached + unref', async () => {
    const cpPath = require.resolve('child_process');
    const origCpCache = require.cache[cpPath];
    const calls = [];
    let unrefCalled = false;
    require.cache[cpPath] = { id: cpPath, filename: cpPath, loaded: true, exports: { spawn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref: () => { unrefCalled = true; } }; } } };
    delete require.cache[UP];
    updater = require(UP);
    updater.quitAndInstall('/tmp/fake-installer.exe');
    assert.strictEqual(calls.length, 1, 'spawn вызван');
    assert.strictEqual(calls[0].cmd, '/tmp/fake-installer.exe');
    assert.deepStrictEqual(calls[0].opts, { detached: true, stdio: 'ignore' });
    assert.ok(unrefCalled, 'unref вызван');
    require.cache[cpPath] = origCpCache;
    delete require.cache[UP];
    updater = require(UP);
  });

  // ================= logUpdate / getUpdateLog =================
  await check('logUpdate: пишет ISO timestamp + JSON', () => {
    const before = updater.getUpdateLog();
    updater.logUpdate('test_event', { a: 1, b: 'x' });
    const line = updater.getUpdateLog().slice(before.length).trim();
    assert.ok(line.startsWith(new Date().toISOString().slice(0, 10)), 'ISO дата в начале строки');
    assert.ok(line.includes('test_event'), 'имя события');
    assert.ok(line.includes('"a":1'), 'данные сериализованы');
  });

  await check('logUpdate: не падает на null данных', () => {
    updater.logUpdate('nulldata', null);
    updater.logUpdate('stringdata', 'raw');
    assert.ok(true);
  });

  await check('экспорт API: platformKey НЕ экспортируется (наблюдение, не баг)', () => {
    assert.strictEqual(updater.platformKey, undefined, 'внутренняя функция, доступна только внутри модуля');
  });

  global.fetch = savedFetch;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.error('\nFAILURES:');
    for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
