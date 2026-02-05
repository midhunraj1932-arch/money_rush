
const $ = (s)=>document.querySelector(s);

function fmtPhase(p){
  const map = {idle:'Idle',market_open:'Market Open',spinning:'Spinning',trading:'Trading Window',locked:'Locked',ended:'Ended'};
  return map[p] || p;
}
function msLeft(endsAt){
  if(!endsAt) return null;
  const d = Math.max(0, endsAt - Date.now());
  return Math.ceil(d/1000);
}
async function apiState(){
  const r = await fetch('/api/state');
  return await r.json();
}
function avenueName(st, id){
  const a = st.avenues.find(a=>a.id===id);
  return a ? a.name : id;
}
function render(st){
  $('#dTitle').textContent = st.meta.eventName;
  $('#dPhase').textContent = fmtPhase(st.current.phase);
  const sec = msLeft(st.current.phaseEndsAt);
  $('#dTimer').textContent = sec===null ? '-' : `${sec}s`;
  $('#dRound').textContent = `Round ${st.current.roundIndex+1} / ${st.settings.roundsTotal}`;
  $('#dHeadline').textContent = st.current.marketHeadline || 'Waiting for market scan...';
  $('#dMarketOpen').textContent = st.current.phase==='market_open' ? 'Market is opened. Observe the market.' : '';

  // rates
  const rates = $('#dRates');
  rates.innerHTML = '';
  for(const a of st.avenues){
    const v = Number(st.rates[a.id]||0);
    const div = document.createElement('div');
    div.className = 'rateRow';
    div.innerHTML = `<div>${a.name}</div><div class="${v>=0?'good':'bad'}">${v>=0?'+':''}${v}%</div>`;
    rates.appendChild(div);
  }

  // leaderboard
  const teams = st.teams.filter(t=>t.status==='approved').slice().sort((a,b)=>b.total-a.total);
  const tb = document.querySelector('#dTable tbody');
  tb.innerHTML = '';
  teams.forEach((t,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(t.teamName)}</td><td>${t.cash}</td><td>${t.total}</td>`;
    tb.appendChild(tr);
  });

  // dispute mode
  const sel = $('#dTeam');
  if(sel.options.length !== teams.length){
    sel.innerHTML = '';
    teams.forEach(t=>{
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.teamName;
      sel.appendChild(o);
    });
  }
  const t = teams.find(x=>x.id===sel.value) || teams[0];
  if(t){
    const lines = [];
    lines.push(`Cash: ${t.cash}`);
    for(const a of st.avenues){
      const amt = Number(t.holdings[a.id]||0);
      if(amt>0) lines.push(`${a.name}: ${amt}`);
    }
    $('#dStatement').textContent = lines.join('\n');
  }

  // events (simplified)
  const evBox = $('#dEvents');
  const evs = st.notifications.slice(-8).map(n=>{
    const status = n.acceptedAt ? '✅' : '🎲';
    return `${status} ${avenueName(st, n.toAvenue)} | ${n.acceptedAt ? 'Accepted' : 'Pending'}`;
  }).join('\n');
  evBox.textContent = evs || 'No events yet';
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

async function loop(){
  try{
    const r = await apiState();
    render(r.state);
  }catch{}
  setTimeout(loop, 1000);
}
loop();
