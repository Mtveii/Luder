const assert = require('assert');
const { compareVersions } = require('../src/shared/updater');

function resolveMandatory(current, manifest) {
  if (compareVersions(current, manifest.minSupportedVersion) < 0) return true;
  return manifest.mandatory;
}

assert.strictEqual(
  resolveMandatory('0.9.0', { minSupportedVersion: '0.10.0', mandatory: false }),
  true,
  'below minSupportedVersion forces mandatory'
);

assert.strictEqual(
  resolveMandatory('0.10.0', { minSupportedVersion: '0.10.0', mandatory: false }),
  false,
  'equal to minSupportedVersion — respect manifest.mandatory'
);

assert.strictEqual(
  resolveMandatory('0.15.0', { minSupportedVersion: '0.10.0', mandatory: true }),
  true,
  'manifest mandatory=true respected regardless'
);

console.log('PASS: mandatory logic — 3/3');
