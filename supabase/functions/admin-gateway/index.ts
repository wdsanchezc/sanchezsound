import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const PIN_HASH="6a08be905c07ded3713160b34dd175d9f8c74ae09321b2187066026818717e7e";
const enc=new TextEncoder();
async function sha256(v:string){const b=await crypto.subtle.digest("SHA-256",enc.encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}})}
function randomToken(){return `${crypto.randomUUID()}-${crypto.randomUUID()}-${crypto.randomUUID()}`;}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  try{
    const body=await req.json();
    if(await sha256(String(body?.pin||""))!==PIN_HASH)return json({error:"Clave de administrador incorrecta"},401);
    const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!service)throw new Error("Configuración de servidor incompleta");
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const action=String(body?.action||"");

    if(action==="list_rooms"){
      const {data:rooms,error}=await db.from("rooms").select("id,code,name,active,requests_open,approval_required,block_duplicates,max_requests,currently_playing_request_id,playback_enabled,created_at").order("created_at",{ascending:false});
      if(error)throw error;const ids=(rooms||[]).map(r=>r.id);let requests:any[]=[];
      if(ids.length){const res=await db.from("requests").select("room_id,status,title,artist").in("room_id",ids).in("status",["pending","approved","playing"]);if(res.error)throw res.error;requests=res.data||[];}
      const counts=new Map<string,number>(),playing=new Map<string,any>();for(const r of requests){counts.set(r.room_id,(counts.get(r.room_id)||0)+1);if(r.status==="playing")playing.set(r.room_id,r);}
      return json({rooms:(rooms||[]).map(r=>({...r,queue_count:counts.get(r.id)||0,playing:playing.get(r.id)||null}))});
    }
    if(action==="create_room"){
      const name=String(body?.name||"SanchezSound").trim().slice(0,60)||"SanchezSound";const token=randomToken();
      const {data,error}=await db.rpc("create_room",{p_name:name,p_admin_token:token});if(error)throw error;return json({room:data});
    }
    if(action==="delete_room"){
      const id=String(body?.room_id||"");if(!id)throw new Error("Sala no válida");const {error}=await db.from("rooms").delete().eq("id",id);if(error)throw error;return json({ok:true});
    }
    if(action==="update_room"){
      const id=String(body?.room_id||""),patch=body?.patch||{},clean:any={};
      if("name" in patch)clean.name=String(patch.name||"SanchezSound").trim().slice(0,60)||"SanchezSound";
      for(const k of ["active","requests_open","approval_required","block_duplicates","playback_enabled"]){if(k in patch)clean[k]=Boolean(patch[k]);}
      if("max_requests" in patch)clean.max_requests=patch.max_requests===null||patch.max_requests===0?null:Math.max(1,Math.min(20,Number(patch.max_requests)||3));
      const {data,error}=await db.from("rooms").update(clean).eq("id",id).select("id,code,name,active,requests_open,approval_required,block_duplicates,max_requests,currently_playing_request_id,playback_enabled,created_at").single();if(error)throw error;return json({room:data});
    }
    if(action==="set_request_status"){
      const requestId=String(body?.request_id||""),status=String(body?.status||"");if(!["pending","approved","playing","played","rejected"].includes(status))throw new Error("Estado inválido");
      const {data:old,error:oldErr}=await db.from("requests").select("*").eq("id",requestId).maybeSingle();if(oldErr)throw oldErr;if(!old)throw new Error("Solicitud no encontrada");if(old.status===status)return json({request:old});
      const {data:updated,error}=await db.from("requests").update({status}).eq("id",requestId).select("*").single();if(error)throw error;
      if(status==="playing")await db.from("rooms").update({currently_playing_request_id:requestId}).eq("id",old.room_id);
      if(status==="played"){
        await db.from("rooms").update({currently_playing_request_id:null}).eq("id",old.room_id).eq("currently_playing_request_id",requestId);
        await db.from("play_history").insert({room_id:old.room_id,request_id:old.id,song_id:old.song_id,title:old.title,artist:old.artist});
        if(old.song_id)await db.rpc("increment_song_play_count",{p_provider_track_id:old.provider_track_id});
      }
      return json({request:updated});
    }
    if(action==="resolve_request"){
      const requestId=String(body?.request_id||""),track=body?.track||{},patch:any={};
      if(track.provider_track_id)patch.provider_track_id=String(track.provider_track_id);if(track.thumbnail_url!==undefined)patch.thumbnail_url=String(track.thumbnail_url||"");if(track.duration_seconds!==undefined)patch.duration_seconds=Math.max(0,Number(track.duration_seconds)||0);if(track.title)patch.title=String(track.title).slice(0,250);if(track.artist!==undefined)patch.artist=String(track.artist||"").slice(0,250);
      const {data,error}=await db.from("requests").update(patch).eq("id",requestId).select("*").single();if(error)throw error;return json({request:data});
    }
    return json({error:"Acción no válida"},400);
  }catch(e){return json({error:e instanceof Error?e.message:"Error de servidor"},400);}
});
