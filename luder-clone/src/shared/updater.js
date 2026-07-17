// updater.js — проверка новой версии через сервер /update, GitHub как fallback
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Updater = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SERVER_URL = 'http://100.102.160.84:3000';
  const GITHUB_URL = 'https://api.github.com/repos/your-org/ludr-clone/releases/latest';

  function parseVersion(v) {
    return String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  }

  function isNewer(remote, current) {
    const r = parseVersion(remote), c = parseVersion(current);
    for (let i = 0; i < Math.max(r.length, c.length); i += 1) {
      const rv = r[i] || 0, cv = c[i] || 0;
      if (rv > cv) return true;
      if (rv < cv) return false;
    }
    return false;
  }

  async function checkForUpdates(currentVersion) {
    // Primary: сервер /update
    try {
      const res = await fetch(`${SERVER_URL}/update`);
      if (res.ok) {
        const data = await res.json();
        const latestVersion = (data.version || '').toString();
        const url = data.downloadUrl || '';
        const notes = data.notes || '';
        return { hasUpdate: isNewer(latestVersion, currentVersion), latestVersion, url, notes, source: 'server' };
      }
    } catch (_) { /* fallback to GitHub */ }

    // Fallback: GitHub releases
    try {
      const res = await fetch(GITHUB_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub ошибка: ${res.status}`);
      const data = await res.json();
      const latestVersion = (data.tag_name || data.version || '').toString();
      const url = data.html_url || data.url || '';
      const notes = data.body || data.notes || '';
      return { hasUpdate: isNewer(latestVersion, currentVersion), latestVersion, url, notes, source: 'github' };
    } catch (err) {
      return { hasUpdate: false, error: err.message };
    }
  }

  return { checkForUpdates, isNewer };
});
