// home.js — всё в одном окне: главная, история, темы, hotkeys, настройки
const greetingEl = document.getElementById('greeting');
const hdrStreak = document.getElementById('hdr-streak');
const hdrToday = document.getElementById('hdr-today');
const hdrTotal = document.getElementById('hdr-total');
const weekChart = document.getElementById('week-chart');
const recentList = document.getElementById('recent-list');
const updateBanner = document.getElementById('update-banner');
const themesGrid = document.getElementById('themes-grid');
const hotkeysList = document.getElementById('hotkeys-list');
const historyList = document.getElementById('history-list');
const searchEl = document.getElementById('search');
const providerEl = document.getElementById('provider');
const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('apiKey');
const hotkeyEl = document.getElementById('hotkey');
const alwaysOnTopEl = document.getElementById('alwaysOnTop');
const voiceInputEl = document.getElementById('voiceInput');
const autoStartEl = document.getElementById('autoStart');
const statusEl = document.getElementById('status');
const themeStatus = document.getElementById('theme-status');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SPOTLIGHT_ITEMS = [
  { title: 'Quick Hotkeys', text: 'Bind up to 10 custom shortcuts to fixed prompts.' },
  { title: 'Voice → text', text: 'Hit mic, speak, silence auto-stops.' },
  { title: 'Luder Free', text: 'No API key needed — just press Ctrl+Alt+Space.' },
];
let spotlightIndex = 0;
let selectedThemeId = null;
let allThreads = [];
let cached = null;
let keyHints = {};

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// --- Навигация с анимацией ---
function showPage(pageId) {
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.animation = 'none'; });
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  const btn = document.getElementById(`nav-${pageId}`);
  if (page) { page.style.animation = 'fadeSlideIn 0.25s ease forwards'; page.classList.add('active'); }
  if (btn) btn.classList.add('active');
  if (pageId === 'history') {
    allThreads = cached.threads;
    renderHistory(allThreads);
  }
}

document.getElementById('nav-home').addEventListener('click', () => showPage('home'));
document.getElementById('nav-history').addEventListener('click', () => showPage('history'));
document.getElementById('nav-themes').addEventListener('click', () => showPage('themes'));
document.getElementById('nav-hotkeys').addEventListener('click', () => showPage('hotkeys'));
document.getElementById('nav-profile').addEventListener('click', () => { showPage('profile'); loadProfileContext(); });
document.getElementById('nav-settings').addEventListener('click', () => showPage('settings'));

// --- Рендер из кеша (без доп. IPC) ---
function renderGreeting(name, settings) {
  const displayName = settings.profile?.displayName?.trim() || name;
  greetingEl.textContent = `Hi, ${displayName}`;
  const provName = settings.provider === 'luder' ? 'LUDR' : (settings.provider || 'gemini').toUpperCase();
  const hotkey = settings.hotkey || 'Ctrl+Alt+Space';
  document.getElementById('hotkey-hint').innerHTML = `Provider: <b>${provName}</b> — Press <b>${escapeHtml(hotkey)}</b>`;
}

function renderProfile(settings, fallbackName) {
  const name = settings.profile?.displayName?.trim() || fallbackName;
  document.getElementById('profile-name').value = settings.profile?.displayName || '';
  document.getElementById('profile-name-preview').textContent = name;
  document.getElementById('profile-avatar').textContent = (name || 'L').slice(0, 1).toUpperCase();
  document.getElementById('profile-device-id').textContent = settings.deviceId || '—';
}

function renderStats(stats) {
  hdrStreak.textContent = `🔥 ${stats.dayStreak} day streak`;
  hdrToday.textContent = `⚡ ${stats.asksToday} today`;
  hdrTotal.textContent = `🕘 ${stats.asksTotal} total`;
  weekChart.innerHTML = '';
  const max = Math.max(1, ...stats.weekly);
  const today = new Date().getDay();
  stats.weekly.forEach((count, i) => {
    const dayIndex = (today - 6 + i + 7) % 7;
    const bar = document.createElement('div');
    bar.className = 'week-bar';
    bar.style.animation = `growUp 0.4s ease ${i * 0.05}s both`;
    bar.innerHTML = `<div class="bar-fill" style="height:${Math.max(4, (count / max) * 60)}px"></div><span>${DAY_LABELS[dayIndex]}</span>`;
    weekChart.appendChild(bar);
  });
}

function renderRecent(threads) {
  recentList.innerHTML = '';
  threads.slice(0, 8).forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.style.animation = `fadeSlideIn 0.3s ease ${i * 0.04}s both`;
    row.innerHTML = `<span class="recent-title">${t.favorite ? '★ ' : ''}${escapeHtml(t.title)}</span><span class="recent-date">${new Date(t.createdAt).toLocaleDateString()}</span>`;
    row.addEventListener('click', () => window.electronAPI.reopenThread(t.id));
    recentList.appendChild(row);
  });
}

async function refreshDashboard() {
  const [stats, threads] = await Promise.all([window.electronAPI.getStats(), window.electronAPI.getThreads()]);
  cached.stats = stats;
  cached.threads = threads;
  allThreads = threads;
  renderStats(stats);
  renderRecent(threads);
}

function renderSpotlight() {
  const el = document.getElementById('spotlight-title');
  const textEl = document.getElementById('spotlight-text');
  el.style.animation = 'fadeSlideIn 0.3s ease';
  textEl.style.animation = 'fadeSlideIn 0.3s ease 0.05s both';
  const item = SPOTLIGHT_ITEMS[spotlightIndex];
  el.textContent = item.title;
  textEl.textContent = item.text;
}
document.getElementById('spotlight-btn').addEventListener('click', () => {
  spotlightIndex = (spotlightIndex + 1) % SPOTLIGHT_ITEMS.length;
  renderSpotlight();
});

// --- ИСТОРИЯ ---
function renderHistory(threads) {
  historyList.innerHTML = '';
  threads.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.style.animation = `fadeSlideIn 0.25s ease ${i * 0.03}s both`;
    row.innerHTML = `
      <div class="history-main">
        <span class="fav">${t.favorite ? '★' : '☆'}</span>
        <span class="history-title">${escapeHtml(t.title)}</span>
      </div>
      <div class="history-actions">
        <span class="history-date">${new Date(t.createdAt).toLocaleString()}</span>
        <button class="history-delete" title="Delete">✕</button>
      </div>`;
    row.querySelector('.history-title').addEventListener('click', () => window.electronAPI.reopenThread(t.id));
    row.querySelector('.fav').addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await window.electronAPI.toggleFavorite(t.id);
      e.target.textContent = updated?.favorite ? '★' : '☆';
    });
    row.querySelector('.history-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      row.style.animation = 'fadeOut 0.2s ease forwards';
      await new Promise((r) => setTimeout(r, 200));
      await window.electronAPI.deleteThread(t.id);
      allThreads = allThreads.filter((th) => th.id !== t.id);
      cached.threads = allThreads;
      renderHistory(allThreads);
      refreshDashboard();
    });
    historyList.appendChild(row);
  });
}

document.getElementById('clear-history').addEventListener('click', async () => {
  if (!confirm('Delete all chat history?')) return;
  await window.electronAPI.clearHistory();
  allThreads = [];
  cached.threads = [];
  renderHistory([]);
  refreshDashboard();
});

document.getElementById('save-profile').addEventListener('click', async () => {
  if (!cached) return;
  const displayName = document.getElementById('profile-name').value.trim().slice(0, 40);
  cached.settings.profile = { ...(cached.settings.profile || {}), displayName };
  await window.electronAPI.setSettings(cached.settings);
  renderGreeting(cached.username, cached.settings);
  renderProfile(cached.settings, cached.username);
  const usage = await window.electronAPI.getDailyUsage();
  cached.settings.tier = usage.tier;
  renderTier(usage.tier);
  updateTierStatus();
  const status = document.getElementById('profile-status');
  status.textContent = usage.tier === 'max' ? 'Saved — Max access enabled' : 'Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

async function loadProfileContext() {
  if (!cached) return;
  const deviceId = cached.settings.deviceId;
  if (!deviceId) return;
  const content = await window.electronAPI.getProfileContext(deviceId);
  document.getElementById('profile-context').value = content;
}

document.getElementById('save-profile-context').addEventListener('click', async () => {
  if (!cached) return;
  const deviceId = cached.settings.deviceId;
  if (!deviceId) { document.getElementById('profile-context-status').textContent = 'No device ID'; return; }
  const content = document.getElementById('profile-context').value;
  await window.electronAPI.setProfileContext(deviceId, content);
  const status = document.getElementById('profile-context-status');
  status.textContent = 'Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

searchEl.addEventListener('input', () => {
  const q = searchEl.value.toLowerCase();
  renderHistory(allThreads.filter((t) => t.title.toLowerCase().includes(q)));
});

// --- ТЕМЫ ---
function renderThemes(themes, selectedId) {
  selectedThemeId = selectedId;
  themesGrid.innerHTML = '';
  for (const [id, theme] of Object.entries(themes)) {
    const card = document.createElement('div');
    card.className = `theme-card ${id === selectedThemeId ? 'active' : ''}`;
    card.innerHTML = `
      <div class="theme-preview" style="background:${theme.bg}">
        <div class="preview-accent" style="background:${theme.primary}"></div>
        <div class="preview-surface" style="background:${theme.surface}; border: 1px solid ${theme.primary}33"></div>
        <div class="preview-dots">
          <span style="background:${theme.primary}"></span>
          <span style="background:${theme.secondary}"></span>
          <span style="background:${theme.accent}"></span>
        </div>
      </div>
      <div class="theme-name">${theme.name}</div>`;
    card.addEventListener('click', () => {
      selectedThemeId = id;
      document.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
    themesGrid.appendChild(card);
  }
}

document.getElementById('apply-theme').addEventListener('click', async () => {
  if (!selectedThemeId || !cached) return;
  const theme = cached.themes[selectedThemeId];
  if (!theme) return;
  applyThemeCSS(theme);
  cached.settings.theme = selectedThemeId;
  await window.electronAPI.setSettings(cached.settings);
  themeStatus.textContent = 'Тема применена';
  themeStatus.style.animation = 'fadeSlideIn 0.3s ease';
  setTimeout(() => { themeStatus.textContent = ''; }, 2000);
});

// --- QUICK HOTKEYS ---
async function saveQuickHotkeys(list) {
  const result = await window.electronAPI.setQuickHotkeys(list);
  const saved = result?.accepted || result || [];
  cached.hotkeys = saved;
  renderHotkeys(saved);
  if (result?.rejected?.length) alert(`Could not register: ${result.rejected.join(', ')}`);
  return saved;
}

function renderHotkeys(list) {
  hotkeysList.innerHTML = '';
  list.forEach((hk, i) => {
    const row = document.createElement('div');
    row.className = 'hk-row';
    row.style.animation = `fadeSlideIn 0.25s ease ${i * 0.04}s both`;
    row.innerHTML = `<b>${escapeHtml(hk.combo)}</b> → ${escapeHtml(hk.prompt)} <button data-i="${i}">✕</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      row.style.animation = 'fadeOut 0.2s ease forwards';
      await new Promise((r) => setTimeout(r, 200));
      const updated = list.filter((_, idx) => idx !== i);
      await saveQuickHotkeys(updated);
    });
    hotkeysList.appendChild(row);
  });
}

document.getElementById('hk-add').addEventListener('click', async () => {
  const combo = document.getElementById('hk-combo').value.trim();
  const prompt = document.getElementById('hk-prompt').value.trim();
  if (!combo || !prompt || !cached) return;
  if (cached.hotkeys.length >= 10) { alert('Максимум 10 quick hotkeys'); return; }
  if (cached.hotkeys.some((hk) => hk.combo.toLowerCase() === combo.toLowerCase())) {
    alert('This shortcut already exists');
    return;
  }
  const candidate = [...cached.hotkeys, { id: Date.now().toString(), combo, prompt, label: prompt.slice(0, 20) }];
  await saveQuickHotkeys(candidate);
  document.getElementById('hk-combo').value = '';
  document.getElementById('hk-prompt').value = '';
});

// --- НАСТРОЙКИ ---
async function populateModels(provider, selectedModel) {
  modelEl.innerHTML = '';
  const list = await window.electronAPI.getModels(provider);
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    modelEl.appendChild(opt);
  }
  if (selectedModel) modelEl.value = selectedModel;
}

function renderSettings(settings) {
  providerEl.value = settings.provider || 'gemini';
  populateModels(settings.provider || 'gemini', settings.model);
  apiKeyEl.value = (settings.apiKeys && settings.apiKeys[settings.provider]) || '';
  hotkeyEl.value = settings.hotkey || 'Ctrl+Alt+Space';
  alwaysOnTopEl.checked = !!settings.settings?.alwaysOnTopChat;
  voiceInputEl.checked = settings.settings?.voiceInput !== false;
  autoStartEl.checked = settings.settings?.autoStart === true || (window.electronAPI.getAutoStart ? null : false);
  window.electronAPI.getAutoStart().then((v) => { if (typeof v === 'boolean') autoStartEl.checked = v; }).catch(() => {});
}

providerEl.addEventListener('change', async () => {
  if (!cached) return;
  apiKeyEl.value = (cached.settings.apiKeys && cached.settings.apiKeys[providerEl.value]) || '';
  populateModels(providerEl.value, cached.settings.model);
  updateKeyHint(providerEl.value);
});

function updateKeyHint(provider) {
  const hintEl = document.getElementById('key-hint');
  if (provider === 'luder') {
    hintEl.textContent = 'Luder routes your own provider keys. Add at least one API key below.';
    return;
  }
  if (hintEl && keyHints[provider]) {
    hintEl.textContent = keyHints[provider];
  } else if (hintEl) {
    hintEl.textContent = '';
  }
}

// --- ТАРИФЫ ---
let currentTier = 'free';

function renderTier(tier) {
  currentTier = tier;
  document.querySelectorAll('.tier-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.tier === tier);
  });
}

document.querySelectorAll('.tier-card').forEach((card) => {
  card.addEventListener('click', async () => {
    const tier = card.dataset.tier;
    if (tier !== 'free') {
      alert('Subscriptions are not available yet. The app remains on the Free plan.');
      return;
    }
    currentTier = tier;
    renderTier(tier);
    if (cached) cached.settings.tier = tier;
    await window.electronAPI.setTier(tier);
    updateTierStatus();
  });
});

async function updateTierStatus() {
  const usage = await window.electronAPI.getDailyUsage();
  const statusEl = document.getElementById('tier-status');
  if (!statusEl || !usage) return;
  const pct = usage.limit === Infinity ? 0 : Math.round((usage.count / usage.limit) * 100);
  const bar = usage.limit === Infinity ? '∞' : `${usage.count}/${usage.limit} today (${pct}%)`;
  statusEl.textContent = `Used today: ${bar}`;
}

hotkeyEl.addEventListener('keydown', (e) => {
  e.preventDefault();
  const keys = [];
  if (e.ctrlKey) keys.push('Ctrl');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');
  if (e.metaKey) keys.push('Super');
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    keys.push(e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key));
    hotkeyEl.value = keys.join('+');
  }
});

document.getElementById('save').addEventListener('click', async () => {
  if (!cached) return;
  const provider = providerEl.value;
  const apiKeys = { ...(cached.settings.apiKeys || {}) };
  if (apiKeyEl.value.trim()) apiKeys[provider] = apiKeyEl.value.trim();
  const newSettings = {
    ...cached.settings,
    provider,
    model: modelEl.value,
    apiKeys,
    hotkey: hotkeyEl.value || 'Ctrl+Alt+Space',
    settings: { ...cached.settings.settings, alwaysOnTopChat: alwaysOnTopEl.checked, voiceInput: voiceInputEl.checked, autoStart: autoStartEl.checked },
  };
  const result = await window.electronAPI.updateHotkey(hotkeyEl.value || 'Ctrl+Alt+Space');
  if (!result?.registered) {
    newSettings.hotkey = result?.combo || cached.settings.hotkey || 'Ctrl+Alt+Space';
    hotkeyEl.value = newSettings.hotkey;
  }
  await window.electronAPI.setSettings(newSettings);
  cached.settings = newSettings;
  renderGreeting(cached.username, cached.settings);
  statusEl.textContent = result?.registered ? 'Сохранено' : 'Не удалось зарегистрировать хоткей; сохранён предыдущий.';
  statusEl.style.animation = 'fadeSlideIn 0.3s ease';
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

let pendingUpdateManifest = null;

document.getElementById('check-update').addEventListener('click', async () => {
  statusEl.textContent = 'Проверка...';
  try {
    const result = await window.electronAPI.checkForUpdate();
    if (result.hasUpdate) {
      statusEl.textContent = `Доступна версия ${result.latestVersion}.`;
    } else {
      statusEl.textContent = 'У вас последняя версия';
    }
  } catch (err) {
    statusEl.textContent = `Ошибка: ${err.message}`;
  }
});

// --- Update banner ---
function clearBanner() {
  updateBanner.innerHTML = '';
  updateBanner.classList.add('hidden');
}

function showUpdateBanner(info) {
  pendingUpdateManifest = info;
  updateBanner.classList.remove('hidden');
  updateBanner.style.animation = 'fadeSlideIn 0.4s ease';
  updateBanner.innerHTML = '';

  const msg = document.createElement('span');
  msg.textContent = `Доступна новая версия ${info.version}. `;
  updateBanner.appendChild(msg);

  const updateBtn = document.createElement('button');
  updateBtn.textContent = 'Обновить';
  updateBtn.style.cssText = 'margin-left:8px;padding:4px 16px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600;';
  updateBtn.addEventListener('click', async () => {
    updateBtn.textContent = 'Загрузка...';
    updateBtn.disabled = true;
    try {
      await window.electronAPI.downloadUpdateManifest(info);
    } catch (err) {
      updateBtn.textContent = 'Ошибка';
      setTimeout(() => { updateBtn.textContent = 'Обновить'; updateBtn.disabled = false; }, 2000);
    }
  });
  updateBanner.appendChild(updateBtn);

  if (!info.mandatory) {
    const laterBtn = document.createElement('button');
    laterBtn.textContent = 'Позже';
    laterBtn.style.cssText = 'margin-left:4px;padding:4px 12px;border-radius:6px;border:none;background:var(--surface);color:var(--text);cursor:pointer;';
    laterBtn.addEventListener('click', () => clearBanner());
    updateBanner.appendChild(laterBtn);
  }
}

window.electronAPI.onUpdateAvailable((info) => showUpdateBanner(info));

window.electronAPI.onDownloadProgress((data) => {
  let bar = updateBanner.querySelector('.update-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'update-progress';
    bar.style.cssText = 'height:4px;background:var(--primary);border-radius:4px;margin-top:6px;transition:width 0.3s ease;';
    updateBanner.appendChild(bar);
  }
  bar.style.width = `${data.percent}%`;
});

window.electronAPI.onUpdateDownloaded((data) => {
  pendingUpdateManifest = null;
  updateBanner.innerHTML = '';
  updateBanner.classList.remove('hidden');

  const msg = document.createElement('span');
  msg.textContent = 'Обновление загружено. ';
  updateBanner.appendChild(msg);

  const installBtn = document.createElement('button');
  installBtn.textContent = 'Установить сейчас';
  installBtn.style.cssText = 'margin-left:8px;padding:4px 16px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600;';
  installBtn.addEventListener('click', () => {
    window.electronAPI.installUpdate(data.path);
  });
  updateBanner.appendChild(installBtn);

  const showLater = !pendingUpdateManifest?.mandatory;
  if (showLater) {
    const laterBtn = document.createElement('button');
    laterBtn.textContent = 'Позже';
    laterBtn.style.cssText = 'margin-left:4px;padding:4px 12px;border-radius:6px;border:none;background:var(--surface);color:var(--text);cursor:pointer;';
    laterBtn.addEventListener('click', () => clearBanner());
    updateBanner.appendChild(laterBtn);
  }
});

// --- INIT: один IPC call ---
(async () => {
  cached = await window.electronAPI.getAll();
  allThreads = cached.threads;
  keyHints = cached.keyHints || {};
  renderGreeting(cached.username, cached.settings);
  renderProfile(cached.settings, cached.username);
  renderStats(cached.stats);
  renderRecent(cached.threads);
  renderSpotlight();
  renderThemes(cached.themes, cached.settings.theme || 'cyberNeon');
  renderHotkeys(cached.hotkeys);
  renderSettings(cached.settings);
  updateKeyHint(cached.settings.provider || 'luder');
  renderTier(cached.settings.tier || 'free');
  updateTierStatus();
  loadProfileContext();
  document.getElementById('app-version').textContent = cached.version || '?';
})();
