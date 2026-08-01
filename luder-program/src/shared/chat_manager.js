'use strict';

const storage = require('./storage');

const RESUME_WINDOW_MS = 30 * 60 * 1000;

function getOrResumeThread({ title, provider, imageBase64 }) {
  const lastThread = storage.getLastThread();
  if (lastThread && Date.now() - lastThread.updatedAt < RESUME_WINDOW_MS) {
    return { threadId: lastThread.id, thread: lastThread };
  }
  const thread = storage.createThread({ title, provider, imageBase64 });
  return { threadId: thread.id, thread };
}

module.exports = { getOrResumeThread };
