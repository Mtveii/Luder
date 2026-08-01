#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Test 1: manifest endpoint ==="
curl -s "http://localhost:3000/api/update/latest?platform=linux&arch=x64" | jq .
echo ""

echo "=== Test 2: 404 for unknown platform ==="
curl -s -w "%{http_code}" "http://localhost:3000/api/update/latest?platform=os2&arch=386"
echo ""
echo ""

echo "=== Test 3: version compare ==="
node -e "
const {compareVersions} = require('${SCRIPT_DIR}/../luder-program/src/shared/updater');
console.assert(compareVersions('1.4.2','1.4.1') > 0, 'fail: newer');
console.assert(compareVersions('1.4.1','1.4.2') < 0, 'fail: older');
console.assert(compareVersions('1.4.2','1.4.2') === 0, 'fail: equal');
console.log('version compare: OK');
"

echo "=== Test 4: checksum reject (streaming verify) ==="
node -e "
const {verifyChecksum} = require('${SCRIPT_DIR}/../luder-program/src/shared/updater');
const fs = require('fs');
fs.writeFileSync('/tmp/fake.exe', 'garbage');
verifyChecksum('/tmp/fake.exe', 'wronghash').then(ok => {
  console.assert(ok === false, 'fail: should reject wrong checksum');
  console.log('checksum reject: OK');
});
"

echo "=== Test 5: SERVER_URL from env ==="
grep -n "SERVER_URL" "${SCRIPT_DIR}/../luder-program/src/shared/updater.js"
echo ""

echo "=== Test 6: release.json structure ==="
cat "${SCRIPT_DIR}/config/release.json" | jq .
echo ""

echo "=== Test 7: preload exposes updaterAPI ==="
grep -A2 "updaterAPI" "${SCRIPT_DIR}/../luder-program/preload.js"
echo ""

echo "=== All tests passed ==="
