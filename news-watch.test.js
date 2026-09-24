const test = require('node:test');
const assert = require('node:assert');
const { classifyHeadline, pickWatchItems } = require('./news-watch.js');

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);          // fixed clock
const sec = d => Math.floor((NOW - d * 3600e3) / 1000); // "d hours ago" as unix seconds
const art = (headline, hoursAgo = 2, extra = {}) =>
  ({ headline, url: 'https://example.com/a', source: 'Wire', datetime: sec(hoursAgo), ...extra });

test('flags trade / China, Fed and geopolitics headlines', () => {
  assert.deepStrictEqual(classifyHeadline('US and China resume tariff talks').topics[0], 'trade');
  assert.ok(classifyHeadline('Fed signals a rate cut as inflation cools').topics.includes('fed'));
  assert.ok(classifyHeadline('Sanctions widen ahead of summit').topics.includes('geo'));
});

test('ordinary corporate headlines are not flagged', () => {
  assert.strictEqual(classifyHeadline('Apple unveils new iPhone colours').score, 0);
  assert.strictEqual(classifyHeadline('Analyst raises Nvidia price target').score, 0);
});

test('word boundaries: "warrant" is not war, "fed up" is not the Fed, "Federal Express" is not the Fed', () => {
  assert.strictEqual(classifyHeadline('Company issues warrant to investors').score, 0);
  assert.strictEqual(classifyHeadline('Shoppers are fed up with delivery fees').score, 0);
  assert.strictEqual(classifyHeadline('Federal Express expands hub').score, 0);
});

test('drops stale, duplicate and non-matching articles; keeps newest among equals', () => {
  const items = pickWatchItems([
    art('China tariffs back in focus', 30),
    art('China tariffs back in focus', 1),              // duplicate headline
    art('Fed holds rates steady', 5),
    art('Fed cut expectations grow', 1),
    art('Old China tariffs story', 24 * 9),            // older than 7 days
    art('Local bakery wins award', 1),
  ], { now: NOW });
  assert.strictEqual(items.length, 3);
  assert.ok(!items.some(i => i.headline.includes('Old')));
  assert.ok(!items.some(i => i.headline.includes('bakery')));
});

test('higher keyword score ranks first, then recency; limit applies', () => {
  const items = pickWatchItems([
    art('Fed meeting today', 1),                                  // 1 hit
    art('China tariffs and export controls escalate', 10),        // 3 hits
    art('Sanctions announced', 2),
  ], { now: NOW, limit: 2 });
  assert.strictEqual(items.length, 2);
  assert.match(items[0].headline, /China tariffs/);
});

test('an article tagged with a held symbol gets a boost', () => {
  const items = pickWatchItems([
    art('Tariffs weigh on chipmakers', 3, { related: 'MU,NVDA' }),
    art('Tariffs weigh on retailers', 3, { related: 'WMT' }),
  ], { now: NOW, heldSyms: ['mu'] });
  assert.match(items[0].headline, /chipmakers/);
});

test('non-http urls are dropped, garbage input is safe', () => {
  const [i] = pickWatchItems([art('Tariffs rise', 1, { url: 'javascript:alert(1)' })], { now: NOW });
  assert.strictEqual(i.url, '');
  assert.deepStrictEqual(pickWatchItems(null), []);
  assert.deepStrictEqual(pickWatchItems([{}, null, { headline: '' }], { now: NOW }), []);
});
