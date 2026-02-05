
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

function nowISO(){ return new Date().toISOString(); }
function randId(prefix='id'){ return `${prefix}_${Math.random().toString(36).slice(2,10)}${Date.now().toString(36)}`; }
function readJsonSafe(file, fallback){
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; }
}
function writeJsonSafe(file, obj){
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

const AVENUES = [
  { id:'gov_bonds', name:'Government Bonds', type:'single' },
  { id:'nps', name:'NPS', type:'single' },
  { id:'stock_it', name:'Stock IT', type:'single' },
  { id:'stock_auto', name:'Stock Automobile', type:'single' },
  { id:'stock_pharma', name:'Stock Pharma', type:'single' },
  { id:'gold', name:'Gold', type:'single' },
  { id:'silver', name:'Silver', type:'single' },
  { id:'crypto', name:'Crypto', type:'single' },
  { id:'bank_fd', name:'Bank FD', type:'single' },

  // Mutual funds (hardcoded baskets, equal weights)
  { id:'mf1', name:'Mutual Fund 1 (Balanced Growth)', type:'basket',
    basket: [
      { id:'stock_it', w:0.2 }, { id:'stock_auto', w:0.2 }, { id:'stock_pharma', w:0.2 }, { id:'gold', w:0.2 }, { id:'bank_fd', w:0.2 }
    ]
  },
  { id:'mf2', name:'Mutual Fund 2 (High Risk High Return)', type:'basket',
    basket: [
      { id:'crypto', w:0.2 }, { id:'stock_it', w:0.2 }, { id:'gold', w:0.2 }, { id:'silver', w:0.2 }, { id:'stock_auto', w:0.2 }
    ]
  }
];

const AGENT_PROFILES = [
  { username:'AG_GOV', pin:'1234', avenue:'gov_bonds' },
  { username:'AG_NPS', pin:'1234', avenue:'nps' },
  { username:'AG_IT', pin:'1234', avenue:'stock_it' },
  { username:'AG_AUTO', pin:'1234', avenue:'stock_auto' },
  { username:'AG_PHARMA', pin:'1234', avenue:'stock_pharma' },
  { username:'AG_GOLD', pin:'1234', avenue:'gold' },
  { username:'AG_SILVER', pin:'1234', avenue:'silver' },
  { username:'AG_CRYPTO', pin:'1234', avenue:'crypto' },
  { username:'AG_BANK', pin:'1234', avenue:'bank_fd' },
  { username:'AG_MF1', pin:'1234', avenue:'mf1' },
  { username:'AG_MF2', pin:'1234', avenue:'mf2' }
];

const DEFAULT_STATE = {
  meta: {
    eventName: 'BIZ SRESHTA 26',
    gameName: 'Money Rush (Budget Race)',
    copyright: 'Copyright © Mithun Raj C, Senior Research Fellow, Department of Management, Pondicherry University Karaikal Campus. Ph: 8281730776'
  },
  auth: {
    adminPin: '0000'
  },
  settings: {
    startingMoney: 10000,
    roundsTotal: 4,
    marketOpenSeconds: 120,
    tradingSeconds: 120,
    eventsPerRound: 4,
    wheelEventsCount: 12
  },
  teams: [],
  marketConditions: [],
  current: {
    phase: 'idle', // idle | market_open | spinning | trading | locked | ended
    roundIndex: 0,
    marketConditionId: null,
    marketHeadline: '',
    roundEventIds: [],
    spunEventIds: [],
    phaseEndsAt: null,
    lastUpdatedAt: null
  },
  rates: {}, // avenueId -> current multiplier delta per event, expressed as percent e.g. +10 or -5
  notifications: [], // {id,toAvenue,eventId,createdAt,acceptedAt}
  ledger: [], // {id,ts,kind,teamId,avenueId,amount,action,by,round,meta}
  results: null
};

function initRates(state, reset=false){
  // Default per-event return rates (cumulative and dynamic, always < 4%)
  // These are applied at every event to existing holdings.
  const defaults = {
    bank_fd: 2.00,
    nps: 2.25,
    gov_bonds: 1.75,
    stock_it: 3.50,
    stock_auto: 3.00,
    stock_pharma: 3.20,
    gold: 2.80,
    silver: 2.60,
    crypto: 3.80
  };

  for (const a of AVENUES){
    if (reset || !(a.id in state.rates)){
      if (a.type === 'basket'){
        // Basket rate is derived from underlying rates; UI shows cumulative basket rate separately if needed.
        state.rates[a.id] = 0;
      } else {
        state.rates[a.id] = (a.id in defaults) ? defaults[a.id] : 2.50;
      }
    }
  }
}

function loadState(){
  const st = readJsonSafe(DATA_FILE, DEFAULT_STATE);
  initRates(st, false);
  // migrate agents defaults: keep only pins in profiles file, not stored
  return st;
}
let state = loadState();

function persist(){ state.current.lastUpdatedAt = nowISO(); writeJsonSafe(DATA_FILE, state); }

const sessions = {
  admin: new Map(), // token -> {createdAt}
  agent: new Map()  // token -> {username, avenue, createdAt}
};

function send(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization'
  });
  res.end(body);
}

function notFound(res){ res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); }

function parseBody(req){
  return new Promise((resolve, reject)=>{
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e7) req.destroy(); });
    req.on('end', ()=>{
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e){ reject(e); }
    });
  });
}

function getToken(req){
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}
function requireAdmin(req){
  const t = getToken(req);
  if (!t) return null;
  return sessions.admin.get(t) ? t : null;
}
function requireAgent(req){
  const t = getToken(req);
  if (!t) return null;
  return sessions.agent.get(t) ? { token:t, ...sessions.agent.get(t) } : null;
}

function avenueById(id){ return AVENUES.find(a=>a.id===id); }
function teamById(id){ return state.teams.find(t=>t.id===id); }

function calcTeamTotal(team){
  // team has: cash, holdings {avenueId: amount}
  let total = team.cash;
  for (const [aid, amt] of Object.entries(team.holdings)){
    total += Number(amt||0);
  }
  return round2(total);
}
function round2(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }

function applyEventToAvenue(avenueId, deltaPct){
  // deltaPct: +10 means increase holdings by 10%
  for (const team of state.teams.filter(t=>t.status==='approved')){
    const holding = Number(team.holdings[avenueId] || 0);
    if (holding === 0) continue;
    const change = holding * (deltaPct/100);
    team.holdings[avenueId] = round2(holding + change);
    // ledger impact per event
    state.ledger.push({
      id: randId('ldg'),
      ts: nowISO(),
      kind: 'event_impact',
      teamId: team.id,
      avenueId,
      amount: round2(change),
      action: deltaPct>=0 ? 'increase' : 'decrease',
      by: 'system',
      round: state.current.roundIndex,
      meta: { deltaPct }
    });
  }
}

function applyEventToMutualFunds(){
  // mutual funds are baskets; compute derived delta as weighted sum of underlying avenue deltas
  for (const mf of AVENUES.filter(a=>a.type==='basket')){
    const effDelta = mf.basket.reduce((acc, b)=> acc + (state.rates[b.id]||0)*b.w, 0);
    // apply to holdings like single
    applyEventToAvenue(mf.id, effDelta);
  }
}
function applyReturnsForAllAvenuesOnce(){
  // At each event, every invested avenue earns (or loses) return based on its CURRENT cumulative rate.
  // Singles use their own rate. Mutual funds derive a rate from underlying avenues.
  for (const a of AVENUES.filter(x=>x.type==='single')){
    const r = Number(state.rates[a.id] || 0);
    if (r !== 0) applyEventToAvenue(a.id, r);
  }
  // Mutual funds compounding based on underlying current rates
  applyEventToMutualFunds();
}

function computeTaxesAndFinal(){
  // taxable profit = final_total - startingMoney
  const start = state.settings.startingMoney;
  const results = [];
  for (const team of state.teams.filter(t=>t.status==='approved')){
    const finalTotal = calcTeamTotal(team);
    const profit = Math.max(0, finalTotal - start);
    // compute profit contributions by avenue as (current holding - invested principal in that avenue) not tracked
    // For game simplicity: tax on total profit; exemptions handled via allocation ratios based on final holdings.
    const totalInvestedNow = Object.entries(team.holdings).reduce((a,[,v])=>a+Number(v||0),0);
    const weights = {};
    if (totalInvestedNow>0){
      for (const [aid, v] of Object.entries(team.holdings)) weights[aid] = Number(v||0)/totalInvestedNow;
    }
    const govShare = weights['gov_bonds'] || 0;
    const npsShare = weights['nps'] || 0;
    const otherShare = Math.max(0, 1 - govShare - npsShare);

    const govProfit = profit * govShare;
    const npsProfit = profit * npsShare;
    const otherProfit = profit * otherShare;

    const taxGov = 0;
    let taxNps = npsProfit * 0.10;
    if (taxNps > 5000) taxNps = 5000;

    const taxOther = slabTax(otherProfit);

    const taxTotal = round2(taxGov + taxNps + taxOther);
    const afterTax = round2(finalTotal - taxTotal);

    results.push({
      teamId: team.id,
      teamName: team.teamName,
      finalTotal: round2(finalTotal),
      profit: round2(profit),
      taxTotal,
      afterTax
    });
  }
  results.sort((a,b)=>b.afterTax - a.afterTax);
  return results;
}

function slabTax(taxable){
  const x = Number(taxable||0);
  if (x<=2000) return 0;
  // slab is applied on full taxable amount as per your table (not marginal slabs)
  if (x<=4000) return round2(x*0.05);
  if (x<=6000) return round2(x*0.10);
  if (x<=8000) return round2(x*0.15);
  if (x<=10000) return round2(x*0.20);
  if (x<=12000) return round2(x*0.25);
  return round2(x*0.30);
}


function resetAllState(){
  // Full reset: clears market conditions/events, ledger, notifications, results, current round state,
  // resets avenue rates to defaults, and resets all team balances/holdings.
  state.marketConditions = [];
  state.notifications = [];
  state.ledger = [];
  state.results = null;

  state.current = {
    phase: 'idle',
    roundIndex: 0,
    marketConditionId: null,
    marketHeadline: '',
    roundEventIds: [],
    spunEventIds: [],
    phaseEndsAt: null,
    lastUpdatedAt: null
  };

  // reset rates to defaults
  initRates(state, true);

  // reset teams (keep registration + approval status)
  for (const t of state.teams){
    t.cash = (t.status==='approved') ? state.settings.startingMoney : 0;
    for (const a of AVENUES) t.holdings[a.id] = 0;
  }
}

function publicState(){
  return {
    meta: state.meta,
    settings: state.settings,
    avenues: AVENUES.map(a=>({id:a.id,name:a.name,type:a.type})),
    teams: state.teams.map(t=>({
      id:t.id,
      teamName:t.teamName,
      members:t.members,
      status:t.status,
      cash:t.cash,
      holdings:t.holdings,
      total: calcTeamTotal(t)
    })),
    marketConditions: state.marketConditions.map(m=>({id:m.id, title:m.title})),
    current: state.current,
    rates: state.rates,
    notifications: state.notifications,
    results: state.results
  };
}

function agentView(tokenInfo){
  // agent can see teams + holdings + their own notifications
  const base = publicState();
  base.agent = { username: tokenInfo.username, avenue: tokenInfo.avenue };
  return base;
}

function adminView(){
  return publicState();
}

function serveStatic(req, res){
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = url.pathname;
  if (p === '/') p = '/index.html';
  if (p === '/display') p = '/display.html';
  const file = path.join(__dirname, 'public', p);
  if (!file.startsWith(path.join(__dirname,'public'))) return notFound(res);
  fs.readFile(file, (err, data)=>{
    if (err) return notFound(res);
    const ext = path.extname(file).toLowerCase();
    const ct = ext==='.html' ? 'text/html; charset=utf-8'
      : ext==='.js' ? 'application/javascript; charset=utf-8'
      : ext==='.css' ? 'text/css; charset=utf-8'
      : ext==='.png' ? 'image/png'
      : ext==='.jpg' || ext==='.jpeg' ? 'image/jpeg'
      : ext==='.svg' ? 'image/svg+xml'
      : ext==='.mp3' ? 'audio/mpeg'
      : 'application/octet-stream';
    res.writeHead(200, {'Content-Type':ct, 'Cache-Control':'no-store'});
    res.end(data);
  });
}

const server = http.createServer(async (req, res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS'){
    res.writeHead(204, {
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'Content-Type, Authorization',
      'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'
    });
    return res.end();
  }

  // API routes
  if (url.pathname.startsWith('/api/')){
    try{
      if (req.method === 'GET' && url.pathname === '/api/ping'){
        return send(res, 200, {ok:true, ts: nowISO()});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/login'){
        const body = await parseBody(req);
        if (String(body.pin||'') !== String(state.auth.adminPin)) return send(res, 401, {ok:false, error:'Invalid admin PIN'});
        const token = randId('adm');
        sessions.admin.set(token, {createdAt: nowISO()});
        return send(res, 200, {ok:true, token});
      }

      if (req.method === 'POST' && url.pathname === '/api/agent/login'){
        const body = await parseBody(req);
        const u = String(body.username||'').trim();
        const p = String(body.pin||'').trim();
        const prof = AGENT_PROFILES.find(a=>a.username===u && a.pin===p);
        if (!prof) return send(res, 401, {ok:false, error:'Invalid agent login'});
        const token = randId('agt');
        sessions.agent.set(token, {username: prof.username, avenue: prof.avenue, createdAt: nowISO()});
        return send(res, 200, {ok:true, token, avenue: prof.avenue});
      }

      if (req.method === 'GET' && url.pathname === '/api/state'){
        const at = requireAdmin(req);
        const ag = requireAgent(req);
        if (at) return send(res, 200, {ok:true, role:'admin', state: adminView()});
        if (ag) return send(res, 200, {ok:true, role:'agent', state: agentView(ag)});
        return send(res, 200, {ok:true, role:'public', state: publicState()});
      }

      if (req.method === 'POST' && url.pathname === '/api/register'){
        const body = await parseBody(req);
        const teamName = String(body.teamName||'').trim();
        const m1 = body.member1 || {};
        const m2 = body.member2 || {};
        if (!teamName) return send(res, 400, {ok:false, error:'Team name required'});
        if (state.teams.some(t=>t.teamName.toLowerCase()===teamName.toLowerCase())) return send(res, 400, {ok:false, error:'Team name must be unique'});
        const members = [
          {name:String(m1.name||'').trim(), institute:String(m1.institute||'').trim()},
          {name:String(m2.name||'').trim(), institute:String(m2.institute||'').trim()}
        ];
        if (!members[0].name || !members[1].name) return send(res, 400, {ok:false, error:'Both member names required'});
        const team = {
          id: randId('team'),
          teamName,
          members,
          // Admin approval removed: teams are auto-approved on successful registration
          status: 'approved',
          cash: state.settings.startingMoney,
          holdings: {}
        };
        for (const a of AVENUES) team.holdings[a.id] = 0;
        state.teams.push(team);
        persist();
        return send(res, 200, {ok:true, teamId: team.id});
      }

      // Admin-only actions
      const adminToken = requireAdmin(req);

      if (req.method === 'POST' && url.pathname === '/api/admin/approve'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const body = await parseBody(req);
        const t = teamById(String(body.teamId||''));
        if (!t) return send(res, 404, {ok:false, error:'Team not found'});
        if (t.status !== 'approved'){
          t.status = 'approved';
          t.cash = state.settings.startingMoney;
        }
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/reject'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const body = await parseBody(req);
        const idx = state.teams.findIndex(t=>t.id===String(body.teamId||''));
        if (idx<0) return send(res, 404, {ok:false, error:'Team not found'});
        state.teams.splice(idx,1);
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/team/delete'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const body = await parseBody(req);
        const teamId = String(body.teamId||'');
        const idx = state.teams.findIndex(t=>t.id===teamId);
        if (idx<0) return send(res, 404, {ok:false, error:'Team not found'});

        // Remove team
        state.teams.splice(idx,1);

        // Clean up any team-linked ledger entries
        state.ledger = state.ledger.filter(l=>l.teamId !== teamId);

        // If results were computed, invalidate them
        state.results = null;

        persist();
        return send(res, 200, {ok:true});
      }


      if (req.method === 'POST' && url.pathname === '/api/admin/settings'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const body = await parseBody(req);
        const s = state.settings;
        for (const k of ['startingMoney','roundsTotal','marketOpenSeconds','tradingSeconds']){
          if (body[k] !== undefined){
            const v = Number(body[k]);
            if (!Number.isFinite(v) || v<=0) return send(res, 400, {ok:false, error:`Invalid ${k}`});
            s[k] = v;
          }
        }
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/marketCondition/add'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const body = await parseBody(req);
        const title = String(body.title||'').trim();
        if (!title) return send(res, 400, {ok:false, error:'Title required'});
        const mc = { id: randId('mc'), title, events: [] };
        state.marketConditions.push(mc);
        persist();
        return send(res, 200, {ok:true, id: mc.id});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/event/add'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const body = await parseBody(req);
        const mc = state.marketConditions.find(m=>m.id===String(body.marketConditionId||''));
        if (!mc) return send(res, 404, {ok:false, error:'Market condition not found'});
        const txt = String(body.text||'').trim();
        const avenueId = String(body.avenueId||'').trim();
        const dir = String(body.direction||'').trim(); // increase | decrease
        const rate = Number(body.rate||0);
        if (!txt) return send(res, 400, {ok:false, error:'Event text required'});
        if (!avenueById(avenueId)) return send(res, 400, {ok:false, error:'Invalid avenue'});
        if (!(dir==='increase'||dir==='decrease')) return send(res, 400, {ok:false, error:'Direction must be increase or decrease'});
        if (!Number.isFinite(rate) || rate<0) return send(res, 400, {ok:false, error:'Rate must be a non-negative number'});
        if (mc.events.length >= state.settings.wheelEventsCount) return send(res, 400, {ok:false, error:`Max ${state.settings.wheelEventsCount} events reached`});
        const ev = { id: randId('ev'), text: txt, avenueId, direction: dir, rate };
        mc.events.push(ev);
        persist();
        return send(res, 200, {ok:true, id: ev.id});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/initialize'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        // reset game state but keep teams and marketConditions
        state.current = {
          phase: 'idle',
          roundIndex: 0,
          marketConditionId: null,
          marketHeadline: '',
          roundEventIds: [],
          spunEventIds: [],
          phaseEndsAt: null,
          lastUpdatedAt: null
        };
        state.results = null;
        state.notifications = [];
        state.ledger = state.ledger.filter(l=>l.kind==='registration'); // keep none for simplicity
        initRates(state, true);
        // reset balances for approved teams
        for (const t of state.teams){
          t.cash = (t.status==='approved') ? state.settings.startingMoney : 0;
          for (const a of AVENUES) t.holdings[a.id] = 0;
        }
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/resetAll'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        resetAllState();
        persist();
        return send(res, 200, {ok:true});
      }


      if (req.method === 'POST' && url.pathname === '/api/admin/marketScan'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        if (state.marketConditions.length===0) return send(res, 400, {ok:false, error:'Add at least one market condition'});
        // choose random
        const mc = state.marketConditions[Math.floor(Math.random()*state.marketConditions.length)];
        state.current.marketConditionId = mc.id;
        state.current.marketHeadline = mc.title;
        state.current.roundEventIds = mc.events.map(e=>e.id);
        state.current.spunEventIds = [];
        state.current.phase = 'market_open';
        state.current.phaseEndsAt = Date.now() + state.settings.marketOpenSeconds*1000;
        persist();
        return send(res, 200, {ok:true, marketConditionId: mc.id, title: mc.title});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/beginSpin'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        if (!state.current.marketConditionId) return send(res, 400, {ok:false, error:'Run Market Scan first'});
        state.current.phase = 'spinning';
        state.current.phaseEndsAt = null;
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/spin'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        if (state.current.phase !== 'spinning') return send(res, 400, {ok:false, error:'Not in spinning phase'});
        const mc = state.marketConditions.find(m=>m.id===state.current.marketConditionId);
        if (!mc) return send(res, 400, {ok:false, error:'Market condition missing'});
        const remaining = mc.events.filter(e=>!state.current.spunEventIds.includes(e.id));
        if (remaining.length===0) return send(res, 400, {ok:false, error:'No events left on wheel'});
        // random pick
        const ev = remaining[Math.floor(Math.random()*remaining.length)];
        state.current.spunEventIds.push(ev.id);
        const delta = ev.direction==='increase' ? ev.rate : -ev.rate;

        // create agent notification
        state.notifications.push({
          id: randId('ntf'),
          toAvenue: ev.avenueId,
          eventId: ev.id,
          createdAt: nowISO(),
          acceptedAt: null
        });

        // ledger event
        state.ledger.push({
          id: randId('ldg'),
          ts: nowISO(),
          kind: 'event_spun',
          teamId: null,
          avenueId: ev.avenueId,
          amount: delta,
          action: 'spun',
          by: 'admin',
          round: state.current.roundIndex,
          meta: { eventId: ev.id, text: ev.text, direction: ev.direction, rate: ev.rate }
        });

        persist();
        return send(res, 200, {ok:true, event: ev, delta});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/openTrading'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        state.current.phase = 'trading';
        state.current.phaseEndsAt = Date.now() + state.settings.tradingSeconds*1000;
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/closeTrading'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        state.current.phase = 'locked';
        state.current.phaseEndsAt = null;
        // advance round
        state.current.roundIndex += 1;
        if (state.current.roundIndex >= state.settings.roundsTotal){
          state.current.phase = 'ended';
        } else {
          // reset for next round, market scan will set headline and wheel
          state.current.marketConditionId = null;
          state.current.marketHeadline = '';
          state.current.roundEventIds = [];
          state.current.spunEventIds = [];
        }
        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/endGame'){
        if (!adminToken) return send(res, 401, {ok:false, error:'Admin auth required'});
        const final = computeTaxesAndFinal();
        state.results = { computedAt: nowISO(), rows: final };
        state.current.phase = 'ended';
        state.current.phaseEndsAt = null;
        persist();
        return send(res, 200, {ok:true, results: state.results});
      }

      if (req.method === 'GET' && url.pathname === '/api/print'){
        // printable HTML for PDF
        const html = buildPrintableHtml();
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
        return res.end(html);
      }

      // Agent actions
      const agent = requireAgent(req);
      if (req.method === 'POST' && url.pathname === '/api/agent/acceptEvent'){
        if (!agent) return send(res, 401, {ok:false, error:'Agent auth required'});
        const body = await parseBody(req);
        const notif = state.notifications.find(n=>n.id===String(body.notificationId||''));
        if (!notif) return send(res, 404, {ok:false, error:'Notification not found'});
        if (notif.toAvenue !== agent.avenue) return send(res, 403, {ok:false, error:'Not your avenue'});
        if (notif.acceptedAt) return send(res, 400, {ok:false, error:'Already accepted'});
        notif.acceptedAt = nowISO();

        const mc = state.marketConditions.find(m=>m.id===state.current.marketConditionId) || state.marketConditions.find(m=>m.events.some(e=>e.id===notif.eventId));
        const ev = mc ? mc.events.find(e=>e.id===notif.eventId) : null;
        if (!ev) return send(res, 400, {ok:false, error:'Event not found'});
        const delta = ev.direction==='increase' ? ev.rate : -ev.rate;

        // Update cumulative rate for this avenue, then apply returns for ALL avenues for this event tick
        state.rates[ev.avenueId] = round2(Number(state.rates[ev.avenueId] || 0) + delta);
        applyReturnsForAllAvenuesOnce();

        state.ledger.push({
          id: randId('ldg'),
          ts: nowISO(),
          kind: 'event_accepted',
          teamId: null,
          avenueId: ev.avenueId,
          amount: delta,
          action: 'accepted',
          by: agent.username,
          round: state.current.roundIndex,
          meta: { eventId: ev.id, text: ev.text }
        });

        persist();
        return send(res, 200, {ok:true});
      }

      if (req.method === 'POST' && url.pathname === '/api/agent/tx'){
        if (!agent) return send(res, 401, {ok:false, error:'Agent auth required'});
        if (state.current.phase !== 'trading') return send(res, 400, {ok:false, error:'Trading window is closed'});
        const body = await parseBody(req);
        const team = teamById(String(body.teamId||''));
        if (!team || team.status!=='approved') return send(res, 400, {ok:false, error:'Invalid team'});
        const action = String(body.action||'').trim(); // invest | withdraw | transfer
        const amount = Number(body.amount||0);
        if (!Number.isFinite(amount) || amount<=0) return send(res, 400, {ok:false, error:'Amount must be > 0'});
        const avenueId = agent.avenue;

        if (action === 'invest'){
          if (team.cash < amount) return send(res, 400, {ok:false, error:'Insufficient cash'});
          team.cash = round2(team.cash - amount);
          team.holdings[avenueId] = round2(Number(team.holdings[avenueId]||0) + amount);
        } else if (action === 'withdraw'){
          if (Number(team.holdings[avenueId]||0) < amount) return send(res, 400, {ok:false, error:'Insufficient holding to withdraw'});
          team.holdings[avenueId] = round2(Number(team.holdings[avenueId]||0) - amount);
          // denomination handling is operational; system credits cash first
          team.cash = round2(team.cash + amount);
        } else if (action === 'transfer'){
          const toAvenueId = String(body.toAvenueId||'').trim();
          if (!avenueById(toAvenueId)) return send(res, 400, {ok:false, error:'Invalid target avenue'});
          if (toAvenueId === avenueId) return send(res, 400, {ok:false, error:'Cannot transfer to same avenue'});
          if (Number(team.holdings[avenueId]||0) < amount) return send(res, 400, {ok:false, error:'Insufficient holding to transfer'});
          team.holdings[avenueId] = round2(Number(team.holdings[avenueId]||0) - amount);
          team.holdings[toAvenueId] = round2(Number(team.holdings[toAvenueId]||0) + amount);
          // bank agent accept flow is UI-assisted; here we allow direct transfer with ledger
        } else {
          return send(res, 400, {ok:false, error:'Invalid action'});
        }

        state.ledger.push({
          id: randId('ldg'),
          ts: nowISO(),
          kind: 'transaction',
          teamId: team.id,
          avenueId,
          amount: round2(amount),
          action,
          by: agent.username,
          round: state.current.roundIndex,
          meta: action==='transfer' ? { toAvenueId: body.toAvenueId } : {}
        });

        persist();
        return send(res, 200, {ok:true});
      }

      return send(res, 404, {ok:false, error:'Unknown API endpoint'});
    } catch (e){
      return send(res, 500, {ok:false, error:'Server error', detail:String(e.message||e)});
    }
  }

  // static
  serveStatic(req, res);
});


function buildPrintableHtml(){
  // Printable results only (no signatures, no extra details)
  const rows = state.results?.rows || computeTaxesAndFinal();
  const top3 = rows.slice(0,3);
  const styles = `
    body{font-family: Arial, sans-serif; padding:24px; color:#111;}
    h1,h2{margin:0 0 10px 0;}
    .meta{margin-bottom:14px; font-size:12px; color:#444;}
    table{width:100%; border-collapse:collapse; margin-top:12px;}
    th,td{border:1px solid #333; padding:8px; font-size:12px;}
    th{background:#f0f0f0;}
    .top{background:#fff7cc;}
    @media print{button{display:none}}
  `;
  const trs = rows.map((r,i)=>`<tr class="${i<3?'top':''}"><td>${i+1}</td><td>${escapeHtml(r.teamName)}</td><td>${r.afterTax}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Final Results</title><style>${styles}</style></head>
  <body>
    <button onclick="window.print()">Print or Save as PDF</button>
    <h1>Final Results</h1>
    <div class="meta">Sorted by After Tax value</div>
    <h2>Top 3</h2>
    <ol>${top3.map(r=>`<li>${escapeHtml(r.teamName)} : ${r.afterTax}</li>`).join('')}</ol>
    <h2>Leaderboard</h2>
    <table>
      <thead><tr><th>Rank</th><th>Team</th><th>After Tax</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </body></html>`;
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`Money Rush Offline Server running on http://localhost:${PORT}`);
  console.log(`Projector display: http://localhost:${PORT}/display`);

  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)){
    for (const net of nets[name] || []){
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  if (ips.length){
    console.log('Network URLs:');
    for (const ip of ips){
      console.log(`  http://${ip}:${PORT}`);
      console.log(`  http://${ip}:${PORT}/display`);
    }
  }
});
