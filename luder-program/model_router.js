'use strict';

const providers = require('./src/shared/providers');
const { MODELS } = require('./ai_config');
const { RouterError, AppError } = require('./errors');
const { resolveModel, validateModel, isInternalAlias } = require('./modelValidator');

function visionModels() {
  return MODELS.filter(m => m.vision).sort((a, b) => a.priority - b.priority);
}

function modelsWithKeys(config) {
  const keys = config.apiKeys || {};
  return visionModels().filter(m => keys[m.id]);
}
function getTop3(config)          { return modelsWithKeys(config).slice(0, 3); }
function getFallbackChain(config) { return modelsWithKeys(config).slice(3); }

function withTimeout(promise, ms, tag) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${tag}`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

async function firstChunkWinner(gens, models) {
  const attempts = gens.map((gen, idx) =>
    withTimeout(gen.next(), models[idx].timeoutMs, models[idx].id)
      .then(res => ({ idx, gen, ok: true, res }))
      .catch(err => ({ idx, gen, ok: false, err }))
  );

  const remaining = new Map(attempts.map((p, i) => [i, p]));
  while (remaining.size) {
    const result = await Promise.race(remaining.values());
    remaining.delete(result.idx);
    if (result.ok) {
      const losers = gens.filter((_, i) => i !== result.idx);
      return { winnerIdx: result.idx, winnerGen: result.gen, firstResult: result.res, losers };
    }
  }
  return null;
}

function cleanupLosers(losers) {
  for (const gen of losers) {
    gen.return().catch(() => {});
  }
}

async function* runSequentialFallback(chain, imageBase64, promptText, config, onStat, signal) {
  let lastErr;
  for (const model of chain) {
    try {
      validateModel(config.model, model.id);
    } catch (err) {
      lastErr = err;
      onStat?.(model.id, 'fallback_fail', err);
      continue;
    }
    try {
      const gen = providers.ask(imageBase64, promptText, { ...config, provider: model.id, signal });
      const first = await withTimeout(gen.next(), model.timeoutMs, model.id);
      onStat?.(model.id, 'fallback_win');
      if (!first.done) yield first.value;
      yield* gen;
      return;
    } catch (err) {
      lastErr = err;
      onStat?.(model.id, 'fallback_fail', err);
    }
  }
  throw new RouterError('ALL_MODELS_FAILED', lastErr || new AppError('All providers in fallback chain failed', { code: 'ALL_MODELS_FAILED' }));
}

async function* modelRouterAsk(imageBase64, promptText, config, onStat = () => {}) {
  const { mode, model, provider } = resolveModel(config);

  if (mode === 'manual') {
    yield* providers.ask(imageBase64, promptText, {
      ...config, model, provider: provider || 'luder',
    });
    return;
  }

  const raceConfig = { ...config, model: undefined };
  const top3 = getTop3(raceConfig);
  if (top3.length === 0) {
    throw new RouterError('ALL_MODELS_FAILED', new AppError('No API keys configured for any vision model', { code: 'NO_KEYS' }));
  }

  const controllers = top3.map(() => {
    const ctrl = new AbortController();
    raceConfig.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    return ctrl;
  });

  const gens = top3.map((m, i) =>
    providers.ask(imageBase64, promptText, { ...raceConfig, provider: m.id, signal: controllers[i].signal })
  );

  const result = await firstChunkWinner(gens, top3);

  if (result) {
    for (const [i, gen] of gens.entries()) {
      if (i !== result.winnerIdx) controllers[i].abort();
    }
    cleanupLosers(result.losers);
    onStat(top3[result.winnerIdx].id, 'race_win');
    if (!result.firstResult.done) yield result.firstResult.value;
    yield* result.winnerGen;
    return;
  }

  controllers.forEach(c => c.abort());
  onStat(null, 'race_all_failed');

  const fallback = getFallbackChain(raceConfig);
  if (fallback.length === 0) {
    throw new RouterError('ALL_MODELS_FAILED', new AppError('Race all failed and no fallback models with keys configured', { code: 'NO_FALLBACK' }));
  }

  yield* runSequentialFallback(fallback, imageBase64, promptText, raceConfig, onStat, raceConfig.signal);
}

module.exports = { modelRouterAsk, getTop3, getFallbackChain, RouterError };
