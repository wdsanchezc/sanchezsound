import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

function isoToSeconds(iso:string){const m=iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);if(!m)return 0;return Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0);}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  try{
    const key=Deno.env.get("YOUTUBE_API_KEY");if(!key)throw new Error("Falta configurar YOUTUBE_API_KEY en Supabase Secrets.");
    const body=await req.json();const q=String(body?.q||"").trim();const limit=Math.min(10,Math.max(1,Number(body?.limit)||10));if(!q)throw new Error("Escribe una canción o artista.");
    const search=new URL("https://www.googleapis.com/youtube/v3/search");search.searchParams.set("part","snippet");search.searchParams.set("type","video");search.searchParams.set("videoEmbeddable","true");search.searchParams.set("safeSearch","moderate");search.searchParams.set("maxResults",String(limit));search.searchParams.set("q",q);search.searchParams.set("key",key);
    const sr=await fetch(search);if(!sr.ok)throw new Error(`YouTube Search API respondió ${sr.status}.`);const sd=await sr.json();const ids=(sd.items||[]).map((x:any)=>x.id?.videoId).filter(Boolean);
    if(!ids.length)return Response.json({items:[]},{headers:corsHeaders});
    const videos=new URL("https://www.googleapis.com/youtube/v3/videos");videos.searchParams.set("part","contentDetails,snippet,status");videos.searchParams.set("id",ids.join(","));videos.searchParams.set("key",key);
    const vr=await fetch(videos);if(!vr.ok)throw new Error(`YouTube Videos API respondió ${vr.status}.`);const vd=await vr.json();const byId=new Map((vd.items||[]).map((x:any)=>[x.id,x]));
    const items=ids.map((id:string)=>{const v:any=byId.get(id);const s=v?.snippet||{};return{provider_track_id:id,title:s.title||"Sin título",artist:s.channelTitle||"",thumbnail_url:s.thumbnails?.high?.url||s.thumbnails?.medium?.url||s.thumbnails?.default?.url||"",duration_seconds:isoToSeconds(v?.contentDetails?.duration||"PT0S")};}).filter((x:any)=>x.duration_seconds>0);
    return Response.json({items},{headers:{...corsHeaders,"Content-Type":"application/json"}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Error desconocido"},{status:400,headers:{...corsHeaders,"Content-Type":"application/json"}});}
});