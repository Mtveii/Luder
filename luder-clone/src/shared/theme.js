// theme.js — apply theme CSS variables from storage
(async function() {
  try {
    const s = await window.electronAPI.getSettings();
    const themes = await window.electronAPI.getThemes();
    const theme = themes[s.theme] || themes.cyberNeon;
    const r = document.documentElement.style;
    r.setProperty('--bg', theme.bg);
    r.setProperty('--surface', theme.surface);
    r.setProperty('--primary', theme.primary);
    r.setProperty('--secondary', theme.secondary);
    r.setProperty('--accent', theme.accent || theme.primary);
    r.setProperty('--text', theme.text);
    r.setProperty('--gray', theme.gray);
    r.setProperty('--border', theme.border || 'rgba(255,255,255,0.08)');
    r.setProperty('--hover', theme.hover || 'rgba(255,255,255,0.05)');
    r.setProperty('--selection', theme.selection || (theme.primary + '33'));
    r.setProperty('--btn-bg', theme.btnBg || theme.surface);
    r.setProperty('--btn-text', theme.btnText || theme.text);
    document.body.style.background = theme.bg;
    document.body.style.color = theme.text;
  } catch(e) { console.error('[THEME]', e); }
})();
