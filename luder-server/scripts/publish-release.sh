#!/usr/bin/env bash
# publish-release.sh — атомарная публикация билда: файл → манифест → verify → откат при FAIL
# Использование: ./publish-release.sh <путь-к-файлу-билда> [platform-key]
#   platform-key: auto (по расширению: .exe → win32-x64, .AppImage → linux-x64), или явно
# Версия берётся из имени файла (Luder-Setup-0.17.1-x64.exe / Luder-0.17.1.AppImage)
# Опционально: TEST_SERVER_URL=http://staging:3000 — если проверка идёт против другого сервера
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${1:?usage: publish-release.sh <build-file> [platform-key]}"
PLATFORM="${2:-auto}"

if [[ ! -f "$FILE" ]]; then echo "FAIL: файл не найден: $FILE"; exit 1; fi

FILENAME="$(basename "$FILE")"
VERSION="$(echo "$FILENAME" | sed -nE 's/^Luder(-Setup)?-([0-9]+\.[0-9]+\.[0-9]+).*/\2/p')"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "FAIL: не удалось извлечь версию из имени: $FILENAME"; exit 1; fi

if [[ "$PLATFORM" == "auto" ]]; then
  case "$FILENAME" in
    *.exe)      PLATFORM="win32-x64" ;;
    *.AppImage) PLATFORM="linux-x64" ;;
    *) echo "FAIL: не могу определить платформу для: $FILENAME (укажите вторым аргументом)"; exit 1 ;;
  esac
fi

DIST_DIR="$SERVER_DIR/dist"
RELEASE_JSON="$SERVER_DIR/config/release.json"
BACKUP="$RELEASE_JSON.bak"

echo "1/4 копирование файла → $DIST_DIR/$FILENAME ($PLATFORM)"
cp "$FILE" "$DIST_DIR/$FILENAME"

echo "2/4 бэкап манифеста"
cp "$RELEASE_JSON" "$BACKUP"

echo "3/4 обновление манифеста"
SHA=$(sha256sum "$DIST_DIR/$FILENAME" | awk '{print $1}')
node -e "
const fs = require('fs');
const p = '$RELEASE_JSON';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
r.version = '$VERSION';
r.builds['$PLATFORM'] = { url: '/download/$FILENAME', sha256: '$SHA' };
fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
console.log('    version=' + r.version + ' ' + '$PLATFORM'.padEnd(10) + ' sha256=' + '$SHA'.slice(0, 12) + '...');
"

echo "4/4 verify-release..."
if ! (cd "$SERVER_DIR" && npm run verify-release); then
  echo "FAIL: verify-release не прошёл — откат манифеста и удаление файла"
  mv "$BACKUP" "$RELEASE_JSON"
  rm -f "$DIST_DIR/$FILENAME"
  exit 1
fi
rm -f "$BACKUP"
echo "PASS: $VERSION ($PLATFORM) опубликован"
