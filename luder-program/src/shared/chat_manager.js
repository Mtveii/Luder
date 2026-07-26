'use strict';

const storage = require('./storage');

const TIMEOUT_MS = 30 * 60 * 1000;

let activeThreadId = null;
let lastActivity = 0;
let lastQuickHotkeyPrompt = null;

function getOrCreateThread({ title, provider, imageBase64, isQuickHotkey, hotkeyPrompt }) {
  const now = Date.now();

  if (activeThreadId) {
    const expired = now - lastActivity > TIMEOUT_MS;
    const hotkeyChanged = isQuickHotkey && hotkeyPrompt && lastQuickHotkeyPrompt !== null && hotkeyPrompt !== lastQuickHotkeyPrompt;

    if (!expired && !hotkeyChanged) {
      lastActivity = now;
      if (isQuickHotkey) lastQuickHotkeyPrompt = hotkeyPrompt;
      storage.appendMessage(activeThreadId, 'user', title, imageBase64);
      return activeThreadId;
    }
  }

  const thread = storage.createThread({ title, provider, imageBase64 });
  activeThreadId = thread.id;
  lastActivity = now;
  lastQuickHotkeyPrompt = isQuickHotkey ? (hotkeyPrompt || null) : null;
  return activeThreadId;
}

function reset() {
  activeThreadId = null;
  lastActivity = 0;
  lastQuickHotkeyPrompt = null;
}

module.exports = { getOrCreateThread, reset };
