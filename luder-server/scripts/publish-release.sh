#!/usr/bin/env bash
# publish-release.sh — атомарная публикация билда: файл → манифест → verify → откат при FAIL
# Использование: ./publish-release.sh <путь-к-Luder-Setup-X.Y.Z-x64.exe> <X.Y.Z>
# Опционально: TEST_SERVER_URL=http://staging:3000 — если проверка идёт против другого сервера
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXE_FILE="${1:?usage: publish-release.sh <exe-file> <version>}"
VERSION="${2:?usage: publish-release.sh <exe-file> <version>}"

if [[ ! -f "$EXE_FILE" ]]; then echo "FAIL: файл не найден: $EXE_FILE"; exit 1; fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "FAIL: неверный формат версии: $VERSION"; exit 1; fi

DIST_DIR="$SERVER_DIR/dist"
RELEASE_JSON="$SERVER_DIR/config/release.json"
BACKUP="$RELEASE_JSON.bak"
FILENAME="Luder-Setup-$VERSION-x64.exe"

echo "1/4 копирование файла → $DIST_DIR/$FILENAME"
cp "$EXE_FILE" "$DIST_DIR/$FILENAME"

echo "2/4 бэкап манифеста"
cp "$RELEASE_JSON" "$BACKUP"

echo "3/4 обновление манифеста"
SHA=$(sha256sum "$DIST_DIR/$FILENAME" | awk '{print $1}')
node -e "
const fs = require('fs');
const p = '$RELEASE_JSON';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
r.version = '$VERSION';
r.builds['win32-x64'] = { url: '/download/$FILENAME', sha256: '$SHA' };
fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
console.log('    version=' + r.version + ' sha256=' + '$SHA'.slice(0, 12) + '...');
"

echo "4/4 verify-release..."
if ! (cd "$SERVER_DIR" && npm run verify-release); then
  echo "FAIL: verify-release не прошёл — откат манифеста и удаление файла"
  mv "$BACKUP" "$RELEASE_JSON"
  rm -f "$DIST_DIR/$FILENAME"
  exit 1
fi
rm -f "$BACKUP"
echo "PASS: $VERSION опубликован"
