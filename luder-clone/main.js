// main.js — entry point: hotkeys, quick hotkeys, themes, tray, windows, IPC, updater
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer, screen, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const providers = require('./src/shared/providers');
const storage = require('./src/shared/storage');
const updater = require('./src/shared/updater');

const SERVER_URL = 'http://100.102.160.84:3000';

Menu.setApplicationMenu(null);

const CHANNELS = {
  CAPTURE_REGION: 'capture-region',
  REGION_CAPTURED: 'region-captured',
  ASK_QUESTION: 'ask-question',
  STREAM_CHUNK: 'stream-chunk',
  STREAM_END: 'stream-end',
  STREAM_ERROR: 'stream-error',
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  CLOSE_OVERLAY: 'close-overlay',
  CLOSE_CHAT: 'close-chat',

  OPEN_HOME: 'open-home',
  OPEN_HISTORY: 'open-history',
  OPEN_SETTINGS_WINDOW: 'open-settings-window',
  OPEN_EXTERNAL: 'open-external',
  GET_OS_USERNAME: 'get-os-username',

  GET_STATS: 'get-stats',
  GET_THREADS: 'get-threads',
  REOPEN_THREAD: 'reopen-thread',
  THREAD_LOADED: 'thread-loaded',
  TOGGLE_FAVORITE: 'toggle-favorite',
  DELETE_THREAD: 'delete-thread',
  CLEAR_HISTORY: 'clear-history',

  GET_QUICK_HOTKEYS: 'get-quick-hotkeys',
  SET_QUICK_HOTKEYS: 'set-quick-hotkeys',
  QUICK_HOTKEY_PROMPT: 'quick-hotkey-prompt',

  CHECK_FOR_UPDATES: 'check-for-updates',
  UPDATE_AVAILABLE: 'update-available',

  TOGGLE_PIN_CHAT: 'toggle-pin-chat',
  CAPTURE_AND_ATTACH: 'capture-and-attach',
  ATTACH_FILE: 'attach-file',

  GET_THEMES: 'get-themes',
  GET_THEME: 'get-theme',
  SET_THEME: 'set-theme',
  UPDATE_HOTKEY: 'update-hotkey',
  GET_ALL: 'get-all',
  GET_MODELS: 'get-models',
};

let tray = null;
let chatWindow = null;
let homeWindow = null;
let attachTargetThreadId = null;
let currentMainHotkey = null;

// --- One overlay per monitor ---
let overlayWindows = new Map(); // displayIndex → BrowserWindow

// --- SelectionState: single source of truth in main process ---
let selection = { dragging: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } };

const dynamicQuickHotkeys = [];

// --- User registration on server ---
async function registerUser() {
  const settings = storage.readSettings();
  try {
    const res = await fetch(`${SERVER_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: settings.deviceId,
        username: os.userInfo().username,
        os: `${os.platform()} ${os.release()}`,
        version: app.getVersion(),
        provider: settings.provider,
      }),
    });
    if (res.ok) console.log('[REG] Registered on server');
  } catch (_) { console.log('[REG] Server offline — ok'); }
}

function windowDefaults() {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };
}

// --- Hotkeys ---
function registerMainHotkey(combo) {
  if (currentMainHotkey) {
    globalShortcut.unregister(currentMainHotkey);
    currentMainHotkey = null;
  }
  if (!combo || combo.trim() === '') return;
  try {
    const success = globalShortcut.register(combo, () => { if (overlayWindows.size === 0) createOverlayWindows(); });
    if (success) {
      currentMainHotkey = combo;
      console.log(`[HOTKEY] Registered: ${combo}`);
    } else {
      console.error(`[HOTKEY] Failed to register: ${combo} (returns false)`);
    }
  } catch (err) {
    console.error(`[HOTKEY] Failed to register ${combo}:`, err.message);
  }
}

function registerQuickHotkeys() {
  dynamicQuickHotkeys.forEach((combo) => globalShortcut.unregister(combo));
  dynamicQuickHotkeys.length = 0;
  for (const hk of storage.listQuickHotkeys()) {
    try {
      globalShortcut.register(hk.combo, () => { if (overlayWindows.size === 0) createOverlayWindows(hk.prompt); });
      dynamicQuickHotkeys.push(hk.combo);
    } catch (err) {
      console.error(`Failed to register quick hotkey ${hk.combo}:`, err.message);
    }
  }
}

// --- Close all overlay windows ---
function closeAllOverlays() {
  for (const [, win] of overlayWindows) {
    if (!win.isDestroyed()) {
      try { win.close(); } catch (_) {}
    }
  }
  overlayWindows.clear();
}

// --- Create one overlay per monitor ---
async function createOverlayWindows(promptPreset = '') {
  const monitorCaptures = await captureMonitors();
  const displays = screen.getAllDisplays();

  for (let i = 0; i < displays.length; i++) {
    const d = displays[i];
    const b = d.bounds;

    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, movable: false,
      icon: path.join(__dirname, 'assets/icon.png'),
      webPreferences: windowDefaults(),
    });

    win.loadFile(path.join(__dirname, 'src/overlay/overlay.html'));

    win.webContents.once('did-finish-load', () => {
      const settings = storage.readSettings();
      const themes = storage.getThemes();
      const theme = themes[settings.theme] || themes.cyberNeon;
      win.webContents.send('overlay-theme', theme);

      // Find this display's capture
      const cap = monitorCaptures.find((c) =>
        c.bounds.x === b.x && c.bounds.y === b.y &&
        c.bounds.width === b.width && c.bounds.height === b.height
      );

      win.webContents.send('overlay-init', {
        displayBounds: b,
        displayIndex: i,
        captureDataUrl: cap ? cap.dataUrl : null,
      });

      if (promptPreset) win.webContents.send(CHANNELS.QUICK_HOTKEY_PROMPT, promptPreset);
    });

    win.on('closed', () => { overlayWindows.delete(i); });
    overlayWindows.set(i, win);
  }
}

function createChatWindow({ imageBase64 = null, prompt = null, threadId = null, thread = null } = {}) {
  // Close existing chat window first
  if (chatWindow && !chatWindow.isDestroyed()) {
    try { chatWindow.close(); } catch (_) {}
  }
  chatWindow = new BrowserWindow({
    width: 420, height: 640, alwaysOnTop: storage.readSettings().settings.alwaysOnTopChat,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: windowDefaults(),
  });
  chatWindow.loadFile(path.join(__dirname, 'src/chat/chat.html'));
  chatWindow.webContents.once('did-finish-load', () => {
    if (thread) chatWindow.webContents.send(CHANNELS.THREAD_LOADED, thread);
    else chatWindow.webContents.send(CHANNELS.REGION_CAPTURED, { imageBase64, prompt, threadId });
  });
  const win = chatWindow;
  win.on('closed', () => { if (chatWindow === win) chatWindow = null; });
}

function createHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) { homeWindow.focus(); return; }
  homeWindow = new BrowserWindow({ width: 900, height: 640, icon: path.join(__dirname, 'assets/icon.png'), webPreferences: windowDefaults() });
  homeWindow.loadFile(path.join(__dirname, 'src/home/home.html'));
  homeWindow.on('closed', () => { homeWindow = null; });
}

// --- Capture each monitor separately ---
async function captureMonitors() {
  const displays = screen.getAllDisplays();
  const captures = [];
  for (const d of displays) {
    const b = d.bounds;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: b.width, height: b.height } });
    let source = sources.find((s) => s.thumbnail.getSize().width === b.width && s.thumbnail.getSize().height === b.height);
    if (!source) source = sources[0];
    if (source) {
      captures.push({ bounds: b, dataUrl: source.thumbnail.toDataURL() });
    }
  }
  return captures;
}

// --- Capture region: crop per monitor, stitch into one image ---
async function captureRegion(rect) {
  const displays = screen.getAllDisplays();

  // Capture each monitor at full resolution
  const monitorImages = [];
  for (const d of displays) {
    const b = d.bounds;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: b.width, height: b.height } });
    let source = sources.find((s) => s.thumbnail.getSize().width === b.width && s.thumbnail.getSize().height === b.height);
    if (!source) source = sources[0];
    if (source) {
      monitorImages.push({ bounds: b, image: source.thumbnail });
    }
  }

  // For each monitor, crop the intersection with the selection
  const pieces = [];
  for (const { bounds, image } of monitorImages) {
    const intLeft = Math.max(rect.x, bounds.x);
    const intTop = Math.max(rect.y, bounds.y);
    const intRight = Math.min(rect.x + rect.width, bounds.x + bounds.width);
    const intBottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);

    const w = intRight - intLeft;
    const h = intBottom - intTop;

    if (w > 0 && h > 0) {
      const cropped = image.crop({
        x: Math.round(intLeft - bounds.x),
        y: Math.round(intTop - bounds.y),
        width: Math.round(w),
        height: Math.round(h),
      });
      pieces.push({
        x: Math.round(intLeft - rect.x),
        y: Math.round(intTop - rect.y),
        width: Math.round(w),
        height: Math.round(h),
        dataUrl: cropped.toDataURL(),
      });
    }
  }

  if (pieces.length === 0) throw new Error('No capture data for selection');

  // Single monitor, full coverage
  if (pieces.length === 1 && pieces[0].x === 0 && pieces[0].y === 0 &&
      pieces[0].width >= rect.width && pieces[0].height >= rect.height) {
    return optimizeImage(pieces[0].dataUrl.split(',')[1]);
  }

  // Multiple monitors or partial — composite via hidden renderer
  const stitched = await compositeImages(pieces, Math.ceil(rect.width), Math.ceil(rect.height));
  return optimizeImage(stitched);
}

// --- Resize + compress image for faster API calls ---
function optimizeImage(base64) {
  try {
    const { nativeImage } = require('electron');
    const buf = Buffer.from(base64, 'base64');
    const img = nativeImage.createFromBuffer(buf);
    const sz = img.getSize();
    const maxDim = 1280;
    if (sz.width <= maxDim && sz.height <= maxDim) return base64;
    const scale = maxDim / Math.max(sz.width, sz.height);
    const resized = img.resize({ width: Math.round(sz.width * scale), height: Math.round(sz.height * scale) });
    return resized.toJPEG(80).toString('base64');
  } catch (_) {
    return base64;
  }
}

// --- Composite multiple image pieces into one canvas via hidden BrowserWindow ---
function compositeImages(pieces, width, height) {
  return new Promise((resolve, reject) => {
    const compositor = new BrowserWindow({
      width, height,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'compositor-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    compositor.loadFile(path.join(__dirname, 'src/overlay/compositor.html'));

    compositor.webContents.once('did-finish-load', () => {
      compositor.webContents.send('composite', { pieces, width, height });
    });

    ipcMain.once('composite-result', (_e, dataUrl) => {
      compositor.close();
      resolve(dataUrl.split(',')[1]);
    });

    // Fallback timeout
    setTimeout(() => {
      if (!compositor.isDestroyed()) {
        compositor.close();
        reject(new Error('Compositor timeout'));
      }
    }, 5000);
  });
}

async function checkAndNotifyUpdate(forced) {
  const result = await updater.checkForUpdates(app.getVersion());
  const settings = storage.readSettings();
  if (result.hasUpdate && (forced || settings.updateInfo.dismissedVersion !== result.latestVersion)) {
    if (homeWindow) homeWindow.webContents.send(CHANNELS.UPDATE_AVAILABLE, result);
    else if (tray) tray.displayBalloon({ title: 'Update available', content: `New version ${result.latestVersion}` });
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));

  const savedHotkey = storage.getHotkey();
  registerMainHotkey(savedHotkey);
  registerQuickHotkeys();

  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Home', click: createHomeWindow },
    { type: 'separator' },
    { label: 'Check for updates', click: () => checkAndNotifyUpdate(true) },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip('Ludr Clone');
  tray.on('click', createHomeWindow);

  createHomeWindow();

  // --- IPC handlers ---

  // Capture region from overlay selection
  ipcMain.on(CHANNELS.CAPTURE_REGION, async (_e, { rect, prompt }) => {
    try {
      // Check daily limit
      const limit = storage.checkDailyLimit();
      if (!limit.allowed) {
        closeAllOverlays();
        const msg = `Daily limit reached (${limit.limit}/${limit.limit}). ${limit.tier === 'free' ? 'Upgrade to Pro in Settings.' : ''}`;
        createChatWindow({ prompt: msg });
        return;
      }

      const imageBase64 = await captureRegion(rect);
      closeAllOverlays();
      storage.incrementDailyRequests();

      if (attachTargetThreadId) {
        const threadId = attachTargetThreadId;
        attachTargetThreadId = null;
        storage.appendMessage(threadId, 'user', prompt || '', imageBase64);
        if (chatWindow) chatWindow.webContents.send(CHANNELS.REGION_CAPTURED, { imageBase64, prompt, threadId, attach: true });
        return;
      }

      const finalPrompt = prompt || 'Analyze this image.';
      const thread = storage.createThread({ title: finalPrompt, provider: storage.readSettings().provider, imageBase64 });
      createChatWindow({ imageBase64, prompt: finalPrompt, threadId: thread.id });
    } catch (err) {
      console.error('Capture error:', err);
      closeAllOverlays();
    }
  });

  // Close all overlays
  ipcMain.on(CHANNELS.CLOSE_OVERLAY, () => {
    attachTargetThreadId = null;
    selection.dragging = false;
    closeAllOverlays();
  });

  ipcMain.on(CHANNELS.CLOSE_CHAT, () => { if (chatWindow) chatWindow.close(); });

  // Overlay sends mouse events in screen coords
  // Main updates SelectionState and broadcasts to ALL overlays
  ipcMain.on('overlay-event', (event, payload) => {
    const { type, screenX, screenY } = payload;

    // Find which display this event came from
    let senderDisplayIndex = -1;
    for (const [idx, win] of overlayWindows) {
      if (win.webContents === event.sender) {
        senderDisplayIndex = idx;
        break;
      }
    }

    if (type === 'mousedown') {
      selection.dragging = true;
      selection.start.x = screenX;
      selection.start.y = screenY;
      selection.current.x = screenX;
      selection.current.y = screenY;

    } else if (type === 'mousemove' && selection.dragging) {
      selection.current.x = screenX;
      selection.current.y = screenY;

    } else if (type === 'mouseup' && selection.dragging) {
      selection.dragging = false;
      selection.current.x = screenX;
      selection.current.y = screenY;

      const rect = {
        x: Math.min(selection.start.x, selection.current.x),
        y: Math.min(selection.start.y, selection.current.y),
        width: Math.abs(selection.current.x - selection.start.x),
        height: Math.abs(selection.current.y - selection.start.y),
      };

      // Broadcast selectionChanged + selectionDone to ALL overlays
      for (const [, win] of overlayWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send('selectionChanged', { start: { ...selection.start }, current: { ...selection.current } });
          win.webContents.send('selectionDone', { rect, askBarDisplayIndex: senderDisplayIndex });
        }
      }
      return;
    }

    // Broadcast selectionChanged to ALL overlays
    for (const [, win] of overlayWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('selectionChanged', { start: { ...selection.start }, current: { ...selection.current } });
      }
    }
  });

  ipcMain.on(CHANNELS.CAPTURE_AND_ATTACH, (_e, { threadId }) => {
    attachTargetThreadId = threadId;
    if (overlayWindows.size === 0) createOverlayWindows();
  });

  ipcMain.handle(CHANNELS.ATTACH_FILE, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return fs.readFileSync(result.filePaths[0]).toString('base64');
  });

  ipcMain.on(CHANNELS.TOGGLE_PIN_CHAT, (_e, pinned) => { if (chatWindow) chatWindow.setAlwaysOnTop(pinned); });

  ipcMain.handle(CHANNELS.GET_ALL, async () => ({
    settings: storage.readSettings(),
    stats: storage.getStats(),
    threads: storage.listThreads(),
    themes: storage.getThemes(),
    hotkeys: storage.listQuickHotkeys(),
    username: os.userInfo().username,
    keyHints: providers.KEY_HINTS,
  }));

  ipcMain.handle(CHANNELS.GET_SETTINGS, async () => storage.readSettings());
  ipcMain.handle(CHANNELS.SET_SETTINGS, async (_e, data) => storage.writeSettings(data));

  ipcMain.handle(CHANNELS.GET_STATS, async () => storage.getStats());
  ipcMain.handle(CHANNELS.GET_THREADS, async () => storage.listThreads());
  ipcMain.handle(CHANNELS.TOGGLE_FAVORITE, async (_e, threadId) => storage.toggleFavorite(threadId));
  ipcMain.handle(CHANNELS.DELETE_THREAD, async (_e, threadId) => storage.deleteThread(threadId));
  ipcMain.handle(CHANNELS.CLEAR_HISTORY, async () => storage.clearHistory());

  ipcMain.handle('get-tier', async () => storage.getTier());
  ipcMain.handle('set-tier', async (_e, tier) => storage.setTier(tier));
  ipcMain.handle('get-daily-usage', async () => storage.getDailyUsage());

  ipcMain.on(CHANNELS.REOPEN_THREAD, (_e, threadId) => {
    const thread = storage.getThread(threadId);
    if (thread) createChatWindow({ thread });
  });

  ipcMain.handle(CHANNELS.GET_QUICK_HOTKEYS, async () => storage.listQuickHotkeys());
  ipcMain.handle(CHANNELS.SET_QUICK_HOTKEYS, async (_e, list) => {
    const saved = storage.setQuickHotkeys(list);
    registerQuickHotkeys();
    return saved;
  });

  ipcMain.handle(CHANNELS.GET_THEMES, async () => storage.getThemes());
  ipcMain.handle(CHANNELS.GET_THEME, async (_e, themeId) => storage.getTheme(themeId));
  ipcMain.handle(CHANNELS.SET_THEME, async (_e, themeId) => storage.setTheme(themeId));

  ipcMain.handle(CHANNELS.UPDATE_HOTKEY, async (_e, combo) => {
    registerMainHotkey(combo);
    storage.setHotkey(combo);
    return { ok: true, combo, registered: currentMainHotkey === combo };
  });

  ipcMain.handle(CHANNELS.GET_MODELS, async (_e, provider) => providers.getModels(provider));

  ipcMain.handle(CHANNELS.CHECK_FOR_UPDATES, async () => updater.checkForUpdates(app.getVersion()));
  ipcMain.handle(CHANNELS.GET_OS_USERNAME, async () => os.userInfo().username);
  ipcMain.handle(CHANNELS.OPEN_EXTERNAL, async (_e, url) => shell.openExternal(url));
  ipcMain.on(CHANNELS.OPEN_HOME, () => createHomeWindow());

  ipcMain.on(CHANNELS.ASK_QUESTION, async (event, payload) => {
    const settings = storage.readSettings();
    const sender = event.sender;
    const isDestroyed = () => sender.isDestroyed();
    try {
      const iterator = await providers.ask(payload.imageBase64, payload.prompt, {
        provider: settings.provider, model: settings.model, apiKeys: settings.apiKeys, deviceId: settings.deviceId,
        threadHistory: payload.threadHistory || [],
      });
      let fullText = '';
      for await (const chunk of iterator) {
        if (isDestroyed()) return;
        fullText += chunk;
        sender.send(CHANNELS.STREAM_CHUNK, chunk);
      }
      if (!isDestroyed()) sender.send(CHANNELS.STREAM_END);
      if (payload.threadId) storage.appendMessage(payload.threadId, 'assistant', providers.cleanResponse(fullText));
    } catch (err) {
      console.error(`[ASK] provider=${settings.provider} error:`, err.message);
      if (!isDestroyed()) sender.send(CHANNELS.STREAM_ERROR, err.message || 'Failed to get response');
    }
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createHomeWindow(); });
  checkAndNotifyUpdate(false);
  registerUser();
});

app.on('window-all-closed', (e) => { e.preventDefault(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
