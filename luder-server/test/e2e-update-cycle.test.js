const assert = require('assert');
const crypto = require('crypto');
const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3000';

async function run() {
  const manifestRes = await fetch(`${BASE}/api/update/latest?platform=win32&arch=x64&current=0.0.1`);
  const manifest = await manifestRes.json();

  const buildUrl = manifest.builds['win32-x64'].url.startsWith('http')
    ? manifest.builds['win32-x64'].url
    : BASE + manifest.builds['win32-x64'].url;

  const fileRes = await fetch(buildUrl);
  assert.strictEqual(fileRes.status, 200, 'build file downloads');
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  assert.strictEqual(hash, manifest.builds['win32-x64'].sha256, 'downloaded file sha256 matches manifest');
  console.log(`PASS: e2e download+checksum — 1/1 (${buf.length} bytes)`);
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
