/*
 * LOOP — live daily bars (Twelve Data) helpers
 * ------------------------------------------------------------------
 * Pure logic, no DOM / network / storage. The page fetches
 *   https://api.twelvedata.com/time_series?symbol=X&interval=1day&outputsize=260&apikey=KEY
 * straight from the browser (that API sends CORS headers; Yahoo and Stooq do not)
 * and feeds the JSON through tdToBars. Shared with live-bars.test.js (node --test).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Twelve Data time_series JSON -> { t, o, h, l, c, v } oldest first, or null when too short.
  // Errors come back as {code, message, status:'error'} (bad key 401, rate limit 429, unknown symbol 400…)
  // and are thrown with .code so the caller can react.
  function tdToBars(json) {
    if (!json || json.status === 'error' || !Array.isArray(json.values)) {
      const e = new Error((json && json.message) ? String(json.message).replace(/\*\*/g, '').split('. ')[0] : 'no data');
      e.code = json && json.code;
      throw e;
    }
    const byDay = new Map();
    for (const v of json.values) {
      const t = String(v.datetime || '').slice(0, 10);
      const o = +v.open, h = +v.high, l = +v.low, c = +v.close;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || ![o, h, l, c].every(Number.isFinite)) continue;
      byDay.set(t, { t, o, h, l, c, v: Math.round(+v.volume || 0) });
    }
    const rows = [...byDay.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
    if (rows.length < 2) return null;
    const r2 = x => +x.toFixed(2);
    return { t: rows.map(r => r.t), o: rows.map(r => r2(r.o)), h: rows.map(r => r2(r.h)), l: rows.map(r => r2(r.l)), c: rows.map(r => r2(r.c)), v: rows.map(r => r.v) };
  }

  // How long to wait before the next request so no more than `max` go out in any `windowMs`
  // (the free plan allows 8 per minute). stamps = ms timestamps of earlier requests.
  function throttleDelay(stamps, now, max = 8, windowMs = 60000) {
    const recent = stamps.filter(s => now - s < windowMs).sort((a, b) => a - b);
    return recent.length < max ? 0 : recent[recent.length - max] + windowMs - now + 250;
  }

  // New York wall-clock parts for a timestamp (handles daylight saving)
  function etParts(ms) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
    const p = {}; f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour % 24) * 60 + +p.minute, dow: p.weekday };   // dow: Mon…Sun
  }
  const isWeekend = d => d === 'Sat' || d === 'Sun';

  // Regular session 09:30–16:00 ET, Mon–Fri (exchange holidays are not modelled)
  function isMarketOpen(ms) {
    const e = etParts(ms);
    return !isWeekend(e.dow) && e.mins >= 570 && e.mins < 960;
  }

  // ISO date of the most recent US session that has finished (data settles ~16:15 ET)
  function lastSession(ms) {
    let e = etParts(ms), t = ms;
    const step = () => { t -= 86400000; e = etParts(t); };
    if (!isWeekend(e.dow) && e.mins < 975) step();             // today not finished yet
    while (isWeekend(e.dow)) step();
    return e.date;
  }

  // Is a cached series still good? info = { at: fetchedMs, partial: wasFetchedWhileMarketOpen }.
  //  market open  -> refetch after 15 minutes (the latest bar is still forming)
  //  market closed-> good once it holds the last finished session and was not fetched mid-session
  function barsFresh(lastBar, info, now) {
    if (!lastBar || !info || !info.at) return false;
    if (isMarketOpen(now)) return now - info.at < 15 * 60000;
    return !info.partial && lastBar >= lastSession(now);
  }

  return { tdToBars, throttleDelay, isMarketOpen, lastSession, barsFresh };
});
