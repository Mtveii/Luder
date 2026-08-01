const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function updateLogPath() {
  try { return app ? path.join(app.getPath('userData'), 'update.log') : null; } catch { return null; }
}

function logUpdate(event, data = {}) {
  const logPath = updateLogPath();
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
  } catch (_) {}
}

function getUpdateLog() {
  const logPath = updateLogPath();
  if (!logPath || !fs.existsSync(logPath)) return '';
  return fs.readFileSync(logPath, 'utf-8');
}

function platformKey() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'win32' && a === 'x64') return 'win32-x64';
  return `${p}-${a}`;
}

async function checkForUpdate() {
  const platform = process.platform;
  const arch = process.arch;
  const current = app ? app.getVersion() : '0.0.0';
  const res = await fetch(
    `${SERVER_URL}/api/update/latest?platform=${platform}&arch=${arch}&current=${current}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`update check failed: ${res.status}`);
  }
  const data = await res.json();
  const hasUpdate = compareVersions(data.version, current) > 0;
  const tooOld = data.minSupportedVersion && compareVersions(current, data.minSupportedVersion) < 0;
  return { ...data, hasUpdate, mandatory: !!(hasUpdate && (data.mandatory || tooOld)) };
}

async function downloadUpdate(manifest, win) {
  const build = (manifest.builds && manifest.builds[platformKey()]) || manifest;
  logUpdate('download_start', { version: manifest.version });
  const url = build.url.startsWith('http') ? build.url : `${SERVER_URL}${build.url}`;
  const tmpPath = path.join(app.getPath('temp'), `luder-update-${Date.now()}${path.extname(url)}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let loaded = 0;
  const fileStream = fs.createWriteStream(tmpPath);

  for await (const chunk of res.body) {
    loaded += chunk.length;
    fileStream.write(chunk);
    if (win && !win.isDestroyed()) {
      win.webContents.send('download-progress', { loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 });
    }
  }
  fileStream.end();
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  const ok = await verifyChecksum(tmpPath, build.sha256 || '');
  if (!ok) {
    fs.unlinkSync(tmpPath);
    logUpdate('checksum_fail', { version: manifest.version });
    throw new Error('checksum mismatch — file corrupted or tampered');
  }
  logUpdate('checksum_ok', { version: manifest.version });
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-downloaded', { path: tmpPath, version: manifest.version });
  }
  logUpdate('download_ok', { version: manifest.version });
  return tmpPath;
}

function verifyChecksum(filePath, expectedSha256) {
  return new Promise((resolve) => {
    if (!expectedSha256) return resolve(true);
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex') === expectedSha256.toLowerCase()));
    stream.on('error', () => resolve(false));
  });
}

function quitAndInstall(installerPath) {
  logUpdate('install_start', { path: installerPath });
  const child = spawn(installerPath, process.platform === 'win32' ? ['/S'] : [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  if (app) app.quit();
}

module.exports = { checkForUpdate, compareVersions, downloadUpdate, verifyChecksum, quitAndInstall, logUpdate, getUpdateLog, CHECK_INTERVAL, SERVER_URL };
