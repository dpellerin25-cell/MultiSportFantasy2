begin;
-- Read-only catalogue for mapped owners. Never expose account IDs or credentials.
create function public.trade_rosters() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid; y integer;
begin
  select o.id into viewer from draft.owner_accounts m join draft.owners o on o.id=m.owner_id where m.auth_user_id=auth.uid() and o.active;
  if viewer is null then raise exception 'Owner account required' using errcode='42501'; end if;
  y=extract(year from current_timestamp at time zone 'UTC')::integer;
  return jsonb_build_object('viewer_owner_id',viewer,'ledger_ready',exists(select 1 from trading.ledger_import),
    'owners',(select jsonb_agg(jsonb_build_object('id',o.id,'name',o.display_name,'slug',o.slug,
      'can_receive',exists(select 1 from draft.owner_accounts m where m.owner_id=o.id)) order by o.display_name) from draft.owners o where o.active),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'owner_id',p.owner_id,'name',p.name,'sport',p.sport,
      'fantrax_id',p.fantrax_id,'league_id',p.league_id,'reserved',exists(select 1 from trading.player_reservations r where r.player_id=p.id))) from trading.players p where p.owner_id is not null),'[]'),
    'picks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'owner_id',p.owner_id,'original_owner_id',p.original_owner_id,'year',p.year,'round',p.round) order by p.year,p.round) from trading.picks p where p.year in(y+1,y+2)),'[]'));
end $$;
revoke all on function public.trade_rosters() from public,anon,authenticated;
grant execute on function public.trade_rosters() to authenticated;
notify pgrst,'reload schema';
commit;
