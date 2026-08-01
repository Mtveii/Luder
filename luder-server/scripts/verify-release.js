const crypto = require('crypto');
const r = require('../config/release.json');

const BASE = process.env.SERVER_URL || 'http://localhost:3000';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function resolveUrl(url) {
  return url.startsWith('http') ? url : BASE + url;
}

async function main() {
  const required = ['version', 'minSupportedVersion', 'mandatory', 'builds'];
  for (const k of required) if (!(k in r)) fail(`missing field: ${k}`);

  if (!/^\d+\.\d+\.\d+$/.test(r.version)) fail(`bad version format: ${r.version}`);

  const { compareVersions } = require('../../luder-program/src/shared/updater');
  if (compareVersions(r.minSupportedVersion, r.version) > 0) {
    fail('minSupportedVersion выше version — ни один клиент не пройдёт проверку');
  }
  if (r.mandatory === true) console.warn('WARNING: mandatory=true — все клиенты будут форсированы на апдейт');

  if (Object.keys(r.builds).length === 0) fail('builds пуст');

  for (const [platform, b] of Object.entries(r.builds)) {
    if (!b.url) fail(`${platform}: нет url`);
    if (!b.sha256) fail(`${platform}: нет sha256 в манифесте`);

    const res = await fetch(resolveUrl(b.url));
    if (!res.ok) fail(`${platform}: url unreachable (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());

    if (buf.length < 1024 * 1024) fail(`${platform}: подозрительно малый файл (${buf.length} bytes) — ожидался инсталлятор ~70-100MB`);
    const isPe = b.url.toLowerCase().endsWith('.exe');
    if (isPe && buf.subarray(0, 2).toString('ascii') !== 'MZ') fail(`${platform}: файл не является PE (нет MZ-заголовка) — не валидный инсталлятор`);

    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== b.sha256) fail(`${platform}: sha256 mismatch (ожидали ${b.sha256}, реальный ${hash})`);
    console.log(`${platform}: OK (${buf.length} bytes)`);
  }

  console.log(`PASS: release.json v${r.version} valid, all builds reachable, checksums match`);
}

main().catch((e) => fail(e.message));
