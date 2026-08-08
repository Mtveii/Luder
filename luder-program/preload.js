// preload.js — мост renderer <-> main (4.3.6)
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  CAPTURE_REGION: 'capture-region', REGION_CAPTURED: 'region-captured',
  ASK_QUESTION: 'ask-question', STREAM_CHUNK: 'stream-chunk', STREAM_END: 'stream-end', STREAM_ERROR: 'stream-error',
  GET_SETTINGS: 'get-settings', SET_SETTINGS: 'set-settings',
  CLOSE_OVERLAY: 'close-overlay', CLOSE_CHAT: 'close-chat',
  OPEN_HOME: 'open-home',
  OPEN_EXTERNAL: 'open-external', GET_OS_USERNAME: 'get-os-username',
  GET_STATS: 'get-stats', GET_THREADS: 'get-threads', REOPEN_THREAD: 'reopen-thread',
  THREAD_LOADED: 'thread-loaded', TOGGLE_FAVORITE: 'toggle-favorite',
  DELETE_THREAD: 'delete-thread', CLEAR_HISTORY: 'clear-history',
  GET_QUICK_HOTKEYS: 'get-quick-hotkeys', SET_QUICK_HOTKEYS: 'set-quick-hotkeys', QUICK_HOTKEY_PROMPT: 'quick-hotkey-prompt',
  CHECK_FOR_UPDATES: 'check-for-updates', UPDATE_AVAILABLE: 'update-available',
  TOGGLE_PIN_CHAT: 'toggle-pin-chat', CAPTURE_AND_ATTACH: 'capture-and-attach', ATTACH_FILE: 'attach-file',
  GET_THEMES: 'get-themes',   GET_THEME: 'get-theme', SET_THEME: 'set-theme',
  UPDATE_HOTKEY: 'update-hotkey',
  GET_ALL: 'get-all', GET_MODELS: 'get-models',
  GET_PROFILE_CONTEXT: 'get-profile-context', SET_PROFILE_CONTEXT: 'set-profile-context',
};

contextBridge.exposeInMainWorld('electronAPI', {
  on: (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
  send: (channel, data) => ipcRenderer.send(channel, data),
  captureRegion: (rect, prompt, quickHotkey) => ipcRenderer.send(CHANNELS.CAPTURE_REGION, { rect, prompt, quickHotkey: !!quickHotkey }),
  closeOverlay: () => ipcRenderer.send(CHANNELS.CLOSE_OVERLAY),
  closeChat: () => ipcRenderer.send(CHANNELS.CLOSE_CHAT),
  onQuickHotkeyPrompt: (cb) => ipcRenderer.on(CHANNELS.QUICK_HOTKEY_PROMPT, (_e, prompt) => cb(prompt)),

  onRegionCaptured: (cb) => ipcRenderer.on(CHANNELS.REGION_CAPTURED, (_e, data) => cb(data)),
  onThreadLoaded: (cb) => ipcRenderer.on(CHANNELS.THREAD_LOADED, (_e, thread) => cb(thread)),

  askQuestion: (payload) => ipcRenderer.send(CHANNELS.ASK_QUESTION, payload),
  onStreamChunk: (cb) => ipcRenderer.on(CHANNELS.STREAM_CHUNK, (_e, chunk) => cb(chunk)),
  onStreamEnd: (cb) => ipcRenderer.on(CHANNELS.STREAM_END, (_e, data) => cb(data)),
  onStreamError: (cb) => ipcRenderer.on(CHANNELS.STREAM_ERROR, (_e, msg) => cb(msg)),

  getSettings: () => ipcRenderer.invoke(CHANNELS.GET_SETTINGS),
  setSettings: (data) => ipcRenderer.invoke(CHANNELS.SET_SETTINGS, data),

  getStats: () => ipcRenderer.invoke(CHANNELS.GET_STATS),
  getThreads: () => ipcRenderer.invoke(CHANNELS.GET_THREADS),
  reopenThread: (threadId) => ipcRenderer.send(CHANNELS.REOPEN_THREAD, threadId),
  toggleFavorite: (threadId) => ipcRenderer.invoke(CHANNELS.TOGGLE_FAVORITE, threadId),
  deleteThread: (threadId) => ipcRenderer.invoke(CHANNELS.DELETE_THREAD, threadId),
  clearHistory: () => ipcRenderer.invoke(CHANNELS.CLEAR_HISTORY),

  getQuickHotkeys: () => ipcRenderer.invoke(CHANNELS.GET_QUICK_HOTKEYS),
  setQuickHotkeys: (list) => ipcRenderer.invoke(CHANNELS.SET_QUICK_HOTKEYS, list),

  checkForUpdates: () => ipcRenderer.invoke(CHANNELS.CHECK_FOR_UPDATES),
  onUpdateAvailable: (cb) => ipcRenderer.on(CHANNELS.UPDATE_AVAILABLE, (_e, info) => cb(info)),

  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, data) => cb(data)),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdateManifest: (manifest) => ipcRenderer.invoke('update:download', manifest),
  installUpdate: (installerPath) => ipcRenderer.invoke('update:install', installerPath),

  togglePinChat: (pinned) => ipcRenderer.send(CHANNELS.TOGGLE_PIN_CHAT, pinned),
  captureAndAttach: (threadId) => ipcRenderer.send(CHANNELS.CAPTURE_AND_ATTACH, { threadId }),
  attachFile: () => ipcRenderer.invoke(CHANNELS.ATTACH_FILE),

  getThemes: () => ipcRenderer.invoke(CHANNELS.GET_THEMES),
  getTheme: (themeId) => ipcRenderer.invoke(CHANNELS.GET_THEME, themeId),
  setTheme: (themeId) => ipcRenderer.invoke(CHANNELS.SET_THEME, themeId),

  getTier: () => ipcRenderer.invoke('get-tier'),
  setTier: (tier) => ipcRenderer.invoke('set-tier', tier),
  getDailyUsage: () => ipcRenderer.invoke('get-daily-usage'),

  updateHotkey: (combo) => ipcRenderer.invoke(CHANNELS.UPDATE_HOTKEY, combo),
  getAll: () => ipcRenderer.invoke(CHANNELS.GET_ALL),
  getModels: (provider) => ipcRenderer.invoke(CHANNELS.GET_MODELS, provider),

  getOsUsername: () => ipcRenderer.invoke(CHANNELS.GET_OS_USERNAME),
  openHome: () => ipcRenderer.send(CHANNELS.OPEN_HOME),
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL, url),

  getProfileContext: (deviceId) => ipcRenderer.invoke(CHANNELS.GET_PROFILE_CONTEXT, deviceId),
  setProfileContext: (deviceId, content) => ipcRenderer.invoke(CHANNELS.SET_PROFILE_CONTEXT, { deviceId, content }),

  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
});

contextBridge.exposeInMainWorld('updaterAPI', {
  onAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, data) => cb(data)),
  download: (manifest) => ipcRenderer.invoke('update:download', manifest),
  install: (installerPath) => ipcRenderer.invoke('update:install', installerPath),
});
