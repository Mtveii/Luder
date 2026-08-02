const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const setup = fs.readdirSync(distDir).find(f => /^Luder-Setup-.*\.exe$/.test(f));
if (!setup) {
  console.error('FAIL: установщик не найден в dist');
  process.exit(1);
}
const setupPath = path.join(distDir, setup);
const setupSize = fs.statSync(setupPath).size;
console.log(`PASS: установщик ${setup} (${setupSize} байт)`);

if (process.platform !== 'win32') {
  console.log('SKIP: полный тест установки/удаления только на Windows');
  process.exit(0);
}

const UNINSTALL_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', timeout: 180000, ...opts });

function regQuery(subkey, value) {
  try {
    const out = run('reg', ['query', subkey, '/v', value]);
    const line = out.split(/\r?\n/).find(l => l.includes(value));
    if (!line) return null;
    const m = line.match(/(REG_\S+)\s+(.*)$/);
    return m ? m[2].trim() : null;
  } catch {
    return null;
  }
}

// assisted-установщик пишет Uninstall-ключ по GUID, не по appId — ищем по DisplayName
function findUninstallKey() {
  try {
    const out = run('reg', ['query', UNINSTALL_ROOT, '/s']);
    let current = null;
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('HKEY_')) { current = t; continue; }
      const m = line.match(/^\s+DisplayName\s+REG_\S+\s+(.*)$/);
      if (m && current && m[1].trim() === 'Luder AI Assistant') return current;
    }
  } catch {}
  return null;
}

function assert(cond, msg, detail) {
  if (!cond) {
    if (detail != null) console.error(`  факт: ${JSON.stringify(detail)}`);
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

try {
  console.log('Устанавливаю silent...');
  run(setupPath, ['/S', '/currentuser']);

  const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Luder');
  assert(fs.existsSync(installDir), `папка установки создана: ${installDir}`);
  assert(fs.existsSync(path.join(installDir, 'Luder.exe')), 'Luder.exe на месте');

  const uninstallerPath = path.join(installDir, 'Uninstall Luder.exe');
  assert(fs.existsSync(uninstallerPath), 'файл Uninstall Luder.exe существует');
  const uSize = fs.statSync(uninstallerPath).size;
  assert(uSize > 100000, `Uninstall Luder.exe непустой (${uSize} байт, ожидалось > 100000)`);
  const head = fs.readFileSync(uninstallerPath).subarray(0, 2);
  assert(head[0] === 0x4d && head[1] === 0x5a, 'Uninstall Luder.exe — валидный PE (MZ)');

  const uninstallKey = findUninstallKey();
  assert(uninstallKey != null, 'реестр: найден ключ Uninstall с DisplayName = Luder AI Assistant');
  const dn = regQuery(uninstallKey, 'DisplayName');
  assert(dn === 'Luder AI Assistant', 'реестр: DisplayName = Luder AI Assistant', dn);
  assert(regQuery(uninstallKey, 'DisplayVersion') != null, 'реестр: DisplayVersion есть');
  const uninstallString = regQuery(uninstallKey, 'UninstallString');
  assert(uninstallString != null && /Uninstall Luder\.exe/.test(uninstallString), 'реестр: UninstallString есть');

  try {
    run('taskkill', ['/F', '/IM', 'Luder.exe']);
  } catch {
    // приложение могло не запуститься (runAfterFinish) — не ошибка
  }

  console.log('Удаляю silent...');
  run(uninstallerPath, ['/S']);
  assert(!fs.existsSync(installDir), 'папка установки удалена');
  assert(findUninstallKey() == null, 'ключ реестра Uninstall удалён');
  assert(!fs.existsSync(path.join(process.env.APPDATA, 'Luder')), 'AppData\\Luder удалён');

  console.log('PASS: установка и удаление работают');
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
