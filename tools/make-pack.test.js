const test = require('node:test');
const assert = require('node:assert');
const { chartToBars, symbolsFromBackup, defaultUniverse } = require('./make-pack.js');

// 2026-10-05 and 10-06 sessions, New York (UTC-4): open 13:30 UTC
const ts = [Date.UTC(2026, 9, 5, 13, 30) / 1000, Date.UTC(2026, 9, 6, 13, 30) / 1000, Date.UTC(2026, 9, 7, 13, 30) / 1000];
const chart = (over = {}) => ({ chart: { result: [{
  meta: { gmtoffset: -14400, currentTradingPeriod: { regular: { start: ts[2], end: ts[2] + 6.5 * 3600 } } },
  timestamp: ts,
  indicators: { quote: [{ open: [10, 11, null], high: [12, 13, null], low: [9, 10, null], close: [11.234, 12.5, null], volume: [100, 200, null] }] },
  ...over }] } });

test('maps Yahoo arrays to dated bars and skips null (holiday) rows', () => {
  const b = chartToBars(chart(), Date.UTC(2026, 9, 7, 23, 0));          // after the close
  assert.deepStrictEqual(b.t, ['2026-10-05', '2026-10-06']);
  assert.deepStrictEqual(b.c, [11.23, 12.5]);
  assert.deepStrictEqual(b.v, [100, 200]);
});

test('drops the bar of a session that is still open', () => {
  const full = chart();
  full.chart.result[0].indicators.quote[0] = { open: [10, 11, 12], high: [12, 13, 14], low: [9, 10, 11], close: [11, 12, 13], volume: [1, 2, 3] };
  assert.deepStrictEqual(chartToBars(full, Date.UTC(2026, 9, 7, 15, 0)).t, ['2026-10-05', '2026-10-06']);  // mid-session
  assert.strictEqual(chartToBars(full, Date.UTC(2026, 9, 7, 23, 0)).t.length, 3);                           // after close
});

test('garbage / empty responses give null', () => {
  assert.strictEqual(chartToBars(null), null);
  assert.strictEqual(chartToBars({ chart: { result: null } }), null);
  assert.strictEqual(chartToBars(chart({ timestamp: [ts[0]] , indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] } })), null);
});

test('symbols are collected from a LOOP backup', () => {
  const backup = { data: {
    ledger_trades_v2: JSON.stringify([{ sym: 'MU' }, { sym: 'NVDA' }]),
    ledger_prices_v1: JSON.stringify({ AVGO: { price: 1 } }),
    ledger_watch_v1: JSON.stringify([{ sym: 'AMD' }]),
    loop2_plans_v1: JSON.stringify([{ sym: 'META' }]),
  } };
  assert.deepStrictEqual(symbolsFromBackup(backup).sort(), ['AMD', 'AVGO', 'META', 'MU', 'NVDA']);
  assert.deepStrictEqual(symbolsFromBackup({}), []);
});

test('default universe is read from the sector map in loop2.js', () => {
  const u = defaultUniverse();
  assert.ok(u.length > 30 && u.includes('NVDA') && u.includes('MU'));
});
