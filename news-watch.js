/*
 * LOOP — market-news "watch out" filter
 * ------------------------------------------------------------------
 * Pure logic, no DOM / network / storage. Takes the raw article list from
 * Finnhub's general market news and keeps the few headlines that look like
 * they could move the whole market (trade / China, Fed & macro data,
 * geopolitics). Shared by index.html and news-watch.test.js (node --test).
 *
 * This is a keyword heuristic, not understanding: it will miss things and
 * occasionally flag noise. The UI says so and links to the source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Each entry: [regex, ...]. Word boundaries keep "war" out of "warrant" and
  // "Fed" (case-sensitive) out of "fed up" / "Federal Express".
  const TOPICS = {
    trade: [
      /\btariffs?\b/i, /\btrade (?:war|talks?|deal|truce|dispute|deadline)\b/i,
      /\bchina\b/i, /\bchinese\b/i, /\bbeijing\b/i, /\bxi jinping\b/i, /\btaiwan\b/i,
      /\bexport (?:controls?|curbs?|restrictions?)\b/i, /\brare earths?\b/i, /\bchip (?:ban|curbs?)\b/i,
    ],
    fed: [
      /\bFed\b/, /\bfederal reserve\b/i, /\bpowell\b/i, /\bFOMC\b/,
      /\brate (?:cuts?|hikes?|decision)\b/i, /\binterest rates?\b/i, /\btreasury yields?\b/i,
      /\binflation\b/i, /\bCPI\b/, /\bPCE\b/, /\bjobs report\b/i, /\bnonfarm\b/i, /\bpayrolls?\b/i,
      /\bunemployment\b/i, /\brecession\b/i,
    ],
    geo: [
      /\bsanctions?\b/i, /\bceasefire\b/i, /\binvasion\b/i, /\bmissile\b/i, /\bwar\b/i,
      /\bsummit\b/i, /\bembargo\b/i, /\bOPEC\b/, /\bgovernment shutdown\b/i, /\bdebt ceiling\b/i,
    ],
  };

  function classifyHeadline(text) {
    const s = String(text || '');
    const topics = [];
    let score = 0;
    for (const [topic, rules] of Object.entries(TOPICS)) {
      let hits = 0;
      for (const re of rules) if (re.test(s)) hits++;
      if (hits) { topics.push({ topic, hits }); score += hits; }
    }
    topics.sort((a, b) => b.hits - a.hits);
    return { score, topics: topics.map(t => t.topic) };
  }

  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';

  /*
   * pickWatchItems(articles, { now, maxAgeDays, limit, heldSyms })
   *   articles: Finnhub /news items { headline, summary, url, source, datetime(unix s), related }
   *   -> [{ headline, url, source, datetime, topics, score }]  best first
   * Ranking: keyword score (+1 if it is tagged with a symbol you hold), then newest.
   */
  function pickWatchItems(articles, opts) {
    const o = Object.assign({ now: Date.now(), maxAgeDays: 7, limit: 5, heldSyms: [] }, opts || {});
    const cutoff = o.now / 1000 - o.maxAgeDays * 86400;
    const held = new Set((o.heldSyms || []).map(s => String(s).toUpperCase()));
    const seen = new Set();
    const out = [];
    for (const a of Array.isArray(articles) ? articles : []) {
      if (!a || !a.headline || !(a.datetime >= cutoff)) continue;
      const key = a.headline.trim().toLowerCase();
      if (seen.has(key)) continue;
      const { score, topics } = classifyHeadline(a.headline);
      if (!score) continue;
      seen.add(key);
      const related = String(a.related || '').toUpperCase().split(',').map(x => x.trim()).filter(Boolean);
      const boost = related.some(r => held.has(r)) ? 1 : 0;
      out.push({
        headline: a.headline.trim(), url: safeUrl(a.url), source: a.source || '',
        datetime: a.datetime, topics, score: score + boost,
      });
    }
    out.sort((x, y) => y.score - x.score || y.datetime - x.datetime);
    return out.slice(0, o.limit);
  }

  return { classifyHeadline, pickWatchItems, NEWS_TOPICS: Object.keys(TOPICS) };
});
