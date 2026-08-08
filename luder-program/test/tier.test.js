const assert = require('assert');
const { computeTier, TIER_LIMITS } = require('../src/shared/storage');

assert.strictEqual(computeTier('LovePolinka@love'), 'max', 'точное имя → max');
assert.strictEqual(computeTier('admin123@luder'), 'max', 'второе имя → max');
assert.strictEqual(computeTier('lovepolinka@love'), 'max', 'регистр не важен');
assert.strictEqual(computeTier('  LovePolinka@love  '), 'max', 'пробелы обрезаются');
assert.strictEqual(computeTier('admin123@luderX'), 'free', 'похожее имя → free');
assert.strictEqual(computeTier('lovepolinka@lover'), 'free', 'суффикс не проходит');
assert.strictEqual(computeTier(''), 'free', 'пусто → free');
assert.strictEqual(computeTier(null), 'free', 'null → free');
assert.strictEqual(computeTier('обычный юзер'), 'free', 'обычный → free');

assert.strictEqual(TIER_LIMITS.free, 20, 'free = 20 запросов/день');
assert.strictEqual(TIER_LIMITS.max, Infinity, 'max = безлимит');

console.log('PASS: computeTier — 10/10');
