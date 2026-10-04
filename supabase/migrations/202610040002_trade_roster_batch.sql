-- Delay proposal invalidation and accepted-trade completion until all five
-- new roster snapshots are loaded. Private administrator-only batch operation.
begin;
create function trading.ingest_rosters(sport_value draft.sport,league text,observed timestamptz,rosters jsonb,defer_reconciliation boolean) returns uuid
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
  if not defer_reconciliation then
  with changed as (
    update trading.trades t set status='invalidated',revision=revision+1 where status='proposed' and exists(
      select 1 from trading.assets a join trading.players p on p.id=a.player_id where a.trade_id=t.id and p.owner_id is distinct from a.from_owner_id) returning t.id
  ) insert into trading.events(trade_id,action) select id,'ownership_changed' from changed;
  perform trading.reconcile();
  end if;
  return snap;
end $$;

revoke all on function trading.ingest_rosters(draft.sport,text,timestamptz,jsonb,boolean) from public,anon,authenticated;

-- Preserve the existing four-argument manual importer and its access controls.
create or replace function trading.ingest_rosters(sport_value draft.sport,league text,observed timestamptz,rosters jsonb)
returns uuid language sql set search_path='' as $$
  select trading.ingest_rosters(sport_value,league,observed,rosters,false);
$$;

create function trading.ingest_roster_batch(snapshots jsonb) returns void
language plpgsql set search_path='' as $$
declare s jsonb;
begin
  perform pg_advisory_xact_lock(731943,1);
  if jsonb_typeof(snapshots) is distinct from 'array' or jsonb_array_length(snapshots)<>5 then
    raise exception 'All five roster snapshots required';
  end if;
  if (select count(distinct value->>'sport') from jsonb_array_elements(snapshots))<>5
    or exists(select 1 from jsonb_array_elements(snapshots) where value->>'sport' is null
      or value->>'sport' not in ('NFL','MLB','NBA','EPL','PGA')) then
    raise exception 'Exactly one snapshot per sport required';
  end if;
  for s in select value from jsonb_array_elements(snapshots) loop
    perform trading.ingest_rosters((s->>'sport')::draft.sport,s->>'league',
      (s->>'observed')::timestamptz,s->'rosters',true);
  end loop;
  with changed as (
    update trading.trades t set status='invalidated',revision=revision+1 where status='proposed' and exists(
      select 1 from trading.assets a join trading.players p on p.id=a.player_id where a.trade_id=t.id and p.owner_id is distinct from a.from_owner_id) returning t.id
  ) insert into trading.events(trade_id,action) select id,'ownership_changed' from changed;
  perform trading.reconcile();
end $$;
revoke all on function trading.ingest_roster_batch(jsonb) from public,anon,authenticated;
commit;
