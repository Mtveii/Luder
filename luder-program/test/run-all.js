const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT_TESTS = [
  'luder-program/test/updater.test.js',
  'luder-program/test/mandatory-logic.test.js',
  'luder-program/test/checksum.test.js',
  'luder-program/test/legacy-schema-fallback.test.js',
  'luder-program/test/detailed-updater.test.js',
  'luder-program/test/hotkey-parser.test.js',
];
const SERVER_TESTS = [
  'luder-server/test/server-integration.test.js',
  'luder-server/test/e2e-update-cycle.test.js',
  'luder-server/test/detailed-server.test.js',
];
const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3000';

const results = [];

function runTest(file) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    results.push({ file, pass: false, out: 'FILE NOT FOUND' });
    return;
  }
  const r = spawnSync('node', [abs], { encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '').trim() + (r.stderr ? '\n' + r.stderr.trim() : '');
  results.push({ file, pass: r.status === 0, out });
  process.stdout.write(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${file}\n`);
  if (r.status !== 0) {
    process.stdout.write(`${' '.repeat(6)}${out.split('\n').join('\n'.padStart(7))}\n`);
  }
}

async function serverUp() {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  CLIENT_TESTS.forEach(runTest);

  let server = null;
  if (!(await serverUp())) {
    process.stdout.write('starting server.js...\n');
    server = spawn('node', [path.join(ROOT, 'luder-server', 'server.js')], { stdio: 'ignore', detached: false });
    let up = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await serverUp()) { up = true; break; }
    }
    if (!up) {
      results.push({ file: 'luder-server (startup)', pass: false, out: 'server did not start' });
      process.stdout.write('FAIL  luder-server (startup)\n');
    }
  }

  if (await serverUp()) {
    SERVER_TESTS.forEach(runTest);
  } else {
    SERVER_TESTS.forEach(t => {
      results.push({ file: t, pass: false, out: 'server not available' });
      process.stdout.write(`FAIL  ${t}  (server not available)\n`);
    });
  }

  if (server) server.kill('SIGTERM');

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  process.stdout.write(`\nSUMMARY: ${passed} passed / ${failed} failed (${results.length} total)\n`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
