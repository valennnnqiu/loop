/* ---- loop2.js : LOOP 2.0 phase 1 — today / plans / risk / plan review ---- */
const PLANS_KEY  = 'loop2_plans_v1';
const CFG_KEY    = 'loop2_cfg_v1';
const QUOTES_KEY = 'loop2_quotes_v1';
const TAGS_KEY   = 'loop2_fill_tags_v1';
const TODAY_KEY  = 'loop2_today_v1';
BACKUP_KEYS.push(PLANS_KEY, CFG_KEY, TAGS_KEY, TODAY_KEY);

// default sector map for AI-chain names (overridable per symbol in Positions → Risk)
const SECTORS = {
  AAOI:'光通信', CIEN:'光通信', COHR:'光通信', CRDO:'光通信', LITE:'光通信',
  MU:'存储', SKHY:'存储', STX:'存储', WDC:'存储',
  AMKR:'封装', ONTO:'封装', TER:'封装', AMAT:'半导体设备',
  ALAB:'ASIC', ANET:'ASIC', ARM:'ASIC', AVGO:'ASIC', MRVL:'ASIC',
  AMD:'GPU', INTC:'GPU', NVDA:'GPU', TSM:'GPU',
  APLD:'数据中心', CRWV:'数据中心', IREN:'数据中心', NBIS:'数据中心', ORCL:'数据中心',
  CEG:'电力', ETN:'电力', GEV:'电力', PWR:'电力', VRT:'电力', VST:'电力',
  BWXT:'核能', CCJ:'核能', LEU:'核能', NXE:'核能', OKLO:'核能', SMR:'核能',
  ASTS:'航天', LUNR:'航天', PL:'航天', RDW:'航天', RKLB:'航天', SPCX:'航天',
  AAPL:'七巨头', AMZN:'七巨头', GOOGL:'七巨头', META:'七巨头', MSFT:'七巨头', TSLA:'七巨头',
};

let plans = [];
let cfg = { risk:'', maxSingle:40, maxSector:60, weekTarget:'', sectors:{}, betas:{}, stops:{} };
let quotes = { at:0, q:{} };
let fillTags = {};
let todayState = { dismiss:{}, log:[] };
let planFormOpen = false, planEditId = null;

Object.assign(I18N.zh, { targetsTitle:'观察中', btnAddTarget:'+ 添加', impTitle:'拖入 IBKR 对账单（CSV）', impSub:'或点击选择文件', impHow:'怎么导出', impPasteLink:'没有文件？粘贴 CSV 文本', impManual:'手动添加一笔', tabToday:'今日', tabCalendar:'日历', tabReview:'复盘', subWeekly:'周报', subPlans:'计划对账', subTrades:'交易明细' });
Object.assign(I18N.en, { targetsTitle:'Watching', btnAddTarget:'+ Add', impTitle:'Drop your IBKR statement (CSV)', impSub:'or click to choose a file', impHow:'how to export', impPasteLink:'No file? Paste CSV text', impManual:'Add a trade by hand', tabToday:'Today', tabCalendar:'Calendar', tabReview:'Review', subWeekly:'Weekly', subPlans:'Plan check', subTrades:'Trades' });

// ---------- small helpers ----------
const d10 = x => String(x||'').slice(0,10);
const todayISO = () => dateKey(new Date());
function localDate(s){ const [y,m,d] = d10(s).split('-').map(Number); return new Date(y, (m||1)-1, d||1); }
function addDays(s, n){ const d = localDate(s); d.setDate(d.getDate()+n); return dateKey(d); }
function daysBetween(a, b){ return Math.round((localDate(b) - localDate(a)) / 86400000); }
const md = s => { const d = localDate(s); return (d.getMonth()+1)+'/'+d.getDate(); };
const num = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };
const money = (n, dp=0) => (n<0?'−':'') + '$' + fmt(Math.abs(n), dp);
const pct = (n, dp=1) => fmt(n, dp) + '%';
const esc = escHtml;
function saveKey(k, v){ return window.storage.set(k, JSON.stringify(v)).catch(()=>{}); }
const savePlans = () => saveKey(PLANS_KEY, plans);
const saveCfg = () => saveKey(CFG_KEY, cfg);
const saveQuotes = () => saveKey(QUOTES_KEY, quotes);
const saveTags = () => saveKey(TAGS_KEY, fillTags);
const saveToday = () => saveKey(TODAY_KEY, todayState);

function getPrice(sym){
  const m = posMeta[sym];
  if(m && m.price != null) return m.price;
  const q = quotes.q[sym];
  return q ? q.p : null;
}
function sectorOf(sym){ return cfg.sectors[sym] || SECTORS[sym] || '未分类'; }
const SECTOR_EN = { '光通信':'Optical', '存储':'Memory', '封装':'Packaging & test', '半导体设备':'Semi equipment', 'ASIC':'ASIC', 'GPU':'GPU', '数据中心':'Data centers', '电力':'Power', '核能':'Nuclear', '航天':'Space', '七巨头':'Mag 7', '未分类':'Unclassified' };
function secName(s){ return lang === 'en' ? (SECTOR_EN[s] || s) : s; }
function secKey(v){ v = String(v || '').trim(); const k = Object.keys(SECTOR_EN).find(z => SECTOR_EN[z].toLowerCase() === v.toLowerCase()); return k || v; }
function betaOf(sym){ const b = num(cfg.betas[sym]); return b == null ? 1 : b; }
function riskSetting(){ return num(cfg.risk); }

// same merge as renderPositions: ledger-derived holdings + manual layer
function holdingsNow(){
  const cashUSD = cash.usd + (cash.cad||0)/fx;
  const bySym = {};
  for(const h of derivedHoldings()) bySym[h.sym] = h;
  for(const sym of Object.keys(posMeta)){
    if(posMeta[sym].qty != null && !posMeta[sym].deleted && !bySym[sym]) bySym[sym] = { sym, qty:0, avgCost:0, lots:[] };
  }
  const list = Object.values(bySym).map(h => {
    const m = posMeta[h.sym] || {};
    const qty = m.qty != null ? m.qty : h.qty;
    const avg = m.avg != null ? m.avg : h.avgCost;
    const priced = m.price != null || (quotes.q[h.sym] != null);
    const last = getPrice(h.sym) ?? avg;
    return { sym:h.sym, qty, avg, last, priced, mv: qty*last, deleted: !!m.deleted };
  }).filter(h => !h.deleted && Math.abs(h.qty) > 1e-9).sort((a,b) => b.mv - a.mv);
  const stockMV = list.reduce((s,h)=> s + h.mv, 0);
  const total = stockMV + cashUSD;
  const map = {}; list.forEach(h => map[h.sym] = h);
  return { list, map, cashUSD, stockMV, total };
}

function earningsBetween(sym, from, to){
  const out = [];
  for(const k of Object.keys(calendarEvents)){
    if(k < from || k > to) continue;
    for(const ev of calendarEvents[k] || []){
      if(ev.category !== 'earnings') continue;
      const tx = String(ev.text||'').toUpperCase();
      if(tx === sym || tx.startsWith(sym+' ')) out.push(k);
    }
  }
  return out.sort();
}
const nextEarnings = (sym, horizon=120) => earningsBetween(sym, todayISO(), addDays(todayISO(), horizon))[0] || null;

// ---------- plan math ----------
function activePlans(){ return plans.filter(p => !p.closedAt); }
function planCovers(p, date){ return d10(p.createdAt) <= date && (!p.closedAt || d10(p.closedAt) >= date); }
function inZone(p, price){ return price >= p.lo - 1e-9 && price <= p.hi + 1e-9; }

function buysFor(p){
  return AT().filter(t => t.side === 'BUY' && t.sym === p.sym && planCovers(p, d10(t.date)))
    .sort((a,b) => d10(a.date) < d10(b.date) ? -1 : 1)
    .map(t => ({ t, inPlan: fillTags[t.id] ? fillTags[t.id] === 'in' : inZone(p, t.price) }));
}

function planCalc(p, H){
  const price = getPrice(p.sym);
  const mid = (p.lo + p.hi) / 2;
  const riskAmt = num(p.risk) ?? riskSetting();
  const rps = mid - p.stop;
  const shares = riskAmt != null && rps > 0 ? Math.floor(riskAmt / rps) : null;
  const n = Math.max(1, p.tranches || 1);
  const trPx = n === 1 ? [mid] : Array.from({length:n}, (_, i) => p.hi - (p.hi - p.lo) * i / (n - 1));
  let trQty = null;
  if(shares != null){ const base = Math.floor(shares / n); trQty = trPx.map((_, i) => i === n-1 ? shares - base*(n-1) : base); }
  const rrMid = rps > 0 ? (p.target - mid) / rps : null;
  const rrNow = price != null && price > p.stop ? (p.target - price) / (price - p.stop) : null;
  const fills = buysFor(p);
  const bought = fills.filter(f => f.inPlan).reduce((s,f) => s + f.t.qty, 0);
  const today = todayISO();

  let state, label, cls;
  if(p.closedAt){
    state = 'closed'; cls = 'closed';
    label = { target:L('已结束 · 达标','Closed · target'), stop:L('已结束 · 止损','Closed · stopped'), expired:L('已结束 · 过期','Closed · expired'), manual:L('已结束 · 手动','Closed · manual') }[p.closeReason] || L('已结束','Closed');
  } else if(d10(p.expiry) < today){ state='expired'; cls='expired'; label=L('已过期','Expired'); }
  else if(price == null){ state='noprice'; cls='wait'; label=L('等待 · 无报价','Waiting · no quote'); }
  else if(price <= p.stop){ state='stopHit'; cls='stop'; label=L('触及止损价','Stop hit'); }
  else if(price >= p.target){ state='targetHit'; cls='target'; label=L('到达目标','Target hit'); }
  else if(bought > 0){ state='exec'; cls='exec'; label = L('执行中','In progress') + (shares ? ` · ${fmt(bought,0)}/${fmt(shares,0)}` : ` · ${fmt(bought,0)}${L(' 股',' sh')}`); }
  else if(inZone(p, price)){ state='inZone'; cls='zone'; label=L('进区','In zone'); }
  else if(price > p.hi){ state='waiting'; cls='wait'; label=L('等待','Waiting'); }
  else { state='below'; cls='wait'; label=L('低于区间','Below zone'); }

  let dist = '';
  if(price != null && !p.closedAt){
    if(price > p.hi) dist = L(`距区间上沿 +${fmt((price/p.hi-1)*100,1)}%`, `+${fmt((price/p.hi-1)*100,1)}% above zone`);
    else if(price < p.lo && price > p.stop) dist = L(`低于下沿 ${fmt((price/p.lo-1)*100,1)}% · 离止损价 ${fmt((price/p.stop-1)*100,1)}%`, `${fmt((price/p.lo-1)*100,1)}% below zone · ${fmt((price/p.stop-1)*100,1)}% above stop`);
    else if(inZone(p, price)) dist = L('在关注区内','inside the zone');
  }

  // warnings: only when something is off
  const warns = [];
  if(!(p.stop < p.lo && p.lo <= p.hi && p.hi < p.target))
    warns.push({c:'err', t:L('价位顺序不对：需要 止损价 < 区间下沿 ≤ 上沿 < 目标','Levels out of order: need stop < zone low ≤ zone high < target')});
  else if(rrMid != null && rrMid < 1)
    warns.push({c:'', t:L(`区间中点的盈亏比只有 ${fmt(rrMid,2)}，不到 1`, `Reward/risk at zone mid is only ${fmt(rrMid,2)} (< 1)`)});
  if(!p.closedAt){
    const er = earningsBetween(p.sym, today, d10(p.expiry));
    if(er.length) warns.push({c:'', t:L(`财报 ${md(er[0])} 在计划有效期内`, `Earnings ${md(er[0])} falls inside the plan window`)});
    if(H && shares != null && H.total > 0){
      const remaining = Math.max(0, shares - bought);
      const add = remaining * mid;
      const totalAfter = H.total + Math.max(0, add - H.cashUSD);
      const symMV = (H.map[p.sym] ? H.map[p.sym].mv : 0) + add;
      const w = symMV / totalAfter * 100;
      if(w > cfg.maxSingle) warns.push({c:'', t:L(`执行完后 ${p.sym} 约占 ${fmt(w,0)}%，超过单票上限 ${cfg.maxSingle}%`, `After execution ${p.sym} ≈ ${fmt(w,0)}% of the account, above the ${cfg.maxSingle}% single-stock limit`)});
      const sec = sectorOf(p.sym);
      const secMV = H.list.filter(h => sectorOf(h.sym) === sec && h.sym !== p.sym).reduce((s,h)=> s + h.mv, 0) + symMV;
      const sw = secMV / totalAfter * 100;
      if(sw > cfg.maxSector) warns.push({c:'', t:L(`执行完后「${sec}」板块约占 ${fmt(sw,0)}%，超过板块上限 ${cfg.maxSector}%`, `After execution the ${secName(sec)} sector ≈ ${fmt(sw,0)}%, above the ${cfg.maxSector}% sector limit`)});
    }
  }
  return { price, mid, riskAmt, rps, shares, trPx, trQty, rrMid, rrNow, fills, bought, state, label, cls, dist, warns };
}

// ---------- plans: UI ----------
// position-tool bar: stop ── risk (red) ── entry ── reward (green) ── target, zone bracket, price marker, fills
function rulerHtml(p, c, showNow){
  const price = showNow ? c.price : null;
  const fills = c.fills.filter(f => f.inPlan);
  const vals = [p.stop, p.lo, p.hi, p.target].concat(price != null ? [price] : [], fills.map(f => f.t.price));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.04 || hi * 0.02;
  lo -= pad; hi += pad;
  const X = v => (v - lo) / (hi - lo) * 100;
  const x = v => X(v).toFixed(2) + '%';
  const w = (a, b) => (X(b) - X(a)).toFixed(2) + '%';
  const riskTxt = c.shares != null ? `−$${fmt(c.shares * (c.mid - p.stop), 0)}` : `−$${fmt(c.mid - p.stop)}/${L('股','sh')}`;
  const rewTxt  = c.shares != null ? `+$${fmt(c.shares * (p.target - c.mid), 0)}` : `+$${fmt(p.target - c.mid)}/${L('股','sh')}`;
  return `<div class="pt">
    <div class="pt-track"></div>
    <div class="pt-risk" style="left:${x(p.stop)}; width:${w(p.stop, c.mid)}"><span>${L('风险','risk')} ${riskTxt}</span></div>
    <div class="pt-reward" style="left:${x(c.mid)}; width:${w(c.mid, p.target)}"><span>${rewTxt} ${L('收益','reward')}</span></div>
    <div class="pt-zone" style="left:${x(p.lo)}; width:${w(p.lo, p.hi)}"></div>
    ${fills.map(f => `<div class="pt-fill" style="left:${x(f.t.price)}" title="${md(f.t.date)} ${fmt(f.t.qty,0)} @ ${fmt(f.t.price)}">💰</div>`).join('')}
    ${price != null ? `<div class="pt-now" style="left:${x(price)}"></div><div class="pt-nowlab" style="left:${x(price)}">${fmt(price)}</div>` : ''}
    <div class="pt-lab stop" style="left:${x(p.stop)}">${term('stop', L('止损','Stop'))} <b>${fmt(p.stop)}</b></div>
    <div class="pt-lab zone" style="left:${x((p.lo + p.hi) / 2)}">${L('关注区','Zone')} <b>${fmt(p.lo)}–${fmt(p.hi)}</b></div>
    <div class="pt-lab tgt" style="left:${x(p.target)}">${L('目标','Target')} <b>${fmt(p.target)}</b></div>
  </div>`;
}

function planCardHtml(p, H){
  const c = planCalc(p, H);
  const hot = c.state === 'inZone', alarm = ['stopHit','expired'].includes(c.state);
  const rrCls = v => v == null ? '' : v >= 2 ? 'gain-t' : v < 1 ? 'loss-t' : '';
  const prog = c.shares ? Math.min(100, c.bought / c.shares * 100) : 0;
  // tranche ladder, filled in order by in-plan buys
  let cum = 0;
  // suggested split of the position across the levels: an even split (the last level takes the rounding),
  // independent of whole-share rounding so a 2-level plan reads 50 / 50, not 46 / 54
  const nTr = c.trPx.length;
  const trPct = c.trPx.map((_, i) => i < nTr - 1 ? Math.round(100 / nTr) : 100 - Math.round(100 / nTr) * (nTr - 1));
  const steps = c.trPx.map((px, i) => {
    const q = c.trQty ? c.trQty[i] : null;
    const start = cum; cum += q || 0;
    const got = q ? Math.max(0, Math.min(q, c.bought - start)) : 0;
    const fr = q ? got / q : 0;
    const cls = fr >= 1 - 1e-9 ? 'done' : fr > 0 ? 'part' : '';
    return `<div class="tr ${cls}" style="${cls==='part' ? `--fr:${(fr*100).toFixed(0)}%` : ''}">
      <div class="tr-n">${L('第','#')}${i+1}${L(' 批','')} · ${L('建议买 ','buy ')}${trPct[i]}%${cls==='done' ? ' ✓' : cls==='part' ? ` · ${fmt(got,0)}/${fmt(q,0)}` : ''}</div>
      <div class="tr-v">${fmt(px)}${q != null ? `<span> × ${fmt(q,0)}</span>` : ''}</div></div>`;
  }).join('');
  const off = c.fills.filter(f => !f.inPlan);
  const warns = c.warns;
  return `<div class="plan-card ${hot?'hot':''} ${alarm?'alarm':''} ${p.closedAt?'closed':''}">
    <div class="pc-head">
      <div class="pc-id">
        <div class="pc-l1"><a class="sym" onclick="openStock('${esc(p.sym)}')">${esc(p.sym)}</a><span class="px">${c.price != null ? '$'+fmt(c.price) : '—'}</span></div>
        <div class="pc-l2"><span>${esc(secName(sectorOf(p.sym)))}</span><i>·</i><span class="pc-st ${c.cls}">${c.label}</span></div>
      </div>
      <span class="grow">
        ${p.closedAt
          ? `<button class="btn-ghost btn-small" onclick="reopenPlan('${p.id}')">${L('重新打开','Reopen')}</button><button class="btn-ghost btn-small" onclick="deletePlan('${p.id}')">${L('删除','Delete')}</button>`
          : `<button class="btn-ghost btn-small" onclick="editPlan('${p.id}')">${L('编辑','Edit')}</button><button class="icon-btn pc-x" aria-label="${L('结束这个计划','Close this plan')}" onclick="closePlan('${p.id}')">✕</button>`}
      </span>
    </div>
    ${rulerHtml(p, c, !p.closedAt)}
    <div class="pc-stats">
      <div class="pc-stat"><div class="k">${term('rr')}</div><div class="v ${rrCls(c.rrMid)}">${c.rrMid != null ? fmt(c.rrMid,2) : '—'}</div></div>
      <div class="pc-stat"><div class="k">${L('计划仓位','Size')}</div><div class="v">${c.shares != null ? fmt(c.shares,0) + L(' 股',' sh') : '—'}</div></div>
      <div class="pc-stat"><div class="k">${L('已执行','Filled')}</div><div class="v">${fmt(c.bought,0)}${c.shares ? `<span class="muted"> / ${fmt(c.shares,0)}</span>` : ''}</div><div class="mini"><i style="width:${prog}%"></i></div></div>
      <div class="pc-stat"><div class="k">${p.closedAt ? L('结束于','Closed') : L('有效期','Valid to')}</div><div class="v">${md(p.closedAt || p.expiry)}</div></div>
    </div>
    <div class="tr-steps">${steps}</div>
    ${off.length ? `<div class="pc-fills"><span class="muted">${L('计划外成交','Off-plan fills')}</span>${off.map(f => `<span class="fill-chip out" aria-label="${L('点一下改成计划内','click to mark in-plan')}" onclick="toggleFillTag('${f.t.id}', false)">${md(f.t.date)} ${fmt(f.t.qty,0)} @ ${fmt(f.t.price)}</span>`).join('')}</div>` : ''}
    ${warns.length ? `<div class="pc-alert">${warns.map(w => `<div class="${w.c}">${w.t}</div>`).join('')}</div>` : ''}
    ${p.note ? `<div class="pc-note">${esc(p.note)}</div>` : ''}
  </div>`;
}

// ---------- form building blocks ----------
function fld(o){
  const tag = o.req ? `<i class="f-req" title="${L('必填','required')}">*</i>` : o.opt ? `<span class="f-opt">${L('选填','optional')}</span>` : '';
  const tip = o.tip ? `<span class="f-tip" tabindex="0" data-tip="${esc(o.tip)}">i</span>` : '';
  const dot = o.dot ? `<span class="f-dot ${o.dot}"></span>` : '';
  return `<div class="f-field ${o.cls||''}">
    <label class="f-label" for="${o.id||''}">${dot}${o.label}${tag}${tip}</label>
    ${o.body || `<div class="f-in">${o.prefix ? `<span class="f-ad">${o.prefix}</span>` : ''}<input id="${o.id}" ${o.attrs||''}>${o.unit ? `<span class="f-ad">${o.unit}</span>` : ''}</div>`}
    ${o.hint ? `<div class="f-hint">${o.hint}</div>` : ''}
  </div>`;
}
const eg = v => `${L('例如','e.g.')} ${v}`;

function planFormHtml(){
  const p = planEditId ? plans.find(x => x.id === planEditId) : null;
  const v = (k, d='') => p && p[k] != null ? p[k] : d;
  const r = riskSetting();
  const n = v('tranches', 3);
  return `<div class="form-card plan-form f2">
    <div class="f2-head"><b>${p ? L(`编辑 ${p.sym} 的计划`, `Edit ${p.sym} plan`) : L('新交易计划','New trade plan')}</b>
      <div class="f-btns"><button class="btn-primary btn-small" onclick="savePlan()">${L('保存','Save')}</button><button type="button" class="icon-btn f-x" aria-label="${L('取消','Cancel')}" aria-label="${L('取消','Cancel')}" onclick="closePlanForm()">✕</button></div></div>
    <div class="f2-grid">
      <div class="f2-main">
        <div class="f2-sec"><div class="f2-sec-t"><span>1</span>${L('股票','Stock')}</div>
          ${fld({ id:'pf-sym', label:L('代码','Symbol'), req:true, cls:'w-sym', attrs:`type="text" placeholder="${eg('NBIS')}" style="text-transform:uppercase;" value="${esc(v('sym'))}" ${p?'disabled':''} oninput="planPreview()"` })}
        </div>
        <div class="f2-sec"><div class="f2-sec-t"><span>2</span>${L('价位','Levels')}</div>
          <div class="f2-row2">
            ${fld({ label:L('关注区间','Buy zone'), req:true, dot:'zone', cls:'span2', tip:L('你愿意买入的价格区间，通常是最近的支撑区。只有一个价位就两格填一样。','The price range you are willing to buy in, usually the nearest support. One price? Put it in both boxes.'),
                body:`<div class="f-pair"><div class="f-in"><span class="f-ad">$</span><input id="pf-lo" type="number" step="any" placeholder="${L('低','low')}" value="${v('lo')}" oninput="planPreview()"></div><span class="f-dash">–</span><div class="f-in"><span class="f-ad">$</span><input id="pf-hi" type="number" step="any" placeholder="${L('高','high')}" value="${v('hi')}" oninput="planPreview()"></div></div>` })}
            ${fld({ id:'pf-stop', label:L('止损价','Stop'), req:true, dot:'stop', prefix:'$', tip:L('跌到这里说明买入理由不成立了，按计划离场。放在支撑区下方，别放在支撑区里面。','If price gets here the trade idea is wrong — exit. Put it below support, not inside it.'), attrs:`type="number" step="any" placeholder="${eg('215')}" value="${v('stop')}" oninput="planPreview()"` })}
            ${fld({ id:'pf-tgt', label:L('第一目标','Target'), req:true, dot:'tgt', prefix:'$', tip:L('第一个止盈位，通常是上方最近的压力区。','First profit-taking level, usually the nearest resistance above.'), attrs:`type="number" step="any" placeholder="${eg('260')}" value="${v('target')}" oninput="planPreview()"` })}
          </div>
        </div>
        <details class="f2-more" ${p && p.risk ? 'open' : ''}>
          <summary><span class="f2-sec-t" style="margin:0;"><span>3</span>${L('仓位与有效期','Size & timing')}</span><em id="pfMoreSum"></em><span class="f-opt">${L('选填','optional')}</span></summary>
          <div class="f2-row3" style="margin-top:12px;">
            ${fld({ id:'pf-risk', label:L('本笔风险','Risk on this trade'), prefix:'$', tip:L('这一笔打到止损价最多亏多少。留空就用设置里的默认值。','The most this trade may lose at its stop. Blank = the default from Settings.'), attrs:`type="number" step="any" placeholder="${r != null ? L('默认 ','default ') + fmt(r,0) : L('未设默认','no default set')}" value="${v('risk')}" oninput="planPreview()"` })}
            ${fld({ label:L('分几批买','Tranches'), tip:L('在关注区间里平均分几次买入。分批能拿到更好的均价。','How many buys to spread across the zone. Scaling in gives a better average.'),
                body:`<input type="hidden" id="pf-n" value="${n}"><div class="seg">${[1,2,3].map(k => `<button type="button" class="${k==n?'on':''}" onclick="document.getElementById('pf-n').value=${k}; this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on')); this.classList.add('on'); planPreview();">${k}</button>`).join('')}</div>` })}
            ${fld({ id:'pf-exp', label:L('有效期至','Valid until'), tip:L('过了这天还没执行，计划自动标成过期，提醒你重新评估。','If not executed by this date, the plan is flagged as expired so you re-evaluate.'), attrs:`type="date" value="${v('expiry', addDays(todayISO(), 30))}" onchange="planPreview()"` })}
          </div>
          <input type="hidden" id="pf-note" value="${esc(v('note'))}">
        </details>
      </div>
      <div class="f2-side"><div class="f2-prev-t">${L('预览','Preview')}</div><div id="pfPreview"></div></div>
    </div>
  </div>`;
}

function readPlanForm(){
  const sym = (document.getElementById('pf-sym').value || '').trim().toUpperCase();
  let lo = num(document.getElementById('pf-lo').value), hi = num(document.getElementById('pf-hi').value);
  if(lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  if(lo != null && hi == null) hi = lo;
  if(hi != null && lo == null) lo = hi;
  return { sym, lo, hi, stop: num(document.getElementById('pf-stop').value), target: num(document.getElementById('pf-tgt').value),
    risk: document.getElementById('pf-risk').value, tranches: +document.getElementById('pf-n').value || 1,
    expiry: document.getElementById('pf-exp').value || addDays(todayISO(), 30), note: document.getElementById('pf-note').value.trim() };
}

function planPreview(){
  const el = document.getElementById('pfPreview'); if(!el) return;
  const f = readPlanForm();
  const sum = document.getElementById('pfMoreSum');
  if(sum){
    const r = num(f.risk) ?? riskSetting();
    sum.textContent = [r != null ? L(`风险 $${fmt(r,0)}`, `risk $${fmt(r,0)}`) : L('风险未设','no risk set'), L(`${f.tranches} 批`, `${f.tranches} tranche${f.tranches>1?'s':''}`), L(`有效 ${Math.max(0, daysBetween(todayISO(), f.expiry))} 天`, `${Math.max(0, daysBetween(todayISO(), f.expiry))} days`)].join(' · ');
  }
  const missing = [!f.sym && L('代码','symbol'), f.lo == null && L('关注区间','zone'), f.stop == null && L('止损价','stop'), f.target == null && L('目标','target')].filter(Boolean);
  if(missing.length){
    el.innerHTML = `<div class="f2-wait"><div class="f2-wait-bar"><i class="r"></i><i class="g"></i></div>${L('还差：','Still needed: ')}<b>${missing.join(L('、',', '))}</b><br><span>${L('填好后这里会画出风险和收益，并算出该买几股。','Once filled, risk vs reward is drawn here with a suggested size.')}</span></div>`;
    return;
  }
  const p = { ...f, id:'_preview', createdAt: todayISO() };
  const c = planCalc(p, holdingsNow());
  const bad = c.warns.find(w => w.c === 'err');
  el.innerHTML = `${bad ? '' : rulerHtml(p, c, true)}
    <div class="f2-kpis">
      <div><span>${term('rr')}</span><b class="${c.rrMid==null?'':c.rrMid>=2?'gain-t':c.rrMid<1?'loss-t':''}">${c.rrMid != null ? fmt(c.rrMid,2) : '—'}</b></div>
      <div><span>${L('建议股数','Shares')}</span><b>${c.shares != null ? fmt(c.shares,0) : '—'}</b></div>
      <div><span>${L('约需资金','Capital')}</span><b>${c.shares != null ? '$'+fmt(c.shares*c.mid,0) : '—'}</b></div>
    </div>
    ${c.warns.filter(w => w.c !== 'info').length ? `<div class="pc-alert" style="margin-top:10px;">${c.warns.filter(w => w.c !== 'info').map(w => `<div class="${w.c}">${w.t}</div>`).join('')}</div>` : ''}`;
}

function openPlanForm(){ planFormOpen = true; planEditId = null; const ps = document.getElementById('plansSection'); if(ps) ps.querySelectorAll('.plan-form').forEach(f => f.remove()); renderPlans(); setTimeout(()=>{ const s=document.getElementById('pf-sym'); if(s) s.focus(); planPreview(); }, 0); }
function closePlanForm(){ planFormOpen = false; planEditId = null; renderPlans(); }
function editPlan(id){ planFormOpen = true; planEditId = id; const ps = document.getElementById('plansSection'); if(ps) ps.querySelectorAll('.plan-form').forEach(f => f.remove()); renderPlans(); planPreview(); document.getElementById('plansSection').scrollIntoView({behavior:'smooth', block:'start'}); }

function savePlan(){
  const f = readPlanForm();
  if(!f.sym || f.lo == null || f.stop == null || f.target == null){ alert(L('代码、关注区间、止损价、目标都要填','Symbol, zone, stop and target are all required')); return; }
  if(planEditId){
    const p = plans.find(x => x.id === planEditId);
    Object.assign(p, { lo:f.lo, hi:f.hi, stop:f.stop, target:f.target, risk:f.risk, tranches:f.tranches, expiry:f.expiry, note:f.note, editedAt: todayISO() });
  } else {
    plans.unshift({ id:'pl'+Date.now(), sym:f.sym, lo:f.lo, hi:f.hi, stop:f.stop, target:f.target, risk:f.risk, tranches:f.tranches,
      expiry:f.expiry, note:f.note, createdAt: todayISO(), createdPrice: getPrice(f.sym),
      orig:{ lo:f.lo, hi:f.hi, stop:f.stop, target:f.target } });
  }
  savePlans();
  planFormOpen = false; planEditId = null;
  renderLoop2();
  if(getPrice(f.sym) == null && /\S/.test(finnhubKey)) refreshAllPrices(true);
}
function closePlan(id, reason){
  const p = plans.find(x => x.id === id); if(!p) return;
  // no menu: stopped / target / expired are read off where the plan stands right now
  if(!reason) reason = { stopHit:'stop', targetHit:'target', expired:'expired' }[planCalc(p, holdingsNow()).state] || 'manual';
  p.closedAt = todayISO(); p.closeReason = reason;
  savePlans(); renderLoop2();
}
function reopenPlan(id){ const p = plans.find(x => x.id === id); if(!p) return; delete p.closedAt; delete p.closeReason; savePlans(); renderLoop2(); }
function deletePlan(id){
  if(!confirm(L('删除这个计划？复盘里它的对账记录也会跟着消失。','Delete this plan? Its reconciliation history goes with it.'))) return;
  plans = plans.filter(x => x.id !== id); savePlans(); renderLoop2();
}
function toggleFillTag(tradeId, wasIn){ fillTags[tradeId] = wasIn ? 'out' : 'in'; saveTags(); renderLoop2(); }

function renderPlans(){
  const el = document.getElementById('plansSection'); if(!el) return;
  const H = holdingsNow();
  const act = activePlans().slice().sort((a,b) => {
    const order = { stopHit:0, targetHit:1, inZone:2, exec:3, expired:4, below:5, waiting:6, noprice:7 };
    return (order[planCalc(a,H).state] ?? 9) - (order[planCalc(b,H).state] ?? 9);
  });
  const closed = plans.filter(p => p.closedAt).sort((a,b) => d10(b.closedAt) < d10(a.closedAt) ? -1 : 1);
  // keep whatever was typed into an open form across re-renders (e.g. after saving settings)
  const draft = {}; el.querySelectorAll('.plan-form input[id]').forEach(i => { draft[i.id] = i.value; });
  const moreOpen = !!el.querySelector('.f2-more[open]');
  el.innerHTML = `
    <div class="sec-head">
      <span class="badge"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg></span>
      <h2>${L('交易计划','Trade plans')}</h2><span class="count">${act.length}</span>${pageHelp('plans')}
      <div class="grow">
        <button class="btn-ghost btn-small" onclick="refreshAllPrices()">${L('刷新股价','Refresh prices')}</button>
        <button class="btn-ghost btn-small" onclick="openPlanForm()">${L('+ 添加','+ Add')}</button>
      </div>
    </div>
    ${planFormOpen ? planFormHtml() : ''}
    ${act.length ? `<div class="plan-list">${act.map(p => planCardHtml(p, H)).join('')}</div>`
      : (planFormOpen ? '' : stepsCard(L('建第一个交易计划','Create your first trade plan'), [
          L(`选一只想买的票，定一个<b>${term('zone')}</b>：通常是最近的支撑区。`, `Pick a stock and set a <b>${term('zone')}</b> — usually the nearest support.`),
          L(`定<b>${term('stop')}</b>（跌破就说明看错了）和<b>目标</b>。`, `Set a <b>${term('stop')}</b> (where you are wrong) and a <b>target</b>.`),
          L(`看<b>${term('rr')}</b>和建议股数，满意了再保存。只保存计划，不会下单。`, `Check <b>${term('rr')}</b> and the suggested size, then save. Saving never places an order.`),
        ], `<button class="btn-ghost btn-small" onclick="openPlanForm()">${L('+ 添加','+ Add')}</button>${num(cfg.risk) == null ? `<button class="btn-ghost btn-small" onclick="openSettings()">${L('先设每笔风险','Set risk per trade first')}</button>` : ''}`))}
    ${closed.length ? `<details class="fold closed-list"><summary>${L('已结束的计划','Closed plans')} · ${closed.length}</summary><div class="plan-list" style="margin-top:8px;">${closed.map(p => planCardHtml(p, H)).join('')}</div></details>` : ''}
  `;
  if(planFormOpen){
    Object.entries(draft).forEach(([id, v]) => { const i = document.getElementById(id); if(i && !i.disabled) i.value = v; });
    if(draft['pf-n']) document.querySelectorAll('.plan-form .seg button').forEach(b => b.classList.toggle('on', b.textContent.trim() === draft['pf-n']));
    if(moreOpen){ const m = el.querySelector('.f2-more'); if(m) m.open = true; }
    planPreview();
  }
}

// ---------- prices ----------
async function refreshAllPrices(silent){
  if(!/\S/.test(finnhubKey)){
    if(silent) return;
    const k = (prompt(L('输入你的 Finnhub API key（finnhub.io 免费注册）：','Enter your Finnhub API key (free at finnhub.io):'), '') || '').trim();
    if(!k) return;
    finnhubKey = k; try{ await window.storage.set(FINNHUB_KEY, k); }catch(e){}
  }
  const held = holdingsNow().list.map(h => h.sym);
  const syms = [...new Set(held.concat(activePlans().map(p => p.sym)))];
  if(!syms.length) return;
  document.querySelectorAll('[data-refresh]').forEach(b => { b.disabled = true; });
  const failed = [];
  for(const sym of syms){
    try{
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(finnhubKey)}`);
      if(!r.ok){ failed.push(sym); continue; }
      const d = await r.json();
      if(d && typeof d.c === 'number' && d.c > 0){
        quotes.q[sym] = { p:d.c, pc:d.pc };
        if(held.includes(sym)) (posMeta[sym] || (posMeta[sym] = {})).price = d.c;
      } else failed.push(sym);
    }catch(e){ failed.push(sym); }
  }
  quotes.at = Date.now();
  await Promise.all([saveQuotes(), savePosMeta()]);
  if(failed.length && !silent) alert(L(`这些代码没拿到报价：${failed.join(' ')}`, `No quote for: ${failed.join(' ')}`));
  render();
}

// ---------- positions: risk ----------
function riskModel(){
  const H = holdingsNow();
  const rows = H.list.map(h => {
    const plan = activePlans().find(p => p.sym === h.sym);
    const manual = num(cfg.stops[h.sym]);
    const stop = manual ?? (plan ? plan.stop : null);
    const trig = stop != null && h.qty > 0 ? Math.min(0, (stop - h.last) * h.qty) : null;
    return { ...h, w: H.total > 0 ? h.mv / H.total * 100 : 0, sector: sectorOf(h.sym), beta: betaOf(h.sym), betaSet: num(cfg.betas[h.sym]) != null, betaAuto: typeof packBeta === 'function' ? packBeta(h.sym) : null,
      stop, stopFromPlan: manual == null && plan != null, trig, er: nextEarnings(h.sym) };
  });
  const sectors = {};
  rows.forEach(r => { sectors[r.sector] = (sectors[r.sector] || 0) + r.mv; });
  const secW = Object.entries(sectors).map(([s, mv]) => ({ s, w: H.total > 0 ? mv / H.total * 100 : 0 })).sort((a,b)=> b.w - a.w);
  const beta = H.stockMV > 0 ? rows.reduce((s,r)=> s + r.beta * r.mv, 0) / H.total : 0;   // beta of the whole account (cash = 0)
  const trigTotal = rows.reduce((s,r)=> s + (r.trig || 0), 0);
  const noStop = rows.filter(r => r.stop == null && r.qty > 0).map(r => r.sym);
  return { H, rows, secW, beta, trigTotal, noStop, betaMissing: rows.filter(r => !r.betaSet && r.betaAuto == null).map(r => r.sym) };
}

function setRiskField(kind, sym, value){
  const v = String(value || '').trim();
  if(v === '') delete cfg[kind][sym]; else cfg[kind][sym] = kind === 'sectors' ? v : value;
  saveCfg(); render();
}

function renderRisk(){
  const top = document.getElementById('riskTop'), sec = document.getElementById('riskSection');
  if(!top || !sec) return;
  const M = riskModel();
  if(!M.rows.length){
    top.innerHTML = stepsCard(L('还没有持仓','No positions yet'), [
      L('到「复盘 → 交易明细」导入 IBKR 对账单，持仓会自动算出来。也可以点上面的「+ 添加」手动加。','Import an IBKR statement under Review → Trades and positions are computed for you. Or add one by hand with "+ Add" above.'),
      L(`给每只票填<b>${term('stop')}</b>，看全部打到止损价一共会亏多少。`, `Give each holding a <b>${term('stop')}</b> to see the total loss if every stop is hit.`),
      L('在设置里填单票和板块上限，超了才会提醒你。','Set single-stock and sector limits in Settings — you are only warned when one is exceeded.'),
    ], `<button class="btn-ghost btn-small" onclick="switchTab('ledger'); openAddPanel();">${L('+ 添加','+ Add')}</button>`);
    sec.innerHTML = ''; return;
  }
  const big = M.rows[0];
  const goal = parseGoal(cfg.weekTarget);
  const weeks = goal && M.trigTotal < 0 ? Math.abs(M.trigTotal) / ((goal.min + goal.max) / 2) : null;
  const cashPct = M.H.total > 0 ? M.H.cashUSD / M.H.total * 100 : 0;
  const alerts = [
    ...M.rows.filter(r => r.w > cfg.maxSingle).map(r => L(`${r.sym} 占总资产 ${pct(r.w,0)}，超过单票上限 ${cfg.maxSingle}%`, `${r.sym} is ${pct(r.w,0)} of the account, above the ${cfg.maxSingle}% limit`)),
    ...M.secW.filter(s => s.w > cfg.maxSector).map(s => L(`「${s.s}」板块占 ${pct(s.w,0)}，超过板块上限 ${cfg.maxSector}%`, `${secName(s.s)} sector is ${pct(s.w,0)}, above the ${cfg.maxSector}% limit`)),
  ];
  const stress = [5, 10, 20].map(x => ({ x, v: -M.H.total * M.beta * x / 100 }));
  top.innerHTML = `
    <div class="pc-stats big-stats">
      <div class="pc-stat"><div class="k">${L('总资产','Account')}</div><div class="v">$${fmt(M.H.total,0)}</div><div class="s">${L('现金','cash')} ${pct(cashPct)} · $${fmt(M.H.cashUSD,0)}</div></div>
      <div class="pc-stat"><div class="k">${L('最大单票','Largest')}</div><div class="v ${big.w > cfg.maxSingle ? 'loss-t' : ''}">${big.sym} ${pct(big.w,0)}</div>
        <div class="limbar"><i class="${big.w > cfg.maxSingle ? 'over' : ''}" style="width:${Math.min(100, big.w)}%"></i><b style="left:${cfg.maxSingle}%"></b></div><div class="s">${L('上限','limit')} ${cfg.maxSingle}%</div></div>
      <div class="pc-stat"><div class="k">${term('beta', L('组合 Beta','Beta'))}</div><div class="v">${fmt(M.beta,2)}</div><div class="s">${M.betaMissing.length ? L(`${M.betaMissing.length} 只没有数据，按 1 计`, `${M.betaMissing.length} without data, counted as 1`) : M.rows.some(r => r.betaAuto != null && !r.betaSet) ? L('近 120 天对 SPY 自动算','auto: 120 days vs SPY') : L('按市值加权','value-weighted')}</div></div>
      <div class="pc-stat"><div class="k">${term('trig', L('全部触发亏损','Loss if all stops hit'))}</div><div class="v ${M.trigTotal < 0 ? 'loss-t' : ''}">${M.trigTotal < 0 ? money(M.trigTotal) : '$0'}</div><div class="s">${weeks != null ? L(`≈ ${fmt(weeks,1)} 周的目标`, `≈ ${fmt(weeks,1)} weeks of target`) : ''}${M.noStop.length ? (weeks != null ? ' · ' : '') + L(`${M.noStop.length} 只没设止损价`, `${M.noStop.length} without a stop`) : ''}</div></div>
    </div>
    ${alerts.length ? `<div class="pc-alert" style="margin:12px 0 0;">${alerts.map(a => `<div class="err">${a}</div>`).join('')}</div>` : ''}
    <div class="risk-duo">
      <div class="duo-card">
        <div class="duo-h">${L('板块集中度','Sector concentration')}<span>${L('竖线 = 上限','line = limit')} ${cfg.maxSector}%</span></div>
        ${M.secW.map(s => `<div class="sec-row"><span class="nm">${esc(secName(s.s))}</span><div class="limbar"><i class="${s.w > cfg.maxSector ? 'over' : ''}" style="width:${Math.min(100, s.w)}%"></i><b style="left:${cfg.maxSector}%"></b></div><span class="pv ${s.w > cfg.maxSector ? 'loss-t' : ''}">${pct(s.w,0)}</span></div>`).join('')}
      </div>
      <div class="duo-card">
        <div class="duo-h">${L('大盘下跌时','If SPY falls')}<span>${L('按组合 Beta 换算，量级参考','scaled by beta, rough magnitude')}</span></div>
        <div class="stress">${stress.map(s => `<div class="st-cell" style="--a:${Math.min(1, 0.25 + s.x/28)}"><div class="st-x">SPY −${s.x}%</div><div class="st-v">${money(s.v)}</div><div class="st-s">${goal ? L(`≈ ${fmt(Math.abs(s.v)/((goal.min+goal.max)/2),1)} 周目标`, `≈ ${fmt(Math.abs(s.v)/((goal.min+goal.max)/2),1)} wks`) : ''}</div></div>`).join('')}</div>
      </div>
    </div>`;

  const sectorNames = [...new Set(Object.values(SECTORS).concat(Object.values(cfg.sectors)))];
  const maxTrig = Math.max(1, ...M.rows.map(r => Math.abs(r.trig || 0)));
  sec.innerHTML = `
    <div class="sec-head">
      <span class="badge"><svg class="i" viewBox="0 0 24 24"><path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z"/></svg></span>
      <h2>${L('每只股票的风险','Risk per stock')}</h2>${pageHelp('risk')}
      <div class="grow muted" style="font-size:12px;">${L('跌到止损价会亏多少','what you lose if each hits its stop')}</div>
    </div>
    <datalist id="sectorList">${sectorNames.map(s => `<option value="${esc(secName(s))}">`).join('')}</datalist>
    <div class="rk2-list">
      ${M.rows.map(r => {
        const over = r.w > cfg.maxSingle;
        const erD = r.er ? daysBetween(todayISO(), r.er) : null;
        const dist = r.stop != null && r.last > 0 ? (1 - r.stop / r.last) * 100 : null;
        return `<div class="rk2">
          <div class="rk2-id"><b>${r.sym}</b><span class="tag">${esc(secName(r.sector))}</span></div>
          <div class="rk2-mid">
            <div class="rk2-line">${L('占账户','Weight')} <b class="${over?'loss-t':''}">${pct(r.w,0)}</b>
              <span class="rk2-bar"><i class="${over?'over':''}" style="width:${Math.min(100, r.w / Math.max(cfg.maxSingle, r.w) * 100)}%"></i></span>
              <span class="${over?'loss-t':'muted'}">${over ? L(`超过 ${cfg.maxSingle}% 上限`, `over the ${cfg.maxSingle}% limit`) : L(`上限 ${cfg.maxSingle}%`, `limit ${cfg.maxSingle}%`)}</span></div>
            <div class="rk2-line">${L('止损价','Stop')} <span class="rk2-in">$<input type="number" step="any" class="rk-edit ${r.stop == null ? 'need' : ''}" placeholder="${r.stopFromPlan ? fmt(r.stop) : L('设置','set')}" value="${num(cfg.stops[r.sym]) ?? ''}" onchange="setRiskField('stops','${r.sym}',this.value)" title="${r.stopFromPlan ? L('来自你的计划，可以改','from your plan — editable') : ''}"></span>
              ${dist != null ? `<span class="muted">${L(`比现价低 ${fmt(dist,1)}%`, `${fmt(dist,1)}% below price`)}${r.stopFromPlan ? L(' · 来自计划',' · from plan') : ''}</span>` : `<span class="muted">${L('还没设，设了才知道最多亏多少','not set yet')}</span>`}
              ${r.er ? `<span class="tag rk2-er ${erD <= 7 ? 'soon' : ''}">${md(r.er)} ${L('财报','earnings')}</span>` : ''}</div>
          </div>
          <div class="rk2-loss">${r.trig != null ? `<span>${L('跌到止损价会亏','loss at stop')}</span><b>${money(r.trig)}</b>` : `<span>${L('最多会亏','max loss')}</span><b class="muted">?</b>`}</div>
        </div>`;
      }).join('')}
    </div>
    <details class="fold" style="margin-top:12px;"><summary>${L('调整 Beta（默认按数据包近 120 天对 SPY 自动算；没有数据按 1）','Adjust beta (default: 120 days vs SPY from the data pack; else 1)')}</summary>
      <div class="beta-row">${M.rows.map(r => `<label><b>${r.sym}</b><input type="number" step="any" class="rk-edit" placeholder="${r.betaAuto != null ? fmt(r.betaAuto,2) : '1.0'}" value="${r.betaSet ? cfg.betas[r.sym] : ''}" onchange="setRiskField('betas','${r.sym}',this.value)"></label>`).join('')}</div>
    </details>`;
}

// ---------- today ----------
function weekRealized(){
  const wk = isoWeekKey(localDate(todayISO()));
  return runFIFO(AT(), 'LIFO').closed.filter(c => isoWeekKey(localDate(c.date)) === wk).reduce((s,c)=> s + c.pnl, 0);
}

function todayItems(){
  const items = [];
  const H = holdingsNow();
  const today = todayISO();
  const go = (tab) => `switchTab('${tab}')`;
  for(const p of activePlans()){
    const c = planCalc(p, H);
    const px = c.price != null ? '$'+fmt(c.price) : '';
    if(c.state === 'stopHit') items.push({ p, c, grp:'plan', key:`stop:${p.id}`, pr:1, title:L(`${p.sym} 跌到止损价 ${fmt(p.stop)}（现价 ${px}）`, `${p.sym} hit its stop ${fmt(p.stop)} (now ${px})`), sub:L('按计划离场，或把计划标记为「止损」结束','Exit per plan, or close the plan as stopped'), go:go('watchlist') });
    if(c.state === 'targetHit') items.push({ p, c, grp:'plan', key:`tgt:${p.id}`, pr:1, title:L(`${p.sym} 到达目标 ${fmt(p.target)}（现价 ${px}）`, `${p.sym} reached its target ${fmt(p.target)} (now ${px})`), sub:L('决定止盈还是上移止损','Take profit or trail the stop'), go:go('watchlist') });
    if(c.state === 'inZone') items.push({ p, c, grp:'plan', key:`zone:${p.id}`, pr:2, title:L(`${p.sym} 进入关注区 ${fmt(p.lo)}–${fmt(p.hi)}（现价 ${px}）`, `${p.sym} is in its zone ${fmt(p.lo)}–${fmt(p.hi)} (now ${px})`),
      sub: c.shares != null ? L(`计划 ${fmt(c.shares,0)} 股 · 第 1 批 ${fmt(c.trPx[0])} × ${fmt(c.trQty[0],0)} · 盈亏比 ${c.rrNow != null ? fmt(c.rrNow,2) : '—'}`, `Plan ${fmt(c.shares,0)} sh · tranche 1 ${fmt(c.trPx[0])} × ${fmt(c.trQty[0],0)} · R:R ${c.rrNow != null ? fmt(c.rrNow,2) : '—'}`) : L('先在设置里填每笔风险金额，才能算股数','Set a risk amount in Settings to size it'), go:go('watchlist') });
    if(c.state === 'expired') items.push({ p, c, grp:'plan', key:`exp:${p.id}`, pr:7, title:L(`${p.sym} 计划已过期（${md(p.expiry)}）`, `${p.sym} plan expired (${md(p.expiry)})`), sub:L('结束它，或改有效期继续','Close it, or extend the date'), go:go('watchlist') });
    else if(d10(p.expiry) >= today && daysBetween(today, p.expiry) <= 3 && c.bought === 0) items.push({ p, c, grp:'plan', key:`soon:${p.id}:${p.expiry}`, pr:7, title:L(`${p.sym} 计划 ${daysBetween(today, p.expiry)} 天后到期，还没执行`, `${p.sym} plan expires in ${daysBetween(today, p.expiry)} days, not executed`), sub:L('想清楚要不要续','Decide whether to extend'), go:go('watchlist') });
  }
  for(const h of H.list){
    const er = earningsBetween(h.sym, today, addDays(today, 7))[0];
    if(er) items.push({ grp:'risk', key:`er:${h.sym}:${er}`, pr:3, title:L(`${h.sym} ${md(er)} 发财报（${daysBetween(today, er) === 0 ? '今天' : daysBetween(today, er)+' 天后'}）`, `${h.sym} reports ${md(er)} (${daysBetween(today, er) === 0 ? 'today' : 'in '+daysBetween(today, er)+'d'})`),
      sub:L(`持仓市值 $${fmt(h.mv,0)} · 想好财报前减不减`, `Position $${fmt(h.mv,0)} · decide before, not after`), go:go('positions') });
  }
  const M = riskModel();
  M.rows.filter(r => r.w > cfg.maxSingle).forEach(r => items.push({ grp:'risk', key:`lim:${r.sym}`, pr:4, title:L(`${r.sym} 占 ${pct(r.w,0)}，超过单票上限 ${cfg.maxSingle}%`, `${r.sym} is ${pct(r.w,0)}, above the ${cfg.maxSingle}% limit`), sub:L('提醒现状，不代表必须减仓','A status check, not an order to sell'), go:go('positions') }));
  M.secW.filter(s => s.w > cfg.maxSector).forEach(s => items.push({ grp:'risk', key:`slim:${s.s}`, pr:4, title:L(`「${s.s}」板块占 ${pct(s.w,0)}，超过板块上限 ${cfg.maxSector}%`, `${secName(s.s)} sector is ${pct(s.w,0)}, above the ${cfg.maxSector}% limit`), sub:'', go:go('positions') }));
  for(const k of [today, addDays(today, 1)]){
    for(const ev of calendarEvents[k] || []){
      if(ev.category !== 'macro') continue;
      items.push({ grp:'event', key:`mac:${k}:${ev.text}`, pr:6, title:`${k === today ? L('今天','Today') : L('明天','Tomorrow')} · ${esc(ev.text)}`, sub: ev.plan ? esc(ev.plan) : L('重要宏观数据，当天避免冲动加仓','Major macro print — avoid impulse adds that day'), go:go('calendar') });
    }
  }
  const dis = todayState.dismiss;
  return items.filter(i => !(dis[i.key] && dis[i.key] > today)).sort((a,b) => a.pr - b.pr);
}

let lastTodayItems = [];
function dismissIdx(idx, days, action){
  const i = lastTodayItems[idx]; if(!i) return;
  const tmp = document.createElement('div'); tmp.innerHTML = i.title;
  dismissToday(i.key, days, action, tmp.textContent);
}
function dismissToday(key, days, action, title){
  todayState.dismiss[key] = addDays(todayISO(), days);
  if(action === 'done'){ todayState.log.unshift({ date: todayISO(), key, title }); todayState.log = todayState.log.slice(0, 200); }
  saveToday(); renderToday();
}

function miniBar(p, price){
  const vals = [p.stop, p.lo, p.hi, p.target, price];
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const X = v => ((v - lo) / (hi - lo) * 100).toFixed(1) + '%';
  const mid = (p.lo + p.hi) / 2;
  return `<div class="mbar" title="${L('止损','stop')} ${fmt(p.stop)} · ${L('关注区','zone')} ${fmt(p.lo)}–${fmt(p.hi)} · ${L('目标','target')} ${fmt(p.target)}">
    <i class="r" style="left:${X(p.stop)}; width:calc(${X(mid)} - ${X(p.stop)})"></i><i class="g" style="left:${X(mid)}; width:calc(${X(p.target)} - ${X(mid)})"></i>
    <i class="z" style="left:${X(p.lo)}; width:calc(${X(p.hi)} - ${X(p.lo)})"></i><i class="n" style="left:${X(price)}"></i></div>`;
}

function renderToday(){
  const el = document.getElementById('todayView'); if(!el) return;
  const items = todayItems();
  lastTodayItems = items;
  const badge = document.getElementById('todayBadge'); if(badge){ badge.textContent = items.length; badge.hidden = !items.length; }
  const goal = parseGoal(cfg.weekTarget);
  const wr = weekRealized();
  const act = activePlans();
  const H = holdingsNow();
  const inZoneN = act.filter(p => planCalc(p, H).state === 'inZone').length;
  const urgent = items.filter(i => i.pr <= 2).length;
  const ageMin = quotes.at ? Math.round((Date.now() - quotes.at) / 60000) : null;
  const stale = ageMin == null || ageMin > 24*60;
  const goalPct = goal ? Math.max(0, Math.min(100, wr / goal.min * 100)) : 0;
  const stats = `<div class="pc-stats big-stats">
    <div class="pc-stat"><div class="k">${L('本周已实现','This week')}</div><div class="v ${wr>=0?'gain-t':'loss-t'}">${money(wr)}</div>
      ${goal ? `<div class="mini"><i style="width:${goalPct}%; background:var(--gain)"></i></div><div class="s">${L('目标','target')} $${fmt(goal.min,0)}${goal.max!==goal.min?'–'+fmt(goal.max,0):''} · ${fmt(wr/goal.min*100,0)}%</div>` : `<div class="s">${L('在设置里填周目标','set a weekly target in Settings')}</div>`}</div>
    <div class="pc-stat"><div class="k">${L('待处理','To do')}</div><div class="v">${items.length}</div><div class="s">${urgent ? L(`其中 ${urgent} 项和价格有关`, `${urgent} price-triggered`) : L('没有紧急的','nothing urgent')}</div></div>
    <div class="pc-stat"><div class="k">${L('进行中的计划','Active plans')}</div><div class="v">${act.length}</div><div class="s">${inZoneN ? L(`${inZoneN} 只在关注区`, `${inZoneN} in zone`) : L('都还没到价位','none at their levels')}</div></div>
    <div class="pc-stat"><div class="k">${L('股价时点','Prices as of')}</div><div class="v ${stale?'loss-t':''}">${quotes.at ? new Date(quotes.at).toTimeString().slice(0,5) : '—'}</div><div class="s">${ageMin == null ? L('还没刷新过','never refreshed') : ageMin < 60 ? ageMin + L(' 分钟前',' min ago') : Math.round(ageMin/60) + L(' 小时前','h ago')} · <a class="lnk" data-refresh onclick="refreshAllPrices()">${L('刷新','refresh')}</a></div></div>
  </div>`;
  const groups = [
    { id:'plan', t:L('计划','Plans'), d:L('价位触发','price-triggered') },
    { id:'risk', t:L('持仓与风险','Positions & risk'), d:L('财报、仓位上限','earnings, limits') },
    { id:'event', t:L('日程','Schedule'), d:L('今明两天','today & tomorrow') },
  ];
  const row = (i) => { const idx = items.indexOf(i);
    const ico = { stop:'🛑', tgt:'🎯', zone:'📍', exp:'⏳', soon:'⏳', er:'📊', lim:'⚖️', slim:'⚖️', mac:'🏛️', ins:'🕴️' }[i.key.split(':')[0]] || '•';
    return `<div class="t-item g-${i.grp} p${i.pr}">
      <span class="t-ico">${ico}</span>
      <div class="t-main"><div class="t-title">${i.title}</div>${i.sub ? `<div class="t-sub">${i.sub}</div>` : ''}</div>
      ${i.p && i.c && i.c.price != null ? miniBar(i.p, i.c.price) : '<span></span>'}
      <div class="t-acts">
        <button class="btn-ghost btn-small" onclick="${i.go}">${L('查看','Open')}</button>
        <button class="icon-btn pc-x" aria-label="${L('已处理','Done')}" onclick="dismissIdx(${idx}, 7, 'done')">✕</button>
      </div></div>`; };
  const welcome = !trades.length && !plans.length && cfg.onboardHidden
    ? `<div class="t-list"><div class="t-done"><b>${L('从这里开始','Start here')}</b>${L('先去「复盘 → 交易明细」导入 IBKR 对账单，再到「自选」建第一个计划。之后每天打开 LOOP，这里只列需要你处理的事。','Import an IBKR statement under Review → Trades, then create your first plan under Watchlist. After that this page only lists what needs you.')}</div></div>` : '';
  const body = welcome || (items.length
    ? groups.map(g => { const list = items.filter(i => i.grp === g.id); return list.length ? `<div class="t-group"><div class="t-gh"><b>${g.t}</b><span>${list.length} · ${g.d}</span></div><div class="t-list">${list.map(row).join('')}</div></div>` : ''; }).join('')
    : `<div class="t-list"><div class="t-done"><b>${L('今天没有需要处理的事','Nothing needs you today')}</b>${L('计划都没到价位，持仓没超上限，近期没有财报和重要宏观事件。','No plan is at its levels, no limit is breached, no earnings or major macro ahead.')}</div></div>`);
  const ob = onboardHtml();
  const bare = ob && !trades.length && !plans.length;
  el.innerHTML = `<div class="today-date">${new Date().toLocaleDateString(lang==='zh'?'zh-CN':'en-US', {weekday:'long', month:'long', day:'numeric'})}${pageHelp('today')}</div>${ob}${bare ? '' : stats + body}`;
}

// ---------- review: plan reconciliation ----------
function classifyBuy(t){
  const date = d10(t.date);
  const covering = plans.filter(p => p.sym === t.sym && planCovers(p, date));
  const auto = covering.some(p => inZone(p, t.price));
  const tag = fillTags[t.id];
  return { inPlan: tag ? tag === 'in' : auto, hasPlan: covering.length > 0, tagged: !!tag };
}

function renderPlanReview(){
  const el = document.getElementById('planReview'); if(!el) return;
  const head = `<div class="sec-head"><span class="badge"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg></span>
    <h2>${L('按计划 vs 计划外','Plan vs off-plan')}</h2>${pageHelp('review')}</div>`;
  const since = plans.length ? plans.map(p => d10(p.createdAt)).sort()[0] : null;
  const all = AT();
  const buys = since ? all.filter(t => t.side === 'BUY' && d10(t.date) >= since).sort((a,b) => d10(b.date) < d10(a.date) ? -1 : 1) : [];
  const cls = {}; buys.forEach(t => cls[t.id] = classifyBuy(t));
  const agg = { in:{pnl:0, n:0, win:0}, out:{pnl:0, n:0, win:0} };
  if(since) for(const c of runFIFO(all, 'LIFO').closed){
    if(c.side !== 'SELL') continue;
    const per = { in:0, out:0 }, has = { in:false, out:false };
    for(const m of c.matched){
      if(m.wasShort) continue;
      const buy = all.find(t => t.side === 'BUY' && t.sym === c.sym && d10(t.date) === d10(m.date) && Math.abs(t.price - m.unitCost) < 1e-6);
      if(!buy || d10(buy.date) < since) continue;
      const k = classifyBuy(buy).inPlan ? 'in' : 'out';
      per[k] += (c.price - m.unitCost) * m.qty - (c.comm || 0) * (m.qty / c.qty);
      has[k] = true;
    }
    for(const k of ['in','out']) if(has[k]){ agg[k].pnl += per[k]; agg[k].n++; if(per[k] > 0) agg[k].win++; }
  }
  const nIn = buys.filter(t => cls[t.id].inPlan).length;
  const buyList = buys.length ? `<details class="fold" style="margin-top:14px;"><summary>${L('买入记录','Buys')} · ${buys.length} · ${L('标错了点标签切换','tap a tag to fix it')}</summary><div class="rk-table" style="margin-top:8px;">${buys.slice(0, 60).map(t => { const k = cls[t.id]; return `<div class="bt-row">
      <span class="mono muted">${d10(t.date)}</span><b>${t.sym}</b><span class="mono">${fmt(t.qty,0)} @ ${fmt(t.price)}${!k.hasPlan && !k.tagged ? `<span class="muted"> · ${L('当时没有计划','no plan then')}</span>` : ''}</span>
      <span class="fill-chip ${k.inPlan?'in':'out'}" onclick="toggleFillTag('${t.id}', ${k.inPlan})">${k.inPlan?L('计划内','in plan'):L('计划外','off plan')}</span></div>`; }).join('')}</div></details>` : '';

  // not enough data yet: one sentence + an example, no wall of zeros
  if(agg.in.n + agg.out.n === 0){
    const status = !plans.length ? L('你还没有建过计划。','You have no plans yet.')
      : !buys.length ? L('还没有按计划买入，卖出后这里会对比计划内和计划外的盈亏。', 'No buys since your plans yet — once trades close, in-plan vs off-plan P&L shows here.')
      : L(`${buys.length} 笔买入（${nIn} 笔在计划内），卖出后显示结果。`, `${buys.length} buys (${nIn} in plan) — results once sold.`);
    el.innerHTML = head + `<div class="rv-empty">
      <div class="rv-status">${status}${!plans.length ? ` <a class="lnk" onclick="switchTab('watchlist'); openPlanForm();">${L('去建计划','Create a plan')}</a>` : ''}</div>
      ${buyList}</div>`;
    return;
  }
  const avg = a => a.n ? a.pnl / a.n : 0;
  let headline, sub;
  if(agg.in.n && agg.out.n){
    const d = avg(agg.in) - avg(agg.out);
    headline = d >= 0 ? L(`按计划的交易每笔多赚 <span class="gain-t">${money(d)}</span>`, `Planned trades make <span class="gain-t">${money(d)}</span> more per trade`)
                      : L(`按计划的交易每笔反而少赚 <span class="loss-t">${money(Math.abs(d))}</span>`, `Planned trades make <span class="loss-t">${money(Math.abs(d))}</span> less per trade`);
  } else if(agg.in.n){
    headline = L(`目前平仓的都是计划内交易，共 <span class="${agg.in.pnl>=0?'gain-t':'loss-t'}">${money(agg.in.pnl)}</span>`, `All closed trades so far were planned: <span class="${agg.in.pnl>=0?'gain-t':'loss-t'}">${money(agg.in.pnl)}</span>`);
  } else {
    headline = L(`目前平仓的都是计划外交易，共 <span class="${agg.out.pnl>=0?'gain-t':'loss-t'}">${money(agg.out.pnl)}</span>`, `All closed trades so far were off-plan: <span class="${agg.out.pnl>=0?'gain-t':'loss-t'}">${money(agg.out.pnl)}</span>`);
  }
  const line = (t, a) => `${t} ${a.n} ${L('笔','')} · ${L('平均','avg')} ${a.n ? money(avg(a)) : '—'} · ${L('胜率','win')} ${a.n ? fmt(a.win/a.n*100,0)+'%' : '—'}`;
  sub = `${line(L('计划内','In plan'), agg.in)}　${line(L('计划外','Off plan'), agg.out)}`;
  const maxAbs = Math.max(1, Math.abs(agg.in.pnl), Math.abs(agg.out.pnl));
  const bar = (t, a) => `<div class="cmp-row"><div class="cmp-l"><b>${t}</b></div><div class="cmp-bar"><div class="zero"></div><i class="${a.pnl>=0?'pos':'neg'}" style="width:${Math.abs(a.pnl)/maxAbs*50}%"></i></div><div class="cmp-v ${a.pnl>=0?'gain-t':'loss-t'}">${money(a.pnl)}</div></div>`;
  const disc = buys.length ? nIn / buys.length * 100 : 0;
  el.innerHTML = head + `<div class="rv-card2">
      <div class="rv-head">${headline}</div>
      <div class="rv-sub">${sub}</div>
      <div class="rv-cols">
        <div>${bar(L('计划内','In plan'), agg.in)}${bar(L('计划外','Off plan'), agg.out)}</div>
        <div class="rv-disc"><span>${L('按计划买入的比例','Buys made per plan')}</span><b>${buys.length ? fmt(disc,0)+'%' : '—'}</b><div class="mini"><i style="width:${disc}%; background:var(--gain)"></i></div><em>${nIn} / ${buys.length} ${L('笔','buys')} · ${L(`从 ${since} 起`, `since ${since}`)}</em></div>
      </div>
      ${buyList}
    </div>`;
}

// ---------- settings ----------
function openSettings(){
  document.getElementById('settingsBody').innerHTML = `
    <div class="modal-title">${L('设置','Settings')}</div>
    <div class="f2 set2">
      <div class="f2-sec"><div class="f2-sec-t">${L('风险','Risk')}</div>
        ${fld({ id:'st-risk', label:L('每笔默认风险','Default risk per trade'), prefix:'$', tip:L('每一笔交易打到止损价时，最多愿意亏多少。计划会按它倒推买几股；每个计划也可以单独改。常见做法是账户的 0.5–1%。','The most one trade may lose if its stop is hit. Plans size from this; each plan can override. A common rule is 0.5–1% of the account.'),
            hint:L('建议填。不填的话计划只显示每股风险，不算股数。','Recommended — without it plans show risk per share only.'), attrs:`type="number" step="any" placeholder="${eg('1000')}" value="${esc(cfg.risk)}"` })}
        <div class="f2-row2">
          ${fld({ id:'st-single', label:L('单票上限','Single-stock limit'), unit:'%', tip:L('一只股票最多占总资产（含现金）的百分比，超过了才提醒。','Max share of the account (incl. cash) one stock may take. You are only warned above it.'), attrs:`type="number" step="any" value="${cfg.maxSingle}"` })}
          ${fld({ id:'st-sector', label:L('板块上限','Sector limit'), unit:'%', tip:L('同一个细分板块（如存储、光通信）最多占多少。','Max share for one sub-sector (e.g. memory, optical).'), attrs:`type="number" step="any" value="${cfg.maxSector}"` })}
        </div>
      </div>
      <div class="f2-sec"><div class="f2-sec-t">${L('目标','Goal')}</div>
        ${fld({ id:'st-week', label:L('每周盈利目标','Weekly profit target'), opt:true, prefix:'$', tip:L('只算已实现盈亏。可以填一个数，也可以填区间，如 2000-3000。','Realized P&L only. One number or a range like 2000-3000.'), attrs:`type="text" placeholder="${eg('2000-3000')}" value="${esc(cfg.weekTarget)}"` })}
      </div>
      <div class="f2-sec"><div class="f2-sec-t">${L('数据','Data')}</div>
        ${fld({ id:'st-fh', label:'Finnhub API key', opt:true, tip:L('finnhub.io 免费注册后拿到。用来自动拉股价和财报日期。只存在这个浏览器里。','Free at finnhub.io. Used for live prices and earnings dates. Stored only in this browser.'),
            hint:L('不填也能用，股价可以手动输入。','Optional — you can type prices in by hand.'), attrs:`type="password" autocomplete="off" placeholder="${L('粘贴你的 key','paste your key')}" value="${esc(finnhubKey)}"` })}
        ${fld({ id:'st-td', label:'Twelve Data API key', opt:true, tip:L('twelvedata.com 免费注册。用来在浏览器里直接拿日 K 线，个股页、动能榜、雷达、对比都靠它。只存在这个浏览器里。','Free at twelvedata.com. Lets the Stock page, momentum board, radar and compare pull daily bars directly in the browser. Stored only in this browser.'),
            hint:L('不填也行：个股页会提示，或者导入离线数据包。免费版每分钟 8 次请求。','Optional — without it the Stock page asks for it, or you can import an offline pack. Free plan: 8 requests a minute.'), attrs:`type="password" autocomplete="off" placeholder="${L('粘贴你的 key','paste your key')}" value="${esc(tdKey)}"` })}
        <div class="f-field"><label class="f-label">${L('数据包','Data pack')}<span class="f-opt">${L('选填','optional')}</span></label>
          <div class="pk-row">${typeof packChip === 'function' ? packChip() : ''}${typeof pack !== 'undefined' && pack ? `<a class="lnk" onclick="clearPack()">${L('清除','remove')}</a>` : ''}</div>
          <div class="f-hint">${L('离线备选：运行 <code>node tools/make-pack.js</code> 生成 loop-data.json（Yahoo 日 K 线）再导入；填了 Twelve Data key 就不需要。','Offline alternative: run <code>node tools/make-pack.js</code> and import loop-data.json (Yahoo bars). Not needed once you add a Twelve Data key.')}</div></div>
      </div>
    </div>
    <div class="f2-actions" style="justify-content:flex-end;"><button class="btn-ghost" onclick="closeSettings()">${L('取消','Cancel')}</button><button class="btn-primary" onclick="saveSettings()">${L('保存','Save')}</button></div>`;
  document.getElementById('settingsModal').classList.add('show');
}
function closeSettings(){ document.getElementById('settingsModal').classList.remove('show'); }
async function saveSettings(){
  cfg.risk = document.getElementById('st-risk').value.trim();
  cfg.maxSingle = num(document.getElementById('st-single').value) ?? 40;
  cfg.maxSector = num(document.getElementById('st-sector').value) ?? 60;
  cfg.weekTarget = document.getElementById('st-week').value.trim();
  const k = document.getElementById('st-fh').value.trim();
  if(k !== finnhubKey){ finnhubKey = k; try{ await window.storage.set(FINNHUB_KEY, k); }catch(e){} }
  const td = document.getElementById('st-td'); if(td && td.value.trim() !== tdKey) saveTdKey(td.value);
  saveCfg(); closeSettings(); render();
}

// ---------- onboarding: checklist, empty states, page help, term tooltips ----------
const TERMS = {
  rr:    ['盈亏比', 'Reward / risk', '打到目标能赚的钱 ÷ 打到止损价会亏的钱。大于 1.5 才比较划算。', 'What you make at the target ÷ what you lose at the stop. Above 1.5 is usually worth it.'],
  stop:  ['止损价', 'Stop', '跌到这个价，说明当初买入的理由不成立了，按计划离场。', 'If price gets here, the reason for the trade is gone — exit per plan.'],
  zone:  ['关注区', 'Zone', '你愿意买入的价格区间，通常是一个支撑区。', 'The price range you are willing to buy in, usually a support area.'],
  lifo:  ['LIFO', 'LIFO', '后进先出：卖出时先配对最近买入的那批，算出每一批的真实盈亏。', 'Last in, first out: a sale is matched to the most recent buy, giving per-lot P&L.'],
  beta:  ['Beta', 'Beta', '对大盘的敏感度。Beta 1.6 ≈ 大盘跌 1%，它平均跌 1.6%。', 'Sensitivity to the market. Beta 1.6 ≈ falls 1.6% when the market falls 1%.'],
  trig:  ['触发亏损', 'Loss at stop', '如果这只票跌到止损价，这笔持仓会亏多少钱。', 'What this position loses if price falls to its stop.'],
};
function term(k, label){
  const t = TERMS[k]; if(!t) return label || k;
  return `<span class="term" tabindex="0" data-tip="${esc(L(t[2], t[3]))}">${label || L(t[0], t[1])}</span>`;
}

const PAGE_HELP = () => ({
  today: [L('每天打开 LOOP 先看这页。','Open LOOP here every day.'), L('只列需要你动手的事：计划到价、财报临近、仓位超上限、重要宏观数据。','It lists only what needs action: plans at their levels, earnings ahead, limits breached, major macro.'), L('处理完点「已处理」，不想现在管就点「明天再提醒」。','Mark items Done, or push them to tomorrow.')],
  plans: [L('买之前先写计划：在哪买、错了在哪认、目标在哪。','Write the plan before buying: where to buy, where you are wrong, where you take profit.'), L('LOOP 按你设的每笔风险金额，倒推应该买几股、分几批。','LOOP sizes the trade from your risk-per-trade setting and splits it into tranches.'), L('导入对账单后，成交会自动对上计划，区间外的买入标为「计划外」。','After you import a statement, fills match the plan automatically; buys outside the zone are marked off-plan.')],
  risk:  [L('持仓从你的交易记录自动算出。','Positions are computed from your trades.'), L('给每只票填止损价，就能看到「全部打到止损价」时一共会亏多少。','Give each holding a stop to see what you lose if every stop is hit.'), L('单票、板块超过你设的上限才会提醒。','You are only warned when a stock or sector goes over your limit.')],
  momo:  [L('把你的自选按 1–2 周的短线动能排出强、中、弱。','Ranks your watchlist by 1–2 week momentum: strong, medium, weak.'), L('每满足一条加 1 分（趋势、相对强弱、量能、位置、新闻），过热扣分；每条证据都列出来。','One point per condition met (trend, relative strength, volume, position, news), minus points when overheated — every point is listed.'), L('参考入场和止损是按规则算的起点，点「建计划」会预填，你再改。','Entry and stop are rule-based starting points; "Plan" pre-fills them for you to adjust.')],
  radar: [L('约 50 只 AI 产业链股票，加上你的持仓、计划和观察。','About 50 AI-chain names plus your holdings, plans and watchlist.'), L('上面的板块汇总可以点，筛出这个板块；表头可以点排序。','Click a sector row to filter; click a column header to sort.'), L('点一行展开迷你卡片，勾两行可以对比。预设只在这个股票池里筛。','Click a row for a mini card; tick two to compare. Presets screen this universe only.')],
  cal:   [L('只列跟你有关的事：重要宏观数据、FOMC、你的持仓/计划/雷达股票的财报。','Only what matters to you: major macro, FOMC, earnings for your holdings, plans and radar.'), L('持仓的财报会算出这笔仓位可能的波动金额（历史平均或期权隐含）。','Held names show the dollar swing to expect (historical average or implied).'), L('公布后会补上实际值，以及当天 SPY 和你组合的涨跌。','After a release you see the actual value and how SPY and your account moved.')],
  events:[L('异常日：你在单日涨跌 ≥4% 那天的买卖，以及之后 5 天的走势，看是不是追高或卖在低点。','Abnormal days: your trades on ±4% days and what happened in the next 5 days — chasing or panic selling?'), L('事件日：CPI、FOMC、非农、持仓财报当天，大盘和你组合的平均涨跌。','Event days: average SPY and account moves on CPI, FOMC, payrolls and your earnings days.'), L('需要数据包里的 K 线。','Needs bars from the data pack.')],
  review:[L('把买入分成「计划内」（在计划区间里买的）和「计划外」（没计划或追价买的）。','Buys are split into in-plan (inside a plan zone) and off-plan (no plan, or chased).'), L('比较两边的盈亏和胜率，看按计划交易是不是更赚钱。','Compare P&L and win rate to see whether trading the plan pays.'), L('标错了点一下标签就能改。','Tap a tag to fix a mislabel.')],
});
function pageHelp(key){
  // same hover tooltip as every other info icon (dark box, white text); numbered lines, no click needed
  const items = PAGE_HELP()[key] || [];
  const plain = h => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const tip = items.map((t, i) => `${i + 1}. ${plain(t)}`).join('\n');
  return `<span class="phelp"><span class="f-tip" tabindex="0" data-tip="${esc(tip)}">i</span></span>`;
}

function stepsCard(title, steps, actions){
  return `<div class="steps-card"><div class="sc-t">${title}</div>
    <ol>${steps.map(s => `<li><span>${s}</span></li>`).join('')}</ol>
    ${actions ? `<div class="sc-a">${actions}</div>` : ''}</div>`;
}

function onboardState(){
  const realTrades = trades.filter(t => !String(t.id).startsWith('demo-'));
  return [
    { done: realTrades.length > 0, t:L('导入 IBKR 对账单','Import an IBKR statement'), d:L('持仓和盈亏会自动算出来。','Positions and P&L are computed from it.'), go:"switchTab('ledger'); openAddPanel();", btn:L('+ 添加','+ Add') },
    { done: num(cfg.risk) != null, t:L('设置每笔风险和仓位上限','Set risk per trade and limits'), d:L('每笔最多亏多少，单票和板块最多占多少。','Max loss per trade, and max weight per stock and sector.'), go:'openSettings()', btn:L('去设置','Settings') },
    { done: plans.some(p => !String(p.id).startsWith('demo-')), t:L('建第一个交易计划','Create your first plan'), d:L('写下关注区间、止损价和目标。','Write down the zone, stop and target.'), go:"switchTab('watchlist'); openPlanForm();", btn:L('+ 添加','+ Add') },
    { done: /\S/.test(finnhubKey), optional:true, t:L('（可选）填 Finnhub key','(Optional) Add a Finnhub key'), d:L('finnhub.io 免费注册。有了它才有实时股价和财报日期；不填也能用，价格手动填。','Free at finnhub.io. Needed for live prices and earnings dates; without it, type prices in by hand.'), go:'openSettings()', btn:L('去填','Add key') },
  ];
}

function onboardHtml(){
  if(cfg.onboardHidden) return '';
  const st = onboardState();
  const req = st.filter(s => !s.optional);
  const doneN = req.filter(s => s.done).length;
  if(doneN === req.length && !isDemoMode()) return '';
  const cur = req.find(s => !s.done);
  const fh = st.find(s => s.optional);
  const idx = cur ? req.indexOf(cur) : req.length - 1;
  return `<div class="ob2">
    <div class="ob2-top">
      <span class="ob2-kicker">${cur ? L(`第 ${idx+1} / ${req.length} 步`, `Step ${idx+1} of ${req.length}`) : L('已完成','All set')}</span>
      <div class="ob2-seg">${req.map((s, i) => `<i class="${s.done ? 'done' : i === idx ? 'cur' : ''}"></i>`).join('')}</div>
      <a class="lnk ob2-hide" onclick="hideOnboard()">${L('隐藏','Hide')}</a>
    </div>
    ${isDemoMode() ? `<div class="ob2-demo">${L('现在是示例数据','You are viewing demo data')} · <a class="lnk" onclick="exitDemo()">${L('清空，用自己的数据','clear it and use your own')}</a></div>` : ''}
    ${cur ? `<div class="ob2-title">${cur.t}</div>
      <div class="ob2-desc">${cur.d}</div>
      <div class="ob2-cta"><button class="btn-primary" onclick="${cur.go}">${cur.btn} →</button>
        ${!trades.length ? `<button class="btn-ghost" onclick="loadDemoData()">${L('先看看示例数据','Try demo data first')}</button>` : ''}</div>` : ''}
  </div>`;
}
function hideOnboard(){ cfg.onboardHidden = true; saveCfg(); renderToday(); }

// help modal (header "?") rewritten for the 5 pages
renderWelcome = function(){
  const el = document.getElementById('welcomeBody'); if(!el) return;
  const it = (h, zh, en) => `<div class="w-item"><div class="w-h">${h}</div><p>${L(zh, en)}</p></div>`;
  el.innerHTML = `<div class="modal-title">${L('LOOP 怎么用','How LOOP works')}</div>
    <div class="w-grid">
      ${it(L('今日','Today'), '每天先看这页。只列需要你动手的事：计划到价、财报临近、仓位超上限、重要宏观数据。', 'Start here every day. Only what needs action: plans at their levels, earnings, limit breaches, major macro.')}
      ${it(L('自选 · 交易计划','Watchlist · Plans'), '买之前写好<b>关注区、止损价、目标</b>。LOOP 按你的每笔风险算股数和分批，并显示<b>盈亏比</b>。', 'Before buying, set the <b>zone, stop and target</b>. LOOP sizes it from your risk per trade and shows <b>reward/risk</b>.')}
      ${it(L('持仓 · 风险','Positions · Risk'), '持仓从交易记录<b>自动算出</b>。看单票和板块集中度、全部打到止损价会亏多少、大盘下跌时的影响。', 'Computed <b>from your trades</b>. Concentration, loss if every stop is hit, and what a market drop would cost.')}
      ${it(L('日历','Calendar'), '财报日和宏观事件。填 Finnhub key 后自动同步；也可以点某天的 + 自己加。', 'Earnings and macro dates. Syncs automatically with a Finnhub key; or add your own with +.')}
      ${it(L('复盘','Review'), '<b>周报</b>看每周盈亏和目标进度；<b>计划对账</b>比较计划内和计划外；<b>交易明细</b>在这里导入 IBKR 对账单，按 LIFO 逐批结算。', '<b>Weekly</b> P&L vs target; <b>Plan check</b> compares in-plan vs off-plan; <b>Trades</b> is where you import IBKR statements, settled lot by lot (LIFO).')}
      ${it(L('你的数据','Your data'), '只存在这个浏览器，不上传。换电脑或清缓存前先<b>导出备份</b>。', 'Lives only in this browser. <b>Export a backup</b> before switching computers or clearing site data.')}
    </div>
    <div class="w-actions">${!trades.length ? `<button class="btn-ghost btn-small" onclick="loadDemoData()" style="margin-right:8px;">${L('加载示例数据','Load demo data')}</button>` : ''}<button class="btn-ghost btn-small" onclick="cfg.onboardHidden=false; saveCfg(); closeWelcome(); switchTab('today'); renderToday();">${L('重新显示新手清单','Show the setup checklist again')}</button></div>`;
};

// import tooltip text follows the language
const _applyStaticI18n = applyStaticI18n;
applyStaticI18n = function(){ _applyStaticI18n(); const tip = document.getElementById('impHowTip'); if(tip) tip.setAttribute('data-tip', L('IBKR → Performance & Reports → Statements → Activity，格式选 CSV，时间范围选你要的区间。同一笔成交按「代码 + 时间 + 数量 + 价格」去重，重复导入不会算两次。', 'IBKR → Performance & Reports → Statements → Activity, format CSV, pick the date range you want. Fills are de-duplicated by symbol + time + qty + price, so re-importing is safe.')); };

// ---------- price targets merged into the watchlist as light "watching" rows ----------
renderTargets = function(){
  const el = document.getElementById('targetsView'); if(!el) return;
  if(!watchlist.length){
    el.innerHTML = `<div class="watch-empty">${L('只想盯一个价位、还没想好怎么买？记在这里，到价时再点「建计划」。','Just watching a price and not ready to plan? Note it here, then turn it into a plan when it gets close.')}</div>`;
    return;
  }
  const act = a => a==='BUY' ? L('买入','Buy') : a==='SELL' ? L('卖出','Sell') : L('关注','Watch');
  const rows = [...watchlist].sort((a,b)=> a.sym<b.sym?-1:a.sym>b.sym?1:0);
  el.innerHTML = `<div class="watch-list"><div class="watch-row watch-head"><span>${L('代码','Symbol')}</span><span>${L('方向','Side')}</span><span>${L('价位','Level')}</span><span>${L('现价','Price')}</span><span>${L('原因','Note')}</span><span></span><span></span></div>${rows.map(w => { const px = getPrice(w.sym); return `
    <div class="watch-row">
      <b class="w-sym">${esc(w.sym)}</b>
      <span class="w-act ${w.action.toLowerCase()}">${act(w.action)}</span>
      <input class="tg-in w-lv" value="${esc(w.level||'')}" placeholder="${L('价位','level')}" onchange="updateTarget('${w.id}','level',this.value)">
      <span class="w-px">${px != null ? '$'+fmt(px) : ''}</span>
      <input class="tg-in tg-note w-note" value="${esc(w.note||'')}" placeholder="${L('一句原因','why')}" onchange="updateTarget('${w.id}','note',this.value)">
      ${w.action !== 'SELL' ? `<button class="btn-ghost btn-small" onclick="planFromTarget('${w.id}')">${L('建计划','Plan it')}</button>` : '<span></span>'}
      <button class="tg-del" aria-label="${L('删除','delete')}" onclick="deleteTarget('${w.id}')">✕</button>
    </div>`; }).join('')}</div>`;
};
function planFromTarget(id){
  const w = watchlist.find(x => x.id === id); if(!w) return;
  openPlanForm();
  setTimeout(() => {
    const nums = String(w.level||'').match(/\d+(?:\.\d+)?/g) || [];
    const set = (i, v) => { const e = document.getElementById(i); if(e && v != null) e.value = v; };
    set('pf-sym', w.sym); set('pf-lo', nums[0]); set('pf-hi', nums[1] ?? nums[0]); set('pf-note', w.note || '');
    planPreview();
    document.getElementById('plansSection').scrollIntoView({ behavior:'smooth', block:'start' });
  }, 30);
}

// ---------- my stocks: news + upcoming events for holdings / plans / watching ----------
const MYNEWS_KEY = 'loop2_mynews_v1';
let myNews = { at:0, items:[], syms:[] };
let myNewsFilter = 'all', myNewsBusy = false;

function myUniverse(){
  const H = holdingsNow();
  const roles = {};
  const add = (sym, r) => { if(!sym) return; (roles[sym] = roles[sym] || new Set()).add(r); };
  H.list.forEach(h => add(h.sym, 'hold'));
  activePlans().forEach(p => add(p.sym, 'plan'));
  watchlist.forEach(w => add(w.sym, 'watch'));
  return roles;
}
const roleLabel = r => ({ hold:L('持仓','Held'), plan:L('计划','Plan'), watch:L('观察','Watching') })[r];

async function refreshMyNews(force){
  if(myNewsBusy) return;
  const roles = myUniverse();
  const syms = Object.keys(roles).slice(0, 25);
  if(!/\S/.test(finnhubKey) || !syms.length){ renderMyNews(); return; }
  const fresh = myNews.at && Date.now() - myNews.at < 30*60*1000 && syms.every(s => myNews.syms.includes(s));
  if(!force && fresh){ renderMyNews(); return; }
  myNewsBusy = true; renderMyNews();
  const from = addDays(todayISO(), -7), to = todayISO();
  const seen = new Set(), items = [];
  for(const sym of syms){
    try{
      const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${encodeURIComponent(finnhubKey)}`);
      if(!r.ok) continue;
      const arr = await r.json();
      (Array.isArray(arr) ? arr : []).sort((a,b) => b.datetime - a.datetime).slice(0, 6).forEach(n => {
        const k = (n.headline || '').toLowerCase().slice(0, 80);
        if(!n.headline || seen.has(k)) return; seen.add(k);
        items.push({ sym, headline:n.headline, source:n.source, url:n.url, datetime:n.datetime });
      });
    }catch(e){}
  }
  myNews = { at: Date.now(), items: items.sort((a,b) => b.datetime - a.datetime).slice(0, 60), syms };
  try{ await window.storage.set(MYNEWS_KEY, JSON.stringify(myNews)); }catch(e){}
  myNewsBusy = false;
  renderMyNews();
}

function myEvents(roles){
  const today = todayISO(), end = addDays(today, 30), out = [];
  for(const k of Object.keys(calendarEvents)){
    if(k < today || k > end) continue;
    for(const ev of calendarEvents[k] || []){
      const sym = String(ev.text||'').toUpperCase().split(/\s/)[0];
      if(roles[sym]) out.push({ date:k, sym, text: ev.category === 'earnings' ? L('财报','Earnings') + (/pre/.test(ev.text) ? L(' · 盘前',' · pre-market') : /post/.test(ev.text) ? L(' · 盘后',' · after close') : '') : esc(ev.text.replace(sym, '').trim()), kind: ev.category === 'earnings' ? 'er' : 'ev' });
    }
  }
  activePlans().forEach(p => { if(d10(p.expiry) >= today && d10(p.expiry) <= end) out.push({ date:d10(p.expiry), sym:p.sym, text:L('计划到期','Plan expires'), kind:'plan' }); });
  return out.sort((a,b) => a.date < b.date ? -1 : 1);
}

function setMyNewsFilter(f){ myNewsFilter = f; renderMyNews(); }

function renderMyNews(){
  const el = document.getElementById('myNews'); if(!el) return;
  const roles = myUniverse();
  const syms = Object.keys(roles);
  const pass = sym => myNewsFilter === 'all' || (roles[sym] && roles[sym].has(myNewsFilter));
  const counts = { hold:0, plan:0, watch:0 }; syms.forEach(s => roles[s].forEach(r => counts[r]++));
  const head = `<div class="sec-head">
      <span class="badge"><svg class="i" viewBox="0 0 24 24"><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span>
      <h2>${L('我的股票动态','My stocks')}</h2><span class="count">${syms.length}</span>
      <div class="grow">
        ${syms.length ? `<div class="seg mn-seg">${[['all',L('全部','All')],['hold',L('持仓','Held')],['plan',L('计划','Plans')],['watch',L('观察','Watching')]].map(([k,t]) => `<button type="button" class="${myNewsFilter===k?'on':''}" onclick="setMyNewsFilter('${k}')">${t}${k!=='all' && counts[k] ? ` <em>${counts[k]}</em>` : ''}</button>`).join('')}</div>` : ''}
        ${/\S/.test(finnhubKey) && syms.length ? `<button class="btn-ghost btn-small" onclick="refreshMyNews(true)" ${myNewsBusy?'disabled':''}>${myNewsBusy ? L('更新中…','Updating…') : L('刷新','Refresh')}</button>` : ''}
      </div></div>`;
  if(!syms.length){
    el.innerHTML = head + `<div class="watch-empty">${L('有了持仓、计划或观察的股票后，这里会汇总它们的新闻和接下来的财报。','Once you have holdings, plans or watched stocks, their news and upcoming earnings collect here.')}</div>`;
    return;
  }
  const evs = myEvents(roles).filter(e => pass(e.sym));
  const tagsOf = sym => [...(roles[sym] || [])].map(r => `<span class="tag">${roleLabel(r)}</span>`).join('');
  const evHtml = evs.length ? evs.map(e => { const d = localDate(e.date); const dd = daysBetween(todayISO(), e.date);
      return `<div class="mn-ev"><div class="mn-date"><b>${d.getDate()}</b><span>${(d.getMonth()+1)}${L('月','/')}</span></div>
        <div class="mn-ev-b"><div class="mn-top"><b>${e.sym}</b>${tagsOf(e.sym)}<span>${e.text}</span></div><div class="mn-sub">${dd === 0 ? L('今天','today') : dd === 1 ? L('明天','tomorrow') : L(`${dd} 天后`, `in ${dd} days`)}</div></div></div>`; }).join('')
    : `<div class="mn-none">${/\S/.test(finnhubKey) ? L('30 天内没有相关事件。点上面日历的「同步日历」可以更新财报日期。','Nothing in the next 30 days. Use "Sync calendar" above to refresh earnings dates.') : L('填 Finnhub key 并同步日历后，财报日期会出现在这里。','Add a Finnhub key and sync the calendar to see earnings dates here.')}</div>`;
  let newsHtml;
  if(!/\S/.test(finnhubKey)){
    newsHtml = `<div class="mn-none">${L('新闻需要免费的 Finnhub key。','News needs a free Finnhub key.')} <a class="lnk" onclick="openSettings()">${L('去设置里填','Add it in Settings')}</a></div>`;
  } else {
    const list = myNews.items.filter(n => pass(n.sym) && roles[n.sym]);
    if(!list.length) newsHtml = `<div class="mn-none">${myNewsBusy ? L('正在拉取新闻…','Fetching news…') : myNews.at ? L('近 7 天没有相关新闻。','No news in the last 7 days.') : L('点「刷新」拉取近 7 天的新闻。','Click Refresh to load the last 7 days of news.')}</div>`;
    else {
      let lastDay = '';
      newsHtml = list.slice(0, 40).map(n => {
        const day = dateKey(new Date(n.datetime * 1000));
        const dd = daysBetween(day, todayISO());
        const hdr = day !== lastDay ? `<div class="mn-day">${dd === 0 ? L('今天','Today') : dd === 1 ? L('昨天','Yesterday') : md(day)}</div>` : '';
        lastDay = day;
        return hdr + `<a class="mn-item" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
          <span class="mn-body"><span class="mn-top"><b class="mn-sym">${esc(n.sym)}</b>${tagsOf(n.sym)}</span>
            <span class="mn-h">${esc(n.headline)}</span><span class="mn-sub">${esc(n.source || '')} · ${agoStr(n.datetime)}</span></span></a>`;
      }).join('');
    }
  }
  el.innerHTML = head + `<div class="mn-grid one">
      <div class="mn-card"><div class="duo-h">${L('最新新闻','Latest news')}<span>${L('近 7 天','last 7 days')}${myNews.at ? ' · ' + L('更新于 ','updated ') + new Date(myNews.at).toTimeString().slice(0,5) : ''}</span></div>${newsHtml}</div>

    </div>`;
}

// "Import" from anywhere always opens (never toggles shut) the upload area and brings it into view
const _openImport = openImport;
openImport = function(){
  const c = document.getElementById('importCard');
  if(c.style.display === 'none') _openImport();
  setTimeout(() => c.scrollIntoView({ behavior:'smooth', block:'center' }), 40);
};
// one "+ Add" for trades: statement upload and manual entry live in the same place
function openAddPanel(){
  if(document.getElementById('importCard').style.display === 'none') openImport();
  if(document.getElementById('addTradeForm').style.display === 'none') openAddTrade();
}
function openAddTrades(){
  const open = document.getElementById('importCard').style.display !== 'none' || document.getElementById('addTradeForm').style.display !== 'none';
  if(open){ closeImport(); document.getElementById('addTradeForm').style.display = 'none'; }
  else openAddPanel();
}
function showAddTradeForm(){ if(document.getElementById('addTradeForm').style.display === 'none') openAddTrade(); }

// ---------- navigation ----------
const _origSwitchTab = switchTab;
switchTab = function(name){
  if(name === 'ledger'){ _origSwitchTab('review'); switchSub('trades'); return; }
  if(name === 'report'){ _origSwitchTab('review'); switchSub('weekly'); return; }
  _origSwitchTab(name);
  window.scrollTo({ top: 0 });
};
function switchSub(name){
  const tgt = name === 'trades' ? document.getElementById('sub-trades') : name === 'plans' ? document.getElementById('planReview') : null;
  if(tgt){ setTimeout(() => tgt.scrollIntoView({behavior:'smooth', block:'start'}), 30); }
  return;
  if(name === 'plans'){ switchSub('weekly'); const r = document.getElementById('planReview'); if(r) setTimeout(() => r.scrollIntoView({behavior:'smooth', block:'start'}), 50); return; }
  document.querySelectorAll('.sub-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.toggle('active', p.id === 'sub-' + name));
  if(name === 'plans') renderPlanReview();
}

// ---------- wiring into the existing app ----------
function renderLoop2(){ renderPlans(); renderRisk(); renderToday(); renderPlanReview(); renderMyNews(); }
const _render = render;            render = function(){ _render(); emptyTradesView(); renderLoop2(); };
// no trades yet: the Trades tab is just the upload area
function emptyTradesView(){
  const empty = trades.length === 0;
  const sec = document.getElementById('ledgerTable') && document.getElementById('ledgerTable').closest('section');
  const wasEmpty = sec && sec.classList.contains('trades-empty');
  if(sec) sec.classList.toggle('trades-empty', empty);
  const rv = document.getElementById('tab-review'); if(rv) rv.classList.toggle('review-empty', empty);
  if(!empty && wasEmpty){ const ic = document.getElementById('importCard'); if(ic) ic.style.display = 'none'; const af = document.getElementById('addTradeForm'); if(af) af.style.display = 'none'; }
  if(empty){
    const sc = document.getElementById('summaryCards'); if(sc) sc.innerHTML = '';
    const ic = document.getElementById('importCard'); if(ic && ic.style.display === 'none' && !document.getElementById('addTradeForm').offsetParent) ic.style.display = 'block';
    const lt = document.getElementById('ledgerTable'); if(lt) lt.innerHTML = '';
  }
}
const _renderPositions = renderPositions; renderPositions = function(){ _renderPositions(); renderRisk(); };
const _renderCalendar = renderCalendar;   renderCalendar = function(){ _renderCalendar(); renderToday(); renderMyNews(); };
const _toggleLang = toggleLang;    toggleLang = async function(){ await _toggleLang(); renderLoop2(); };
fetchPrices = refreshAllPrices;

const DEMO_PLANS = [
  { id:'demo-plan-1', sym:'META', lo:700, hi:725, stop:680, target:780, risk:'', tranches:2, expiry:'', note:'pullback into prior breakout', createdAt:'', createdPrice:735, orig:null },
  { id:'demo-plan-2', sym:'NVDA', lo:178, hi:184, stop:170, target:205, risk:'', tranches:3, expiry:'', note:'50-day line + put wall', createdAt:'', createdPrice:191, orig:null },
];
const _loadDemoData = loadDemoData;
loadDemoData = async function(){
  await _loadDemoData();
  switchTab('today');
  const today = todayISO();
  plans = DEMO_PLANS.map(p => ({ ...p, risk:'1000', createdAt: addDays(today, -6), expiry: addDays(today, 24), orig:{ lo:p.lo, hi:p.hi, stop:p.stop, target:p.target } }));
  await savePlans();
  render();
};

const _loadAll = loadAll;
loadAll = async function(){
  try{ plans = JSON.parse((await window.storage.get(PLANS_KEY)).value) || []; }catch(e){ plans = []; }
  try{ cfg = Object.assign(cfg, JSON.parse((await window.storage.get(CFG_KEY)).value) || {}); }catch(e){}
  try{ quotes = JSON.parse((await window.storage.get(QUOTES_KEY)).value) || quotes; }catch(e){}
  try{ fillTags = JSON.parse((await window.storage.get(TAGS_KEY)).value) || {}; }catch(e){}
  try{ todayState = Object.assign({ dismiss:{}, log:[] }, JSON.parse((await window.storage.get(TODAY_KEY)).value) || {}); }catch(e){}
  try{ myNews = JSON.parse((await window.storage.get(MYNEWS_KEY)).value) || myNews; }catch(e){}
  await _loadAll();
  if(!isDemoMode() && plans.some(p => String(p.id).startsWith('demo-'))){ plans = plans.filter(p => !String(p.id).startsWith('demo-')); savePlans(); }
  renderLoop2();
  refreshMyNews(false);
};


/* ==== loop3 : phases 2–4 — data pack, indicators, levels, momentum, Finnhub cache ==== */
const PACK_KEY = 'loop3_pack_v1';
const FH_KEY   = 'loop3_fh_v1';
Object.assign(I18N.zh, { tabStock:'个股' }); Object.assign(I18N.en, { tabStock:'Stock' });
let pack = null;                    // imported loop-data.json
let fh = { insider:{}, er:{}, eps:{}, news:{}, metric:{} };   // Finnhub cache: kind -> SYM -> {at, d}
const SEMI_SECTORS = ['光通信','存储','封装','半导体设备','ASIC','GPU'];
const LEVERAGED = /^(SOXL|SOXS|TQQQ|SQQQ|UPRO|SPXU|SPXL|TNA|TZA|LABU|LABD|NVDL|NVDU|TSLL|TSLQ|MSTU|MSTX|CONL|FNGU|FNGD|TECL|TECS|NEBX|NBIG|NBIC|AMDL|USD|ROM|QLD|SSO)$/;
const isLev = s => LEVERAGED.test(s);
const sg = (n, dp=1) => { if(n == null || !isFinite(n)) return '—'; const r = +Math.abs(n).toFixed(dp); return (r === 0 ? '' : n > 0 ? '+' : '−') + fmt(r, dp) + '%'; };
const kfmt = n => n == null ? '—' : Math.abs(n) >= 1e6 ? fmt(n/1e6, 1) + 'M' : Math.abs(n) >= 1e3 ? fmt(n/1e3, 1) + 'k' : fmt(n, 0);
const px = v => v == null ? '—' : '$' + fmt(v, v >= 100 ? 1 : 2);

// ---------- pack ----------
async function savePack(){ try{ await window.storage.set(PACK_KEY, JSON.stringify(pack)); return true; }catch(e){ return false; } }
function packAge(){
  // trading days between the pack's last bar and the last completed US session
  if(!pack || !pack.asOf) return null;
  const now = new Date();
  let d = new Date(now); const etHour = (now.getUTCHours() + 24 - 4) % 24;
  if(etHour < 16 || (etHour === 16 && now.getUTCMinutes() < 15)) d.setDate(d.getDate() - 1);
  while(d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const last = dateKey(d);
  let n = 0, x = localDate(pack.asOf);
  while(dateKey(x) < last && n < 60){ x.setDate(x.getDate() + 1); if(x.getDay() !== 0 && x.getDay() !== 6) n++; }
  return n;
}
function importPackText(text, silent){
  let p;
  try{ p = JSON.parse(text); }catch(e){ if(!silent) alert(L('这个文件不是有效的 JSON。','That file is not valid JSON.')); return false; }
  if(!p || p.v !== 1 || !p.bars){ if(!silent) alert(L('这不是 LOOP 数据包（loop-data.json）。','This is not a LOOP data pack (loop-data.json).')); return false; }
  pack = p; clearIndCache();
  savePack().then(ok => { if(!ok && !silent) alert(L('数据包太大，浏览器存不下，这次能用但刷新后要重新导入。','The pack is too big for browser storage — it works now but must be re-imported after a reload.')); });
  render();
  return true;
}
function pickPackFile(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { const f = inp.files[0]; if(!f) return; const r = new FileReader(); r.onload = () => { if(importPackText(r.result)) toast(L(`已导入数据包 · ${Object.keys(pack.bars).length} 只 · 基于 ${md(pack.asOf)} 收盘`, `Pack imported · ${Object.keys(pack.bars).length} symbols · ${md(pack.asOf)} close`)); }; r.readAsText(f); };
  inp.click();
}
function toast(msg){
  let t = document.getElementById('l3toast');
  if(!t){ t = document.createElement('div'); t.id = 'l3toast'; t.className = 'l3-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
}
// only speak up when something needs doing: no pack yet, or it is out of date
function packChipIfNeeded(){ return ''; }   // no chip on the pages; the offline pack import lives in Settings
function packChip(){
  if(pack && pack.source === 'live') return '';
  if(!pack) return `<button class="pk-chip none" onclick="pickPackFile()">📦 ${L('导入数据包','Import data pack')}</button>`;
  const a = packAge();
  const cls = a == null ? '' : a <= 1 ? 'ok' : 'old';
  return `<button class="pk-chip ${cls}" onclick="pickPackFile()" aria-label="${L('点击导入新的 loop-data.json','click to import a newer loop-data.json')}">📦 ${L('数据','Data')} ${md(pack.asOf)} ${L('收盘','close')}${a > 1 ? ' · ' + L(`晚了 ${a} 个交易日`, `${a} sessions old`) : ''}</button>`;
}

// ---------- live daily bars (Twelve Data, fetched straight from the browser) ----------
// tools/make-pack.js is only needed for offline use or option data; with a free Twelve Data key the
// Stock page, momentum board, radar and compare pull bars themselves and keep them in the same `pack`.
const TD_KEY = 'loop3_td_key_v1';       // like the Finnhub key: stays in this browser, not in backups
let tdKey = '';
const live = { queue:[], cur:null, running:false, stamps:[], done:0, total:0, err:{}, bad:null, waitUntil:0, saveT:null };
const liveOn = () => /\S/.test(tdKey);
const liveSym = s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);
const BENCH_SYMS = ['SPY','QQQ','SMH'];
function livePack(){
  if(!pack || pack.demo) pack = { v:1, source:'live', asOf:null, bars:{}, live:{} };
  if(!pack.live) pack.live = {};
  return pack;
}
function liveFresh(sym, relaxed){
  const b = S(sym), info = pack && pack.live && pack.live[sym];
  if(!b || !info) return false;
  const now = Date.now();
  if(barsFresh(b.t[b.t.length - 1], info, now)) return true;
  return !!relaxed && now - info.at < 6 * 3600e3;          // batch views do not need intraday freshness
}
function ensureBars(syms, o = {}){
  if(!liveOn() || live.bad) return;
  if(pack && pack.demo && !o.force) return;                 // demo data stays demo
  const now = Date.now();
  const want = [...new Set((syms || []).map(x => String(x || '').toUpperCase()).filter(liveSym))].filter(sym => {
    if(live.queue.includes(sym) || live.cur === sym) return false;
    const e = live.err[sym]; if(e && !o.force && now - e.at < 10 * 60000) return false;
    return o.force || !liveFresh(sym, o.relaxed);
  });
  if(!want.length) return;
  live.queue = o.first ? want.concat(live.queue) : live.queue.concat(want);
  live.total += want.length;
  liveRun(); liveRender();
}
async function liveRun(){
  if(live.running) return; live.running = true;
  while(live.queue.length && liveOn() && !live.bad){
    const wait = throttleDelay(live.stamps, Date.now());
    if(wait > 0){ live.waitUntil = Date.now() + wait; liveRender(); await new Promise(r => setTimeout(r, wait)); live.waitUntil = 0; continue; }
    const sym = live.queue.shift(); live.cur = sym; live.stamps.push(Date.now());
    try{
      const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=260&apikey=${encodeURIComponent(tdKey)}`);
      const bars = tdToBars(await r.json());
      if(!bars) throw new Error('no data');
      const P = livePack(); const at = Date.now();
      P.bars[sym] = bars; P.live[sym] = { at, partial: isMarketOpen(at) };
      const last = bars.t[bars.t.length - 1]; if(!P.asOf || last > P.asOf) P.asOf = last;
      delete live.err[sym]; clearIndCache();
    }catch(e){
      if(e.code === 429){ live.queue.unshift(sym); live.waitUntil = Date.now() + 61000; liveRender(); await new Promise(r => setTimeout(r, 61000)); live.waitUntil = 0; live.stamps.length = 0; continue; }
      if(e.code === 401 || e.code === 403 && /api ?key/i.test(e.message)){ live.bad = e.message; live.queue.length = 0; }
      else live.err[sym] = { msg: e instanceof TypeError ? L('网络不通','network error') : e.message, at: Date.now() };
    }
    live.cur = null; live.done++; liveRender();
  }
  live.cur = null; live.running = false; live.done = live.total = 0;
  clearTimeout(live.saveT); live.saveT = setTimeout(savePack, 300);
  liveRender();
}
function liveRender(){
  clearTimeout(liveRender._t);
  liveRender._t = setTimeout(() => {
    const act = document.querySelector('.tab-panel.active'), id = act && act.id;
    if(id === 'tab-stock'){ const q = document.getElementById('skSearch'); if(!(q && document.activeElement === q && q.value)) renderStock(); }
    else if(id === 'tab-watchlist'){ renderMomo(); renderRadar(); renderCompare(); }
    const st = document.getElementById('settingsModal'); if(st && st.classList.contains('show') && live.bad) { /* key error is shown on the page */ }
  }, 120);
}
function liveStatusHtml(){
  if(!liveOn()) return '';
  if(live.bad) return `<div class="live-status bad">${L('Twelve Data 报错：','Twelve Data: ')}${esc(live.bad)} <a class="lnk" onclick="openSettings()">${L('检查 key','check the key')}</a></div>`;
  if(live.queue.length || live.running){
    const w = live.waitUntil ? Math.max(1, Math.ceil((live.waitUntil - Date.now()) / 1000)) : 0;
    return `<div class="live-status">${L('正在联网获取 K 线','Loading live bars')} ${live.done}/${live.total}${w ? ' · ' + L(`限速，${w} 秒后继续`, `rate limit, resuming in ${w}s`) : ''}</div>`;
  }
  return '';
}
function saveTdKey(v){
  tdKey = String(v || '').trim(); live.bad = null; live.err = {};
  try{ tdKey ? window.storage.set(TD_KEY, tdKey) : (window.storage.remove ? window.storage.remove(TD_KEY) : window.storage.set(TD_KEY, '')); }catch(e){}
  if(tdKey && stockSym) ensureBars([stockSym, 'SPY'], { first:true });
  renderL3 && renderL3();
}
function liveSetupHtml(){
  return stepsCard(L('个股页要联网拿 K 线','The Stock page pulls live bars'), [
    L('到 <b>twelvedata.com</b> 免费注册（10 秒，不用信用卡），复制你的 API key。','Sign up free at <b>twelvedata.com</b> (10 seconds, no card) and copy your API key.'),
    L('把 key 粘贴到下面。免费版每分钟 8 次请求，LOOP 会自动排队。key 只存在这个浏览器里。','Paste it below. The free plan allows 8 requests a minute; LOOP queues them for you. The key stays in this browser.'),
  ], `<input id="tdKeyIn" class="sk-in" type="password" autocomplete="off" placeholder="${L('粘贴 Twelve Data key','Paste your Twelve Data key')}" style="max-width:240px" onkeydown="if(event.key==='Enter') saveTdKey(this.value)">
      <button class="btn-primary btn-small" onclick="saveTdKey(document.getElementById('tdKeyIn').value)">${L('保存','Save')}</button>
      <a class="lnk" onclick="pickPackFile()">${L('或导入离线数据包','or import an offline data pack')}</a>`);
}
function liveMissingHtml(sym){
  if(live.queue.includes(sym) || (live.running && !live.err[sym])) return `<div class="sk-status">${L(`正在获取 ${sym} 的 K 线…`, `Fetching bars for ${sym}…`)}</div>`;
  const e = live.err[sym];
  return `<div class="sk-status">${e ? L(`拿不到 ${sym} 的 K 线：`, `Couldn't load ${sym}: `) + esc(e.msg) : L(`还没有 ${sym} 的 K 线。`, `No bars for ${sym} yet.`)}
    <button class="btn-ghost btn-small" onclick="ensureBars(['${sym}','SPY'], {force:true, first:true})">${L('重试','Retry')}</button></div>`;
}
function liveBtn(rows){
  if(!liveOn() || live.bad) return '';
  return `<button class="btn-ghost btn-small" onclick="radarRefresh()">${L('刷新','Refresh')}</button>`;
}
function radarRefresh(){
  const need = BENCH_SYMS.concat(radarUniverse()).filter(s => !liveFresh(s, false));
  if(!need.length){ toast(L('数据已经是最新的','Already up to date')); return; }
  ensureBars(need, { relaxed:false });
  toast(L(`正在更新 ${need.length} 只（免费版每分钟 8 只，约 ${Math.ceil(need.length / 8)} 分钟）`, `Updating ${need.length} symbols (free plan: 8 a minute, about ${Math.ceil(need.length / 8)} min)`));
}

// ---------- series & indicators ----------
function S(sym){ const b = pack && pack.bars && pack.bars[sym]; return b && b.t && b.t.length > 1 ? b : null; }
let _ic = {};
function clearIndCache(){ _ic = {}; }
function sma(a, n, end){ end = end == null ? a.length : end; if(end < n) return null; let s = 0; for(let i = end - n; i < end; i++) s += a[i]; return s / n; }
function rsiOf(c, n=14){
  if(c.length < n + 1) return null;
  let g = 0, l = 0;
  for(let i = 1; i <= n; i++){ const d = c[i] - c[i-1]; if(d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for(let i = n + 1; i < c.length; i++){ const d = c[i] - c[i-1]; g = (g*(n-1) + Math.max(d,0)) / n; l = (l*(n-1) + Math.max(-d,0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function atrOf(b, n=14, end){
  end = end == null ? b.c.length : end; if(end < n + 1) return null;
  let s = 0; for(let i = end - n; i < end; i++) s += Math.max(b.h[i] - b.l[i], Math.abs(b.h[i] - b.c[i-1]), Math.abs(b.l[i] - b.c[i-1]));
  return s / n;
}
function ind(sym){
  const b = S(sym); if(!b) return null;
  if(_ic[sym]) return _ic[sym];
  const c = b.c, N = c.length, last = c[N-1], v = b.v;
  const ret = n => N > n ? (last / c[N-1-n] - 1) * 100 : null;
  const ma20 = sma(c, 20), ma50 = sma(c, 50), ma200 = sma(c, 200), ma20p = sma(c, 20, N - 5);
  const sn = (pack.snap || {})[sym] || {};
  const hi52 = N >= 200 ? Math.max(...b.h.slice(-252)) : (sn.hi52 || Math.max(...b.h));
  const lo52 = N >= 200 ? Math.min(...b.l.slice(-252)) : (sn.lo52 || Math.min(...b.l));
  const avg20 = N > 21 ? v.slice(N-21, N-1).reduce((a,x) => a + x, 0) / 20 : null;
  const top = [...Array(Math.min(20, N-1)).keys()].map(k => N-1-k).sort((x,y) => v[y] - v[x]).slice(0, 4);
  const hi20 = Math.max(...c.slice(-20));
  const o = { sym, last, date: b.t[N-1], n: N,
    chg1: ret(1), ret5: ret(5), ret20: ret(20), ret1m: ret(21), ret3m: ret(63),
    ma20, ma50, ma200, ma20Up: ma20p != null && ma20 > ma20p,
    rsi: rsiOf(c.slice(-150)), atr: atrOf(b), hi52, lo52,
    distHi52: (last / hi52 - 1) * 100, vsMa50: ma50 ? (last / ma50 - 1) * 100 : null, vsMa20: ma20 ? (last / ma20 - 1) * 100 : null,
    relVol: avg20 ? v[N-1] / avg20 : null, topUp: top.filter(i => c[i] > c[i-1]).length,
    hi20, distHi20: (last / hi20 - 1) * 100, dvol20: avg20 ? avg20 * last : null };
  return _ic[sym] = o;
}
// live price when we have one, else the pack's last close
function lastPx(sym){ const p = getPrice(sym); if(p != null) return p; const I = ind(sym); return I ? I.last : null; }

function retMap(sym, n){ const b = S(sym); if(!b) return null; const m = {}; for(let i = Math.max(1, b.c.length - n); i < b.c.length; i++) m[b.t[i]] = b.c[i] / b.c[i-1] - 1; return m; }
function pairStats(a, b, n){
  const key = 'pair|' + a + '|' + b + '|' + n; if(_ic[key] !== undefined) return _ic[key];
  const ra = retMap(a, n), rb = retMap(b, n);
  if(!ra || !rb) return _ic[key] = null;
  const ks = Object.keys(ra).filter(k => k in rb); if(ks.length < 30) return _ic[key] = null;
  const x = ks.map(k => ra[k]), y = ks.map(k => rb[k]);
  const mx = x.reduce((s,v)=>s+v,0)/x.length, my = y.reduce((s,v)=>s+v,0)/y.length;
  let sxy = 0, sxx = 0, syy = 0; for(let i = 0; i < x.length; i++){ sxy += (x[i]-mx)*(y[i]-my); sxx += (x[i]-mx)**2; syy += (y[i]-my)**2; }
  return _ic[key] = { corr: sxy / Math.sqrt(sxx*syy), beta: sxy / syy, n: ks.length };
}
function packBeta(sym){ if(sym === 'SPY') return 1; const p = pairStats(sym, 'SPY', 120); return p ? Math.round(p.beta * 100) / 100 : null; }
betaOf = function(sym){ const m = num(cfg.betas[sym]); if(m != null) return m; const pb = packBeta(sym); return pb != null ? pb : 1; };

// ---------- abnormal days ----------
// thresholds: ≥4% / ≥6% (5 days), raised for volatile names to 2.2 daily standard deviations
function abnTh(sym){
  const key = 'th|' + sym; if(_ic[key]) return _ic[key];
  const b = S(sym); if(!b) return { d1:4, d5:6 };
  const r = []; for(let i = Math.max(1, b.c.length - 60); i < b.c.length; i++) r.push((b.c[i] / b.c[i-1] - 1) * 100);
  const m = r.reduce((s,v)=>s+v,0)/r.length, sd = Math.sqrt(r.reduce((s,v)=>s+(v-m)**2,0)/r.length);
  return _ic[key] = { d1: Math.max(4, 2.2 * sd), d5: Math.max(6, 2.2 * sd * Math.sqrt(5)), sd };
}
function abnormalDays(sym, lookback=90){
  const b = S(sym); if(!b) return [];
  const c = b.c, N = c.length, out = [], th = abnTh(sym);
  for(let i = Math.max(5, N - lookback); i < N; i++){
    const d1 = (c[i] / c[i-1] - 1) * 100, d5 = (c[i] / c[i-5] - 1) * 100;
    if(Math.abs(d1) >= th.d1) out.push({ i, date: b.t[i], chg: d1, kind: '1d' });
    else if(Math.abs(d5) >= th.d5 && !out.some(x => i - x.i < 5)) out.push({ i, date: b.t[i], chg: d5, kind: '5d', from: b.t[i-5] });
  }
  return out;
}

// ---------- support / resistance ----------
function levelsFor(sym, lookback=120){
  const key = 'lv|' + sym + '|' + lookback; if(_ic[key]) return _ic[key];
  const b = S(sym), I = ind(sym); if(!b || !I || I.n < 30) return _ic[key] = [];
  const N = b.c.length, s0 = Math.max(1, N - lookback), last = I.last;
  const A = I.atr || last * 0.02, tol = Math.max(0.6 * A, last * 0.012);
  // swing pivots (3 bars each side; the last 2 bars may confirm with fewer)
  const piv = [];
  for(let i = s0 + 3; i < N - 1; i++){
    const lo = Math.max(s0, i - 3), hi = Math.min(N - 1, i + 3);
    let isH = true, isL = true;
    for(let j = lo; j <= hi; j++){ if(j === i) continue; if(b.h[j] > b.h[i]) isH = false; if(b.l[j] < b.l[i]) isL = false; }
    if(isH) piv.push(b.h[i]); if(isL) piv.push(b.l[i]);
  }
  piv.sort((x,y) => x - y);
  const cl = [];
  for(const p of piv){ const c = cl[cl.length-1]; if(c && p - c.mean <= tol){ c.ps.push(p); c.mean = c.ps.reduce((s,v)=>s+v,0)/c.ps.length; } else cl.push({ ps:[p], mean:p }); }
  let lv = cl.map(c => ({ mid: c.mean, lo: Math.max(Math.min(...c.ps), c.mean - 0.6*A), hi: Math.min(Math.max(...c.ps), c.mean + 0.6*A), touches: c.ps.length, ev: {} }));
  lv.forEach(l => { if(l.hi - l.lo < 0.5*A){ l.lo = l.mid - 0.25*A; l.hi = l.mid + 0.25*A; } if(l.touches >= 2) l.ev.touch = L(`过去碰到过 ${l.touches} 次`, `tested ${l.touches} times`); });
  const near = (l, v, pad) => v >= l.lo - pad && v <= l.hi + pad;
  const attach = (v, k, text, ownIfNone) => {
    const hit = lv.filter(l => near(l, v, 0.3*A));
    if(hit.length) hit.forEach(l => { if(!l.ev[k]) l.ev[k] = text; });
    else if(ownIfNone && Math.abs(v / last - 1) < 0.25) lv.push({ mid:v, lo:v - 0.3*A, hi:v + 0.3*A, touches:0, ev:{ [k]: text } });
  };
  [['ma20', I.ma20, L('20 日线','MA20')], ['ma50', I.ma50, L('50 日线','MA50')], ['ma200', I.ma200, L('200 日线','MA200')]].forEach(([k, v, t]) => { if(v) attach(v, 'ma', t, k !== 'ma20'); });
  // option open-interest walls
  const op = pack.options && pack.options[sym];
  if(op && op.strikes && op.strikes.length){
    const cs = op.strikes.map(r => r[1] || 0), ps = op.strikes.map(r => r[2] || 0);
    const med = a => { const s = a.slice().sort((x,y)=>x-y); return s[Math.floor(s.length/2)] || 0; };
    const mc = med(cs), mp = med(ps);
    op.strikes.forEach(r => {
      const [k, c, p, , , dc, dp] = r;
      if(k < last && p >= Math.max(1.4*mp, 50)) attach(k, 'opt', L(`期权 Put 集中（${kfmt(p)} 张${dp > 0 ? '，还在增加' : dp < 0 ? '，在减少' : ''}）`, `put open interest ${kfmt(p)}${dp > 0 ? ', rising' : dp < 0 ? ', falling' : ''}`), true);
      if(k > last && c >= Math.max(1.4*mc, 50)) attach(k, 'opt', L(`期权 Call 集中（${kfmt(c)} 张${dc > 0 ? '，还在增加' : dc < 0 ? '，在减少' : ''}）`, `call open interest ${kfmt(c)}${dc > 0 ? ', rising' : dc < 0 ? ', falling' : ''}`), true);
    });
  }
  // volume-at-price nodes
  const bins = {}; const w = tol;
  for(let i = s0; i < N; i++){ const tp = (b.h[i] + b.l[i] + b.c[i]) / 3; const k = Math.round(tp / w); bins[k] = (bins[k] || 0) + b.v[i]; }
  Object.entries(bins).sort((x,y) => y[1] - x[1]).slice(0, 3).forEach(([k]) => attach(+k * w, 'vol', L('成交最密集的价位','heavy trading zone'), true));
  // round numbers
  const step = last > 500 ? 50 : last > 100 ? 10 : last > 20 ? 5 : 1;
  lv.forEach(l => { const r = Math.round(l.mid / step) * step; if(near(l, r, 0.1*A)) l.ev.round = L(`$${fmt(r,0)} 整数关口`, `round number $${fmt(r,0)}`); });
  // merge overlapping bands
  lv.sort((x,y) => x.mid - y.mid);
  const merged = [];
  for(const l of lv){ const m = merged[merged.length-1]; if(m && l.lo <= m.hi){ m.lo = Math.min(m.lo, l.lo); m.hi = Math.max(m.hi, l.hi); m.mid = (m.lo + m.hi) / 2; m.touches += l.touches; Object.entries(l.ev).forEach(([k,t]) => { if(!m.ev[k]) m.ev[k] = t; }); if(m.ev.touch && m.touches >= 2) m.ev.touch = L(`过去碰到过 ${m.touches} 次`, `tested ${m.touches} times`); } else merged.push({ ...l, ev:{ ...l.ev } }); }
  const out = merged.filter(l => Object.keys(l.ev).length && Math.abs(l.mid / last - 1) < 0.3).map(l => {
    const kinds = Object.keys(l.ev);
    let score = kinds.length; if(kinds.length === 1 && kinds[0] === 'round') score = 1;
    return { ...l, score: Math.min(3, score), kinds, type: l.hi < last ? 'sup' : l.lo > last ? 'res' : 'at' };
  }).sort((x,y) => y.mid - x.mid);
  return _ic[key] = out;
}
const strengthTxt = s => s >= 3 ? L('强','strong') : s === 2 ? L('中','medium') : L('弱','weak');
const dots = s => '●'.repeat(s) + '○'.repeat(3 - s);
function nearestLevels(sym){
  const lv = levelsFor(sym), p = lastPx(sym);
  const sup = lv.filter(l => l.hi < p).sort((a,b) => b.mid - a.mid);
  const res = lv.filter(l => l.lo > p).sort((a,b) => a.mid - b.mid);
  return { sup, res, at: lv.find(l => l.lo <= p && l.hi >= p) || null, p };
}

// ---------- news direction (keyword based, shown as such) ----------
const POS_RE = /\b(upgrade[sd]?|beats?|tops|raises?|raised|record|surge[sd]?|soar(s|ed)?|jumps?|rall(y|ies|ied)|wins?|won|partnership|deal|buyback|outperform|bullish|strong demand|boosts?|hikes? (its )?(price )?target|lifts?|expands?|approval|approved)\b/i;
const NEG_RE = /\b(downgrade[sd]?|miss(es|ed)?|cuts?|lowers?|lawsuit|sued|probe|investigation|plunge[sd]?|tumbles?|falls?|fell|drops?|slump(s|ed)?|sell-?off|weak|delay(s|ed)?|recall|bearish|short[- ]seller|warns?|warning|halts?|ban|tariffs?|underperform|sinks?|slides?)\b/i;
const CAT_RE = [
  ['er', /\b(earnings|results|quarter|q[1-4]|eps|revenue|guidance|outlook)\b/i, '财报','Earnings'],
  ['an', /\b(analyst|upgrade|downgrade|price target|rating|initiat|overweight|underweight|buy rating|neutral)\b/i, '分析师','Analysts'],
  ['mg', /\b(ceo|cfo|executive|resign|appoint|insider|board|chief)\b/i, '管理层','Management'],
  ['pd', /\b(launch|product|chip|contract|deal|partnership|order|customer|unveil|platform|data center|supply)\b/i, '产品/订单','Product/deals'],
  ['mk', /\b(market|stocks|nasdaq|s&p|dow|fed|rates|inflation|tariff|economy|treasur|sector)\b/i, '大盘背景','Market backdrop'],
];
function newsTone(h){ const p = POS_RE.test(h), n = NEG_RE.test(h); return p && !n ? 1 : n && !p ? -1 : 0; }
function newsCat(h){ for(const [k, re, zh, en] of CAT_RE) if(re.test(h)) return { k, t:L(zh, en) }; return { k:'ot', t:L('其他','Other') }; }
function newsFor(sym){
  const a = (fh.news[sym] && fh.news[sym].d) || [];
  const b = (myNews.items || []).filter(n => n.sym === sym);
  const seen = new Set(), out = [];
  a.concat(b).forEach(n => { const k = (n.headline || '').toLowerCase().slice(0, 80); if(!n.headline || seen.has(k)) return; seen.add(k); out.push(n); });
  return out.sort((x,y) => y.datetime - x.datetime);
}
function newsDir(sym, days){
  const I = ind(sym); const since = Date.now()/1000 - days * 86400;
  const list = newsFor(sym).filter(n => n.datetime >= since);
  if(!list.length) return { dir:'none', n:0 };
  const s = list.reduce((a,n) => a + newsTone(n.headline), 0);
  if(!s || !I) return { dir:'none', n:list.length };
  return { dir: Math.sign(s) === Math.sign(I.ret5 || 0) ? 'agree' : 'opposite', n:list.length, s };
}

// ---------- short-term momentum (same rules as the premarket briefing) ----------
function momentum(sym){
  const I = ind(sym), SP = ind('SPY'), b = S(sym);
  if(!I || I.n < 55) return null;
  const ev = [], neg = [], crit = []; let sc = 0, grp = 'trend';
  const ok = (cond, t) => { crit.push({ g: grp, ok: !!cond, t }); if(cond){ sc++; ev.push(t); } };
  ok(I.last > I.ma20 && I.ma20 > I.ma50, L('价格 > 20日线 > 50日线','price > MA20 > MA50'));
  ok(I.ma20Up, L('20 日线向上','MA20 rising'));
  grp = 'rs';
  if(SP){
    ok(I.ret5 > SP.ret5, L(`5 日 ${sg(I.ret5)}，强于 SPY ${sg(SP.ret5)}`, `5d ${sg(I.ret5)} vs SPY ${sg(SP.ret5)}`));
    ok(I.ret20 > SP.ret20, L(`20 日 ${sg(I.ret20)}，强于 SPY ${sg(SP.ret20)}`, `20d ${sg(I.ret20)} vs SPY ${sg(SP.ret20)}`));
  }
  grp = 'vol';
  const volUp = I.relVol > 1.5 && I.chg1 > 0;
  ok(volUp || I.topUp >= 3, volUp ? L(`放量上涨（${fmt(I.relVol,1)} 倍均量）`, `up on ${fmt(I.relVol,1)}× volume`) : L(`近 20 日最大的 4 个量能日里 ${I.topUp} 个是上涨`, `${I.topUp} of the 4 biggest volume days were up`));
  grp = 'pos';
  const touched = Math.min(...b.l.slice(-3)) <= I.ma20 * 1.005;
  const pullHeld = I.vsMa20 >= 0 && I.vsMa20 <= 2 && touched;
  ok(I.distHi20 >= -3 || pullHeld, I.distHi20 >= -3 ? L(`距 20 日高点 ${fmt(Math.abs(I.distHi20),1)}%`, `${fmt(Math.abs(I.distHi20),1)}% from the 20-day high`) : L('回踩 20 日线守住','pulled back to MA20 and held'));
  const nd = newsDir(sym, 5);
  grp = 'news';
  ok(nd.dir === 'agree', nd.dir === 'none' ? L('近 5 天没有可判断方向的新闻','no directional news in 5 days') : nd.dir === 'agree' ? L('近 5 天新闻和走势同向','news agrees with price (5d)') : L('近 5 天新闻和走势相反','news opposes price (5d)'));
  crit[crit.length - 1].na = nd.dir === 'none';
  if(I.rsi > 75){ sc--; neg.push(L(`RSI ${fmt(I.rsi,0)} 过热`, `RSI ${fmt(I.rsi,0)} overheated`)); }
  if(I.vsMa20 > 15){ sc--; neg.push(L(`高于 20 日线 ${fmt(I.vsMa20,0)}%`, `${fmt(I.vsMa20,0)}% above MA20`)); }
  const flags = [];
  const er = earningsBetween(sym, todayISO(), addDays(todayISO(), 10))[0];
  if(er) flags.push(L(`${md(er)} 财报`, `earnings ${md(er)}`));
  if(nd.dir === 'opposite') flags.push(L('新闻与走势相反','news opposes price'));
  if(isLev(sym)) flags.push(L('杠杆 ETF，均线信号失真','leveraged ETF'));
  const entry = I.distHi20 >= -3 ? I.hi20 : I.ma20;
  const lows10 = Math.min(...b.l.slice(-10));
  const cands = [lows10, I.ma50].filter(v => v && v < entry * 0.995);
  const base = cands.length ? Math.max(...cands) : entry - 2 * I.atr;
  const stop = +(base * 0.99).toFixed(2);
  const res = levelsFor(sym).filter(l => l.lo > entry * 1.01).sort((a,c) => a.mid - c.mid)[0];
  const r = entry - stop;
  const target = res && (res.lo - entry) >= 1.2 * r ? +res.lo.toFixed(2) : +(entry + 2 * r).toFixed(2);
  // for a stock you already hold: where a trailing stop would sit (just under the nearest support below today's price)
  const hc = [lows10, I.ma20, I.ma50].filter(v => v && v < I.last * 0.99);
  const holdStop = hc.length ? +(Math.max(...hc) * 0.99).toFixed(2) : null;
  return { sym, I, score: sc, grade: sc >= 5 ? 'hi' : sc >= 3 ? 'mid' : 'lo', ev, neg, flags, nd, crit, holdStop,
    entry: +entry.toFixed(2), entryKind: I.distHi20 >= -3 ? 'brk' : 'ma20', stop, riskPct: (entry - stop) / entry * 100, target };
}
const gradeTxt = g => ({ hi:L('强','Strong'), mid:L('中','Medium'), lo:L('弱','Weak') })[g];

// ---------- Finnhub (free endpoints only), throttled + cached ----------
let fhChain = Promise.resolve(), fhBusy = 0;
function fhGet(path){
  const run = async () => {
    await new Promise(r => setTimeout(r, 350));
    const url = `https://finnhub.io/api/v1/${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(finnhubKey)}`;
    let r = await fetch(url);
    if(r.status === 429){ await new Promise(res => setTimeout(res, 3000)); r = await fetch(url); }
    if(r.status === 401 || r.status === 403) throw new Error('forbidden');
    if(!r.ok) throw new Error('http ' + r.status);
    return r.json();
  };
  const p = fhChain.then(run, run); fhChain = p.catch(() => {}); return p;
}
let fhSaveT = null;
function saveFh(){ clearTimeout(fhSaveT); fhSaveT = setTimeout(() => { try{ window.storage.set(FH_KEY, JSON.stringify(fh)); }catch(e){} }, 400); }
const fhFresh = (kind, sym, hours) => fh[kind][sym] && Date.now() - fh[kind][sym].at < hours * 3600e3;
async function fhLoad(kind, sym, hours, path, map){
  if(!/\S/.test(finnhubKey)) return null;
  if(fhFresh(kind, sym, hours)) return fh[kind][sym].d;
  try{ const d = map(await fhGet(path)); fh[kind][sym] = { at: Date.now(), d }; saveFh(); return d; }
  catch(e){ fh[kind][sym] = { at: Date.now() - (hours - 1) * 3600e3, d: (fh[kind][sym] && fh[kind][sym].d) || null, err: e.message }; return null; }
}
const loadInsider = sym => fhLoad('insider', sym, 12, `stock/insider-transactions?symbol=${sym}&from=${addDays(todayISO(), -120)}`, j => (j.data || []).map(x => ({ name:x.name, share:x.share, change:x.change, date:x.transactionDate || x.filingDate, filed:x.filingDate, code:x.transactionCode, price:x.transactionPrice })));
const loadEr = sym => fhLoad('er', sym, 24, `calendar/earnings?symbol=${sym}&from=${addDays(todayISO(), -420)}&to=${addDays(todayISO(), 120)}`, j => (j.earningsCalendar || []).map(e => ({ date:e.date, hour:e.hour, act:e.epsActual, est:e.epsEstimate, q:e.quarter, y:e.year, revAct:e.revenueActual, revEst:e.revenueEstimate })));
const loadEps = sym => fhLoad('eps', sym, 72, `stock/earnings?symbol=${sym}`, j => (Array.isArray(j) ? j : []).map(e => ({ period:e.period, act:e.actual, est:e.estimate, sp:e.surprisePercent })));
const loadNews90 = sym => fhLoad('news', sym, 6, `company-news?symbol=${sym}&from=${addDays(todayISO(), -90)}&to=${todayISO()}`, j => (Array.isArray(j) ? j : []).slice(0, 300).map(n => ({ sym, headline:n.headline, source:n.source, url:n.url, datetime:n.datetime })));
const loadMetric = sym => fhLoad('metric', sym, 24*7, `stock/metric?symbol=${sym}&metric=all`, j => { const m = j.metric || {}; return { mcap:m.marketCapitalization, pe:m.peTTM ?? m.peBasicExclExtraTTM ?? m.peExclExtraTTM, ps:m.psTTM, gm:m.grossMarginTTM, om:m.operatingMarginTTM, rg:m.revenueGrowthTTMYoy, rg3:m.revenueGrowth3Y, beta:m.beta }; });

// insider classification and alert rules (from the plan doc)
function insiderView(sym){
  const rows = (fh.insider[sym] && fh.insider[sym].d) || null;
  if(!rows) return null;
  const since = addDays(todayISO(), -90);
  const r = rows.filter(x => d10(x.date) >= since);
  const buys = r.filter(x => x.code === 'P'), sells = r.filter(x => x.code === 'S'), other = r.filter(x => x.code !== 'P' && x.code !== 'S');
  const alerts = [];
  buys.forEach(x => alerts.push({ k:'buy', date:x.date, t:L(`${x.name} 在公开市场买入 ${kfmt(Math.abs(x.change))} 股${x.price ? ' @ $' + fmt(x.price) : ''}`, `${x.name} bought ${kfmt(Math.abs(x.change))} sh in the open market`) }));
  const sd = sells.slice().sort((a,b) => d10(a.date) < d10(b.date) ? -1 : 1);
  for(let i = 0; i < sd.length; i++){
    const win = sd.filter(x => daysBetween(d10(sd[i].date), d10(x.date)) >= 0 && daysBetween(d10(sd[i].date), d10(x.date)) <= 7);
    const names = [...new Set(win.map(x => x.name))];
    if(names.length >= 3 && !alerts.some(a => a.k === 'cluster')){ alerts.push({ k:'cluster', date:sd[i].date, t:L(`${md(sd[i].date)} 起 7 天内 ${names.length} 位内部人卖出`, `${names.length} insiders sold within 7 days of ${md(sd[i].date)}`) }); }
  }
  sells.forEach(x => { const before = (x.share || 0) + Math.abs(x.change || 0); const frac = before > 0 ? Math.abs(x.change) / before : 0; if(frac >= 0.2) alerts.push({ k:'big', date:x.date, t:L(`${x.name} 一次卖出持股的 ${fmt(frac*100,0)}%`, `${x.name} sold ${fmt(frac*100,0)}% of holdings`) }); });
  const val = a => a.reduce((s,x) => s + Math.abs(x.change || 0) * (x.price || 0), 0);
  return { rows: r, buys, sells, other, alerts, buyVal: val(buys), sellVal: val(sells) };
}

/* ---------- stock page ---------- */
let stockSym = null, stockDays = 120, stockMode = 'stock';
let cmp = { a:null, b:null, months:3, spy:true };

function openStock(sym){
  sym = String(sym || '').toUpperCase().trim(); if(!sym) return;
  stockSym = sym; stockMode = 'stock';
  cfg.recentStocks = [sym, ...(cfg.recentStocks || []).filter(s => s !== sym)].slice(0, 8); saveCfg();
  switchTab('stock'); renderStock(); loadStockExtras(sym);
  ensureBars([sym, 'SPY'], { first:true });
}
async function loadStockExtras(sym){
  if(!/\S/.test(finnhubKey)) return;
  const again = () => { if(stockSym === sym && stockMode === 'stock' && document.getElementById('tab-stock').classList.contains('active')) renderStock(); };
  for(const f of [loadNews90, loadEr, loadInsider, loadEps]){ try{ await f(sym); }catch(e){} again(); }
}
function stockSearch(e){ if(e.key === 'Enter'){ openStock(e.target.value); } }

function chartSvg(sym, days, o={}){
  const b = S(sym); if(!b) return '';
  const N = b.c.length, s0 = Math.max(0, N - days), n = N - s0;
  const W = 860, padL = 8, padR = 62, top = 12, ph = 250, vh = 46, gap = 8, H = top + ph + gap + vh + 20;
  const plan = activePlans().find(p => p.sym === sym);
  const lvAll = o.levels === false ? [] : levelsFor(sym, Math.max(120, days));
  const lp0 = b.c[N-1];
  const ns = lvAll.filter(l => l.hi < lp0).sort((x,y) => y.mid - x.mid)[0], nr = lvAll.filter(l => l.lo > lp0).sort((x,y) => x.mid - y.mid)[0];
  const lv = lvAll.map(l => (l.score >= 2 || l === ns || l === nr || (l.lo <= lp0 && l.hi >= lp0)) ? l : null);
  let lo = Math.min(...b.l.slice(s0)), hi = Math.max(...b.h.slice(s0));
  const inR = v => v != null && v > lo * 0.82 && v < hi * 1.18;
  if(plan){ [plan.stop, plan.lo, plan.hi, plan.target].forEach(v => { if(inR(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } }); }
  const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
  const pw = W - padL - padR, cw = pw / n;
  const X = i => padL + (i - s0 + 0.5) * cw, Y = v => top + (hi - v) / (hi - lo) * ph;
  const vmax = Math.max(...b.v.slice(s0)) || 1;
  const VY = v => top + ph + gap + vh - v / vmax * vh;
  let g = '';
  // level bands
  lv.forEach((l, idx) => {
    if(!l || l.hi < lo || l.lo > hi) return;
    const y1 = Y(Math.min(hi, l.hi)), y2 = Y(Math.max(lo, l.lo));
    const col = l.type === 'sup' ? 'var(--gain)' : l.type === 'res' ? 'var(--loss)' : '#8a8577';
    const op = 0.07 + 0.05 * l.score;
    const click = l.type !== 'res' ? `onclick="planFromLevel('${sym}', ${idx})" class="lv-band click"` : 'class="lv-band"';
    g += `<g ${click}><title>${px(l.lo)}–${px(l.hi)} · ${strengthTxt(l.score)} · ${Object.values(l.ev).join(' · ')}${l.type !== 'res' ? '\n' + L('点击用这个支撑建计划', 'click to plan from this support') : ''}</title>
      <rect x="${padL}" y="${y1}" width="${pw}" height="${Math.max(3, y2 - y1)}" fill="${col}" opacity="${op}"/>
      <text x="${W - padR + 6}" y="${(y1 + y2) / 2 + 3.5}" class="ch-lv" fill="${col}">${dots(l.score)}</text></g>`;
  });
  // plan
  if(plan){
    const yz1 = Y(plan.hi), yz2 = Y(plan.lo);
    g += `<rect x="${padL}" y="${yz1}" width="${pw}" height="${Math.max(2, yz2 - yz1)}" fill="none" stroke="var(--gain)" stroke-dasharray="5 4" stroke-width="1.3"/>
      <text x="${padL + 4}" y="${yz1 - 4}" class="ch-tx" fill="var(--gain)">${L('计划区','plan zone')} ${px(plan.lo)}–${px(plan.hi)}</text>`;
    if(inR(plan.stop)) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(plan.stop)}" y2="${Y(plan.stop)}" stroke="var(--loss)" stroke-dasharray="3 4"/><text x="${padL + 4}" y="${Y(plan.stop) - 4}" class="ch-tx" fill="var(--loss)">${L('止损','stop')} ${px(plan.stop)}</text>`;
    if(inR(plan.target)) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(plan.target)}" y2="${Y(plan.target)}" stroke="var(--text)" stroke-dasharray="3 4" opacity=".6"/><text x="${padL + 4}" y="${Y(plan.target) - 4}" class="ch-tx">${L('目标','target')} ${px(plan.target)}</text>`;
  }
  // grid + month labels
  let lastM = '';
  for(let i = s0; i < N; i++){ const m = b.t[i].slice(0, 7); if(m !== lastM){ if(lastM) g += `<line x1="${X(i) - cw/2}" x2="${X(i) - cw/2}" y1="${top}" y2="${top + ph + gap + vh}" class="ch-grid"/><text x="${X(i) - cw/2 + 3}" y="${H - 5}" class="ch-ax">${+m.slice(5)}${L('月','')}${lang === 'en' ? ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m.slice(5)] : ''}</text>`; lastM = m; } }
  // price axis ticks
  for(let k = 0; k <= 4; k++){ const v = lo + (hi - lo) * k / 4; g += `<text x="${W - 4}" y="${Y(v) + 3}" class="ch-ax" text-anchor="end">${fmt(v, v >= 100 ? 0 : 1)}</text>`; }
  // MAs
  const maPath = (n2, col) => { let d = ''; for(let i = Math.max(s0, n2 - 1); i < N; i++){ const m = sma(b.c, n2, i + 1); if(m == null) continue; d += (d ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(m).toFixed(1); } return d ? `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.4" opacity=".85"/>` : ''; };
  g += maPath(20, '#C9892B') + maPath(50, '#5A6FD0');
  // candles + volume
  const bw = Math.max(1, cw * 0.62);
  for(let i = s0; i < N; i++){
    const up = b.c[i] >= b.o[i], col = up ? 'var(--gain)' : 'var(--loss)';
    const y1 = Y(Math.max(b.o[i], b.c[i])), y2 = Y(Math.min(b.o[i], b.c[i]));
    g += `<g><title>${b.t[i]}  O ${fmt(b.o[i])} H ${fmt(b.h[i])} L ${fmt(b.l[i])} C ${fmt(b.c[i])} · ${i ? sg((b.c[i]/b.c[i-1]-1)*100) : ''} · Vol ${kfmt(b.v[i])}</title>
      <line x1="${X(i)}" x2="${X(i)}" y1="${Y(b.h[i])}" y2="${Y(b.l[i])}" stroke="${col}" stroke-width="1"/>
      <rect x="${X(i) - bw/2}" y="${y1}" width="${bw}" height="${Math.max(1, y2 - y1)}" fill="${up ? 'var(--panel)' : col}" stroke="${col}" stroke-width="1"/>
      <rect x="${X(i) - bw/2}" y="${VY(b.v[i])}" width="${bw}" height="${top + ph + gap + vh - VY(b.v[i])}" fill="${col}" opacity=".35"/></g>`;
  }
  // abnormal days
  abnormalDays(sym, n).filter(a => a.i >= s0).forEach(a => { g += `<circle cx="${X(a.i)}" cy="${a.chg > 0 ? Y(b.h[a.i]) - 7 : Y(b.l[a.i]) + 7}" r="2.6" fill="${a.chg > 0 ? 'var(--gain)' : 'var(--loss)'}"><title>${L('异常日','abnormal day')} ${b.t[a.i]} ${sg(a.chg)}${a.kind === '5d' ? L('（5 日累计）',' (5-day)') : ''}</title></circle>`; });
  // my trades
  const idxOf = {}; b.t.forEach((t, i) => idxOf[t] = i);
  AT().filter(t => t.sym === sym).forEach(t => {
    const i = idxOf[d10(t.date)]; if(i == null || i < s0) return;
    const buy = t.side === 'BUY', y = buy ? Y(b.l[i]) + 13 : Y(b.h[i]) - 13;
    g += `<g class="ch-trade"><title>${buy ? L('买入','Buy') : L('卖出','Sell')} ${fmt(t.qty,0)} @ $${fmt(t.price)} · ${d10(t.date)}</title><path d="${buy ? `M${X(i)} ${y - 6} l5 8 h-10z` : `M${X(i)} ${y + 6} l5 -8 h-10z`}" fill="${buy ? 'var(--gain)' : 'var(--loss)'}" stroke="var(--panel)" stroke-width="1"/></g>`;
  });
  // last price tag
  const lp = b.c[N-1];
  g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(lp)}" y2="${Y(lp)}" stroke="var(--text)" stroke-width=".7" stroke-dasharray="1 3"/>
    <rect x="${W - padR + 2}" y="${Y(lp) - 9}" width="${padR - 4}" height="18" rx="4" fill="var(--text)"/><text x="${W - padR + padR/2}" y="${Y(lp) + 4}" class="ch-last" text-anchor="middle">${fmt(lp, lp >= 100 ? 1 : 2)}</text>`;
  return `<svg class="kchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}

function sparkSvg(sym, days=60, w=120, h=32){
  const b = S(sym); if(!b) return '';
  const c = b.c.slice(-days); const lo = Math.min(...c), hi = Math.max(...c);
  const d = c.map((v, i) => (i ? 'L' : 'M') + (i / (c.length - 1) * w).toFixed(1) + ' ' + (h - 2 - (v - lo) / (hi - lo || 1) * (h - 4)).toFixed(1)).join('');
  const up = c[c.length-1] >= c[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${up ? 'var(--gain)' : 'var(--loss)'}" stroke-width="1.5"/></svg>`;
}

// ---------- plan prefill ----------
function prefillPlan(o){
  switchTab('watchlist');
  openPlanForm();
  setTimeout(() => {
    const set = (i, v) => { const e = document.getElementById(i); if(e && v != null) e.value = v; };
    set('pf-sym', o.sym); set('pf-lo', o.lo); set('pf-hi', o.hi); set('pf-stop', o.stop); set('pf-tgt', o.target); set('pf-note', o.note || '');
    planPreview();
    document.getElementById('plansSection').scrollIntoView({ behavior:'smooth', block:'start' });
  }, 40);
}
const r2 = v => Math.round(v * 100) / 100;
function planFromLevel(sym, idx){
  const lv = levelsFor(sym, Math.max(120, stockDays)); const l = lv[idx]; if(!l) return;
  const I = ind(sym), A = I.atr || I.last * 0.02, p = lastPx(sym);
  const below = lv.filter(x => x.hi < l.lo && x.mid > l.lo * 0.88).sort((a,b) => b.mid - a.mid)[0];
  const stop = below ? below.lo - 0.25 * A : l.lo - A;
  const res = lv.filter(x => x.lo > Math.max(p, l.hi) * 1.01).sort((a,b) => a.mid - b.mid)[0];
  const mid = (l.lo + l.hi) / 2;
  const target = res ? res.lo : mid + 2 * (mid - stop);
  prefillPlan({ sym, lo:r2(l.lo), hi:r2(l.hi), stop:r2(stop), target:r2(target), note:L(`支撑 ${px(l.lo)}–${px(l.hi)}（${Object.values(l.ev).join('、')}）`, `support ${px(l.lo)}–${px(l.hi)} (${Object.values(l.ev).join(', ')})`) });
}
function planFromMomentum(sym){
  const m = momentum(sym); if(!m) return;
  const A = m.I.atr || m.entry * 0.02;
  const lo = m.entryKind === 'brk' ? m.entry : m.entry - 0.5 * A, hi = m.entryKind === 'brk' ? m.entry + 0.5 * A : m.entry + 0.25 * A;
  prefillPlan({ sym, lo:r2(lo), hi:r2(hi), stop:m.stop, target:m.target, note:L(`短线动能 ${m.score} 分 · ${m.entryKind === 'brk' ? '突破 20 日高' : '回踩 20 日线'}`, `momentum ${m.score} · ${m.entryKind === 'brk' ? '20-day breakout' : 'MA20 pullback'}`) });
}
function addWatchSym(sym){
  if(watchlist.some(w => w.sym === sym)){ toast(L(`${sym} 已经在观察中`, `${sym} is already watched`)); return; }
  watchlist.unshift({ id:'tg' + Date.now(), sym, action:'WATCH', level:'', note:'' }); saveWatch(); toast(L(`已把 ${sym} 加入观察`, `Added ${sym} to watching`)); render(); renderTargets(); if(typeof renderRadar === 'function') renderRadar();
}

// ---------- stock page sections ----------
// one plain-language conclusion for the stock page header
function verdict(sym){
  const I = ind(sym), nl = nearestLevels(sym), p = nl.p;
  const sup = nl.sup.find(l => l.score >= 2) || nl.sup[0], res = nl.res.find(l => l.score >= 2) || nl.res[0];
  const supTxt = sup ? L(`下方支撑 ${px(sup.hi)}（${sg((sup.hi / p - 1) * 100)}）`, `support ${px(sup.hi)} (${sg((sup.hi / p - 1) * 100)})`) : '';
  const resTxt = res ? L(`上方压力 ${px(res.lo)}（${sg((res.lo / p - 1) * 100)}）`, `resistance ${px(res.lo)} (${sg((res.lo / p - 1) * 100)})`) : '';
  const above50 = I.ma50 && p >= I.ma50;
  if(above50 && I.ma20Up){
    return { k:'up', t:L('上升趋势','Uptrend'), s: I.distHi20 >= -3 ? L(`贴近 20 日高点，${resTxt ? resTxt + '，' : ''}站上去就是突破`, `near the 20-day high${resTxt ? '; ' + resTxt : ''}`) : L(`${supTxt}，回到这里是买点`, `${supTxt} — a pullback there is the entry`) };
  }
  if(above50) return { k:'pull', t:L('上升趋势里的回调','Pullback in an uptrend'), s: L(`还在 50 日线上方，但 20 日线已经拐头向下。${supTxt}，守住可以等反弹`, `still above MA50 but MA20 has turned down. ${supTxt}; if it holds, wait for the bounce`) };
  if(I.ma20Up) return { k:'pull', t:L('下跌后反弹','Rebound after a drop'), s: L(`还在 50 日线（${px(I.ma50)}）下方，站回去才算转强。${resTxt}`, `still below MA50 (${px(I.ma50)}); it is only stronger back above it. ${resTxt}`) };
  return { k:'down', t:L('下跌趋势','Downtrend'), s: L(`在 50 日线下方 ${fmt(-I.vsMa50,0)}%，20 日线向下。先别抄底，等站回 ${px(I.ma50)}`, `${fmt(-I.vsMa50,0)}% below MA50 with MA20 falling. Don’t catch it — wait for ${px(I.ma50)}`) };
}
function statusLine(sym){
  const I = ind(sym); if(!I) return '';
  const nl = nearestLevels(sym), p = nl.p, out = [];
  if(I.ma50) out.push(I.last >= I.ma50 ? L(`在 50 日线上方 ${fmt(I.vsMa50,0)}%`, `${fmt(I.vsMa50,0)}% above MA50`) : L(`在 50 日线下方 ${fmt(-I.vsMa50,0)}%`, `${fmt(-I.vsMa50,0)}% below MA50`));
  out.push(I.ma20Up ? L('20 日线向上','MA20 rising') : L('20 日线向下','MA20 falling'));
  if(nl.at) out.push(L(`正在${nl.at.type === 'res' ? '压力' : '支撑'}带 ${px(nl.at.lo)}–${px(nl.at.hi)} 里`, `inside the ${px(nl.at.lo)}–${px(nl.at.hi)} band`));
  else if(nl.sup[0]) out.push(L(`距支撑 ${px(nl.sup[0].hi)} 还有 ${fmt((p / nl.sup[0].hi - 1) * 100, 1)}%`, `${fmt((p / nl.sup[0].hi - 1) * 100, 1)}% above support ${px(nl.sup[0].hi)}`));
  return out.join(' · ');
}

function scenariosHtml(sym){
  const I = ind(sym); if(!I) return '';
  const nl = nearestLevels(sym), p = nl.p, H = holdingsNow(), h = H.map[sym], q = h ? h.qty : 0;
  const plan = activePlans().find(x => x.sym === sym);
  const s1 = nl.sup.find(l => l.score >= 2) || nl.sup[0], r1 = nl.res.find(l => l.score >= 2) || nl.res[0];
  const stop = plan ? plan.stop : num(cfg.stops[sym]) ?? (s1 ? (nl.sup.find(l => l.mid < s1.lo) || { lo: s1.lo - I.atr }).lo : null);
  const goal = parseGoal(cfg.weekTarget); const wk = v => goal ? L(`，≈ ${fmt(Math.abs(v) / ((goal.min + goal.max)/2), 1)} 周目标`, `, ≈ ${fmt(Math.abs(v) / ((goal.min + goal.max)/2), 1)} wks of target`) : '';
  const rows = [];
  if(s1){ const d = (s1.mid / p - 1) * 100; rows.push({ ico:'↘', k:L('回落','Pullback'), t:L(`回到 ${px(s1.lo)}–${px(s1.hi)}（${sg(d)}）`, `back to ${px(s1.lo)}–${px(s1.hi)} (${sg(d)})`),
    a: plan ? (inZone(plan, s1.mid) ? L('正好在你的计划区，按批次买','that is your plan zone — buy in tranches') : L(`计划区是 ${px(plan.lo)}–${px(plan.hi)}，这里先观察`, `your zone is ${px(plan.lo)}–${px(plan.hi)}; watch here`)) : q > 0 ? L(`持仓浮动 ${money((s1.mid - p) * q)}，看能否守住`, `position moves ${money((s1.mid - p) * q)}; see if it holds`) : L('可以从这个支撑建计划','a candidate zone for a plan') }); }
  if(r1){ const d = (r1.hi / p - 1) * 100; rows.push({ ico:'↗', k:L('突破','Breakout'), t:L(`站上 ${px(r1.hi)}（${sg(d)}）`, `closes above ${px(r1.hi)} (${sg(d)})`),
    a: q > 0 ? L(`浮盈 +${money((r1.hi - p) * q).replace('$','$')}，可以上移止损`, `+${money((r1.hi - p) * q)} — consider trailing the stop`) : L(`下一档 ${nl.res[1] ? px(nl.res[1].lo) : '—'}；追突破等回踩确认`, `next ${nl.res[1] ? px(nl.res[1].lo) : '—'}; wait for a retest`) }); }
  if(stop != null && stop < p){ const d = (stop / p - 1) * 100; const loss = q > 0 ? (stop - p) * q : null; rows.push({ ico:'✕', k:L('失效','Invalidated'), t:L(`跌破 ${px(stop)}（${sg(d)}）`, `breaks ${px(stop)} (${sg(d)})`),
    a: loss != null ? L(`按计划离场，这笔亏 ${money(loss)}${wk(loss)}`, `exit per plan: ${money(loss)}${wk(loss)}`) : L('思路不成立，别抄底','the setup is wrong — don’t catch it'), bad:true }); }
  return rows.length ? `<div class="sc-list">${rows.map(r => `<div class="sc-row ${r.bad ? 'bad' : ''}"><span class="sc-ico">${r.ico}</span><b>${r.k}</b><span class="sc-t">${r.t}</span><span class="sc-a">${r.a}</span></div>`).join('')}</div>` : '';
}

function ladderHtml(sym, all){
  const lv = levelsFor(sym, Math.max(120, stockDays)); if(!lv.length) return `<div class="muted sm">${L('数据不够，算不出价位','not enough data for levels')}</div>`;
  const p = lastPx(sym);
  const sup = lv.filter(l => l.hi < p).sort((a,b) => b.mid - a.mid), res = lv.filter(l => l.lo > p).sort((a,b) => a.mid - b.mid);
  const pick = arr => arr.find(l => l.score >= 2) || arr[0];
  const plan = activePlans().find(x => x.sym === sym), stop = plan ? plan.stop : num(cfg.stops[sym]);
  const S1 = pick(sup), R1 = pick(res);
  const vis = all ? [...res.slice(0, 3), ...sup.slice(0, 3)] : [R1, S1].filter(Boolean);
  const pts = [p, ...vis.flatMap(l => [l.lo, l.hi])]; if(stop != null && stop < p) pts.push(stop);
  let lo = Math.min(...pts), hi = Math.max(...pts); const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const X = v => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%';
  const pr = v => '$' + fmt(v, v >= 100 ? 0 : 2);
  const why = l => esc(Object.values(l.ev).join(L('、',', ')));
  const zones = vis.map(l => `<div class="lr-zone ${l.hi < p ? 'sup' : 'res'} s${l.score}" style="left:${X(l.lo)}; width:calc(${X(l.hi)} - ${X(l.lo)})" title="${pr(l.lo)}–${pr(l.hi)} · ${why(l)}"></div>`).join('');
  const labels = vis.map(l => `<div class="lr-lb ${l.hi < p ? 'sup' : 'res'}" style="left:calc((${X(l.lo)} + ${X(l.hi)}) / 2)">${l.hi < p ? L('支撑','support') : L('压力','resist')}<b>${pr(l.hi < p ? l.hi : l.lo)}</b></div>`).join('');
  const stopM = stop != null && stop < p ? `<div class="lr-stop" style="left:${X(stop)}"></div><div class="lr-lb stop" style="left:${X(stop)}">${L('止损','stop')}<b>${pr(stop)}</b></div>` : '';
  return `<div class="lr">
      <div class="lr-track"></div>${zones}${stopM}
      <div class="lr-now" style="left:${X(p)}"><span>${pr(p)}</span></div>${labels}</div>
    <div class="lr-rows">${[R1, S1].filter(Boolean).map(l => { const isS = l.hi < p;
      return `<div class="lr-row ${isS ? 'sup' : 'res'}"><span class="lr-k">${isS ? L('下方支撑','Support') : L('上方压力','Resistance')}</span>
        <span class="lr-p">${pr(l.lo)}–${pr(l.hi)}<small>${sg(((isS ? l.hi : l.lo) / p - 1) * 100)}</small></span>
        <span class="lr-s s${l.score}">${l.score >= 3 ? L('强','Strong') : l.score === 2 ? L('中','Medium') : L('弱','Weak')}</span>
        <span class="lr-w">${why(l)}</span>
        </div>`; }).join('')}</div>`;
}
// the nearest support below price — what the header "Plan" button builds a plan from
function ladderPlanBtn(sym){
  const lv = levelsFor(sym, Math.max(120, stockDays)), p = lastPx(sym); if(!lv.length || p == null) return '';
  const sup = lv.filter(l => l.hi < p).sort((a,b) => b.mid - a.mid); const S1 = sup.find(l => l.score >= 2) || sup[0];
  return S1 ? `<button class="btn-ghost btn-small" onclick="planFromLevel('${sym}', ${lv.indexOf(S1)})">${L('建计划','Plan')}</button>` : '';
}

function optionsHtml(sym){
  const op = pack && pack.options && pack.options[sym];
  const sn = pack && pack.snap && pack.snap[sym];
  const flow = sn && sn.callAvg ? (sn.callVol + sn.putVol) / (sn.callAvg + sn.putAvg) : null;
  const flowTxt = flow != null ? L(`今日期权成交是均量的 ${fmt(flow,1)} 倍（Call ${kfmt(sn.callVol)} / Put ${kfmt(sn.putVol)}）`, `options volume ${fmt(flow,1)}× average (calls ${kfmt(sn.callVol)} / puts ${kfmt(sn.putVol)})`) : '';
  if(!op || !op.strikes || !op.strikes.length) return { head: flowTxt || L('数据包里没有这只的期权分布（默认只算持仓最大的几只）','no option walls in the pack (only the largest holdings are pulled)'), body:'' };
  const p = lastPx(sym);
  const pw = op.strikes.filter(r => r[0] <= p).sort((a,b) => b[2] - a[2])[0], cwl = op.strikes.filter(r => r[0] >= p).sort((a,b) => b[1] - a[1])[0];
  const head = [pw ? L(`Put 墙 $${fmt(pw[0],0)}（${kfmt(pw[2])}）`, `Put wall $${fmt(pw[0],0)} (${kfmt(pw[2])})`) : '', cwl ? L(`Call 墙 $${fmt(cwl[0],0)}（${kfmt(cwl[1])}）`, `Call wall $${fmt(cwl[0],0)} (${kfmt(cwl[1])})`) : '', op.exp ? L(`${md(op.exp)} 到期`, `exp ${md(op.exp)}`) : ''].filter(Boolean).join(' · ');
  const mx = Math.max(...op.strikes.map(r => Math.max(r[1], r[2])), 1);
  const arrow = d => d == null ? '' : d > 0 ? `<i class="up">▲${kfmt(d)}</i>` : d < 0 ? `<i class="dn">▼${kfmt(-d)}</i>` : '';
  const body = `<div class="oi-chart"><div class="oi-h"><span>Put ${L('持仓','OI')}</span><span>${L('行权价','strike')}</span><span>Call ${L('持仓','OI')}</span></div>${op.strikes.slice().reverse().map(r => `<div class="oi-row ${Math.abs(r[0] - p) / p < 0.012 ? 'now' : ''}">
      <div class="oi-l">${arrow(r[6])}<span>${kfmt(r[2])}</span><b style="width:${r[2]/mx*100}%"></b></div><div class="oi-k">${fmt(r[0], r[0] % 1 ? 1 : 0)}</div><div class="oi-r"><b style="width:${r[1]/mx*100}%"></b><span>${kfmt(r[1])}</span>${arrow(r[5])}</div></div>`).join('')}</div>
    <div class="muted sm">${L('▲▼ 是和上一份数据包相比的持仓增减。','▲▼ = change since the previous pack.')} ${flowTxt}</div>`;
  return { head: head + (flow != null && flow >= 2 ? ' · ' + L(`期权异动 ${fmt(flow,1)}×`, `unusual ${fmt(flow,1)}×`) : ''), body };
}

function volumeHtml(sym){
  const b = S(sym), I = ind(sym); if(!b || !I) return { head:'', body:'' };
  const N = b.c.length, avg50 = sma(b.v, 50, N) || 1;
  const big = []; for(let i = N - 20; i < N; i++){ if(i > 0 && b.v[i] > 1.5 * avg50) big.push(b.c[i] >= b.c[i-1]); }
  const up = big.filter(Boolean).length, dn = big.length - up;
  const head = big.length ? L(`近 20 日 ${big.length} 个放量日：${up} 涨 ${dn} 跌${up > dn ? ' · 买盘主动' : up < dn ? ' · 卖压更重' : ''}`, `${big.length} heavy-volume days in 20: ${up} up, ${dn} down`) : L('近 20 日没有明显放量','no heavy-volume days in the last 20');
  const days = 60, s0 = N - days, dv = []; for(let i = s0; i < N; i++) dv.push({ v: b.v[i] * b.c[i], up: b.c[i] >= b.c[i-1], t: b.t[i] });
  const mx = Math.max(...dv.map(d => d.v)); const avgDv = dv.reduce((s,d) => s + d.v, 0) / dv.length;
  const body = `<div class="dv-bars">${dv.map(d => `<i class="${d.up ? 'up' : 'dn'}" style="height:${d.v / mx * 100}%" title="${d.t} · $${kfmt(d.v)}"></i>`).join('')}<b style="bottom:${avgDv / mx * 100}%"></b></div>
    <div class="muted sm">${L(`近 60 日每日成交额，横线 = 平均 $${kfmt(avgDv)}。今日量是 20 日均量的 ${fmt(I.relVol,1)} 倍。`, `daily dollar volume, 60 days; line = average $${kfmt(avgDv)}. Today ${fmt(I.relVol,1)}× the 20-day average volume.`)}</div>`;
  return { head, body };
}

function driverHtml(sym){
  const ab = abnormalDays(sym, 90).slice().reverse();
  const news = newsFor(sym);
  const haveNews = !!(fh.news[sym] && fh.news[sym].d);
  const th = abnTh(sym);
  const thTxt = L(`异常日 = 单日 ≥${fmt(th.d1,1)}% 或 5 日 ≥${fmt(th.d5,1)}%${th.d1 > 4.05 ? '（这只波动大，门槛按它平时波动的 2.2 倍提高）' : ''}`, `abnormal = ≥${fmt(th.d1,1)}% in a day or ≥${fmt(th.d5,1)}% over 5 days${th.d1 > 4.05 ? ' (raised for a volatile stock)' : ''}`);
  if(!ab.length) return { head:L('近 90 天没有异常日','no abnormal days in 90 days'), body:`<div class="muted sm">${thTxt}</div>` };
  const myT = AT().filter(t => t.sym === sym);
  const analyse = a => {
    const end = localDate(a.date); end.setHours(23, 59); const start = localDate(a.kind === '5d' ? a.from : addDays(a.date, -1)); start.setHours(16, 0);
    const list = news.filter(n => n.datetime * 1000 >= start.getTime() && n.datetime * 1000 <= end.getTime());
    const dir = Math.sign(a.chg);
    let agree = 0, opp = 0, mkt = 0; const cats = {};
    list.forEach(n => { const c = newsCat(n.headline); if(c.k === 'mk'){ mkt++; return; } cats[c.t] = (cats[c.t] || 0) + 1; const t = newsTone(n.headline); if(t === dir) agree++; else if(t === -dir) opp++; });
    const topCat = Object.entries(cats).sort((x,y) => y[1] - x[1])[0];
    const lead = list.filter(n => newsCat(n.headline).k !== 'mk').sort((x,y) => Math.abs(newsTone(y.headline)) - Math.abs(newsTone(x.headline)))[0];
    const mine = myT.filter(t => d10(t.date) >= (a.kind === '5d' ? a.from : a.date) && d10(t.date) <= a.date);
    return { list, agree, opp, mkt, topCat, lead, mine };
  };
  const last = ab[0], A0 = analyse(last);
  const why = !haveNews ? L('（填 Finnhub key 后显示当天新闻）',' (add a Finnhub key to see that day’s news)') : A0.lead ? L(`主要原因：${A0.topCat ? A0.topCat[0] + ' · ' : ''}“${esc(A0.lead.headline)}”`, `likely: ${A0.topCat ? A0.topCat[0] + ' · ' : ''}"${esc(A0.lead.headline)}"`) : L('当天没有个股新闻，可能是板块或大盘带动', 'no stock-specific news — probably sector/market');
  const head = L(`最近异常日 ${md(last.date)} ${sg(last.chg)}${last.kind === '5d' ? '（5 日）' : ''} · `, `latest ${md(last.date)} ${sg(last.chg)}${last.kind === '5d' ? ' (5d)' : ''} · `) + why;
  const body = `<div class="muted sm" style="margin-bottom:4px">${thTxt}</div><div class="ab-list">${ab.slice(0, cfg.abAll ? 99 : 8).map(a => { const R = analyse(a); return `<div class="ab-row">
      <span class="ab-d">${md(a.date)}</span><span class="ab-c ${a.chg > 0 ? 'gain-t' : 'loss-t'}">${sg(a.chg)}${a.kind === '5d' ? '<small>5d</small>' : ''}</span>
      <span class="ab-n">${haveNews ? L(`${R.list.length} 条新闻 · 同向 ${R.agree} · 相反 ${R.opp}${R.mkt ? ` · 大盘背景 ${R.mkt}` : ''}`, `${R.list.length} news · agree ${R.agree} · oppose ${R.opp}${R.mkt ? ` · market ${R.mkt}` : ''}`) : '—'}${R.lead ? `<a class="ab-h" href="${esc(R.lead.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(R.lead.headline)}</a>` : ''}</span>
      <span class="ab-m">${R.mine.map(t => `<em class="${t.side === 'BUY' ? 'b' : 's'}">${t.side === 'BUY' ? L('买','B') : L('卖','S')} ${fmt(t.qty,0)}@${fmt(t.price)}</em>`).join('')}</span></div>`; }).join('')}</div>
    ${ab.length > 8 ? `<a class="lnk sm" onclick="cfg.abAll=!cfg.abAll; saveCfg(); renderStock()">${cfg.abAll ? L('收起','fewer') : L(`看全部 ${ab.length} 个`, `all ${ab.length}`)}</a>` : ''}
    <div class="muted sm">${L('同向 / 相反按标题关键词判断（如 upgrade、beat 记为利好），大盘背景新闻单独计数、不算原因。右侧是你那几天的买卖。','Agree/oppose is keyword-based on headlines; market-backdrop news is counted separately. Right: your trades on those days.')}</div>`;
  return { head, body };
}

function earningsHtml(sym){
  const er = (fh.er[sym] && fh.er[sym].d) || null, eps = (fh.eps[sym] && fh.eps[sym].d) || null;
  const today = todayISO();
  const next = (er || []).filter(e => e.date >= today).sort((a,b) => a.date < b.date ? -1 : 1)[0] || (nextEarnings(sym) ? { date: nextEarnings(sym) } : null);
  const sn = pack && pack.snap && pack.snap[sym], I = ind(sym), b = S(sym);
  const p = lastPx(sym);
  // realised moves on past report dates
  const past = (er || []).filter(e => e.date < today && e.act != null).sort((a,b) => a.date < b.date ? 1 : -1).slice(0, 4);
  const moveOn = e => { if(!b) return null; const i = b.t.indexOf(e.date); if(i < 1) return null; if(e.hour === 'amc') return i + 1 < b.c.length ? (b.c[i+1] / b.c[i] - 1) * 100 : null; if(e.hour === 'bmo') return (b.c[i] / b.c[i-1] - 1) * 100; const a1 = (b.c[i] / b.c[i-1] - 1) * 100, a2 = i + 1 < b.c.length ? (b.c[i+1] / b.c[i] - 1) * 100 : 0; return Math.abs(a1) > Math.abs(a2) ? a1 : a2; };
  const moves = past.map(moveOn).filter(v => v != null);
  const avgMove = moves.length ? moves.reduce((s,v) => s + Math.abs(v), 0) / moves.length : null;
  let ivTxt = '';
  if(next && sn && sn.iv){ const dte = Math.max(1, daysBetween(today, next.date)); const mv = sn.iv * Math.sqrt(dte / 365) * 100; ivTxt = L(`隐含波动 ${fmt(sn.iv*100,0)}%，到财报日 1σ 约 ±${fmt(mv,1)}%`, `IV ${fmt(sn.iv*100,0)}% → ±${fmt(mv,1)}% (1σ) by report day`); }
  const h = holdingsNow().map[sym];
  const expo = h && avgMove ? L(` · 按历史平均波动，这笔仓位约 ±${money(h.mv * avgMove / 100)}`, ` · at the average move your position swings ±${money(h.mv * avgMove / 100)}`) : '';
  const head = (next ? L(`下次财报 ${md(next.date)}（${daysBetween(today, next.date)} 天后${next.hour === 'amc' ? '，盘后' : next.hour === 'bmo' ? '，盘前' : ''}）`, `next ${md(next.date)} (in ${daysBetween(today, next.date)}d${next.hour === 'amc' ? ', after close' : next.hour === 'bmo' ? ', pre-market' : ''})`) : L('还没有下次财报日期','no upcoming date yet'))
    + (ivTxt ? ' · ' + ivTxt : '') + (avgMove != null ? L(` · 过去 ${moves.length} 次实际平均 ±${fmt(avgMove,1)}%`, ` · last ${moves.length} actual avg ±${fmt(avgMove,1)}%`) : '') + expo;
  const rows = past.length ? past.map(e => { const m = moveOn(e); const beat = e.est != null ? e.act >= e.est : null;
      return `<tr><td>${e.y ? e.y + ' Q' + e.q : md(e.date)}</td><td>${md(e.date)}</td><td>${fmt(e.act,2)}</td><td>${e.est != null ? fmt(e.est,2) : '—'}</td><td class="${beat == null ? '' : beat ? 'gain-t' : 'loss-t'}">${beat == null ? '—' : beat ? L('超预期','beat') : L('不及','miss')}${e.est ? ` ${sg((e.act - e.est) / Math.abs(e.est) * 100, 0)}` : ''}</td><td class="${m > 0 ? 'gain-t' : m < 0 ? 'loss-t' : ''}">${m != null ? sg(m) : '—'}</td></tr>`; }).join('')
    : (eps || []).slice(0, 4).map(e => `<tr><td>${esc(e.period || '')}</td><td>—</td><td>${fmt(e.act,2)}</td><td>${e.est != null ? fmt(e.est,2) : '—'}</td><td class="${e.act >= e.est ? 'gain-t' : 'loss-t'}">${e.act >= e.est ? L('超预期','beat') : L('不及','miss')} ${e.sp != null ? sg(e.sp,0) : ''}</td><td>—</td></tr>`).join('');
  const body = rows ? `<table class="er-tbl"><tr><th>${L('季度','Quarter')}</th><th>${L('发布','Date')}</th><th>EPS</th><th>${L('预期','Est.')}</th><th>${L('结果','Result')}</th><th>${L('当日涨跌','Move')}</th></tr>${rows}</table>` : `<div class="muted sm">${/\S/.test(finnhubKey) ? L('正在拉取或没有历史财报数据。','loading, or no history available.') : L('填 Finnhub key 后显示近 4 季 EPS。','Add a Finnhub key to see the last 4 quarters.')}</div>`;
  return { head, body, next, avgMove };
}

function insiderSentence(v){
  if(v.buys.length) return L(`${v.buys.length} 位内部人自己掏钱买入，通常是好信号。`, `${v.buys.length} insider(s) bought with their own money — usually a good sign.`);
  const names = [...new Set(v.sells.map(x => x.name))];
  const ds = v.sells.map(x => d10(x.date)).sort();
  return L(`${md(ds[0])}–${md(ds[ds.length-1])} 有 ${names.length} 位高管卖出，合计约 $${kfmt(v.sellVal)}。几个人集中卖，值得留意。`, `${names.length} insiders sold between ${md(ds[0])} and ${md(ds[ds.length-1])}, about $${kfmt(v.sellVal)} in total — worth noting.`);
}
function insiderHtml(sym){
  if(!/\S/.test(finnhubKey) && !fh.insider[sym]) return { head:L('填 Finnhub key 后显示内部人交易','add a Finnhub key to see insider trades'), body:'' };
  const v = insiderView(sym);
  if(!v) return { head: fh.insider[sym] && fh.insider[sym].err ? L('内部人数据拿不到（可能免费额度不含此股）','insider data unavailable for this symbol') : L('正在拉取…','loading…'), body:'' };
  const head = L(`90 天：主动买入 ${v.buys.length} 笔 · 公开卖出 ${v.sells.length} 笔${v.sellVal ? `（约 $${kfmt(v.sellVal)}）` : ''} · 其他 ${v.other.length} 笔`, `90d: ${v.buys.length} open-market buys · ${v.sells.length} sells${v.sellVal ? ` (~$${kfmt(v.sellVal)})` : ''} · ${v.other.length} other`)
    + (v.alerts.length ? ` · <b class="dot-warn">${v.alerts.length}</b>` : '');
  const codeTxt = c => ({ P:L('买入','Buy'), S:L('卖出','Sell'), M:L('行权','Exercise'), A:L('授予','Award'), F:L('扣税','Tax'), G:L('赠与','Gift') })[c] || c;
  const body = (v.alerts.length ? `<div class="ins-sum">${insiderSentence(v)}</div>` : '')
    + `<table class="er-tbl ins"><tr><th>${L('日期','Date')}</th><th>${L('姓名','Name')}</th><th>${L('类型','Type')}</th><th>${L('股数','Shares')}</th><th>${L('价格','Price')}</th></tr>${v.rows.slice(0, 40).map(x => `<tr class="${x.code === 'P' || x.code === 'S' ? '' : 'routine'}"><td>${md(x.date)}</td><td>${esc(x.name)}</td><td>${codeTxt(x.code)}</td><td class="${x.change > 0 ? 'gain-t' : 'loss-t'}">${x.change > 0 ? '+' : ''}${kfmt(x.change)}</td><td>${x.price ? '$' + fmt(x.price) : '—'}</td></tr>`).join('')}</table>
    <div class="muted sm">${L('灰色是例行交易（行权、授予、扣税等）。Finnhub 不标注是否属于 10b5-1 预设计划，所以卖出都按公开市场卖出统计。','Grey rows are routine (exercise, award, tax). Finnhub does not flag 10b5-1 plans, so all sales count as open-market sales.')}</div>`;
  return { head, body };
}

// same-sector names, quiet row at the bottom of the stock page; click one to compare
function peersHtml(sym){
  const sec = sectorOf(sym), me = ind(sym); if(!me) return '';
  const ps = Object.keys((pack && pack.bars) || {}).filter(s => s !== sym && sectorOf(s) === sec && !isLev(s) && ind(s)).slice(0, 6);
  if(!ps.length) return '';
  const cell = (s, I, self) => `<a class="pr-c ${self ? 'me' : ''}" ${self ? '' : `onclick="openCompare('${sym}','${s}')" aria-label="${L(`和 ${sym} 对比`, `compare with ${sym}`)}"`}><b>${s}</b><span class="${I.ret1m >= 0 ? 'gain-t' : 'loss-t'}">${sg(I.ret1m, 0)}</span></a>`;
  return `<div class="peers"><span class="pr-h">${L(`同板块 · 近 1 月`, `Same sector · 1 month`)}</span>${cell(sym, me, true)}${ps.map(s => cell(s, ind(s), false)).join('')}<span class="pr-tip">${L('点一只和它对比','click one to compare')}</span></div>`;
}
function peerOf(sym){
  const sec = sectorOf(sym);
  const cands = Object.keys((pack && pack.bars) || {}).filter(s => s !== sym && sectorOf(s) === sec && !isLev(s));
  if(!cands.length) return null;
  return cands.map(s => ({ s, c: (pairStats(sym, s, 120) || { corr:0 }).corr })).sort((a,b) => b.c - a.c)[0].s;
}

function foldSec(id, title, head, body, alert, ico){
  const open = (cfg.stockOpen || {})[id];
  const tog = `ontoggle="(cfg.stockOpen = cfg.stockOpen || {})['${id}'] = this.open; saveCfg();"`;
  if(alert) return `<details class="sk-alert" ${open ? 'open' : ''} ${tog}>
    <summary><span class="ska-ico">${ico}</span><span class="ska-b"><span class="ska-t">${title}</span><span class="ska-s">${alert}</span></span>${body ? `<span class="ska-go">${L('点击查看','View')}</span>` : ''}</summary>${body ? `<div class="sk-body">${body}</div>` : ''}</details>`;
  return `<details class="sk-sec" ${open ? 'open' : ''} ${tog}>
    <summary><span class="sk-t">${title}</span><span class="sk-h">${head || ''}</span>${body ? '<span class="sk-more"></span>' : ''}</summary>${body ? `<div class="sk-body">${body}</div>` : ''}</details>`;
}
// what on this stock deserves a look right now (empty string = nothing unusual)
function stockAlerts(sym, E, N){
  const out = {}, p = lastPx(sym), I = ind(sym), b = S(sym);
  const sn = pack && pack.snap && pack.snap[sym], op = pack && pack.options && pack.options[sym];
  const flow = sn && sn.callAvg ? (sn.callVol + sn.putVol) / ((sn.callAvg + sn.putAvg) || 1) : null;
  if(flow >= 2) out.opt = L(`今天期权成交是平时的 ${fmt(flow,1)} 倍，${sn.callVol >= sn.putVol ? '以 Call 为主（偏看涨）' : '以 Put 为主（偏看跌或对冲）'}`, `options volume ${fmt(flow,1)}× normal, mostly ${sn.callVol >= sn.putVol ? 'calls' : 'puts'}`);
  else if(op && op.strikes && op.strikes.length){
    const pw = op.strikes.filter(r => r[0] <= p).sort((a,c) => c[2] - a[2])[0], cw = op.strikes.filter(r => r[0] >= p).sort((a,c) => c[1] - a[1])[0];
    if(pw && (p / pw[0] - 1) < 0.02) out.opt = L(`股价离 Put 墙 $${fmt(pw[0],0)} 只差 ${fmt((p / pw[0] - 1) * 100, 1)}%，${md(op.exp)} 到期前这里常有支撑`, `price is ${fmt((p / pw[0] - 1) * 100, 1)}% above the $${fmt(pw[0],0)} put wall — often support into ${md(op.exp)}`);
    else if(cw && (cw[0] / p - 1) < 0.02) out.opt = L(`股价离 Call 墙 $${fmt(cw[0],0)} 只差 ${fmt((cw[0] / p - 1) * 100, 1)}%，${md(op.exp)} 到期前常被压住`, `price is ${fmt((cw[0] / p - 1) * 100, 1)}% below the $${fmt(cw[0],0)} call wall — often caps it into ${md(op.exp)}`);
  }
  if(b){ const N0 = b.c.length, avg50 = sma(b.v, 50, N0) || 1; let up = 0, dn = 0; for(let i = N0 - 20; i < N0; i++){ if(b.v[i] > 1.5 * avg50){ if(b.c[i] >= b.c[i-1]) up++; else dn++; } }
    if(dn >= 2 && dn > up) out.vol = L(`近 20 天放量的 ${up + dn} 天里有 ${dn} 天在跌，卖的人更急`, `${dn} of ${up + dn} heavy-volume days in 20 were down — sellers in control`); }
  const ab = abnormalDays(sym, 10).filter(a => a.i >= b.c.length - 5).pop();
  if(ab) out.drv = L(`${md(ab.date)} ${ab.kind === '5d' ? '5 天累计' : '单日'} ${sg(ab.chg)}，看看是什么新闻`, `${md(ab.date)} ${ab.kind === '5d' ? '5-day' : 'one-day'} move ${sg(ab.chg)} — see what drove it`);
  if(E && E.next){ const d = daysBetween(todayISO(), E.next.date); const h = holdingsNow().map[sym];
    if(d >= 0 && d <= 14) out.er = L(`${md(E.next.date)} 发财报（${d === 0 ? '今天' : d + ' 天后'}）${h && E.avgMove ? `，这笔仓位可能一天波动 ±${money(h.mv * E.avgMove / 100)}` : ''}`, `reports ${md(E.next.date)} (${d === 0 ? 'today' : 'in ' + d + 'd'})${h && E.avgMove ? `; your position may swing ±${money(h.mv * E.avgMove / 100)}` : ''}`); }
  const iv = insiderView(sym);
  if(iv && iv.alerts.length) out.ins = insiderSentence(iv);
  return out;
}

function stockPickerHtml(){
  const H = holdingsNow();
  const chips = [...new Set([...H.list.map(h => h.sym), ...activePlans().map(p => p.sym), ...(cfg.recentStocks || [])])].slice(0, 12);
  const all = Object.keys((pack && pack.bars) || {}).sort();
  return `<div class="sk-pick">
    <input id="skSearch" class="sk-in" placeholder="${L('输入代码，回车','Symbol, then Enter')}" list="skList" onkeydown="stockSearch(event)" autocomplete="off" style="text-transform:uppercase">
    <datalist id="skList">${all.map(s => `<option value="${s}">`).join('')}</datalist>
    <div class="sk-chips">${chips.map(s => `<button class="chip ${s === stockSym ? 'on' : ''}" onclick="openStock('${s}')">${s}</button>`).join('')}</div>
  </div>`;
}

function renderStock(){
  const el = document.getElementById('stockView'); if(!el) return;
  const sym = stockSym;
  if(!sym){
    el.innerHTML = stockPickerHtml() + liveStatusHtml() + ((pack || liveOn()) ? `<div class="watch-empty">${L('选一只股票：K 线、支撑压力、期权墙、量能、驱动新闻、财报和内部人都在一页。','Pick a stock: chart, levels, option walls, volume, news drivers, earnings and insiders on one page.')}</div>`
      : liveSetupHtml());
    return;
  }
  const I = ind(sym);
  const H = holdingsNow(), h = H.map[sym], plan = activePlans().find(p => p.sym === sym);
  const p = lastPx(sym);
  const chg = quotes.q[sym] && quotes.q[sym].pc ? (quotes.q[sym].p / quotes.q[sym].pc - 1) * 100 : I ? I.chg1 : null;
  const peer = peerOf(sym);
  const head = `<div class="sk-head">
      <div class="sk-id"><b class="sk-sym">${sym}</b><span class="sk-sec-tag">${esc(secName(sectorOf(sym)))}${isLev(sym) ? ` · ${L('杠杆 ETF','Leveraged')}` : ''}</span></div>
      <div class="sk-px"><b>${p != null ? '$' + fmt(p) : '—'}</b>${chg != null ? `<span class="${chg >= 0 ? 'gain-t' : 'loss-t'}">${sg(chg)}</span>` : ''}</div>
      <div class="sk-acts">
        ${!plan ? `<button class="btn-primary btn-small" onclick="prefillPlan({sym:'${sym}'})">${L('+ 建计划','+ Plan')}</button>` : ''}
        ${!watchlist.some(w => w.sym === sym) && !h ? `<button class="btn-ghost btn-small" onclick="addWatchSym('${sym}')">☆ ${L('观察','Watch')}</button>` : ''}
        ${liveOn() ? `<button class="btn-ghost btn-small" aria-label="${L('刷新 K 线','Refresh bars')}" onclick="ensureBars(['${sym}','SPY'], {force:true, first:true})">${L('刷新','Refresh')}</button>` : ''}
      </div>
    </div>`;
  if(!I){ el.innerHTML = stockPickerHtml() + head + (liveOn() ? liveStatusHtml() + liveMissingHtml(sym)
      : `<div class="sk-status">${L('没有这只股票的 K 线。','No bars for this symbol.')}</div>` + liveSetupHtml()); return; }
  const m = momentum(sym);
  const V0 = verdict(sym);
  const verdictHtml = `<div class="sk-verdict ${V0.k}"><div class="skv-t"><i></i>${V0.t}${m ? `<span class="mo-badge ${m.grade}" title="${L('1–2 周短线动能','1–2 week momentum')}">${L('短线','Short-term')} ${gradeTxt(m.grade)}</span>` : ''}</div><div class="skv-s">${V0.s}</div></div>`;
  const mineHtml = (h || plan) ? `<div class="sk-mine2">${h ? `<span><em>${L('持有','Holding')}</em>${fmt(h.qty,0)} ${L('股','sh')} · <b class="${p >= h.avg ? 'gain-t' : 'loss-t'}">${money((p - h.avg) * h.qty)}</b></span>` : ''}${plan ? `<span><em>${L('计划区','Zone')}</em>${px(plan.lo)}–${px(plan.hi)}</span><span><em>${L('止损','Stop')}</em><b class="loss-t">${px(plan.stop)}</b></span>` : ''}</div>` : '';
  const chart = `<div class="sk-chart-card">
      <div class="sk-ch-top"><div class="seg">${[60,120,250].map(d => `<button class="${stockDays === d ? 'on' : ''}" onclick="stockDays=${d}; renderStock()">${d === 250 ? L('1 年','1Y') : d + L(' 日','d')}</button>`).join('')}</div>
        <div class="ch-legend"><span><i style="background:#C9892B"></i>20${L('日线','d')}</span><span><i style="background:#5A6FD0"></i>50${L('日线','d')}</span><span><i class="band g"></i>${L('支撑','support')}</span><span><i class="band r"></i>${L('压力','resistance')}</span><span>▲▼ ${L('我的买卖','my trades')}</span><span>● ${L('异常日','abnormal')}</span></div></div>
      ${chartSvg(sym, stockDays)}
      <div class="sk-facts">${[[L('5 日','5d'), sg(I.ret5)], [L('1 月','1m'), sg(I.ret1m)], ['RSI', fmt(I.rsi,0)], [L('距 52 周高','off 52w high'), sg(I.distHi52, 0)], ['Beta', fmt(betaOf(sym),1)]].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')}<span class="muted">${(() => { const li = pack && pack.live && pack.live[sym]; return li && li.partial && I.date === todayISO() ? L(`实时 · ${new Date(li.at).toTimeString().slice(0,5)}`, `live · ${new Date(li.at).toTimeString().slice(0,5)}`) : L(`数据 ${md(I.date)} 收盘`, `as of ${md(I.date)} close`); })()}</span></div></div>`;
  const stats = '';
  const O = optionsHtml(sym), V = volumeHtml(sym), D = driverHtml(sym), E = earningsHtml(sym), N = insiderHtml(sym);
  el.innerHTML = stockPickerHtml() + liveStatusHtml() + head + verdictHtml + mineHtml + chart
    + `<div class="sk-block"><div class="sk-bh">${L('关键价位','Key levels')}<span class="sk-bh-r">${ladderPlanBtn(sym)}<button class="btn-ghost btn-small" onclick="cfg.ladderAll=!cfg.ladderAll; saveCfg(); renderStock()">${cfg.ladderAll ? L('只看最重要的','Key ones only') : L('看全部','Show all')}</button></span></div>${ladderHtml(sym, cfg.ladderAll)}</div>`
    + (() => {
      const A = stockAlerts(sym, E, N);
      const secs = [['opt', L('期权墙','Option walls'), O, '🧲'], ['vol', L('量能','Volume'), V, '📊'], ['drv', L('驱动新闻','News drivers'), D, '📰'], ['er', L('财报','Earnings'), E, '📅'], ['ins', L('内部人','Insiders'), N, '🕴️']];
      const hot = secs.filter(x => A[x[0]]), calm = secs.filter(x => !A[x[0]]);
      return (hot.length ? `<div class="sk-alerts"><div class="ska-h">${L('需要注意','Worth a look')}<span>${hot.length}</span></div>${hot.map(x => foldSec(x[0], x[1], x[2].head, x[2].body, A[x[0]], x[3])).join('')}</div>` : '')
        + `<div class="sk-folds">${calm.map(x => foldSec(x[0], x[1], x[2].head, x[2].body)).join('')}</div>`
        ;
    })();
}

/* ---------- watchlist tab: momentum board + AI-chain radar + presets ---------- */
let radarState = { filter:'all', sector:null, sort:'ret1m', dir:-1, open:null, picked:[], preset:null };
let fundBusy = null;   // {done, total}

function radarUniverse(){
  const set = new Set(Object.keys(SECTORS));
  (cfg.universeAdd || []).forEach(s => set.add(s));
  const H = holdingsNow();
  H.list.forEach(h => set.add(h.sym)); activePlans().forEach(p => set.add(p.sym)); watchlist.forEach(w => w.sym && set.add(w.sym));
  const keep = new Set([...H.list.map(h => h.sym), ...activePlans().map(p => p.sym)]);
  (cfg.universeDel || []).forEach(s => { if(!keep.has(s)) set.delete(s); });
  return [...set];
}
function roleOf(sym, H){
  if(H.map[sym]) return 'hold';
  if(activePlans().some(p => p.sym === sym)) return 'plan';
  if(watchlist.some(w => w.sym === sym)) return 'watch';
  return 'none';
}
function optFlow(sym){ const sn = pack && pack.snap && pack.snap[sym]; return sn && sn.callAvg ? (sn.callVol + sn.putVol) / ((sn.callAvg + sn.putAvg) || 1) : null; }

// ---------- momentum board ----------
function momoSources(){
  const src = [{ k:'loop', t:L('LOOP 自选 + 持仓','LOOP watchlist + holdings') }];
  Object.keys((pack && pack.watchlists) || {}).forEach(n => src.push({ k:'ib:' + n, t:'IBKR · ' + n }));
  return src;
}
function momoUniverse(){
  const H = holdingsNow();
  let k = cfg.momoSrc;
  const lists = (pack && pack.watchlists) || {};
  if(!k){ const short = Object.keys(lists).find(n => /短线/.test(n)); k = short ? 'ib:' + short : 'loop'; }
  let syms;
  if(k.startsWith('ib:') && lists[k.slice(3)]) syms = lists[k.slice(3)].concat(H.list.map(h => h.sym));
  else { k = 'loop'; syms = [...watchlist.map(w => w.sym), ...activePlans().map(p => p.sym), ...H.list.map(h => h.sym)]; }
  return { k, syms: [...new Set(syms.filter(Boolean).map(s => s.toUpperCase()))].filter(s => s !== 'SPY' && s !== 'QQQ').slice(0, 40) };
}
const MOMO_GROUPS = () => [
  { g:'trend', t:L('趋势','Trend'), d:L('价格 > 20日线 > 50日线；20 日线向上','price > MA20 > MA50; MA20 rising') },
  { g:'rs',    t:L('强于大盘','vs SPY'), d:L('5 日和 20 日涨幅都跑赢 SPY','5-day and 20-day return beat SPY') },
  { g:'vol',   t:L('量能','Volume'), d:L('放量上涨，或近 20 日大量日多数是涨','heavy volume on up days') },
  { g:'pos',   t:L('位置','Setup'), d:L('贴近 20 日高点，或回踩 20 日线守住','near the 20-day high, or held MA20 on a pullback') },
  { g:'news',  t:L('新闻','News'), d:L('近 5 天新闻方向和走势一致','last 5 days of news agree with price') },
];
// plain-language reasons: what is working and what is missing
const capEn = x => lang === 'en' ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : String(x);   // English tags start with a capital
function momoWhy(m){
  const c = g => m.crit.filter(x => x.g === g), I = m.I;
  const t = c('trend'), r = c('rs'), v = c('vol')[0], p = c('pos')[0], n = c('news')[0];
  const pros = [], cons = [];
  if(t.every(x => x.ok)) pros.push(L('趋势向上','uptrend')); else cons.push(I.last < I.ma50 ? L('在 50 日线下方','below MA50') : L('均线还没走顺','MAs not aligned'));
  const rn = r.filter(x => x.ok).length;
  if(rn === 2) pros.push(L('跑赢大盘','beating SPY')); else if(rn === 1) pros.push(r[0].ok ? L('这周跑赢大盘','beat SPY this week') : L('这个月跑赢大盘','beat SPY this month')); else cons.push(L('跑输大盘','lagging SPY'));
  if(v && v.ok) pros.push(L('放量在买','buyers on volume')); else cons.push(L('量能没跟上','no volume'));
  if(p && p.ok) pros.push(I.distHi20 >= -3 ? L('贴近 20 日高点','near the 20-day high') : L('回踩 20 日线守住','held MA20')); else cons.push(L(`离 20 日高点还有 ${fmt(-I.distHi20,0)}%`, `${fmt(-I.distHi20,0)}% off the 20-day high`));
  if(n && n.ok) pros.push(L('新闻同向','news agrees')); else if(n && !n.na) cons.push(L('新闻和走势相反','news disagrees'));
  m.neg.forEach(x => cons.push(x));
  return { pros: pros.map(capEn), cons: cons.map(capEn) };
}
function holdAction(m, H){
  const posOk = (m.crit.find(c => c.g === 'pos') || {}).ok;
  const erSoon = earningsBetween(m.sym, todayISO(), addDays(todayISO(), 10))[0];
  let act = m.score >= 5 && posOk ? 'buy' : m.score >= 3 ? 'hold' : 'sell';
  if(act === 'buy' && erSoon) act = 'hold';
  const stop = m.holdStop ? px(m.holdStop) : '—';
  // one consistent shape: [what to do, at what price] + [stop]
  const nums = act === 'buy' ? [[L('回踩到这里加仓','Add on a dip to'), px(m.entry), ''], [L('止损','Stop'), stop, 'loss-t']]
    : act === 'hold' ? [[L('不动','No action'), '—', 'muted'], [L('止损上移到','Raise stop to'), stop, 'loss-t']]
    : [[L('现在先卖一半','Sell half now'), px(lastPx(m.sym)), ''], [L('剩下跌破就卖','Rest exits below'), stop, 'loss-t']];
  const plan = activePlans().find(p => p.sym === m.sym);
  const note = act === 'sell' && plan ? L(`和你的 ${m.sym} 买入计划方向相反，先想清楚再动`, `conflicts with your ${m.sym} buy plan`)
    : act === 'hold' && erSoon && m.score >= 5 ? L(`${md(erSoon)} 财报，财报前不加仓`, `earnings ${md(erSoon)} — no adds before`) : '';
  return { act, note, nums };
}
function renderMomo(){
  const el = document.getElementById('momoSec'); if(!el) return;
  const head = (extra='') => `<div class="sec-head"><span class="badge">🚀</span><h2>${L('短线动能榜','Momentum board')}</h2><span class="muted sm" style="margin-left:4px">1–2 ${L('周','wk')}</span>${pageHelp('momo')}<div class="grow">${extra}</div></div>${liveStatusHtml()}`;
  if(liveOn()) livePack();
  if(!pack){ el.innerHTML = head() + `<div class="watch-empty">${L('在设置里填 Twelve Data key（或导入数据包）后，这里按 K 线 + 新闻把你的自选排出强中弱。','Import a data pack to rank your watchlist by chart + news strength.')} <a class="lnk" onclick="pickPackFile()">${L('导入数据包','Import data pack')}</a></div>`; return; }
  const U = momoUniverse();
  const sel = `<select class="sel-sm" onchange="cfg.momoSrc=this.value; saveCfg(); renderMomo()">${momoSources().map(s => `<option value="${esc(s.k)}" ${s.k === U.k ? 'selected' : ''}>${esc(s.t)}</option>`).join('')}</select>`;
  const H = holdingsNow();
  const all = U.syms.map(momentum).filter(Boolean).sort((a,b) => b.score - a.score || (b.I.ret20 - a.I.ret20));
  if(!all.length){ el.innerHTML = head(sel) + `<div class="watch-empty">${L('这个列表里的股票还没有 K 线数据。','No bars yet for this list.')}</div>`; return; }
  const held = all.filter(m => H.map[m.sym] && H.map[m.sym].qty > 0), cand = all.filter(m => !(H.map[m.sym] && H.map[m.sym].qty > 0));
  const strongC = cand.filter(m => m.grade !== 'lo'), weakC = cand.filter(m => m.grade === 'lo');
  // up to 5 strengths (wraps to a second line if needed), everything else in the tooltip
  const reason = m => { const w = momoWhy(m); const tip = esc([...w.pros.map(x => '✓ ' + x), ...w.cons.map(x => '✗ ' + x), ...m.flags.map(x => '! ' + capEn(x))].join('\n'));
    const main = w.pros.length ? w.pros.slice(0, 5).join(' · ') : L('条件都不满足','No condition met');
    const sub = m.flags.length ? capEn(m.flags[0]) : w.cons.length ? L('差：','Missing: ') + w.cons.slice(0, 2).join(L('、',' · ')) : '';
    return `<div class="mm-why" data-tip="${tip}"><div class="mm-main">${main}</div>${sub ? `<div class="mm-sub ${m.flags.length ? 'dot-warn' : ''}">${sub}</div>` : ''}</div>`; };
  const nums = list => `<div class="mm-nums">${list.map(([k, v, c, x]) => `<div><span>${k}</span><b class="${c}">${v}</b>${x ? `<small>${x}</small>` : ''}</div>`).join('')}</div>`;
  const id = m => `<div class="mm-id"><a>${m.sym}</a><span>${m.score}/7</span></div>`;
  const heldRow = m => { const A = holdAction(m, H); return `<div class="mm-row" onclick="openStock('${m.sym}')">${id(m)}${A.note ? `<div class="mm-why"><div class="mm-main">${momoWhy(m).pros.slice(0, 5).join(' · ') || L('条件都不满足','No condition met')}</div><div class="mm-sub dot-warn">${capEn(A.note)}</div></div>` : reason(m)}
      <div class="mm-actw"><span class="pill mm-act ${A.act}">${{ buy:'BUY', hold:'HOLD', sell:'SELL' }[A.act]}</span></div>${nums(A.nums.map(n => [n[0], n[1], n[2]]))}
      </div>`; };
  const candRow = m => `<div class="mm-row" onclick="openStock('${m.sym}')">${id(m)}${reason(m)}
      <div class="mm-actw"><span class="pill mm-act ${m.grade === 'hi' ? 'strong' : 'mid'}">${gradeTxt(m.grade)}</span></div>${nums([[m.entryKind === 'brk' ? L('突破买入','Breakout') : L('回踩买入','Pullback'), px(m.entry), ''], [L('止损','Stop'), px(m.stop), 'loss-t']])}
      </div>`;
  el.innerHTML = head(sel)
    + (held.length ? `<div class="mm-cap">${L('我持有的','Held')}</div><div class="mm-list">${held.map(heldRow).join('')}</div>` : '')
    + (strongC.length ? `<div class="mm-cap">${L('可以买的','Candidates')}</div><div class="mm-list">${strongC.map(candRow).join('')}</div>` : '')
    + `<div class="mm-foot">${weakC.length ? L('条件太少、先不碰：','Not enough evidence: ') + weakC.map(m => `<a class="lnk" onclick="openStock('${m.sym}')">${m.sym}</a>`).join('、') + ' · ' : ''}${L('按 7 个条件打分，不是预测。','Scored on 7 conditions — not a forecast.')}</div>`;
}

// ---------- presets ----------
const PRESETS = () => ({
  small: { t:L('小盘高成长','Small-cap growth'), d:L('市值 $2–20B · 营收增速 >25% · 毛利率 >40% · 日均成交 >$20M','mcap $2–20B · revenue growth >25% · gross margin >40% · $20M+ daily volume'), need:'metric' },
  high:  { t:L('接近新高但不过热','Near highs, not hot'), d:L('距 52 周高 5% 内 · RSI < 70 · 高于 20 日线不到 10%','within 5% of the 52w high · RSI < 70 · <10% above MA20'), need:null },
  beat:  { t:L('财报连续超预期','Serial beaters'), d:L('最近 4 个季度 EPS 都超预期','EPS beat in each of the last 4 quarters'), need:'eps' },
});
function presetTest(key, sym){
  const I = ind(sym); const why = [], risk = [];
  if(key === 'small'){
    const m = fh.metric[sym] && fh.metric[sym].d; if(!m) return null;
    const ok = m.mcap >= 2000 && m.mcap <= 20000 && m.rg > 25 && m.gm > 40 && I && I.dvol20 > 20e6;
    if(!ok) return false;
    why.push(L(`市值 $${fmt(m.mcap/1000,1)}B`, `mcap $${fmt(m.mcap/1000,1)}B`), L(`营收 +${fmt(m.rg,0)}%`, `rev +${fmt(m.rg,0)}%`), L(`毛利率 ${fmt(m.gm,0)}%`, `GM ${fmt(m.gm,0)}%`));
  } else if(key === 'high'){
    if(!I || !(I.distHi52 >= -5 && I.rsi < 70 && I.vsMa20 < 10)) return false;
    // off-high and RSI are already columns — nothing to add here
  } else if(key === 'beat'){
    const e = fh.eps[sym] && fh.eps[sym].d; if(!e) return null;
    const last4 = e.slice(0, 4); if(last4.length < 4 || !last4.every(x => x.act != null && x.est != null && x.act > x.est)) return false;
    why.push(L('连续 4 季超预期','4 straight beats'), L(`平均 ${sg(last4.reduce((s,x) => s + (x.sp || 0), 0) / 4, 0)}`, `avg ${sg(last4.reduce((s,x) => s + (x.sp || 0), 0) / 4, 0)}`));
  }
  const b = betaOf(sym); if(b > 2) risk.push(L(`高波动 Beta ${fmt(b,1)}`, `high beta ${fmt(b,1)}`));
  if(isLev(sym)) risk.push(L('杠杆 ETF','leveraged'));
  return { why, risk };
}
async function loadFundamentals(kind){
  if(!/\S/.test(finnhubKey)){ openSettings(); return; }
  const U = radarUniverse().filter(s => !isLev(s));
  const todo = U.filter(s => kind === 'metric' ? !fhFresh('metric', s, 24*7) : !fhFresh('eps', s, 72));
  fundBusy = { done:0, total:todo.length }; renderRadar();
  for(const s of todo){ try{ await (kind === 'metric' ? loadMetric(s) : loadEps(s)); }catch(e){} fundBusy.done++; if(fundBusy.done % 4 === 0) renderRadar(); }
  fundBusy = null; renderRadar();
}

// ---------- radar ----------
function radarRows(){
  const H = holdingsNow(), M = riskModel();
  return radarUniverse().map(sym => {
    const I = ind(sym), plan = activePlans().find(p => p.sym === sym), h = H.map[sym];
    const p = lastPx(sym);
    const er = nextEarnings(sym, 60);
    const ins = insiderView(sym);
    const flow = optFlow(sym);
    return { sym, I, plan, h, p, sec: sectorOf(sym), role: roleOf(sym, H), er, erD: er ? daysBetween(todayISO(), er) : null,
      inZone: plan && p != null && inZone(plan, p), flow, insAlert: ins && ins.alerts.length ? ins.alerts : null,
      chg1: quotes.q[sym] && quotes.q[sym].pc ? (quotes.q[sym].p / quotes.q[sym].pc - 1) * 100 : I ? I.chg1 : null };
  });
}
function radarSort(k){ if(radarState.sort === k) radarState.dir *= -1; else { radarState.sort = k; radarState.dir = k === 'sym' || k === 'er' ? 1 : -1; } renderRadar(); }
function radarToggle(sym){ radarState.open = radarState.open === sym ? null : sym; renderRadar(); }
function radarPick(sym, on){ const p = radarState.picked.filter(s => s !== sym); if(on) p.push(sym); radarState.picked = p.slice(-2); renderRadar(); }
function radarAddSym(){
  const i = document.getElementById('radarAdd'); const s = (i.value || '').toUpperCase().trim(); if(!s) return;
  cfg.universeAdd = [...new Set([...(cfg.universeAdd || []), s])]; cfg.universeDel = (cfg.universeDel || []).filter(x => x !== s); saveCfg(); i.value = ''; renderRadar();
  if(!S(s)) toast(L(`已加入 ${s}，下次盘后简报会拉它的 K 线`, `Added ${s}; its bars arrive with the next post-market run`));
}
function radarDel(sym){ cfg.universeDel = [...new Set([...(cfg.universeDel || []), sym])]; cfg.universeAdd = (cfg.universeAdd || []).filter(x => x !== sym); radarState.open = null; saveCfg(); renderRadar(); }
function radarRestore(){ cfg.universeDel = []; saveCfg(); renderRadar(); }

function sectorSummary(rows){
  const M = riskModel(); const myW = {}; M.secW.forEach(s => myW[s.s] = s.w);
  const by = {};
  rows.forEach(r => { (by[r.sec] = by[r.sec] || []).push(r); });
  return Object.entries(by).map(([s, list]) => {
    const withI = list.filter(r => r.I);
    return { s, n: list.length, withI: withI.length, avg1m: withI.length ? withI.reduce((a,r) => a + r.I.ret1m, 0) / withI.length : null,
      above: withI.length ? withI.filter(r => r.I.vsMa50 > 0).length / withI.length * 100 : null, my: myW[s] || 0 };
  }).sort((a,b) => (b.avg1m ?? -999) - (a.avg1m ?? -999));
}

function secHeadline(secs){
  const v = secs.filter(s => s.avg1m != null); if(v.length < 2) return '';
  const top = v.slice(0, 2), bot = v.slice(-2).reverse().filter(s => !top.includes(s));
  return `<div class="sec-line">${L('近 1 个月最强','Strongest, 1 month')}：${top.map(s => `<b>${esc(secName(s.s))} ${sg(s.avg1m,0)}</b>`).join('、')}　${L('最弱','Weakest')}：${bot.map(s => `<b class="loss-t">${esc(secName(s.s))} ${sg(s.avg1m,0)}</b>`).join('、')}<span class="muted sm">　${L('每张卡：近 1 月平均涨跌 · 圆点 = 每只股票是否在 50 日线上方 · 点卡片筛选','Each card: 1-month average · dots = stocks above MA50 · click to filter')}</span></div>`;
}
function renderRadar(){
  const el = document.getElementById('radarSec'); if(!el) return;
  const st = radarState;
  const head = `<div class="sec-head"><span class="badge"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 12 19 7"/><circle cx="12" cy="12" r="4"/></svg></span><h2>${L('AI 产业链雷达','AI-chain radar')}</h2>${pageHelp('radar')}
    <div class="grow"><input id="radarAdd" class="sk-in sm" placeholder="${L('+ 加入代码','+ add symbol')}" onkeydown="if(event.key==='Enter') radarAddSym()" style="text-transform:uppercase">${packChipIfNeeded()}${liveBtn()}</div></div>${liveStatusHtml()}`;
  if(liveOn()) livePack();
  if(!pack){ el.innerHTML = head + `<div class="watch-empty">${L('约 50 只 AI 产业链股票的趋势、RSI、财报和你的持仓状态都在一张表。需要先在设置里填 Twelve Data key（或导入数据包）。','Trend, RSI, earnings and your status for ~50 AI-chain names in one table. Add a Twelve Data key in Settings (or import a data pack) first.')}</div>`; return; }
  let rows = radarRows();
  const secs = sectorSummary(rows);
  const P = PRESETS();
  // filters
  if(st.filter !== 'all') rows = rows.filter(r => st.filter === 'none' ? r.role === 'none' : r.role === st.filter);
  if(st.sector) rows = rows.filter(r => r.sec === st.sector);
  let presetNote = '';
  if(st.preset){
    const res = rows.map(r => ({ r, t: presetTest(st.preset, r.sym) }));
    const unknown = res.filter(x => x.t === null).length;
    rows = res.filter(x => x.t).map(x => ({ ...x.r, why: x.t.why, risk: x.t.risk }));
    const need = P[st.preset].need;
    presetNote = `<div class="ps-note"><b>${P[st.preset].t}</b> · ${P[st.preset].d}${unknown ? ` · <span class="warn-t">${L(`${unknown} 只还没有${need === 'metric' ? '基本面' : '财报'}数据`, `${unknown} lack ${need === 'metric' ? 'fundamentals' : 'EPS'} data`)}</span> ${fundBusy ? `<span class="muted">${L('拉取中','loading')} ${fundBusy.done}/${fundBusy.total}…</span>` : `<a class="lnk" onclick="loadFundamentals('${need}')">${L(`从 Finnhub 拉取（约 ${Math.ceil(unknown * 0.4)} 秒）`, `fetch from Finnhub (~${Math.ceil(unknown * 0.4)}s)`)}</a>`}` : ''}<div class="muted sm">${L('只在雷达股票池里筛，不扫全市场（全市场需要付费数据）。','Screens the radar universe only — a full-market scan needs paid data.')}</div></div>`;
  }
  const val = (r, k) => k === 'sym' ? r.sym : k === 'er' ? (r.erD ?? 999) : k === 'chg1' ? r.chg1 : !r.I ? null : r.I[k];
  rows.sort((a,b) => { const x = val(a, st.sort), y = val(b, st.sort); if(x == null) return 1; if(y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * st.dir; });
  const counts = { all: radarUniverse().length };
  const segF = [['all',L('全部','All')],['hold',L('持仓','Held')],['plan',L('有计划','Plans')],['none',L('未关注','Not followed')]];
  const th = (k, t) => `<th class="srt ${st.sort === k ? (st.dir > 0 ? 'asc' : 'desc') : ''}" onclick="radarSort('${k}')">${t}</th>`;
  const myCell = r => r.role === 'hold' ? `<span class="my hold" title="${L('持仓','held')}">● ${r.h.avg ? sg((r.p / r.h.avg - 1) * 100, 0) : ''}</span>`
    : r.role === 'plan' ? `<span class="my plan">◐ ${esc(planCalc(r.plan, holdingsNow()).label || '')}</span>`
    : r.role === 'watch' ? `<span class="my watch">☆</span>` : `<a class="my none" aria-label="${L('加入观察','watch it')}" onclick="event.stopPropagation(); addWatchSym('${r.sym}')">—</a>`;
  // flags as plain grey text separated by dots (no coloured pills); hover for detail
  const tagList = r => [
    r.flow != null && r.flow >= 2 ? `${L('期权异动','Option flow')} ${fmt(r.flow,1)}×` : '',
    r.insAlert ? L('内部人','Insider') : '',
    isLev(r.sym) ? L('杠杆','Leveraged') : '',
    ...(r.why || []).map(w => capEn(w)),
    ...(r.risk || []).map(w => capEn(w))
  ].filter(Boolean);
  // flags as plain grey text, one per line (max 2; the rest sit behind "+N", hover lists them all)
  const tags = r => { const t = tagList(r); if(!t.length) return '';
    const more = t.length > 2 ? ` <span class="more" data-tip="${esc(t.slice(2).join('\n'))}">+${t.length - 2}</span>` : '';
    return t.slice(0, 2).map((x, i) => `<div><span>${esc(x)}</span>${i === 1 ? more : ''}</div>`).join(''); };
  const anyTags = rows.some(r => tags(r) !== '');   // the Tags column only exists when something has a tag
  const rowHtml = r => { const I = r.I; const cls = [r.inZone ? 'hl-zone' : '', r.erD != null && r.erD <= 7 ? 'hl-er' : '', I && I.vsMa50 < 0 ? 'hl-weak' : '', st.open === r.sym ? 'open' : ''].join(' ');
    return `<tr class="${cls}" onclick="openStock('${r.sym}')">
      <td onclick="event.stopPropagation()"><input type="checkbox" ${st.picked.includes(r.sym) ? 'checked' : ''} onchange="radarPick('${r.sym}', this.checked)"></td>
      <td><b class="rd-sym">${r.sym}</b><div class="rd-sec">${esc(secName(r.sec))}</div></td>
      <td class="num">${r.p != null ? fmt(r.p, r.p >= 100 ? 1 : 2) : '—'}</td>
      <td class="num ${r.chg1 >= 0 ? 'gain-t' : 'loss-t'}">${sg(r.chg1)}</td>
      <td class="num ${I && I.ret1m >= 0 ? 'gain-t' : 'loss-t'}">${I ? sg(I.ret1m, 0) : '—'}</td>
      <td class="num">${I ? sg(I.distHi52, 0) : '—'}</td>
      <td class="num ${I && I.vsMa50 >= 0 ? 'gain-t' : 'loss-t'}">${I && I.vsMa50 != null ? sg(I.vsMa50, 0) : '—'}</td>
      <td class="num ${I && (I.rsi > 70 || I.rsi < 30) ? 'warn-t' : ''}">${I ? fmt(I.rsi, 0) : '—'}</td>
      <td class="num ${r.erD != null && r.erD <= 7 ? 'warn-t' : ''}">${r.er ? md(r.er) : '—'}</td>
      <td>${anyTags ? `<div class="rd-tags">${tags(r)}</div>` : ''}</td>
      <td class="rd-my">${r.role === 'none' ? `<a class="rd-del" aria-label="${L('从雷达移除','remove from radar')}" onclick="event.stopPropagation(); radarDel('${r.sym}')">✕</a>` : ''}</td></tr>`; };
  el.innerHTML = head + `
    ${secHeadline(secs)}
    <div class="sec-cards">${secs.map(s => { const up = s.withI ? Math.round(s.above / 100 * s.withI) : 0;
      return `<button class="sc-card ${st.sector === s.s ? 'on' : ''}" onclick="radarState.sector = radarState.sector === '${esc(s.s)}' ? null : '${esc(s.s)}'; renderRadar()">
        <div class="scc-top"><b>${esc(secName(s.s))}</b><span class="scc-ret ${Math.abs(s.avg1m) < 0.5 ? '' : s.avg1m > 0 ? 'gain-t' : 'loss-t'}">${s.avg1m != null ? sg(s.avg1m, 0) : '—'}</span></div>
        <div class="scc-dots">${'<i class="on"></i>'.repeat(up)}${'<i></i>'.repeat(Math.max(0, s.withI - up))}<span>${L(`${up}/${s.withI} 趋势向上`, `${up}/${s.withI} uptrend`)}</span></div>
        ${s.my ? `<div class="scc-my ${s.my > cfg.maxSector ? 'loss-t' : ''}">${L('我的仓位','My weight')} ${fmt(s.my,0)}%</div>` : ''}</button>`; }).join('')}</div>
    <div class="rd-bar"><div class="seg">${segF.map(([k,t]) => `<button class="${st.filter === k ? 'on' : ''}" onclick="radarState.filter='${k}'; renderRadar()">${t}</button>`).join('')}</div>
      <div class="seg ps-seg"><span class="muted sm">${L('预设','Presets')}</span>${Object.entries(P).map(([k, p]) => `<button class="${st.preset === k ? 'on' : ''}" title="${esc(p.d)}" onclick="radarState.preset = radarState.preset === '${k}' ? null : '${k}'; renderRadar()">${p.t}</button>`).join('')}</div>
      ${st.sector ? `<span class="chip on" onclick="radarState.sector=null; renderRadar()">${esc(secName(st.sector))} ✕</span>` : ''}</div>
    ${presetNote}
    <div class="rd-wrap"><table class="rd-tbl"><colgroup><col style="width:36px"><col style="width:110px"><col style="width:66px"><col style="width:66px"><col style="width:72px"><col style="width:92px"><col style="width:82px"><col style="width:46px"><col style="width:64px"><col><col style="width:28px"></colgroup><thead><tr><th></th>${th('sym', L('代码 · 板块','Symbol'))}<th class="num">${L('现价','Price')}</th>${th('chg1', `<span class="term" data-tip="${L('今天涨跌','change today')}">${L('今日','Today')}</span>`)}${th('ret1m', `<span class="term" data-tip="${L('近 1 个月涨跌','1-month change')}">${L('1 个月','1 month')}</span>`)}${th('distHi52', `<span class="term" data-tip="${L('离过去一年最高价还差多少；0% = 在新高','how far below the 52-week high; 0% = at the high')}">${L('距一年高点','Off 52w high')}</span>`)}${th('vsMa50', `<span class="term" data-tip="${L('比 50 日均线高（+）还是低（−）多少；正数 = 中期趋势向上','how far above (+) or below (−) the 50-day average; positive = medium-term uptrend')}">${L('比 50 日线','vs 50-day')}</span>`)}${th('rsi','RSI')}${th('er', L('财报','ER'))}<th>${anyTags ? L('标签','Tags') : ''}</th><th></th></tr></thead>
      <tbody>${rows.slice(0, st.all || st.preset || st.sector || st.filter !== 'all' ? 999 : 20).map(rowHtml).join('') || `<tr><td colspan="11" class="muted" style="padding:18px">${L('没有符合条件的股票','nothing matches')}</td></tr>`}</tbody></table></div>
    ${rows.length > 20 && !(st.all || st.preset || st.sector || st.filter !== 'all') ? `<a class="lnk mo-more" onclick="radarState.all=true; renderRadar()">${L(`看全部 ${rows.length} 只`, `show all ${rows.length}`)}</a>` : ''}
    <div class="rd-legend"><span class="hl-zone">${L('进了计划区间','in plan zone')}</span><span class="hl-er">${L('7 天内财报','earnings ≤7d')}</span><span class="hl-weak">${L('跌破 50 日线','below MA50')}</span>${(cfg.universeDel || []).length ? `<a class="lnk" onclick="radarRestore()">${L(`已移除 ${cfg.universeDel.length} 只 · 恢复`, `${cfg.universeDel.length} removed · restore`)}</a>` : ''}</div>
    ${st.picked.length ? `<div class="cmp-float"><span class="cf-k">${L('对比','Compare')}</span><span class="cf-slot">${st.picked[0]}</span><span class="cf-vs">vs</span><span class="cf-slot b ${st.picked[1] ? '' : 'empty'}">${st.picked[1] || L('再勾一只','pick one')}</span><button class="btn-primary btn-small" ${st.picked.length === 2 ? `onclick="openCompare('${st.picked[0]}','${st.picked[1]}')"` : 'disabled'}>${L('开始对比','Compare')}</button><button class="icon-btn cf-x" aria-label="${L('取消','clear')}" onclick="radarState.picked=[]; renderRadar()">✕</button></div>` : ''}`;
}
function radarCard(r){
  const I = r.I, m = I ? momentum(r.sym) : null, nl = I ? nearestLevels(r.sym) : null;
  return `<div class="rd-card">
    ${I ? sparkSvg(r.sym, 60, 160, 44) : ''}
    <div class="rd-cb"><div>${I ? statusLine(r.sym) : L('还没有 K 线数据','no bars yet')}</div>
      ${nl ? `<div class="muted sm">${nl.sup[0] ? L(`支撑 ${px(nl.sup[0].lo)}–${px(nl.sup[0].hi)} ${dots(nl.sup[0].score)}`, `support ${px(nl.sup[0].lo)}–${px(nl.sup[0].hi)} ${dots(nl.sup[0].score)}`) : ''}${nl.res[0] ? ' · ' + L(`压力 ${px(nl.res[0].lo)}–${px(nl.res[0].hi)} ${dots(nl.res[0].score)}`, `resistance ${px(nl.res[0].lo)}–${px(nl.res[0].hi)} ${dots(nl.res[0].score)}`) : ''}${m ? ` · ${L('动能','momentum')} <span class="mo-badge ${m.grade}">${gradeTxt(m.grade)} ${m.score}</span>` : ''}</div>` : ''}
      ${r.insAlert ? `<div class="dot-warn sm">${r.insAlert.map(a => a.t).join('；')}</div>` : ''}</div>
    <div class="rd-ca"><button class="btn-primary btn-small" onclick="openStock('${r.sym}')">${L('个股页','Open')} →</button>${!r.plan ? `<button class="btn-ghost btn-small" onclick="prefillPlan({sym:'${r.sym}'})">${L('建计划','Plan')}</button>` : ''}${r.role === 'none' ? `<button class="btn-ghost btn-small" onclick="radarDel('${r.sym}')">${L('从雷达移除','remove')}</button>` : ''}</div></div>`;
}

/* ---------- same-chain compare + swap simulation ---------- */
function openCompare(a, b){
  cmp.a = a; cmp.b = b;
  switchTab('watchlist'); renderCompare();
  setTimeout(() => { const s = document.getElementById('cmpSec'); if(s) s.scrollIntoView({ behavior:'smooth', block:'start' }); }, 40);
  [a, b].forEach(s => loadMetric(s).then(() => renderCompare()));
}
function cmpSet(which, v){ v = String(v || '').toUpperCase().trim(); if(!v) return; cmp[which] = v; renderCompare(); loadMetric(v).then(() => renderCompare()); }
function cmpSeries(syms, days){
  const maps = syms.map(s => { const b = S(s); if(!b) return null; const m = {}; b.t.forEach((t, i) => m[t] = b.c[i]); return m; });
  if(maps.some(m => !m)) return null;
  const dates = Object.keys(maps[0]).filter(t => maps.every(m => t in m)).sort().slice(-(days + 1));
  return { dates, cols: maps.map(m => dates.map(t => m[t])) };
}
function stopFor(sym){
  const plan = activePlans().find(p => p.sym === sym); if(plan) return { v: plan.stop, est:false };
  const m = num(cfg.stops[sym]); if(m != null) return { v: m, est:false };
  const nl = nearestLevels(sym); const s = nl.sup.find(l => l.score >= 2) || nl.sup[0];
  return s ? { v: s.lo, est:true } : null;
}
function swapSim(a, b){
  const H = holdingsNow(); const ha = H.map[a]; if(!ha || ha.qty <= 0) return null;
  const pa = lastPx(a), pb = lastPx(b); if(!pa || !pb) return null;
  const val = ha.qty * pa, qb = Math.floor(val / pb);
  const before = riskModel();
  const secW = rows => { const m = {}; rows.forEach(r => m[r.sector] = (m[r.sector] || 0) + r.mv); return m; };
  const rowsB = before.rows.map(r => ({ sym:r.sym, mv:r.mv, sector:r.sector, beta:r.beta, trig:r.trig })).filter(r => r.sym !== a);
  const exist = rowsB.find(r => r.sym === b);
  const sb = stopFor(b);
  const addTrig = sb && sb.v < pb ? (sb.v - pb) * qb : null;
  if(exist){ exist.mv += qb * pb; exist.trig = (exist.trig || 0) + (addTrig || 0); }
  else rowsB.push({ sym:b, mv: qb * pb, sector: sectorOf(b), beta: betaOf(b), trig: addTrig });
  const T = H.total;
  const bs = secW(before.rows), as = secW(rowsB);
  const secs = [...new Set([sectorOf(a), sectorOf(b)])];
  const betaA = rowsB.reduce((s,r) => s + r.beta * r.mv, 0) / T;
  const trigA = rowsB.reduce((s,r) => s + (r.trig || 0), 0);
  return { qa: ha.qty, val, qb, secs: secs.map(s => ({ s, b: (bs[s] || 0) / T * 100, a: (as[s] || 0) / T * 100 })), beta:[before.beta, betaA], trig:[before.trigTotal, trigA], stopB: sb };
}
function cmpDefaults(){
  if(cmp.a && cmp.b) return;
  const H = holdingsNow();
  const a = (H.list.find(h => S(h.sym)) || {}).sym || (watchlist.find(w => S(w.sym)) || {}).sym || 'NVDA';
  cmp.a = cmp.a || a; cmp.b = cmp.b || peerOf(cmp.a) || 'SPY';
}
function renderCompare(){
  const el = document.getElementById('cmpSec'); if(!el) return;
  const head = `<div class="sec-head"><span class="badge">⚖️</span><h2>${L('两只对比','Compare two')}</h2><div class="grow"></div></div>`;
  if(liveOn()) livePack();
  if(!pack){ el.innerHTML = head + `<div class="watch-empty">${L('填 Twelve Data key（或导入数据包）后可以对比任意两只。','Add a Twelve Data key (or import a data pack) to compare any two stocks.')}</div>`; return; }
  cmpDefaults();
  const a = cmp.a, b = cmp.b;
  if(liveOn() && document.getElementById('tab-watchlist').classList.contains('active')) ensureBars([a, b, 'SPY'], { first:true });
  const all = Object.keys(pack.bars).sort();
  const pick = (w, v, cls) => `<label class="cv-pick ${cls}"><i></i><input class="sk-in" value="${v || ''}" list="cmpList" onchange="cmpSet('${w}', this.value)" spellcheck="false"></label>`;
  const top = `<div class="cv-top">${pick('a', a, 'a')}<span class="cv-vs">vs</span>${pick('b', b, 'b')}<datalist id="cmpList">${all.map(s => `<option value="${s}">`).join('')}</datalist>
    <div class="seg">${[1,3,6,12].map(m => `<button class="${cmp.months === m ? 'on' : ''}" onclick="cmp.months=${m}; renderCompare()">${m}${L(' 个月','m')}</button>`).join('')}</div></div>`;
  const days = Math.round(cmp.months * 21);
  const ser = a && b ? cmpSeries([a, b, 'SPY'], days) : null;
  if(!ser || ser.dates.length < 10){ el.innerHTML = head + top + liveStatusHtml() + `<div class="watch-empty">${L('这两只里有一只还没有 K 线数据。','One of these has no bars yet.')}</div>`; return; }
  const n = ser.dates.length;
  const norm = ser.cols.map(c => c.map(v => (v / c[0] - 1) * 100));
  const W = 860, Hh = 220, pl = 8, pr = 70, tp = 10, bt = 20;
  const vals = norm.flat();
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pd = (hi - lo) * 0.06; lo -= pd; hi += pd;
  const X = i => pl + i / (n - 1) * (W - pl - pr), Y = v => tp + (hi - v) / (hi - lo) * (Hh - tp - bt);
  const path = (arr, col, w, dash) => `<path d="${arr.map((v,i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('')}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? 'stroke-dasharray="3 4"' : ''} stroke-linejoin="round"/>`;
  let g = `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line-strong)"/>`;
  let lastM = ''; ser.dates.forEach((t, i) => { const m = t.slice(5, 7); if(m !== lastM){ if(lastM) g += `<text x="${X(i)}" y="${Hh - 4}" class="ch-ax">${+m}${L('月','')}</text>`; lastM = m; } });
  g += path(norm[2], '#B9B3A5', 1.2, true) + path(norm[1], '#5A6FD0', 2.2) + path(norm[0], '#1B4D3E', 2.2);
  const lab = (v, col, s) => `<text x="${W - pr + 6}" y="${Y(v) + 4}" class="ch-lv" fill="${col}">${s} ${sg(v,0)}</text>`;
  const ends = [[norm[0][n-1], '#1B4D3E', a], [norm[1][n-1], '#5A6FD0', b], [norm[2][n-1], '#9a9586', 'SPY']].sort((x,y) => y[0] - x[0]);
  let lastY = -99; ends.forEach(e => { let y = Y(e[0]); if(y - lastY < 13) y = lastY + 13; lastY = y; g += `<text x="${W - pr + 6}" y="${y + 4}" class="ch-lv" fill="${e[1]}">${e[2]} ${sg(e[0],0)}</text>`; });
  // stats
  const r = ser.cols.map(c => c.slice(1).map((v, i) => v / c[i] - 1));
  const spyR = r[2];
  const avg = arr => arr.length ? arr.reduce((s,v) => s + v, 0) / arr.length * 100 : null;
  const upI = spyR.map((v,i) => v > 0 ? i : -1).filter(i => i >= 0), dnI = spyR.map((v,i) => v < 0 ? i : -1).filter(i => i >= 0);
  const st = k => ({ tot: norm[k][n-1], up: avg(upI.map(i => r[k][i])), dn: avg(dnI.map(i => r[k][i])), worst: Math.min(...r[k]) * 100 });
  const SA = st(0), SB = st(1);
  const diff = r[0].map((v,i) => v - r[1][i]);
  const lead = diff.reduce((s,v) => s + v, 0);
  const sorted = diff.slice().sort((x,y) => lead >= 0 ? y - x : x - y);
  const after = lead - sorted.slice(0, 3).reduce((s,v) => s + v, 0);
  const leader = SA.tot >= SB.tot ? a : b;
  const robust = Math.sign(after) === Math.sign(lead) && Math.abs(after) > 0.002;
  const verdict = `<div class="cv-verdict"><b>${leader}</b> ${L(`${cmp.months} 个月多涨了 ${fmt(Math.abs(SA.tot - SB.tot),1)}%`, `led by ${fmt(Math.abs(SA.tot - SB.tot),1)} pts over ${cmp.months}m`)}<span>${robust ? L('领先比较稳，不是靠一两天','a steady lead, not one or two days') : L('主要靠少数几天，不算稳','mostly from a few days — not steady')}</span></div>`;
  const row = (k, va, vb, f, better) => { const wa = va != null && vb != null && va !== vb ? (better > 0 ? va > vb : va < vb) : null;
    return `<div class="cv-row"><span class="cv-k">${k}</span><span class="cv-v ${wa === true ? 'win' : ''}">${va == null ? '—' : f(va)}</span><span class="cv-v ${wa === false ? 'win' : ''}">${vb == null ? '—' : f(vb)}</span></div>`; };
  const ma = (fh.metric[a] && fh.metric[a].d) || null, mb = (fh.metric[b] && fh.metric[b].d) || null;
  const val = ma || mb ? row(L('市盈率','P/E'), ma && ma.pe, mb && mb.pe, v => fmt(v,0), sectorOf(a) === sectorOf(b) ? -1 : 0) + row(L('营收增速','Revenue growth'), ma && ma.rg, mb && mb.rg, v => fmt(v,0) + '%', 1) + row(L('毛利率','Gross margin'), ma && ma.gm, mb && mb.gm, v => fmt(v,0) + '%', 1) : '';
  const sim = swapSim(a, b) || swapSim(b, a);
  const from = swapSim(a, b) ? a : b, to = from === a ? b : a;
  const simTxt = sim ? `<div class="cv-sim">${L(`如果把 <b>${from}</b> 换成 <b>${to}</b>：`, `If you swapped <b>${from}</b> into <b>${to}</b>: `)}${L('组合 Beta','beta')} ${fmt(sim.beta[0],2)} → <b>${fmt(sim.beta[1],2)}</b>${L('，全部打到止损会亏 ',', loss if all stops hit ')}${money(sim.trig[0])} → <b>${money(sim.trig[1])}</b>${sim.secs.filter(x => x.a > cfg.maxSector).map(x => L(`，${secName(x.s)} 板块仍占 ${fmt(x.a,0)}%（超上限）`, `, ${secName(x.s)} still ${fmt(x.a,0)}% (over limit)`)).join('')}。</div>` : '';
  el.innerHTML = head + top + `<div class="cv-card">
      <svg class="kchart" viewBox="0 0 ${W} ${Hh}">${g}</svg>
      ${verdict}
      <div class="cv-grid"><div class="cv-row cv-h"><span></span><span class="cv-v"><i class="a"></i>${a}</span><span class="cv-v"><i class="b"></i>${b}</span></div>
        ${row(L('涨幅','Return'), SA.tot, SB.tot, v => sg(v), 1)}${row(L('大盘涨的日子','On SPY up days'), SA.up, SB.up, v => sg(v,2), 1)}${row(L('大盘跌的日子','On SPY down days'), SA.dn, SB.dn, v => sg(v,2), 1)}${row(L('最差的一天','Worst day'), SA.worst, SB.worst, v => sg(v), 1)}${val}</div>
      ${simTxt}</div>`;
}

/* ---------- calendar: 14-day strip, macro table, FOMC card, earnings with $ exposure ---------- */
let calSel = null;
const SEP_MONTHS = [3, 6, 9, 12];
function fomcInfo(){
  const today = todayISO();
  const next = MACRO_FOMC.find(d => d >= today); if(!next) return null;
  const prev = [...MACRO_FOMC].reverse().find(d => d < today);
  const m = +next.slice(5, 7);
  return { date: next, start: addDays(next, -1), dots: SEP_MONTHS.includes(m), days: daysBetween(today, next),
    minutes: prev ? addDays(prev, 21) : null, prev };
}
function macroBias(e){
  if(e.bias === 'pos' || e.bias === 'neg') return e.bias;
  const a = parseFloat(String(e.actual).replace(/[^\d.\-]/g, '')), f = parseFloat(String(e.forecast).replace(/[^\d.\-]/g, ''));
  if(!isFinite(a) || !isFinite(f) || a === f) return null;
  const up = a > f;
  if(/CPI|PPI|PCE|inflation|通胀|物价/i.test(e.event)) return up ? 'neg' : 'pos';
  if(/claims|失业金|unemployment rate|失业率/i.test(e.event)) return up ? 'neg' : 'pos';
  if(/GDP|retail|零售|ISM|PMI|payroll|非农|confidence|信心/i.test(e.event)) return up ? 'pos' : 'neg';
  return null;
}
function dayReturn(sym, date){ const b = S(sym); if(!b) return null; const i = b.t.indexOf(date); return i > 0 ? (b.c[i] / b.c[i-1] - 1) * 100 : null; }
// $ change of what you actually held that day (shares from your trade history), else today's holdings
function qtyAt(sym, date){ let q = 0; AT().forEach(t => { if(t.sym === sym && d10(t.date) < date) q += t.side === 'BUY' ? t.qty : -t.qty; }); return q; }
function myDayPnl(date){
  const syms = [...new Set(AT().map(t => t.sym))];
  let tot = 0, any = false, est = false;
  for(const s of syms){ const b = S(s); if(!b) continue; const i = b.t.indexOf(date); if(i < 1) continue; const q = qtyAt(s, date); if(!q) continue; tot += q * (b.c[i] - b.c[i-1]); any = true; }
  if(!any){ const H = holdingsNow(); H.list.forEach(h => { const b = S(h.sym); if(!b) return; const i = b.t.indexOf(date); if(i < 1) return; tot += h.qty * (b.c[i] - b.c[i-1]); any = true; est = true; }); }
  return any ? { v: tot, est } : null;
}
function calItems(from, to){
  const out = [];
  const macro = (pack && pack.macro) || [];
  macro.forEach(e => { if(e.date >= from && e.date <= to) out.push({ date:e.date, kind:'macro', e, sort: e.time || '99' }); });
  if(!macro.length){ macroEventsForRange(1).forEach(m => { if(m.date >= from && m.date <= to && !/FOMC/.test(m.text)) out.push({ date:m.date, kind:'approx', text:m.text }); }); }
  const f = fomcInfo(); if(f && f.date >= from && f.date <= to) out.push({ date:f.date, kind:'fomc', sort:'14:00' });
  const U = new Set([...radarUniverse(), ...Object.keys(myUniverse())]);
  const H = holdingsNow();
  Object.keys(calendarEvents).forEach(k => { if(k < from || k > to) return; (calendarEvents[k] || []).forEach(ev => {
    if(ev.category !== 'earnings') return;
    const sym = String(ev.text || '').toUpperCase().split(/\s/)[0]; if(!U.has(sym)) return;
    const sn = pack && pack.snap && pack.snap[sym]; const h = H.map[sym];
    const er = fh.er[sym] && fh.er[sym].d; let avg = null;
    if(er && S(sym)){ const b = S(sym); const mv = er.filter(e => e.date < todayISO() && e.act != null).slice(0, 4).map(e => { const i = b.t.indexOf(e.date); return i > 0 && i + 1 < b.c.length ? Math.max(Math.abs(b.c[i]/b.c[i-1]-1), Math.abs(b.c[i+1]/b.c[i]-1)) * 100 : null; }).filter(v => v != null); if(mv.length) avg = mv.reduce((s,v)=>s+v,0)/mv.length; }
    const ivMove = sn && sn.iv ? sn.iv * Math.sqrt(Math.max(1, daysBetween(todayISO(), k)) / 365) * 100 : null;
    const mvPct = avg ?? ivMove;
    out.push({ date:k, kind:'er', sym, hour: /pre/.test(ev.text) ? 'bmo' : /post/.test(ev.text) ? 'amc' : '', held: !!h, role: H.map[sym] ? 'hold' : activePlans().some(p => p.sym === sym) ? 'plan' : watchlist.some(w => w.sym === sym) ? 'watch' : 'radar', iv: sn && sn.iv, mvPct, mvSrc: avg != null ? 'hist' : 'iv', expo: h && mvPct ? h.mv * mvPct / 100 : null, sort: /pre/.test(ev.text) ? '08:00' : '16:30' });
  }); });
  return out.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.sort || '').localeCompare(String(b.sort || '')));
}
// the calendar tab keeps ONE calendar (the month grid); this section is just the FOMC card above it
function renderMacroSec(){
  const el = document.getElementById('macroSec'); if(!el) return;
  const f = fomcInfo();
  el.innerHTML = (f ? `<div class="fomc-card"><div class="fc-l"><span class="fc-k">FOMC</span><b>${md(f.start)}–${md(f.date)}</b><span class="muted">${L(`${f.days} 天后`, `in ${f.days} days`)}</span></div>
      <div class="fc-r"><span>${L('决议','Decision')} <b>14:00 ET</b></span><span>${L('发布会','Presser')} <b>14:30 ET</b></span><span>${L('点阵图','Dot plot')} <b>${f.dots ? L('有','yes') : L('无','no')}</b></span>${f.minutes ? `<span>${L('上次会议纪要','Last minutes')} <b>${md(f.minutes)}</b></span>` : ''}</div></div>` : '')
    + (packChipIfNeeded() ? `<div class="t-status">${packChipIfNeeded()}</div>` : '');
}
const stars = n => '★'.repeat(n || 1) + '<span class="dim">' + '★'.repeat(3 - (n || 1)) + '</span>';
const biasTag = b => b === 'pos' ? `<em class="tag green">${L('对股市偏利好','equity-positive')}</em>` : b === 'neg' ? `<em class="tag red">${L('对股市偏利空','equity-negative')}</em>` : '';
function calRowHtml(i){
  const f = fomcInfo();
  const delta = e => { const a = parseFloat(String(e.actual).replace(/[^\d.\-]/g,'')), fc = parseFloat(String(e.forecast).replace(/[^\d.\-]/g,'')); return isFinite(a) && isFinite(fc) ? `<span class="dlt">Δ ${a - fc > 0 ? '+' : ''}${fmt(a - fc, 2)}</span>` : ''; };
  if(i.kind === 'macro'){ const e = i.e, done = e.actual != null && e.actual !== '';
    return `<div class="cm-row ${e.stars >= 3 ? 'hi' : ''}"><span class="cm-time">${esc(e.time || '')}</span><span class="cm-star"></span><span class="cm-ev"><b>${esc(e.event)}</b>${e.period ? ` <span class="muted">${esc(e.period)}</span>` : ''}</span>
      <span class="cm-num">${L('预期','fcst')} <b>${esc(e.forecast ?? '—')}</b> · ${L('前值','prior')} ${esc(e.prior ?? '—')}${done ? ` · ${L('实际','actual')} <b>${esc(e.actual)}</b> ${delta(e)}` : ''}</span><span>${done ? biasTag(macroBias(e)) : ''}</span></div>`; }
  if(i.kind === 'fomc') return `<div class="cm-row hi"><span class="cm-time">14:00</span><span class="cm-star"></span><span class="cm-ev"><b>${L('FOMC 利率决议','FOMC decision')}</b>${f && f.dots ? ` <span class="muted">${L('含点阵图','with dot plot')}</span>` : ''}</span><span class="cm-num">${L('14:30 发布会','14:30 press conference')}</span><span></span></div>`;
  if(i.kind === 'er') return `<div class="cm-row er ${i.held ? 'held' : ''}"><span class="cm-time">${i.hour === 'bmo' ? L('盘前','pre') : i.hour === 'amc' ? L('盘后','post') : ''}</span><span class="cm-star"><span class="mn-role ${i.role === 'radar' ? '' : i.role}">${i.role === 'hold' ? L('持仓','held') : i.role === 'plan' ? L('计划','plan') : i.role === 'watch' ? L('观察','watch') : L('雷达','radar')}</span></span>
      <span class="cm-ev"><a class="lnk" onclick="openStock('${i.sym}')"><b>${i.sym}</b></a> ${L('财报','earnings')}</span>
      <span class="cm-num">${i.iv ? L(`隐含波动 ${fmt(i.iv*100,0)}%`, `IV ${fmt(i.iv*100,0)}%`) : ''}${i.mvPct ? ` · ${i.mvSrc === 'hist' ? L('历史平均','hist avg') : '1σ'} ±${fmt(i.mvPct,1)}%` : ''}</span>
      <span>${i.expo ? `<b class="loss-t" title="${L('这笔仓位可能的单日波动','possible one-day swing of your position')}">±${money(i.expo)}</b>` : ''}</span></div>`;
  return '';
}
function calPick(key){ calSel = calSel === key ? null : key; renderCalendar(); if(calSel) setTimeout(() => { const d = document.getElementById('calDay'); if(d) d.scrollIntoView({ behavior:'smooth', block:'nearest' }); }, 30); }
function renderCalDay(){
  const el = document.getElementById('calDay'); if(!el) return;
  if(!calSel){ el.innerHTML = ''; return; }
  const d = calSel, today = todayISO();
  const rows = calItems(d, d);
  const mine = (calendarEvents[d] || []).filter(ev => !(ev.source || '').startsWith('auto'));
  const exp = activePlans().filter(p => d10(p.expiry) === d);
  let react = '';
  if(d < today){ const spy = dayReturn('SPY', d), my = myDayPnl(d);
    if(spy != null || my) react = `<div class="cm-react"><b>${L('当天','That day')}</b><span>SPY <b class="${spy >= 0 ? 'gain-t' : 'loss-t'}">${spy != null ? sg(spy) : '—'}</b></span><span>${L('我的组合','My account')} <b class="${my && my.v >= 0 ? 'gain-t' : 'loss-t'}">${my ? money(my.v) : '—'}</b>${my && my.est ? ` <small class="muted">${L('按当前持仓估','est.')}</small>` : ''}</span></div>`; }
  const dd = localDate(d);
  el.innerHTML = `<div class="cal-day"><div class="cd-h"><b>${md(d)} ${L('周' + '日一二三四五六'[dd.getDay()], ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dd.getDay()])}</b>${d === today ? `<span class="muted">${L('今天','today')}</span>` : ''}<a class="lnk" onclick="openEventModal('${d}')">${L('+ 加事件','+ event')}</a><a class="cd-x" onclick="calPick('${d}')">✕</a></div>
    ${rows.map(calRowHtml).join('')}
    ${exp.map(p => `<div class="cm-row"><span class="cm-time"></span><span class="cm-star"><span class="mn-role plan">${L('计划','plan')}</span></span><span class="cm-ev"><b>${p.sym}</b> ${L('计划到期','plan expires')}</span><span></span><span></span></div>`).join('')}
    ${mine.map(ev => `<div class="cm-row"><span class="cm-time"></span><span class="cm-star"></span><span class="cm-ev"><a class="lnk" onclick="openEventModal('${d}','${ev.id}')">${esc(ev.text)}</a>${ev.plan ? ` <span class="muted">— ${esc(ev.plan)}</span>` : ''}</span><span></span><span></span></div>`).join('')}
    ${react}
    </div>`;
  if(!rows.length && !mine.length && !exp.length && !react) el.innerHTML = '';
}
// month grid: same calendar as before, plus macro stars from the data pack, FOMC, held earnings highlighted, click a day for details
renderCalendar = function(){
  const year = calMonth.getFullYear(), month = calMonth.getMonth();
  document.getElementById('calMonthLabel').textContent = calMonth.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month:'long', year:'numeric' });
  const gridStart = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  const todayKey = todayISO();
  const newsDays = newsByDay();
  const macro = (pack && pack.macro) || [];
  const H = holdingsNow();
  let html = '';
  for(let i = 0; i < 42; i++){
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = dateKey(d);
    const isDim = d.getMonth() !== month, isWeekend = d.getDay() === 0 || d.getDay() === 6;
    let events = (calendarEvents[key] || []).slice();
    if(macro.length) events = events.filter(ev => !(ev.source === 'auto-macro' && /≈|payroll/i.test(ev.text)));
    events = events.filter(ev => !(ev.source === 'auto-macro' && /FOMC/.test(ev.text)));
    events.sort((a,b) => (a.source||'').startsWith('auto') === (b.source||'').startsWith('auto') ? 0 : (a.source||'').startsWith('auto') ? -1 : 1);
    const chips = [];
    if(MACRO_FOMC.includes(key)) chips.push(`<div class="cal-event macro" title="${L('FOMC 利率决议 14:00 ET','FOMC decision 2pm ET')}">FOMC</div>`);
    macro.filter(e => e.date === key).sort((a,b) => (b.stars||0) - (a.stars||0)).forEach(e => chips.push(`<div class="cal-event macro" title="${esc(`${e.time || ''} ${e.event} · ${L('预期','fcst')} ${e.forecast ?? '—'} · ${L('前值','prior')} ${e.prior ?? '—'}${e.actual != null ? ' · ' + L('实际','actual') + ' ' + e.actual : ''}`)}">${esc(e.event)}</div>`));
    events.forEach(ev => {
      const sym = String(ev.text || '').toUpperCase().split(/\s/)[0];
      const held = ev.category === 'earnings' && H.map[sym];
      const label = ev.category === 'earnings' ? `${sym} ${L('财报','ER')}${/pre/.test(ev.text) ? L(' · 盘前',' pre') : /post/.test(ev.text) ? L(' · 盘后',' post') : ''}` : esc(ev.text);
      chips.push(`<div class="cal-event ${ev.category} ${ev.plan ? 'has-plan' : ''} ${held ? 'held' : ''}" onclick="event.stopPropagation(); openEventModal('${key}','${ev.id}')" title="${esc(ev.text + (ev.plan ? ' — ' + ev.plan : ''))}">${label}</div>`);
    });
    (newsDays[key] || []).forEach(({it, idx}) => chips.push(`<div class="cal-event news" onclick="event.stopPropagation(); openNews(${idx})" title="${escHtml(it.headline)}">${escHtml(it.headline)}</div>`));
    const extra = chips.length > 4 ? chips.length - 3 : 0;
    html += `<div class="cal-cell ${isWeekend ? 'weekend' : ''} ${isDim ? 'dim' : ''} ${calSel === key ? 'sel' : ''}" onclick="calPick('${key}')">
      <div class="cal-date ${key === todayKey ? 'today' : ''}">${d.getDate()}</div>
      ${(extra ? chips.slice(0, 3) : chips).join('')}${extra ? `<div class="cal-more">+${extra}</div>` : ''}
      <div class="cal-add" onclick="event.stopPropagation(); openEventModal('${key}')">+</div></div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
  renderCalDay();
  renderToday(); renderMyNews();
};

/* ---------- review: abnormal-day trades, event-day performance, reminder log ---------- */
function abnormalTrades(){
  const out = [];
  AT().forEach(t => {
    const b = S(t.sym); if(!b) return;
    const d = d10(t.date), i = b.t.indexOf(d); if(i < 1) return;
    const chg = (b.c[i] / b.c[i-1] - 1) * 100;
    if(Math.abs(chg) < abnTh(t.sym).d1) return;
    const buy = t.side === 'BUY';
    const kind = buy ? (chg > 0 ? 'chase' : 'dip') : (chg < 0 ? 'panic' : 'strength');
    const j = Math.min(b.c.length - 1, i + 5);
    const after = j > i ? (b.c[j] / t.price - 1) * 100 : null;
    // good = bought and it went up after / sold and it went down after
    const good = after == null ? null : buy ? after > 0 : after < 0;
    out.push({ t, chg, kind, after, good, days: j - i });
  });
  return out.sort((a,b) => d10(a.t.date) < d10(b.t.date) ? 1 : -1);
}
function eventDays(){
  const spy = S('SPY'); if(!spy) return [];
  const first = spy.t[1], last = spy.t[spy.t.length - 1];
  const ev = [];
  MACRO_FOMC.filter(d => d >= first && d <= last).forEach(d => ev.push({ d, k:'FOMC' }));
  ((pack && pack.macro) || []).filter(e => e.stars >= 3 && e.date >= first && e.date <= last).forEach(e => {
    const k = /CPI/i.test(e.event) ? 'CPI' : /payroll|非农/i.test(e.event) ? L('非农','Payrolls') : /PCE/i.test(e.event) ? 'PCE' : null; if(k) ev.push({ d:e.date, k });
  });
  const traded = [...new Set(AT().map(t => t.sym))];
  traded.forEach(s => { const er = fh.er[s] && fh.er[s].d; if(!er) return; er.filter(e => e.date >= first && e.date <= last && e.act != null).forEach(e => { const q = qtyAt(s, e.date); if(q > 0) ev.push({ d: e.hour === 'amc' ? (spy.t[spy.t.indexOf(e.date) + 1] || e.date) : e.date, k:L('持仓财报','My earnings'), sym:s }); }); });
  return ev.map(x => ({ ...x, spy: dayReturn('SPY', x.d), my: myDayPnl(x.d) })).filter(x => x.spy != null);
}
function renderEventReview(){
  const el = document.getElementById('eventReview'); if(!el) return;
  const ab = pack ? abnormalTrades() : [];
  const ev = [];
  const log = (todayState.log || []).slice(0, 8);
  if(!ab.length && !ev.length && !log.length){ el.innerHTML = ''; return; }
  const kindTxt = k => ({ chase:L('大涨日买入','bought a big up day'), dip:L('大跌日买入','bought a big down day'), panic:L('大跌日卖出','sold a big down day'), strength:L('大涨日卖出','sold a big up day') })[k];
  const goodN = ab.filter(x => x.good === true).length, badN = ab.filter(x => x.good === false).length;
  const groups = {}; ev.forEach(x => (groups[x.k] = groups[x.k] || []).push(x));
  const avg = a => a.length ? a.reduce((s,v) => s + v, 0) / a.length : null;
  el.innerHTML = `<div class="sec-head"><span class="badge">🔍</span><h2>${L('大涨大跌那天的买卖','Trades on big-move days')}</h2></div>
    ${ab.length ? `<div class="sk-block"><div class="sk-bh">${L('在异常日（大涨大跌那天）的买卖','Trades on abnormal days')}<span class="muted sm">${L(`${ab.length} 笔 · 事后看对 ${goodN} 笔，错 ${badN} 笔`, `${ab.length} trades · ${goodN} right, ${badN} wrong in hindsight`)}</span></div>
      <div class="ab-list">${ab.slice(0, 12).map(x => `<div class="ab-row rv">
        <span class="ab-d">${md(x.t.date)}</span><a class="lnk" onclick="openStock('${x.t.sym}')"><b>${x.t.sym}</b></a>
        <span class="ab-c ${x.chg > 0 ? 'gain-t' : 'loss-t'}">${L('当天','day')} ${sg(x.chg)}</span>
        <span>${kindTxt(x.kind)} · ${x.t.side === 'BUY' ? L('买','B') : L('卖','S')} ${fmt(x.t.qty,0)} @ $${fmt(x.t.price)}</span>
        <span class="${x.good === true ? 'gain-t' : x.good === false ? 'loss-t' : 'muted'}">${x.after == null ? L('还没走完','too recent') : L(`之后 ${x.days} 天 ${sg(x.after)}`, `next ${x.days}d ${sg(x.after)}`) + (x.good === true ? ' ✓' : x.good === false ? (x.kind === 'chase' ? L(' · 追高了',' · chased') : x.kind === 'panic' ? L(' · 卖在低点',' · sold the low') : ' ✕') : '')}</span></div>`).join('')}</div></div>` : ''}
    ${log.length ? `<div class="sk-block"><div class="sk-bh">${L('今日提醒的处理记录','Reminders you handled')}</div>${log.map(x => `<div class="lg-row"><span class="muted">${md(x.date)}</span><span>${esc(x.title)}</span><em class="tag green">${L('已处理','done')}</em></div>`).join('')}</div>` : ''}`;
}

// Today: how big events usually hit you (one line), and the same number on tomorrow's event item
function eventStats(){
  const ev = pack ? eventDays() : []; const g = {};
  ev.forEach(x => (g[x.k] = g[x.k] || []).push(x));
  return Object.entries(g).map(([k, l]) => { const my = l.filter(x => x.my).map(x => x.my.v); return { k, n: l.length, my: my.length ? my.reduce((s,v)=>s+v,0) / my.length : null, spy: l.reduce((s,x)=>s+x.spy,0) / l.length }; });
}
function eventStatsHtml(){
  const st = eventStats().filter(x => x.my != null); if(!st.length) return '';
  return `<div class="ev-strip"><span class="ev-h">${L('大事件当天，你的组合平均','On big event days your account averages')}</span>${st.map(x => `<span class="ev-c"><b>${x.k}</b> <span class="${x.my >= 0 ? 'gain-t' : 'loss-t'}">${money(x.my)}</span><small>${L(`${x.n} 次`, `${x.n}×`)}</small></span>`).join('')}</div>`;
}

/* ---------- wiring: today, positions, navigation, demo pack, startup ---------- */
function semisMood(){
  const I = ind('SMH') || ind('SOXX'); if(!I) return null;
  const names = Object.keys(SECTORS).filter(s => SEMI_SECTORS.includes(SECTORS[s]) && ind(s));
  const above = names.length ? names.filter(s => ind(s).vsMa50 > 0).length / names.length * 100 : null;
  const ev = []; let sc = 0;
  const chk = (c, t) => { ev.push((c ? '✓ ' : '✗ ') + t); if(c) sc++; };
  chk(I.last > I.ma20, L('SMH 在 20 日线上方','SMH above MA20'));
  chk(I.last > I.ma50, L('SMH 在 50 日线上方','SMH above MA50'));
  chk(I.ret5 > 0, L(`SMH 5 日 ${sg(I.ret5)}`, `SMH 5d ${sg(I.ret5)}`));
  if(above != null) chk(above >= 55, L(`雷达里 ${fmt(above,0)}% 的半导体股站上 50 日线`, `${fmt(above,0)}% of radar semis above MA50`));
  const g = sc >= 3 ? 'hi' : sc <= 1 ? 'lo' : 'mid';
  return { g, t: g === 'hi' ? L('半导体偏强','Semis strong') : g === 'lo' ? L('半导体偏弱','Semis weak') : L('半导体中性','Semis neutral'), ev };
}
function todayStatusHtml(){
  const m = semisMood();
  return m ? `<div class="t-status"><span class="mood ${m.g}" tabindex="0" data-tip="${esc(m.ev.join('\n'))}">${m.t}</span></div>` : '';
}

// extra Today items: macro 3★ from the pack, insider alerts on holdings/plans
const _todayItems3 = todayItems;
todayItems = function(){
  let items = _todayItems3();
  const today = todayISO(), dis = todayState.dismiss;
  const extra = [];
  const macro = (pack && pack.macro) || [];
  if(macro.length){
    items = items.filter(i => !(i.key.startsWith('mac:') && /≈/.test(i.title)));
    macro.filter(e => e.stars >= 3 && (e.date === today || e.date === addDays(today, 1))).forEach(e => {
      if(items.some(i => i.key.startsWith('mac:') && i.title.includes(e.event))) return;
      extra.push({ grp:'event', key:`mac:${e.date}:${e.event}`, pr:6, title:`${e.date === today ? L('今天','Today') : L('明天','Tomorrow')} ${esc(e.time || '')} · ${esc(e.event)}${e.period ? ' (' + esc(e.period) + ')' : ''}`,
        sub: (() => { const k = /CPI/i.test(e.event) ? 'CPI' : /payroll|非农/i.test(e.event) ? L('非农','Payrolls') : null; const s0 = k && eventStats().find(x => x.k === k && x.my != null);
          return s0 ? L(`过去 ${s0.n} 次 ${k} 当天，你的组合平均 ${money(s0.my)}`, `on the last ${s0.n} ${k} days your account averaged ${money(s0.my)}`) : L(`预期 ${esc(e.forecast ?? '—')} · 前值 ${esc(e.prior ?? '—')}`, `fcst ${esc(e.forecast ?? '—')} · prior ${esc(e.prior ?? '—')}`); })(), go:`switchTab('calendar')` });
    });
  }
  const mine = [...new Set([...holdingsNow().list.map(h => h.sym), ...activePlans().map(p => p.sym)])];
  mine.forEach(sym => { const v = insiderView(sym); if(!v) return; const al = v.alerts.filter(a => daysBetween(d10(a.date), today) <= 14).sort((a,b) => (a.k === 'buy' ? -1 : a.k === 'cluster' ? 0 : 1) - (b.k === 'buy' ? -1 : b.k === 'cluster' ? 0 : 1)); if(!al.length) return;
    const latest = al.map(a => d10(a.date)).sort().pop();
    extra.push({ grp:'risk', key:`ins:${sym}:${latest}`, pr:5, title:`${sym} · ${al[0].t}`, sub: al.length > 1 ? L(`另有 ${al.length - 1} 条内部人提醒 · 点「查看」看明细`, `+${al.length - 1} more insider alerts`) : L(`${md(al[0].date)} · 内部人交易`, `${md(al[0].date)} · insider`), go:`openStock('${sym}')` }); });
  return items.concat(extra.filter(i => !(dis[i.key] && dis[i.key] > today))).sort((a,b) => a.pr - b.pr);
};
const _renderToday3 = renderToday;
renderToday = function(){
  _renderToday3();
  const d = document.querySelector('#todayView .today-date');
  const chip = packChipIfNeeded();
  if(d && chip && (trades.length || plans.length)) d.insertAdjacentHTML('afterend', `<div class="t-status">${chip}</div>`);
  const strip = eventStatsHtml(); const tv = document.getElementById('todayView');
  if(strip && tv && (trades.length || plans.length)) tv.insertAdjacentHTML('beforeend', strip);
};
let insiderAt = 0;
async function refreshInsiders(){
  if(!/\S/.test(finnhubKey) || Date.now() - insiderAt < 30 * 60e3) return;
  insiderAt = Date.now();
  const mine = [...new Set([...holdingsNow().list.map(h => h.sym), ...activePlans().map(p => p.sym)])].slice(0, 15);
  for(const s of mine){ await loadInsider(s); }
  renderToday(); if(typeof renderRadar === 'function') renderRadar();
}

// positions: "same bet" — holdings that move together
function sameBetHtml(){
  const H = holdingsNow(); const syms = H.list.filter(h => h.qty > 0 && S(h.sym)).map(h => h.sym);
  if(syms.length < 2) return '';
  const pairs = [];
  for(let i = 0; i < syms.length; i++) for(let j = i + 1; j < syms.length; j++){ const p = pairStats(syms[i], syms[j], 60); if(p && p.corr > 0.8) pairs.push([syms[i], syms[j], p.corr]); }
  if(!pairs.length) return `<div class="bet-note muted sm">${L('近 60 天没有相关性超过 0.8 的持仓组合，仓位比较分散。','No two holdings correlate above 0.8 over 60 days.')}</div>`;
  const parent = {}; const f = x => parent[x] === x || parent[x] == null ? (parent[x] = x) : (parent[x] = f(parent[x]));
  pairs.forEach(([a, b]) => { parent[f(a)] = f(b); });
  const groups = {}; [...new Set(pairs.flat().filter(x => typeof x === 'string'))].forEach(s => (groups[f(s)] = groups[f(s)] || []).push(s));
  return `<div class="sk-block bet"><div class="sk-bh">🔗 ${L('同一个赌注','Same bet')}<span class="muted sm">${L('近 60 天日涨跌相关性 > 0.8','60-day correlation > 0.8')}</span></div>${Object.values(groups).map(g => {
    const w = g.reduce((s, x) => s + H.map[x].mv, 0) / H.total * 100;
    const cs = pairs.filter(p => g.includes(p[0])).map(p => p[2]); const avgC = cs.reduce((s,v)=>s+v,0)/cs.length;
    const secs = [...new Set(g.map(x => secName(sectorOf(x))))].join(' / ');
    return `<div class="bet-row">${L(`<b>${g.join('、')}</b> 相关性 ${fmt(avgC,2)}，可以看作同一个方向（${esc(secs)}）。合计占账户 <b class="${w > cfg.maxSector ? 'loss-t' : ''}">${fmt(w,0)}%</b>${w > cfg.maxSector ? `，超过板块上限 ${cfg.maxSector}%` : ''}。`, `<b>${g.join(', ')}</b> correlate at ${fmt(avgC,2)} — effectively one bet (${esc(secs)}), together <b>${fmt(w,0)}%</b> of the account.`)}</div>`; }).join('')}</div>`;
}
const _renderRisk3 = renderRisk;
renderRisk = function(){ _renderRisk3(); const sec = document.getElementById('riskSection'); if(sec && holdingsNow().list.length && pack) sec.insertAdjacentHTML('beforeend', sameBetHtml()); };

const _toggleLang3 = toggleLang; toggleLang = async function(){ clearIndCache(); await _toggleLang3(); renderL3(); };
// navigation
const _switchTab3 = switchTab;
switchTab = function(name){
  _switchTab3(name);
  if(name === 'stock') renderStock();
  if(name === 'calendar') renderMacroSec();
  if(name === 'watchlist' && liveOn()) ensureBars(BENCH_SYMS.concat(momoUniverse().syms), { relaxed:true });
};
function aiCompact(){
  const sec = document.getElementById('aiReviewSec'); if(!sec) return;
  const off = !aiReady() && !sec.dataset.expand;
  sec.classList.toggle('ai-off', off);
  const h2 = sec.querySelector('.sec-head h2');
  let btn = document.getElementById('aiOnBtn');
  if(h2 && !btn){ btn = document.createElement('button'); btn.id = 'aiOnBtn'; btn.className = 'btn-ghost btn-small ai-on-btn';
    btn.onclick = () => { sec.dataset.expand = '1'; sec.classList.remove('ai-off'); document.getElementById('aiSettings').style.display = 'block'; };
    h2.insertAdjacentElement('afterend', btn); }
  if(btn) btn.textContent = L('开启','Turn on');
}
function renderL3(){ aiCompact(); renderMomo(); renderRadar(); renderCompare(); renderMacroSec(); renderEventReview(); const t = document.getElementById('tab-stock'); if(t && t.classList.contains('active')) renderStock(); }
const _render3 = render; render = function(){ _render3(); renderL3(); };

function clearPack(){ if(!confirm(L('清除已导入的数据包？','Remove the imported data pack?'))) return; pack = null; clearIndCache(); try{ window.storage.remove ? window.storage.remove(PACK_KEY) : window.storage.set(PACK_KEY, ''); }catch(e){} closeSettings(); render(); }

// ---------- demo: a synthetic pack so the new pages are not empty ----------
function demoPack(){
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const gauss = () => { let u = 0, v = 0; while(!u) u = rnd(); while(!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const N = 250, dates = []; let d = localDate(todayISO()); d.setDate(d.getDate() - 1);
  while(dates.length < N){ if(d.getDay() !== 0 && d.getDay() !== 6) dates.unshift(dateKey(d)); d.setDate(d.getDate() - 1); }
  const mkt = dates.map(() => 0.0005 + 0.009 * gauss());
  const finals = { NVDA:188.5, MSFT:452, META:721, AAPL:228, AMD:171, SMCI:49.3, SPY:668, QQQ:590, SMH:301 };
  const bars = {};
  const make = (sym, final, beta, vol, drift, base) => {
    const c = new Array(N); c[N-1] = final;
    const r = dates.map((_, i) => drift + beta * mkt[i] + vol * gauss());
    for(let i = N - 1; i > 0; i--) c[i-1] = c[i] / (1 + r[i]);
    const o = [], h = [], l = [], v = [];
    for(let i = 0; i < N; i++){ const prev = i ? c[i-1] : c[0]; const oo = prev * (1 + 0.004 * gauss()); o.push(+oo.toFixed(2)); h.push(+(Math.max(oo, c[i]) * (1 + Math.abs(0.008 * gauss()))).toFixed(2)); l.push(+(Math.min(oo, c[i]) * (1 - Math.abs(0.008 * gauss()))).toFixed(2)); v.push(Math.round(base * (0.6 + rnd() * 0.8) * (1 + Math.abs(r[i]) * 25))); }
    bars[sym] = { t: dates.slice(), o, h, l, c: c.map(x => +x.toFixed(2)), v };
  };
  make('SPY', finals.SPY, 1, 0.002, 0, 7e7); make('QQQ', finals.QQQ, 1.2, 0.003, 0.0002, 4e7); make('SMH', finals.SMH, 1.5, 0.008, 0.0008, 6e6);
  const syms = [...new Set([...Object.keys(SECTORS), 'NVDA','MSFT','META','AAPL','AMD','SMCI'])];
  syms.forEach(s => { const f = finals[s] || +(20 + rnd() * 600).toFixed(2); const semi = SEMI_SECTORS.includes(SECTORS[s]); make(s, f, semi ? 1.5 : 1.1, semi ? 0.022 : 0.016, (rnd() - 0.35) * 0.003, 2e6 + rnd() * 2e7); });
  // give the demo leaders a clean uptrend into the last weeks
  ['NVDA','CRDO','MU'].forEach((s, k) => { const b = bars[s]; for(let i = N - 30; i < N; i++){ const f = 1 + (i - (N - 30)) * (0.004 + k * 0.001); b.c[i] = +(b.c[N - 30] * f * (1 + 0.006 * gauss())).toFixed(2); b.o[i] = +(b.c[i-1] * (1 + 0.003 * gauss())).toFixed(2); b.h[i] = +(Math.max(b.o[i], b.c[i]) * 1.008).toFixed(2); b.l[i] = +(Math.min(b.o[i], b.c[i]) * 0.992).toFixed(2); } const sc = (finals[s] || b.c[N-1]) / b.c[N-1]; ['o','h','l','c'].forEach(k2 => b[k2] = b[k2].map(x => +(x * sc).toFixed(2))); });
  const strikes = (p, step) => { const out = []; for(let k = Math.round(p * 0.9 / step) * step; k <= p * 1.1; k += step){ const dist = (k - p) / p; out.push([k, Math.round((k % (step*2) ? 600 : 1500) * (1 + Math.max(0, dist) * 30) * (0.5 + rnd())), Math.round((k % (step*2) ? 700 : 1800) * (1 + Math.max(0, -dist) * 30) * (0.5 + rnd())), 0, 0, Math.round((rnd() - 0.4) * 500), Math.round((rnd() - 0.4) * 500)]); } return out; };
  const today = todayISO();
  const nextFri = (() => { const x = localDate(today); x.setDate(x.getDate() + ((5 - x.getDay() + 7) % 7 || 7) + 7); return dateKey(x); })();
  const asOf = dates[N-1];
  return { v:1, demo:true, generatedAt: new Date().toISOString(), asOf, source:'demo',
    watchlists: { '短线': ['NVDA','AMD','META','SMCI','CRDO','MU','ALAB','VRT'] },
    bars,
    snap: { NVDA:{ iv:0.48, hv:0.41, callVol:520000, putVol:310000, callAvg:300000, putAvg:210000 }, META:{ iv:0.36, callVol:90000, putVol:70000, callAvg:80000, putAvg:60000 }, SMCI:{ iv:0.82, callVol:210000, putVol:60000, callAvg:70000, putAvg:30000 }, MSFT:{ iv:0.27 } },
    options: { NVDA:{ exp: nextFri, at: asOf, strikes: strikes(finals.NVDA, 5) }, META:{ exp: nextFri, at: asOf, strikes: strikes(finals.META, 10) } },
    macro: [
      { date: dates[N-3], time:'08:30', stars:3, event:'CPI', period:'Sep', forecast:'0.3%', prior:'0.4%', actual:'0.2%' },
      { date: today, time:'10:00', stars:2, event:'JOLTS', period:'Aug', forecast:'7.1M', prior:'7.2M', actual:null },
      { date: addDays(today, 1), time:'08:30', stars:3, event:'PPI', period:'Sep', forecast:'0.2%', prior:'0.3%', actual:null },
      { date: addDays(today, 2), time:'08:30', stars:2, event:'Initial jobless claims', period:'', forecast:'228K', prior:'231K', actual:null },
      { date: addDays(today, 6), time:'08:30', stars:3, event:'Retail sales', period:'Sep', forecast:'0.4%', prior:'0.6%', actual:null },
    ] };
}
function demoExtras(){
  const now = Date.now();
  const b = S('NVDA');
  if(b){
    const ab = abnormalDays('NVDA', 120);
    fh.news.NVDA = { at: now, demo:true, d: ab.map((a, i) => ({ sym:'NVDA', headline: (a.chg > 0 ? ['Nvidia shares jump as analysts raise price target on data center demand','Nvidia rallies after record data center orders','Nvidia wins new hyperscaler deal, shares surge'] : ['Nvidia falls as export curbs weigh on outlook','Nvidia slides after report of delayed shipments','Nvidia drops as chip stocks sell-off'])[i % 3] + ' (' + md(a.date) + ')', source:'Demo', url:'#', datetime: localDate(a.date).getTime() / 1000 + 13 * 3600 })) };
    const ers = [b.t[b.t.length - 30], b.t[b.t.length - 93], b.t[b.t.length - 156], b.t[b.t.length - 219]];
    fh.er.NVDA = { at: now, demo:true, d: [{ date: addDays(todayISO(), 9), hour:'amc', act:null, est:1.12 }, ...ers.map((d, i) => ({ date:d, hour:'amc', act: [1.05, 0.96, 0.89, 0.81][i], est: [0.99, 0.93, 0.9, 0.75][i], q: [2,1,4,3][i], y: i < 2 ? 2026 : 2025 }))] };
  }
  fh.insider.META = { at: now, demo:true, d: [0, 1, 3].map((k, i) => ({ name: ['Demo Officer A','Demo Officer B','Demo Director C'][i], share: 40000, change: -12000, date: addDays(todayISO(), -4 - k), code:'S', price: 735 })) };
  const k = addDays(todayISO(), 9);
  (calendarEvents[k] = calendarEvents[k] || []).push({ id:'demo-ev-3', text:'NVDA earnings · post', category:'earnings', source:'auto-demo' });
}
const _loadDemoData3 = loadDemoData;
loadDemoData = async function(){
  pack = demoPack(); clearIndCache(); await savePack();
  fh = { insider:{}, er:{}, eps:{}, news:{}, metric:{} };
  await _loadDemoData3();
  demoExtras(); saveFh(); await saveCalendar(); render();
};

// ---------- tooltips: one floating box on <body> for every [data-tip] ----------
// (the old ::after popups were cut off by any card with overflow:hidden and by the window edge)
(function(){
  let tip = null;
  const show = el => {
    const text = el.getAttribute('data-tip'); if(!text) return;
    if(!tip){ tip = document.createElement('div'); tip.className = 'tip-pop'; document.body.appendChild(tip); }
    tip.textContent = text; tip.style.display = 'block';
    const tw = Math.min(260, window.innerWidth - 16); tip.style.width = tw + 'px';
    const r = el.getBoundingClientRect(), th = tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
    let top = r.bottom + 8; if(top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  const hide = () => { if(tip) tip.style.display = 'none'; };
  // native title="" bubbles (grey, system font, slow) are taken over so everything looks the same
  const tipOf = e => {
    const t = e.target; if(!t || !t.closest) return null;
    const el = t.closest('[data-tip]'); if(el) return el;
    const tt = t.closest('[title]');
    if(tt && tt.getAttribute('title')){
      const text = tt.getAttribute('title');
      if(!tt.getAttribute('aria-label') && !tt.textContent.trim()) tt.setAttribute('aria-label', text);
      tt.setAttribute('data-tip', text); tt.removeAttribute('title');
      return tt;
    }
    return null;
  };
  document.addEventListener('mouseover', e => { const el = tipOf(e); if(el) show(el); else hide(); });
  document.addEventListener('focusin', e => { const el = tipOf(e); if(el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
})();

// ---------- startup ----------
const _loadAll3 = loadAll;
loadAll = async function(){
  try{ const v = (await window.storage.get(PACK_KEY)).value; pack = v ? JSON.parse(v) : null; }catch(e){ pack = null; }
  try{ tdKey = (await window.storage.get(TD_KEY)).value || ''; }catch(e){ tdKey = ''; }
  try{ fh = Object.assign({ insider:{}, er:{}, eps:{}, news:{}, metric:{} }, JSON.parse((await window.storage.get(FH_KEY)).value) || {}); }catch(e){}
  await _loadAll3();
  if(pack && pack.demo && !isDemoMode()){ pack = null; try{ window.storage.remove ? window.storage.remove(PACK_KEY) : null; }catch(e){} fh = { insider:{}, er:{}, eps:{}, news:{}, metric:{} }; saveFh(); }
  clearIndCache(); render();
  refreshInsiders();
};

initImportUI();
loadAll();
