// settings.js — провайдер/модель/ключ, темы, хоткей, quick hotkeys
const providerEl = document.getElementById('provider');
const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('apiKey');
const hotkeyEl = document.getElementById('hotkey');
const alwaysOnTopEl = document.getElementById('alwaysOnTop');
const voiceInputEl = document.getElementById('voiceInput');
const statusEl = document.getElementById('status');
const themesGrid = document.getElementById('themes-grid');
const apikeySection = document.getElementById('apikey-section');

let currentThemeId = 'cyberNeon';

const MODEL_LISTS = {
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
  ],
  openrouter: [
    { id: 'openrouter/free', name: 'Auto (free router)' },
    { id: 'qwen/qwen2.5-vl-72b-instruct:free', name: 'Qwen 2.5 VL 72B' },
    { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B' },
    { id: 'meta-llama/llama-3.2-11b-vision-instruct:free', name: 'Llama 3.2 Vision 11B' },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 24B' },
  ],
  groq: [
    { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  ],
  mistral: [
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium' },
    { id: 'mistral-large-latest', name: 'Mistral Large' },
  ],
};

function populateModels(provider, selectedModel) {
  modelEl.innerHTML = '';
  const list = MODEL_LISTS[provider] || [];
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    modelEl.appendChild(opt);
  }
  if (selectedModel) modelEl.value = selectedModel;
}

function applyTheme(theme) {
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

async function loadGeneral() {
  const settings = await window.electronAPI.getSettings();
  providerEl.value = settings.provider || 'gemini';
  populateModels(settings.provider || 'gemini', settings.model);
  apiKeyEl.value = (settings.apiKeys && settings.apiKeys[settings.provider]) || '';
  hotkeyEl.value = settings.hotkey || 'Ctrl+Alt+Space';
  alwaysOnTopEl.checked = !!settings.settings?.alwaysOnTopChat;
  voiceInputEl.checked = settings.settings?.voiceInput !== false;
  currentThemeId = settings.theme || 'cyberNeon';
}

providerEl.addEventListener('change', async () => {
  const settings = await window.electronAPI.getSettings();
  apiKeyEl.value = (settings.apiKeys && settings.apiKeys[providerEl.value]) || '';
  populateModels(providerEl.value, settings.model);
});

hotkeyEl.addEventListener('keydown', (e) => {
  e.preventDefault();
  const keys = [];
  if (e.ctrlKey) keys.push('Ctrl');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');
  if (e.metaKey) keys.push('Super');
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    const keyName = e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    keys.push(keyName);
    hotkeyEl.value = keys.join('+');
  }
});

document.getElementById('save').addEventListener('click', async () => {
  const settings = await window.electronAPI.getSettings();
  const provider = providerEl.value;
  const apiKeys = { ...(settings.apiKeys || {}) };
  if (apiKeyEl.value.trim()) apiKeys[provider] = apiKeyEl.value.trim();
  await window.electronAPI.setSettings({
    ...settings,
    provider,
    model: modelEl.value,
    apiKeys,
    hotkey: hotkeyEl.value || 'Ctrl+Alt+Space',
    theme: currentThemeId,
    settings: {
      ...settings.settings,
      alwaysOnTopChat: alwaysOnTopEl.checked,
      voiceInput: voiceInputEl.checked,
    },
  });
  await window.electronAPI.updateHotkey(hotkeyEl.value || 'Ctrl+Alt+Space');
  statusEl.textContent = 'Сохранено';
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
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

// --- Темы ---
async function loadThemes() {
  const themes = await window.electronAPI.getThemes();
  themesGrid.innerHTML = '';
  for (const [id, theme] of Object.entries(themes)) {
    const card = document.createElement('div');
    card.className = `theme-card ${id === currentThemeId ? 'active' : ''}`;
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
      <div class="theme-name">${theme.name}</div>
    `;
    card.addEventListener('click', () => {
      currentThemeId = id;
      document.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      applyTheme(theme);
    });
    themesGrid.appendChild(card);
  }
  if (themes[currentThemeId]) applyTheme(themes[currentThemeId]);
}

// --- Quick Hotkeys ---
const hotkeysList = document.getElementById('hotkeys-list');

async function loadHotkeys() {
  const list = await window.electronAPI.getQuickHotkeys();
  hotkeysList.innerHTML = '';
  list.forEach((hk, i) => {
    const row = document.createElement('div');
    row.className = 'hk-row';
    row.innerHTML = `<b>${hk.combo}</b> → ${hk.prompt} <button data-i="${i}">✕</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await window.electronAPI.setQuickHotkeys(list.filter((_, idx) => idx !== i));
      loadHotkeys();
    });
    hotkeysList.appendChild(row);
  });
}

document.getElementById('hk-add').addEventListener('click', async () => {
  const combo = document.getElementById('hk-combo').value.trim();
  const prompt = document.getElementById('hk-prompt').value.trim();
  if (!combo || !prompt) return;
  const list = await window.electronAPI.getQuickHotkeys();
  if (list.length >= 10) { alert('Максимум 10 quick hotkeys'); return; }
  list.push({ id: Date.now().toString(), combo, prompt, label: prompt.slice(0, 20) });
  await window.electronAPI.setQuickHotkeys(list);
  document.getElementById('hk-combo').value = '';
  document.getElementById('hk-prompt').value = '';
  loadHotkeys();
});

// --- Табы ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});
if (location.hash === '#hotkeys') document.querySelector('[data-tab="hotkeys"]').click();
if (location.hash === '#themes') document.querySelector('[data-tab="themes"]').click();

loadGeneral();
loadThemes();
loadHotkeys();
