// history.js — полный список тредов, поиск, избранное, переоткрытие (ludr.dev "Chat history")
const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
let allThreads = [];

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function render(threads) {
  listEl.innerHTML = '';
  threads.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'row';
    const date = new Date(t.createdAt).toLocaleString();
    row.innerHTML = `
      <div class="row-main">
        <span class="fav">${t.favorite ? '★' : '☆'}</span>
        <span class="title">${escapeHtml(t.title)}</span>
      </div>
      <span class="date">${date}</span>`;
    row.querySelector('.title').addEventListener('click', () => window.electronAPI.reopenThread(t.id));
    row.querySelector('.fav').addEventListener('click', async (e) => {
      const updated = await window.electronAPI.toggleFavorite(t.id);
      e.target.textContent = updated?.favorite ? '★' : '☆';
    });
    listEl.appendChild(row);
  });
}

searchEl.addEventListener('input', () => {
  const q = searchEl.value.toLowerCase();
  render(allThreads.filter((t) => t.title.toLowerCase().includes(q)));
});

async function load() {
  allThreads = await window.electronAPI.getThreads();
  render(allThreads);
}
load();
