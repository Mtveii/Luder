'use strict';

const { CONTEXT } = require('../../ai_config');
const { getTopicsForPrompt } = require('./memory_manager');

function trimHistory(threadHistory) {
  if (!Array.isArray(threadHistory)) return [];
  if (threadHistory.length <= CONTEXT.maxHistoryMessages) return threadHistory;
  return threadHistory.slice(threadHistory.length - CONTEXT.maxHistoryMessages);
}

function buildContext(config) {
  const threadHistory = trimHistory(config.threadHistory);
  const profileContext = config.deviceId
    ? getTopicsForPrompt(config.deviceId, CONTEXT.maxTopicsInPrompt)
    : '';

  return { threadHistory, profileContext };
}

module.exports = { buildContext, trimHistory };
