const test = require('node:test');
const assert = require('node:assert');
const { tdToBars, throttleDelay, isMarketOpen, lastSession, barsFresh } = require('./live-bars.js');

// shape copied from a real Twelve Data response (newest first, string numbers)
const real = { meta: { symbol: 'AAPL', interval: '1day' }, status: 'ok', values: [
  { datetime: '2026-10-07', open: '337.015015', high: '338.67001', low: '332.79001', close: '336.67001', volume: '33380854' },
  { datetime: '2026-10-06', open: '332.28000', high: '334.38000', low: '330.62000', close: '333.63000', volume: '30449000' },
  { datetime: '2026-10-05', open: '332.82001', high: '336.20999', low: '331.64999', close: '332.89001', volume: '34400900' } ] };

test('tdToBars: reverses to oldest-first, parses strings, rounds to cents', () => {
  const b = tdToBars(real);
  assert.deepStrictEqual(b.t, ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.deepStrictEqual(b.c, [332.89, 333.63, 336.67]);
  assert.deepStrictEqual(b.v, [34400900, 30449000, 33380854]);
});

test('tdToBars: drops bad rows, dedupes a day, null when too short', () => {
  const b = tdToBars({ status: 'ok', values: [...real.values, { datetime: '2026-10-07', open: '1', high: '2', low: '0.5', close: '1.5', volume: '5' }, { datetime: 'x', open: 'n/a' }] });
  assert.strictEqual(b.t.length, 3);
  assert.strictEqual(b.c[2], 1.5);                      // later duplicate wins
  assert.strictEqual(tdToBars({ status: 'ok', values: [real.values[0]] }), null);
});

test('tdToBars: API errors throw with a readable message and the code', () => {
  assert.throws(() => tdToBars({ code: 401, status: 'error', message: '**apikey** parameter is incorrect or not specified. You can get your free API key instantly' }),
    e => e.code === 401 && /apikey parameter is incorrect/.test(e.message) && !/\*\*/.test(e.message));
  assert.throws(() => tdToBars({ code: 429, status: 'error', message: 'You have run out of API credits for the current minute.' }), e => e.code === 429);
  assert.throws(() => tdToBars(null), /no data/);
});

test('throttleDelay: 8 per rolling minute', () => {
  const now = 1_000_000;
  assert.strictEqual(throttleDelay([], now), 0);
  assert.strictEqual(throttleDelay(Array.from({ length: 7 }, (_, i) => now - 1000 * i), now), 0);
  const eight = Array.from({ length: 8 }, (_, i) => now - 50000 + i * 1000);      // oldest 50s ago
  assert.strictEqual(throttleDelay(eight, now), 10000 + 250);
  assert.strictEqual(throttleDelay([now - 61000, ...eight.slice(1)], now), 0);     // old stamp expired
});

// Oct 7 2026 is a Wednesday; New York is on EDT (UTC-4)
const et = (h, m, d = 7) => Date.UTC(2026, 9, d, h + 4, m);
test('market hours and last finished session (ET)', () => {
  assert.strictEqual(isMarketOpen(et(10, 0)), true);
  assert.strictEqual(isMarketOpen(et(9, 29)), false);
  assert.strictEqual(isMarketOpen(et(16, 0)), false);
  assert.strictEqual(isMarketOpen(et(11, 0, 10)), false);                 // Saturday
  assert.strictEqual(lastSession(et(10, 0)), '2026-10-06');               // mid-session -> yesterday
  assert.strictEqual(lastSession(et(16, 5)), '2026-10-06');               // data not settled yet
  assert.strictEqual(lastSession(et(16, 30)), '2026-10-07');
  assert.strictEqual(lastSession(et(12, 0, 10)), '2026-10-09');           // Saturday -> Friday
  assert.strictEqual(lastSession(et(12, 0, 12)), '2026-10-09');           // Monday midday -> Friday
});

test('barsFresh: open market refetches after 15 min; after close needs a non-partial last session', () => {
  assert.strictEqual(barsFresh('2026-10-07', { at: et(10, 0), partial: true }, et(10, 10)), true);
  assert.strictEqual(barsFresh('2026-10-07', { at: et(10, 0), partial: true }, et(10, 20)), false);
  assert.strictEqual(barsFresh('2026-10-07', { at: et(10, 0), partial: true }, et(17, 0)), false);     // partial bar must be replaced
  assert.strictEqual(barsFresh('2026-10-07', { at: et(16, 40), partial: false }, et(20, 0)), true);
  assert.strictEqual(barsFresh('2026-10-06', { at: et(16, 40, 6), partial: false }, et(20, 0)), false); // missing today's session
  assert.strictEqual(barsFresh('2026-10-09', { at: et(16, 40, 9), partial: false }, et(12, 0, 10)), true);   // Saturday: Friday's bar is current
  assert.strictEqual(barsFresh('2026-10-07', { at: et(16, 40), partial: false }, et(12, 0, 10)), false);  // Saturday: Wed's bar is stale
  assert.strictEqual(barsFresh('2026-10-07', null, et(20, 0)), false);
});
