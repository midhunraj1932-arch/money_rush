
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

let adminToken = localStorage.getItem('mr_adminToken') || '';
let agentToken = localStorage.getItem('mr_agentToken') || '';
let soundOn = localStorage.getItem('mr_sound') !== 'off';
let lastState = null;

function beep(freq=440, ms=120){
  if(!soundOn) return;
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type='sine'; o.frequency.value=freq;
    o.connect(g); g.connect(ctx.destination);
    g.gain.value=0.03;
    o.start();
    setTimeout(()=>{o.stop(); ctx.close();}, ms);
  }catch{}
}

function setMsg(id, txt, good=false){
  const el = $(id); if(!el) return;
  el.textContent = txt;
  el.style.color = good ? 'var(--good)' : 'var(--accent)';
}

function fmtPhase(p){
  const map = {idle:'Idle',market_open:'Market Open',spinning:'Spinning',trading:'Trading Window',locked:'Locked',ended:'Ended'};
  return map[p] || p;
}

function msLeft(endsAt){
  if(!endsAt) return null;
  const d = Math.max(0, endsAt - Date.now());
  return Math.ceil(d/1000);
}

async function api(path, method='GET', body=null, token=''){
  const headers = {'Content-Type':'application/json'};
  if(token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {method, headers, body: body ? JSON.stringify(body): undefined});
  return await res.json();
}

function switchTab(tab){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  $$('.tabview').forEach(v=>v.classList.toggle('active', v.id===`tab-${tab}`));
}

function fillAvenues(sel){
  sel.innerHTML = '';
  for(const a of lastState.avenues){
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
}

function fillTeams(sel){
  sel.innerHTML = '';
  for(const t of lastState.teams.filter(t=>t.status==='approved')){
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.teamName;
    sel.appendChild(opt);
  }
}

// Registration approval UI removed in v3.

function renderSettings(){
  $('#setStart').value = lastState.settings.startingMoney;
  $('#setRounds').value = lastState.settings.roundsTotal;
  $('#setMarketOpen').value = lastState.settings.marketOpenSeconds;
  $('#setTrading').value = lastState.settings.tradingSeconds;

  // market condition list
  const mcSel = $('#mcSelect');
  mcSel.innerHTML = '';
  for(const mc of lastState.marketConditions){
    const opt = document.createElement('option');
    opt.value = mc.id; opt.textContent = mc.title;
    mcSel.appendChild(opt);
  }
}

function renderEventsAdmin(){
  $('#roundText').textContent = `${lastState.current.roundIndex+1} / ${lastState.settings.roundsTotal}`;
  $('#headlineText').textContent = lastState.current.marketHeadline || '-';
  $('#phaseText').textContent = fmtPhase(lastState.current.phase);

  const sec = msLeft(lastState.current.phaseEndsAt);
  $('#phaseTimer').textContent = sec===null ? '-' : `${sec}s`;

  const hist = $('#eventHistory');
  const evs = [];
  // from notifications and ledger could build, but keep simple: show accepted + spun
  const spun = lastState.ledger ? [] : [];
  // Client does not receive ledger in public state; show from notifications
  for(const n of lastState.notifications){
    const ev = findEventById(n.eventId);
    if(ev) evs.push({ev, accepted: !!n.acceptedAt});
  }
  hist.innerHTML = evs.map(x=>`<div>${x.accepted?'✅':'🎲'} <b>${escapeHtml(x.ev.text)}</b><br><span class="muted">${x.ev.direction} ${x.ev.rate}% on ${avenueName(x.ev.avenueId)}</span></div><div class="divider"></div>`).join('') || '<div class="muted">No events yet</div>';
}

function findEventById(id){
  for(const mc of lastState._fullMarketConditions || []){
    const ev = mc.events.find(e=>e.id===id);
    if(ev) return ev;
  }
  return null;
}

function avenueName(id){
  const a = lastState.avenues.find(a=>a.id===id);
  return a ? a.name : id;
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

async function refresh(){
  const res = await api('/api/state','GET',null, adminToken || agentToken || '');
  lastState = res.state;
  // For ease: fetch full market conditions list only for admin (so we can render event lists)
  if(adminToken){
    // quick trick: state endpoint for admin already has marketConditions with only id,title.
    // We'll mirror by calling raw json file not possible. So we keep minimal on UI.
  }

  $('#phasePill').textContent = fmtPhase(lastState.current.phase);

  $('#copyrightText').textContent = lastState.meta.copyright;

  // Agents selects
  fillTeams($('#txTeam'));
  fillAvenues($('#txToAvenue'));
  fillAvenues($('#evAvenue'));

  renderSettings();
  renderEventsAdmin();

  // agent panel
  if(agentToken){
    $('#agentPhase').textContent = fmtPhase(lastState.current.phase);
    const sec = msLeft(lastState.current.phaseEndsAt);
    $('#agentTimer').textContent = sec===null ? '-' : `${sec}s`;

    // show notification for this avenue
    const myAvenue = localStorage.getItem('mr_agentAvenue') || '';
    const notif = lastState.notifications.find(n=>n.toAvenue===myAvenue && !n.acceptedAt);
    const box = $('#agentNotifBox');
    if(notif){
      const ev = null; // we do not have full event text here; show ids
      $('#agentNotifText').textContent = `Event triggered for ${avenueName(myAvenue)}. Please accept to apply return change.`;
      box.style.display = '';
      $('#acceptEventBtn').onclick = async()=>{
        const r = await api('/api/agent/acceptEvent','POST',{notificationId:notif.id},agentToken);
        if(r.ok){ setMsg('#txMsg','Event accepted',true); beep(880,160); await refresh(); }
        else setMsg('#txMsg', r.error||'Failed');
      };
    } else {
      box.style.display = 'none';
    }

    // action lock
    const open = lastState.current.phase==='trading';
    $('#txSubmitBtn').disabled = !open;
  }
}

function bind(){
  $$('.tab').forEach(b=>b.addEventListener('click', ()=>switchTab(b.dataset.tab)));

  $('#soundToggle').addEventListener('click', ()=>{
    soundOn = !soundOn;
    localStorage.setItem('mr_sound', soundOn ? 'on':'off');
    $('#soundToggle').textContent = `Sound: ${soundOn?'ON':'OFF'}`;
    beep(520,80);
  });
  $('#soundToggle').textContent = `Sound: ${soundOn?'ON':'OFF'}`;

  // Registration
  $('#registerBtn').addEventListener('click', async()=>{
    const body = {
      teamName: $('#teamName').value,
      member1: {name:$('#m1Name').value, institute:$('#m1Inst').value},
      member2: {name:$('#m2Name').value, institute:$('#m2Inst').value}
    };
    const r = await api('/api/register','POST',body,'');
    if(r.ok){ setMsg('#regMsg','Registration successful. Team is active.',true); beep(660,140); $('#teamName').value=''; }
    else setMsg('#regMsg', r.error||'Failed');
    await refresh();
  });

  // Admin login in multiple tabs
  const adminLogin = async(pinInput, statusEl)=>{
    const r = await api('/api/admin/login','POST',{pin: pinInput.value});
    if(r.ok){
      adminToken = r.token;
      localStorage.setItem('mr_adminToken', adminToken);
      statusEl.textContent = 'Admin logged in';
      beep(780,140);
      await refresh();
    } else {
      statusEl.textContent = r.error||'Login failed';
      beep(180,120);
    }
  };
  $('#adminLoginBtn2').addEventListener('click', ()=>adminLogin($('#adminPin2'), $('#adminStatus2')));
  $('#adminLoginBtn3').addEventListener('click', ()=>adminLogin($('#adminPin3'), $('#adminStatus3')));

  // Agent login
  $('#agentLoginBtn').addEventListener('click', async()=>{
    const r = await api('/api/agent/login','POST',{username: $('#agentUser').value, pin: $('#agentPin').value});
    if(r.ok){
      agentToken = r.token;
      localStorage.setItem('mr_agentToken', agentToken);
      localStorage.setItem('mr_agentAvenue', r.avenue);
      $('#agentName').textContent = $('#agentUser').value;
      $('#agentAvenue').textContent = avenueName(r.avenue);
      setMsg('#agentMsg','Logged in',true);
      beep(720,140);
      await refresh();
    } else setMsg('#agentMsg', r.error||'Login failed');
  });

  // Agent transaction
  $('#txSubmitBtn').addEventListener('click', async()=>{
    const action = $('#txAction').value;
    const body = { teamId: $('#txTeam').value, action, amount: Number($('#txAmount').value||0) };
    if(action==='transfer') body.toAvenueId = $('#txToAvenue').value;
    const r = await api('/api/agent/tx','POST',body,agentToken);
    if(r.ok){ setMsg('#txMsg','Saved',true); beep(600,120); }
    else setMsg('#txMsg', r.error||'Failed');
    await refresh();
  });

  // Settings save
  $('#saveSettingsBtn').addEventListener('click', async()=>{
    const body = {
      startingMoney: Number($('#setStart').value),
      roundsTotal: Number($('#setRounds').value),
      marketOpenSeconds: Number($('#setMarketOpen').value),
      tradingSeconds: Number($('#setTrading').value)
    };
    const r = await api('/api/admin/settings','POST',body,adminToken);
    if(r.ok){ setMsg('#settingsMsg','Settings saved',true); beep(640,120); }
    else setMsg('#settingsMsg', r.error||'Failed');
    await refresh();
  });

  $('#initGameBtn').addEventListener('click', async()=>{
    const r = await api('/api/admin/initialize','POST',{},adminToken);
    if(r.ok){ setMsg('#settingsMsg','Game initialized',true); beep(500,160); }
    else setMsg('#settingsMsg', r.error||'Failed');
    await refresh();
  });

  $('#resetAllBtn').addEventListener('click', async()=>{
    if (!confirm('Hard Reset will clear market conditions, events, rates, ledger and results, and reset all team balances. Continue?')) return;
    const r = await api('/api/admin/resetAll','POST',{},adminToken);
    if(r.ok){ setMsg('#settingsMsg','Hard reset completed',true); beep(360,180); }
    else setMsg('#settingsMsg', r.error||'Failed');
    await refresh();
  });

  // Market conditions
  $('#addMcBtn').addEventListener('click', async()=>{
    const r = await api('/api/admin/marketCondition/add','POST',{title: $('#mcTitle').value},adminToken);
    if(r.ok){ setMsg('#mcMsg','Market condition added',true); $('#mcTitle').value=''; beep(680,120); }
    else setMsg('#mcMsg', r.error||'Failed');
    await refresh();
  });

  $('#addEventBtn').addEventListener('click', async()=>{
    const body = {
      marketConditionId: $('#mcSelect').value,
      text: $('#evText').value,
      avenueId: $('#evAvenue').value,
      direction: $('#evDir').value,
      rate: Number($('#evRate').value||0)
    };
    const r = await api('/api/admin/event/add','POST',body,adminToken);
    if(r.ok){ setMsg('#mcMsg','Event added',true); $('#evText').value=''; beep(720,120); }
    else setMsg('#mcMsg', r.error||'Failed');
    await refresh();
  });

  // Events tab buttons
  $('#marketScanBtn').addEventListener('click', async()=>{
    // animation
    const wheel = $('#wheelInner');
    wheel.textContent = 'Scanning...';
    $('#wheel').classList.add('spin');
    setTimeout(()=>$('#wheel').classList.remove('spin'), 1700);
    beep(420,180);
    const r = await api('/api/admin/marketScan','POST',{},adminToken);
    if(r.ok){ setMsg('#eventsMsg',`Market condition: ${r.title}`,true); beep(760,140); }
    else setMsg('#eventsMsg', r.error||'Failed');
    await refresh();
  });

  $('#beginSpinBtn').addEventListener('click', async()=>{
    const r = await api('/api/admin/beginSpin','POST',{},adminToken);
    if(r.ok){ setMsg('#eventsMsg','Wheel opened',true); beep(660,120); }
    else setMsg('#eventsMsg', r.error||'Failed');
    await refresh();
  });

  $('#spinBtn').addEventListener('click', async()=>{
    $('#wheel').classList.add('spin');
    setTimeout(()=>$('#wheel').classList.remove('spin'), 1700);
    beep(520,140);
    const r = await api('/api/admin/spin','POST',{},adminToken);
    if(r.ok){
      $('#wheelInner').textContent = `${r.event.direction==='increase'?'+' : '-'}${r.event.rate}%`;
      setMsg('#eventsMsg', `Event: ${r.event.text}`, true);
      beep(880,160);
    } else setMsg('#eventsMsg', r.error||'Failed');
    await refresh();
  });

  $('#openTradingBtn').addEventListener('click', async()=>{
    const r = await api('/api/admin/openTrading','POST',{},adminToken);
    if(r.ok){ setMsg('#eventsMsg','Trading window opened',true); beep(700,160); }
    else setMsg('#eventsMsg', r.error||'Failed');
    await refresh();
  });

  $('#closeTradingBtn').addEventListener('click', async()=>{
    const r = await api('/api/admin/closeTrading','POST',{},adminToken);
    if(r.ok){ setMsg('#eventsMsg','Trading closed',true); beep(240,160); }
    else setMsg('#eventsMsg', r.error||'Failed');
    await refresh();
  });

  $('#endGameBtn').addEventListener('click', async()=>{
    const r = await api('/api/admin/endGame','POST',{},adminToken);
    if(r.ok){ setMsg('#eventsMsg','Game ended. Results ready.',true); beep(980,220); }
    else setMsg('#eventsMsg', r.error||'Failed');
    await refresh();
  });

  // action-specific UI
  $('#txAction').addEventListener('change', ()=>{
    const isT = $('#txAction').value==='transfer';
    $('#txToAvenue').disabled = !isT;
  });
  $('#txToAvenue').disabled = true;
}

async function loop(){
  await refresh();
  setInterval(refresh, 1000);
}

bind();
loop();
