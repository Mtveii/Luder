// main.js — entry point: hotkeys, quick hotkeys, themes, tray, windows, IPC, updater
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer, screen, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const providers = require('./src/shared/providers');
const { KEY_HINTS, getModels } = require('./ai_config');
const modelRouter = require('./model_router');
const { validateConfig } = require('./modelValidator');
const { mapError } = require('./errorMapper');
const { buildContext } = require('./src/shared/context_manager');
const memoryManager = require('./src/shared/memory_manager');
const chatManager = require('./src/shared/chat_manager');
const storage = require('./src/shared/storage');
const updater = require('./src/shared/updater');
const { SERVER_URL, API_TOKEN } = require('./config');

// --- Лог ошибок клиента (userData/ludr-error.log, ротация 1 МБ) ---
const ERROR_LOG_MAX_BYTES = 1024 * 1024;
function writeErrorLog(level, msg) {
  try {
    const logPath = path.join(app.getPath('userData'), 'ludr-error.log');
    let st;
    try { st = fs.statSync(logPath); } catch (_) { st = null; }
    if (st && st.size > ERROR_LOG_MAX_BYTES) {
      try { fs.renameSync(logPath, logPath + '.1'); } catch (_) {}
    }
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${level} ${msg}\n`);
  } catch (_) {}
}

function initErrorLogging() {
  process.on('uncaughtException', (err) => writeErrorLog('uncaughtException', (err && err.stack) || String(err)));
  process.on('unhandledRejection', (reason) => writeErrorLog('unhandledRejection', (reason && reason.stack) || String(reason)));
  app.on('web-contents-created', (_e, contents) => {
    contents.on('console-message', (event, levelOrDetails, message) => {
      const level = typeof levelOrDetails === 'object' ? levelOrDetails.level : levelOrDetails;
      const msg = typeof levelOrDetails === 'object' ? levelOrDetails.message : message;
      if (level === 'error' || level === 'warning') writeErrorLog(`renderer:${level}`, msg);
    });
  });
}

// --- Single instance lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (homeWindow && !homeWindow.isDestroyed()) {
      homeWindow.show();
      homeWindow.restore();
      homeWindow.focus();
    } else if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.show();
      chatWindow.restore();
      chatWindow.focus();
    } else {
      createHomeWindow();
    }
  });
}

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

  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  DOWNLOAD_PROGRESS: 'download-progress',
  UPDATE_DOWNLOADED: 'update-downloaded',

  TOGGLE_PIN_CHAT: 'toggle-pin-chat',
  CAPTURE_AND_ATTACH: 'capture-and-attach',
  ATTACH_FILE: 'attach-file',

  GET_THEMES: 'get-themes',
  GET_THEME: 'get-theme',
  SET_THEME: 'set-theme',
  UPDATE_HOTKEY: 'update-hotkey',
  GET_ALL: 'get-all',
  GET_MODELS: 'get-models',
  GET_PROFILE_CONTEXT: 'get-profile-context',
  SET_PROFILE_CONTEXT: 'set-profile-context',
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
      headers: { 'Content-Type': 'application/json', ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}) },
      body: JSON.stringify({
        id: settings.deviceId,
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
  const previous = currentMainHotkey;
  if (currentMainHotkey) {
    globalShortcut.unregister(currentMainHotkey);
    currentMainHotkey = null;
  }
  if (!combo || combo.trim() === '') return true;
  try {
    const success = globalShortcut.register(combo, () => {
      if (overlayWindows.size === 0) createOverlayWindows();
    });
    if (success) {
      currentMainHotkey = combo;
      console.log(`[HOTKEY] Registered: ${combo}`);
      return true;
    } else {
      console.error(`[HOTKEY] Failed to register: ${combo} (returns false)`);
    }
  } catch (err) {
    console.error(`[HOTKEY] Failed to register ${combo}:`, err.message);
  }
  if (previous) {
    try {
      if (globalShortcut.register(previous, () => { if (overlayWindows.size === 0) createOverlayWindows(); })) currentMainHotkey = previous;
    } catch (err) { console.error(`[HOTKEY] Failed to re-register ${previous}:`, err.message); }
  }
  return false;
}

function registerQuickHotkeys() {
  dynamicQuickHotkeys.forEach((combo) => globalShortcut.unregister(combo));
  dynamicQuickHotkeys.length = 0;
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const hk of storage.listQuickHotkeys()) {
    const combo = typeof hk?.combo === 'string' ? hk.combo.trim() : '';
    const normalized = combo.toLowerCase();
    if (!combo || !hk?.prompt || seen.has(normalized) || normalized === String(currentMainHotkey || '').toLowerCase()) {
      rejected.push(combo || 'invalid shortcut');
      continue;
    }
    seen.add(normalized);
    try {
      const registered = globalShortcut.register(combo, () => { if (overlayWindows.size === 0) createOverlayWindows(hk.prompt); });
      if (!registered) {
        rejected.push(combo);
        continue;
      }
      dynamicQuickHotkeys.push(combo);
      accepted.push({ ...hk, combo });
    } catch (err) {
      rejected.push(combo);
      console.error(`Failed to register quick hotkey ${combo}:`, err.message);
    }
  }
  return { accepted, rejected };
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
      fullscreenable: false,
      icon: path.join(__dirname, 'assets/icon.png'),
      webPreferences: windowDefaults(),
    });

    // Highest possible z-order: above normal always-on-top windows, dialogs,
    // fullscreen apps and error windows. 'screen-saver' is the top level.
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    win.loadFile(path.join(__dirname, 'src/overlay/overlay.html'));

    win.webContents.once('did-finish-load', () => {
      const settings = storage.readSettings();
      const themes = storage.getThemes();
      const theme = themes[settings.theme] || themes.cyberNeon;
      win.webContents.send('overlay-theme', theme);

      // Find this display's capture
      const cap = monitorCaptures.find((c) => c.displayId === d.id);

      win.webContents.send('overlay-init', {
        displayBounds: b,
        displayIndex: i,
        captureDataUrl: cap ? cap.dataUrl : null,
        voiceInput: settings.settings?.voiceInput !== false,
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
    if (thread && !imageBase64) {
      chatWindow.webContents.send(CHANNELS.THREAD_LOADED, thread);
    } else {
      chatWindow.webContents.send(CHANNELS.REGION_CAPTURED, { imageBase64, prompt, threadId, thread });
    }
  });
  const win = chatWindow;
  win.on('closed', () => {
    if (chatWindow === win) chatWindow = null;
  });
}

function applyAutoStart(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: true,
      path: process.execPath,
      args: ['--hidden'],
    });
  } catch (err) { console.error('[AUTOSTART] Failed to apply:', err.message); }
}

function isAutoStartEnabled() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    return false;
  }
}

function createHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.show();
    homeWindow.restore();
    homeWindow.focus();
    runUpdateCheck(homeWindow);
    return;
  }
  homeWindow = new BrowserWindow({ width: 900, height: 640, icon: path.join(__dirname, 'assets/icon.png'), webPreferences: windowDefaults() });
  homeWindow.loadFile(path.join(__dirname, 'src/home/home.html'));
  homeWindow.webContents.once('did-finish-load', () => runUpdateCheck(homeWindow));
  homeWindow.on('closed', () => { homeWindow = null; });
}

// --- Capture all displays in parallel ---
async function captureDisplays() {
  const displays = screen.getAllDisplays();
  const results = await Promise.all(displays.map(async (d) => {
    const b = d.bounds;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: b.width, height: b.height } });
    let source = sources.find((s) => s.display_id === String(d.id));
    if (!source) source = sources[0];
    if (!source) return null;
    return { displayId: d.id, bounds: b, image: source.thumbnail, dataUrl: source.thumbnail.toDataURL() };
  }));
  return results.filter(Boolean);
}

async function captureMonitors() {
  const caps = await captureDisplays();
  return caps.map((c) => ({ displayId: c.displayId, bounds: c.bounds, dataUrl: c.dataUrl }));
}

// --- Capture region: crop per monitor, stitch into one image ---
async function captureRegion(rect) {
  const monitorImages = await captureDisplays();

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

    const onResult = (_e, dataUrl) => {
      clearTimeout(timeout);
      compositor.close();
      resolve(dataUrl.split(',')[1]);
    };
    ipcMain.once('composite-result', onResult);

    const timeout = setTimeout(() => {
      ipcMain.removeListener('composite-result', onResult);
      if (!compositor.isDestroyed()) {
        compositor.close();
        reject(new Error('Compositor timeout'));
      }
    }, 5000);
  });
}

async function runUpdateCheck(mainWindow) {
  try {
    const manifest = await updater.checkForUpdate();
    updater.logUpdate('check_ok', { current: app.getVersion(), remote: manifest ? manifest.version : null });
    if (manifest && manifest.hasUpdate) {
      const win = mainWindow || homeWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send(CHANNELS.UPDATE_AVAILABLE, manifest);
      }
    }
    return manifest || { hasUpdate: false };
  } catch (err) {
    updater.logUpdate('check_fail', { error: err.message });
    console.error('[UPDATER] Check failed:', err.message);
    return { hasUpdate: false, error: err.message };
  }
}

app.whenReady().then(() => {
  initErrorLogging();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));

  // Force reload settings to ensure API keys from .env are loaded
  const settings = storage.forceReloadSettings();
  console.log('[APP] Loaded API keys:', Object.keys(settings.apiKeys || {}));
  try {
    validateConfig(settings);
  } catch (err) {
    console.warn('[APP] Config validation:', err.message);
  }

  const savedHotkey = storage.getHotkey();
  registerMainHotkey(savedHotkey);
  registerQuickHotkeys();

  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Home', click: createHomeWindow },
    { type: 'separator' },
    { label: 'Check for updates', click: () => runUpdateCheck(homeWindow) },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip('Ludr Clone');
  tray.on('click', createHomeWindow);

  const isAutoStartLaunch = process.argv.some((a) => a === '--hidden' || a === '--minimized');
  if (!isAutoStartLaunch) createHomeWindow();
  else if (tray) tray.displayBalloon && tray.displayBalloon({ title: 'Luder', content: 'Работает в фоне. Нажмите на значок в трее, чтобы открыть.' });

  // --- Post-install log: after update, log successful launch ---
  try {
    const log = updater.getUpdateLog();
    if (log.includes('install_start') && !log.includes('launch_ok')) {
      updater.logUpdate('launch_ok', { version: app.getVersion() });
    }
  } catch (_) {}

  // --- Auto-start on PC boot (from settings) ---
  applyAutoStart(settings.settings?.autoStart === true);

  // --- Periodic update check: 5s delay, then every 6 hours ---
  setTimeout(() => runUpdateCheck(homeWindow), 5000);
  setInterval(() => runUpdateCheck(homeWindow), 6 * 60 * 60 * 1000);

  // --- IPC handlers ---

  // Capture region from overlay selection
  ipcMain.on(CHANNELS.CAPTURE_REGION, async (_e, { rect, prompt, quickHotkey }) => {
    try {
      const imageBase64 = await captureRegion(rect);
      closeAllOverlays();

      if (attachTargetThreadId) {
        const threadId = attachTargetThreadId;
        attachTargetThreadId = null;
        storage.appendMessage(threadId, 'user', prompt || '', imageBase64);
        if (chatWindow) chatWindow.webContents.send(CHANNELS.REGION_CAPTURED, { imageBase64, prompt, threadId, attach: true });
        return;
      }

      const finalPrompt = prompt || 'Analyze this image.';
      const settings = storage.readSettings();
      const { threadId, thread } = chatManager.getOrResumeThread({
        title: finalPrompt,
        provider: settings.provider,
        imageBase64,
      });
      createChatWindow({ imageBase64, prompt: finalPrompt, threadId, thread });
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

      // Broadcast selectionDone to ALL overlays
      for (const [, win] of overlayWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send('selectionDone', { rect, askBarDisplayIndex: senderDisplayIndex });
        }
      }
      return;
    }

    // Broadcast selectionChanged to ALL overlays
    const state = { start: { ...selection.start }, current: { ...selection.current } };
    for (const [, win] of overlayWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('selectionChanged', state);
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
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return { base64: fs.readFileSync(filePath).toString('base64'), mimeType };
  });

  ipcMain.on(CHANNELS.TOGGLE_PIN_CHAT, (_e, pinned) => { if (chatWindow) chatWindow.setAlwaysOnTop(pinned); });

  ipcMain.handle(CHANNELS.GET_ALL, async () => ({
    settings: { ...storage.readSettings(), tier: storage.getTier() },
    stats: storage.getStats(),
    threads: storage.listThreads(),
    themes: storage.getThemes(),
    hotkeys: storage.listQuickHotkeys(),
    username: os.userInfo().username,
    keyHints: KEY_HINTS,
    version: app.getVersion(),
  }));

  ipcMain.handle(CHANNELS.GET_SETTINGS, async () => storage.readSettings());
  ipcMain.handle(CHANNELS.SET_SETTINGS, async (_e, data) => storage.writeSettings(data));

  ipcMain.handle(CHANNELS.GET_PROFILE_CONTEXT, async (_e, deviceId) => {
    if (!deviceId) return '';
    return memoryManager.readProfile(deviceId);
  });
  ipcMain.handle(CHANNELS.SET_PROFILE_CONTEXT, async (_e, { deviceId, content }) => {
    if (!deviceId) throw new Error('No deviceId');
    memoryManager.writeProfileRaw(deviceId, content);
    return true;
  });

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
    if (!Array.isArray(list)) throw new Error('Hotkeys must be a list');
    storage.setQuickHotkeys(list);
    const result = registerQuickHotkeys();
    storage.setQuickHotkeys(result.accepted);
    return result;
  });

  ipcMain.handle(CHANNELS.GET_THEMES, async () => storage.getThemes());
  ipcMain.handle(CHANNELS.GET_THEME, async (_e, themeId) => storage.getTheme(themeId));
  ipcMain.handle(CHANNELS.SET_THEME, async (_e, themeId) => storage.setTheme(themeId));

  ipcMain.handle(CHANNELS.UPDATE_HOTKEY, async (_e, combo) => {
    const registered = registerMainHotkey(combo);
    if (registered) storage.setHotkey(combo);
    return { ok: registered, combo: currentMainHotkey, registered };
  });

  ipcMain.handle(CHANNELS.GET_MODELS, async (_e, provider) => getModels(provider));

  ipcMain.handle(CHANNELS.CHECK_FOR_UPDATES, async () => {
    const manifest = await updater.checkForUpdate();
    if (manifest && manifest.hasUpdate) {
      return { hasUpdate: true, latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, source: 'server' };
    }
    return { hasUpdate: false, source: 'server' };
  });

  ipcMain.handle(CHANNELS.UPDATE_CHECK, async () => runUpdateCheck(homeWindow));

  ipcMain.handle(CHANNELS.UPDATE_DOWNLOAD, async (_e, manifest) => {
    const installerPath = await updater.downloadUpdate(manifest, homeWindow);
    return { path: installerPath };
  });

  ipcMain.handle(CHANNELS.UPDATE_INSTALL, async (_e, installerPath) => {
    updater.quitAndInstall(installerPath);
  });

  ipcMain.handle('set-auto-start', async (_e, enabled) => {
    applyAutoStart(enabled);
    return isAutoStartEnabled();
  });
  ipcMain.handle('get-auto-start', async () => isAutoStartEnabled());

  ipcMain.handle('download-update', async (_e, { url }) => {
    if (!url || !url.startsWith(SERVER_URL)) throw new Error('Forbidden URL');
    const { spawn } = require('child_process');
    const tmpPath = path.join(app.getPath('temp'), 'luder-update.exe');

    // Download
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    // Launch installer and quit
    const child = spawn(tmpPath, ['/S'], { detached: true, stdio: 'ignore' });
    child.unref();
    app.quit();
    return { ok: true };
  });
  ipcMain.handle(CHANNELS.GET_OS_USERNAME, async () => os.userInfo().username);
  ipcMain.handle(CHANNELS.OPEN_EXTERNAL, async (_e, url) => {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol');
    return shell.openExternal(parsed.toString());
  });
  ipcMain.on(CHANNELS.OPEN_HOME, () => createHomeWindow());

  ipcMain.on(CHANNELS.ASK_QUESTION, async (event, payload) => {
    const settings = storage.readSettings();
    const sender = event.sender;
    const isDestroyed = () => sender.isDestroyed();
    try {
      const limit = storage.checkDailyLimit();
      if (!limit.allowed) throw new Error(`Daily limit reached (${limit.count}/${limit.limit})`);
      if (payload.persistUser && payload.threadId) {
        storage.appendMessage(payload.threadId, 'user', payload.prompt || '', payload.userImageBase64 || null);
      }
      const { threadHistory, profileContext } = buildContext({
        threadHistory: payload.threadHistory || [],
        deviceId: settings.deviceId,
      });
      const ac = new AbortController();
      sender.once('destroyed', () => ac.abort());
      const iterator = settings.provider === 'luder'
        ? modelRouter.modelRouterAsk(payload.imageBase64, payload.prompt, {
            model: settings.model,
            apiKeys: settings.apiKeys,
            deviceId: settings.deviceId,
            threadHistory,
            profileContext,
            signal: ac.signal,
          })
        : await providers.ask(payload.imageBase64, payload.prompt, {
            provider: settings.provider, model: settings.model, apiKeys: settings.apiKeys, deviceId: settings.deviceId,
            threadHistory,
            profileContext,
            signal: ac.signal,
          });
      let fullText = '';
      for await (const chunk of iterator) {
        if (isDestroyed()) return;
        fullText += chunk;
        sender.send(CHANNELS.STREAM_CHUNK, chunk);
      }
      if (!isDestroyed()) {
        const { text: cleanedText, topic } = memoryManager.extractTopicTag(fullText);
        const finalText = providers.cleanResponse(cleanedText);
        sender.send(CHANNELS.STREAM_END, { cleanedText: finalText });
        if (topic) memoryManager.recordTopic(settings.deviceId, topic);
        if (payload.threadId) storage.appendMessage(payload.threadId, 'assistant', finalText);
      }
      storage.incrementDailyRequests();
    } catch (err) {
      const userMsg = mapError(err);
      console.error(`[ASK] provider=${settings.provider} error:`, err.message || err);
      if (!isDestroyed()) sender.send(CHANNELS.STREAM_ERROR, userMsg);
    }
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createHomeWindow(); });
  registerUser();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // stay in tray for background work (update checks); user quits via tray menu
  }
});
app.on('will-quit', () => {
  storage.flushPendingWrites();
  globalShortcut.unregisterAll();
  console.log('[QUIT] Clean shutdown OK');
});
