/*
 * LOOP — LIFO / average-cost P&L engine
 * ------------------------------------------------------------------
 * Pure calculation core, no DOM, no storage. Shared by:
 *   - real_pnl_ledger.html  (loaded via <script src="lifo-engine.js">)
 *   - lifo-engine.test.js    (loaded via require(), run with `node --test`)
 *
 * Phase 4 (packaging) will inline this back into the single HTML file.
 * Until then it is the single source of truth for the matching logic —
 * do not copy these functions elsewhere.
 *
 * A "trade" is: { id, sym, side:'BUY'|'SELL', qty, price, comm?, date,
 *                 targetLotId?, buyAvgOverride? }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / test runner
  } else {
    Object.assign(root, api);        // browser: expose as globals
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Average-cost method: one running average per symbol, realized P&L booked
  // on every SELL as (proceeds - avg*qty). Used for the "均价法" comparison column.
  function runAverageCost(list) {
    const sorted = [...list].sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id < b.id ? -1 : 1));
    const state = {}; // per symbol: {qty, cost}
    const pnlByTradeId = {};

    for (const t of sorted) {
      if (!state[t.sym]) state[t.sym] = { qty: 0, cost: 0 };
      const s = state[t.sym];
      if (t.side === 'BUY') {
        s.cost += t.qty * t.price + (t.comm || 0);
        s.qty += t.qty;
      } else {
        // if somehow oversold beyond tracked history (shouldn't happen with full data),
        // fall back to this trade's own price as the average so it doesn't go nonsensical
        const avg = s.qty > 0.0000001 ? s.cost / s.qty : t.price;
        const costRemoved = avg * t.qty;
        const proceeds = t.qty * t.price - (t.comm || 0);
        pnlByTradeId[t.id] = proceeds - costRemoved;
        s.cost -= avg * Math.min(t.qty, s.qty);
        s.qty -= t.qty;
        if (s.qty < 0) s.qty = 0;
        if (s.cost < 0) s.cost = 0;
      }
    }
    return pnlByTradeId;
  }

  // Lot-matched method (FIFO or LIFO). Returns:
  //   closed:   array of { ...trade, matched:[{qty,unitCost,date,estimated,wasShort}], pnl, isCover }
  //             in reverse-chronological order
  //   openLots: { [sym]: [{qty(signed), unitCost, date, estimated, sourceId}] }
  //   warnings: array (currently unused, kept for the cash-flow closure check to fill)
  function runFIFO(list, matchMethod) {
    const sorted = [...list].sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id < b.id ? -1 : 1));
    const queues = {};
    const closed = [];
    const warnings = [];

    for (const t of sorted) {
      if (!queues[t.sym]) queues[t.sym] = [];
      const q = queues[t.sym];
      let remaining = t.side === 'BUY' ? t.qty : -t.qty; // signed: +buy, -sell
      const matched = [];
      let realizedPnl = 0;

      // if this SELL manually targets a specific lot, close that one first,
      // regardless of where it sits in the FIFO/LIFO order
      if (t.side === 'SELL' && t.targetLotId) {
        const idx = q.findIndex(l => l.sourceId === t.targetLotId && l.qty > 0);
        if (idx !== -1) {
          const lot = q[idx];
          const closeQty = Math.min(lot.qty, -remaining);
          const pnl = (t.price - lot.unitCost) * closeQty - (t.comm || 0) * (closeQty / t.qty);
          realizedPnl += pnl;
          matched.push({ qty: closeQty, unitCost: lot.unitCost, date: lot.date, estimated: lot.estimated, wasShort: false });
          lot.qty -= closeQty;
          remaining += closeQty;
          if (lot.qty < 0.0000001) q.splice(idx, 1);
        }
      }

      // close against opposite-sign lots first (this handles normal long-sell,
      // AND short-cover when a sell happened with nothing to sell against earlier)
      while (remaining !== 0 && q.length > 0) {
        const lotIndex = matchMethod === 'LIFO' ? q.length - 1 : 0;
        const lot = q[lotIndex];
        const sameSign = (lot.qty > 0 && remaining > 0) || (lot.qty < 0 && remaining < 0);
        if (sameSign) break; // nothing to close, this trade only adds exposure
        const closeQty = Math.min(Math.abs(lot.qty), Math.abs(remaining));
        // pnl: for a long lot being sold, gain = (sellPrice - lotCost) * qty
        // for a short lot being covered, gain = (lotCost - buyPrice) * qty
        const pnl = lot.qty > 0
          ? (t.price - lot.unitCost) * closeQty - (t.comm || 0) * (closeQty / t.qty)
          : (lot.unitCost - t.price) * closeQty - (t.comm || 0) * (closeQty / t.qty);
        realizedPnl += pnl;
        matched.push({ qty: closeQty, unitCost: lot.unitCost, date: lot.date, estimated: lot.estimated, wasShort: lot.qty < 0 });
        lot.qty += lot.qty > 0 ? -closeQty : closeQty;
        remaining += remaining > 0 ? -closeQty : closeQty;
        if (Math.abs(lot.qty) < 0.0000001) q.splice(lotIndex, 1);
      }
      if (remaining !== 0) {
        // opens new exposure (long lot if remaining>0, short lot if remaining<0)
        q.push({ qty: remaining, unitCost: t.price, date: t.date, estimated: false, sourceId: t.id });
      }

      if (matched.length > 0) {
        closed.push({ ...t, matched, pnl: realizedPnl, isCover: t.side === 'BUY' });
      }
    }
    return { closed: closed.reverse(), openLots: queues, warnings };
  }

  return { runFIFO, runAverageCost };
});
