// overlay.js — one per monitor, reports events, draws only its intersection
const selection = document.getElementById('selection');
const askBar = document.getElementById('ask-bar');
const askInput = document.getElementById('ask-input');
const askBtn = document.getElementById('ask-btn');
const micBtn = document.getElementById('mic-btn');

let presetPrompt = null;
let displayBounds = { x: 0, y: 0, width: 0, height: 0 };
let displayIndex = 0;
let lastRect = null;

// --- Init: draw this monitor's screenshot on canvas ---
window.electronAPI.on('overlay-init', (info) => {
  displayBounds = info.displayBounds;
  displayIndex = info.displayIndex;
  lastRect = null;

  // Reset state for fresh selection
  selection.style.display = 'none';
  selection.style.left = '0px';
  selection.style.top = '0px';
  selection.style.width = '0px';
  selection.style.height = '0px';
  askBar.classList.remove('visible');

  const canvas = document.getElementById('bg-canvas');
  if (!canvas || !info.captureDataUrl) return;

  canvas.width = displayBounds.width;
  canvas.height = displayBounds.height;
  canvas.style.position = 'fixed';
  canvas.style.left = '0px';
  canvas.style.top = '0px';
  canvas.style.width = displayBounds.width + 'px';
  canvas.style.height = displayBounds.height + 'px';

  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    canvas.classList.add('ready');
  };
  img.src = info.captureDataUrl;
});

// --- Theme ---
window.electronAPI.on('overlay-theme', (theme) => {
  if (!theme) return;
  const r = document.documentElement.style;
  r.setProperty('--accent', theme.accent || theme.primary);
  r.setProperty('--primary', theme.primary);
  r.setProperty('--bg', theme.bg);
  r.setProperty('--surface', theme.surface);
  r.setProperty('--text', theme.text);
  r.setProperty('--border', theme.border || 'rgba(255,255,255,0.08)');
  r.setProperty('--hover', theme.hover || 'rgba(255,255,255,0.05)');
  r.setProperty('--selection', theme.selection || (theme.primary + '33'));
});

window.electronAPI.onQuickHotkeyPrompt((prompt) => { presetPrompt = prompt; });

// --- Selection rendering: intersection with this display ---
window.electronAPI.on('selectionChanged', (state) => {
  const { start, current } = state;
  const db = displayBounds;

  // Global selection rectangle
  const selLeft = Math.min(start.x, current.x);
  const selTop = Math.min(start.y, current.y);
  const selRight = Math.max(start.x, current.x);
  const selBottom = Math.max(start.y, current.y);

  // Intersection with this display
  const intLeft = Math.max(selLeft, db.x);
  const intTop = Math.max(selTop, db.y);
  const intRight = Math.min(selRight, db.x + db.width);
  const intBottom = Math.min(selBottom, db.y + db.height);

  const w = intRight - intLeft;
  const h = intBottom - intTop;

  if (w <= 0 || h <= 0) {
    selection.style.display = 'none';
    return;
  }

  // Convert to window-local coords
  selection.style.display = 'block';
  selection.style.left = (intLeft - db.x) + 'px';
  selection.style.top = (intTop - db.y) + 'px';
  selection.style.width = w + 'px';
  selection.style.height = h + 'px';
});

// --- Selection done ---
window.electronAPI.on('selectionDone', (data) => {
  lastRect = data.rect;
  if (data.rect.width < 5 || data.rect.height < 5) { window.electronAPI.closeOverlay(); return; }

  if (presetPrompt) { window.electronAPI.captureRegion(data.rect, presetPrompt); return; }

  // Show ask-bar only on the display where mouse was released
  if (data.askBarDisplayIndex === displayIndex) {
    const db = displayBounds;
    const rect = data.rect;

    const barX = Math.min(rect.x + rect.width, db.x + db.width) - db.x;
    const barY = (rect.y + rect.height) - db.y + 8;

    askBar.style.left = barX + 'px';
    askBar.style.top = barY + 'px';
    askBar.classList.add('visible');
    askInput.value = '';
    askInput.focus();
  }
});

// --- Mouse events: send screen coords to main ---
document.addEventListener('mousedown', (e) => {
  if (askBar.contains(e.target)) return;
  askBar.classList.remove('visible');
  window.electronAPI.send('overlay-event', {
    type: 'mousedown',
    screenX: e.clientX + displayBounds.x,
    screenY: e.clientY + displayBounds.y,
  });
});

document.addEventListener('mousemove', (e) => {
  window.electronAPI.send('overlay-event', {
    type: 'mousemove',
    screenX: e.clientX + displayBounds.x,
    screenY: e.clientY + displayBounds.y,
  });
});

document.addEventListener('mouseup', (e) => {
  window.electronAPI.send('overlay-event', {
    type: 'mouseup',
    screenX: e.clientX + displayBounds.x,
    screenY: e.clientY + displayBounds.y,
  });
});

// --- Ask bar ---
askBtn.addEventListener('click', submitAsk);
askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAsk(); });
function submitAsk() { if (lastRect) window.electronAPI.captureRegion(lastRect, askInput.value.trim()); }

// --- Voice ---
let recognizing = false;
function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { micBtn.disabled = true; micBtn.title = 'Voice input unavailable'; return; }
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  micBtn.addEventListener('click', () => {
    if (recognizing) { recognition.stop(); return; }
    recognition.start(); recognizing = true; micBtn.classList.add('active');
  });
  recognition.onresult = (event) => { askInput.value = event.results[0][0].transcript; };
  recognition.onend = () => { recognizing = false; micBtn.classList.remove('active'); };
  recognition.onerror = () => { recognizing = false; micBtn.classList.remove('active'); };
}
setupVoice();

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.electronAPI.closeOverlay(); });
