-- Foundation only. No browser mutation API, auth flow, timer worker or UI.
begin;
create schema draft;
revoke all on schema draft from public;

create type draft.sport as enum ('NFL','MLB','NBA','EPL','PGA');
create type draft.availability as enum ('free_agent','waivers','rostered','unknown');

create table draft.owners (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_-]*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true
);
-- Deliberately empty until verified accounts are linked by an administrator.
create table draft.owner_accounts (
  auth_user_id uuid primary key references auth.users(id),
  owner_id uuid not null unique references draft.owners(id)
);
create table draft.league_roles (
  auth_user_id uuid not null references auth.users(id),
  role text not null check (role = 'commissioner'),
  primary key (auth_user_id,role)
);
create table draft.players (
  id uuid primary key default gen_random_uuid(),
  sport draft.sport not null,
  name text not null check (length(trim(name)) > 0),
  position text,
  professional_team text,
  unique(id,sport)
);
create table draft.player_source_ids (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references draft.players(id),
  provider text not null check (length(provider)>0),
  league_id text not null check (length(league_id)>0),
  external_player_id text not null check (length(external_player_id)>0),
  unique(provider,league_id,external_player_id),
  unique(id,player_id)
);
create table draft.player_pool_imports (
  id uuid primary key default gen_random_uuid(),
  checksum text not null unique check (checksum ~ '^[a-f0-9]{64}$'),
  schema_version integer not null check (schema_version>0),
  status text not null default 'staging' check (status in ('staging','ready','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  check (status <> 'ready' or completed_at is not null)
);
create table draft.player_pool_entries (
  import_id uuid not null references draft.player_pool_imports(id),
  player_id uuid not null,
  source_id uuid not null,
  sport draft.sport not null,
  name text not null check (length(trim(name))>0),
  position text,
  professional_team text,
  availability draft.availability not null,
  primary key(import_id,player_id),
  foreign key(player_id,sport) references draft.players(id,sport),
  foreign key(source_id,player_id) references draft.player_source_ids(id,player_id)
);
create table draft.drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('startup','rookie','free_agent')),
  championship_year integer not null check (championship_year>=2027),
  status text not null default 'setup' check (status in ('setup','running','paused','awaiting_makeups','completed','cancelled')),
  rounds integer not null check (rounds>0),
  participant_count integer not null default 9 check (participant_count>1),
  import_id uuid references draft.player_pool_imports(id),
  current_pick_number integer,
  pick_duration_seconds integer check (pick_duration_seconds>0),
  deadline_at timestamptz,
  paused_remaining_seconds numeric check (paused_remaining_seconds>=0),
  revision bigint not null default 0 check (revision>=0),
  created_at timestamptz not null default now(),
  check(kind<>'startup' or (rounds=65 and participant_count=9)),
  check(current_pick_number is null or current_pick_number between 1 and rounds*participant_count),
  check(deadline_at is null or status='running'),
  unique(id,import_id)
);
create table draft.draft_participants (
  draft_id uuid not null references draft.drafts(id),
  owner_id uuid not null references draft.owners(id),
  order_position integer not null check(order_position>0),
  primary key(draft_id,owner_id),
  unique(draft_id,order_position)
);
create table draft.draft_sport_rules (
  draft_id uuid not null references draft.drafts(id),
  sport draft.sport not null,
  minimum integer not null check(minimum>=0),
  maximum integer check(maximum>=minimum),
  primary key(draft_id,sport)
);
create table draft.draft_pool_players (
  draft_id uuid not null,
  import_id uuid not null,
  player_id uuid not null,
  sport draft.sport not null,
  name text not null check(length(trim(name))>0),
  position text,
  professional_team text,
  availability draft.availability not null,
  eligible boolean not null default false,
  primary key(draft_id,player_id),
  unique(draft_id,player_id,sport),
  foreign key(draft_id,import_id) references draft.drafts(id,import_id),
  foreign key(import_id,player_id) references draft.player_pool_entries(import_id,player_id),
  foreign key(player_id,sport) references draft.players(id,sport),
  check(not eligible or availability in ('free_agent','waivers'))
);
create table draft.draft_picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references draft.drafts(id),
  round integer not null check(round>0),
  pick_in_round integer not null check(pick_in_round>0),
  overall_pick_number integer not null check(overall_pick_number>0),
  original_owner_id uuid not null,
  current_owner_id uuid not null,
  skipped_at timestamptz,
  unique(draft_id,overall_pick_number),
  unique(draft_id,round,pick_in_round),
  unique(draft_id,round,original_owner_id),
  unique(draft_id,id,current_owner_id),
  foreign key(draft_id,original_owner_id) references draft.draft_participants(draft_id,owner_id),
  foreign key(draft_id,current_owner_id) references draft.draft_participants(draft_id,owner_id)
);
alter table draft.drafts add constraint current_pick_exists
  foreign key(id,current_pick_number) references draft.draft_picks(draft_id,overall_pick_number)
  deferrable initially deferred;
create table draft.draft_selections (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null,
  pick_id uuid not null,
  owner_id uuid not null,
  player_id uuid not null,
  sport draft.sport not null,
  selected_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid references auth.users(id),
  method text not null check(method in ('owner','commissioner')),
  voided_at timestamptz,
  void_reason text,
  foreign key(draft_id,pick_id,owner_id) references draft.draft_picks(draft_id,id,current_owner_id),
  foreign key(draft_id,player_id,sport) references draft.draft_pool_players(draft_id,player_id,sport),
  check((voided_at is null and void_reason is null) or
        (voided_at is not null and void_reason is not null and voided_at>=selected_at and length(trim(void_reason))>0))
);
create unique index one_active_player on draft.draft_selections(draft_id,player_id) where voided_at is null;
create unique index one_active_pick on draft.draft_selections(pick_id) where voided_at is null;
create table draft.draft_events (
  id bigint generated always as identity primary key,
  draft_id uuid not null references draft.drafts(id),
  event_type text not null,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null check(jsonb_typeof(payload)='object')
);
create table draft.draft_commands (
  draft_id uuid not null references draft.drafts(id),
  request_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(draft_id,request_id)
);

-- All future mutation functions must take this same per-draft lock.
create function draft.startup_rules() returns trigger language plpgsql set search_path='' as $$
begin
  if new.kind='startup' then
    insert into draft.draft_sport_rules(draft_id,sport,minimum)
    values(new.id,'NFL',9),(new.id,'NBA',8),(new.id,'MLB',14),(new.id,'EPL',11),(new.id,'PGA',6);
  end if;
  return new;
end $$;
create trigger seed_startup_rules after insert on draft.drafts
  for each row execute function draft.startup_rules();

create function draft.freeze_pool() returns trigger language plpgsql set search_path='' as $$
declare target uuid; state text;
begin
  target=case when tg_op='DELETE' then old.draft_id else new.draft_id end;
  select status into state from draft.drafts where id=target for update;
  if tg_op='UPDATE' and old.draft_id<>new.draft_id then raise exception 'Cannot move pool entry'; end if;
  if state<>'setup' then raise exception 'Draft pool is frozen'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger freeze_draft_pool before insert or update or delete on draft.draft_pool_players
  for each row execute function draft.freeze_pool();

create function draft.guard_pick_slot() returns trigger language plpgsql set search_path='' as $$
declare d draft.drafts;
begin
  if tg_op='DELETE' then raise exception 'Pick slots cannot be deleted'; end if;
  select * into strict d from draft.drafts where id=new.draft_id for update;
  if tg_op='UPDATE' and (new.id,new.draft_id,new.round,new.pick_in_round,new.overall_pick_number,new.original_owner_id)
    is distinct from (old.id,old.draft_id,old.round,old.pick_in_round,old.overall_pick_number,old.original_owner_id) then
    raise exception 'Original pick identity is immutable';
  end if;
  if new.round>d.rounds or new.pick_in_round>d.participant_count or
    new.overall_pick_number<>(new.round-1)*d.participant_count+new.pick_in_round then
    raise exception 'Invalid pick coordinates';
  end if;
  return new;
end $$;
create trigger pick_coordinates before insert or update or delete on draft.draft_picks
  for each row execute function draft.guard_pick_slot();

create function draft.guard_order() returns trigger language plpgsql set search_path='' as $$
declare target uuid; state text;
begin
  target=case when tg_op='DELETE' then old.draft_id else new.draft_id end;
  select status into state from draft.drafts where id=target for update;
  if tg_op='UPDATE' and old.draft_id<>new.draft_id then raise exception 'Cannot move participant between drafts'; end if;
  if state<>'setup' or exists(select 1 from draft.draft_picks where draft_id=target) then
    raise exception 'Order is frozen after pick generation';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger participant_order before insert or update or delete on draft.draft_participants
  for each row execute function draft.guard_order();

create function draft.validate_selection() returns trigger language plpgsql set search_path='' as $$
declare state text; allowed boolean;
begin
  select status into state from draft.drafts where id=new.draft_id for update;
  if state not in ('running','paused','awaiting_makeups') then
    raise exception 'Draft is not accepting selections';
  end if;
  select eligible into allowed from draft.draft_pool_players
    where draft_id=new.draft_id and player_id=new.player_id;
  if allowed is distinct from true then raise exception 'Player is not eligible'; end if;
  return new;
end $$;
create trigger selection_guard before insert on draft.draft_selections
  for each row execute function draft.validate_selection();

create function draft.preserve_history() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Draft history cannot be deleted'; end if;
  if tg_table_name='draft_selections' and old.voided_at is null
     and new.voided_at is not null
     and (to_jsonb(old)-'voided_at'-'void_reason')=(to_jsonb(new)-'voided_at'-'void_reason') then
    perform 1 from draft.drafts where id=old.draft_id for update;
    return new;
  end if;
  raise exception 'Draft history is immutable';
end $$;
create trigger preserve_selection before update or delete on draft.draft_selections
  for each row execute function draft.preserve_history();
create trigger preserve_event before update or delete on draft.draft_events
  for each row execute function draft.preserve_history();

create function draft.log_selection() returns trigger language plpgsql set search_path='' as $$
declare slot draft.draft_picks;
begin
  select * into slot from draft.draft_picks where id=new.pick_id;
  insert into draft.draft_events(draft_id,event_type,actor_user_id,payload)
  values(new.draft_id,case when tg_op='INSERT' then 'selection' else 'selection_voided' end,
    auth.uid(),jsonb_build_object('selection',to_jsonb(new),'round',slot.round,
      'pick_number',slot.overall_pick_number,'original_owner_id',slot.original_owner_id));
  return new;
end $$;
create trigger selection_audit after insert or update on draft.draft_selections
  for each row execute function draft.log_selection();

-- Privileged setup helper only: does not start the draft or expose client writes.
create function draft.generate_snake_picks(target uuid) returns integer
language plpgsql set search_path='' as $$
declare d draft.drafts; n integer;
begin
  select * into strict d from draft.drafts where id=target for update;
  if d.status<>'setup' then raise exception 'Order is configurable only during setup'; end if;
  if exists(select 1 from draft.draft_picks where draft_id=target) then raise exception 'Picks already generated'; end if;
  select count(*) into n from draft.draft_participants where draft_id=target;
  if n<>d.participant_count or
     exists(select 1 from draft.draft_participants where draft_id=target and order_position>n) then
    raise exception 'A complete contiguous participant order is required';
  end if;
  insert into draft.draft_picks(draft_id,round,pick_in_round,overall_pick_number,original_owner_id,current_owner_id)
  select target,r,p,(r-1)*n+p,o.owner_id,o.owner_id
  from generate_series(1,d.rounds) r cross join generate_series(1,n) p
  join draft.draft_participants o on o.draft_id=target and
    o.order_position=case when r%2=1 then p else n+1-p end;
  return d.rounds*n;
end $$;

-- No policies yet: even SELECT grants below reveal no rows via RLS.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='draft' loop
    execute format('alter table draft.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema draft from public,anon,authenticated;
revoke all on all sequences in schema draft from public,anon,authenticated;
revoke all on all functions in schema draft from public,anon,authenticated;
grant usage on schema draft to anon,authenticated;
grant select on all tables in schema draft to anon,authenticated;
alter default privileges in schema draft revoke execute on functions from public;
commit;
