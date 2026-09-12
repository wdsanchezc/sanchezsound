import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG, APP } from "./config.js";
import { DEMO_GENRES, DEMO_ARTISTS, DEMO_SONGS } from "./demo-catalog.js";

export const isConfigured = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY);
export const db = isConfigured ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
}) : null;

const LS = { rooms:"ss_demo_rooms", requests:"ss_demo_requests", user:"ss_demo_user" };
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const demoEvent = () => dispatchEvent(new Event("ss-demo-change"));

export async function ensureAuth(){
  if(!isConfigured){
    let id = localStorage.getItem(LS.user);
    if(!id){ id = uuid(); localStorage.setItem(LS.user,id); }
    return id;
  }
  const { data:{session} } = await db.auth.getSession();
  if(session?.user?.id) return session.user.id;
  const { data, error } = await db.auth.signInAnonymously();
  if(error) throw error;
  return data.user.id;
}

export function randomCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

export async function getCatalog(){
  if(!isConfigured) return { genres:DEMO_GENRES, artists:DEMO_ARTISTS, songs:DEMO_SONGS };
  const [{data:genres,error:gErr},{data:artists,error:aErr},{data:songs,error:sErr}] = await Promise.all([
    db.from("genres").select("*").eq("active",true).order("sort_order").order("name"),
    db.from("artists").select("*").eq("active",true).order("name"),
    db.from("songs").select("*").eq("active",true).order("play_count",{ascending:false})
  ]);
  if(gErr) throw gErr; if(aErr) throw aErr; if(sErr) throw sErr;
  return { genres:genres||[], artists:artists||[], songs:songs||[] };
}

export async function searchCatalog(query){
  const q=(query||"").trim();
  if(!q) return [];
  if(!isConfigured){
    const low=q.toLowerCase();
    return DEMO_SONGS.filter(s=>`${s.title} ${s.artist}`.toLowerCase().includes(low)).slice(0,20);
  }
  const safe=q.replace(/[%_,()]/g," ").trim();
  const {data,error}=await db.from("songs").select("*").eq("active",true).or(`title.ilike.%${safe}%,artist.ilike.%${safe}%`).limit(20);
  if(error) throw error;
  return data||[];
}

export async function searchYouTube(query){
  if(!isConfigured) return searchCatalog(query);
  const {data,error}=await db.functions.invoke(CONFIG.YOUTUBE_FUNCTION_NAME,{body:{q:query,limit:10}});
  if(error) throw new Error(error.message||"No se pudo buscar en YouTube.");
  if(data?.error) throw new Error(data.error);
  return data?.items||[];
}

export async function createRoom(ownerId){
  if(!isConfigured){
    const rooms=read(LS.rooms,[]); let code=randomCode();
    while(rooms.some(r=>r.code===code)) code=randomCode();
    const room={id:uuid(),code,name:APP.defaultRoomName,owner_id:ownerId,active:true,approval_required:false,max_requests:3,block_duplicates:true,requests_open:true,currently_playing_request_id:null,created_at:new Date().toISOString()};
    rooms.push(room);write(LS.rooms,rooms);demoEvent();return room;
  }
  for(let i=0;i<5;i++){
    const {data,error}=await db.from("rooms").insert({code:randomCode(),name:APP.defaultRoomName,owner_id:ownerId}).select().single();
    if(!error) return data;
    if(error.code!=="23505") throw error;
  }
  throw new Error("No se pudo generar el código de sala.");
}

export async function getRoomByCode(code){
  code=(code||"").trim().toUpperCase();
  if(!isConfigured) return read(LS.rooms,[]).find(r=>r.code===code&&r.active)||null;
  const {data,error}=await db.from("rooms").select("*").eq("code",code).eq("active",true).maybeSingle();
  if(error) throw error; return data;
}

export async function getRoomById(id){
  if(!isConfigured) return read(LS.rooms,[]).find(r=>r.id===id)||null;
  const {data,error}=await db.from("rooms").select("*").eq("id",id).maybeSingle();
  if(error) throw error; return data;
}

export async function updateRoom(id,patch){
  if(!isConfigured){
    const rooms=read(LS.rooms,[]);const i=rooms.findIndex(r=>r.id===id);if(i<0)throw new Error("Sala no encontrada.");
    rooms[i]={...rooms[i],...patch};write(LS.rooms,rooms);demoEvent();return rooms[i];
  }
  const {data,error}=await db.from("rooms").update(patch).eq("id",id).select().single();
  if(error) throw error; return data;
}

export async function listRequests(roomId){
  if(!isConfigured) return read(LS.requests,[]).filter(r=>r.room_id===roomId).sort((a,b)=>(a.position-b.position)||new Date(a.created_at)-new Date(b.created_at));
  const {data,error}=await db.from("requests").select("*").eq("room_id",roomId).order("position").order("created_at");
  if(error) throw error; return data||[];
}

export async function addRequest(room,userId,requesterName,track){
  if(!room.requests_open) throw new Error("Esta rokola no está aceptando nuevas solicitudes.");
  const rows=await listRequests(room.id);
  const active=rows.filter(r=>["pending","approved","playing"].includes(r.status));
  if(room.block_duplicates && active.some(r=>r.provider_track_id===track.provider_track_id)) throw new Error("Esta canción ya está en la fila.");
  const mine=active.filter(r=>r.requester_user_id===userId);
  if(room.max_requests && mine.length>=room.max_requests) throw new Error(`Ya alcanzaste el máximo de ${room.max_requests} solicitudes activas.`);
  const position=active.reduce((m,r)=>Math.max(m,Number(r.position)||0),0)+1;
  const row={id:uuid(),room_id:room.id,requester_name:requesterName||"Invitado",requester_user_id:userId,provider:"youtube",provider_track_id:track.provider_track_id,title:track.title,artist:track.artist||"",thumbnail_url:track.thumbnail_url||"",duration_seconds:Number(track.duration_seconds)||0,status:room.approval_required?"pending":"approved",position,created_at:new Date().toISOString()};
  if(!isConfigured){const all=read(LS.requests,[]);all.push(row);write(LS.requests,all);demoEvent();return row;}
  const {data,error}=await db.from("requests").insert(row).select().single();if(error)throw error;return data;
}

export async function updateRequest(id,patch){
  if(!isConfigured){
    const rows=read(LS.requests,[]);const i=rows.findIndex(r=>r.id===id);if(i<0)throw new Error("Solicitud no encontrada.");
    rows[i]={...rows[i],...patch};write(LS.requests,rows);demoEvent();return rows[i];
  }
  const {data,error}=await db.from("requests").update(patch).eq("id",id).select().single();if(error)throw error;return data;
}

export async function bumpPlayCount(providerTrackId){
  if(!isConfigured) return;
  try{ await db.rpc("increment_song_play_count",{p_provider_track_id:providerTrackId}); }catch{}
}

export function subscribeRoom(roomId,callback){
  if(!isConfigured){const fn=()=>callback();addEventListener("ss-demo-change",fn);return()=>removeEventListener("ss-demo-change",fn);}
  const ch=db.channel(`sanchezsound:${roomId}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"requests",filter:`room_id=eq.${roomId}`},callback)
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"rooms",filter:`id=eq.${roomId}`},callback)
    .subscribe();
  return()=>db.removeChannel(ch);
}