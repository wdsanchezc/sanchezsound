import { db, getCatalog, listRequests } from "./data.js";

const $=s=>document.querySelector(s);
const esc=(s="")=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const art=url=>url?`background-image:url('${String(url).replaceAll("'","%27")}')`:"";
const fmt=v=>{const s=Math.max(0,Math.floor(Number(v)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`};
const ytId=v=>/^[A-Za-z0-9_-]{11}$/.test(String(v||""));

let adminPin="";
let rooms=[];
let activeRoom=null;
let queue=[];
let catalog={genres:[],artists:[],songs:[]};
let roomChannel=null;
let adminOpen=false;
let audioArmed=false;
let player=null;
let playerPromise=null;
let loadedRequestId=null;
let refreshBusy=false;
let browseCache=new Map();

function loadCss(){if(document.querySelector('link[data-ss-v2]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='./experience-v2.css';l.dataset.ssV2='1';document.head.appendChild(l);}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('show'),3000);}
function guestUrl(code){const u=new URL(location.href);u.search="";u.searchParams.set('view','guest');u.searchParams.set('room',code);return u.toString();}
function roomLabel(r){return r?.name||'SanchezSound';}

async function gateway(action,payload={},pinOverride=null){
  if(!db) throw new Error('La base de datos no está conectada.');
  const pin=pinOverride??adminPin;
  const {data,error}=await db.functions.invoke('admin-gateway',{body:{action,pin,...payload}});
  if(error) throw new Error(error.message||'No se pudo conectar con el administrador.');
  if(data?.error) throw new Error(data.error);
  return data;
}

function inject(){
  loadCss();
  const actions=$('.top-actions');
  if(actions&&!$('#ss2AdminEntry')){
    const b=document.createElement('button');b.id='ss2AdminEntry';b.className='ss2-admin-entry';b.innerHTML='<span>⚙</span><strong>Admin</strong>';b.addEventListener('click',openAdmin);actions.prepend(b);
  }
  if($('#ss2PinModal')) return;
  document.body.insertAdjacentHTML('beforeend',`
    <div id="ss2PinModal" class="ss2-modal hidden" aria-hidden="true">
      <div class="ss2-backdrop" data-ss2-close-pin></div>
      <form id="ss2PinForm" class="ss2-pin-card">
        <button type="button" class="ss2-close" data-ss2-close-pin>×</button>
        <span class="eyebrow">ACCESO ADMINISTRADOR</span>
        <h2>Control de la rokola</h2>
        <p>Administra salas, códigos QR, solicitudes y reproducción. El sonido solo se activa en dispositivos con este panel abierto.</p>
        <input id="ss2PinInput" class="ss2-pin-input" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="••••" aria-label="Clave de administrador">
        <button class="primary-btn full" type="submit">Entrar al panel</button>
        <div id="ss2PinStatus" class="status-line"></div>
      </form>
    </div>
    <div id="ss2AdminShell" class="ss2-admin-shell hidden" aria-hidden="true">
      <header class="ss2-admin-top">
        <div class="ss2-admin-brand"><img src="./assets/logo.svg" alt="SanchezSound"><div><span>PANEL PROTEGIDO</span><strong>Administrador</strong></div></div>
        <div class="ss2-admin-top-actions"><button id="ss2NewRoomTop" class="ss2-top-btn">＋ <span>Nueva sala</span></button><button id="ss2CloseAdmin" class="ss2-top-btn">Cerrar</button></div>
      </header>
      <div class="ss2-admin-layout">
        <aside class="ss2-room-sidebar"><div class="ss2-side-head"><h3>Mis salas</h3><button id="ss2NewRoom" class="ss2-add-room" aria-label="Crear sala">＋</button></div><div id="ss2RoomList" class="ss2-room-list"></div></aside>
        <main id="ss2AdminMain" class="ss2-admin-main"></main>
      </div>
    </div>
    <div id="ss2AdminYoutube" style="position:fixed;width:1px;height:1px;left:-4px;bottom:-4px;opacity:.001;pointer-events:none" aria-hidden="true"></div>
  `);
  $('#ss2PinForm').addEventListener('submit',verifyPin);
  document.querySelectorAll('[data-ss2-close-pin]').forEach(x=>x.addEventListener('click',closePin));
  $('#ss2CloseAdmin').addEventListener('click',closeAdmin);
  $('#ss2NewRoom').addEventListener('click',createRoomFlow);
  $('#ss2NewRoomTop').addEventListener('click',createRoomFlow);

  // Replace the legacy room creator/admin links before their own handlers run.
  document.addEventListener('click',e=>{
    const legacyCreate=e.target.closest('#createRoomBtn');
    const legacyAdmin=e.target.closest('#adminLink');
    if(legacyCreate||legacyAdmin){e.preventDefault();e.stopPropagation();openAdmin();}
  },true);

  // Artist/genre cards get a richer 19-hit browse experience.
  document.addEventListener('click',e=>{
    const a=e.target.closest('[data-artist]');
    const g=e.target.closest('[data-genre]');
    if(!a&&!g)return;
    const entity=a?catalog.artists.find(x=>String(x.id)===String(a.dataset.artist)):catalog.genres.find(x=>String(x.id)===String(g.dataset.genre));
    if(!entity)return;
    e.preventDefault();e.stopPropagation();
    browse19(a?'artist':'genre',entity);
  },true);
}

function closePin(){const m=$('#ss2PinModal');m?.classList.add('hidden');m?.setAttribute('aria-hidden','true');}
async function verifyPin(e){e.preventDefault();const input=$('#ss2PinInput');const status=$('#ss2PinStatus');status.textContent='Verificando…';try{const pin=input.value.trim();const data=await gateway('list_rooms',{},pin);adminPin=pin;rooms=data.rooms||[];status.textContent='';closePin();await showAdmin();}catch(err){status.textContent=err.message;input.select();}}
async function openAdmin(){if(adminPin)return showAdmin();const m=$('#ss2PinModal');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');setTimeout(()=>$('#ss2PinInput')?.focus(),60);}
async function showAdmin(){adminOpen=true;const shell=$('#ss2AdminShell');shell.classList.remove('hidden');shell.setAttribute('aria-hidden','false');await reloadRooms();}
function closeAdmin(){adminOpen=false;audioArmed=false;try{player?.pauseVideo?.();}catch{}const shell=$('#ss2AdminShell');shell.classList.add('hidden');shell.setAttribute('aria-hidden','true');}

async function reloadRooms(preferredId=null){
  const data=await gateway('list_rooms');rooms=data.rooms||[];
  const saved=preferredId||localStorage.getItem('ss2_active_room');
  let next=rooms.find(r=>r.id===saved)||rooms.find(r=>r.active)||rooms[0]||null;
  if(activeRoom&&rooms.some(r=>r.id===activeRoom.id)&&!preferredId) next=rooms.find(r=>r.id===activeRoom.id);
  activeRoom=next;
  if(activeRoom)localStorage.setItem('ss2_active_room',activeRoom.id);else localStorage.removeItem('ss2_active_room');
  renderRoomList();
  await subscribeActiveRoom();
  await renderAdminMain();
}

function renderRoomList(){
  const box=$('#ss2RoomList');if(!box)return;
  if(!rooms.length){box.innerHTML='<div class="ss2-side-empty">Todavía no tienes salas. Pulsa <b>＋</b> para crear la primera.</div>';return;}
  box.innerHTML=rooms.map(r=>`<button class="ss2-room-item ${activeRoom?.id===r.id?'active':''}" data-ss2-room="${r.id}"><div><strong>${esc(roomLabel(r))}</strong><span>${esc(r.code)}</span><small>${r.active?'Activa':'Inactiva'} · ${r.playback_enabled?'▶ Reproducción activa':'Ⅱ En pausa'}</small></div><div class="ss2-room-badge">${Number(r.queue_count)||0}</div></button>`).join('');
  box.querySelectorAll('[data-ss2-room]').forEach(b=>b.addEventListener('click',()=>selectRoom(b.dataset.ss2Room)));
}
async function selectRoom(id){if(activeRoom?.id===id)return;audioArmed=false;try{player?.pauseVideo?.();}catch{}activeRoom=rooms.find(r=>r.id===id)||null;if(activeRoom)localStorage.setItem('ss2_active_room',activeRoom.id);renderRoomList();await subscribeActiveRoom();await renderAdminMain();}

async function createRoomFlow(){
  const suggested=`SanchezSound ${rooms.length+1}`;
  const name=prompt('Nombre de la nueva sala:',suggested);if(name===null)return;
  try{const data=await gateway('create_room',{name:name.trim()||suggested});toast(`Sala ${data.room.code} creada.`);await reloadRooms(data.room.id);}catch(err){toast(err.message);}
}
async function deleteActiveRoom(){
  if(!activeRoom)return;
  if(!confirm(`¿Eliminar la sala ${activeRoom.code} (${roomLabel(activeRoom)})?\n\nTambién se eliminarán sus solicitudes e historial.`))return;
  try{audioArmed=false;player?.pauseVideo?.();const id=activeRoom.id;await gateway('delete_room',{room_id:id});activeRoom=null;toast('Sala eliminada.');await reloadRooms();}catch(err){toast(err.message);}
}

async function subscribeActiveRoom(){
  if(roomChannel&&db){try{await db.removeChannel(roomChannel);}catch{}roomChannel=null;}
  if(!activeRoom||!db)return;
  roomChannel=db.channel(`ss2-admin-${activeRoom.id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'requests',filter:`room_id=eq.${activeRoom.id}`},()=>refreshActiveState())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${activeRoom.id}`},payload=>{activeRoom={...activeRoom,...payload.new};refreshActiveState();})
    .subscribe();
}
async function refreshActiveState(){
  if(!activeRoom||refreshBusy)return;refreshBusy=true;
  try{
    queue=await listRequests(activeRoom.id);
    const data=await gateway('list_rooms');rooms=data.rooms||rooms;activeRoom=rooms.find(r=>r.id===activeRoom.id)||activeRoom;renderRoomList();
    if(adminOpen)renderAdminMain(false);
    if(adminOpen&&audioArmed&&activeRoom.playback_enabled)await ensurePlayback(false);
  }catch{}finally{refreshBusy=false;}
}

async function renderAdminMain(load=true){
  const main=$('#ss2AdminMain');if(!main)return;
  if(!activeRoom){
    main.innerHTML='<div class="ss2-admin-empty"><div class="ss2-admin-empty-inner"><div class="ss2-admin-empty-icon">♫</div><span class="eyebrow">COMIENZA AQUÍ</span><h2>Crea tu primera sala</h2><p>Cada sala tiene su propio código y QR. Tus invitados ingresan desde el celular y sus canciones aparecen aquí en tiempo real.</p><button id="ss2EmptyCreate" class="primary-btn">Crear sala</button></div></div>';
    $('#ss2EmptyCreate')?.addEventListener('click',createRoomFlow);return;
  }
  if(load)queue=await listRequests(activeRoom.id);
  const playing=queue.find(r=>r.status==='playing')||null;
  const active=queue.filter(r=>['pending','approved','playing'].includes(r.status)).sort((a,b)=>a.position-b.position);
  const invite=guestUrl(activeRoom.code);
  main.innerHTML=`<div class="ss2-admin-grid">
    <section class="ss2-card ss2-share-card">
      <span class="eyebrow">COMPARTIR SALA</span><h3>${esc(roomLabel(activeRoom))}</h3><div class="ss2-code">${esc(activeRoom.code)}</div>
      <div class="ss2-share-grid"><div id="ss2Qr" class="ss2-qr"></div><div class="ss2-linkbox"><label class="eyebrow">ENLACE PARA INVITADOS</label><input id="ss2InviteLink" readonly value="${esc(invite)}"><div class="ss2-share-actions"><button id="ss2CopyLink" class="primary">Copiar enlace</button><button id="ss2ShareLink">Compartir</button><a href="${esc(invite)}" target="_blank" rel="noopener">Abrir invitado</a></div><p>Las personas escanean el QR o abren este enlace para entrar directamente a esta sala.</p></div></div>
    </section>
    <section class="ss2-card ss2-player-card">
      <div class="section-heading"><div><span class="eyebrow">REPRODUCCIÓN EN ESTE DISPOSITIVO</span><h3>Control de audio</h3></div><span class="ss2-playing-dot ${activeRoom.playback_enabled?'on':''}">${activeRoom.playback_enabled?'Automática activa':'En pausa'}</span></div>
      <div class="ss2-now"><div class="ss2-now-art" style="${art(playing?.thumbnail_url)}">${playing?.thumbnail_url?'':'♪'}</div><div class="ss2-now-copy"><span class="eyebrow">SONANDO AHORA</span><h2>${esc(playing?.title||'Sin canción activa')}</h2><p>${esc(playing?.artist||'Presiona PLAY para comenzar la fila')}</p><span class="ss2-audio-note">🔊 El audio solo sale de dispositivos con Admin abierto y PLAY activado</span></div></div>
      <div class="ss2-transport"><button id="ss2Play" class="play">▶ PLAY</button><button id="ss2Pause" class="pause">Ⅱ PAUSA</button><button id="ss2Next">⏭ SIGUIENTE</button></div>
    </section>
    <section class="ss2-card"><span class="eyebrow">CONFIGURACIÓN</span><h3>Reglas de la sala</h3><div class="ss2-settings"><label>Nombre de la sala<input id="ss2RoomName" type="text" maxlength="60" value="${esc(roomLabel(activeRoom))}"></label><label>Máximo de solicitudes por persona<select id="ss2Max"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option><option value="0">Ilimitadas</option></select></label><label class="ss2-toggle"><span>Aceptar nuevas solicitudes</span><input id="ss2Open" type="checkbox" ${activeRoom.requests_open?'checked':''}></label><label class="ss2-toggle"><span>Aprobación manual</span><input id="ss2Approval" type="checkbox" ${activeRoom.approval_required?'checked':''}></label><label class="ss2-toggle"><span>Bloquear canciones duplicadas</span><input id="ss2Dup" type="checkbox" ${activeRoom.block_duplicates?'checked':''}></label><button id="ss2Save" class="ss2-save">Guardar configuración</button><button id="ss2DeleteRoom" class="ss2-top-btn danger">Eliminar esta sala</button></div></section>
    <section class="ss2-card"><div class="section-heading"><div><span class="eyebrow">FILA EN VIVO</span><h3>${active.length} solicitudes</h3></div></div><div id="ss2Queue" class="ss2-queue">${active.length?active.map(trackRow).join(''):'<div class="ss2-empty-list">Aún no hay canciones en la fila.</div>'}</div></section>
  </div>`;
  const max=$('#ss2Max');if(max)max.value=String(activeRoom.max_requests??0);
  renderQr(invite);
  $('#ss2CopyLink')?.addEventListener('click',copyInvite);
  $('#ss2ShareLink')?.addEventListener('click',shareInvite);
  $('#ss2Play')?.addEventListener('click',play);
  $('#ss2Pause')?.addEventListener('click',pause);
  $('#ss2Next')?.addEventListener('click',skip);
  $('#ss2Save')?.addEventListener('click',saveSettings);
  $('#ss2DeleteRoom')?.addEventListener('click',deleteActiveRoom);
  $('#ss2Queue')?.addEventListener('click',queueAction);
}
function trackRow(r){return `<div class="ss2-track"><div class="ss2-track-art" style="${art(r.thumbnail_url)}">${r.thumbnail_url?'':'♪'}</div><div><strong>${esc(r.title)}</strong><span>${esc(r.artist||'')}</span><small>${esc(r.requester_name||'Invitado')} · ${r.status==='pending'?'Pendiente':r.status==='playing'?'Sonando':'En fila'}</small></div><div class="ss2-track-actions">${r.status==='pending'?`<button data-ss2-action="approve" data-id="${r.id}" title="Aprobar">✓</button>`:''}${r.status!=='playing'?`<button class="remove" data-ss2-action="remove" data-id="${r.id}" title="Quitar">×</button>`:''}</div></div>`;}
function renderQr(link){const q=$('#ss2Qr');if(!q)return;q.innerHTML='';try{if(window.QRCode)new QRCode(q,{text:link,width:170,height:170,correctLevel:QRCode.CorrectLevel.M});else q.textContent='QR no disponible';}catch{q.textContent='QR no disponible';}}
async function copyInvite(){const link=guestUrl(activeRoom.code);try{await navigator.clipboard.writeText(link);toast('Enlace copiado.');}catch{prompt('Copia este enlace:',link);}}
async function shareInvite(){const link=guestUrl(activeRoom.code);try{if(navigator.share)await navigator.share({title:`SanchezSound · ${roomLabel(activeRoom)}`,text:`Entra a la sala ${activeRoom.code} y pide tu canción.`,url:link});else await copyInvite();}catch{}}
async function saveSettings(){try{const patch={name:$('#ss2RoomName').value.trim()||'SanchezSound',max_requests:Number($('#ss2Max').value)||null,requests_open:$('#ss2Open').checked,approval_required:$('#ss2Approval').checked,block_duplicates:$('#ss2Dup').checked};const data=await gateway('update_room',{room_id:activeRoom.id,patch});activeRoom={...activeRoom,...data.room};toast('Configuración guardada.');await reloadRooms(activeRoom.id);}catch(err){toast(err.message);}}
async function queueAction(e){const b=e.target.closest('[data-ss2-action]');if(!b)return;try{await gateway('set_request_status',{request_id:b.dataset.id,status:b.dataset.ss2Action==='approve'?'approved':'rejected'});await refreshActiveState();}catch(err){toast(err.message);}}

/* Admin-only YouTube player */
function waitYT(){if(window.YT?.Player)return Promise.resolve();return new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.YT?.Player){clearInterval(t);resolve();}else if(++n>80){clearInterval(t);reject(new Error('YouTube no respondió.'));}},100);});}
async function resolvePlayable(req){if(ytId(req.provider_track_id))return req;const q=`${req.title} ${req.artist||''} official audio`;const {data,error}=await db.functions.invoke('youtube-search',{body:{q,limit:5}});if(error)throw new Error('No se pudo resolver esta canción en YouTube.');const hit=data?.items?.[0];if(!hit)throw new Error('No encontramos una versión reproducible de esta canción.');const saved=await gateway('resolve_request',{request_id:req.id,track:hit});return saved.request;}
async function ensurePlayer(req,autoplay=true){
  req=await resolvePlayable(req);await waitYT();
  if(!player){
    playerPromise=new Promise(resolve=>{player=new YT.Player('ss2AdminYoutube',{height:'1',width:'1',videoId:req.provider_track_id,playerVars:{autoplay:autoplay?1:0,controls:0,playsinline:1,rel:0},events:{onReady:e=>{loadedRequestId=req.id;if(autoplay)e.target.playVideo();resolve();},onStateChange:onPlayerState,onError:()=>{toast('YouTube no pudo reproducir esta canción. Se saltará.');setTimeout(()=>skip(true),700);}}});});
    await playerPromise;return req;
  }
  if(loadedRequestId!==req.id){player.loadVideoById(req.provider_track_id);loadedRequestId=req.id;}else if(autoplay)player.playVideo();return req;
}
function onPlayerState(e){if(window.YT&&e.data===YT.PlayerState.ENDED)finishAndNext();}
async function setPlaybackFlag(enabled){const data=await gateway('update_room',{room_id:activeRoom.id,patch:{playback_enabled:enabled}});activeRoom={...activeRoom,...data.room};}
async function play(){if(!activeRoom)return;audioArmed=true;try{await setPlaybackFlag(true);await ensurePlayback(true);toast('Reproducción automática activada en este dispositivo.');await renderAdminMain();}catch(err){toast(err.message);}}
async function pause(){if(!activeRoom)return;audioArmed=true;try{await setPlaybackFlag(false);player?.pauseVideo?.();toast('Reproducción pausada.');await renderAdminMain();}catch(err){toast(err.message);}}
async function ensurePlayback(fromGesture=false){
  if(!adminOpen||!audioArmed||!activeRoom?.playback_enabled)return;
  queue=await listRequests(activeRoom.id);
  let current=queue.find(r=>r.status==='playing');
  if(!current){current=queue.filter(r=>r.status==='approved').sort((a,b)=>a.position-b.position)[0];if(!current){if(fromGesture)toast('La fila está vacía.');return;}const d=await gateway('set_request_status',{request_id:current.id,status:'playing'});current=d.request;}
  await ensurePlayer(current,true);
}
async function finishAndNext(){if(!activeRoom)return;try{queue=await listRequests(activeRoom.id);const current=queue.find(r=>r.status==='playing');if(current)await gateway('set_request_status',{request_id:current.id,status:'played'});loadedRequestId=null;await refreshActiveState();if(activeRoom.playback_enabled&&audioArmed)await ensurePlayback(false);}catch(err){toast(err.message);}}
async function skip(silent=false){if(!activeRoom)return;try{player?.stopVideo?.();queue=await listRequests(activeRoom.id);const current=queue.find(r=>r.status==='playing');if(current)await gateway('set_request_status',{request_id:current.id,status:'played'});loadedRequestId=null;await refreshActiveState();if(activeRoom.playback_enabled&&audioArmed)await ensurePlayback(false);if(!silent)toast('Saltando a la siguiente canción.');}catch(err){toast(err.message);}}

/* 19 top tracks by artist or genre */
async function browse19(kind,entity){
  const body=$('#catalogBody');if(!body||!db)return;
  const title=entity.name;const eyebrow=kind==='artist'?'ARTISTA · 19 ÉXITOS':'GÉNERO · 19 ÉXITOS';
  $('#catalogTitle').textContent=title;$('#catalogSubtitle').textContent=kind==='artist'?'Una selección amplia para pedir desde la rokola.':'19 canciones populares del género para explorar y pedir.';$('#catalogEyebrow').textContent=eyebrow;
  body.innerHTML=`<div class="ss2-loading"><div><div class="ss2-spinner"></div><h3>Cargando 19 éxitos de ${esc(title)}…</h3><p>Buscando versiones reproducibles con carátulas.</p></div></div>`;
  const key=`${kind}:${title}`;let remote=browseCache.get(key);
  if(!remote){try{const {data,error}=await db.functions.invoke('jukebox-browse',{body:{kind,q:title,limit:19}});if(error)throw error;remote=data?.items||[];browseCache.set(key,remote);}catch{remote=[];}}
  const local=kind==='artist'?catalog.songs.filter(s=>String(s.artist_id)===String(entity.id)):catalog.songs.filter(s=>String(s.genre_id)===String(entity.id));
  const seen=new Set();const all=[...remote,...local].filter(s=>{const k=s.provider_track_id||s.id;if(!k||seen.has(k))return false;seen.add(k);return true;}).slice(0,19).map(s=>({...s,artist:s.artist||s.artist_name||''}));
  window.__searchTracks=all;
  body.innerHTML=`<div class="ss2-hits-head"><span class="eyebrow">${eyebrow}</span><h3>${esc(title)}</h3><p>${all.length} canciones listas para explorar. Toca una carátula para pedirla.</p></div><div class="ss2-hits-grid">${all.map((s,i)=>`<button class="ss2-hit" data-request-song="${esc(s.id||s.provider_track_id)}"><div class="ss2-hit-art" style="${art(s.thumbnail_url)}"><span class="ss2-rank">${String(i+1).padStart(2,'0')}</span>${s.thumbnail_url?'':'♪'}</div><strong>${esc(s.title)}</strong><small>${esc(s.artist||'')}</small></button>`).join('')}</div>${all.length<19?`<div class="status-line">YouTube devolvió ${all.length} resultados reproducibles para esta selección.</div>`:''}`;
}

async function boot(){
  inject();
  try{catalog=await getCatalog();}catch{}
  // Legacy host/admin URLs are mapped to guest/public by ui.js. Open the protected console instead.
  if(window.__SS_ORIGINAL_VIEW==='admin'||window.__SS_ORIGINAL_VIEW==='host')setTimeout(openAdmin,350);
}
boot();
