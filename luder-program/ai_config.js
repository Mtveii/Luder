'use strict';

const MODELS = [
  { id: 'gemini',     priority: 1,  timeoutMs: 12000, vision: true },
  { id: 'openai',     priority: 2,  timeoutMs: 15000, vision: true },
  { id: 'anthropic',  priority: 3,  timeoutMs: 15000, vision: true },
  { id: 'openrouter', priority: 4,  timeoutMs: 15000, vision: true },
  { id: 'groq',       priority: 5,  timeoutMs: 8000,  vision: true },
  { id: 'together',   priority: 6,  timeoutMs: 15000, vision: true },
  { id: 'fireworks',  priority: 7,  timeoutMs: 12000, vision: true },
  { id: 'mistral',    priority: 8,  timeoutMs: 12000, vision: true },
  { id: 'sambanova',  priority: 9,  timeoutMs: 10000, vision: true },
];

const MODELS_BY_PROVIDER = {
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
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    { id: 'meta-llama/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    { id: 'google/gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite' },
    { id: 'mistralai/mistral-small-2506', name: 'Mistral Small 3.2' },
  ],
  groq: [
    { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick' },
    { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
  ],
  mistral: [
    { id: 'mistral-small-2506', name: 'Mistral Small 3.2' },
    { id: 'mistral-medium-2508', name: 'Mistral Medium 3.1' },
    { id: 'mistral-large-2512', name: 'Mistral Large 3' },
  ],
  together: [
    { id: 'meta-llama/Llama-Vision-Free', name: 'Llama Vision Free' },
    { id: 'Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen 2.5 VL 72B' },
    { id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', name: 'Llama 3.2 90B Vision' },
  ],
  fireworks: [
    { id: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct', name: 'Llama 3.2 90B Vision' },
    { id: 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct', name: 'Llama 3.2 11B Vision' },
  ],
  sambanova: [
    { id: 'Meta-Llama-3.2-90B-Vision-Instruct', name: 'Llama 3.2 90B Vision' },
    { id: 'Llama-4-Maverick-17B-128E-Instruct', name: 'Llama 4 Maverick' },
  ],
  luder: [
    { id: 'openai/gpt-4o', name: 'GPT-4o (Recommended)' },
    { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    { id: 'meta-llama/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick' },
    { id: 'luder-auto', name: 'Auto (fallback)' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    { id: 'google/gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite' },
    { id: 'mistralai/mistral-small-2506', name: 'Mistral Small 3.2' },
  ],
};

const KEY_HINTS = {
  gemini: '_starts with AIza_',
  openai: '_starts with sk-_',
  anthropic: '_starts with sk-ant-_',
  openrouter: '_starts with sk-or-_',
  groq: '_starts with gsk_',
  mistral: '_random string from console.mistral.ai_',
  together: '_from api.together.xyz/settings_',
  fireworks: '_starts with fw_ (fireworks.ai)',
  sambanova: '_from cloud.sambanova.ai_',
};

const SYSTEM_PROMPT = `Ты — Luder, ИИ-ассистент для анализа скриншотов экрана.

Правила:
- Не придумывай факты. Если не уверен — явно скажи об этом.
- Отвечай кратко и по существу, без вводных фраз.
- Используй markdown: код — в блоках с подсветкой языка.
- Не изменяй пользовательские данные без явного запроса.
- Если запрос неясен — переспроси коротко, не додумывай за пользователя.

Память:
- Ниже может быть указан контекст пользователя (недавние темы/проекты).
- Используй его, только если он релевантен текущему запросу.
- Не упоминай сам факт наличия памяти, если пользователь не спрашивает об этом явно.
- Если контекст противоречит текущему скриншоту/вопросу — доверяй текущему запросу, а не памяти.

В конце каждого ответа добавь строку в формате:
[[TOPIC: краткая тема запроса, до 8 слов]]
Эта строка служебная и будет скрыта от пользователя — не упоминай её в основном тексте ответа.`;

function getModels(provider) {
  return MODELS_BY_PROVIDER[provider] || [];
}

module.exports = {
  MODELS,
  MODELS_BY_PROVIDER,
  KEY_HINTS,
  getModels,
  SYSTEM_PROMPT,
  ROUTER: {
    raceSize: 3,
  },
  MEMORY: {
    profileDirName: 'profiles',
    archiveFileName: 'profile.archive.md',
    maxTopics: 20,
    maxTopicLen: 80,
    dedupWindowHours: 24,
  },
  CONTEXT: {
    maxHistoryMessages: 12,
    maxTopicsInPrompt: 3,
    topicFreshnessHours: 48,
  },
};