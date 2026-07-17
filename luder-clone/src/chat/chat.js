// chat.js — стрим ответа, тред, pin/copy/favorite/regenerate, довложения
let currentThreadId = null;
let currentImageBase64 = null;
let lastUserPrompt = '';
const thread = [];
let assistantDiv = null;
let pinned = true;
let isLoading = false;

const messagesEl = document.getElementById('messages');
const titleEl = document.getElementById('title');
const modelBadgeEl = document.getElementById('model-badge');
const promptEl = document.getElementById('prompt');

window.electronAPI.getSettings().then((s) => {
  const name = s.provider === 'luder' ? 'LUDR' : (s.provider || 'gemini').toUpperCase();
  modelBadgeEl.textContent = name;
});

function renderMessage(role, text, imageBase64 = null) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if (imageBase64) {
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${imageBase64}`;
    wrap.appendChild(img);
  }
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = role === 'assistant' ? renderMarkdown(text) : text;
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return body;
}

function startAsk(promptText, imageBase64) {
  if (isLoading) return;
  isLoading = true;
  lastUserPrompt = promptText;
  renderMessage('user', promptText, imageBase64 && thread.length === 0 ? imageBase64 : null);
  thread.push({ role: 'user', text: promptText });
  assistantDiv = renderMessage('assistant', '');
  window.electronAPI.askQuestion({ imageBase64: currentImageBase64, prompt: promptText, threadHistory: thread, threadId: currentThreadId });
}

window.electronAPI.onRegionCaptured(({ imageBase64, prompt, threadId, attach }) => {
  currentImageBase64 = imageBase64;
  currentThreadId = threadId;
  titleEl.textContent = (prompt || 'Analyze this image').slice(0, 60);
  if (attach) { renderMessage('user', prompt || '', imageBase64); return; }
  startAsk(prompt || 'Analyze this image.', imageBase64);
});

window.electronAPI.onThreadLoaded((loadedThread) => {
  currentThreadId = loadedThread.id;
  titleEl.textContent = loadedThread.title.slice(0, 60);
  for (const m of loadedThread.messages) {
    renderMessage(m.role, m.text, m.imageBase64);
    thread.push({ role: m.role, text: m.text });
    if (m.imageBase64) currentImageBase64 = m.imageBase64;
  }
});

document.getElementById('send-btn').addEventListener('click', () => {
  const text = promptEl.value.trim();
  if (!text && !currentImageBase64) return;
  promptEl.value = '';
  startAsk(text || 'Analyze this image.', null);
});
promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('send-btn').click(); } });

window.electronAPI.onStreamChunk((chunk) => {
  if (!assistantDiv) return;
  assistantDiv.dataset.raw = (assistantDiv.dataset.raw || '') + chunk;
  assistantDiv.innerHTML = renderMarkdown(assistantDiv.dataset.raw);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

window.electronAPI.onStreamEnd(() => {
  if (assistantDiv) thread.push({ role: 'assistant', text: assistantDiv.dataset.raw || '' });
  assistantDiv = null;
  isLoading = false;
});

window.electronAPI.onStreamError((message) => {
  renderMessage('error', message);
  assistantDiv = null;
  isLoading = false;
});

document.getElementById('copy-btn').addEventListener('click', () => {
  const last = [...messagesEl.querySelectorAll('.msg.assistant .msg-body')].pop();
  if (last) navigator.clipboard.writeText(last.dataset.raw || last.textContent);
});

document.getElementById('favorite-btn').addEventListener('click', async (e) => {
  if (!currentThreadId) return;
  const updated = await window.electronAPI.toggleFavorite(currentThreadId);
  e.target.textContent = updated?.favorite ? '★' : '☆';
});

document.getElementById('regenerate-btn').addEventListener('click', () => { if (lastUserPrompt && !isLoading) startAsk(lastUserPrompt, null); });

document.getElementById('pin-btn').addEventListener('click', (e) => {
  pinned = !pinned;
  window.electronAPI.togglePinChat(pinned);
  e.target.style.opacity = pinned ? '1' : '0.4';
});

document.getElementById('close-btn').addEventListener('click', () => window.electronAPI.closeChat());

document.getElementById('camera-btn').addEventListener('click', () => window.electronAPI.captureAndAttach(currentThreadId));

document.getElementById('attach-btn').addEventListener('click', async () => {
  const imageBase64 = await window.electronAPI.attachFile();
  if (imageBase64) { currentImageBase64 = imageBase64; renderMessage('user', '(прикреплён файл)', imageBase64); }
});
