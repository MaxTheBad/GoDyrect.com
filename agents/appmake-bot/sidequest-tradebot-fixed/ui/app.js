const tags=['crypto','forex','stocks','overnight'];
const fmt=n=> (n===null||n===undefined)?'-':(n>=0?'+':'')+Number(n).toFixed(3);

const PIN_KEY='tradebot_ui_pin';
const PIN_UNTIL_KEY='tradebot_ui_unlock_until';
let uiPin='';
let uiUnlocked=true;

function lockUi(){
  uiUnlocked=true;
  document.body.classList.remove('locked');
}
function unlockUi(pin,remember){
  uiPin=(pin||'').trim();
  if(!uiPin) return;
  uiUnlocked=true;
  document.body.classList.remove('locked');
  sessionStorage.setItem(PIN_KEY, uiPin);
  if(remember){
    const until=Date.now() + 30*24*60*60*1000;
    localStorage.setItem(PIN_KEY, uiPin);
    localStorage.setItem(PIN_UNTIL_KEY, String(until));
  } else {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(PIN_UNTIL_KEY);
  }
}
function tryRestoreUnlock(){
  uiUnlocked=true;
  document.body.classList.remove('locked');
}
const TZ='America/New_York';
const etFmt=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
let chart=null,series=null,stocksChart=null,stocksSeries=null;
let allEvents=[];
let eventSort={key:'timestamp_et',dir:'desc'};
let eventFilter='all';
let lastAuditFetchAt=0;
let lastAuditSymbols='';
let tradebotStateRows=[];
let laneMoreContextByTag={};
if (typeof LightweightCharts !== 'undefined') {
  chart=LightweightCharts.createChart(document.getElementById('chart'),{layout:{background:{color:'#121a34'},textColor:'#cfe0ff'},grid:{vertLines:{color:'#1d2b59'},horzLines:{color:'#1d2b59'}},rightPriceScale:{borderColor:'#2a3b77'},timeScale:{borderColor:'#2a3b77'}});
  series=chart.addLineSeries({color:'#67b3ff',lineWidth:2});
  stocksChart=LightweightCharts.createChart(document.getElementById('stocksChart'),{layout:{background:{color:'#121a34'},textColor:'#cfe0ff'},grid:{vertLines:{color:'#1d2b59'},horzLines:{color:'#1d2b59'}},rightPriceScale:{borderColor:'#2a3b77'},timeScale:{borderColor:'#2a3b77'}});
  stocksSeries=stocksChart.addLineSeries({color:'#6df0a1',lineWidth:2});
} else {
  const msg='Chart library blocked/unavailable. Data still updates.';
  const c1=document.getElementById('chart'); if(c1) c1.innerHTML=`<div class="muted">${msg}</div>`;
  const c2=document.getElementById('stocksChart'); if(c2) c2.innerHTML=`<div class="muted">${msg}</div>`;
}
let latestStates={};
let latestKillSwitches={};
let latestStatusApi={};
async function j(path){
  try{
    const sep=path.includes('?')?'&':'?';
    const r=await fetch(path+`${sep}t=${Date.now()}`);
    if(!r.ok) return null;
    return await r.json();
  }catch(e){
    return null;
  }
}
async function t(path){
  try{
    const sep=path.includes('?')?'&':'?';
    const r=await fetch(path+`${sep}t=${Date.now()}`);
    if(!r.ok) return '';
    return await r.text();
  }catch(e){
    return '';
  }
}
function money(n,d=2){return (n===null||n===undefined||Number.isNaN(+n))?'-':`$${Number(n).toFixed(d)}`}
function parseRows(text){const out=[];for(const ln of text.trim().split('\n')){if(!ln)continue;try{out.push(JSON.parse(ln));}catch(e){}}return out}
function formatEt(ts){if(!ts)return '-';const d=new Date(ts);if(Number.isNaN(d.getTime()))return ts;return etFmt.format(d)}
function etDay(ts){if(!ts)return '';const d=new Date(ts);if(Number.isNaN(d.getTime()))return '';return dayFmt.format(d)}
function esc(s){return String(s??'').replace(/[&<>"']/g,(ch)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]))}
function tradeSummaryLine(ev){
  if(!ev || !ev.symbol) return 'last trade: none yet';
  const side=ev.side?` ${String(ev.side).toUpperCase()}`:'';
  const pnl=Number(ev.pnl_delta);
  const pnlTxt=Number.isFinite(pnl)?` • pnl ${fmt(pnl)}`:'';
  return `last trade: ${ev.symbol}${side} ${ev.status||'event'} ${formatEt(ev.timestamp_et)}${pnlTxt}`;
}
function formatDurationFromIso(iso){
  if(!iso) return '-';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime())) return '-';
  const ms=Date.now()-d.getTime();
  if(!Number.isFinite(ms) || ms<0) return '-';
  const s=Math.floor(ms/1000);
  const m=Math.floor(s/60);
  const h=Math.floor(m/60);
  if(h<1) return `${m}m ${s%60}s`;
  return `${h}h ${m%60}m`;
}
function stockRiskDisplay(pos, currentPx){
  const entry=Number(pos?.entry ?? pos?.avg_entry ?? pos?.px ?? 0);
  const qty=Number(pos?.qty ?? 0);
  const cur=Number(currentPx ?? pos?.current_price ?? pos?.px ?? entry);
  const peak=Number(pos?.peak_px_since_entry ?? pos?.highest_close_since_entry ?? cur);
  const tpPct=0.15;
  let slPct=0;
  if(Number.isFinite(entry) && entry > 0 && Number.isFinite(peak) && peak > entry){
    const peakPct=(peak / entry) - 1;
    const rung=Math.max(0, Math.floor(peakPct / 0.04) - 1);
    slPct=rung * 0.04;
  }
  const slPrice=entry * (1 + slPct);
  const tpPrice=entry * (1 + tpPct);
  const slPnl=(slPrice - entry) * qty;
  const tpPnl=(tpPrice - entry) * qty;
  const denom=Math.max(1e-9, tpPrice - slPrice);
  const meter=Math.max(0, Math.min(100, ((cur - slPrice) / denom) * 100));
  const toward=cur <= slPrice ? 'toward SL' : (cur >= tpPrice ? 'toward TP' : (meter < 50 ? 'toward SL' : 'toward TP'));
  return {
    slPrice,
    tpPrice,
    slPct,
    tpPct,
    slPnl,
    tpPnl,
    meter,
    toward,
  };
}
function watchRowLabel(row, idx){
  if(!row) return `${idx+1}. -`;
  const sym=row.symbol||row;
  const sig=row.signal ? `sig ${row.signal}` : 'sig -';
  const score=Number(row.score||0).toFixed(2);
  const regime=row.regime||'-';
  const news=row.news_headline || row.news || row.news_summary || row.news_label || '';
  const newsPart=news ? ` | News ${news}` : '';
  return `${idx+1}. ${sym} | ${sig} | score ${score} | regime ${regime}${newsPart}`;
}
function stockRowDataMap(state){
  const map=new Map();
  const add=(row)=>{
    if(!row) return;
    const sym=String(row.symbol||'').trim().toUpperCase();
    if(!sym) return;
    const prev=map.get(sym)||{};
    map.set(sym, Object.assign({}, prev, row, {symbol:sym}));
  };
  const watched=Array.isArray(state?.watched_ranked)?state.watched_ranked:[];
  const morning=Array.isArray(state?.morning_scan_ranked)?state.morning_scan_ranked:[];
  const runnerHist=Array.isArray(state?.runner_scan_history)?state.runner_scan_history:[];
  watched.forEach(add);
  morning.forEach(add);
  for(let i=runnerHist.length-1;i>=0;i--){
    const entry=runnerHist[i];
    const rows=Array.isArray(entry?.ranked_candidates)?entry.ranked_candidates:(Array.isArray(entry?.scan_candidates)?entry.scan_candidates:[]);
    rows.forEach(add);
    if(map.size>=200) break;
  }
  return map;
}
async function loadStockNews(symbols){
  const syms=(symbols||[]).map((s)=>String(s||'').trim().toUpperCase()).filter(Boolean);
  if(!syms.length) return {};
  try{
    const data=await j(`/api/stock-news?limit=3&symbols=${encodeURIComponent(syms.join(','))}`);
    if(!data || !data.ok || !data.news) return {};
    return data.news;
  }catch(e){
    return {};
  }
}
function modeLabel(mode){return mode?String(mode):'Unknown'}
function renderKillSwitchBar(kmap){
  latestKillSwitches = kmap || {};
  for(const tag of tags){
    const btn=document.getElementById(`ks-${tag}`);
    if(!btn) continue;
    const on=!!(latestKillSwitches?.[tag]?.enabled);
    btn.textContent=`Kill ${tag.charAt(0).toUpperCase()+tag.slice(1)}: ${on?'ON':'OFF'}`;
    btn.style.borderColor=on?'#ef4444':'#2a3b77';
    btn.style.color=on?'#ffb4b4':'#dce6ff';
    btn.style.background=on?'#35111a':'#0f1730';
    btn.dataset.enabled=on?'1':'0';
  }
}
function formatStateTs(ts){
  const n=Number(ts||0);
  if(!Number.isFinite(n) || n<=0) return '-';
  const ms=n>1e12 ? n : n*1000;
  return formatEt(new Date(ms).toISOString());
}
function formatElapsedLabel(seconds){
  const n=Number(seconds);
  if(!Number.isFinite(n) || n<0) return '-';
  const s=Math.floor(n);
  if(s<60) return `${s}s`;
  const m=Math.floor(s/60);
  const rem=s%60;
  if(m<60) return `${m}m ${rem}s`;
  const h=Math.floor(m/60);
  const rm=m%60;
  if(h<24) return `${h}h ${rm}m`;
  const d=Math.floor(h/24);
  const rh=h%24;
  return `${d}d ${rh}h`;
}
function card(tag,s,rt){
  const el=document.getElementById(tag);
  if(!s){el.textContent='offline';return}
  const title=String(tag||'').charAt(0).toUpperCase()+String(tag||'').slice(1);
  const pnl=Number(s.total_pnl ?? s.journal_today_realized_pnl ?? s.daily_pnl ?? 0);
  const realized=Number(s.journal_today_realized_pnl ?? s.daily_pnl ?? 0);
  const unrealized=Number(s.unrealized_pnl ?? 0);
  const life=Number(s.journal_all_time_realized_pnl ?? 0);
  const closed=Number(s.journal_today_closed_trades ?? s.trades_today ?? 0);
  const opened=Number(s.journal_today_opened_trades ?? 0);
  const bal=+s.paper_balance||0;
  const latestTrade=s.last_close||s.latest_trade;
  const statusBot=(latestStatusApi?.bots?.[tag])||{};
  const fleetAsset=(latestStatusApi?.fleet?.assets?.[tag])||{};
  const pid=s.pid
    ?? s.process_id
    ?? (Array.isArray(s.pids)&&s.pids.length ? s.pids.join(', ') : '')
    ?? (Array.isArray(statusBot.pids)&&statusBot.pids.length ? statusBot.pids.join(', ') : '')
    ?? (Array.isArray(fleetAsset.lane_pids)&&fleetAsset.lane_pids.length ? fleetAsset.lane_pids.join(', ') : '');
  const elapsed=rt ? (rt.elapsed_label || formatElapsedLabel(rt.elapsed_seconds)) : '-';
  const runMode=rt ? (rt.mode==='running'?'running':'stopped') : 'stopped';
  const lastScanRaw=s.watchlist_updated_at || s.runner_scan_ts || s.intraday_rescan_ts || s.morning_scan_ts || 0;
  const lastScanText=formatStateTs(lastScanRaw);
  const watchlistText=Array.isArray(s.watched_symbols)&&s.watched_symbols.length
    ? s.watched_symbols.map((x)=>{
        if(typeof x === 'string') return x;
        if(x && typeof x === 'object') return `${x.symbol||'-'}(${x.side||x.signal||'?'})`;
        return String(x);
      }).join(', ')
    : 'none';
  const watchItems = Array.isArray(s.watched_ranked) && s.watched_ranked.length
    ? s.watched_ranked.slice(0,4).map((r)=>{
        const news = r.news_headline || r.news || r.news_summary || r.news_label || '';
        const newsPart = news ? ` | News ${news}` : '';
        return `${r.symbol||'-'}(${r.signal||'-'})${newsPart}`;
      }).join(', ')
    : watchlistText;
  laneMoreContextByTag[tag] = {
    bal,
    life,
    mode: modeLabel(s.decision_mode_today),
    journalClosed: Number(s.journal_today_closed_trades ?? closed ?? 0),
    journalPnl: Number(s.journal_today_realized_pnl ?? pnl ?? 0),
    stateClosed: Number(s.trades_today ?? 0),
    statePnl: Number(s.daily_pnl ?? 0),
    pid,
    watchlistText,
    lastScanText,
    latestTradeText: tradeSummaryLine(latestTrade).replace(/^last trade:\s*/,''),
  };
  const positions=(Array.isArray(s.positions)&&s.positions.length)?s.positions:(s.position?[s.position]:[]);
  const posSummary = positions.length
    ? positions.map((p)=>`<span style="color:#e7ecff">${esc(p.symbol||'-')}</span> (${esc(String(p.side||'open').toUpperCase())})`).join(', ')
    : 'none';
  const posHtml = positions.length ? positions.map((p)=>{
    const entry=Number(p.entry||p.px||0);
    const qty=Number(p.qty||0);
    const cur=Number(p.current_price ?? p.px ?? entry);
    const openPnl=(cur-entry)*qty;
    const openPnlPc=entry>0 ? ((cur-entry)/entry)*100 : 0;
    const openedAgo=formatDurationFromIso(p.opened_at);
  const rs=stockRiskDisplay(p, cur);
  const size=cur*qty;
  const livePx=Number(p.current_price ?? cur);
  const liveOpenPnl=(livePx-entry)*qty;
  const liveOpenPnlPc=entry>0 ? ((livePx-entry)/entry)*100 : 0;
  const gauge=`<div class="risk-gauge" style="margin:8px 0 4px; padding-top:2px;">
      <div class="muted" style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
        <span>SL</span><span>${esc(rs.toward)}</span><span>TP</span>
      </div>
      <div style="height:12px; border-radius:999px; background:linear-gradient(90deg,#e24b4b 0%, #f59e0b ${Math.max(20, Math.min(50, rs.meter))}%, #22c55e 100%); position:relative; overflow:hidden;">
        <div style="position:absolute; left:${rs.meter}%; top:-3px; width:6px; height:18px; margin-left:-3px; border-radius:999px; background:#f4f7ff; box-shadow:0 0 0 2px rgba(10,16,36,.4);"></div>
      </div>
    </div>`;
    return `<div style="margin-top:6px">
      <div><span style="color:#e7ecff"><b>${esc(p.symbol||'-')}</b></span>: ${Number(qty).toFixed(2)} shares @ $${Number(entry).toFixed(2)}</div>
      <div class="muted">Position size: $${Number(size).toFixed(2)}</div>
      <div class="${openPnl>=0?'ok':'bad'}">Open PnL: ${fmt(openPnl)} (${openPnlPc>=0?'+':''}${openPnlPc.toFixed(2)}%) (${openedAgo})</div>
      ${gauge}
      <div class="muted" style="font-size:12px; line-height:1.25">SL | $${Number(rs.slPrice).toFixed(2)} | ${rs.slPct>=0?'+':''}${(rs.slPct*100).toFixed(2)}% | PnL ${fmt(rs.slPnl)}</div>
      <div class="muted" style="font-size:12px; line-height:1.25">TP | $${Number(rs.tpPrice).toFixed(2)} | +15.00% | PnL ${fmt(rs.tpPnl)}</div>
      <div class="muted" style="font-size:12px; line-height:1.25">Live PnL | ${fmt(liveOpenPnl)} (${liveOpenPnlPc>=0?'+':''}${liveOpenPnlPc.toFixed(2)}%)</div>
    </div>`;
  }).join('') : '';
  const lastTradeHtml = (() => {
    if(!latestTrade || !latestTrade.symbol) return '<span class="muted">last trade: none yet</span>';
    const pnlVal=Number(latestTrade.pnl_delta);
    const pnlClass=Number.isFinite(pnlVal) ? (pnlVal>=0 ? 'ok' : 'bad') : 'muted';
    const pnlHtml=Number.isFinite(pnlVal) ? `<span class="${pnlClass}"><b>PnL:</b> ${fmt(pnlVal)}</span>` : '<span class="muted"><b>PnL:</b> -</span>';
    return `<span class="muted">last trade: <b>${esc(latestTrade.symbol)}</b> <span class="muted">•</span> <span class="muted">${esc(formatEt(latestTrade.timestamp_et))}</span> <span class="muted">•</span> ${pnlHtml}</span>`;
  })();
  const pnlLine = tag==='stocks' || tag==='overnight'
    ? `<span class="${pnl>=0?'ok':'bad'}">PNL: ${fmt(pnl)}</span><br><span class="muted">realized ${fmt(realized)} • unrealized ${fmt(unrealized)}</span>`
    : `<span class="${pnl>=0?'ok':'bad'}">PNL: ${fmt(pnl)}</span><br><span class="muted">realized ${fmt(realized)}</span>`;
  el.innerHTML=`<span class="muted">${title} ${runMode} for ${elapsed}</span><br>${pnlLine}<br>${posHtml}<br><span class="muted">watchlist: ${esc(watchItems)}</span><br><span class="muted">Opened ${opened} • Closed ${closed}</span><br>${lastTradeHtml}<br><button class="lane-view-more" data-lane="${esc(tag)}">View more</button>`;
}
function normalizeStateItems(states){
  return tags.map((tag)=>{
    const s=states[tag]||{};
    const ranked=Array.isArray(s.watched_ranked)?s.watched_ranked:[];
    const watched=Array.isArray(s.watched_symbols)?s.watched_symbols:[];
    const positions=Array.isArray(s.position)
      ? s.position
      : (s.position && typeof s.position === 'object' ? [s.position] : []);
    const positionRows=Array.isArray(s.positions)
      ? s.positions
      : positions;
    const lastScanTs=s.watchlist_updated_at || s.runner_scan_ts || s.intraday_rescan_ts || s.morning_scan_ts || 0;
    const apiCalls=s.api_calls_by_provider_today||{};
    const skipReasons=s.skip_reasons_today||{};
    return {
      asset: tag,
      watchlist: watched,
      ranked,
      positions: positionRows,
      lastScanTs,
      status: s.last_status || (s.runner_pending && Object.keys(s.runner_pending||{}).length ? 'active' : 'live'),
      summary: s,
      apiCalls,
      skipReasons,
    };
  });
}
function renderTradebotStatePanel(states){
  const body=document.getElementById('tradebotStateBody');
  const count=document.getElementById('tradebotStateCount');
  if(!body||!count) return;
  tradebotStateRows=normalizeStateItems(states||latestStates||{});
  count.textContent=`${tradebotStateRows.length} assets`;
  if(!tradebotStateRows.length){
    body.innerHTML='<tr><td colspan="5" class="muted">No bot state snapshots available yet.</td></tr>';
    return;
  }
  body.innerHTML=tradebotStateRows.map((row)=>{
    const watchCount=row.watchlist.length;
    const rankedCount=row.ranked.length;
    const watchPreview=row.watchlist.length ? row.watchlist.slice(0,12).join(', ') : '-';
    const rankedPreview=row.ranked.length ? row.ranked.slice(0,8).map((r)=>`${r.symbol}(${r.signal||'-'})`).join(', ') : '-';
    const pos=(row.positions||[]).slice(0,4).map(p=>`${p.symbol||'-'} ${String(p.side||'-')} ${p.qty!==undefined?Number(p.qty).toFixed(4):'-'}`).join(', ') || 'none';
    const cls=row.status==='error'?'bad':(row.status==='active'?'warn':'ok');
    return `<tr style="cursor:pointer" data-asset="${esc(row.asset)}">
      <td><strong>${row.asset.toUpperCase()}</strong></td>
      <td><div>${esc(watchPreview)}</div><div class="muted">watchlist ${watchCount} • ranked ${rankedCount}</div></td>
      <td>${esc(pos)}</td>
      <td class="muted">${esc(formatStateTs(row.lastScanTs))}</td>
      <td><span class="${cls}">${esc(row.status||'live')}</span></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('tr[data-asset]').forEach((tr)=>{
    tr.addEventListener('click',()=>openTradebotStateModal(tr.dataset.asset));
  });
}
function closeTradebotStateModal(){ const m=document.getElementById('tradebotStateModal'); if(m&&m.close) m.close(); }
function closeLaneMoreModal(){ const m=document.getElementById('laneMoreModal'); if(m&&m.close) m.close(); }
function openLaneMoreModal(tag){
  const modal=document.getElementById('laneMoreModal');
  const title=document.getElementById('laneMoreTitle');
  const body=document.getElementById('laneMoreBody');
  if(!modal||!title||!body) return;
  const ctx=laneMoreContextByTag?.[tag] || {};
  title.textContent=`${String(tag||ctx.tag||'lane').toUpperCase()} View More`;
  body.innerHTML=[
    `Bal ${money(ctx.bal || 0)}`,
    `Life ${fmt(ctx.life || 0)}`,
    `mode ${ctx.mode || '-'}`,
    `journal shows ${ctx.journalClosed || 0} close(s) / ${fmt(ctx.journalPnl || 0)}; state shows ${ctx.stateClosed || 0} / ${fmt(ctx.statePnl || 0)}`,
    ctx.pid ? `pid ${ctx.pid}` : '',
    `watchlist: ${ctx.watchlistText || 'none'}`,
    `last scan ${ctx.lastScanText || '-'}`
  ].filter(Boolean).join('<br>');
  modal.showModal();
}
async function openTradebotStateModal(asset){
  const row=(tradebotStateRows||[]).find(r=>r.asset===asset);
  const modal=document.getElementById('tradebotStateModal');
  const title=document.getElementById('tradebotStateTitle');
  const body=document.getElementById('tradebotStateModalBody');
  if(!row||!modal||!title||!body) return;
  title.textContent=`${asset.toUpperCase()} Live Tradebot State`;
  body.textContent='Loading…';
  modal.showModal();
  try{
    const [jr,logs]=await Promise.all([
      j(`/api/journal-tail/${asset}?n=120`),
      j('/api/logs')
    ]);
    const journalRows=(jr&&jr.rows)?jr.rows:[];
    const recentJournal=journalRows.slice(-12).map((r)=>JSON.stringify(r)).join('\n') || 'none';
    const recentLogs=(logs&&logs.files&&logs.files[asset]) ? logs.files[asset].split('\n').slice(-20).join('\n') : 'none';
    const s=row.summary||{};
    const api=Object.entries(row.apiCalls||{}).map(([k,v])=>`${k}: ${v}`).join(' • ') || '-';
    const skips=Object.entries(row.skipReasons||{}).map(([k,v])=>`${k}: ${v}`).join(' • ') || '-';
    const watch=(row.ranked.length?row.ranked.map((r,i)=>`${i+1}. ${r.symbol} (${r.signal||'-'}) score ${Number(r.score||0).toFixed(1)}`).join('<br>'):(row.watchlist.join(', ')||'none'));
    const positions=(row.positions||[]).length ? (row.positions||[]).map(p=>`${p.symbol||'-'} ${p.side||'-'} qty ${p.qty!==undefined?Number(p.qty).toFixed(4):'-'}`).join('<br>') : 'none';
    const pending=(s.runner_pending||{}) && Object.keys(s.runner_pending||{}).length ? Object.entries(s.runner_pending).map(([k,v])=>`${k}: ${esc(JSON.stringify(v).slice(0,180))}`).join('<br>') : 'none';
    const lastRunner=s.runner_scan_last_snapshot||{};
    const lastRunnerCandidates=Array.isArray(s.runner_scan_last_candidates)?s.runner_scan_last_candidates:[];
    const lastRunnerSelected=Array.isArray(s.runner_scan_last_selected)?s.runner_scan_last_selected:[];
    const lastRunnerRejected=Array.isArray(s.runner_scan_last_rejected)?s.runner_scan_last_rejected:[];
    const topSkipReasons=Object.entries(row.skipReasons||{}).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}: ${v}`).join(' • ') || 'none';
    const fullWatchlist=(row.watchlist||[]).length ? row.watchlist.join(', ') : 'none';
    const lastScanText=formatStateTs(s.watchlist_updated_at || s.runner_scan_ts || s.intraday_rescan_ts || s.morning_scan_ts || 0);
    const fullRanked=(row.ranked||[]).length ? row.ranked.map((r,i)=>{
      const news=r.news_headline || r.news || r.news_summary || r.news_label || '';
      return `${i+1}. ${r.symbol} (${r.signal||'-'}) score ${Number(r.score||0).toFixed(1)} trend ${Number(r.trend||0).toFixed(4)} vol_ratio ${Number(r.vol_ratio||0).toFixed(2)}${news ? ` | News ${news}` : ''}`;
    }).join('<br>') : 'none';
    const runnerWhy = [
      `runner scan selected: ${(lastRunnerSelected||[]).length ? lastRunnerSelected.map((r)=>r.symbol||r).join(', ') : 'none'}`,
      `runner scan rejected: ${(lastRunnerRejected||[]).length ? lastRunnerRejected.slice(0,10).map((r)=>`${r.symbol||'-'} (${r.reason||r.skip_reason||'n/a'})`).join(', ') : 'none'}`,
      `skip reasons: ${topSkipReasons}`
    ].join('<br>');
    const runnerSummary=lastRunner && Object.keys(lastRunner).length ? `
      <div class="card" style="margin-bottom:10px">
        <b>Latest runner scan</b>
        <div class="muted" style="margin-top:6px">type ${esc(lastRunner.scan_type||'runner_scan')} • ${esc(formatEt(lastRunner.generated_at||''))}</div>
        <div class="muted">universe ${lastRunner.universe_size ?? '-'} • prefilter ${lastRunner.prefilter_candidates ?? lastRunner.candidate_count ?? '-'} • ranked ${lastRunner.ranked_candidates ?? lastRunner.ranked_count ?? '-'} • selected ${lastRunner.selected_count ?? lastRunner.selected_symbols?.length ?? '-'}</div>
        <div class="muted">selected: ${esc((lastRunner.selected_symbols||[]).slice(0,10).join(', ') || 'none')}</div>
        <div class="muted">top candidates: ${esc(lastRunnerCandidates.slice(0,10).map((r)=>`${r.symbol}${r.score!==undefined?`(${Number(r.score).toFixed(1)})`:''}`).join(', ') || 'none')}</div>
        <div class="muted">why it picked/skipped: ${runnerWhy}</div>
      </div>` : '';
    body.innerHTML = `
      <div class="card" style="margin-bottom:10px">
        <div><b>${asset.toUpperCase()}</b></div>
        <div class="muted">state file ${esc(`state.${asset}.json`)} • journal ${esc(`journal.${asset}.jsonl`)}</div>
        <div class="muted">pnl ${fmt(s.daily_pnl ?? 0)} • balance ${money(s.paper_balance || 0)} • trades ${s.trades_today ?? 0}</div>
        <div class="muted">watchlist ${row.watchlist.length} • morning ${((s.morning_scan_symbols||[]).length||0)} • ranked ${row.ranked.length} • positions ${(row.positions||[]).length} • pending ${(s.runner_pending&&Object.keys(s.runner_pending).length)||0}</div>
        <div class="muted">scan ts watchlist ${formatStateTs(s.watchlist_updated_at)} • runner ${formatStateTs(s.runner_scan_ts)} • intraday ${formatStateTs(s.intraday_rescan_ts)}</div>
        <div class="muted">API ${esc(api)}</div>
        <div class="muted">skip reasons ${esc(skips)}</div>
      </div>
      ${runnerSummary}
      <div class="card" style="margin-bottom:10px">
        <b>Watchlist</b>
        <div class="muted" style="margin-top:6px">${esc(fullWatchlist)}</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <b>Scan Time</b>
        <div class="muted" style="margin-top:6px">last scan ${esc(lastScanText)}</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <b>Ranked shortlist</b>
        <div class="muted" style="margin-top:6px">${fullRanked}</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <b>Why it’s looking at these</b>
        <div class="muted" style="margin-top:6px">${runnerWhy}</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <b>Positions</b>
        <div class="muted" style="margin-top:6px">${positions}</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <b>Runner pending</b>
        <div class="muted" style="margin-top:6px">${pending}</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <b>Recent journal</b>
        <pre style="white-space:pre-wrap;overflow:auto;max-height:240px">${esc(recentJournal)}</pre>
      </div>
      <div class="card">
        <b>Recent bot log</b>
        <pre style="white-space:pre-wrap;overflow:auto;max-height:240px">${esc(recentLogs)}</pre>
      </div>
    `;
  }catch(e){
    body.innerHTML=`<div class="bad">Failed to load tradebot state: ${esc(e?.message||e)}</div>`;
  }
}
function setupStats(rows){const c={};for(const r of rows){if(r.type!=='trade_close')continue;const k=r.setup_type||'unknown';if(!c[k])c[k]={n:0,w:0,p:0};c[k].n++;if((+r.pnl||0)>0)c[k].w++;c[k].p+=(+r.pnl||0)}return c}
function compareEventValues(a,b,key){
  const av=a?.[key];
  const bv=b?.[key];
  if(key==='timestamp_et'){
    const at=new Date(av||0).getTime();
    const bt=new Date(bv||0).getTime();
    return at-bt;
  }
  if(key==='qty' || key==='price' || key==='pnl_delta'){
    const an=Number(av);
    const bn=Number(bv);
    const aOk=Number.isFinite(an);
    const bOk=Number.isFinite(bn);
    if(!aOk && !bOk) return 0;
    if(!aOk) return -1;
    if(!bOk) return 1;
    return an-bn;
  }
  return String(av||'').localeCompare(String(bv||''), undefined, {numeric:true, sensitivity:'base'});
}
function sortedEvents(){
  const rows=allEvents.filter((row)=>eventFilter==='all' ? true : row.asset_class===eventFilter);
  rows.sort((a,b)=>{
    const base=compareEventValues(a,b,eventSort.key);
    return eventSort.dir==='asc'?base:-base;
  });
  return rows;
}
function updateEventSortIndicators(){
  document.querySelectorAll('#events .sort-btn').forEach((btn)=>{
    const ind=btn.querySelector('.sort-ind');
    if(!ind) return;
    ind.textContent=btn.dataset.sortKey===eventSort.key?(eventSort.dir==='asc'?'▲':'▼'):'';
  });
}
function updateFilterTabs(){
  document.querySelectorAll('.filter-tab').forEach((btn)=>{
    btn.classList.toggle('active', btn.dataset.filter===eventFilter);
  });
}
function renderEvents(){
  const rows=sortedEvents();
  const tb=document.querySelector('#events tbody');
  tb.innerHTML='';
  for(const e of rows){
    const tr=document.createElement('tr');
    const pnl=Number(e.pnl_delta);
    const pnlFinite=Number.isFinite(pnl);
    const pnlColor=!pnlFinite?'':'color:'+(pnl>=0?'#10b981':'#ef4444')+';font-weight:bold';
    tr.innerHTML=`<td>${formatEt(e.timestamp_et)}</td><td>${e.asset_class||''}</td><td>${e.symbol||''}</td><td>${(e.side||'').toUpperCase()}</td><td>${e.qty??''}</td><td>${e.price??''}</td><td>${e.status||''}</td><td>${e.source||''}</td><td>${e.strategy_id||''}</td><td style="${pnlColor}">${pnlFinite?pnl.toFixed(2):''}</td>`;
    tb.appendChild(tr);
  }
  const summary=document.getElementById('eventsSummary');
  if(summary){
    const label=eventFilter==='all' ? 'all asset classes' : eventFilter;
    summary.textContent=`showing ${rows.length} ${label} trades (${allEvents.length} total)`;
  }
  updateFilterTabs();
  updateEventSortIndicators();
}
function yn(v){return v?'<span class="ok">yes</span>':'<span class="bad">no</span>'}
async function refreshMissedRunnerAudit(force=false){
  const input=document.getElementById('auditSymbols');
  const meta=document.getElementById('auditMeta');
  const recon=document.getElementById('auditReconSummary');
  const body=document.getElementById('auditTableBody');
  const cov=document.getElementById('auditCoverage');
  const filt=document.getElementById('auditFilters');
  if(!input||!meta||!recon||!body||!cov||!filt) return;
  const symbols=(input.value||'').split(',').map((s)=>s.trim().toUpperCase()).filter(Boolean);
  const symbolKey=symbols.join(',');
  const now=Date.now();
  if(!force && symbolKey===lastAuditSymbols && (now-lastAuditFetchAt)<20000) return;
  meta.textContent='loading…';
  const path=`/api/missed-runner-audit?asset=stocks&hours=24&symbols=${encodeURIComponent(symbolKey)}`;
  const data=await j(path);
  lastAuditFetchAt=Date.now();
  lastAuditSymbols=symbolKey;
  if(!data||!data.ok){
    meta.textContent='audit unavailable';
    recon.textContent='failed to load runner audit';
    body.innerHTML='<tr><td colspan="6">no data</td></tr>';
    cov.textContent='scanner coverage: unavailable';
    filt.textContent='entry-filter audit: unavailable';
    return;
  }
  const src=data.watchlist_source||{};
  meta.textContent=`updated ${formatEt(data.generated_at)} • source ${src.date||'-'}`;
  const r=data.reconciliation||{};
  recon.innerHTML=`watchlist ${r.watchlist_count||0} • live_watched ${r.live_watched_count||0} • traded ${r.traded_count||0}`;
  const rows=Array.isArray(r.rows)?r.rows:[];
  const topRows=rows.slice(0,40);
  body.innerHTML=topRows.length?topRows.map((x)=>{
    const pnl=Number(x.trade_realized_pnl||0);
    const pnlClass=pnl>=0?'ok':'bad';
    return `<tr>
      <td>${esc(x.symbol)}</td>
      <td>${yn(x.in_watchlist)}</td>
      <td>${yn(x.in_live_watched)}</td>
      <td>${yn(x.traded)}</td>
      <td>${esc(x.status)}</td>
      <td class="${pnlClass}">${fmt(pnl)}</td>
    </tr>`;
  }).join(''):'<tr><td colspan="6">no symbols in audit window</td></tr>';

  const movers=(data.top_movers||[]).map((m)=>`${m.symbol} ${Number(m.pct_move||0).toFixed(1)}%`).join(' • ')||'none';
  const covRows=(data.scanner_coverage||[]).map((x)=>{
    const st=x.scan_status||'unknown';
    const color=st==='captured'?'ok':(st==='missed'?'bad':'');
    return `<span class="${color}">${esc(x.symbol)} ${esc(st)}</span> — ${esc(x.scan_reason||'-')}`;
  }).join('<br>') || 'none';
  cov.innerHTML=`<b>Scanner coverage</b><br>top movers: ${esc(movers)}<br>${covRows}`;

  const fRows=(data.entry_filter_audit||[]).map((x)=>{
    const color=x.status==='blocked'?'bad':(x.status==='traded'?'ok':'');
    return `<span class="${color}">${esc(x.symbol)} ${esc(x.status||'unknown')}</span> — ${esc(x.reason||'-')}`;
  }).join('<br>') || 'none';
  filt.innerHTML=`<b>Entry filter audit</b><br>${fRows}`;
}
async function refreshBreakWatchers(asset='stocks'){
  const el=document.getElementById('breakWatchers');
  if(!el) return;
  el.textContent='loading…';
  try{
    const data=await j(`/api/break-watchers?asset=${asset}`);
    if(!data||!data.ok){
      el.innerHTML='<b>Level Watchers</b><br>unavailable';
      return;
    }
    const watchers=data.break_watchers||[];
    if(!watchers.length){
      el.innerHTML='<b>Level Watchers</b><br><span class="dim">none</span>';
      return;
    }
    const rows=watchers.map((w)=>{
      const curr=w.current||'-';
      const pctFromBreak=(w.current&&w.break)?((((w.break-w.current)/w.current)*100).toFixed(2)):'-';
      const minWait=w.minutes_waiting||0;
      const conf=((w.confidence||0)*100).toFixed(0);
      return `<span>${esc(w.symbol)}</span> break=$${w.break.toFixed(2)} (${pctFromBreak}% away, ${conf}% confidence, ${minWait}m) [${w.source}]`;
    }).join('<br>');
    el.innerHTML=`<b>Level Watchers</b> (${watchers.length})<br>${rows}`;
  }catch(e){
    el.textContent='break watchers: error';
  }
}
function perfStats(rows){
  const closes=rows.filter(r=>r.type==='trade_close');
  const today=dayFmt.format(new Date());
  let total=0,wins=0,losses=0,pnl=0,grossWin=0,grossLoss=0,eq=0,peak=0,maxDd=0;
  let tTotal=0,tWins=0,tPnl=0,lastClose='-';
  for(const r of closes){
    const x=+r.pnl||0; total++; pnl+=x; eq+=x; if(eq>peak)peak=eq; const dd=peak-eq; if(dd>maxDd)maxDd=dd;
    if(x>0){wins++;grossWin+=x}else if(x<0){losses++;grossLoss+=Math.abs(x)}
    if(etDay(r.ts)===today){tTotal++;tPnl+=x;if(x>0)tWins++}
    lastClose=r.ts||lastClose;
  }
  const wr=total?((wins/total)*100):0;
  const avg=total?(pnl/total):0;
  const pf=grossLoss>0?(grossWin/grossLoss):(grossWin>0?999:0);
  const twr=tTotal?((tWins/tTotal)*100):0;
  return {total,wins,losses,pnl,wr,avg,pf,maxDd,tTotal,tPnl,twr,lastClose:formatEt(lastClose)};
}
async function refresh(){
 const stApi=await j('/api/status');
 latestStatusApi=stApi||{};
 const states={};
 for(const tag of tags){
   states[tag]=await j(`/api/state/${tag}`);
   const runtime=stApi?.bots?.[tag]?.runtime||null;
   card(tag,states[tag],runtime);
   const ws=((states[tag]&&states[tag].watched_ranked)||[]).slice(0,4).map(r=>`${r.symbol}(${r.signal||'-'})`).join(', ') || ((states[tag]&&states[tag].watched_symbols)||[]).slice(0,4).join(', ') || '-';
   const wEl=document.getElementById(`${tag}Watch`);
   if(wEl) wEl.textContent='';
 }
 latestStates=states;
 renderTradebotStatePanel(states);
 if(stApi&&stApi.bots){
   renderKillSwitchBar(stApi.kill_switches||{});
   const total=stApi.running_total||0;
   document.getElementById('runSummary').textContent=`running universe lanes: ${total}/${tags.length}`;
   for(const tag of tags){
     const b=stApi.bots[tag]||{running:false,count:0,pids:[]};
     const rt=b.runtime||{};
     const row=document.getElementById(`${tag}Run`);
     const btn=document.getElementById(`tgl-${tag}`);
     const elapsed=rt.elapsed_label || formatElapsedLabel(rt.elapsed_seconds);
     const since=rt.mode==='running' ? 'running for' : 'stopped for';
     row.textContent='';
     btn.textContent=b.running?`Stop ${tag}`:`Start ${tag}`;
     btn.dataset.running=b.running?'1':'0';
   }

	   const fleet=stApi.fleet||{};
	   const fleetEl=document.getElementById('fleetSummary');
	   if(fleetEl){
	     const assetNames={crypto:'Crypto',forex:'Forex',stocks:'Stocks',overnight:'Overnight'};
	     const details=['crypto','forex','stocks','overnight'].map((asset)=>{
	       const info=(fleet.assets&&fleet.assets[asset])||{};
       const lane=info.lane_running||0;
       const lanePids=(info.lane_pids||[]).length?` • pid ${(info.lane_pids||[]).join(', ')}`:'';
       const rt=(stApi.bots&&stApi.bots[asset]&&stApi.bots[asset].runtime)||{};
       const elapsed=rt.elapsed_label || formatElapsedLabel(rt.elapsed_seconds);
       const elapsedText=rt.mode==='running' ? `running for ${elapsed}` : `stopped for ${elapsed}`;
       const matrixBots=(info.matrix_bots||[]).map((bot)=>`${bot.label}:${bot.running?'on':'off'}`).join(' • ') || 'none';
       const matrixPos=(info.matrix_open_positions||[]);
       return `${assetNames[asset]} universe lane: <b>${lane}/1</b>${lanePids} <span class="muted">(${elapsedText})</span><br>${assetNames[asset]} matrix bots: <b>${info.matrix_running||0}/${info.matrix_total||0}</b> (${matrixBots})<br>${assetNames[asset]} matrix positions: ${matrixPos.length?matrixPos.join(', '):'none'}`;
     });
     fleetEl.innerHTML=`${details.join('<br><br>')}<br><br>total running (universe + matrix): <b>${fleet.all_running||0}</b>`;
   }
	 }
 const cache=await j('../study/policy_cache.json');
 let api=0,non=0,hits=0;
 const providers={openai:0,oanda:0,alpaca:0,ccxt:0,other:0};
 const endpoints={};
 const skips={};
 for(const tag of tags){
   const s=states[tag]||{};
   api+=(+s.ai_calls_today||0);
   non+=(+s.non_api_decisions_today||0);
   hits+=(+s.policy_cache_hits_today||0);
   const p=s.api_calls_by_provider_today||{};
   for(const [k,v] of Object.entries(p)){providers[k]=(providers[k]||0)+(+v||0)}
   const ep=s.api_calls_by_endpoint_today||{};
   for(const [k,v] of Object.entries(ep)){endpoints[k]=(endpoints[k]||0)+(+v||0)}
   const sr=s.skip_reasons_today||{};
   for(const [k,v] of Object.entries(sr)){skips[k]=(skips[k]||0)+(+v||0)}
 }
	 const topEndpoints=Object.entries(endpoints).sort((a,b)=>b[1]-a[1]).slice(0,6);
	 const topSkips=Object.entries(skips).sort((a,b)=>b[1]-a[1]).slice(0,6);
	 const overallMode=api>0?'AI-assisted':(non>0?'Rules-only':'Idle');
	 document.getElementById('cache').innerHTML=`
	 <b>Decision Counters</b><br>
	 Mode today: <b>${overallMode}</b><br>
	 API: <b>${api}</b> • Non-API: <b>${non}</b><br>
	 Providers: OpenAI ${providers.openai||0} • OANDA ${providers.oanda||0} • Alpaca ${providers.alpaca||0} • CCXT ${providers.ccxt||0}${(providers.other||0)?` • Other ${providers.other}`:''}<br>
 Endpoints:<br>${topEndpoints.map(([k,v])=>`&nbsp;&nbsp;• ${k}: ${v}`).join('<br>') || '&nbsp;&nbsp;• none'}<br>
 Skips:<br>${topSkips.map(([k,v])=>`&nbsp;&nbsp;• ${k}: ${v}`).join('<br>') || '&nbsp;&nbsp;• none'}<br>
 Policy cache: ${cache?Object.keys(cache).length:0} • hits ${hits}`;
 const bals=await j('/api/balances');
 const ab=(bals&&bals.alpaca&&!bals.alpaca.error)?`Alpaca $${Number(bals.alpaca.equity||bals.alpaca.cash||0).toFixed(2)}`:'Alpaca n/a';
 const ob=(bals&&bals.oanda&&!bals.oanda.error)?`OANDA $${Number(bals.oanda.NAV||bals.oanda.balance||0).toFixed(2)}`:'OANDA n/a';
 document.getElementById('apiBal').textContent=`${ab} • ${ob}`;
 const sel=document.getElementById('sel').value;const jr=await j(`/api/journal-tail/${sel}?n=600`);const rows=(jr&&jr.rows)?jr.rows:[];
 const ticks=rows.filter(r=>r.type==='tick'&&r.px).slice(-500).map(r=>({time:Math.floor(new Date(r.ts).getTime()/1000),value:+r.px}));if(ticks.length&&series)series.setData(ticks);
 const sj=await j('/api/journal-tail/stocks?n=600');const sRows=(sj&&sj.rows)?sj.rows:[];
 const sTicks=sRows.filter(r=>r.type==='tick'&&r.px).slice(-500).map(r=>({time:Math.floor(new Date(r.ts).getTime()/1000),value:+r.px}));
 if(sTicks.length&&stocksSeries) stocksSeries.setData(sTicks);
 const sState=states.stocks||{};
 const sSym=(sState.active_symbol||((sState.position&&sState.position.symbol)?sState.position.symbol:'-'));
 document.getElementById('stocksChartMeta').textContent=`symbol ${sSym} • last ${(sState.last_px!==null&&sState.last_px!==undefined)?Number(sState.last_px).toFixed(4):'-'}`;
 const st=states[sel]||null;const p=st&&st.position?st.position:null;const pUnreal=Number((p&&p.unrealized_pnl) ?? (st&&st.unrealized_pnl) ?? 0);document.getElementById('pos').innerHTML=p?`<span class='ok'>${p.symbol}</span><br>side ${p.side||'long'} • entry ${(+p.entry).toFixed(4)}<br>qty ${(+(p.qty||0)).toFixed(4)} • size ${money(p.notional||((+p.qty||0)*(+p.entry||0)),2)}<br><span class='k'>opened ${formatEt(p.opened_at)}</span><br><span class="${pUnreal>=0?'ok':'bad'}">live pnl ${money(pUnreal,2)}</span>`:'none';
 const watched=(st&&st.watched_symbols)||[];
 const ranked=((st&&st.watched_ranked)||[]).slice(0,6);
 const watchBody=ranked.length?ranked.map(r=>`${r.symbol} (${r.signal||'-'}) s:${Number(r.score||0).toFixed(1)}`).join('<br>'):(watched.join(', ')||'-');
 const watchTs=(st&&st.watchlist_updated_at)?formatEt(new Date((+st.watchlist_updated_at||0)*1000).toISOString()):'-';
 document.getElementById('watch').innerHTML=`${watchBody}<br><span class='k'>updated ${watchTs}</span>`;

 const mkRun=(tag,s)=>{
   const top=((s&&s.watched_ranked)||[]).slice(0,4);
   if(!top.length) return [{tag,line:`${tag}: no ranked runners`,sym:null,rank:null}];
   return top.map((r,i)=>({tag,sym:r.symbol,rank:i+1,line:`${tag} #${i+1} ${r.symbol} | sig ${r.signal||'-'} | score ${Number(r.score||0).toFixed(1)} | r15 ${(Number(r.ret15||0)*100).toFixed(2)}% | range ${(Number(r.range20||0)*100).toFixed(2)}%`}));
 };
 const runObjs=[...mkRun('crypto',states.crypto||{}),...mkRun('forex',states.forex||{}),...mkRun('stocks',states.stocks||{})];
 const selRows=rows.filter(r=>r.type==='tick' || r.type==='ai_decision' || r.type==='trade_open' || r.type==='trade_close').slice(-120);
 const bySym={};
 for(const r of selRows){
   const sym=(r.symbol||r.target_symbol||'').toString();
   if(!sym) continue;
   const o=(bySym[sym]=bySym[sym]||{});
   if(r.type==='ai_decision') o.ai={action:r.action||'',conf:Number(r.confidence||0),reason:r.reason||''};
   if(r.type==='trade_open') o.open=r;
   if(r.type==='trade_close') o.close=r;
   if(r.type==='tick') o.tick=r;
 }
 const explain=(obj)=>{
   if(!obj||!obj.sym) return (obj && obj.line) ? obj.line : '-';
   const v=bySym[obj.sym]||{};
   if(v.open) return `${obj.line} → ENTERED @ ${Number(v.open.px||0).toFixed(4)} (${v.open.regime||'-'})`;
   if(v.close) return `${obj.line} → was traded earlier, now CLOSED pnl ${fmt(Number(v.close.pnl||0))}`;
   if(v.ai){
     const c=(v.ai.conf*100).toFixed(0);
     const a=(v.ai.action||'HOLD').toUpperCase();
     return `${obj.line} → SKIP: AI ${a} ${c}% (${v.ai.reason||'no edge'})`;
   }
   if(v.tick){
     const rg=v.tick.regime||'-';
     const sg=v.tick.sig||'-';
     return `${obj.line} → SKIP: no entry trigger (sig ${sg}, regime ${rg})`;
   }
   return `${obj.line} → SKIP: not reached in selected stream window`;
 };
 const explained=runObjs.map(explain);
 const extra=[];
 const skip=((states[sel]&&states[sel].skip_reasons_today)?states[sel].skip_reasons_today:{});
 const topSk=Object.entries(skip).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k}:${v}`).join(' • ');
 if(topSk) extra.push(`Top skip buckets (${sel}): ${topSk}`);
 document.getElementById('runners').innerHTML=`<b>Top scans now + reason</b><br>${explained.join('<br>')}<br><br>${extra.join('<br>')||''}`;
 const ss=setupStats(rows);document.getElementById('setups').innerHTML=Object.entries(ss).map(([k,v])=>`${k}: wr ${(100*v.w/v.n).toFixed(0)}% • net ${fmt(v.p)}`).join('<br>')||'-';
 await refreshMissedRunnerAudit(false);
	 const perf=((st&&st.performance)?st.performance:null);
	 if(perf){
	   const lastClose=perf.last_close?tradeSummaryLine(perf.last_close).replace(/^last trade:\s*/,''):'none yet';
	   document.getElementById('perf').innerHTML=`lifetime closes ${perf.all_time_closed_trades||0} • wr ${Number(perf.all_time_win_rate||0).toFixed(1)}% • pnl ${fmt(Number(perf.all_time_realized_pnl||0))}<br>today closes ${perf.today_closed_trades||0} • opened ${perf.today_opened_trades||0} • wr ${Number(perf.today_win_rate||0).toFixed(1)}% • pnl ${fmt(Number(perf.today_realized_pnl||0))}<br>last close ${lastClose}`;
	 } else {
	   const perfFallback=perfStats(rows);
	   document.getElementById('perf').innerHTML=`recent closes ${perfFallback.total} • wr ${perfFallback.wr.toFixed(1)}% • pnl ${fmt(perfFallback.pnl)} • avg ${fmt(perfFallback.avg)}<br>profit factor ${perfFallback.pf.toFixed(2)} • max drawdown ${fmt(-perfFallback.maxDd)}<br>today closes ${perfFallback.tTotal} • wr ${perfFallback.twr.toFixed(1)}% • pnl ${fmt(perfFallback.tPnl)}<br>last close ${perfFallback.lastClose}`;
	 }
	 const latest=await j('/api/latest-trade-events?limit=5000&hours=720');
	 const diagEl=document.getElementById('eventDiag');
	 if(latest&&Array.isArray(latest.events)){
	   allEvents=latest.events;
	   renderEvents();
	 } else {
	   allEvents=[];
	   renderEvents();
	   if(diagEl) diagEl.textContent='trade feed unavailable right now';
	   const summary=document.getElementById('eventsSummary');
	   if(summary) summary.textContent='unable to load trade events';
	 }
	 if(diagEl && latest && latest.diagnostics){
   const d=latest.diagnostics;
   const classes=['crypto','forex','stocks'];
   const lines=classes.map(c=>`${c}: recv ${d.received?.[c]||0} • rendered ${d.rendered?.[c]||0} • dropped ${d.dropped?.[c]||0}`);
   const reasons=Object.entries(d.drop_reasons||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' • ') || 'none';
   const alpacaStatus=d.source_status?.alpaca||'unavailable';
   diagEl.innerHTML=`${lines.join('<br>')}<br>drop reasons: ${reasons}<br>broker feed: ${esc(alpacaStatus)}`;
   const srcEl=document.getElementById('eventsSource');
   if(srcEl){
     srcEl.textContent=alpacaStatus==='ok'
       ? 'Alpaca broker rows are primary for stocks/overnight. Journal rows are shown only for crypto/forex or when broker data is unavailable.'
       : `Alpaca broker feed is ${alpacaStatus}; journal fallback rows are labeled source=journal.`;
   }
 }
 const logs=await j('/api/logs');
 if(logs&&logs.combined){
   document.getElementById('logs').textContent=logs.combined.slice(-20000);
 }
 await refreshBreakWatchers('stocks');
 }

function showWatchlist(tag){
  const s=latestStates[tag]||{};
  const ranked=(s.watched_ranked||[]);
  const raw=(s.watched_symbols||[]);
  const stockRows=[];
  if(tag==='stocks'){
    const rowMap=stockRowDataMap(s);
    const seen=new Set();
    raw.forEach((x)=>{
      const sym=String((x&&x.symbol)||x||'').trim().toUpperCase();
      const merged=rowMap.get(sym) || (typeof x==='object' ? x : {symbol:sym});
      if(sym && !seen.has(sym)){
        stockRows.push(merged);
        seen.add(sym);
      }
    });
    raw.forEach((x)=>{
      const sym=String((x&&x.symbol)||x||'').trim().toUpperCase();
      if(sym && !seen.has(sym)){
        stockRows.push(rowMap.get(sym) || (typeof x==='object' ? x : {symbol:sym}));
        seen.add(sym);
      }
    });
  }
  const lines=stockRows.length?stockRows.map((r,i)=>watchRowLabel(r,i)):ranked.length?ranked.map((r,i)=>watchRowLabel(r,i)):raw.map((x,i)=>watchRowLabel(x,i));
  const modal=document.getElementById('watchModal');
  document.getElementById('watchTitle').textContent=`${tag.toUpperCase()} watchlist`;
  const scanText=formatStateTs((s.watchlist_updated_at || s.runner_scan_ts || s.intraday_rescan_ts || s.morning_scan_ts || 0));
  const body=document.getElementById('watchBody');
  if(tag==='stocks' && stockRows.length){
    body.innerHTML='<div class="muted">loading news...</div>';
    if(modal && modal.showModal) modal.showModal();
    loadStockNews(stockRows.map((r)=>r.symbol)).then((newsMap)=>{
      const header=`<div class="muted" style="margin-bottom:8px">last scan ${esc(scanText)}</div>
	<div style="display:grid;grid-template-columns:170px 150px 90px 140px 1fr;gap:10px;font-weight:700;color:#cfe0ff;border-bottom:1px solid #22305f;padding-bottom:6px;margin-bottom:6px">
	  <div>Symbol</div><div>Score / Regime</div><div>Last</div><div>%Change / Volume</div><div>News</div>
	</div>`;
      const rows=stockRows.map((r,i)=>{
        const sym=esc(r.symbol||'-');
        const rawSym=String(r.symbol||'').toUpperCase();
        const score=Number.isFinite(Number(r.score))?Number(r.score).toFixed(2):'-';
        const regime=esc(r.regime || '-');
        const last=Number.isFinite(Number(r.px))?Number(r.px).toFixed(4):'-';
        const pct=Number.isFinite(Number(r.day_change_pct))?`${(Number(r.day_change_pct)*100).toFixed(2)}%`:'-';
        const vol=Number.isFinite(Number(r.today_vol))?Number(r.today_vol).toLocaleString():'-';
        const newsItems = Array.isArray(newsMap?.[rawSym]) ? newsMap[rawSym] : [];
        const fallback = String(r.news_headline || r.news || r.news_summary || r.news_label || '').trim();
        const finalNews = newsItems.length ? newsItems : (fallback ? [{headline:fallback,url:r.news_url || r.article_url || r.url || r.link || ''}] : []);
        const newsHtml = finalNews.length
          ? finalNews.map((n)=>{
              const headline=esc(n.headline || n.summary || '-');
              const url=String(n.url || '').trim();
              const meta=[String(n.source||'').trim(), String(n.created_at||'').trim()].filter(Boolean).join(' • ');
              return url
                ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${headline}</a>${meta ? `<div class="muted">${esc(meta)}</div>` : ''}`
                : `${headline}${meta ? `<div class="muted">${esc(meta)}</div>` : ''}`;
            }).join('<br>')
          : '-';
        return `<div style="display:grid;grid-template-columns:170px 150px 90px 140px 1fr;gap:10px;padding:3px 0">
  <div>${i+1}. ${sym}<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">
    <button class="stock-buy-btn" data-symbol="${esc(rawSym)}" data-mult="1">1X</button>
    <button class="stock-buy-btn" data-symbol="${esc(rawSym)}" data-mult="3">3X</button>
    <button class="stock-buy-btn" data-symbol="${esc(rawSym)}" data-mult="5">5X</button>
  </div></div><div>${score} • ${regime}</div><div>${last}</div><div>${pct} • ${vol}</div><div style="white-space:normal;word-break:break-word">${newsHtml}</div>
</div>`;
      }).join('');
      body.innerHTML=`${header}${rows}`;
    });
  }else{
    body.textContent=`last scan ${scanText}\n${lines.join('\n') || 'No watchlist yet'}`;
  }
  if(modal && modal.showModal) modal.showModal();
}

async function post(path,data){
  const headers={'Content-Type':'application/json'};
  if(uiPin) headers['X-UI-PIN']=uiPin;
  const payload=Object.assign({pin:uiPin}, data||{});
  const r=await fetch(path,{method:'POST',headers,body:JSON.stringify(payload)});
  if(r.status===403){
    lockUi();
    throw new Error('pin required');
  }
  return r.json();
}

async function action(path,label,data){
  const el=document.getElementById('act');
  el.textContent=`${label}...`;
  try{
    const res=await post(path,data);
    if(res && res.ok){
      if(String(path).includes('/buy/')){
        const orderId=((res.order||{}).id)||res.id||'';
        const orderStatus=((res.order||{}).status)||res.status||'submitted';
        el.textContent=orderId?`${label} ${orderStatus} (${orderId.slice(0,8)})`:`${label} ${orderStatus}`;
      } else {
        el.textContent=`${label} done`;
      }
    } else {
      const err = (res && (res.error || res.err)) ? `: ${res.error || res.err}` : '';
      el.textContent=`${label} failed${err}`;
    }
  }catch(e){
    el.textContent=`${label} error`;
  }
  setTimeout(()=>el.textContent='',3000);
  refresh();
}

async function showPendingOrders(){
  const modal=document.getElementById('pendingOrdersModal');
  const body=document.getElementById('pendingOrdersBody');
  const title=document.getElementById('pendingOrdersTitle');
  if(!body || !modal) return;
  title.textContent='Pending Orders (Alpaca)';
  body.innerHTML='<div class="muted">loading...</div>';
  if(modal.showModal) modal.showModal();
  try{
    const data=await j('/api/pending-orders?limit=200');
    if(!data || !data.ok){
      body.innerHTML=`<div class="bad">Failed to load pending orders: ${esc((data&&data.error)||'unknown error')}</div>`;
      return;
    }
    const rows=Array.isArray(data.orders)?data.orders:[];
    if(!rows.length){
      body.innerHTML='<div class="ok">No pending/open orders.</div>';
      return;
    }
    const html=rows.map((r,idx)=>{
      const submitted=r.submitted_at?formatEt(r.submitted_at):'-';
      const qty=(r.filled_qty&&Number(r.filled_qty)>0)?`${esc(String(r.filled_qty))}/${esc(String(r.qty||'-'))}`:esc(String(r.qty||'-'));
      const px=r.limit_price?`@ ${esc(String(r.limit_price))}`:(r.notional?`$${esc(String(r.notional))}`:'-');
      return `<div style="padding:8px 0;border-bottom:1px solid #22305f">
  <div><b>${idx+1}. ${esc(r.symbol||'-')}</b> • ${esc((r.side||'-').toUpperCase())} • ${esc((r.type||'-').toUpperCase())} ${px}</div>
  <div class="muted">status ${esc(r.status||'-')} • qty ${qty} • tif ${esc(String(r.time_in_force||'-').toUpperCase())} • submitted ${submitted}</div>
</div>`;
    }).join('');
    body.innerHTML=`<div class="muted" style="margin-bottom:8px">${rows.length} pending/open order(s)</div>${html}`;
  }catch(e){
    body.innerHTML=`<div class="bad">Failed to load pending orders: ${esc(e&&e.message?e.message:'network error')}</div>`;
  }
}

document.getElementById('btnStart').addEventListener('click',()=>action('/api/start','Start'));
document.getElementById('btnStop').addEventListener('click',()=>action('/api/stop','Stop'));
document.getElementById('btnClose').addEventListener('click',()=>action('/api/close','Close positions'));
const pendingBtn=document.getElementById('btnPendingOrders');
if(pendingBtn){
  pendingBtn.addEventListener('click',()=>showPendingOrders().catch(e=>console.error(e)));
}
for(const tag of tags){
  document.getElementById(`tgl-${tag}`).addEventListener('click', async ()=>{
    const btn=document.getElementById(`tgl-${tag}`);
    const isRunning=btn.dataset.running==='1';
    const path=isRunning?`/api/bot/${tag}/stop`:`/api/bot/${tag}/start`;
    await action(path, `${isRunning?'Stop':'Start'} ${tag}`);
  });
  const cbtn=document.getElementById(`close-${tag}`);
  if(cbtn){
    cbtn.addEventListener('click', async ()=>{
      await action(`/api/bot/${tag}/close`, `Close ${tag} position`);
    });
  }
  const wbtn=document.getElementById(`show-${tag}-watch`);
  if(wbtn){
    wbtn.addEventListener('click', ()=>showWatchlist(tag));
  }
}
const watchBodyEl=document.getElementById('watchBody');
if(watchBodyEl){
  watchBodyEl.addEventListener('click', async (ev)=>{
    const btn=ev.target && ev.target.closest ? ev.target.closest('.stock-buy-btn') : null;
    if(!btn) return;
    ev.preventDefault();
    const sym=String(btn.dataset.symbol||'').toUpperCase();
    const mult=Number(btn.dataset.mult||1);
    if(!sym || !Number.isFinite(mult)) return;
    await action(`/api/bot/stocks/buy/${mult}?symbol=${encodeURIComponent(sym)}`, `Buy ${sym} ${mult}x`, {symbol:sym,multiplier:mult});
  });
}
for(const tag of tags){
  const ksBtn=document.getElementById(`ks-${tag}`);
  if(ksBtn){
    ksBtn.addEventListener('click', async ()=>{
      const enabled=ksBtn.dataset.enabled==='1';
      const mode=enabled?'off':'on';
      await action(`/api/kill-switch/${tag}/${mode}`, `${mode==='on'?'Enable':'Disable'} kill ${tag}`);
    });
  }
}
document.addEventListener('click',(ev)=>{
  const btn=ev.target && ev.target.closest ? ev.target.closest('.lane-view-more') : null;
  if(!btn) return;
  ev.stopPropagation();
  openLaneMoreModal(btn.dataset.lane);
});
const wclose=document.getElementById('watchClose');
if(wclose){
  wclose.addEventListener('click',()=>{
    const m=document.getElementById('watchModal');
    if(m && m.close) m.close();
  });
}
const stateClose=document.getElementById('tradebotStateClose');
if(stateClose){
  stateClose.addEventListener('click',()=>{
    const m=document.getElementById('tradebotStateModal');
    if(m && m.close) m.close();
  });
}
const laneMoreClose=document.getElementById('laneMoreClose');
if(laneMoreClose){
  laneMoreClose.addEventListener('click',()=>{
    const m=document.getElementById('laneMoreModal');
    if(m && m.close) m.close();
  });
}
const pendingClose=document.getElementById('pendingOrdersClose');
if(pendingClose){
  pendingClose.addEventListener('click',()=>{
    const m=document.getElementById('pendingOrdersModal');
    if(m && m.close) m.close();
  });
}
document.getElementById('sel').addEventListener('change',()=>refresh().catch(e=>console.error(e)));
document.querySelectorAll('#events .sort-btn').forEach((btn)=>{
  btn.addEventListener('click',()=>{
    const key=btn.dataset.sortKey;
    if(eventSort.key===key){
      eventSort.dir=eventSort.dir==='asc'?'desc':'asc';
    }else{
      eventSort={key,dir:key==='timestamp_et'?'desc':'asc'};
    }
    renderEvents();
  });
});
document.querySelectorAll('.filter-tab').forEach((btn)=>{
  btn.addEventListener('click',()=>{
    eventFilter=btn.dataset.filter||'all';
    renderEvents();
  });
});
const auditBtn=document.getElementById('auditRefresh');
if(auditBtn){
  auditBtn.addEventListener('click',()=>refreshMissedRunnerAudit(true).catch(e=>console.error(e)));
}
const auditInput=document.getElementById('auditSymbols');
if(auditInput){
  auditInput.addEventListener('keydown',(ev)=>{
    if(ev.key==='Enter'){
      ev.preventDefault();
      refreshMissedRunnerAudit(true).catch(e=>console.error(e));
    }
  });
}

refresh().catch(e=>console.error(e));
setInterval(()=>refresh().catch(e=>console.error(e)),5000);
