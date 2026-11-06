begin;
-- Commissioner-approved catalogue correction only. Preserve Fantrax identities,
-- imported snapshots and every existing draft/selection.
create table if not exists draft.prospect_catalog_removals (
 catalogue_id text primary key,
 original_record jsonb not null,
 reason text not null,
 removed_at timestamptz not null default clock_timestamp()
);
alter table draft.prospect_catalog_removals enable row level security;
revoke all on draft.prospect_catalog_removals from public,anon,authenticated;
do $$ begin
 perform pg_advisory_xact_lock(731943,1);
 if exists(select 1 from draft.draft_pool_players where prospect_catalog_id in
 ('startup-2027-021','startup-2027-042','startup-2027-080')) then
  raise exception 'Excluded prospects already attached; review draft before removing catalogue entries';
 end if;
 insert into draft.prospect_catalog_removals(catalogue_id,original_record,reason)
 select id,to_jsonb(c),'Commissioner requested removal of Jackson Harris, Brandon McCoy Jr. and Alejandro Garnacho from startup prospects'
 from draft.prospect_catalog c where id in ('startup-2027-021','startup-2027-042','startup-2027-080')
 on conflict(catalogue_id) do nothing;
 delete from draft.prospect_catalog where id in ('startup-2027-021','startup-2027-042','startup-2027-080');
end $$;
commit;
