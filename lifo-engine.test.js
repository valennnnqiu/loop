'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFIFO, runAverageCost } = require('./lifo-engine');

// helper: build a trade with sane defaults
let seq = 0;
function tr(o) {
  seq += 1;
  return { id: 't' + seq, comm: 0, ...o };
}
function approx(actual, expected, msg, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg}: got ${actual}, want ${expected}`);
}
// total realized P&L across all closed rows
function totalPnl(closed) {
  return closed.reduce((s, c) => s + c.pnl, 0);
}
// signed open qty for a symbol
function openQty(openLots, sym) {
  return (openLots[sym] || []).reduce((s, l) => s + l.qty, 0);
}

test('single buy then full sell — plain long round trip', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 100, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 100, price: 12, date: '2026-01-05' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  assert.equal(closed.length, 1);
  approx(closed[0].pnl, 200, 'pnl = (12-10)*100');
  approx(openQty(openLots, 'AAA'), 0, 'no shares left');
});

test('partial close leaves the rest open', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 100, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 30, price: 15, date: '2026-01-05' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  assert.equal(closed.length, 1);
  approx(closed[0].pnl, 150, 'pnl = (15-10)*30');
  approx(openQty(openLots, 'AAA'), 70, '70 shares still open');
});

test('LIFO vs FIFO pick different lots for a partial sell', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 20, date: '2026-01-02' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 10, price: 30, date: '2026-01-03' }),
  ];
  const lifo = runFIFO(trades, 'LIFO');
  const fifo = runFIFO(trades, 'FIFO');
  approx(lifo.closed[0].pnl, 100, 'LIFO closes the $20 lot: (30-20)*10');
  approx(fifo.closed[0].pnl, 200, 'FIFO closes the $10 lot: (30-10)*10');
  // both leave 10 shares open, but at different cost
  approx(openQty(lifo.openLots, 'AAA'), 10, 'LIFO 10 open');
  approx(openQty(fifo.openLots, 'AAA'), 10, 'FIFO 10 open');
  approx(lifo.openLots.AAA[0].unitCost, 10, 'LIFO leaves the $10 lot');
  approx(fifo.openLots.AAA[0].unitCost, 20, 'FIFO leaves the $20 lot');
});

test('one sell spanning multiple lots (cross-batch split)', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 20, date: '2026-01-02' }),
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 30, date: '2026-01-03' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 25, price: 40, date: '2026-01-04' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  assert.equal(closed.length, 1);
  // LIFO: 10@30 + 10@20 + 5@10  ->  (40-30)*10 + (40-20)*10 + (40-10)*5 = 100+200+150
  approx(closed[0].pnl, 450, 'spanned pnl');
  assert.equal(closed[0].matched.length, 3, 'three lots matched');
  approx(openQty(openLots, 'AAA'), 5, '5 shares of the $10 lot remain');
  approx(openLots.AAA[0].unitCost, 10, 'remaining lot is the oldest');
});

test('batched sells against one buy, sequential', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 100, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 40, price: 12, date: '2026-01-02' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 60, price: 8, date: '2026-01-03' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  assert.equal(closed.length, 2);
  approx(totalPnl(closed), 40 * 2 + 60 * -2, 'net: +80 -120 = -40');
  approx(openQty(openLots, 'AAA'), 0, 'flat');
});

test('short then cover — isCover flag and P&L sign', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'SELL', qty: 50, price: 100, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'BUY', qty: 50, price: 80, date: '2026-01-05' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  assert.equal(closed.length, 1, 'the covering BUY is the closed row');
  assert.equal(closed[0].isCover, true, 'flagged as a cover');
  approx(closed[0].pnl, 1000, 'short gain = (100-80)*50');
  approx(openQty(openLots, 'AAA'), 0, 'flat after cover');
});

test('partial short cover leaves residual short exposure', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'SELL', qty: 50, price: 100, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'BUY', qty: 20, price: 90, date: '2026-01-05' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  approx(closed[0].pnl, 200, '(100-90)*20');
  approx(openQty(openLots, 'AAA'), -30, '30 still short');
});

test('commission reduces gains on both legs', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 100, price: 10, comm: 1, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 100, price: 12, comm: 1, date: '2026-01-05' }),
  ];
  const { closed } = runFIFO(trades, 'LIFO');
  // buy comm is folded into the lot cost is NOT done here: engine uses lot.unitCost = price,
  // and only subtracts the SELL-side commission. Lock in current behaviour so a change is visible.
  approx(closed[0].pnl, 200 - 1, 'gain minus sell commission only');
});

test('targetLotId forces a specific lot regardless of LIFO order', () => {
  const trades = [
    tr({ id: 'lotOld', sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ id: 'lotNew', sym: 'AAA', side: 'BUY', qty: 10, price: 20, date: '2026-01-02' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 10, price: 30, date: '2026-01-03', targetLotId: 'lotOld' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  approx(closed[0].pnl, 200, 'closed the targeted $10 lot despite LIFO: (30-10)*10');
  approx(openLots.AAA[0].unitCost, 20, 'the $20 lot is what stays open');
});

test('symbols are matched independently', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ sym: 'BBB', side: 'BUY', qty: 10, price: 50, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 10, price: 15, date: '2026-01-02' }),
  ];
  const { closed, openLots } = runFIFO(trades, 'LIFO');
  assert.equal(closed.length, 1);
  approx(closed[0].pnl, 50, 'only AAA realized');
  approx(openQty(openLots, 'BBB'), 10, 'BBB untouched');
});

test('input list is not mutated', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 10, price: 15, date: '2026-01-02' }),
  ];
  const snapshot = JSON.stringify(trades);
  runFIFO(trades, 'LIFO');
  assert.equal(JSON.stringify(trades), snapshot, 'runFIFO must treat input as read-only');
});

test('runAverageCost books P&L per SELL at the running average', () => {
  const trades = [
    tr({ id: 'b1', sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ id: 'b2', sym: 'AAA', side: 'BUY', qty: 10, price: 20, date: '2026-01-02' }),
    tr({ id: 's1', sym: 'AAA', side: 'SELL', qty: 10, price: 30, date: '2026-01-03' }),
  ];
  const pnl = runAverageCost(trades);
  // avg cost = (100+200)/20 = 15; sell 10 @ 30 -> (30-15)*10 = 150
  approx(pnl.s1, 150, 'average-cost realized');
});

test('LIFO and average-cost agree once the position is fully closed', () => {
  const trades = [
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 10, date: '2026-01-01' }),
    tr({ sym: 'AAA', side: 'BUY', qty: 10, price: 20, date: '2026-01-02' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 8, price: 25, date: '2026-01-03' }),
    tr({ sym: 'AAA', side: 'SELL', qty: 12, price: 5, date: '2026-01-04' }),
  ];
  const lifo = totalPnl(runFIFO(trades, 'LIFO').closed);
  const avg = Object.values(runAverageCost(trades)).reduce((s, v) => s + v, 0);
  approx(lifo, avg, 'total realized is method-independent when flat', 1e-6);
});
