begin;
-- Browser access is through these bounded, commissioner-only APIs. No table grants.
create function public.scoring_controls_state(check_day date default null,history_page integer default 0,pga_page integer default 0,include_test boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day date=coalesce(check_day,(clock_timestamp() at time zone 'America/New_York')::date); answer jsonb;
begin
 perform draft.require_commissioner();
 if history_page is null or pga_page is null or history_page not between 0 and 100000 or pga_page not between 0 and 100000 or include_test is null then raise exception 'Invalid page'; end if;
 select jsonb_build_object(
  'check_date',day,'server_time',clock_timestamp(),
  'pause',coalesce((select jsonb_build_object('id',id::text,'paused',paused,'effective_at',effective_at,'reason',reason) from scoring.pause_events order by id desc limit 1),jsonb_build_object('id','0','paused',false,'effective_at',null,'reason',null)),
  'checks',(select coalesce(jsonb_agg(x order by x->>'owner'),'[]') from (
    select jsonb_build_object('owner',o.display_name,'owner_id',o.id,'check_id',c.id,'complete',c.complete,'total_players',c.total_players,
      'checked_at',scoring.roster_check_time(c),'cap',draft.roster_cap_at(scoring.roster_check_time(c)),
      'revision',c.revision,'reason',c.reason,'last_check_date',(select max(check_date) from scoring.roster_checks where owner_id=o.id)) x
    from draft.owners o left join scoring.roster_checks c on c.id=(select lc.id from scoring.latest_roster_checks lc where lc.owner_id=o.id and lc.check_date=day) where o.active
  ) rows),
  'pga',(select coalesce(jsonb_agg(x order by end_date desc,result_id),'[]') from (
    select r.id result_id,p.end_date,jsonb_build_object('result_id',r.id,'owner',o.display_name,'start_date',p.start_date,'end_date',p.end_date,'label',p.label,
      'is_test',s.is_test,'championship_year',s.championship_year,'revision',r.revision,'outcome',scoring.evaluate(r.id,clock_timestamp())) x
    from scoring.latest_results r join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id join draft.owners o on o.id=r.owner_id
    where s.sport='PGA' and s.is_test=include_test order by p.end_date desc,r.id limit 25 offset pga_page*25
  ) rows),
  'pga_has_more',(select count(*)>(pga_page+1)*25 from scoring.latest_results r join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id where s.sport='PGA' and s.is_test=include_test),
  'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.occurred_at desc,h.id),'[]') from (
    select * from (
      select 'pause-'||e.id::text id,'pause' kind,e.effective_at occurred_at,e.reason,case when e.paused then 'paused' else 'resumed' end action,
        coalesce(o.display_name,'Former commissioner') actor,null::text owner,null::date start_date,null::date end_date,null::boolean is_test
      from scoring.pause_events e left join draft.owner_accounts a on a.auth_user_id=e.actor_id left join draft.owners o on o.id=a.owner_id
      union all
      select 'pga-'||e.id::text,'pga',e.recorded_at,e.reason,e.choice,coalesce(o.display_name,'Former commissioner'),recipient.display_name,p.start_date,p.end_date,s.is_test
      from scoring.pga_resolutions e join scoring.results r on r.id=e.result_id join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id
      join draft.owners recipient on recipient.id=r.owner_id left join draft.owner_accounts a on a.auth_user_id=e.actor_id left join draft.owners o on o.id=a.owner_id
      where s.is_test=include_test
    ) events order by occurred_at desc,id limit 25 offset history_page*25
  ) h),
  'history_has_more',((select count(*) from scoring.pause_events)+(select count(*) from scoring.pga_resolutions e join scoring.results r on r.id=e.result_id join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id where s.is_test=include_test)>(history_page+1)*25)
 ) into answer;
 return answer;
end $$;

create function public.scoring_controls_pga_review(result_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare review jsonb; positive numeric; negative numeric; over_count integer;
begin
 perform draft.require_commissioner();
 review=scoring.review_pga_resolution(result_id);
 if review->>'reason' is distinct from 'PGA pause boundary requires policy decision' and not(review ? 'resolution_id') then raise exception 'This result does not require a mixed-pause PGA decision'; end if;
 select coalesce(sum(greatest(c.raw_points,0)),0),coalesce(sum(least(c.raw_points,0)),0) into positive,negative from scoring.contributions c where c.result_id=scoring_controls_pga_review.result_id and c.lineup='ACTIVE';
 select count(*) into over_count from jsonb_array_elements(review->'checks') x join scoring.roster_checks c on c.id=(x->>'check_id')::uuid where c.complete and c.total_players>draft.roster_cap_at(scoring.roster_check_time(c));
 return review||jsonb_build_object('waive_total',positive+negative,'enforce_total',case when over_count=2 then negative else positive+negative end,'positive_points',positive,'negative_points',negative,'overage_checks',over_count);
end $$;

create function public.scoring_controls_pause(req uuid,paused_value boolean,explanation text,expected_event bigint,confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event_id bigint;
begin
 perform draft.require_commissioner();
 if confirmed is distinct from true or paused_value is null or explanation is null or length(trim(explanation)) not between 5 and 1000 then raise exception 'Confirm the change and provide a reason (5–1000 characters)'; end if;
 event_id=scoring.set_penalty_pause(req,paused_value,trim(explanation),expected_event);
 return jsonb_build_object('event_id',event_id::text);
end $$;
create function public.scoring_controls_pga_resolve(req uuid,result_id uuid,choice_value text,explanation text,expected_checks jsonb,expected_resolution uuid,confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare resolution_id uuid;
begin
 perform draft.require_commissioner();
 if confirmed is distinct from true or explanation is null or length(trim(explanation)) not between 5 and 1000 then raise exception 'Confirm the decision and provide a reason (5–1000 characters)'; end if;
 resolution_id=scoring.resolve_pga_pause(req,result_id,choice_value,trim(explanation),expected_checks,expected_resolution);
 return jsonb_build_object('resolution_id',resolution_id);
end $$;
revoke all on function public.scoring_controls_state(date,integer,integer,boolean),public.scoring_controls_pga_review(uuid),public.scoring_controls_pause(uuid,boolean,text,bigint,boolean),public.scoring_controls_pga_resolve(uuid,uuid,text,text,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.scoring_controls_state(date,integer,integer,boolean),public.scoring_controls_pga_review(uuid),public.scoring_controls_pause(uuid,boolean,text,bigint,boolean),public.scoring_controls_pga_resolve(uuid,uuid,text,text,jsonb,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;


