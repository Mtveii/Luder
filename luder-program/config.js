const fs = require('fs');
const path = require('path');

// Загрузка .env рядом с приложением ДО чтения process.env
function loadEnvFile() {
  const candidates = [
    process.cwd(),
    __dirname,
    path.join(path.dirname(process.execPath)),
    path.join(path.dirname(process.execPath), 'resources'),
  ];
  let env = {};
  for (const dir of candidates) {
    const envPath = path.join(dir, '.env');
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx === -1) continue;
          const key = trimmed.slice(0, idx).trim();
          const value = trimmed.slice(idx + 1).trim();
          env[key] = value;
        }
        break;
      }
    } catch (_) {}
  }
  return env;
}

const env = loadEnvFile();

module.exports = {
  SERVER_URL: process.env.SERVER_URL || process.env.LUDR_SERVER_URL || env.LUDR_SERVER_URL || env.SERVER_URL || 'https://aspire-5.tailc87500.ts.net',
  API_TOKEN: process.env.LUDR_API_TOKEN || env.LUDR_API_TOKEN || '',
};