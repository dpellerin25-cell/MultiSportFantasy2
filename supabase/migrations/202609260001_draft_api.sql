begin;
-- Private helper executes only inside the authorized read functions.
create function draft.require_member(target uuid) returns void
language plpgsql stable set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from draft.league_roles where auth_user_id=auth.uid() and role='commissioner')
    and not exists(select 1 from draft.owner_accounts a join draft.owners o on o.id=a.owner_id
      join draft.draft_participants p on p.owner_id=o.id
      where a.auth_user_id=auth.uid() and o.active and p.draft_id=target) then
    raise exception 'Draft access denied' using errcode='42501';
  end if;
  if not exists(select 1 from draft.drafts where id=target) then
    raise exception 'Draft access denied' using errcode='42501';
  end if;
end $$;
revoke all on function draft.require_member(uuid) from public,anon,authenticated;

-- Narrow HTTP mutation surface: reuse all locking, authorization, revision,
-- uniqueness and idempotency checks from the existing engine unchanged.
create function public.draft_command(target uuid,request_id uuid,expected_revision bigint,action text,args jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select draft.command(target,request_id,expected_revision,action,args);
$$;

create function public.draft_state(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform draft.require_member(target);
  select jsonb_build_object(
    'draft_id',d.id,'name',d.name,'status',d.status,'kind',d.kind,
    'championship_year',d.championship_year,'rounds',d.rounds,'revision',d.revision,
    'current_pick_number',d.current_pick_number,'timer_seconds',d.pick_duration_seconds,
    'deadline_at',d.deadline_at,'paused_remaining_seconds',d.paused_remaining_seconds,
    'server_time',statement_timestamp(),
    'viewer_owner_id',(select owner_id from draft.owner_accounts where auth_user_id=auth.uid()),
    'viewer_is_commissioner',exists(select 1 from draft.league_roles where auth_user_id=auth.uid() and role='commissioner'),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('owner_id',o.id,'slug',o.slug,'display_name',o.display_name,'order_position',p.order_position) order by p.order_position)
      from draft.draft_participants p join draft.owners o on o.id=p.owner_id where p.draft_id=target),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(jsonb_build_object('sport',sport,'minimum',minimum,'maximum',maximum) order by sport) from draft.draft_sport_rules where draft_id=target),'[]'::jsonb),
    'picks',coalesce((select jsonb_agg(jsonb_build_object('pick_id',p.id,'round',p.round,'pick_number',p.overall_pick_number,
      'original_owner_id',p.original_owner_id,'owner_id',p.current_owner_id,'skipped_at',p.skipped_at,
      'selection_id',s.id,'player_id',s.player_id,'sport',s.sport,'selected_at',s.selected_at,
      'player_name',pl.name,'position',pl.position,'professional_team',pl.professional_team) order by p.overall_pick_number)
      from draft.draft_picks p left join draft.draft_selections s on s.pick_id=p.id and s.voided_at is null
      left join draft.draft_pool_players pl on pl.draft_id=p.draft_id and pl.player_id=s.player_id where p.draft_id=target),'[]'::jsonb)
  ) into result from draft.drafts d where d.id=target;
  return result;
end $$;

create function public.draft_available_players(target uuid,sport_filter text default null,search_text text default '',after_player uuid default null,page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform draft.require_member(target);
  if page_size is null or page_size<1 or page_size>100 or search_text is null or length(search_text)>100
    or (sport_filter is not null and sport_filter not in ('NFL','MLB','NBA','EPL','PGA')) then
    raise exception 'Invalid player search' using errcode='22023';
  end if;
  with candidates as (
    select p.* from draft.draft_pool_players p where p.draft_id=target and p.eligible
      and (sport_filter is null or p.sport::text=sport_filter)
      and strpos(lower(p.name),lower(search_text))>0
      and (after_player is null or p.player_id>after_player)
      and not exists(select 1 from draft.draft_selections s where s.draft_id=target and s.player_id=p.player_id and s.voided_at is null)
    order by p.player_id limit page_size+1
  ), page as (select * from candidates order by player_id limit page_size)
  select jsonb_build_object('draft_id',target,'revision',(select revision from draft.drafts where id=target),
    'players',coalesce((select jsonb_agg(jsonb_build_object('player_id',player_id,'player_name',name,'sport',sport,'position',position,'professional_team',professional_team,'availability_status',availability) order by player_id) from page),'[]'::jsonb),
    'next_cursor',case when (select count(*) from candidates)>page_size then (select player_id from page order by player_id desc limit 1) else null end
  ) into result;
  return result;
end $$;

revoke all on function public.draft_command(uuid,uuid,bigint,text,jsonb),public.draft_state(uuid),public.draft_available_players(uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.draft_command(uuid,uuid,bigint,text,jsonb),public.draft_state(uuid),public.draft_available_players(uuid,text,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
