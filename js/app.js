import { isConfigured, ensureAuth, getCatalog, searchCatalog, searchYouTube, createRoom, getRoomByCode, getRoomById, updateRoom, listRequests, addRequest, updateRequest, bumpPlayCount, subscribeRoom } from "./data.js";

const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
const views=["homeView","catalogView","searchView","queueView","roomView","hostView","adminView"];
let userId=null,room=null,role="browser",catalog={genres:[],artists:[],songs:[]},selectedTrack=null,unsubscribe=null,ytPlayer=null,currentPlayingId=null,progressTimer=null;

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function fmt(v){let s=Math.max(0,Math.floor(Number(v)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function show(id){views.forEach(v=>document.getElementById(v).classList.toggle("hidden",v!==id));window.scrollTo({top:0,behavior:"smooth"});}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),2600);}
function params(){return new URLSearchParams(location.search);}
function routeUrl(view,code){const u=new URL(location.href);u.search="";if(view)u.searchParams.set("view",view);if(code)u.searchParams.set("room",code);return u.toString();}
function inviteUrl(code){return routeUrl("guest",code);}
function setMode(){const b=$("#modeBadge");b.textContent=isConfigured?"Tiempo real":"Demo local";b.style.color=isConfigured?"#a7f0c0":"#ffd58a";}
function roomChip(){const chip=$("#homeRoomChip");if(room){chip.textContent=`SALA ${room.code}`;chip.classList.remove("hidden");}else chip.classList.add("hidden");}
function artStyle(url){return url?`background-image:url('${String(url).replaceAll("'","%27")}')`:"";}

function coverCard(s){return `<button class="cover-card" data-song-id="${esc(s.id||s.provider_track_id)}"><div class="cover-art" style="${artStyle(s.thumbnail_url)}">${s.thumbnail_url?"":"♪"}</div><strong>${esc(s.title)}</strong><span>${esc(s.artist||"")}</span></button>`;}
function songRow(s){return `<div class="song-row"><div class="song-thumb" style="${artStyle(s.thumbnail_url)}">${s.thumbnail_url?"":"♪"}</div><div class="song-meta"><strong>${esc(s.title)}</strong><span>${esc(s.artist||"")}${s.duration_seconds?` • ${fmt(s.duration_seconds)}`:""}</span></div><button class="primary-btn" data-request-song="${esc(s.id||s.provider_track_id)}">Pedir canción</button></div>`;}
function queueRow(r,i,admin=false){const tag=r.status==="pending"?'<span class="queue-tag pending">PENDIENTE</span>':r.status==="playing"?'<span class="queue-tag playing">SONANDO</span>':"";const tail=admin?`<div class="admin-actions">${r.status==="pending"?`<button class="tiny-btn" data-admin-action="approve" data-id="${r.id}">Aprobar</button>`:""}${["pending","approved"].includes(r.status)?`<button class="tiny-btn danger" data-admin-action="reject" data-id="${r.id}">Quitar</button>`:""}</div>`:`<div class="queue-pos">#${i+1}</div>`;return `<div class="queue-row"><div class="queue-thumb" style="${artStyle(r.thumbnail_url)}">${r.thumbnail_url?"":"♪"}</div><div class="song-meta"><strong>${esc(r.title)}</strong><span>${esc(r.artist||"")}</span><span>Pidió: ${esc(r.requester_name||"Invitado")}</span>${tag}</div>${tail}</div>`;}
function resolveTrack(key){return catalog.songs.find(s=>String(s.id)===String(key)||s.provider_track_id===key)||window.__searchTracks?.find(s=>String(s.id||s.provider_track_id)===String(key));}

async function boot(){
  setMode();wireGlobal();
  try{userId=await ensureAuth();catalog=await getCatalog();}catch(e){toast(`Error de inicio: ${e.message}`);return;}
  renderFeatured();
  const view=params().get("view")||"home",code=(params().get("room")||"").toUpperCase();
  if(code){try{room=await getRoomByCode(code);}catch(e){toast(e.message);}if(!room){toast("La sala no existe o ya fue cerrada.");}}
  roomChip();
  if(view==="room"){show("roomView");return;}
  if(view==="host"&&room){role=room.owner_id===userId?"host":"guest";if(role!=="host"){toast("Este dispositivo no es el administrador; entrarás como invitado.");show("homeView");startRoomSubscription();return;}await initHost();return;}
  if(view==="admin"&&room){if(room.owner_id!==userId){toast("No tienes permisos de administrador.");show("homeView");return;}role="host";await initAdmin();return;}
  if(view==="guest"&&room){role="guest";show("homeView");startRoomSubscription();await refreshQueue();return;}
  show("homeView");
}

function wireGlobal(){
  document.addEventListener("click",e=>{
    const nav=e.target.closest("[data-nav]");if(nav){e.preventDefault();navigate(nav.dataset.nav);return;}
    const cover=e.target.closest("[data-song-id]");if(cover){openRequest(resolveTrack(cover.dataset.songId));return;}
    const req=e.target.closest("[data-request-song]");if(req){openRequest(resolveTrack(req.dataset.requestSong));return;}
    if(e.target.closest("[data-close-drawer]")){closeDrawer();}
  });
  $("#openSearchBtn").addEventListener("click",()=>navigate("search"));$("#heroSearchBtn").addEventListener("click",()=>navigate("search"));
  $("#searchForm").addEventListener("submit",handleSearch);$("#confirmRequestBtn").addEventListener("click",confirmRequest);
  $("#createRoomBtn").addEventListener("click",handleCreateRoom);$("#joinRoomForm").addEventListener("submit",handleJoinRoom);
  $("#copyInviteBtn").addEventListener("click",copyInvite);$("#playPauseBtn").addEventListener("click",togglePlay);$("#skipBtn").addEventListener("click",skipCurrent);
  $("#saveSettingsBtn").addEventListener("click",saveSettings);$("#adminQueue").addEventListener("click",handleAdminAction);
}

function navigate(target){
  if(target==="home"){show("homeView");renderFeatured();return;}
  if(target==="search"){show("searchView");setTimeout(()=>$("#searchInput").focus(),50);return;}
  if(target==="queue"){show("queueView");refreshQueue();return;}
  if(target==="artists"){renderArtists();return;}
  if(target==="genres"){renderGenres();return;}
  if(target==="honduras"){renderSongCatalog("Top Honduras","Selección destacada para la rokola",catalog.songs.filter(s=>s.is_honduras_hit),"🇭🇳 DESTACADOS");return;}
  if(target==="popular"){renderSongCatalog("Más pedidas","Canciones populares dentro de SanchezSound",[...catalog.songs].sort((a,b)=>(b.play_count||0)-(a.play_count||0)),"POPULAR");}
}

function renderFeatured(){const songs=catalog.songs.filter(s=>s.is_featured).slice(0,5);$("#featuredSongs").innerHTML=(songs.length?songs:catalog.songs.slice(0,5)).map(coverCard).join("")||'<div class="status-line">El catálogo está vacío.</div>';}
function setupCatalog(title,subtitle,eyebrow="CATÁLOGO"){$("#catalogTitle").textContent=title;$("#catalogSubtitle").textContent=subtitle;$("#catalogEyebrow").textContent=eyebrow;show("catalogView");}
function renderArtists(){setupCatalog("Artistas","Selecciona un artista para ver sus canciones.","ARTISTAS");$("#catalogBody").innerHTML=`<div class="entity-grid">${catalog.artists.map(a=>`<button class="entity-card" data-artist="${esc(a.id)}"><div class="entity-image" style="${artStyle(a.image_url)}">${a.image_url?"":esc(a.name.slice(0,2).toUpperCase())}</div><strong>${esc(a.name)}</strong><small>${catalog.songs.filter(s=>s.artist_id===a.id).length} canciones</small></button>`).join("")}</div>`;$$('[data-artist]').forEach(b=>b.addEventListener("click",()=>{const a=catalog.artists.find(x=>String(x.id)===b.dataset.artist);renderSongCatalog(a.name,"Canciones disponibles de este artista",catalog.songs.filter(s=>String(s.artist_id)===String(a.id)),"ARTISTA");}));}
function renderGenres(){setupCatalog("Géneros","Elige un estilo y explora el catálogo.","GÉNEROS");$("#catalogBody").innerHTML=`<div class="entity-grid">${catalog.genres.map(g=>`<button class="entity-card" data-genre="${esc(g.id)}"><div class="entity-image">${esc(g.icon||"♫")}</div><strong>${esc(g.name)}</strong><small>${catalog.songs.filter(s=>String(s.genre_id)===String(g.id)).length} canciones</small></button>`).join("")}</div>`;$$('[data-genre]').forEach(b=>b.addEventListener("click",()=>{const g=catalog.genres.find(x=>String(x.id)===b.dataset.genre);renderSongCatalog(g.name,"Canciones de este género",catalog.songs.filter(s=>String(s.genre_id)===String(g.id)),"GÉNERO");}));}
function renderSongCatalog(title,subtitle,songs,eyebrow){setupCatalog(title,subtitle,eyebrow);$("#catalogBody").innerHTML=`<div class="song-list">${songs.length?songs.map(songRow).join(""):'<div class="status-line">No hay canciones en esta sección todavía.</div>'}</div>`;}

async function handleSearch(e){
  e.preventDefault();const q=$("#searchInput").value.trim();if(!q)return;$("#searchStatus").textContent="Buscando en SanchezSound…";$("#searchResults").innerHTML="";
  try{
    const local=await searchCatalog(q);let results=[...local];
    if(isConfigured){$("#searchStatus").textContent=local.length?"Resultados del catálogo + búsqueda externa…":"Buscando en YouTube…";try{const ext=await searchYouTube(q);const seen=new Set(results.map(x=>x.provider_track_id));ext.forEach(x=>{if(!seen.has(x.provider_track_id))results.push({...x,id:`yt-${x.provider_track_id}`});});}catch(err){if(!local.length)throw err;}}
    window.__searchTracks=results;$("#searchStatus").textContent=results.length?`${results.length} resultados`:`No encontramos resultados para “${q}”.`;$("#searchResults").innerHTML=results.map(songRow).join("");
  }catch(err){$("#searchStatus").textContent="";toast(err.message);}
}

function openRequest(track){
  if(!track)return;if(!room){toast("Primero crea una sala o entra con el código de una rokola.");show("roomView");return;}
  selectedTrack=track;$("#drawerCover").style.backgroundImage=track.thumbnail_url?`url('${track.thumbnail_url}')`:"";$("#drawerTitle").textContent=track.title;$("#drawerArtist").textContent=track.artist||"";$("#requesterName").value=localStorage.getItem("ss_requester_name")||"";$("#drawerStatus").textContent="";$("#requestDrawer").classList.remove("hidden");$("#requestDrawer").setAttribute("aria-hidden","false");
}
function closeDrawer(){$("#requestDrawer").classList.add("hidden");$("#requestDrawer").setAttribute("aria-hidden","true");selectedTrack=null;}
async function confirmRequest(){
  if(!selectedTrack||!room)return;const btn=$("#confirmRequestBtn");btn.disabled=true;btn.textContent="Agregando…";const name=$("#requesterName").value.trim();localStorage.setItem("ss_requester_name",name);
  try{room=await getRoomById(room.id);const row=await addRequest(room,userId,name,selectedTrack);$("#drawerStatus").textContent=row.status==="pending"?"Solicitud enviada para aprobación.":"🎵 Tu canción fue agregada a la fila.";toast("🎵 Canción agregada");setTimeout(closeDrawer,900);await refreshQueue();}catch(err){$("#drawerStatus").textContent=err.message;toast(err.message);}finally{btn.disabled=false;btn.textContent="Agregar a la fila";}
}

async function handleCreateRoom(){const btn=$("#createRoomBtn");btn.disabled=true;btn.textContent="Creando…";try{const r=await createRoom(userId);location.href=routeUrl("host",r.code);}catch(e){toast(e.message);btn.disabled=false;btn.textContent="Crear sala";}}
async function handleJoinRoom(e){e.preventDefault();const code=$("#roomCodeInput").value.trim().toUpperCase();if(code.length!==6)return toast("Escribe el código de 6 caracteres.");try{const r=await getRoomByCode(code);if(!r)return toast("No encontramos esa sala.");location.href=routeUrl("guest",code);}catch(err){toast(err.message);}}

async function initHost(){
  show("hostView");$("#hostRoomName").textContent=room.name;$("#hostRoomCode").textContent=room.code;$("#adminLink").href=routeUrl("admin",room.code);const qr=$("#qrCode");qr.innerHTML="";if(window.QRCode)new QRCode(qr,{text:inviteUrl(room.code),width:180,height:180});startRoomSubscription();await refreshQueue();startProgressLoop();
}
function startRoomSubscription(){unsubscribe?.();if(room)unsubscribe=subscribeRoom(room.id,async()=>{try{room=await getRoomById(room.id);roomChip();await refreshQueue();if(role==="host"&&$("#adminView").classList.contains("hidden")===false)await refreshAdmin();}catch{}});}
async function copyInvite(){const url=inviteUrl(room.code);try{await navigator.clipboard.writeText(url);toast("Enlace copiado.");}catch{prompt("Copia este enlace:",url);}}

async function refreshQueue(){
  if(!room){$("#queueList").innerHTML="No hay una sala activa.";return;}
  const rows=await listRequests(room.id),playing=rows.find(r=>r.status==="playing")||null,queued=rows.filter(r=>r.status==="approved").sort((a,b)=>a.position-b.position),pending=rows.filter(r=>r.status==="pending").sort((a,b)=>a.position-b.position);
  const visible=[...queued,...pending];$("#queueCount").textContent=visible.length;$("#queueList").innerHTML=visible.length?visible.map((r,i)=>queueRow(r,i)).join(""):"No hay canciones en la fila.";$("#queueList").classList.toggle("empty",!visible.length);paintNow(playing);$("#hostControls").classList.toggle("hidden",role!=="host");
  if(role==="host"){if(playing){if(currentPlayingId!==playing.id)loadVideo(playing);}else{currentPlayingId=null;if(queued.length)await beginTrack(queued[0]);}}
  if(role==="guest"){
    const mine=visible.find(r=>r.requester_user_id===userId);if(mine){const p=visible.findIndex(r=>r.id===mine.id)+1;$("#queueList").insertAdjacentHTML("afterbegin",`<div class="status-line">${mine.status==="pending"?"Tu solicitud espera aprobación.":`Tu próxima canción está #${p} en la fila.`}</div>`);}
  }
}
function paintNow(t){$("#nowTitle").textContent=t?.title||"Nada reproduciéndose";$("#nowArtist").textContent=t?.artist||"Agrega una canción para comenzar.";$("#durationTime").textContent=fmt(t?.duration_seconds||0);const c=$("#nowCover");c.style.backgroundImage=t?.thumbnail_url?`url('${t.thumbnail_url}')`:"";c.textContent=t?.thumbnail_url?"":"♪";}
async function beginTrack(t){await updateRequest(t.id,{status:"playing"});await updateRoom(room.id,{currently_playing_request_id:t.id});}
async function finishTrack(){if(!currentPlayingId)return;const id=currentPlayingId;const rows=await listRequests(room.id);const t=rows.find(r=>r.id===id);currentPlayingId=null;await updateRequest(id,{status:"played"});await updateRoom(room.id,{currently_playing_request_id:null});if(t?.provider_track_id)await bumpPlayCount(t.provider_track_id);await refreshQueue();}
function loadVideo(t){currentPlayingId=t.id;const create=()=>{if(ytPlayer?.loadVideoById){ytPlayer.loadVideoById(t.provider_track_id);return;}ytPlayer=new YT.Player("youtubePlayer",{height:"1",width:"1",videoId:t.provider_track_id,playerVars:{autoplay:1,controls:0,playsinline:1,rel:0},events:{onReady:e=>e.target.playVideo(),onStateChange:e=>{if(e.data===YT.PlayerState.ENDED)finishTrack();$("#playPauseBtn").textContent=e.data===YT.PlayerState.PLAYING?"Ⅱ":"▶";},onError:()=>{toast("Este video no permite reproducción aquí; se omitirá.");setTimeout(finishTrack,600);}}});};if(window.YT?.Player)create();else{const tmr=setInterval(()=>{if(window.YT?.Player){clearInterval(tmr);create();}},200);}}
function togglePlay(){if(!ytPlayer?.getPlayerState)return toast("El reproductor aún no está listo.");if(ytPlayer.getPlayerState()===1)ytPlayer.pauseVideo();else ytPlayer.playVideo();}
async function skipCurrent(){if(!currentPlayingId)return toast("No hay canción sonando.");try{ytPlayer?.stopVideo?.();await finishTrack();}catch(e){toast(e.message);}}
function startProgressLoop(){clearInterval(progressTimer);progressTimer=setInterval(()=>{if(!ytPlayer?.getCurrentTime)return;const c=Number(ytPlayer.getCurrentTime()||0),d=Number(ytPlayer.getDuration()||0);$("#elapsedTime").textContent=fmt(c);$("#durationTime").textContent=fmt(d);$("#playerProgress").style.width=d?`${Math.min(100,c/d*100)}%`:"0%";},700);}

async function initAdmin(){show("adminView");$("#backToHostLink").href=routeUrl("host",room.code);fillSettings();$("#hostRoomName").textContent=room.name;startRoomSubscription();await refreshAdmin();}
function fillSettings(){$("#roomNameSetting").value=room.name;$("#maxRequestsSetting").value=String(room.max_requests||0);$("#approvalSetting").checked=!!room.approval_required;$("#duplicateSetting").checked=!!room.block_duplicates;$("#requestsOpenSetting").checked=!!room.requests_open;}
async function saveSettings(){try{room=await updateRoom(room.id,{name:$("#roomNameSetting").value.trim()||"SanchezSound Party",max_requests:Number($("#maxRequestsSetting").value)||null,approval_required:$("#approvalSetting").checked,block_duplicates:$("#duplicateSetting").checked,requests_open:$("#requestsOpenSetting").checked});toast("Configuración guardada.");}catch(e){toast(e.message);}}
async function refreshAdmin(){const rows=await listRequests(room.id),active=rows.filter(r=>["pending","approved","playing"].includes(r.status)).sort((a,b)=>a.position-b.position),history=rows.filter(r=>r.status==="played").sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);$("#adminQueue").innerHTML=active.length?active.map((r,i)=>queueRow(r,i,true)).join(""):"No hay solicitudes.";$("#adminQueue").classList.toggle("empty",!active.length);$("#historyList").innerHTML=history.length?history.map((r,i)=>queueRow(r,i)).join(""):"Todavía no hay historial.";$("#historyList").classList.toggle("empty",!history.length);}
async function handleAdminAction(e){const b=e.target.closest("[data-admin-action]");if(!b)return;try{if(b.dataset.adminAction==="approve")await updateRequest(b.dataset.id,{status:"approved"});if(b.dataset.adminAction==="reject")await updateRequest(b.dataset.id,{status:"rejected"});await refreshAdmin();await refreshQueue();}catch(err){toast(err.message);}}

addEventListener("beforeunload",()=>{unsubscribe?.();clearInterval(progressTimer);});
boot();