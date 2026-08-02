// hotkeyParser.js — перевод нажатия клавиши в accelerator Electron (единый для главного хоткея и быстрых).
// Работает и в renderer (через <script>), и в Node (require).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HotkeyParser = factory();
})(this, function () {
'use strict';

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);

const CODE_TO_KEY = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  CapsLock: 'Capslock', ScrollLock: 'Scrolllock', NumLock: 'Numlock', PrintScreen: 'PrintScreen', Pause: 'Pause',
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4',
  Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  MediaPlayPause: 'MediaPlayPause', MediaStop: 'MediaStop', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack',
  VolumeUp: 'VolumeUp', VolumeDown: 'VolumeDown', VolumeMute: 'Mute',
};

function codeToKey(code) {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  const f = code.match(/^F([1-9]|1[0-9]|2[0-4])$/);
  if (f) return f[0];
  return CODE_TO_KEY[code] || '';
}

// e — KeyboardEvent (renderer). Возвращает accelerator (например "Ctrl+Shift+1") или ''
function eventToAccelerator(e) {
  if (MODIFIER_CODES.has(e.code)) return '';
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const key = codeToKey(e.code);
  if (!key) return '';
  return [...mods, key].join('+');
}

// Буквы/цифры без модификатора перехватят обычный ввод — не разрешаем такие комбинации
function isModifierRequired(combo) {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  return !parts.slice(0, -1).length && /^[A-Z0-9]$/.test(key);
}

function hasModifier(combo) {
  return /\b(Ctrl|Alt|Shift|Super|Meta|Command|Option|CommandOrControl|Control)\b/.test(combo);
}

return { eventToAccelerator, codeToKey, isModifierRequired, hasModifier, MODIFIER_CODES };
});
