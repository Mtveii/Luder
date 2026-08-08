const assert = require('assert');
const { eventToAccelerator, codeToKey, isModifierRequired, hasModifier } = require('../src/shared/hotkeyParser');

const fake = (code, mods = {}) => ({ code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });

assert.strictEqual(eventToAccelerator(fake('KeyA', { ctrl: true })), 'Ctrl+A');
assert.strictEqual(eventToAccelerator(fake('KeyB', { ctrl: true, shift: true })), 'Ctrl+Shift+B');
assert.strictEqual(eventToAccelerator(fake('Digit1', { alt: true })), 'Alt+1');
assert.strictEqual(eventToAccelerator(fake('Digit1', { shift: true, alt: true })), 'Alt+Shift+1');
assert.strictEqual(eventToAccelerator(fake('F5')), 'F5');
assert.strictEqual(eventToAccelerator(fake('F24', { ctrl: true })), 'Ctrl+F24');
assert.strictEqual(eventToAccelerator(fake('ArrowUp', { ctrl: true })), 'Ctrl+Up');
assert.strictEqual(eventToAccelerator(fake('Space', { ctrl: true })), 'Ctrl+Space');
assert.strictEqual(eventToAccelerator(fake('Escape', { ctrl: true })), 'Ctrl+Esc');
assert.strictEqual(eventToAccelerator(fake('Enter', { ctrl: true })), 'Ctrl+Enter');
assert.strictEqual(eventToAccelerator(fake('Numpad1', { ctrl: true })), 'Ctrl+num1');
assert.strictEqual(eventToAccelerator(fake('Semicolon', { ctrl: true })), 'Ctrl+;');
assert.strictEqual(eventToAccelerator(fake('Minus', { ctrl: true })), 'Ctrl+-');
assert.strictEqual(eventToAccelerator(fake('ControlLeft', { ctrl: true })), '');
assert.strictEqual(eventToAccelerator(fake('KeyA')), 'A');
assert.strictEqual(eventToAccelerator(fake('Digit5')), '5');

assert.strictEqual(isModifierRequired('Ctrl+A'), false);
assert.strictEqual(isModifierRequired('A'), true);
assert.strictEqual(isModifierRequired('5'), true);
assert.strictEqual(isModifierRequired('F5'), false);
assert.strictEqual(isModifierRequired('Ctrl+Space'), false);

assert.strictEqual(hasModifier('Ctrl+F5'), true);
assert.strictEqual(hasModifier('F5'), false);

console.log('PASS: hotkeyParser — 20/20');
