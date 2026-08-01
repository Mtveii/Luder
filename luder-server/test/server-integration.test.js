const assert = require('assert');
const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3000';

function resolve(url) {
  return url.startsWith('http') ? url : BASE + url;
}

async function run() {
  let res = await fetch(`${BASE}/api/update/latest`);
  assert.strictEqual(res.status, 400, 'missing params → 400');

  res = await fetch(`${BASE}/api/update/latest?platform=win32&arch=x64&current=0.14.0`);
  assert.strictEqual(res.status, 200, 'valid params → 200');
  const body = await res.json();
  ['version', 'minSupportedVersion', 'mandatory', 'builds'].forEach(k =>
    assert.ok(k in body, `response has field: ${k}`)
  );
  assert.ok(body.builds['win32-x64'], 'builds contains win32-x64');
  assert.ok(body.builds['win32-x64'].url, 'win32-x64 has url');
  assert.ok(/^[a-f0-9]{64}$/.test(body.builds['win32-x64'].sha256), 'sha256 is valid hex-64');

  res = await fetch(`${BASE}/api/update/latest?platform=darwin&arch=arm64&current=0.14.0`);
  assert.strictEqual(res.status, 404, 'unsupported platform → 404, not 500');

  res = await fetch(resolve(body.builds['win32-x64'].url), { method: 'HEAD' });
  assert.strictEqual(res.status, 200, 'HEAD on download url → 200');
  assert.ok(Number(res.headers.get('content-length')) > 0, 'HEAD has content-length');

  console.log('PASS: server integration — 6/6');
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
