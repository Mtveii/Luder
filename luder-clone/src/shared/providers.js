// providers.js — all AI requests go directly from user's PC, теперь настоящим стримом

function cleanImageBase64(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== 'string') throw new Error('No image data received');
  let clean = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/i, '');
  clean = clean.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(clean)) throw new Error('Invalid base64 image data');
  if (clean.length < 100) throw new Error('Image data too short — capture may have failed');
  return clean;
}

function cleanResponse(text) {
  if (!text) return text;
  return text.replace(/User Safety:.*\n?/gi, '').replace(/Safety Categories:.*\n?/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

const SYSTEM_PROMPT = '1-2 sentences. Code→logic. Error→fix. UI→elements. No fluff.';

const SAFETY_DISABLED = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

const MODELS = {
  luder: [
    { id: 'luder-auto', name: 'Auto (recommended)' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B (Groq)' },
    { id: 'llama-3.2-11b-vision-instruct:free', name: 'Llama 3.2 11B (free)' },
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'deepseek-chat', name: 'DeepSeek V3' },
  ],
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
    { id: 'qwen/qwen2.5-vl-72b-instruct', name: 'Qwen 2.5 VL 72B' },
    { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B' },
    { id: 'meta-llama/llama-3.2-11b-vision-instruct:free', name: 'Llama 3.2 Vision 11B' },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 24B' },
  ],
  groq: [
    { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  ],
  mistral: [
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium' },
    { id: 'mistral-large-latest', name: 'Mistral Large' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1' },
  ],
  together: [
    { id: 'meta-llama/Llama-Vision-Free', name: 'Llama Vision Free' },
    { id: 'Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen 2.5 VL 72B' },
    { id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', name: 'Llama 3.2 90B Vision' },
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
  ],
  fireworks: [
    { id: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct', name: 'Llama 3.2 90B Vision' },
    { id: 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct', name: 'Llama 3.2 11B Vision' },
  ],
  cerebras: [
    { id: 'llama-3.2-vision-90b', name: 'Llama 3.2 Vision 90B' },
    { id: 'llama-3.2-vision-11b', name: 'Llama 3.2 Vision 11B' },
  ],
  sambanova: [
    { id: 'Meta-Llama-3.2-90B-Vision-Instruct', name: 'Llama 3.2 90B Vision' },
    { id: 'DeepSeek-V3-0324', name: 'DeepSeek V3' },
  ],
};

const KEY_HINTS = {
  gemini: '_starts with AIza_',
  openai: '_starts with sk-_',
  anthropic: '_starts with sk-ant-_',
  openrouter: '_starts with sk-or-_',
  groq: '_starts with gsk_',
  mistral: '_random string from console.mistral.ai_',
  deepseek: '_starts with sk-_ (platform.deepseek.com)',
  together: '_from api.together.xyz/settings_',
  fireworks: '_starts with fw_ (fireworks.ai)',
  cerebras: '_from cloud.cerebras.ai_',
  sambanova: '_from cloud.sambanova.ai_',
};

function getModels(provider) { return MODELS[provider] || []; }

// --- Общий построчный SSE-ридер ---
async function* readLines(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) yield line;
  }
  if (buffer) yield buffer;
}

// ============ Gemini (streamGenerateContent?alt=sse) ============
async function* readGeminiDeltas(stream) {
  let got = false;
  for await (const line of readLines(stream)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed.slice(6)); } catch { continue; }
    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) { got = true; yield text; }
  }
  if (!got) throw new Error('Empty response from Gemini');
}

async function* askGemini(imageBase64, promptText, config) {
  const key = config.apiKeys?.gemini;
  if (!key) throw new Error('No Gemini API key. Add your key in settings.');
  const model = config.model || 'gemini-2.0-flash';
  const image = cleanImageBase64(imageBase64);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: image } }, { text: promptText }] }],
      generationConfig: { maxOutputTokens: 256, temperature: 0.1 },
      safetySettings: SAFETY_DISABLED,
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error(`Gemini ${res.status}: ${e.slice(0, 200)}`); }
  if (!res.body) throw new Error('Gemini: empty stream');

  yield* readGeminiDeltas(res.body);
}

// ============ Anthropic (stream: true) ============
async function* readAnthropicDeltas(stream) {
  let got = false;
  for await (const line of readLines(stream)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed.slice(6)); } catch { continue; }
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) { got = true; yield parsed.delta.text; }
  }
  if (!got) throw new Error('Empty response from Anthropic');
}

async function* askAnthropic(imageBase64, promptText, config) {
  const key = config.apiKeys?.anthropic;
  if (!key) throw new Error('No Anthropic API key. Add your key in settings.');
  const model = config.model || 'claude-sonnet-4-20250514';
  const image = cleanImageBase64(imageBase64);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 256, stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
        { type: 'text', text: promptText },
      ] }],
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error(`Anthropic ${res.status}: ${e.slice(0, 200)}`); }
  if (!res.body) throw new Error('Anthropic: empty stream');

  yield* readAnthropicDeltas(res.body);
}

// ============ OpenAI-совместимый (9 провайдеров) ============
async function* readOpenAiDeltas(stream, providerName) {
  let got = false;
  for await (const line of readLines(stream)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const data = trimmed.slice(6);
    if (data === '[DONE]') return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { continue; }
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (delta) { got = true; yield delta; }
  }
  if (!got) throw new Error(`Empty response from ${providerName}`);
}

async function* askOpenAICompatible(imageBase64, promptText, config, { baseUrl, providerName, providerKey }) {
  const key = config.apiKeys?.[providerKey];
  if (!key) throw new Error(`No ${providerName} API key. Add your key in settings.`);
  const model = config.model || MODELS[providerKey]?.[0]?.id;
  const image = cleanImageBase64(imageBase64);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_tokens: 256, temperature: 0.1, stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } }] },
      ],
    }),
  });
  if (!res.ok) {
    const e = await res.text().catch(() => '');
    const msg = e.slice(0, 400);
    // OpenRouter: модель недоступна бесплатно — автоматически переключаемся на платный slug
    const slugMatch = msg.match(/use this slug instead:\s*(\S+)/i);
    if (res.status === 404 && slugMatch) {
      const paidModel = slugMatch[1];
      const retry = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: paidModel, max_tokens: 256, temperature: 0.1, stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } }] },
          ],
        }),
      });
      if (!retry.ok) { const re = await retry.text().catch(() => ''); throw new Error(`${providerName} ${retry.status}: ${re.slice(0, 200)}`); }
      if (!retry.body) throw new Error(`${providerName}: empty stream`);
      yield* readOpenAiDeltas(retry.body, providerName);
      return;
    }
    throw new Error(`${providerName} ${res.status}: ${msg}`);
  }
  if (!res.body) throw new Error(`${providerName}: empty stream`);

  yield* readOpenAiDeltas(res.body, providerName);
}

function askOpenAI(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.openai.com/v1', providerName: 'OpenAI', providerKey: 'openai' });
}
function askGroq(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.groq.com/openai/v1', providerName: 'Groq', providerKey: 'groq' });
}
function askMistral(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.mistral.ai/v1', providerName: 'Mistral', providerKey: 'mistral' });
}
function askOpenRouter(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://openrouter.ai/api/v1', providerName: 'OpenRouter', providerKey: 'openrouter' });
}
function askDeepSeek(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.deepseek.com/v1', providerName: 'DeepSeek', providerKey: 'deepseek' });
}
function askTogether(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.together.xyz/v1', providerName: 'Together AI', providerKey: 'together' });
}
function askFireworks(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.fireworks.ai/inference/v1', providerName: 'Fireworks AI', providerKey: 'fireworks' });
}
function askCerebras(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.cerebras.ai/v1', providerName: 'Cerebras', providerKey: 'cerebras' });
}
function askSambanova(imageBase64, promptText, config) {
  return askOpenAICompatible(imageBase64, promptText, config, { baseUrl: 'https://api.sambanova.ai/v1', providerName: 'Sambanova', providerKey: 'sambanova' });
}

// ============ Luder: smart router ============
// Гонка с заменой: если провайдер упал — берём случайный другой из оставшихся
async function* raceWithReplace(candidates, pool) {
  if (candidates.length === 0 && pool.length === 0) throw new Error('No providers available');
  if (candidates.length === 0) return yield* raceWithReplace([pool[0]], pool.slice(1));
  if (candidates.length === 1) return yield* candidates[0].gen();

  const available = [...pool];
  const active = candidates.map((c) => ({ name: c.name, gen: c.gen(), first: null, error: null }));

  function pickRandom() {
    if (available.length === 0) return null;
    const i = Math.floor(Math.random() * available.length);
    return available.splice(i, 1)[0];
  }

  function startRacer(c) {
    const r = { name: c.name, gen: c.gen(), first: null, error: null };
    const p = (async () => { try { r.first = await r.gen.next(); } catch (e) { r.error = e; } })();
    return { racer: r, promise: p };
  }

  const running = active.map((c) => startRacer(c));

  while (running.length > 0) {
    await Promise.any(running.map((r) => r.promise));

    // Ищем первого с токеном
    for (const r of running) {
      if (r.racer.first && !r.racer.error) {
        yield r.racer.first.value;
        while (true) {
          const { value, done } = await r.racer.gen.next();
          if (done) return;
          yield value;
        }
      }
    }

    // Убираем упавших, добавляем замены
    const failed = running.filter((r) => r.racer.error);
    for (const f of failed) {
      const replacement = pickRandom();
      if (replacement) {
        const newR = startRacer(replacement);
        running.splice(running.indexOf(f), 1, newR);
      } else {
        running.splice(running.indexOf(f), 1);
      }
    }
  }

  throw new Error('All providers failed');
}

async function* askLuder(imageBase64, promptText, config) {
  const keys = config.apiKeys || {};
  const model = config.model || 'luder-auto';
  const cfg = { ...config };
  if (model === 'luder-auto') delete cfg.model;

  const all = [
    keys.groq && { name: 'Groq', gen: () => askGroq(imageBase64, promptText, cfg) },
    keys.deepseek && { name: 'DeepSeek', gen: () => askDeepSeek(imageBase64, promptText, cfg) },
    keys.openai && { name: 'OpenAI', gen: () => askOpenAI(imageBase64, promptText, cfg) },
    keys.anthropic && { name: 'Anthropic', gen: () => askAnthropic(imageBase64, promptText, cfg) },
    keys.mistral && { name: 'Mistral', gen: () => askMistral(imageBase64, promptText, cfg) },
    keys.openrouter && { name: 'OpenRouter', gen: () => askOpenRouter(imageBase64, promptText, cfg) },
    keys.together && { name: 'Together', gen: () => askTogether(imageBase64, promptText, cfg) },
    keys.fireworks && { name: 'Fireworks', gen: () => askFireworks(imageBase64, promptText, cfg) },
    keys.cerebras && { name: 'Cerebras', gen: () => askCerebras(imageBase64, promptText, cfg) },
    keys.sambanova && { name: 'Sambanova', gen: () => askSambanova(imageBase64, promptText, cfg) },
  ].filter(Boolean);

  if (all.length === 0) throw new Error('No API key configured. Add at least one key in Settings.');

  if (model !== 'luder-auto') {
    const idx = all.findIndex((p) =>
      (model.startsWith('gpt') && p.name === 'OpenAI') ||
      (model.startsWith('claude') && p.name === 'Anthropic') ||
      (model.includes('groq') && p.name === 'Groq') ||
      (model.startsWith('mistral') && p.name === 'Mistral') ||
      (model.startsWith('deepseek') && p.name === 'DeepSeek') ||
      (model.includes('free') && p.name === 'OpenRouter')
    );
    if (idx >= 0) return yield* all[idx].gen();
    return yield* all[0].gen();
  }

  // Auto: гонка 3 быстрых с заменой из оставшихся 7
  const fast = all.slice(0, 3);
  const pool = all.slice(3);
  yield* raceWithReplace(fast, pool);
}

// --- Entry point ---
function ask(imageBase64, promptText, config) {
  switch (config.provider) {
    case 'luder':     return askLuder(imageBase64, promptText, config);
    case 'gemini':    return askGemini(imageBase64, promptText, config);
    case 'openai':    return askOpenAI(imageBase64, promptText, config);
    case 'anthropic': return askAnthropic(imageBase64, promptText, config);
    case 'openrouter':return askOpenRouter(imageBase64, promptText, config);
    case 'groq':      return askGroq(imageBase64, promptText, config);
    case 'mistral':   return askMistral(imageBase64, promptText, config);
    case 'deepseek':  return askDeepSeek(imageBase64, promptText, config);
    case 'together':  return askTogether(imageBase64, promptText, config);
    case 'fireworks': return askFireworks(imageBase64, promptText, config);
    case 'cerebras':  return askCerebras(imageBase64, promptText, config);
    case 'sambanova': return askSambanova(imageBase64, promptText, config);
    default: throw new Error('Select a provider in settings');
  }
}

module.exports = { ask, getModels, MODELS, KEY_HINTS, cleanResponse };
