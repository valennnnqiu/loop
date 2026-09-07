/*
 * LOOP — IBKR Activity Statement (CSV) importer
 * ------------------------------------------------------------------
 * Parses the "Trades" section of an IBKR Activity Statement exported as CSV
 * into LOOP trade records. Pure (no DOM / no storage), shared by:
 *   - real_pnl_ledger.html  (file drop / paste box)
 *   - Node (CLI dry-run:  node ibkr-import.js path/to/statement.csv)
 *
 * The Activity Statement CSV is multi-section: every line begins with
 *   <SectionName>,<RowType>,...
 * We only care about  Trades,Data,Order,Stocks,...  rows.
 *
 * NOTE: the Activity Statement Trades section has NO per-execution id.
 * Dedup key is composite: SYMBOL|ISO-DATETIME|SIGNED-QTY|PRICE. Seconds are
 * included in Date/Time so real collisions are near-impossible. For a bullet
 * proof id, configure a Flex Query that includes TradeID / IBExecID instead.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- minimal RFC-4180 CSV line splitter (handles "quoted, fields" and "") ---
  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  // "2026-08-07, 10:02:04"  ->  { day: "2026-08-07", date: "2026-08-07T10:02:04" }
  // `date` keeps the intraday time so the engine sorts same-day trades correctly
  // (matches how the existing SEED_TRADES store intraday round-trips).
  function normalizeDateTime(raw) {
    const s = String(raw).trim().replace(/\s+/g, ' ');
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ ,]+(\d{2}:\d{2}:\d{2}))?/);
    if (!m) return { day: s, date: s };
    return { day: m[1], date: m[2] ? `${m[1]}T${m[2]}` : m[1] };
  }

  function dedupKey(t) {
    return [t.sym, t.date, t.side === 'BUY' ? t.qty : -t.qty, t.price].join('|');
  }

  /*
   * parseActivityStatementCsv(text) -> {
   *   trades: [{ id, sym, side, qty, price, comm, date, datetime, reported, code, source }],
   *   accountId, period, warnings: [string]
   * }
   * `id` is derived from the dedup key so re-importing the same statement is a no-op.
   */
  function parseActivityStatementCsv(text) {
    const lines = String(text).split(/\r?\n/);
    const rows = lines.filter(l => l.length).map(splitCsvLine);
    const warnings = [];

    const get = (section, rowType, field) => {
      const r = rows.find(x => x[0] === section && x[1] === rowType && x[2] === field);
      return r ? r[3] : undefined;
    };
    const accountId = get('Account Information', 'Data', 'Account');
    const period = get('Statement', 'Data', 'Period');

    // column layout from the Trades header row (defensive against IBKR reordering)
    const header = rows.find(x => x[0] === 'Trades' && x[1] === 'Header');
    if (!header) {
      return { trades: [], accountId, period, warnings: ['CSV 里没有找到 Trades 段 — 导出时勾选 "Trades" 分区'] };
    }
    const col = name => header.indexOf(name);
    const iCat = col('Asset Category');
    const iSym = col('Symbol');
    const iDT = col('Date/Time');
    const iQty = col('Quantity');
    const iPrice = col('T. Price');
    const iComm = col('Comm/Fee');
    const iRealized = col('Realized P/L');
    const iCode = col('Code');

    const trades = [];
    let skippedNonStock = 0;
    for (const r of rows) {
      if (r[0] !== 'Trades' || r[1] !== 'Data' || r[2] !== 'Order') continue;
      if ((r[iCat] || '').trim() !== 'Stocks') { skippedNonStock++; continue; }

      const qtyRaw = parseFloat(String(r[iQty]).replace(/,/g, ''));
      const price = parseFloat(String(r[iPrice]).replace(/,/g, ''));
      if (!isFinite(qtyRaw) || qtyRaw === 0 || !isFinite(price)) {
        warnings.push(`跳过一行无法解析的成交：${r[iSym]} ${r[iDT]}`);
        continue;
      }
      const { day, date } = normalizeDateTime(r[iDT]);
      const commRaw = parseFloat(String(r[iComm]).replace(/,/g, ''));
      const realized = parseFloat(String(r[iRealized]).replace(/,/g, ''));
      const t = {
        sym: String(r[iSym]).trim().toUpperCase(),
        side: qtyRaw < 0 ? 'SELL' : 'BUY',
        qty: Math.abs(qtyRaw),
        price,
        comm: isFinite(commRaw) ? Math.abs(commRaw) : 0,
        date,
        day,
        code: (r[iCode] || '').trim(),
        source: 'ibkr-csv',
      };
      if (isFinite(realized) && realized !== 0) t.reported = realized;
      t.id = 'ibkr-' + dedupKey(t);
      trades.push(t);
    }
    if (skippedNonStock) warnings.push(`跳过 ${skippedNonStock} 行非股票成交（期权/外汇等，暂不支持）`);

    trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { trades, accountId, period, warnings };
  }

  /*
   * mergeImportedTrades(existing, imported) -> { merged, added, duplicates }
   * Adds only trades whose id is not already present. Never mutates `existing`.
   */
  function mergeImportedTrades(existing, imported) {
    const have = new Set(existing.map(t => t.id));
    const added = [];
    for (const t of imported) {
      if (have.has(t.id)) continue;
      have.add(t.id);
      added.push(t);
    }
    return { merged: existing.concat(added), added, duplicates: imported.length - added.length };
  }

  return { parseActivityStatementCsv, mergeImportedTrades, dedupKey, splitCsvLine };
});

// --- CLI dry-run -------------------------------------------------------------
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = process.argv[2];
  if (!path) { console.error('usage: node ibkr-import.js <statement.csv>'); process.exit(1); }
  const { parseActivityStatementCsv } = module.exports;
  const { trades, accountId, period, warnings } = parseActivityStatementCsv(fs.readFileSync(path, 'utf8'));
  console.log(`account ${accountId}   period ${period}`);
  console.log(`${trades.length} stock trades parsed:\n`);
  for (const t of trades) {
    console.log(
      `  ${t.day}  ${t.side.padEnd(4)} ${String(t.qty).padStart(6)}  ${t.sym.padEnd(6)} @ ${String(t.price).padEnd(14)}` +
      ` comm ${String(t.comm).padEnd(12)}` + (t.reported != null ? ` reported ${t.reported}` : '') + `  [${t.code}]`
    );
  }
  if (warnings.length) console.log('\nwarnings:\n' + warnings.map(w => '  - ' + w).join('\n'));
}
