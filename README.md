# LOOP

A single-file trading P&L ledger. Download one HTML file, open it in a browser,
and your data stays in that browser on that computer — nothing is uploaded anywhere.

一个单文件的交易盈亏账本。下载一个 HTML 文件、浏览器打开即可，数据只存在你这台
电脑的浏览器里，不会上传到任何服务器。

## What it does / 能做什么

- **LIFO 逐批结算 vs 券商均价法对照** — every closed trade is settled lot-by-lot
  (last-in-first-out) and shown side by side with the average-cost number your
  broker reports. The difference is the money the average-cost method hides.
- **IBKR 对账单导入** — drop an Interactive Brokers *Activity Statement* exported
  as CSV; trades are deduped by symbol + execution time + qty + price, so
  re-importing an overlapping statement is safe.
- **持仓 + 组合占比圆环图**, a **price-target watchlist**, a **calendar** for dated
  events, and **weekly / monthly realized-P&L** charts.
- **数据正确性自检** — after every change LOOP re-tallies each symbol and warns if
  the books don't balance or a sell exceeds the known position.
- 中英双语 (toggle top-right).

## Who it's for / 适用人群

Built around a **Canadian Interactive Brokers** cash/margin account, where the
CRA uses adjusted-cost-base (average cost) but you may want to see true lot-matched
P&L. If you don't hold a similar account, the LIFO-vs-average-cost comparison
probably isn't what you need.

## Use it / 怎么用

1. Download **`index.html`**.
2. Open it in any modern browser (double-click, or drag into a tab).
3. Add trades manually, or **导入对账单** with an IBKR CSV.
4. **导出备份 / 导入备份** — one JSON file with everything. This is the only backup;
   `localStorage` can be wiped by clearing site data, a different browser, or a
   private window.

## AI review (optional, off by default) / AI 复盘（选填，默认关闭）

The **周报 → 操作评价** panel can send a summary of your recent trades to the
Anthropic API for feedback. It is **off by default**. Turning it on asks for your
own Anthropic API key, which is stored **in plain text in this browser's
localStorage**. Do not enable this on a shared or public computer. With the switch
off, no request is ever made.

## Development / 开发

The matching engine is split out for testing:

```
lifo-engine.js        pure LIFO / average-cost core (browser global + Node module)
lifo-engine.test.js   node --test
ibkr-import.js         IBKR Activity Statement CSV parser
index.html             the app (loads the two .js files)
```

```bash
node --test                              # run the engine tests
node ibkr-import.js path/to/statement.csv   # dry-run the CSV parser
```

For distribution the two `.js` files can be inlined back into a single HTML file.

## Privacy / 隐私

No backend, no analytics, no network calls — except: Google Fonts (styling) and,
*only if you turn on AI review*, the Anthropic API. Your trades never leave your
machine otherwise.
