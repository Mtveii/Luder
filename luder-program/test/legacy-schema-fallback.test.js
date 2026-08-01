const assert = require('assert');

function parseBuildUrl(manifest, platform, arch) {
  if (manifest.builds?.[`${platform}-${arch}`]) {
    return manifest.builds[`${platform}-${arch}`];
  }
  if (manifest.url && manifest.sha256) {
    return { url: manifest.url, sha256: manifest.sha256 };
  }
  return null;
}

assert.deepStrictEqual(
  parseBuildUrl({ builds: { 'win32-x64': { url: 'a', sha256: 'b' } } }, 'win32', 'x64'),
  { url: 'a', sha256: 'b' },
  'new schema resolves'
);

assert.deepStrictEqual(
  parseBuildUrl({ url: 'legacy-url', sha256: 'legacy-hash' }, 'win32', 'x64'),
  { url: 'legacy-url', sha256: 'legacy-hash' },
  'legacy flat schema falls back'
);

assert.strictEqual(
  parseBuildUrl({}, 'win32', 'x64'),
  null,
  'no schema matches → null, not crash'
);

console.log('PASS: legacy fallback — 3/3');
