begin;
select pg_advisory_xact_lock(731943,1);
-- Mirrors web/data/rookie-draft-policy.json. Existing 2028 assets are unchanged.
create function trading.first_rookie_pick_year(at_time timestamptz default now()) returns integer
language sql stable set search_path='' as $$
 select greatest(2028,extract(year from at_time at time zone 'UTC')::integer+1)
$$;
revoke all on function trading.first_rookie_pick_year(timestamptz) from public,anon,authenticated;

-- Retire by eligibility, not deletion or relabeling. Accepted trade history and
-- ownership of 2027 picks stay intact for audit and commissioner reversals.
with closed as (
 update trading.trades t set status='invalidated',revision=revision+1
 where t.status='proposed' and exists(select 1 from trading.assets a join trading.picks p on p.id=a.pick_id where a.trade_id=t.id and p.year=2027)
 returning t.id
) insert into trading.events(trade_id,action,details)
 select id,'rookie_2027_retired','{"reason":"No 2027 annual draft; existing 2028 ownership retained, 2029 picks added"}'::jsonb from closed;

-- Keep existing commands/validations; replace only the rolling pick horizon.
do $$ declare fn text; definition text; patched text; begin
 foreach fn in array array['public.trade_command(uuid,text,jsonb)','trading.import_pick_ledger(jsonb)',
 'draft.configure_membership(integer,jsonb,numeric[],uuid)','trading.ingest_roster_batch_without_alerts(jsonb)',
 'public.trade_rosters_before_prospects()'] loop
  select pg_get_functiondef(fn::regprocedure) into definition;
  patched=replace(replace(definition,'current_year+1','trading.first_rookie_pick_year()'),'current_year+2','(trading.first_rookie_pick_year()+1)');
  patched=replace(replace(patched,'y+1','trading.first_rookie_pick_year()'),'y+2','(trading.first_rookie_pick_year()+1)');
  patched=replace(patched,'extract(year from current_timestamp at time zone ''UTC'')::int+1','trading.first_rookie_pick_year()');
  patched=replace(patched,'extract(year from current_timestamp at time zone ''UTC'')::int+2','(trading.first_rookie_pick_year()+1)');
  if patched=definition then raise exception 'Expected pick-year expression missing in %',fn; end if;
  execute patched;
 end loop;
end $$;

create or replace function public.rookie_pick_ownership() returns jsonb
language sql stable security definer set search_path='' as $$
 with years as(select trading.first_rookie_pick_year() y),
 picks as(select p.* from trading.picks p,years where p.year in(y,y+1))
 select jsonb_build_object('years',jsonb_build_array(y,y+1),
 'ledger_ready',exists(select 1 from trading.ledger_import) and not exists(
 select 1 from draft.owners o cross join generate_series(y,y+1) yr where o.active and
 (select count(*) from picks p where p.original_owner_id=o.id and p.year=yr)<>10),
 'owners',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.display_name,'slug',o.slug) order by o.display_name)
 from draft.owners o where o.active or exists(select 1 from picks p where o.id in(p.owner_id,p.original_owner_id))),'[]'::jsonb),
 'picks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'year',p.year,'round',p.round,'owner_id',p.owner_id,'original_owner_id',p.original_owner_id) order by p.year,p.round,p.id) from picks p),'[]'::jsonb)) from years
$$;
do $$ begin
 if exists(select 1 from trading.ledger_import) then
  perform trading.seed_picks(trading.first_rookie_pick_year());
  perform trading.seed_picks(trading.first_rookie_pick_year()+1);
 end if;
end $$;
notify pgrst,'reload schema';
commit;
