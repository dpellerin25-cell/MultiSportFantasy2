begin;
-- Read-only public catalogue. No account IDs, negotiations, messages or history.
create function public.rookie_pick_ownership() returns jsonb
language sql stable security definer set search_path='' as $$
  with years as (select extract(year from current_timestamp at time zone 'UTC')::int y),
  picks as (select p.* from trading.picks p,years where p.year in(y+1,y+2))
  select jsonb_build_object(
    'years',jsonb_build_array(y+1,y+2),
    'ledger_ready',exists(select 1 from trading.ledger_import) and not exists(
      select 1 from draft.owners o cross join generate_series(y+1,y+2) yr
      where o.active and (select count(*) from picks p where p.original_owner_id=o.id and p.year=yr)<>10),
    'owners',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.display_name,'slug',o.slug) order by o.display_name)
      from draft.owners o where o.active or exists(select 1 from picks p where o.id in(p.owner_id,p.original_owner_id))),'[]'::jsonb),
    'picks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'year',p.year,'round',p.round,'owner_id',p.owner_id,'original_owner_id',p.original_owner_id) order by p.year,p.round,p.id) from picks p),'[]'::jsonb))
  from years;
$$;
revoke all on function public.rookie_pick_ownership() from public;
grant execute on function public.rookie_pick_ownership() to anon,authenticated;
-- Initial cutover only after the existing ledger has been imported. Never reset ownership.
do $$
begin
  perform pg_advisory_xact_lock(731943,1);
  if exists(select 1 from trading.ledger_import) then
    perform trading.seed_picks(extract(year from current_timestamp at time zone 'UTC')::int+1);
    perform trading.seed_picks(extract(year from current_timestamp at time zone 'UTC')::int+2);
  end if;
end $$;
-- Daily trusted refresh maintains the rolling two-year horizon, not public reads.
create or replace function trading.ingest_roster_batch(snapshots jsonb) returns void
language plpgsql set search_path='' as $$
declare s jsonb;
begin
  perform pg_advisory_xact_lock(731943,1);
  if exists(select 1 from trading.ledger_import) then
    perform trading.seed_picks(extract(year from current_timestamp at time zone 'UTC')::int+1);
    perform trading.seed_picks(extract(year from current_timestamp at time zone 'UTC')::int+2);
  end if;
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
notify pgrst,'reload schema';
commit;
