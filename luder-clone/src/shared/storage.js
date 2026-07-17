// storage.js — настройки, треды-история, quick hotkeys, темы, статистика (4.2)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

function getStoragePath() { return path.join(app.getPath('userData'), 'storage.json'); }

// 20 тем приложения
const THEMES = {
  cyberNeon: {
    id: 'cyberNeon',
    name: 'Cyber Neon',
    bg: '#050816',
    surface: '#0F172A',
    primary: '#3B82F6',
    secondary: '#8B5CF6',
    accent: '#00F5FF',
    text: '#FFFFFF',
    gray: '#94A3B8',
    border: 'rgba(59,130,246,0.2)',
    hover: 'rgba(59,130,246,0.1)',
    selection: 'rgba(0,245,255,0.15)',
  },
  appleLuxury: {
    id: 'appleLuxury',
    name: 'Apple Luxury',
    bg: '#FFFFFF',
    surface: '#F5F5F7',
    primary: '#007AFF',
    secondary: '#8E8E93',
    accent: '#007AFF',
    text: '#181818',
    gray: '#8E8E93',
    border: 'rgba(0,122,255,0.15)',
    hover: 'rgba(0,122,255,0.06)',
    selection: 'rgba(0,122,255,0.12)',
    btnBg: '#007AFF',
    btnText: '#FFFFFF',
  },
  auroraGradient: {
    id: 'auroraGradient',
    name: 'Aurora Gradient',
    bg: '#121212',
    surface: '#1A1A2E',
    primary: '#6C63FF',
    secondary: '#9B5CFF',
    accent: '#00D4FF',
    text: '#FFFFFF',
    gray: '#94A3B8',
    border: 'rgba(108,99,255,0.2)',
    hover: 'rgba(108,99,255,0.1)',
    selection: 'rgba(0,212,255,0.15)',
  },
  glassmorphism: {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    bg: '#050505',
    surface: 'rgba(255,255,255,0.08)',
    primary: '#00E5FF',
    secondary: '#3B82F6',
    accent: '#00E5FF',
    text: '#FFFFFF',
    gray: '#94A3B8',
    border: 'rgba(0,229,255,0.15)',
    hover: 'rgba(0,229,255,0.08)',
    selection: 'rgba(0,229,255,0.12)',
  },
  spaceBlack: {
    id: 'spaceBlack',
    name: 'Space Black',
    bg: '#000000',
    surface: '#101010',
    primary: '#FFD700',
    secondary: '#FFFFFF',
    accent: '#FFD700',
    text: '#FFFFFF',
    gray: '#666666',
    border: 'rgba(255,215,0,0.2)',
    hover: 'rgba(255,215,0,0.08)',
    selection: 'rgba(255,215,0,0.15)',
    btnBg: '#FFD700',
    btnText: '#000000',
  },
  purpleFuture: {
    id: 'purpleFuture',
    name: 'Purple Future',
    bg: '#1A1025',
    surface: '#2E1065',
    primary: '#8B5CF6',
    secondary: '#C084FC',
    accent: '#8B5CF6',
    text: '#FFFFFF',
    gray: '#94A3B8',
    border: 'rgba(139,92,246,0.25)',
    hover: 'rgba(139,92,246,0.1)',
    selection: 'rgba(139,92,246,0.15)',
  },
  emeraldTech: {
    id: 'emeraldTech',
    name: 'Emerald Tech',
    bg: '#0F172A',
    surface: '#1E293B',
    primary: '#10B981',
    secondary: '#34D399',
    accent: '#10B981',
    text: '#FFFFFF',
    gray: '#CBD5E1',
    border: 'rgba(16,185,129,0.2)',
    hover: 'rgba(16,185,129,0.08)',
    selection: 'rgba(16,185,129,0.15)',
  },
  orangeStartup: {
    id: 'orangeStartup',
    name: 'Orange Startup',
    bg: '#FFF8F0',
    surface: '#FFFFFF',
    primary: '#FF6B35',
    secondary: '#FF9F1C',
    accent: '#FF6B35',
    text: '#222222',
    gray: '#666666',
    border: 'rgba(255,107,53,0.15)',
    hover: 'rgba(255,107,53,0.06)',
    selection: 'rgba(255,107,53,0.12)',
    btnBg: '#FF6B35',
    btnText: '#FFFFFF',
  },
  whiteModern: {
    id: 'whiteModern',
    name: 'White Modern',
    bg: '#FFFFFF',
    surface: '#F8FAFC',
    primary: '#2563EB',
    secondary: '#CBD5E1',
    accent: '#2563EB',
    text: '#111827',
    gray: '#6B7280',
    border: 'rgba(37,99,235,0.12)',
    hover: 'rgba(37,99,235,0.06)',
    selection: 'rgba(37,99,235,0.1)',
    btnBg: '#2563EB',
    btnText: '#FFFFFF',
  },
  luxuryAI: {
    id: 'luxuryAI',
    name: 'Luxury AI',
    bg: '#050505',
    surface: '#111111',
    primary: '#8B5CF6',
    secondary: '#FFD700',
    accent: '#3B82F6',
    text: '#FFFFFF',
    gray: '#94A3B8',
    border: 'rgba(139,92,246,0.2)',
    hover: 'rgba(139,92,246,0.08)',
    selection: 'rgba(59,130,246,0.15)',
  },
  // --- 10 новых тем ---
  rosewood: {
    id: 'rosewood',
    name: 'Rosewood',
    bg: '#1A0A0F',
    surface: '#2A1018',
    primary: '#E84057',
    secondary: '#FF6B8A',
    accent: '#FF2D55',
    text: '#F5E6EA',
    gray: '#B08090',
    border: 'rgba(232,64,87,0.2)',
    hover: 'rgba(232,64,87,0.1)',
    selection: 'rgba(255,45,85,0.15)',
  },
  deepOcean: {
    id: 'deepOcean',
    name: 'Deep Ocean',
    bg: '#0A1628',
    surface: '#0F2035',
    primary: '#FF6F61',
    secondary: '#FF9A76',
    accent: '#FF6F61',
    text: '#E0E8F0',
    gray: '#6B8BA4',
    border: 'rgba(255,111,97,0.2)',
    hover: 'rgba(255,111,97,0.08)',
    selection: 'rgba(255,111,97,0.12)',
  },
  retroSepia: {
    id: 'retroSepia',
    name: 'Retro Sepia',
    bg: '#2B1D0E',
    surface: '#3D2B16',
    primary: '#D4A843',
    secondary: '#C49A3C',
    accent: '#E8C547',
    text: '#F0E6D2',
    gray: '#A0896C',
    border: 'rgba(212,168,67,0.2)',
    hover: 'rgba(212,168,67,0.08)',
    selection: 'rgba(232,197,71,0.15)',
    btnBg: '#D4A843',
    btnText: '#1A0E05',
  },
  synthwave: {
    id: 'synthwave',
    name: 'Synthwave',
    bg: '#1B0533',
    surface: '#260D4A',
    primary: '#FF2975',
    secondary: '#00F0FF',
    accent: '#FF2975',
    text: '#FFFFFF',
    gray: '#9B7EC8',
    border: 'rgba(255,41,117,0.25)',
    hover: 'rgba(255,41,117,0.1)',
    selection: 'rgba(0,240,255,0.12)',
  },
  minimalGray: {
    id: 'minimalGray',
    name: 'Minimal Gray',
    bg: '#F2F2F2',
    surface: '#FFFFFF',
    primary: '#333333',
    secondary: '#888888',
    accent: '#333333',
    text: '#1A1A1A',
    gray: '#999999',
    border: 'rgba(0,0,0,0.08)',
    hover: 'rgba(0,0,0,0.04)',
    selection: 'rgba(0,0,0,0.06)',
    btnBg: '#333333',
    btnText: '#FFFFFF',
  },
  crimsonDark: {
    id: 'crimsonDark',
    name: 'Crimson Dark',
    bg: '#0D0008',
    surface: '#1A0012',
    primary: '#DC143C',
    secondary: '#FF1744',
    accent: '#DC143C',
    text: '#F8E8EE',
    gray: '#8B5060',
    border: 'rgba(220,20,60,0.2)',
    hover: 'rgba(220,20,60,0.1)',
    selection: 'rgba(220,20,60,0.12)',
  },
  oliveArmy: {
    id: 'oliveArmy',
    name: 'Olive Army',
    bg: '#1A1F0E',
    surface: '#252D15',
    primary: '#7CB342',
    secondary: '#AED581',
    accent: '#8BC34A',
    text: '#E8F0E0',
    gray: '#8A9A6C',
    border: 'rgba(124,179,66,0.2)',
    hover: 'rgba(124,179,66,0.08)',
    selection: 'rgba(139,195,74,0.12)',
  },
  neonCyan: {
    id: 'neonCyan',
    name: 'Neon Cyan',
    bg: '#050510',
    surface: '#0A0A1E',
    primary: '#00FFFF',
    secondary: '#00CCDD',
    accent: '#00FFFF',
    text: '#E0FFFF',
    gray: '#5A8A9A',
    border: 'rgba(0,255,255,0.15)',
    hover: 'rgba(0,255,255,0.08)',
    selection: 'rgba(0,255,255,0.1)',
  },
  lavenderSoft: {
    id: 'lavenderSoft',
    name: 'Lavender Soft',
    bg: '#F0EAF8',
    surface: '#FFFFFF',
    primary: '#9B72CF',
    secondary: '#B39DDB',
    accent: '#7E57C2',
    text: '#2C1F47',
    gray: '#9088A0',
    border: 'rgba(155,114,207,0.15)',
    hover: 'rgba(155,114,207,0.06)',
    selection: 'rgba(126,87,194,0.1)',
    btnBg: '#7E57C2',
    btnText: '#FFFFFF',
  },
  volcanoHeat: {
    id: 'volcanoHeat',
    name: 'Volcano Heat',
    bg: '#120A04',
    surface: '#1E1008',
    primary: '#FF5722',
    secondary: '#FF8A65',
    accent: '#FF3D00',
    text: '#FFF3E0',
    gray: '#A08060',
    border: 'rgba(255,87,34,0.2)',
    hover: 'rgba(255,87,34,0.08)',
    selection: 'rgba(255,61,0,0.12)',
  },
};

function defaultSettings() {
  return {
    deviceId: crypto.randomUUID(),
    provider: 'luder',
    apiKeys: {},
    hotkey: 'Ctrl+Alt+Space',
    theme: 'cyberNeon',
    quickHotkeys: [],
    threads: [],
    settings: { voiceInput: true, alwaysOnTopChat: true },
    updateInfo: { dismissedVersion: null },
    tier: 'free',
    dailyRequests: { date: null, count: 0 },
  };
}

let cache = null;

function readSettings() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(getStoragePath(), 'utf-8'));
    cache.quickHotkeys ||= [];
    cache.threads ||= [];
    cache.theme ||= 'cyberNeon';
    cache.settings ||= { voiceInput: true, alwaysOnTopChat: true };
    cache.updateInfo ||= { dismissedVersion: null };
    cache.tier ||= 'free';
    cache.dailyRequests ||= { date: null, count: 0 };
    cache.provider ||= 'luder';
  } catch {
    cache = defaultSettings();
    writeSettings(cache);
  }
  return cache;
}

function writeSettings(data) {
  cache = data;
  fs.writeFileSync(getStoragePath(), JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

function createThread({ title, provider, imageBase64 }) {
  const settings = readSettings();
  const thread = {
    id: crypto.randomUUID(),
    title: title.slice(0, 120),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider,
    favorite: false,
    messages: [{ role: 'user', text: title, imageBase64: imageBase64 || null, ts: Date.now() }],
  };
  settings.threads.unshift(thread);
  writeSettings(settings);
  return thread;
}

function appendMessage(threadId, role, text, imageBase64 = null) {
  const settings = readSettings();
  const thread = settings.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  thread.messages.push({ role, text, imageBase64, ts: Date.now() });
  thread.updatedAt = Date.now();
  writeSettings(settings);
  return thread;
}

function getThread(threadId) { return readSettings().threads.find((t) => t.id === threadId) || null; }

function toggleFavorite(threadId) {
  const settings = readSettings();
  const thread = settings.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  thread.favorite = !thread.favorite;
  writeSettings(settings);
  return thread;
}

function deleteThread(threadId) {
  const settings = readSettings();
  settings.threads = settings.threads.filter((t) => t.id !== threadId);
  writeSettings(settings);
  return settings.threads;
}

function clearHistory() {
  const settings = readSettings();
  settings.threads = [];
  writeSettings(settings);
  return [];
}

function listThreads() { return readSettings().threads; }

function getStats() {
  const threads = readSettings().threads;
  const dayMs = 86_400_000;
  const startOfDay = (ts) => Math.floor(ts / dayMs);
  const today = startOfDay(Date.now());

  const daysWithAsks = new Set(threads.map((t) => startOfDay(t.createdAt)));
  let dayStreak = 0, cursor = today;
  while (daysWithAsks.has(cursor)) { dayStreak += 1; cursor -= 1; }

  const asksToday = threads.filter((t) => startOfDay(t.createdAt) === today).length;
  const asksTotal = threads.length;

  const weekly = [];
  for (let i = 6; i >= 0; i -= 1) {
    const dayStart = today - i;
    weekly.push(threads.filter((t) => startOfDay(t.createdAt) === dayStart).length);
  }

  return { dayStreak, asksToday, asksTotal, weekly };
}

function listQuickHotkeys() { return readSettings().quickHotkeys; }

function setQuickHotkeys(list) {
  const settings = readSettings();
  settings.quickHotkeys = list.slice(0, 10);
  writeSettings(settings);
  return settings.quickHotkeys;
}

function getThemes() { return THEMES; }

function getTheme(themeId) { return THEMES[themeId] || THEMES.cyberNeon; }

function setTheme(themeId) {
  const settings = readSettings();
  settings.theme = themeId;
  writeSettings(settings);
  return THEMES[themeId] || THEMES.cyberNeon;
}

function getHotkey() { return readSettings().hotkey; }

function setHotkey(combo) {
  const settings = readSettings();
  settings.hotkey = combo;
  writeSettings(settings);
  return combo;
}

// --- Tier & daily limits ---
const TIER_LIMITS = { free: 20, pro: 200, max: Infinity };

function getTier() { return readSettings().tier || 'free'; }

function setTier(tier) {
  const settings = readSettings();
  settings.tier = tier;
  writeSettings(settings);
  return tier;
}

function checkDailyLimit() {
  const settings = readSettings();
  const today = new Date().toISOString().slice(0, 10);
  if (!settings.dailyRequests || settings.dailyRequests.date !== today) {
    settings.dailyRequests = { date: today, count: 0 };
    writeSettings(settings);
  }
  const limit = TIER_LIMITS[settings.tier] || TIER_LIMITS.free;
  return { allowed: settings.dailyRequests.count < limit, count: settings.dailyRequests.count, limit, tier: settings.tier };
}

function incrementDailyRequests() {
  const settings = readSettings();
  const today = new Date().toISOString().slice(0, 10);
  if (!settings.dailyRequests || settings.dailyRequests.date !== today) {
    settings.dailyRequests = { date: today, count: 0 };
  }
  settings.dailyRequests.count += 1;
  writeSettings(settings);
  return settings.dailyRequests.count;
}

function getDailyUsage() {
  const settings = readSettings();
  const today = new Date().toISOString().slice(0, 10);
  if (!settings.dailyRequests || settings.dailyRequests.date !== today) {
    return { count: 0, limit: TIER_LIMITS[settings.tier] || TIER_LIMITS.free, tier: settings.tier };
  }
  return { count: settings.dailyRequests.count, limit: TIER_LIMITS[settings.tier] || TIER_LIMITS.free, tier: settings.tier };
}

module.exports = {
  readSettings, writeSettings, getStoragePath,
  createThread, appendMessage, getThread, toggleFavorite, deleteThread, clearHistory, listThreads,
  getStats, listQuickHotkeys, setQuickHotkeys,
  getThemes, getTheme, setTheme, getHotkey, setHotkey,
  getTier, setTier, checkDailyLimit, incrementDailyRequests, getDailyUsage, TIER_LIMITS,
};
