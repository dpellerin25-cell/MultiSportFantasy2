-- Sorting is global, before pagination. The cursor remains a player UUID so
-- existing clients keep working; its sort key comes from the frozen pool even
-- if that player was drafted since the preceding request.
create or replace function public.draft_available_players(target uuid,sport_filter text default null,search_text text default '',after_player uuid default null,page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform draft.require_member(target);
  if page_size is null or page_size<1 or page_size>100 or search_text is null or length(search_text)>100
    or (sport_filter is not null and sport_filter not in ('NFL','MLB','NBA','EPL','PGA')) then
    raise exception 'Invalid player search' using errcode='22023';
  end if;
  if after_player is not null and not exists(select 1 from draft.draft_pool_players where draft_id=target and player_id=after_player) then
    raise exception 'Invalid player cursor' using errcode='22023';
  end if;
  with pool as materialized (
    select p.*,draft.ranking_name_key(p.name) name_key,
      count(*) over(partition by p.sport,draft.ranking_name_key(p.name)) identity_count
    from draft.draft_pool_players p where p.draft_id=target
  ), unique_ranks as (
    select sport,name_key,min(rank) rank from draft.player_ranking_snapshot group by sport,name_key having count(*)=1
  ), ranked as materialized (
    select p.*,r.rank,coalesce(r.rank,2147483647) sort_rank,
      case when r.rank is null then '' else p.sport::text end sort_sport,lower(p.name) sort_name
    from pool p left join unique_ranks r on r.sport=p.sport::text and r.name_key=p.name_key and p.identity_count=1
  ), anchor as (
    select * from ranked where player_id=after_player
  ), candidates as (
    select p.* from ranked p where p.eligible
      and (sport_filter is null or p.sport::text=sport_filter)
      and strpos(lower(p.name),lower(search_text))>0
      and (after_player is null or (p.sort_rank,p.sort_sport,p.sort_name,p.player_id) > (select sort_rank,sort_sport,sort_name,player_id from anchor))
      and not exists(select 1 from draft.draft_selections s where s.draft_id=target and s.player_id=p.player_id and s.voided_at is null)
    order by p.sort_rank,p.sort_sport,p.sort_name,p.player_id limit page_size+1
  ), page as (select * from candidates order by sort_rank,sort_sport,sort_name,player_id limit page_size)
  select jsonb_build_object('draft_id',target,'revision',(select revision from draft.drafts where id=target),
    'ranking_snapshot','2026-09-29',
    'players',coalesce((select jsonb_agg(jsonb_build_object('player_id',player_id,'player_name',name,'sport',sport,'position',position,'professional_team',professional_team,'availability_status',availability,'source_rank',rank) order by sort_rank,sort_sport,sort_name,player_id) from page),'[]'::jsonb),
    'next_cursor',case when (select count(*) from candidates)>page_size then (select player_id from page order by sort_rank desc,sort_sport desc,sort_name desc,player_id desc limit 1) else null end
  ) into result;
  return result;
end $$;
revoke all on function public.draft_available_players(uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.draft_available_players(uuid,text,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
