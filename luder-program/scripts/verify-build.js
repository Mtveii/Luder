const fs = require('fs');
const pkg = require('../package.json');

const winTargets = Array.isArray(pkg.build.win.target) ? pkg.build.win.target : [pkg.build.win.target];
const archs = winTargets.flatMap(t => (typeof t === 'object' ? (t.arch || []) : [])).filter(Boolean);
if (archs.length === 0) archs.push('x64');

const distFiles = fs.existsSync('dist') ? fs.readdirSync('dist').filter(f => f.endsWith('.exe')) : [];
if (distFiles.length === 0) {
  console.error('FAIL: нет .exe в dist');
  process.exit(1);
}
const hasArch = distFiles.every(f => /x64|arm64|ia32/.test(f));
if (!hasArch) {
  console.error('FAIL: имя файла не содержит arch —', distFiles);
  process.exit(1);
}
const missing = archs.filter(a => !distFiles.some(f => f.includes(a)));
if (missing.length) {
  console.error(`FAIL: не хватает билдов для arch ${missing.join(', ')} — есть:`, distFiles);
  process.exit(1);
}
console.log(`PASS: build files OK (${archs.join(', ')}):`, distFiles);
