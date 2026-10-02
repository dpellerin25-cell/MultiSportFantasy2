-- Additive pre-draft configuration. No automatic membership changes.
begin;
-- PostgreSQL assigns this name to the original startup check.
alter table draft.drafts drop constraint drafts_check;
alter table draft.drafts add constraint startup_round_count check(kind<>'startup' or rounds=65);
create table draft.season_settings (
  championship_year integer primary key check(championship_year>=2027),
  owner_slugs text[] not null check(cardinality(owner_slugs)>=2),
  placement_points numeric[] not null,
  configured_at timestamptz not null default clock_timestamp(),
  check(cardinality(owner_slugs)=cardinality(placement_points))
);
alter table draft.season_settings enable row level security;
revoke all on draft.season_settings from public,anon,authenticated;
insert into draft.season_settings values(2027,array['brendan','chris','doug','hatch','jack','jacob','nik','ryan','tucker'],array[100,80,65,52,40,30,20,10,0],clock_timestamp());

create table draft.membership_events (
 id bigint generated always as identity primary key,
 championship_year integer not null,
 commissioner uuid not null references auth.users(id),
 configuration jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
alter table draft.membership_events enable row level security;
revoke all on draft.membership_events from public,anon,authenticated;
create trigger immutable_membership_events before update or delete on draft.membership_events for each row execute function trading.immutable_history();

-- Trusted administration only; browser roles cannot call this function.
-- Caller supplies a verified commissioner identity; account grants are unchanged.
create function draft.configure_membership(year_value integer, members jsonb, points numeric[], commissioner uuid) returns void
language plpgsql set search_path='' as $$
declare slugs text[]; names text[]; removed uuid[]; y integer;
begin
  perform pg_advisory_xact_lock(20260925,2);
  perform pg_advisory_xact_lock(731943,1);
  lock table draft.drafts in share row exclusive mode;
  if not exists(select 1 from draft.league_roles where auth_user_id=commissioner and role='commissioner') then raise exception 'Verified commissioner required'; end if;
  if jsonb_typeof(members) is distinct from 'array' then raise exception 'Member array required'; end if;
  select array_agg(m->>'slug' order by m->>'slug'),array_agg(m->>'name' order by m->>'slug') into slugs,names from jsonb_array_elements(members) m;
  if cardinality(slugs)<2 or cardinality(slugs) is null or cardinality(slugs)<>(select count(distinct s) from unnest(slugs) s)
    or exists(select 1 from unnest(slugs) s where s is null or s !~ '^[a-z][a-z0-9_-]*$')
    or cardinality(names)<>(select count(distinct n) from unnest(names) n)
    or array_ndims(points) is distinct from 1 or array_lower(points,1) is distinct from 1
    or exists(select 1 from unnest(names) n where n is null or trim(n)='' or length(n)>120)
    or cardinality(points) is distinct from cardinality(slugs)
    or exists(select 1 from unnest(points) p where p is null or p<0 or p::text in ('NaN','Infinity','-Infinity'))
    or exists(select 1 from generate_subscripts(points,1) i where i>1 and points[i]>=points[i-1]) then raise exception 'Unique members and a descending nonnegative placement table required'; end if;
  -- Existing setup drafts must be explicitly cancelled and recreated; never rewrite picks.
  if exists(select 1 from draft.drafts where championship_year>=year_value and current_pick_number is not null)
    or exists(select 1 from draft.drafts where status not in ('cancelled','completed'))
    or exists(select 1 from draft.drafts where championship_year>=year_value and status='completed') then raise exception 'Cancel unused setup drafts first; started or completed seasons cannot change membership'; end if;
  if exists(select 1 from draft.season_settings where championship_year>year_value) then raise exception 'Historical season configuration is protected'; end if;
  if exists(select 1 from draft.owners o join jsonb_array_elements(members) m on o.slug=m->>'slug' where o.display_name<>m->>'name') then raise exception 'Use existing owner display names; renaming is a separate historical operation'; end if;
  if not exists(select 1 from draft.owner_accounts a join draft.owners o on o.id=a.owner_id where a.auth_user_id=commissioner and o.slug=any(slugs)) then raise exception 'Commissioner must remain an active member'; end if;
  select coalesce(array_agg(id),'{}') into removed from draft.owners where active and not(slug=any(slugs));
  if exists(select 1 from trading.players where owner_id=any(removed))
    or exists(select 1 from trading.trades where status in ('proposed','accepted') and (proposer_id=any(removed) or recipient_id=any(removed)))
    or exists(select 1 from trading.picks p where (p.original_owner_id=any(removed) or p.owner_id=any(removed)) and
      (p.owner_id<>p.original_owner_id or exists(select 1 from trading.pick_history h where h.pick_id=p.id) or exists(select 1 from trading.assets a where a.pick_id=p.id)))
    then raise exception 'Resolve roster assets, proposals and pick history before removing an owner'; end if;
  delete from trading.picks where original_owner_id=any(removed) and owner_id=original_owner_id
    and year>=extract(year from current_date)::integer+1;
  update draft.owners set active=false where id=any(removed);
  insert into draft.owners(slug,display_name) select m->>'slug',m->>'name' from jsonb_array_elements(members) m
    on conflict(slug) do update set active=true; -- Names are historical identities; replacements use a separate process.
  insert into draft.season_settings(championship_year,owner_slugs,placement_points) values(year_value,slugs,points)
    on conflict(championship_year) do update set owner_slugs=excluded.owner_slugs,placement_points=excluded.placement_points,configured_at=clock_timestamp();
  insert into draft.membership_events(championship_year,commissioner,configuration) values(year_value,commissioner,jsonb_build_object('owners',members,'placement_points',points));
  if exists(select 1 from trading.ledger_import) then
    y=extract(year from current_date)::integer;
    perform trading.seed_picks(y+1);perform trading.seed_picks(y+2);
  end if;
end $$;
revoke all on function draft.configure_membership(integer,jsonb,numeric[],uuid) from public,anon,authenticated;
create or replace function trading.seed_picks(y integer) returns void language sql set search_path='' as $$
  insert into trading.picks(year,round,original_owner_id,owner_id)
  select y,r,o.id,o.id from draft.owners o cross join generate_series(1,10) r where o.active
  on conflict(year,round,original_owner_id) do nothing;
$$;
create or replace function trading.ingest_rosters(sport_value draft.sport,league text,observed timestamptz,rosters jsonb) returns uuid
language plpgsql set search_path='' as $$
declare snap uuid; r jsonb; p jsonb; oid uuid; pid uuid; seen text[]='{}'; owners uuid[]='{}'; prior trading.roster_snapshots;
begin
  perform pg_advisory_xact_lock(731943,1);
  if sport_value is null or coalesce(league,'')='' or observed is null or observed>clock_timestamp() or jsonb_typeof(rosters) is distinct from 'array' or jsonb_array_length(rosters)<>(select count(*) from draft.owners where active) then raise exception 'Complete active-owner snapshot required'; end if;
  if exists(select 1 from trading.roster_snapshots where sport=sport_value and league_id<>league) or exists(select 1 from trading.roster_snapshots where league_id=league and sport<>sport_value) then raise exception 'League sport mapping changed'; end if;
  select * into prior from trading.roster_snapshots where league_id=league order by observed_at desc limit 1;
  if prior.observed_at=observed and prior.payload=rosters then return prior.id; end if;
  if prior.observed_at>=observed then raise exception 'Stale or conflicting snapshot'; end if;
  insert into trading.roster_snapshots(sport,league_id,observed_at,payload) values(sport_value,league,observed,rosters) returning id into snap;
  for r in select value from jsonb_array_elements(rosters) loop
    select id into oid from draft.owners where slug=r->>'owner' and active;
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

create function draft.validate_startup_membership() returns trigger language plpgsql set search_path='' as $$
declare s draft.season_settings; actual text[];
begin
  if new.kind='startup' and new.status='running' and old.status='setup' then
    select * into s from draft.season_settings where championship_year=new.championship_year;
    select array_agg(o.slug order by o.slug) into actual from draft.draft_participants p join draft.owners o on o.id=p.owner_id where p.draft_id=new.id and o.active;
    if s.championship_year is null or actual is distinct from s.owner_slugs or cardinality(actual)<>new.participant_count then raise exception 'Startup membership must match approved season settings'; end if;
  end if;
  return new;
end $$;
revoke all on function draft.validate_startup_membership() from public,anon,authenticated;
create trigger startup_membership before update on draft.drafts for each row execute function draft.validate_startup_membership();
commit;
