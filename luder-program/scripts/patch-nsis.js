#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'common.nsh');
const oldLine = '!define UNINSTALL_FILENAME "Uninstall ${PRODUCT_FILENAME}.exe"';
const newLine = '!define UNINSTALL_FILENAME "UninstallLuder.exe"';

if (!fs.existsSync(file)) {
  console.error('PATCH: common.nsh not found at', file);
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');
if (src.includes('!define UNINSTALL_FILENAME "UninstallLuder.exe"')) {
  console.log('PATCH: common.nsh already patched');
  process.exit(0);
}
if (!src.includes(oldLine)) {
  console.error('PATCH: expected line not found in common.nsh, aborting (electron-builder updated?)');
  process.exit(1);
}
src = src.replace(oldLine, newLine);
fs.writeFileSync(file, src);
console.log('PATCH: common.nsh -> UninstallLuder.exe');
