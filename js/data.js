import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG, APP } from "./config.js";
import { DEMO_GENRES, DEMO_ARTISTS, DEMO_SONGS } from "./demo-catalog.js";

export const isConfigured = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY);
export const db = isConfigured ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null;

const LS = { rooms:"ss_demo_rooms", requests:"ss_demo_requests", user:"ss_browser_session" };
const ADMIN_PREFIX = "ss_admin_token_";
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const demoEvent = () => dispatchEvent(new Event("ss-demo-change"));
let currentSessionId = null;

function sessionId(){
  if(currentSessionId) return currentSessionId;
  let id = localStorage.getItem(LS.user);
  if(!id){ id = uuid(); localStorage.setItem(LS.user,id); }
  currentSessionId = id;
  return id;
}
function adminToken(code){ return localStorage.getItem(`${ADMIN_PREFIX}${String(code||"").toUpperCase()}`) || ""; }
function saveAdminToken(code,token){ localStorage.setItem(`${ADMIN_PREFIX}${String(code).toUpperCase()}`,token); }
function newAdminToken(){ return `${uuid()}-${uuid()}`; }
function isUuid(v){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||"")); }
function normalizeSong(s){ return s ? {...s, artist:s.artist ?? s.artist_name ?? ""} : s; }
function normalizeRequest(r){ return r ? {...r, requester_user_id:r.requester_user_id ?? r.requester_session ?? ""} : r; }
function decorateRoom(r){
  if(!r) return r;
  const mine = Boolean(adminToken(r.code));
  return {...r, owner_id:mine ? sessionId() : null};
}
function rpcError(error){
  if(!error) return null;
  const msg = error.message || error.details || "Error de base de datos";
  return new Error(msg.replace(/^.*?:\s*/,""));
}

export async function ensureAuth(){ return sessionId(); }

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
  return { genres:genres||[], artists:artists||[], songs:(songs||[]).map(normalizeSong) };
}

export async function searchCatalog(query){
  const q=(query||"").trim();
  if(!q) return [];
  if(!isConfigured){
    const low=q.toLowerCase();
    return DEMO_SONGS.filter(s=>`${s.title} ${s.artist}`.toLowerCase().includes(low)).slice(0,20);
  }
  const safe=q.replace(/[%_,()]/g," ").trim();
  const {data,error}=await db.from("songs").select("*").eq("active",true).or(`title.ilike.%${safe}%,artist_name.ilike.%${safe}%`).limit(20);
  if(error) throw error;
  return (data||[]).map(normalizeSong);
}

export async function searchYouTube(query){
  if(!isConfigured) return searchCatalog(query);
  const {data,error}=await db.functions.invoke(CONFIG.YOUTUBE_FUNCTION_NAME,{body:{q:query,limit:10}});
  if(error) throw new Error(error.message||"No se pudo buscar en YouTube.");
  if(data?.error) throw new Error(data.error);
  return data?.items||[];
}

export async function createRoom(){
  if(!isConfigured){
    const rooms=read(LS.rooms,[]); let code=randomCode();
    while(rooms.some(r=>r.code===code)) code=randomCode();
    const room={id:uuid(),code,name:APP.defaultRoomName,owner_id:sessionId(),active:true,approval_required:false,max_requests:3,block_duplicates:true,requests_open:true,currently_playing_request_id:null,created_at:new Date().toISOString()};
    rooms.push(room);write(LS.rooms,rooms);demoEvent();return room;
  }
  const token=newAdminToken();
  const {data,error}=await db.rpc("create_room",{p_name:APP.defaultRoomName,p_admin_token:token});
  if(error) throw rpcError(error);
  saveAdminToken(data.code,token);
  return decorateRoom(data);
}

export async function getRoomByCode(code){
  code=(code||"").trim().toUpperCase();
  if(!isConfigured) return read(LS.rooms,[]).find(r=>r.code===code&&r.active)||null;
  const {data,error}=await db.from("rooms").select("*").eq("code",code).eq("active",true).maybeSingle();
  if(error) throw error; return decorateRoom(data);
}

export async function getRoomById(id){
  if(!isConfigured) return read(LS.rooms,[]).find(r=>r.id===id)||null;
  const {data,error}=await db.from("rooms").select("*").eq("id",id).maybeSingle();
  if(error) throw error; return decorateRoom(data);
}

export async function updateRoom(id,patch){
  if(!isConfigured){
    const rooms=read(LS.rooms,[]);const i=rooms.findIndex(r=>r.id===id);if(i<0)throw new Error("Sala no encontrada.");
    rooms[i]={...rooms[i],...patch};write(LS.rooms,rooms);demoEvent();return rooms[i];
  }
  const {data:base,error:findErr}=await db.from("rooms").select("id,code").eq("id",id).maybeSingle();
  if(findErr) throw findErr; if(!base) throw new Error("Sala no encontrada.");
  const token=adminToken(base.code); if(!token) throw new Error("Este dispositivo no tiene control administrativo de la sala.");
  const clean={};
  for(const k of ["name","active","requests_open","approval_required","block_duplicates","max_requests","currently_playing_request_id"]){ if(Object.prototype.hasOwnProperty.call(patch,k)) clean[k]=patch[k] ?? ""; }
  const {data,error}=await db.rpc("admin_update_room",{p_room_code:base.code,p_admin_token:token,p_patch:clean});
  if(error) throw rpcError(error); return decorateRoom(data);
}

export async function listRequests(roomId){
  if(!isConfigured) return read(LS.requests,[]).filter(r=>r.room_id===roomId).sort((a,b)=>(a.position-b.position)||new Date(a.created_at)-new Date(b.created_at));
  const {data,error}=await db.from("requests").select("*").eq("room_id",roomId).order("position").order("created_at");
  if(error) throw error; return (data||[]).map(normalizeRequest);
}

export async function addRequest(room,userId,requesterName,track){
  if(!room.requests_open) throw new Error("Esta rokola no está aceptando nuevas solicitudes.");
  if(!isConfigured){
    const rows=read(LS.requests,[]);const active=rows.filter(r=>r.room_id===room.id&&["pending","approved","playing"].includes(r.status));
    if(room.block_duplicates&&active.some(r=>r.provider_track_id===track.provider_track_id))throw new Error("Esta canción ya está en la fila.");
    if(room.max_requests&&active.filter(r=>r.requester_user_id===userId).length>=room.max_requests)throw new Error("Límite de solicitudes alcanzado.");
    const row={id:uuid(),room_id:room.id,requester_name:requesterName||"Invitado",requester_user_id:userId,provider:"youtube",provider_track_id:track.provider_track_id,title:track.title,artist:track.artist||"",thumbnail_url:track.thumbnail_url||"",duration_seconds:Number(track.duration_seconds)||0,status:room.approval_required?"pending":"approved",position:active.reduce((m,r)=>Math.max(m,Number(r.position)||0),0)+1,created_at:new Date().toISOString()};
    rows.push(row);write(LS.requests,rows);demoEvent();return row;
  }
  const songId=isUuid(track.id)?track.id:null;
  const {data,error}=await db.rpc("add_request",{
    p_room_code:room.code,
    p_requester_session:userId||sessionId(),
    p_requester_name:requesterName||"Invitado",
    p_provider:track.provider||"youtube",
    p_provider_track_id:track.provider_track_id,
    p_title:track.title,
    p_artist:track.artist||track.artist_name||"",
    p_thumbnail_url:track.thumbnail_url||"",
    p_duration_seconds:Number(track.duration_seconds)||0,
    p_song_id:songId
  });
  if(error) throw rpcError(error); return normalizeRequest(data);
}

export async function updateRequest(id,patch){
  if(!isConfigured){
    const rows=read(LS.requests,[]);const i=rows.findIndex(r=>r.id===id);if(i<0)throw new Error("Solicitud no encontrada.");
    rows[i]={...rows[i],...patch};write(LS.requests,rows);demoEvent();return rows[i];
  }
  if(!patch?.status) throw new Error("Actualización de solicitud no soportada.");
  const {data:req,error:reqErr}=await db.from("requests").select("id,room_id").eq("id",id).maybeSingle();
  if(reqErr) throw reqErr; if(!req) throw new Error("Solicitud no encontrada.");
  const {data:r,error:roomErr}=await db.from("rooms").select("code").eq("id",req.room_id).maybeSingle();
  if(roomErr) throw roomErr; if(!r) throw new Error("Sala no encontrada.");
  const token=adminToken(r.code); if(!token) throw new Error("No tienes permisos de administrador en esta sala.");
  const {data,error}=await db.rpc("admin_update_request",{p_room_code:r.code,p_admin_token:token,p_request_id:id,p_status:patch.status});
  if(error) throw rpcError(error); return normalizeRequest(data);
}

export async function bumpPlayCount(){
  // El backend incrementa play_count cuando una solicitud del catálogo pasa a "played".
}

export function subscribeRoom(roomId,callback){
  if(!isConfigured){const fn=()=>callback();addEventListener("ss-demo-change",fn);return()=>removeEventListener("ss-demo-change",fn);}
  const ch=db.channel(`sanchezsound:${roomId}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"requests",filter:`room_id=eq.${roomId}`},callback)
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"rooms",filter:`id=eq.${roomId}`},callback)
    .subscribe();
  return()=>db.removeChannel(ch);
}
