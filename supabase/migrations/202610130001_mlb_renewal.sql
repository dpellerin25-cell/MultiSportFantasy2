-- Explicit administrator handoff only. Installing does not activate a renewal.
begin;
create table trading.league_renewals (
  sport draft.sport primary key,
  old_league_id text not null unique,
  new_league_id text not null unique,
  history_id text not null,
  activated_at timestamptz not null default clock_timestamp(),
  check(old_league_id<>new_league_id)
);
alter table trading.league_renewals enable row level security;
revoke all on trading.league_renewals from public,anon,authenticated;

-- Limited to the verified MLB pair. Future renewals require separate approval.
create function trading.prepare_mlb_renewal(apply_change boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare old_id constant text='60ri2nbhmtj4b0km'; new_id constant text='rk8bvnk3mulovx9a';
  blockers text[]='{}'; n integer; sources integer; pending integer;
begin
  perform pg_advisory_xact_lock(731943,1);
  perform pg_advisory_xact_lock(20260925,1);
  if exists(select 1 from trading.league_renewals where sport='MLB' and old_league_id=old_id and new_league_id=new_id) then
    return jsonb_build_object('already_applied',true,'old_league_id',old_id,'new_league_id',new_id);
  end if;
  if exists(select 1 from trading.league_renewals where sport='MLB') then blockers=array_append(blockers,'Different MLB transition already registered'); end if;
  if exists(select 1 from trading.roster_snapshots where (sport='MLB' and league_id<>old_id) or (league_id in(old_id,new_id) and sport<>'MLB')) then blockers=array_append(blockers,'Unexpected roster league mapping'); end if;
  if exists(select 1 from trading.players where (sport='MLB' and league_id<>old_id) or (league_id=old_id and sport<>'MLB')) then blockers=array_append(blockers,'Unexpected trade player mapping'); end if;
  if exists(select 1 from draft.player_source_ids s join draft.players p on p.id=s.player_id where s.provider='fantrax' and s.league_id=old_id and p.sport<>'MLB') then blockers=array_append(blockers,'Draft source sport mismatch'); end if;
  if exists(select 1 from draft.player_source_ids where provider='fantrax' and league_id=new_id) then blockers=array_append(blockers,'New league already has source identities; manual review required'); end if;
  select count(*) into n from trading.players where league_id=old_id;
  select count(*) into sources from draft.player_source_ids where provider='fantrax' and league_id=old_id;
  select count(distinct t.id) into pending from trading.trades t join trading.assets a on a.trade_id=t.id join trading.players p on p.id=a.player_id where p.league_id=old_id and t.status in('proposed','accepted');
  if apply_change then
    if cardinality(blockers)>0 then raise exception 'MLB renewal blocked; inspect preview'; end if;
    insert into trading.league_renewals(sport,old_league_id,new_league_id,history_id) values('MLB',old_id,new_id,'ml3fdlq2mulovxoh');
    -- Preserve internal IDs, ownership, reservations, assets and historic snapshots.
    update trading.players set league_id=new_id where sport='MLB' and league_id=old_id;
    -- Keep old source rows referenced by frozen draft pools; add new aliases.
    insert into draft.player_source_ids(player_id,provider,league_id,external_player_id)
      select player_id,provider,new_id,external_player_id from draft.player_source_ids where provider='fantrax' and league_id=old_id;
  end if;
  return jsonb_build_object('applied',apply_change,'old_league_id',old_id,'new_league_id',new_id,
    'trade_players',n,'draft_source_aliases',sources,'pending_trades',pending,'blockers',to_jsonb(blockers));
end $$;
revoke all on function trading.prepare_mlb_renewal(boolean) from public,anon,authenticated;
create or replace function trading.ingest_rosters(sport_value draft.sport,league text,observed timestamptz,rosters jsonb,defer_reconciliation boolean) returns uuid
language plpgsql set search_path='' as $$
declare snap uuid; r jsonb; p jsonb; oid uuid; pid uuid; seen text[]='{}'; owners uuid[]='{}'; prior trading.roster_snapshots;
begin
  perform pg_advisory_xact_lock(731943,1);
  if sport_value is null or coalesce(league,'')='' or observed is null or observed>clock_timestamp() or jsonb_typeof(rosters) is distinct from 'array' or jsonb_array_length(rosters)<>(select count(*) from draft.owners where active) then raise exception 'Complete active-owner snapshot required'; end if;
  if exists(select 1 from trading.league_renewals where sport=sport_value) then
    if not exists(select 1 from trading.league_renewals where sport=sport_value and new_league_id=league) then raise exception 'Retired league connection'; end if;
  elsif exists(select 1 from trading.roster_snapshots where sport=sport_value and league_id<>league) or exists(select 1 from trading.roster_snapshots where league_id=league and sport<>sport_value) then raise exception 'League sport mapping changed'; end if;
  select * into prior from trading.roster_snapshots where sport=sport_value order by observed_at desc limit 1;
  if prior.league_id=league and prior.observed_at=observed and prior.payload=rosters then return prior.id; end if;
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


commit;
