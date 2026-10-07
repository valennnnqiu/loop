#!/usr/bin/env node
/*
 * LOOP — data pack builder
 * ------------------------------------------------------------------
 * Writes loop-data.json: daily bars for the Stock page, radar, momentum board
 * and compare view. Import it in LOOP (Settings → Data pack, or the 📦 chip).
 * Data comes from Yahoo Finance's public chart endpoint (unofficial, no key).
 * Needs Node 18+.
 *
 *   node tools/make-pack.js                         default universe (sector map + SPY/QQQ/SMH)
 *   node tools/make-pack.js NVDA MU AVGO            just these (SPY/QQQ/SMH always added)
 *   node tools/make-pack.js --from loop-backup.json also include everything in a LOOP backup
 *                                                   (traded / held / watched / planned symbols)
 *   node tools/make-pack.js --out ~/Desktop/loop-data.json
 *
 * Not included: option walls / IV and the macro calendar (LOOP falls back to its
 * own calendar events; the option-based sections just stay hidden).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BENCH = ['SPY', 'QQQ', 'SMH'];

// Yahoo chart JSON -> { t, o, h, l, c, v } with 'YYYY-MM-DD' dates in the exchange's time zone.
// A bar for a session that is still open is dropped so the pack always means "as of the last close".
function chartToBars(json, nowMs = Date.now()) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !Array.isArray(r.timestamp) || !r.indicators || !r.indicators.quote || !r.indicators.quote[0]) return null;
  const q = r.indicators.quote[0];
  const off = (r.meta && r.meta.gmtoffset) || 0;
  const day = ts => new Date((ts + off) * 1000).toISOString().slice(0, 10);
  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  r.timestamp.forEach((ts, i) => {
    const c = q.close && q.close[i], o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i];
    if ([c, o, h, l].some(x => x == null || !isFinite(x))) return;           // holiday / halted gaps
    out.t.push(day(ts));
    out.o.push(+o.toFixed(2)); out.h.push(+h.toFixed(2)); out.l.push(+l.toFixed(2)); out.c.push(+c.toFixed(2));
    out.v.push(Math.round((q.volume && q.volume[i]) || 0));
  });
  const reg = r.meta && r.meta.currentTradingPeriod && r.meta.currentTradingPeriod.regular;
  const sessionOpen = reg && nowMs / 1000 >= reg.start && nowMs / 1000 < reg.end;
  if (out.t.length && sessionOpen && out.t[out.t.length - 1] === day(nowMs / 1000)) {
    for (const k of Object.keys(out)) out[k].pop();
  }
  return out.t.length > 1 ? out : null;
}

function symbolsFromBackup(backup) {
  const data = (backup && backup.data) || {};
  const parse = k => { try { return JSON.parse(data[k]); } catch (e) { return null; } };
  const syms = new Set();
  (parse('ledger_trades_v2') || []).forEach(t => t.sym && syms.add(t.sym));
  Object.keys(parse('ledger_prices_v1') || {}).forEach(s => syms.add(s));
  (parse('ledger_watch_v1') || []).forEach(w => w.sym && syms.add(w.sym));
  (parse('loop2_plans_v1') || []).forEach(p => p.sym && syms.add(p.sym));
  return [...syms];
}

function defaultUniverse() {
  const f = path.join(__dirname, '..', 'loop2.js');
  if (!fs.existsSync(f)) return [];
  const m = fs.readFileSync(f, 'utf8').match(/const SECTORS = \{([\s\S]*?)\};/);
  return m ? [...m[1].matchAll(/\b([A-Z]{1,5}):'/g)].map(x => x[1]) : [];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchBars(sym, tries = 2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.replace(/\./g, '-'))}?range=1y&interval=1d&includePrePost=false`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LOOP data pack)' } });
      if (res.ok) return chartToBars(await res.json());
      if (res.status === 404) return null;
    } catch (e) { /* retry */ }
    await sleep(800);
  }
  return null;
}

async function main(argv) {
  let out = 'loop-data.json', from = null; const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--from') from = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\n \* LOOP/, ' * LOOP')); return 0; }
    else args.push(argv[i].toUpperCase());
  }
  if (typeof fetch !== 'function') { console.error('Node 18+ is required (global fetch).'); return 1; }
  let syms = args.slice();
  if (from) syms = syms.concat(symbolsFromBackup(JSON.parse(fs.readFileSync(from, 'utf8'))));
  if (!syms.length) syms = defaultUniverse();
  syms = [...new Set(BENCH.concat(syms))].filter(s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s));

  const bars = {}, failed = [];
  for (const [i, s] of syms.entries()) {
    process.stdout.write(`\r${String(i + 1).padStart(3)}/${syms.length}  ${s.padEnd(8)}`);
    const b = await fetchBars(s);
    if (b) bars[s] = b; else failed.push(s);
    await sleep(120);
  }
  process.stdout.write('\n');
  if (!bars.SPY) { console.error('Could not reach Yahoo Finance (no SPY data) — nothing written.'); return 1; }
  const asOf = bars.SPY.t[bars.SPY.t.length - 1];
  fs.writeFileSync(out, JSON.stringify({ v: 1, source: 'yahoo', generatedAt: new Date().toISOString(), asOf, bars }));
  console.log(`${out}: ${Object.keys(bars).length} symbols, as of ${asOf} close` + (failed.length ? `\nno data for: ${failed.join(' ')}` : ''));
  return 0;
}

module.exports = { chartToBars, symbolsFromBackup, defaultUniverse };
if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error(e.message); process.exit(1); });
