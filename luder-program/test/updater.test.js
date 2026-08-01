const assert = require('assert');
const { compareVersions } = require('../src/shared/updater');

assert.strictEqual(compareVersions('1.4.2', '1.4.1') > 0, true, 'newer > older');
assert.strictEqual(compareVersions('1.4.1', '1.4.2') < 0, true, 'older < newer');
assert.strictEqual(compareVersions('1.4.2', '1.4.2') === 0, true, 'equal versions');
assert.strictEqual(compareVersions('0.9.0', '0.10.0') < 0, true, 'minor rollover 9 < 10');
assert.strictEqual(compareVersions('1.0.0', '0.99.99') > 0, true, 'major beats minor/patch');
assert.strictEqual(compareVersions('2.0.0', '1.99.99') > 0, true, 'major rollover');

console.log('PASS: compareVersions — 6/6');
