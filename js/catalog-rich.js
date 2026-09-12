import { db, getCatalog } from "./data.js";

const CACHE_KEY = "ss_music_meta_v1";
const pending = new Set();
let catalog = {genres:[],artists:[],songs:[]};
let observerTimer = null;

const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } };
const saveCache = value => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {} };
const cache = readCache();
const esc = (s="") => String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const art = url => url ? `background-image:url('${String(url).replaceAll("'","%27")}')` : "";

function songById(key){ return catalog.songs.find(s => String(s.id) === String(key) || s.provider_track_id === key); }
function artistById(key){ return catalog.artists.find(a => String(a.id) === String(key)); }
function initials(name=""){ return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase(); }

function addRichHome(){
  const bezel = document.querySelector("#homeView .screen-bezel");
  const featured = bezel?.querySelector(".featured-block");
  if(!bezel || !featured || document.getElementById("richHondurasShelf")) return;

  const hits = catalog.songs.filter(s=>s.is_honduras_hit).sort((a,b)=>(a.chart_rank||999)-(b.chart_rank||999)).slice(0,12);
  const artists = catalog.artists.filter(a=>a.featured).slice(0,16);
  const updated = hits.find(s=>s.chart_updated_at)?.chart_updated_at;
  const dateLabel = updated ? new Intl.DateTimeFormat("es-HN",{day:"numeric",month:"short",year:"numeric"}).format(new Date(updated)) : "esta semana";

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <section class="home-shelf" id="richHondurasShelf">
      <div class="section-heading">
        <div><span class="eyebrow">🇭🇳 TENDENCIAS</span><h2>Top Honduras</h2><p class="shelf-copy">Canciones que están sonando fuerte en Honduras.</p><span class="chart-source">Actualizado ${esc(dateLabel)}</span></div>
        <button class="text-btn" data-nav="honduras">Ver ranking</button>
      </div>
      <div class="rich-cover-grid">
        ${hits.map(s=>`<button class="rich-song-card" data-rich-song="${esc(s.id)}"><div class="rich-song-art ${s.thumbnail_url?"":"art-loading"}" style="${art(s.thumbnail_url)}"><span class="rich-rank">#${esc(s.chart_rank||"")}</span>${s.thumbnail_url?"":"♪"}</div><strong>${esc(s.title)}</strong><span>${esc(s.artist||s.artist_name||"")}</span></button>`).join("")}
      </div>
    </section>
    <section class="home-shelf" id="richArtistShelf">
      <div class="section-heading"><div><span class="eyebrow">ARTISTAS</span><h2>Explora por artista</h2><p class="shelf-copy">Fotos grandes y acceso rápido al catálogo.</p></div><button class="text-btn" data-nav="artists">Ver todos</button></div>
      <div class="artist-strip">
        ${artists.map(a=>`<button class="artist-orb-card" data-rich-artist="${esc(a.id)}"><div class="artist-orb ${a.image_url?"":"art-loading"}" style="${art(a.image_url)}">${a.image_url?"":esc(initials(a.name))}</div><strong>${esc(a.name)}</strong></button>`).join("")}
      </div>
    </section>`;
  featured.insertAdjacentElement("afterend",wrap);
}

function launchSearch(query){
  const trigger = document.getElementById("openSearchBtn") || document.querySelector('[data-nav="search"]');
  trigger?.click();
  setTimeout(()=>{
    const input = document.getElementById("searchInput");
    const form = document.getElementById("searchForm");
    if(!input || !form) return;
    input.value = query;
    form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  },60);
}

function wireRichClicks(){
  document.addEventListener("click",e=>{
    const richSong = e.target.closest("[data-rich-song]");
    if(richSong){
      const s = songById(richSong.dataset.richSong);
      if(s){ e.preventDefault(); launchSearch(`${s.title} ${s.artist||s.artist_name||""}`); }
      return;
    }
    const richArtist = e.target.closest("[data-rich-artist]");
    if(richArtist){
      const a = artistById(richArtist.dataset.richArtist);
      if(!a) return;
      e.preventDefault();
      document.querySelector('[data-nav="artists"]')?.click();
      setTimeout(()=>{
        const card=[...document.querySelectorAll("[data-artist]")].find(x=>x.dataset.artist===String(a.id));
        card?.scrollIntoView({behavior:"smooth",block:"center"});
        card?.focus?.();
      },100);
    }
  });

  // Curated catalog rows with provider_track_id beginning search: are discovery shortcuts.
  // Resolve them through the live YouTube search before they can enter the queue.
  document.addEventListener("click",e=>{
    const target=e.target.closest("[data-song-id],[data-request-song]");
    if(!target) return;
    const key=target.dataset.songId || target.dataset.requestSong;
    const s=songById(key);
    if(!s?.provider_track_id?.startsWith("search:")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    launchSearch(`${s.title} ${s.artist||s.artist_name||""}`);
  },true);

  document.addEventListener("click",e=>{
    if(!e.target.closest('[data-nav="honduras"]')) return;
    setTimeout(reorderHonduras,100);
  },true);
}

function reorderHonduras(){
  const title=document.getElementById("catalogTitle");
  if(title?.textContent !== "Top Honduras") return;
  const list=document.querySelector("#catalogBody .song-list");
  if(!list) return;
  const rows=[...list.querySelectorAll(".song-row")];
  rows.sort((a,b)=>{
    const sa=songById(a.querySelector("[data-request-song]")?.dataset.requestSong);
    const sb=songById(b.querySelector("[data-request-song]")?.dataset.requestSong);
    return (sa?.chart_rank||999)-(sb?.chart_rank||999);
  }).forEach(row=>list.appendChild(row));
  const sub=document.getElementById("catalogSubtitle");
  if(sub) sub.textContent="Ranking actual de canciones populares en Honduras. Toca una canción para buscar su versión reproducible en YouTube.";
  rows.forEach(row=>{
    const s=songById(row.querySelector("[data-request-song]")?.dataset.requestSong);
    if(s?.chart_rank && !row.querySelector(".rich-rank")){
      const badge=document.createElement("span");badge.className="rich-rank";badge.textContent=`#${s.chart_rank}`;
      const thumb=row.querySelector(".song-thumb");if(thumb){thumb.style.position="relative";thumb.appendChild(badge);}
    }
  });
  scheduleArtwork();
}

function registerTarget(key,el){
  if(!el) return;
  el.dataset.artKey=key;
  const cached=cache[key]?.image_url;
  if(cached){ el.style.backgroundImage=`url('${cached.replaceAll("'","%27")}')`;el.textContent="";el.classList.remove("art-loading"); }
}

async function hydrateArtwork(){
  const requests=[];
  const seen=new Set();

  document.querySelectorAll("[data-rich-song]").forEach(card=>{
    const s=songById(card.dataset.richSong);const el=card.querySelector(".rich-song-art");if(!s||!el)return;
    const key=`song:${s.id}`;registerTarget(key,el);
    if(!s.thumbnail_url&&!cache[key]&&!pending.has(key)&&!seen.has(key)){seen.add(key);requests.push({key,kind:"track",title:s.title,artist:s.artist||s.artist_name||""});}
  });
  document.querySelectorAll("[data-song-id]").forEach(card=>{
    const s=songById(card.dataset.songId);const el=card.querySelector(".cover-art");if(!s||!el)return;
    const key=`song:${s.id}`;registerTarget(key,el);
    if(!s.thumbnail_url&&!cache[key]&&!pending.has(key)&&!seen.has(key)){seen.add(key);requests.push({key,kind:"track",title:s.title,artist:s.artist||s.artist_name||""});}
  });
  document.querySelectorAll("[data-request-song]").forEach(btn=>{
    const s=songById(btn.dataset.requestSong);const el=btn.closest(".song-row")?.querySelector(".song-thumb");if(!s||!el)return;
    const key=`song:${s.id}`;registerTarget(key,el);
    if(!s.thumbnail_url&&!cache[key]&&!pending.has(key)&&!seen.has(key)){seen.add(key);requests.push({key,kind:"track",title:s.title,artist:s.artist||s.artist_name||""});}
  });
  document.querySelectorAll("[data-rich-artist],[data-artist]").forEach(card=>{
    const id=card.dataset.richArtist||card.dataset.artist;const a=artistById(id);const el=card.querySelector(".artist-orb,.entity-image");if(!a||!el)return;
    const key=`artist:${a.id}`;registerTarget(key,el);
    if(!a.image_url&&!cache[key]&&!pending.has(key)&&!seen.has(key)){seen.add(key);requests.push({key,kind:"artist",artist:a.name});}
  });

  if(!requests.length || !db) return;
  requests.slice(0,24).forEach(x=>pending.add(x.key));
  try{
    const {data,error}=await db.functions.invoke("music-meta",{body:{items:requests.slice(0,24)}});
    if(error) throw error;
    for(const item of data?.items||[]){
      if(item?.key&&item?.image_url){cache[item.key]={image_url:item.image_url,at:Date.now()};}
      pending.delete(item?.key);
    }
    saveCache(cache);
    document.querySelectorAll("[data-art-key]").forEach(el=>{
      const img=cache[el.dataset.artKey]?.image_url;
      if(img){el.style.backgroundImage=`url('${img.replaceAll("'","%27")}')`;el.textContent="";el.classList.remove("art-loading");}
    });
  }catch{
    requests.slice(0,24).forEach(x=>pending.delete(x.key));
  }
}

function scheduleArtwork(){clearTimeout(observerTimer);observerTimer=setTimeout(hydrateArtwork,120);}
function watchArtwork(){
  const obs=new MutationObserver(scheduleArtwork);
  [document.getElementById("featuredSongs"),document.getElementById("catalogBody"),document.getElementById("searchResults")].filter(Boolean).forEach(el=>obs.observe(el,{childList:true,subtree:true}));
}

async function init(){
  try{catalog=await getCatalog();}catch{return;}
  addRichHome();
  wireRichClicks();
  watchArtwork();
  scheduleArtwork();
}

init();
