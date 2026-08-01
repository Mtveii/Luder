const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const { verifyChecksum } = require('../src/shared/updater');

(async () => {
  const okPath = '/tmp/opencode/test-ok.bin';
  const content = 'test-content-123';
  fs.writeFileSync(okPath, content);
  const realHash = crypto.createHash('sha256').update(content).digest('hex');

  assert.strictEqual(await verifyChecksum(okPath, realHash), true, 'valid checksum passes');
  assert.strictEqual(await verifyChecksum(okPath, 'wronghash000'), false, 'invalid checksum fails');
  assert.strictEqual(await verifyChecksum('/tmp/opencode/does-not-exist.bin', realHash), false, 'missing file fails safely');

  fs.unlinkSync(okPath);
  console.log('PASS: checksum — 3/3');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
