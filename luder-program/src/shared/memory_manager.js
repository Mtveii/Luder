'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { MEMORY } = require('../../ai_config');

const AUTO_START = '<!-- AUTO-TOPICS:START -->';
const AUTO_END = '<!-- AUTO-TOPICS:END -->';

function profileDir(deviceId) {
  const dir = path.join(app.getPath('userData'), MEMORY.profileDirName, deviceId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function profilePath(deviceId) { return path.join(profileDir(deviceId), 'profile.md'); }
function archivePath(deviceId) { return path.join(profileDir(deviceId), MEMORY.archiveFileName); }

function emptyProfile() {
  return `# Profile\n\n${AUTO_START}\n${AUTO_END}\n`;
}

function readRaw(deviceId) {
  const p = profilePath(deviceId);
  if (!fs.existsSync(p)) fs.writeFileSync(p, emptyProfile(), 'utf8');
  return fs.readFileSync(p, 'utf8');
}

function extractTopics(raw) {
  const start = raw.indexOf(AUTO_START), end = raw.indexOf(AUTO_END);
  if (start === -1 || end === -1) return [];
  const block = raw.slice(start + AUTO_START.length, end).trim();
  if (!block) return [];
  return block.split('\n').filter(Boolean).map(line => {
    const m = line.match(/^- (\S+ \S+) — (.+)$/);
    return m ? { ts: m[1], text: m[2] } : null;
  }).filter(Boolean);
}

function sanitizeTopic(text) {
  return text
    .replace(/[`*_#<>|[\]]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, MEMORY.maxTopicLen);
}

function isDuplicate(topics, newText) {
  const norm = newText.toLowerCase();
  const cutoff = Date.now() - MEMORY.dedupWindowHours * 3600 * 1000;
  return topics.some(t => {
    const ts = new Date(t.ts.replace(' ', 'T')).getTime();
    return ts >= cutoff && t.text.toLowerCase() === norm;
  });
}

function writeProfile(deviceId, raw, topics) {
  const start = raw.indexOf(AUTO_START), end = raw.indexOf(AUTO_END);
  const head = start !== -1 ? raw.slice(0, start) : (raw + '\n\n');
  const tail = end !== -1 ? raw.slice(end + AUTO_END.length) : '';
  const lines = topics.map(t => `- ${t.ts} — ${t.text}`).join('\n');
  fs.writeFileSync(profilePath(deviceId), `${head}${AUTO_START}\n${lines}\n${AUTO_END}${tail}`, 'utf8');
}

function archiveOverflow(deviceId, overflow) {
  if (!overflow.length) return;
  const lines = overflow.map(t => `- ${t.ts} — ${t.text}`).join('\n') + '\n';
  fs.appendFileSync(archivePath(deviceId), lines, 'utf8');
}

function extractTopicTag(fullText) {
  const m = fullText.match(/\n?\[\[TOPIC:\s*(.+?)\s*\]\]\s*$/i);
  if (!m) return { text: fullText, topic: null };
  return { text: fullText.slice(0, m.index).trimEnd(), topic: m[1].trim() };
}

function recordTopic(deviceId, rawTopic) {
  const text = sanitizeTopic(rawTopic);
  if (!text) return;

  const raw = readRaw(deviceId);
  const topics = extractTopics(raw);
  if (isDuplicate(topics, text)) return;

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  topics.push({ ts, text });

  let overflow = [];
  if (topics.length > MEMORY.maxTopics) {
    overflow = topics.splice(0, topics.length - MEMORY.maxTopics);
  }

  writeProfile(deviceId, raw, topics);
  archiveOverflow(deviceId, overflow);
}

function getTopicsForPrompt(deviceId, limit = 5) {
  const topics = extractTopics(readRaw(deviceId)).slice(-limit);
  if (!topics.length) return '';
  return 'Recent user topics:\n' + topics.map(t => `- ${t.text}`).join('\n');
}

function readProfile(deviceId) {
  return readRaw(deviceId);
}

function writeProfileRaw(deviceId, content) {
  fs.writeFileSync(profilePath(deviceId), content, 'utf8');
}

module.exports = {
  extractTopicTag,
  recordTopic,
  getTopicsForPrompt,
  profilePath,
  readProfile,
  writeProfileRaw,
};
