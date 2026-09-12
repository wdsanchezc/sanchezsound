import { db, createRoom, getCatalog, listRequests } from "./data.js";

const PIN_HASH = "6a08be905c07ded3713160b34dd175d9f8c74ae09321b2187066026818717e7e";
const params = new URLSearchParams(location.search);
const roomCode = (params.get("room") || "").toUpperCase();
const view = params.get("view") || "home";
const tokenKey = code => `ss_admin_token_${code}`;
const cacheKey = (kind,name) => `ss_19_${kind}_${name.toLowerCase().replace(/\W+/g,"-")}`;
let activeRoom = null;
let playbackEnabled = false;
let catalog = {genres:[],artists:[],songs:[]};
let playbackInterval = null;
let roomChannel = null;

function css(){
  if(document.querySelector('link[href$="control.css"]')) return;
  const l=document.createElement('link');l.rel='stylesheet';l.href='./control.css';document.head.appendChild(l);
}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function fmt(v){const s=Math.max(0,Math.floor(Number(v)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function art(url){return url?`background-image:url('${String(url).replaceAll("'","%27")}')`:'';}
async function sha(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function toast(msg){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._c);t._c=setTimeout(()=>t.classList.remove('show'),2600);}
function adminToken(){return roomCode?localStorage.getItem(tokenKey(roomCode))||'':'';}
function unlocked(){return sessionStorage.getItem('ss_admin_pin_ok')==='1';}

function injectAdminUI(){
  const actions=document.querySelector('.top-actions');
  if(actions&&!document.getElementById('ssAdminEntry')){
    const b=document.createElement('button');b.id='ssAdminEntry';b.className='ss-admin-entry';b.innerHTML='<span>⚙</span><strong>Admin</strong>';b.addEventListener('click',openAdmin);actions.prepend(b);
  }
  if(!document.getElementById('ssPinModal')) document.body.insertAdjacentHTML('beforeend',`
    <div id="ssPinModal" class="ss-modal hidden">
      <div class="ss-modal-backdrop" data-ss-close="pin"></div>
      <form id="ssPinForm" class="ss-pin-card">
        <button type="button" class="ss-x" data-ss-close="pin">×</button>
        <span class="eyebrow">ACCESO PROTEGIDO</span><h2>Administrador</h2><p>Ingresa la clave para abrir controles, salas y reproducción.</p>
        <input id="ssPinInput" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
        <button class="primary-btn full" type="submit">Entrar</button><div id="ssPinStatus" class="status-line"></div>
      </form>
    </div>
    <div id="ssAdminPanel" class="ss-admin-panel hidden" aria-hidden="true">
      <div class="ss-admin-head"><div><span class="eyebrow">SANCHEZSOUND</span><h2>Centro administrador</h2></div><button class="ss-x" id="ssAdminClose">×</button></div>
      <div id="ssAdminBody" class="ss-admin-body"></div>
    </div>`);
  document.getElementById('ssPinForm')?.addEventListener('submit',verifyPin);
  document.querySelectorAll('[data-ss-close="pin"]').forEach(x=>x.addEventListener('click',()=>document.getElementById('ssPinModal')?.classList.add('hidden')));
  document.getElementById('ssAdminClose')?.addEventListener('click',()=>document.getElementById('ssAdminPanel')?.classList.add('hidden'));
}
async function verifyPin(e){e.preventDefault();const input=document.getElementById('ssPinInput');const status=document.getElementById('ssPinStatus');const ok=(await sha(input.value.trim()))===PIN_HASH;if(!ok){status.textContent='Clave incorrecta.';input.select();return;}sessionStorage.setItem('ss_admin_pin_ok','1');document.getElementById('ssPinModal').classList.add('hidden');await showAdminPanel();}
async function openAdmin(){if(unlocked())return showAdminPanel();document.getElementById('ssPinModal').classList.remove('hidden');setTimeout(()=>document.getElementById('ssPinInput')?.focus(),50);}

async function loadRoom(){if(!db||!roomCode)return null;const {data,error}=await db.from('rooms').select('*').eq('code',roomCode).maybeSingle();if(error)throw error;activeRoom=data;playbackEnabled=!!data?.playback_enabled;return data;}
async function showAdminPanel(){const p=document.getElementById('ssAdminPanel');p.classList.remove('hidden');p.setAttribute('aria-hidden','false');await renderAdmin();}
async function renderAdmin(){const body=document.getElementById('ssAdminBody');if(!body)return;if(!roomCode){body.innerHTML=`<section class="ss-admin-block ss-create-block"><span class="eyebrow">SALAS</span><h3>Crear una nueva rokola</h3><p>Crea la sala, muestra el QR y deja que los invitados pidan música desde sus celulares.</p><button id="ssCreateRoom" class="primary-btn full">Crear sala</button></section>`;document.getElementById('ssCreateRoom').onclick=async()=>{const b=document.getElementById('ssCreateRoom');b.disabled=true;b.textContent='Creando…';try{const r=await createRoom();location.href=`./?view=host&room=${encodeURIComponent(r.code)}`;}catch(e){toast(e.message);b.disabled=false;b.textContent='Crear sala';}};return;}
  try{await loadRoom();}catch(e){body.innerHTML=`<div class="status-line">${esc(e.message)}</div>`;return;}
  const tok=adminToken();const rows=activeRoom?await listRequests(activeRoom.id):[];const q=rows.filter(r=>['pending','approved','playing'].includes(r.status)).sort((a,b)=>a.position-b.position);
  body.innerHTML=`
    <section class="ss-admin-block ss-room-summary"><div><span class="eyebrow">SALA ACTIVA</span><div class="ss-code">${esc(roomCode)}</div><p>${esc(activeRoom?.name||'SanchezSound')}</p></div><div class="ss-live-dot ${playbackEnabled?'on':''}"><span></span>${playbackEnabled?'Reproduciendo':'En pausa'}</div></section>
    ${!tok?'<div class="ss-warning">Esta sala no fue creada en este navegador. La clave 2683 abre el panel, pero los cambios sensibles siguen protegidos por la credencial de la sala.</div>':''}
    <section class="ss-admin-block"><span class="eyebrow">REPRODUCCIÓN</span><h3>Control principal</h3><div class="ss-transport"><button id="ssPlay" class="ss-play-big" ${tok?'':'disabled'}>▶<small>PLAY</small></button><button id="ssPause" class="ss-play-big" ${tok?'':'disabled'}>Ⅱ<small>PAUSA</small></button><button id="ssNext" class="ss-play-big secondary" ${tok?'':'disabled'}>⏭<small>SIGUIENTE</small></button></div><p class="ss-help">PLAY activa la reproducción automática de la fila. PAUSA mantiene la canción actual detenida.</p></section>
    <section class="ss-admin-block"><span class="eyebrow">CONFIGURACIÓN</span><h3>Reglas de la sala</h3><label>Nombre<input id="ssRoomName" value="${esc(activeRoom?.name||'')}"></label><label>Máximo de solicitudes<select id="ssMax"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option><option value="0">Ilimitadas</option></select></label><label class="ss-switch"><span>Aceptar solicitudes</span><input id="ssOpen" type="checkbox" ${activeRoom?.requests_open?'checked':''}></label><label class="ss-switch"><span>Aprobación manual</span><input id="ssApproval" type="checkbox" ${activeRoom?.approval_required?'checked':''}></label><label class="ss-switch"><span>Bloquear duplicados</span><input id="ssDup" type="checkbox" ${activeRoom?.block_duplicates?'checked':''}></label><button id="ssSaveCfg" class="primary-btn full" ${tok?'':'disabled'}>Guardar configuración</button></section>
    <section class="ss-admin-block"><div class="section-heading"><div><span class="eyebrow">FILA</span><h3>${q.length} solicitudes activas</h3></div></div><div id="ssAdminQueue">${q.length?q.map(r=>`<div class="ss-admin-track"><div class="ss-track-art" style="${art(r.thumbnail_url)}">${r.thumbnail_url?'':'♪'}</div><div><strong>${esc(r.title)}</strong><span>${esc(r.artist||'')}</span><small>${esc(r.requester_name||'Invitado')} · ${esc(r.status)}</small></div><div class="ss-track-actions">${r.status==='pending'?`<button data-ss-action="approve" data-id="${r.id}">✓</button>`:''}<button data-ss-action="remove" data-id="${r.id}">×</button></div></div>`).join(''):'<p class="ss-help">La fila está vacía.</p>'}</div></section>`;
  const max=document.getElementById('ssMax');if(max)max.value=String(activeRoom?.max_requests??0);
  document.getElementById('ssPlay')?.addEventListener('click',()=>setPlayback(true));
  document.getElementById('ssPause')?.addEventListener('click',()=>setPlayback(false));
  document.getElementById('ssNext')?.addEventListener('click',()=>document.getElementById('skipBtn')?.click());
  document.getElementById('ssSaveCfg')?.addEventListener('click',saveConfig);
  document.getElementById('ssAdminQueue')?.addEventListener('click',queueAction);
}
async function saveConfig(){const tok=adminToken();if(!tok)return;const patch={name:document.getElementById('ssRoomName').value.trim()||'SanchezSound',requests_open:document.getElementById('ssOpen').checked,approval_required:document.getElementById('ssApproval').checked,block_duplicates:document.getElementById('ssDup').checked,max_requests:Number(document.getElementById('ssMax').value)||null};const {error}=await db.rpc('admin_update_room',{p_room_code:roomCode,p_admin_token:tok,p_patch:patch});if(error)return toast(error.message);toast('Configuración guardada.');await loadRoom();}
async function setPlayback(enabled){const tok=adminToken();if(!tok)return toast('Este dispositivo no tiene la credencial de la sala.');playbackEnabled=enabled;syncPlayer(enabled);const {error}=await db.rpc('admin_set_playback',{p_room_code:roomCode,p_admin_token:tok,p_enabled:enabled});if(error){playbackEnabled=!enabled;syncPlayer(!enabled);return toast(error.message);}toast(enabled?'Reproducción automática activada.':'Reproducción en pausa.');await renderAdmin();}
function syncPlayer(enabled){const b=document.getElementById('playPauseBtn');if(!b)return;const t=b.textContent.trim();if(enabled&&t.includes('▶'))b.click();if(!enabled&&!t.includes('▶'))b.click();}
async function queueAction(e){const b=e.target.closest('[data-ss-action]');if(!b)return;const tok=adminToken();if(!tok)return;const status=b.dataset.ssAction==='approve'?'approved':'rejected';const {error}=await db.rpc('admin_update_request',{p_room_code:roomCode,p_admin_token:tok,p_request_id:b.dataset.id,p_status:status});if(error)return toast(error.message);await renderAdmin();}

async function setupPlaybackGate(){if(!db||!roomCode||view!=='host')return;try{await loadRoom();}catch{return;}playbackInterval=setInterval(()=>syncPlayer(playbackEnabled),450);roomChannel=db.channel(`ss-control-${roomCode}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`code=eq.${roomCode}`},payload=>{if(typeof payload.new?.playback_enabled==='boolean')playbackEnabled=payload.new.playback_enabled;}).subscribe();}

function injectHostStage(){if(view!=='host'||document.getElementById('ssHostStage'))return;const host=document.getElementById('hostView');const header=host?.querySelector('.host-header');if(!host||!header)return;header.insertAdjacentHTML('afterend',`<section id="ssHostStage" class="ss-host-stage"><div class="ss-now-large"><div id="ssMirrorArt" class="ss-now-art">♪</div><div class="ss-now-copy"><span class="eyebrow">SONANDO AHORA</span><h2 id="ssMirrorTitle">Esperando canciones</h2><p id="ssMirrorArtist">Escanea el QR y pide tu canción</p><div class="ss-eq"><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div><div class="ss-upnext"><div class="section-heading"><div><span class="eyebrow">PRÓXIMAS</span><h3>Fila en vivo</h3></div><button class="ss-admin-mini" id="ssStageAdmin">⚙ Admin</button></div><div id="ssStageQueue" class="ss-stage-queue"></div></div></section>`);document.getElementById('ssStageAdmin').onclick=openAdmin;setInterval(refreshHostMirror,1200);refreshHostMirror();}
async function refreshHostMirror(){if(!activeRoom&&roomCode)try{await loadRoom();}catch{}const title=document.getElementById('nowTitle')?.textContent||'Esperando canciones';const artist=document.getElementById('nowArtist')?.textContent||'';const src=document.getElementById('nowCover')?.style.backgroundImage||'';const a=document.getElementById('ssMirrorArt');if(a){a.style.backgroundImage=src;a.textContent=src?'':'♪';}const t=document.getElementById('ssMirrorTitle');if(t)t.textContent=title;const ar=document.getElementById('ssMirrorArtist');if(ar)ar.textContent=artist;if(activeRoom){const rows=await listRequests(activeRoom.id);const q=rows.filter(r=>r.status==='approved').slice(0,5);const box=document.getElementById('ssStageQueue');if(box)box.innerHTML=q.length?q.map((r,i)=>`<div><b>${i+1}</b><span><strong>${esc(r.title)}</strong><small>${esc(r.artist||'')}</small></span></div>`).join(''):'<p>La fila está vacía.</p>';}}

function cacheRead(key){try{const v=JSON.parse(localStorage.getItem(key));if(v&&Date.now()-v.time<86400000)return v.items;}catch{}return null;}
function cacheWrite(key,items){try{localStorage.setItem(key,JSON.stringify({time:Date.now(),items}));}catch{}}
async function browse19(kind,name,id){const body=document.getElementById('catalogBody');if(!body||!db)return;body.innerHTML=`<div class="ss-19-loading"><span></span><h3>Cargando 19 éxitos de ${esc(name)}…</h3></div>`;let local=kind==='artist'?catalog.songs.filter(s=>String(s.artist_id)===String(id)):catalog.songs.filter(s=>String(s.genre_id)===String(id));let remote=cacheRead(cacheKey(kind,name));if(!remote){try{const {data,error}=await db.functions.invoke('jukebox-browse',{body:{kind,q:name,limit:19}});if(error)throw error;remote=data?.items||[];cacheWrite(cacheKey(kind,name),remote);}catch(e){remote=[];}}const seen=new Set();const all=[...local,...remote].filter(s=>{const k=s.provider_track_id||s.id;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,19);window.__searchTracks=all;body.innerHTML=`<div class="ss-19-head"><span class="eyebrow">19 ÉXITOS</span><h3>${esc(name)}</h3><p>Selecciona una carátula para pedir la canción.</p></div><div class="ss-19-grid">${all.map((s,i)=>`<button class="ss-hit-card" data-request-song="${esc(s.id||s.provider_track_id)}"><div class="ss-hit-art" style="${art(s.thumbnail_url)}"><span>${String(i+1).padStart(2,'0')}</span>${s.thumbnail_url?'':'♪'}</div><strong>${esc(s.title)}</strong><small>${esc(s.artist||s.artist_name||'')}</small><em>${fmt(s.duration_seconds)}</em></button>`).join('')}</div>${all.length<19?`<div class="status-line">Se encontraron ${all.length} resultados reproducibles.</div>`:''}`;}
function setupNineteen(){document.addEventListener('click',e=>{const a=e.target.closest('[data-artist]');if(a){const name=a.querySelector('strong')?.textContent?.trim();if(name)setTimeout(()=>browse19('artist',name,a.dataset.artist),40);return;}const g=e.target.closest('[data-genre]');if(g){const name=g.querySelector('strong')?.textContent?.trim();if(name)setTimeout(()=>browse19('genre',name,g.dataset.genre),40);}},false);}

function upgradeRoomLanding(){const first=document.querySelector('#roomView .room-choice article:first-child');if(!first)return;first.innerHTML=`<span class="eyebrow">ADMINISTRADOR</span><h2>Panel protegido</h2><p>Crea salas, genera códigos QR y controla la reproducción con la clave de administrador.</p><button id="ssLandingAdmin" class="primary-btn full">Abrir Admin</button>`;document.getElementById('ssLandingAdmin').onclick=openAdmin;}

async function init(){css();injectAdminUI();upgradeRoomLanding();setupNineteen();try{catalog=await getCatalog();}catch{}injectHostStage();await setupPlaybackGate();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.addEventListener('beforeunload',()=>{if(playbackInterval)clearInterval(playbackInterval);if(roomChannel&&db)db.removeChannel(roomChannel);});