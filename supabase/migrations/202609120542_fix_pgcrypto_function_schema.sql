-- Supabase installs pgcrypto in the extensions schema.
-- Qualify crypt/gen_salt explicitly so SECURITY DEFINER functions with
-- search_path=public can still use them.

create or replace function public.create_room(p_name text, p_admin_token text)
returns public.rooms language plpgsql security definer set search_path=public as $$
declare v_code text; v_room public.rooms;
begin
  if coalesce(length(p_admin_token),0) < 20 then raise exception 'invalid admin token'; end if;
  loop
    v_code := public.random_room_code();
    begin
      insert into public.rooms(code,name,admin_token_hash)
      values(
        v_code,
        coalesce(nullif(trim(p_name),''),'SanchezSound'),
        extensions.crypt(p_admin_token,extensions.gen_salt('bf'))
      )
      returning * into v_room;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return v_room;
end $$;

create or replace function public.admin_update_room(p_room_code text,p_admin_token text,p_patch jsonb)
returns public.rooms language plpgsql security definer set search_path=public as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where code=upper(trim(p_room_code));
  if v_room.id is null or extensions.crypt(p_admin_token,v_room.admin_token_hash)<>v_room.admin_token_hash then
    raise exception 'No autorizado';
  end if;
  update public.rooms set
    name=coalesce(p_patch->>'name',name),
    active=coalesce((p_patch->>'active')::boolean,active),
    requests_open=coalesce((p_patch->>'requests_open')::boolean,requests_open),
    approval_required=coalesce((p_patch->>'approval_required')::boolean,approval_required),
    block_duplicates=coalesce((p_patch->>'block_duplicates')::boolean,block_duplicates),
    max_requests=case when p_patch ? 'max_requests' then nullif(p_patch->>'max_requests','')::int else max_requests end,
    currently_playing_request_id=case when p_patch ? 'currently_playing_request_id' then nullif(p_patch->>'currently_playing_request_id','')::uuid else currently_playing_request_id end
  where id=v_room.id returning * into v_room;
  return v_room;
end $$;

create or replace function public.admin_update_request(p_room_code text,p_admin_token text,p_request_id uuid,p_status text)
returns public.requests language plpgsql security definer set search_path=public as $$
declare v_room public.rooms; v_req public.requests;
begin
  select * into v_room from public.rooms where code=upper(trim(p_room_code));
  if v_room.id is null or extensions.crypt(p_admin_token,v_room.admin_token_hash)<>v_room.admin_token_hash then
    raise exception 'No autorizado';
  end if;
  if p_status not in ('pending','approved','playing','played','rejected') then raise exception 'Estado inválido'; end if;
  update public.requests set status=p_status where id=p_request_id and room_id=v_room.id returning * into v_req;
  if v_req.id is null then raise exception 'Solicitud no encontrada'; end if;
  if p_status='playing' then update public.rooms set currently_playing_request_id=v_req.id where id=v_room.id; end if;
  if p_status='played' then
    update public.rooms set currently_playing_request_id=null where id=v_room.id and currently_playing_request_id=v_req.id;
    insert into public.play_history(room_id,request_id,song_id,title,artist) values(v_room.id,v_req.id,v_req.song_id,v_req.title,v_req.artist);
    if v_req.song_id is not null then update public.songs set play_count=play_count+1 where id=v_req.song_id; end if;
  end if;
  return v_req;
end $$;
