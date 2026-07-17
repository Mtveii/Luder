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
document.getElementById('nav-settings').addEventListener('click', () => showPage('settings'));

// --- Применение темы ---
function applyThemeCSS(theme) {
  const r = document.documentElement.style;
  r.setProperty('--bg', theme.bg);
  r.setProperty('--surface', theme.surface);
  r.setProperty('--primary', theme.primary);
  r.setProperty('--secondary', theme.secondary);
  r.setProperty('--accent', theme.accent);
  r.setProperty('--text', theme.text);
  r.setProperty('--gray', theme.gray);
  r.setProperty('--border', theme.border || 'rgba(255,255,255,0.08)');
  r.setProperty('--hover', theme.hover || 'rgba(255,255,255,0.05)');
  r.setProperty('--selection', theme.selection || theme.primary + '33');
  r.setProperty('--btn-bg', theme.btnBg || theme.surface);
  r.setProperty('--btn-text', theme.btnText || theme.text);
  document.body.style.background = theme.bg;
  document.body.style.color = theme.text;
}

// --- Рендер из кеша (без доп. IPC) ---
function renderGreeting(name, settings) {
  greetingEl.textContent = `Hi, ${name}`;
  const provName = settings.provider === 'luder' ? 'LUDR' : (settings.provider || 'gemini').toUpperCase();
  document.getElementById('hotkey-hint').innerHTML = `Provider: <b>${provName}</b> — Press <b>Ctrl+Alt+Space</b>`;
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
function renderHotkeys(list) {
  hotkeysList.innerHTML = '';
  list.forEach((hk, i) => {
    const row = document.createElement('div');
    row.className = 'hk-row';
    row.style.animation = `fadeSlideIn 0.25s ease ${i * 0.04}s both`;
    row.innerHTML = `<b>${hk.combo}</b> → ${hk.prompt} <button data-i="${i}">✕</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      row.style.animation = 'fadeOut 0.2s ease forwards';
      await new Promise((r) => setTimeout(r, 200));
      const updated = list.filter((_, idx) => idx !== i);
      await window.electronAPI.setQuickHotkeys(updated);
      cached.hotkeys = updated;
      renderHotkeys(updated);
    });
    hotkeysList.appendChild(row);
  });
}

document.getElementById('hk-add').addEventListener('click', async () => {
  const combo = document.getElementById('hk-combo').value.trim();
  const prompt = document.getElementById('hk-prompt').value.trim();
  if (!combo || !prompt || !cached) return;
  if (cached.hotkeys.length >= 10) { alert('Максимум 10 quick hotkeys'); return; }
  cached.hotkeys.push({ id: Date.now().toString(), combo, prompt, label: prompt.slice(0, 20) });
  await window.electronAPI.setQuickHotkeys(cached.hotkeys);
  document.getElementById('hk-combo').value = '';
  document.getElementById('hk-prompt').value = '';
  renderHotkeys(cached.hotkeys);
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
}

providerEl.addEventListener('change', async () => {
  if (!cached) return;
  apiKeyEl.value = (cached.settings.apiKeys && cached.settings.apiKeys[providerEl.value]) || '';
  populateModels(providerEl.value, cached.settings.model);
  updateKeyHint(providerEl.value);
});

function updateKeyHint(provider) {
  const hintEl = document.getElementById('key-hint');
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
    currentTier = tier;
    renderTier(tier);
    if (cached) cached.tier = tier;
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
    settings: { ...cached.settings.settings, alwaysOnTopChat: alwaysOnTopEl.checked, voiceInput: voiceInputEl.checked },
  };
  await window.electronAPI.setSettings(newSettings);
  cached.settings = newSettings;
  const result = await window.electronAPI.updateHotkey(hotkeyEl.value || 'Ctrl+Alt+Space');
  statusEl.textContent = result?.registered ? 'Сохранено' : 'Сохранено (хоткей может не работать)';
  statusEl.style.animation = 'fadeSlideIn 0.3s ease';
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

document.getElementById('check-update').addEventListener('click', async () => {
  statusEl.textContent = 'Проверка...';
  try {
    const result = await window.electronAPI.checkForUpdates();
    statusEl.textContent = result.hasUpdate ? `Доступна версия ${result.latestVersion}` : 'У вас последняя версия';
  } catch (err) {
    statusEl.textContent = `Ошибка: ${err.message}`;
  }
});

// --- Обновление баннера ---
window.electronAPI.onUpdateAvailable((info) => {
  updateBanner.classList.remove('hidden');
  updateBanner.style.animation = 'fadeSlideIn 0.4s ease';
  updateBanner.innerHTML = `Доступна новая версия ${info.latestVersion}. <a href="#" id="update-link">Скачать</a>`;
  document.getElementById('update-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.openExternal(info.url);
  });
});

// --- INIT: один IPC call ---
(async () => {
  cached = await window.electronAPI.getAll();
  allThreads = cached.threads;
  keyHints = cached.keyHints || {};
  renderGreeting(cached.username, cached.settings);
  renderStats(cached.stats);
  renderRecent(cached.threads);
  renderSpotlight();
  renderThemes(cached.themes, cached.settings.theme || 'cyberNeon');
  renderHotkeys(cached.hotkeys);
  renderSettings(cached.settings);
  updateKeyHint(cached.settings.provider || 'luder');
  renderTier(cached.tier || cached.settings.tier || 'free');
  updateTierStatus();
})();
