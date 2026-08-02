// providers.js — all AI requests go directly from user's PC, теперь настоящим стримом

const { MODELS_BY_PROVIDER: MODELS, KEY_HINTS, getModels, SYSTEM_PROMPT } = require('../../ai_config');
const { validateModel } = require('../../modelValidator');
const { ProviderError, RateLimitError, InvalidModelError } = require('../../errors');

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
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function imageMimeType(imageBase64) {
  const bytes = Buffer.from(imageBase64.slice(0, 16), 'base64');
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
}

// --- Ретрай на временные сбои (429/5xx/сеть): backoff 1s, 2s ---
async function fetchWithRetry(url, options, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (attempt < retries && (res.status === 429 || res.status >= 500)) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function historyMessages(history, format = 'openai') {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => {
      if (format === 'gemini') return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] };
      return { role: m.role, content: m.text };
    });
}



// --- Общий построчный SSE-ридер ---
async function* readLines(stream, signal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) yield line;
    }
    if (buffer) yield buffer;
  } finally {
    try { reader.cancel(); } catch {}
  }
}

// ============ Gemini (streamGenerateContent?alt=sse) ============
async function* readGeminiDeltas(stream, signal) {
  let got = false;
  for await (const line of readLines(stream, signal)) {
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
  validateModel(model, 'gemini');
  const image = cleanImageBase64(imageBase64);
  const mimeType = imageMimeType(image);

  console.log('[GEMINI] Model:', model, 'Key length:', key.length);

  const extendedPrompt = SYSTEM_PROMPT + (config.profileContext || '');
  const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: config.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: extendedPrompt }] },
      contents: [...historyMessages(config.threadHistory, 'gemini'), { role: 'user', parts: [{ inlineData: { mimeType, data: image } }, { text: promptText }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.0 },
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); const msg = `Gemini ${res.status}: ${e.slice(0, 200)}`; if (res.status === 429) throw new RateLimitError('Gemini'); throw new ProviderError('Gemini', res.status, e.slice(0, 200), msg); }
  if (!res.body) throw new ProviderError('Gemini', 0, '', 'Gemini: empty stream');

  yield* readGeminiDeltas(res.body, config.signal);
}

// ============ Anthropic (stream: true) ============
async function* readAnthropicDeltas(stream, signal) {
  let got = false;
  for await (const line of readLines(stream, signal)) {
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
  validateModel(model, 'anthropic');
  const image = cleanImageBase64(imageBase64);
  const mimeType = imageMimeType(image);

  const extendedPrompt = SYSTEM_PROMPT + (config.profileContext || '');
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    signal: config.signal,
    body: JSON.stringify({
      model, max_tokens: 1024, stream: true,
      system: extendedPrompt,
      messages: [...historyMessages(config.threadHistory), { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
        { type: 'text', text: promptText },
      ] }],
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); const msg = `Anthropic ${res.status}: ${e.slice(0, 200)}`; if (res.status === 429) throw new RateLimitError('Anthropic'); throw new ProviderError('Anthropic', res.status, e.slice(0, 200), msg); }
  if (!res.body) throw new ProviderError('Anthropic', 0, '', 'Anthropic: empty stream');

  yield* readAnthropicDeltas(res.body, config.signal);
}

// ============ OpenAI-совместимый (9 провайдеров) ============
async function* readOpenAiDeltas(stream, providerName, signal) {
  let got = false;
  for await (const line of readLines(stream, signal)) {
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
  validateModel(model, providerKey);
  const image = cleanImageBase64(imageBase64);
  const mimeType = imageMimeType(image);
  const extendedPrompt = SYSTEM_PROMPT + (config.profileContext || '');

  console.log(`[${providerName.toUpperCase()}] Model:`, model, 'Key length:', key.length);

  const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: config.signal,
    body: JSON.stringify({
      model, max_tokens: 1024, temperature: 0.0, stream: true,
      messages: [
        { role: 'system', content: extendedPrompt },
        ...historyMessages(config.threadHistory),
        { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } }] },
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
      const retry = await fetchWithRetry(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: config.signal,
        body: JSON.stringify({
          model: paidModel, max_tokens: 1024, temperature: 0.0, stream: true,
          messages: [
            { role: 'system', content: extendedPrompt },
            ...historyMessages(config.threadHistory),
            { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } }] },
          ],
        }),
      });
      if (!retry.ok) { const re = await retry.text().catch(() => ''); throw new ProviderError(providerName, retry.status, re.slice(0, 200)); }
      if (!retry.body) throw new ProviderError(providerName, 0, '', `${providerName}: empty stream`);
      yield* readOpenAiDeltas(retry.body, providerName, config.signal);
      return;
    }
    if (res.status === 429) throw new RateLimitError(providerName);
    throw new ProviderError(providerName, res.status, msg);
  }
  if (!res.body) throw new ProviderError(providerName, 0, '', `${providerName}: empty stream`);

  yield* readOpenAiDeltas(res.body, providerName, config.signal);
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
  const model = config.model || 'openai/gpt-4o';
  const cfg = { ...config };
  if (model === 'luder-auto') delete cfg.model;

  console.log('[LUDER] Provider: luder, Model:', model, 'Available keys:', Object.keys(keys));

  const all = [
    keys.gemini && { name: 'Gemini', gen: () => askGemini(imageBase64, promptText, cfg) },
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

  console.log('[LUDER] Active providers:', all.map((p) => p.name));

  if (all.length === 0) throw new Error('No API key configured. Add at least one key in Settings.');

  if (model !== 'luder-auto') {
    // If model has provider prefix (e.g., "openai/gpt-4o"), use OpenRouter
    if (model.includes('/')) {
      const orIdx = all.findIndex((p) => p.name === 'OpenRouter');
      if (orIdx >= 0) return yield* all[orIdx].gen();
    }
    const idx = all.findIndex((p) =>
      (model.startsWith('gpt') && p.name === 'OpenAI') ||
      (model.startsWith('claude') && p.name === 'Anthropic') ||
      (model.startsWith('gemini') && p.name === 'Gemini') ||
      (model.includes('groq') && p.name === 'Groq') ||
      (model.startsWith('mistral') && p.name === 'Mistral') ||
      (model.startsWith('deepseek') && p.name === 'DeepSeek') ||
      (model.includes('free') && p.name === 'OpenRouter')
    );
    if (idx >= 0) return yield* all[idx].gen();
    return yield* all[0].gen();
  }

  // Auto: гонка 3 быстрых с заменой из оставшихся 7
  const errors = [];
  for (const candidate of all) {
    try {
      yield* candidate.gen();
      return;
    } catch (err) {
      errors.push(`${candidate.name}: ${err.message}`);
    }
  }
  throw new Error(`All providers failed. ${errors.join(' | ')}`);
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
    case 'together':  return askTogether(imageBase64, promptText, config);
    case 'fireworks': return askFireworks(imageBase64, promptText, config);
    case 'sambanova': return askSambanova(imageBase64, promptText, config);
    case 'deepseek':  return askDeepSeek(imageBase64, promptText, config);
    case 'cerebras':  return askCerebras(imageBase64, promptText, config);
    default: throw new Error('Select a provider in settings');
  }
}

module.exports = { ask, getModels, MODELS, KEY_HINTS, cleanResponse };
