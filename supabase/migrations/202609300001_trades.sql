begin;
create schema trading;
revoke all on schema trading from public,anon,authenticated;

create table trading.picks (
  id uuid primary key default gen_random_uuid(),
  year integer not null check(year between 2000 and 2200),
  round integer not null check(round between 1 and 10),
  original_owner_id uuid not null references draft.owners(id),
  owner_id uuid not null references draft.owners(id),
  unique(year,round,original_owner_id)
);
create table trading.ledger_import (
  singleton boolean primary key default true check(singleton),
  ledger jsonb not null,
  imported_at timestamptz not null default clock_timestamp()
);
create table trading.pick_history (
  id bigint generated always as identity primary key,
  pick_id uuid not null references trading.picks(id),
  from_owner_id uuid not null references draft.owners(id),
  to_owner_id uuid not null references draft.owners(id),
  reason text not null,
  legacy_id text unique,
  occurred_at timestamptz not null default clock_timestamp(),
  check(from_owner_id<>to_owner_id)
);
create table trading.roster_snapshots (
  id uuid primary key default gen_random_uuid(),
  sport draft.sport not null,
  league_id text not null check(length(league_id)>0),
  observed_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  unique(league_id,observed_at)
);
create table trading.players (
  id uuid primary key default gen_random_uuid(),
  sport draft.sport not null,
  league_id text not null,
  fantrax_id text not null check(length(fantrax_id)>0),
  name text not null check(length(trim(name))>0),
  owner_id uuid references draft.owners(id),
  snapshot_id uuid not null references trading.roster_snapshots(id),
  unique(league_id,fantrax_id)
);
create table trading.trades (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references draft.owners(id),
  recipient_id uuid not null references draft.owners(id),
  parent_id uuid unique references trading.trades(id),
  status text not null default 'proposed' check(status in ('proposed','countered','declined','withdrawn','expired','invalidated','accepted','completed')),
  message text not null default '' check(length(message)<=2000),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
  accepted_at timestamptz,
  completed_at timestamptz,
  corrected_at timestamptz,
  revision bigint not null default 0,
  warnings jsonb not null default '[]',
  check(proposer_id<>recipient_id),
  check(expires_at>created_at),
  check(status not in ('accepted','completed') or accepted_at is not null),
  check(status<>'completed' or completed_at is not null)
);
create table trading.assets (
  id bigint generated always as identity primary key,
  trade_id uuid not null references trading.trades(id),
  from_owner_id uuid not null references draft.owners(id),
  to_owner_id uuid not null references draft.owners(id),
  player_id uuid references trading.players(id),
  pick_id uuid references trading.picks(id),
  check(num_nonnulls(player_id,pick_id)=1),
  check(from_owner_id<>to_owner_id),
  unique(trade_id,player_id),unique(trade_id,pick_id)
);
create table trading.player_reservations (
  player_id uuid primary key references trading.players(id),
  trade_id uuid not null references trading.trades(id)
);
create table trading.events (
  id bigint generated always as identity primary key,
  trade_id uuid not null references trading.trades(id),
  actor_user_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}',
  occurred_at timestamptz not null default clock_timestamp()
);
create table trading.notifications (
  id uuid primary key default gen_random_uuid(),
  event_id bigint not null references trading.events(id),
  recipient_user_id uuid not null references auth.users(id),
  kind text not null check(kind in ('proposal','counter','acceptance','decline')),
  status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  unique(event_id,recipient_user_id)
);
create table trading.requests (
  actor_user_id uuid not null references auth.users(id),
  request_id uuid not null,
  action text not null,args jsonb not null,result jsonb not null,
  primary key(actor_user_id,request_id)
);
create index trades_parties on trading.trades(proposer_id,recipient_id);
create index trades_expiration on trading.trades(expires_at) where status='proposed';
create index assets_players on trading.assets(player_id) where player_id is not null;
create index assets_picks on trading.assets(pick_id) where pick_id is not null;
create index events_trade on trading.events(trade_id,id);
create index notifications_pending on trading.notifications(next_attempt_at) where status in ('pending','failed');

create function trading.immutable_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Trade history is immutable'; end $$;
create trigger immutable_assets before update or delete on trading.assets for each row execute function trading.immutable_history();
create trigger immutable_events before update or delete on trading.events for each row execute function trading.immutable_history();
create trigger immutable_pick_history before update or delete on trading.pick_history for each row execute function trading.immutable_history();
create trigger immutable_snapshots before update or delete on trading.roster_snapshots for each row execute function trading.immutable_history();
create trigger immutable_ledger before update or delete on trading.ledger_import for each row execute function trading.immutable_history();
create trigger immutable_requests before update or delete on trading.requests for each row execute function trading.immutable_history();

-- All writers (owner commands, trusted imports, expiration) take this same
-- transaction lock. Nine-owner league: clarity and correctness over throughput.
create function trading.seed_picks(y integer) returns void language sql set search_path='' as $$
  insert into trading.picks(year,round,original_owner_id,owner_id)
  select y,r,o.id,o.id from draft.owners o cross join generate_series(1,10) r
  on conflict(year,round,original_owner_id) do nothing;
$$;

-- Trusted one-time cutover, not callable by owners. Supply the actual durable
-- ledger at deployment; never assume the checked-in copy is authoritative.
create function trading.import_pick_ledger(input jsonb) returns void language plpgsql set search_path='' as $$
declare item jsonb; p trading.picks; src uuid; dst uuid; original uuid; y integer;
begin
  perform pg_advisory_xact_lock(731943,1);
  if exists(select 1 from trading.ledger_import) then
    if (select ledger from trading.ledger_import) = input then return; end if;
    raise exception 'A different legacy ledger was already imported';
  end if;
  if exists(select 1 from trading.trades) then raise exception 'Import ledger before creating trades'; end if;
  if input->>'version' is distinct from '1' or jsonb_typeof(input->'trades') is distinct from 'array' then raise exception 'Invalid legacy ledger'; end if;
  y=extract(year from clock_timestamp() at time zone 'UTC')::integer;
  perform trading.seed_picks(y+1);perform trading.seed_picks(y+2);
  for item in select value from jsonb_array_elements(input->'trades') loop
    select id into src from draft.owners where display_name=item->>'from';
    select id into dst from draft.owners where display_name=item->>'to';
    select id into original from draft.owners where display_name=item->>'originalOwner';
    if src is null or dst is null or original is null or src=dst or coalesce(item->>'id','')='' or item->>'tradedAt' is null then raise exception 'Invalid legacy transfer'; end if;
    perform trading.seed_picks((item->>'year')::integer);
    select * into p from trading.picks where year=(item->>'year')::integer and round=(item->>'round')::integer and original_owner_id=original;
    if p.id is null or p.owner_id<>src then raise exception 'Contradictory legacy ownership'; end if;
    update trading.picks set owner_id=dst where id=p.id;
    insert into trading.pick_history(pick_id,from_owner_id,to_owner_id,reason,legacy_id,occurred_at)
      values(p.id,src,dst,'Legacy ledger import',item->>'id',(item->>'tradedAt')::timestamptz);
  end loop;
  insert into trading.ledger_import(ledger) values(input);
end $$;

create function trading.expire_offers() returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(731943,1);
  with changed as (update trading.trades set status='expired',revision=revision+1 where status='proposed' and expires_at<=clock_timestamp() returning id)
  insert into trading.events(trade_id,action) select id,'expired' from changed;
  get diagnostics n=row_count;return n;
end $$;

create function trading.notify(e bigint,owner uuid,kind text) returns void language sql set search_path='' as $$
  insert into trading.notifications(event_id,recipient_user_id,kind)
  select e,auth_user_id,kind from draft.owner_accounts where owner_id=owner
  on conflict(event_id,recipient_user_id) do nothing;
$$;

-- Confirmation only from newer, complete snapshots for every involved sport.
create function trading.reconcile() returns void language plpgsql set search_path='' as $$
declare t trading.trades;
begin
  perform pg_advisory_xact_lock(731943,1);
  for t in select * from trading.trades where status='accepted' loop
    if not exists(select 1 from trading.assets a join trading.players p on p.id=a.player_id
      join trading.roster_snapshots s on s.id=p.snapshot_id where a.trade_id=t.id and
      (p.owner_id is distinct from case when t.corrected_at is null then a.to_owner_id else a.from_owner_id end
       or s.observed_at<=coalesce(t.corrected_at,t.accepted_at))) then
      update trading.trades set status='completed',completed_at=clock_timestamp(),revision=revision+1 where id=t.id;
      delete from trading.player_reservations where trade_id=t.id;
      insert into trading.events(trade_id,action) values(t.id,'completed');
    end if;
  end loop;
end $$;

-- Complete per-sport import: exactly nine known owners, unique Fantrax IDs.
-- No browser grant. The later importer must call this only after validating
-- Fantrax success envelopes and completing all nine roster requests.
create function trading.ingest_rosters(sport_value draft.sport,league text,observed timestamptz,rosters jsonb) returns uuid
language plpgsql set search_path='' as $$
declare snap uuid; r jsonb; p jsonb; oid uuid; pid uuid; seen text[]='{}'; owners uuid[]='{}'; prior trading.roster_snapshots;
begin
  perform pg_advisory_xact_lock(731943,1);
  if sport_value is null or coalesce(league,'')='' or observed is null or observed>clock_timestamp() or jsonb_typeof(rosters) is distinct from 'array' or jsonb_array_length(rosters)<>9 then raise exception 'Complete nine-owner snapshot required'; end if;
  if exists(select 1 from trading.roster_snapshots where sport=sport_value and league_id<>league) or exists(select 1 from trading.roster_snapshots where league_id=league and sport<>sport_value) then raise exception 'League sport mapping changed'; end if;
  select * into prior from trading.roster_snapshots where league_id=league order by observed_at desc limit 1;
  if prior.observed_at=observed and prior.payload=rosters then return prior.id; end if;
  if prior.observed_at>=observed then raise exception 'Stale or conflicting snapshot'; end if;
  insert into trading.roster_snapshots(sport,league_id,observed_at,payload) values(sport_value,league,observed,rosters) returning id into snap;
  for r in select value from jsonb_array_elements(rosters) loop
    select id into oid from draft.owners where slug=r->>'owner';
    if oid is null or oid=any(owners) or jsonb_typeof(r->'players') is distinct from 'array' then raise exception 'Invalid snapshot owner'; end if;
    owners=array_append(owners,oid);
    for p in select value from jsonb_array_elements(r->'players') loop
      if coalesce(p->>'player_id','')='' or coalesce(trim(p->>'name'),'')='' or (p->>'player_id')=any(seen) then raise exception 'Invalid or duplicate player'; end if;
      seen=array_append(seen,p->>'player_id');
      insert into trading.players(sport,league_id,fantrax_id,name,owner_id,snapshot_id) values(sport_value,league,p->>'player_id',p->>'name',oid,snap)
        on conflict(league_id,fantrax_id) do update set name=excluded.name,owner_id=excluded.owner_id,snapshot_id=excluded.snapshot_id;
    end loop;
  end loop;
  update trading.players set owner_id=null,snapshot_id=snap where league_id=league and not(fantrax_id=any(seen));
  with changed as (
    update trading.trades t set status='invalidated',revision=revision+1 where status='proposed' and exists(
      select 1 from trading.assets a join trading.players p on p.id=a.player_id where a.trade_id=t.id and p.owner_id is distinct from a.from_owner_id) returning t.id
  ) insert into trading.events(trade_id,action) select id,'ownership_changed' from changed;
  perform trading.reconcile();return snap;
end $$;

create function public.trade_command(request_id uuid,action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; commissioner boolean; prior trading.requests; t trading.trades; parent trading.trades; target uuid;
  item jsonb; src uuid; dst uuid; asset_player uuid; asset_pick uuid; actual uuid; year_value integer;
  e bigint; result jsonb; asset_row trading.assets; current_year integer; projected_warnings jsonb;
begin
  select o.id into actor from draft.owner_accounts m join draft.owners o on o.id=m.owner_id where m.auth_user_id=auth.uid() and o.active;
  if actor is null then raise exception 'Owner account required' using errcode='42501'; end if;
  select exists(select 1 from draft.league_roles where auth_user_id=auth.uid() and role='commissioner') into commissioner;
  if request_id is null or action is null or args is null or jsonb_typeof(args)<>'object' then raise exception 'Invalid command'; end if;
  perform pg_advisory_xact_lock(731943,1);
  select * into prior from trading.requests where actor_user_id=auth.uid() and trading.requests.request_id=trade_command.request_id;
  if found then
    if prior.action<>action or prior.args<>args then raise exception 'Request ID reused with different command'; end if;
    return prior.result;
  end if;
  if not exists(select 1 from trading.ledger_import) then raise exception 'Import legacy pick ledger before enabling trades'; end if;
  current_year=extract(year from clock_timestamp() at time zone 'UTC')::integer;
  perform trading.seed_picks(current_year+1);perform trading.seed_picks(current_year+2);
  if action in ('propose','counter') then
    dst=(args->>'recipient_id')::uuid;
    if dst is null or dst=actor or not exists(select 1 from draft.owners o join draft.owner_accounts m on m.owner_id=o.id where o.id=dst and o.active) then raise exception 'Active receiving owner account required'; end if;
    if action='counter' then
      select * into parent from trading.trades where id=(args->>'trade_id')::uuid;
      if parent.recipient_id is distinct from actor then raise exception 'Only receiving owner can counter' using errcode='42501'; end if;
      if parent.proposer_id<>dst or parent.status<>'proposed' or parent.expires_at<=clock_timestamp() or parent.revision is distinct from (args->>'revision')::bigint then raise exception 'Offer changed or expired'; end if;
    end if;
    if jsonb_typeof(args->'assets') is distinct from 'array' or jsonb_array_length(args->'assets') not between 1 and 200 then raise exception 'Choose 1 to 200 assets'; end if;
    insert into trading.trades(proposer_id,recipient_id,parent_id,message) values(actor,dst,parent.id,coalesce(args->>'message','')) returning id into target;
    for item in select value from jsonb_array_elements(args->'assets') loop
      src=(item->>'from_owner_id')::uuid;asset_player=(item->>'player_id')::uuid;asset_pick=(item->>'pick_id')::uuid;
      if src is null or src not in (actor,dst) or num_nonnulls(asset_player,asset_pick)<>1 then raise exception 'Invalid trade asset'; end if;
      if asset_player is not null then
        select owner_id into actual from trading.players where id=asset_player;
        if exists(select 1 from trading.player_reservations where player_id=asset_player) then raise exception 'Player awaiting Fantrax transfer'; end if;
      else
        select owner_id,year into actual,year_value from trading.picks where id=asset_pick;
        if year_value not in (current_year+1,current_year+2) then raise exception 'Only next two rookie draft years can be traded'; end if;
      end if;
      if actual is distinct from src then raise exception 'Asset ownership changed'; end if;
      insert into trading.assets(trade_id,from_owner_id,to_owner_id,player_id,pick_id) values(target,src,case when src=actor then dst else actor end,asset_player,asset_pick);
    end loop;
    if parent.id is not null then
      update trading.trades set status='countered',revision=revision+1 where id=parent.id;
      insert into trading.events(trade_id,actor_user_id,action,details) values(parent.id,auth.uid(),'countered',jsonb_build_object('replacement_id',target));
    end if;
    insert into trading.events(trade_id,actor_user_id,action) values(target,auth.uid(),action) returning id into e;
    perform trading.notify(e,dst,case when action='counter' then 'counter' else 'proposal' end);
  elsif action in ('accept','decline','withdraw','correct') then
    target=(args->>'trade_id')::uuid;
    select * into t from trading.trades where id=target;
    if t.id is null then raise exception 'Trade unavailable' using errcode='42501'; end if;
    if action='correct' then
      if not commissioner or t.status not in ('accepted','completed') then raise exception 'Commissioner correction of accepted trades only' using errcode='42501'; end if;
    elsif (action='withdraw' and actor<>t.proposer_id) or (action in ('accept','decline') and actor<>t.recipient_id) then
      raise exception 'Trade action not permitted' using errcode='42501';
    end if;
    if t.revision is distinct from (args->>'revision')::bigint then raise exception 'Offer changed'; end if;
    if action<>'correct' and (t.status<>'proposed' or t.expires_at<=clock_timestamp()) then raise exception 'Offer closed or expired'; end if;
    if action='accept' and exists(select 1 from draft.owners where id in(t.proposer_id,t.recipient_id) and not active) then raise exception 'Trade owner is inactive'; end if;
    if action in ('decline','withdraw') then
      update trading.trades set status=case when action='decline' then 'declined' else 'withdrawn' end,revision=revision+1 where id=target;
      insert into trading.events(trade_id,actor_user_id,action) values(target,auth.uid(),action) returning id into e;
      if action='decline' then perform trading.notify(e,t.proposer_id,'decline'); end if;
    else
      if action='correct' and (t.corrected_at is not null or length(trim(coalesce(args->>'reason',''))) not between 1 and 2000) then raise exception 'One audited reversal requires a reason'; end if;
      for asset_row in select * from trading.assets where trade_id=target order by id loop
        src=case when action='correct' then asset_row.to_owner_id else asset_row.from_owner_id end;
        dst=case when action='correct' then asset_row.from_owner_id else asset_row.to_owner_id end;
        if asset_row.pick_id is not null then
          select owner_id,year into actual,year_value from trading.picks where id=asset_row.pick_id;
          if actual is distinct from src then raise exception 'Pick ownership changed; cannot transfer'; end if;
          if action='accept' and year_value not in (current_year+1,current_year+2) then raise exception 'Pick year no longer eligible'; end if;
          update trading.picks set owner_id=dst where id=asset_row.pick_id;
          insert into trading.pick_history(pick_id,from_owner_id,to_owner_id,reason) values(asset_row.pick_id,src,dst,action||' trade '||target::text);
        else
          select owner_id into actual from trading.players where id=asset_row.player_id;
          if (action='accept' and actual is distinct from src) or (action='correct' and (actual is null or actual not in (src,dst))) then raise exception 'Player ownership changed'; end if;
          if exists(select 1 from trading.player_reservations where player_id=asset_row.player_id and (action='accept' or trade_id<>target)) then raise exception 'Player already committed'; end if;
          insert into trading.player_reservations values(asset_row.player_id,target) on conflict(player_id) do nothing;
        end if;
      end loop;
      -- Warn only: do not reuse draft-time minimum feasibility enforcement.
      select coalesce(jsonb_agg(jsonb_build_object('owner_id',o.id,'sport',r.sport,'minimum',r.minimum,'projected',c.n)),'[]') into projected_warnings
      from draft.owners o cross join (values('NFL',9),('NBA',8),('MLB',14),('EPL',11),('PGA',6)) r(sport,minimum)
      cross join lateral (select count(*)::integer n from trading.players p where p.sport::text=r.sport and
        coalesce((select case when action='correct' then a.from_owner_id else a.to_owner_id end from trading.assets a where a.trade_id=target and a.player_id=p.id),p.owner_id)=o.id) c
      where o.id in(t.proposer_id,t.recipient_id) and c.n<r.minimum;
      update trading.trades set status='accepted',accepted_at=coalesce(accepted_at,clock_timestamp()),completed_at=null,
        corrected_at=case when action='correct' then clock_timestamp() else corrected_at end,revision=revision+1,warnings=projected_warnings where id=target;
      insert into trading.events(trade_id,actor_user_id,action,details) values(target,auth.uid(),action,jsonb_build_object('reason',args->>'reason','warnings',projected_warnings)) returning id into e;
      if action='accept' then perform trading.notify(e,t.proposer_id,'acceptance');perform trading.notify(e,t.recipient_id,'acceptance'); end if;
      with changed as (
        update trading.trades other set status='invalidated',revision=revision+1 where other.status='proposed' and other.id<>target and exists(
          select 1 from trading.assets x join trading.assets y on x.player_id=y.player_id or x.pick_id=y.pick_id where x.trade_id=target and y.trade_id=other.id) returning other.id
      ) insert into trading.events(trade_id,action) select id,'conflicting_trade_accepted' from changed;
      perform trading.reconcile();
    end if;
  else raise exception 'Unknown trade action'; end if;
  select jsonb_build_object('trade_id',id,'status',status,'revision',revision,'warnings',trades.warnings) into result from trading.trades where id=target;
  insert into trading.requests values(auth.uid(),request_id,action,args,result);
  return result;
end $$;

create function public.trade_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid;
begin
  select o.id into actor from draft.owner_accounts m join draft.owners o on o.id=m.owner_id where m.auth_user_id=auth.uid() and o.active;
  if actor is null then raise exception 'Owner account required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'proposer_id',t.proposer_id,'recipient_id',t.recipient_id,
    'status',case when t.status='proposed' and t.expires_at<=clock_timestamp() then 'expired' else t.status end,
    'revision',t.revision,'expires_at',t.expires_at,'accepted_at',t.accepted_at,'completed_at',t.completed_at,'corrected_at',t.corrected_at,
    'message',case when actor in(t.proposer_id,t.recipient_id) then t.message else null end,
    'assets',(select jsonb_agg(jsonb_build_object('from_owner_id',a.from_owner_id,'to_owner_id',a.to_owner_id,'player_id',a.player_id,'pick_id',a.pick_id)) from trading.assets a where a.trade_id=t.id)) order by t.created_at desc)
    from trading.trades t where actor in(t.proposer_id,t.recipient_id) or t.accepted_at is not null),'[]');
end $$;

do $$declare t record;begin
  for t in select tablename from pg_tables where schemaname='trading' loop
    execute format('alter table trading.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema trading from public,anon,authenticated;
revoke all on all sequences in schema trading from public,anon,authenticated;
revoke all on all functions in schema trading from public,anon,authenticated;
revoke all on function public.trade_command(uuid,text,jsonb),public.trade_list() from public,anon,authenticated;
grant execute on function public.trade_command(uuid,text,jsonb),public.trade_list() to authenticated;
notify pgrst,'reload schema';
commit;
