-- SanchezSound Digital Jukebox
-- Ejecutar en Supabase SQL Editor.
-- Luego habilitar Authentication > Providers > Anonymous Sign-Ins.

create extension if not exists pgcrypto;

create table if not exists public.genres (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  icon text not null default '♫',
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  image_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'youtube',
  provider_track_id text not null unique,
  title text not null,
  artist text not null default '',
  artist_id uuid references public.artists(id) on delete set null,
  genre_id uuid references public.genres(id) on delete set null,
  thumbnail_url text not null default '',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  is_featured boolean not null default false,
  is_honduras_hit boolean not null default false,
  play_count bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code)=6),
  name text not null default 'SanchezSound Party',
  owner_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  approval_required boolean not null default false,
  max_requests integer null check (max_requests is null or max_requests between 1 and 20),
  block_duplicates boolean not null default true,
  requests_open boolean not null default true,
  currently_playing_request_id uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  requester_name text not null default 'Invitado',
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'youtube',
  provider_track_id text not null,
  title text not null,
  artist text not null default '',
  thumbnail_url text not null default '',
  duration_seconds integer not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','playing','played','rejected')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  played_at timestamptz null
);

alter table public.rooms drop constraint if exists rooms_currently_playing_request_id_fkey;
alter table public.rooms add constraint rooms_currently_playing_request_id_fkey foreign key (currently_playing_request_id) references public.requests(id) on delete set null;

create index if not exists songs_artist_idx on public.songs(artist_id);
create index if not exists songs_genre_idx on public.songs(genre_id);
create index if not exists songs_honduras_idx on public.songs(is_honduras_hit,play_count desc);
create index if not exists requests_room_status_position_idx on public.requests(room_id,status,position,created_at);
create index if not exists requests_requester_idx on public.requests(room_id,requester_user_id,status);

-- El servidor decide posición y estado inicial; también aplica reglas de la sala.
create or replace function public.prepare_request()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.rooms%rowtype;
  active_count integer;
  next_pos integer;
begin
  select * into r from public.rooms where id=new.room_id;
  if not found or not r.active then raise exception 'La sala no está activa.'; end if;
  if not r.requests_open then raise exception 'La rokola no está aceptando nuevas solicitudes.'; end if;
  if new.requester_user_id <> auth.uid() then raise exception 'Usuario de solicitud inválido.'; end if;

  if r.block_duplicates and exists(
    select 1 from public.requests
    where room_id=new.room_id and provider_track_id=new.provider_track_id and status in ('pending','approved','playing')
  ) then raise exception 'Esta canción ya está en la fila.'; end if;

  if r.max_requests is not null then
    select count(*) into active_count from public.requests
    where room_id=new.room_id and requester_user_id=new.requester_user_id and status in ('pending','approved','playing');
    if active_count >= r.max_requests then raise exception 'Alcanzaste el máximo de solicitudes activas.'; end if;
  end if;

  select coalesce(max(position),0)+1 into next_pos from public.requests
  where room_id=new.room_id and status in ('pending','approved','playing');
  new.position:=next_pos;
  new.status:=case when r.approval_required then 'pending' else 'approved' end;
  new.requester_name:=left(coalesce(nullif(trim(new.requester_name),''),'Invitado'),30);
  return new;
end;
$$;

drop trigger if exists trg_prepare_request on public.requests;
create trigger trg_prepare_request before insert on public.requests for each row execute function public.prepare_request();

create or replace function public.mark_played_at()
returns trigger language plpgsql as $$
begin
  if new.status='played' and old.status is distinct from 'played' then new.played_at=now(); end if;
  return new;
end;$$;
drop trigger if exists trg_mark_played_at on public.requests;
create trigger trg_mark_played_at before update on public.requests for each row execute function public.mark_played_at();

create or replace function public.increment_song_play_count(p_provider_track_id text)
returns void language sql security definer set search_path=public as $$
  update public.songs set play_count=play_count+1,updated_at=now() where provider_track_id=p_provider_track_id;
$$;

alter table public.genres enable row level security;
alter table public.artists enable row level security;
alter table public.songs enable row level security;
alter table public.rooms enable row level security;
alter table public.requests enable row level security;

drop policy if exists genres_read on public.genres;
create policy genres_read on public.genres for select to authenticated using (active=true);
drop policy if exists artists_read on public.artists;
create policy artists_read on public.artists for select to authenticated using (active=true);
drop policy if exists songs_read on public.songs;
create policy songs_read on public.songs for select to authenticated using (active=true);

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (active=true or owner_id=auth.uid());
drop policy if exists rooms_create on public.rooms;
create policy rooms_create on public.rooms for insert to authenticated with check (owner_id=auth.uid());
drop policy if exists rooms_owner_update on public.rooms;
create policy rooms_owner_update on public.rooms for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());

drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select to authenticated using (
  exists(select 1 from public.rooms r where r.id=requests.room_id and (r.active=true or r.owner_id=auth.uid()))
);
drop policy if exists requests_create on public.requests;
create policy requests_create on public.requests for insert to authenticated with check (
  requester_user_id=auth.uid() and exists(select 1 from public.rooms r where r.id=requests.room_id and r.active=true and r.requests_open=true)
);
drop policy if exists requests_owner_update on public.requests;
create policy requests_owner_update on public.requests for update to authenticated using (
  exists(select 1 from public.rooms r where r.id=requests.room_id and r.owner_id=auth.uid())
) with check (
  exists(select 1 from public.rooms r where r.id=requests.room_id and r.owner_id=auth.uid())
);

grant execute on function public.increment_song_play_count(text) to authenticated;

-- Realtime
DO $$ BEGIN
  IF NOT EXISTS (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rooms') THEN
    alter publication supabase_realtime add table public.rooms;
  END IF;
  IF NOT EXISTS (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='requests') THEN
    alter publication supabase_realtime add table public.requests;
  END IF;
END $$;

-- Catálogo inicial. Top Honduras es administrable: is_honduras_hit=true.
insert into public.genres(slug,name,icon,sort_order) values
('pop','Pop','✨',10),('urbano','Urbano / Reggaetón','🔥',20),('baladas','Baladas','❤️',30),('rock','Rock','🎸',40),('latino','Latino','🌴',50),('fiesta','Fiesta','🎉',60)
on conflict(slug) do update set name=excluded.name,icon=excluded.icon,sort_order=excluded.sort_order;

insert into public.artists(slug,name) values
('queen','Queen'),('michael-jackson','Michael Jackson'),('luis-fonsi','Luis Fonsi'),('bruno-mars','Bruno Mars'),('katy-perry','Katy Perry'),('rick-astley','Rick Astley')
on conflict(slug) do update set name=excluded.name;

insert into public.songs(provider_track_id,title,artist,artist_id,genre_id,thumbnail_url,duration_seconds,is_featured,is_honduras_hit,play_count)
values
('kJQP7kiw5Fk','Despacito','Luis Fonsi ft. Daddy Yankee',(select id from public.artists where slug='luis-fonsi'),(select id from public.genres where slug='latino'),'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',282,true,true,118),
('fJ9rUzIMcZQ','Bohemian Rhapsody','Queen',(select id from public.artists where slug='queen'),(select id from public.genres where slug='rock'),'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg',354,true,false,79),
('Zi_XLOBDo_Y','Billie Jean','Michael Jackson',(select id from public.artists where slug='michael-jackson'),(select id from public.genres where slug='pop'),'https://i.ytimg.com/vi/Zi_XLOBDo_Y/hqdefault.jpg',294,true,true,92),
('OPf0YbXqDm0','Uptown Funk','Mark Ronson ft. Bruno Mars',(select id from public.artists where slug='bruno-mars'),(select id from public.genres where slug='fiesta'),'https://i.ytimg.com/vi/OPf0YbXqDm0/hqdefault.jpg',270,true,true,141),
('CevxZvSJLk8','Roar','Katy Perry',(select id from public.artists where slug='katy-perry'),(select id from public.genres where slug='pop'),'https://i.ytimg.com/vi/CevxZvSJLk8/hqdefault.jpg',270,false,false,66),
('dQw4w9WgXcQ','Never Gonna Give You Up','Rick Astley',(select id from public.artists where slug='rick-astley'),(select id from public.genres where slug='pop'),'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',213,false,false,51)
on conflict(provider_track_id) do update set title=excluded.title,artist=excluded.artist,artist_id=excluded.artist_id,genre_id=excluded.genre_id,thumbnail_url=excluded.thumbnail_url,duration_seconds=excluded.duration_seconds;
