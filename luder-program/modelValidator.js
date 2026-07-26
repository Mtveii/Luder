'use strict';

const { MODELS_BY_PROVIDER, MODELS } = require('./ai_config');
const { InvalidModelError, AppError } = require('./errors');

const INTERNAL_ALIASES = new Set(['luder-auto']);

const MODEL_WHITELIST = {};
for (const [provider, models] of Object.entries(MODELS_BY_PROVIDER)) {
  MODEL_WHITELIST[provider] = new Set(models.map(m => m.id));
}

function isInternalAlias(model) {
  return INTERNAL_ALIASES.has(model);
}

function validateModel(model, providerKey) {
  if (!model) return;
  if (isInternalAlias(model)) {
    throw new InvalidModelError(model, providerKey,
      `Internal alias "${model}" cannot be sent to an API provider`
    );
  }
  const whitelist = MODEL_WHITELIST[providerKey];
  if (whitelist && !whitelist.has(model)) {
    throw new InvalidModelError(model, providerKey,
      `Model "${model}" is not in the whitelist for provider "${providerKey}"`
    );
  }
}

function resolveModel(config) {
  const model = config.model || 'luder-auto';
  if (isInternalAlias(model)) {
    return { mode: 'auto', model: null, provider: null };
  }
  return { mode: 'manual', model, provider: 'luder' };
}

function validateConfig(config) {
  const { model, apiKeys } = config;
  if (!apiKeys || Object.keys(apiKeys).length === 0) {
    throw new AppError('No API keys configured. Add at least one key in Settings.', { code: 'NO_KEYS' });
  }
  if (model && !isInternalAlias(model) && model !== 'luder-auto') {
    const providerKey = model.includes('/') ? 'openrouter'
      : model.startsWith('gpt')      ? 'openai'
      : model.startsWith('claude')   ? 'anthropic'
      : model.startsWith('gemini')   ? 'gemini'
      : model.includes('groq')       ? 'groq'
      : model.startsWith('mistral')  ? 'mistral'
      : model.startsWith('deepseek') ? 'deepseek'
      : null;
    if (providerKey) {
      validateModel(model, providerKey);
    }
  }
  return true;
}

function isModelKnown(model, providerKey) {
  if (!model || isInternalAlias(model)) return true;
  const whitelist = MODEL_WHITELIST[providerKey];
  return whitelist ? whitelist.has(model) : true;
}

module.exports = { isInternalAlias, validateModel, resolveModel, validateConfig, isModelKnown, MODEL_WHITELIST };
