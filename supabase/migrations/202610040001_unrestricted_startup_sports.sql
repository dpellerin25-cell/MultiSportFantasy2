-- Startup owners may distribute all 65 selections freely across sports.
-- Completed/cancelled draft rules and all historical picks/events stay intact.
begin;
create or replace function draft.startup_rules() returns trigger language plpgsql set search_path='' as $$
begin
  if new.kind='startup' then
    insert into draft.draft_sport_rules(draft_id,sport,minimum)
    values(new.id,'NFL',0),(new.id,'NBA',0),(new.id,'MLB',0),(new.id,'EPL',0),(new.id,'PGA',0);
  end if;
  return new;
end $$;

-- Serialize with commands/timer workers before changing existing live rules.
do $$
declare d record;
begin
  for d in select id from draft.drafts where kind='startup'
    and status in ('setup','running','paused','awaiting_makeups') order by id for update loop
    update draft.draft_sport_rules set minimum=0,maximum=null where draft_id=d.id;
    insert into draft.draft_events(draft_id,event_type,payload)
      values(d.id,'sport_minimums_removed','{"minimum":0,"maximum":null,"reason":"League approved free distribution of 65 selections"}');
    update draft.drafts set revision=revision+1 where id=d.id;
  end loop;
end $$;

create or replace function draft.command(
  target uuid, request_id uuid, expected_revision bigint, action text, args jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid=auth.uid(); owner uuid; commissioner boolean; d draft.drafts;
  previous draft.draft_commands; fingerprint text; result jsonb;
  slot draft.draft_picks; chosen draft.draft_pool_players; selection draft.draft_selections;
  selection_id uuid; duration integer; n integer; now_at timestamptz;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if request_id is null or expected_revision is null or action is null or args is null or jsonb_typeof(args)<>'object' then
    raise exception 'Invalid command envelope';
  end if;
  select a.owner_id into owner from draft.owner_accounts a join draft.owners o on o.id=a.owner_id
    where a.auth_user_id=actor and o.active;
  select exists(select 1 from draft.league_roles r where r.auth_user_id=actor and r.role='commissioner') into commissioner;
  if not commissioner and (owner is null or not exists(select 1 from draft.draft_participants p where p.draft_id=target and p.owner_id=owner)) then
    raise exception 'Draft access denied';
  end if;
  select * into strict d from draft.drafts where id=target for update;
  fingerprint=jsonb_build_object('action',action,'args',args,'revision',expected_revision)::text;
  select * into previous from draft.draft_commands c where c.draft_id=target and c.request_id=command.request_id;
  if found then
    if previous.actor_user_id<>actor or previous.request_fingerprint<>fingerprint then raise exception 'Request ID already used for a different command'; end if;
    return previous.result;
  end if;
  if d.revision<>expected_revision then raise exception 'Draft changed; refresh before retrying'; end if;
  now_at=clock_timestamp(); -- after acquiring lock, not transaction start time
  if action not in ('pick','expire') and not commissioner then raise exception 'Commissioner access required'; end if;

  if action='set_order' then
    if d.status<>'setup' or exists(select 1 from draft.draft_picks where draft_id=target) then raise exception 'Order is frozen'; end if;
    if jsonb_typeof(args->'owners') is distinct from 'array' then raise exception 'Owner order required'; end if;
    if jsonb_array_length(args->'owners')<>d.participant_count then raise exception 'Wrong owner count'; end if;
    delete from draft.draft_participants where draft_id=target;
    insert into draft.draft_participants(draft_id,owner_id,order_position)
      select target,value::uuid,ordinality::integer from jsonb_array_elements_text(args->'owners') with ordinality;
    if exists(select 1 from draft.draft_participants p join draft.owners o on p.owner_id=o.id where p.draft_id=target and not o.active) then raise exception 'Inactive owner'; end if;

  elsif action='set_timer' then
    duration=(args->>'seconds')::integer;
    if duration is null or duration<1 or duration>86400 then raise exception 'Timer must be 1 to 86400 seconds'; end if;
    if d.status not in ('setup','running','paused','awaiting_makeups') then raise exception 'Cannot change timer now'; end if;
    -- Changes future turns only. Current deadline/paused remainder unchanged.
    update draft.drafts set pick_duration_seconds=duration where id=target;

  elsif action='start' then
    if d.status<>'setup' then raise exception 'Draft already started'; end if;
    if d.pick_duration_seconds is null then raise exception 'Configure timer first'; end if;
    if not exists(select 1 from draft.player_pool_imports where id=d.import_id and status='ready') then raise exception 'Ready import required'; end if;
    if d.kind='startup' and ((select count(*) from draft.draft_sport_rules where draft_id=target)<>5 or exists(
      select 1 from draft.draft_sport_rules where draft_id=target and
      (maximum is not null or minimum<>0))) then
      raise exception 'Startup sport rules do not match league requirements';
    end if;
    if exists(select 1 from draft.draft_pool_players p join draft.player_pool_entries e
      on e.import_id=p.import_id and e.player_id=p.player_id where p.draft_id=target
      and (p.sport,p.name,p.position,p.professional_team,p.availability) is distinct from
          (e.sport,e.name,e.position,e.professional_team,e.availability)) then raise exception 'Pool differs from import'; end if;
    if (select count(*) from draft.draft_pool_players where draft_id=target and eligible)<d.rounds*d.participant_count then raise exception 'Not enough eligible players'; end if;
    perform draft.generate_snake_picks(target);
    perform draft.check_minimums(target);
    update draft.drafts set status='running',current_pick_number=1,
      deadline_at=now_at+make_interval(secs=>pick_duration_seconds) where id=target;

  elsif action='pause' then
    if d.status<>'running' then raise exception 'Draft is not running'; end if;
    update draft.drafts set status='paused',paused_remaining_seconds=greatest(0,extract(epoch from deadline_at-now_at)),deadline_at=null where id=target;

  elsif action='resume' then
    if d.status<>'paused' then raise exception 'Draft is not paused'; end if;
    update draft.drafts set status='running',deadline_at=now_at+make_interval(secs=>paused_remaining_seconds::double precision),paused_remaining_seconds=null where id=target;

  elsif action in ('pick','assign','expire') then
    select * into strict slot from draft.draft_picks where draft_id=target and id=(args->>'pick_id')::uuid;
    if exists(select 1 from draft.draft_selections where pick_id=slot.id and voided_at is null) then raise exception 'Pick is already filled'; end if;
    if action in ('pick','expire') then
      if d.status<>'running' or slot.overall_pick_number<>d.current_pick_number then raise exception 'Not the current running pick'; end if;
      if action='pick' and slot.current_owner_id is distinct from owner then raise exception 'Only the owner on the clock may pick'; end if;
      if d.deadline_at is null then raise exception 'Missing deadline'; end if;
      if action='pick' and now_at>=d.deadline_at then raise exception 'Pick deadline expired'; end if;
      if action='expire' and now_at<d.deadline_at then raise exception 'Pick deadline has not expired'; end if;
    else
      if d.status not in ('running','paused','awaiting_makeups') then raise exception 'Cannot assign now'; end if;
      if slot.skipped_at is null and slot.overall_pick_number is distinct from d.current_pick_number then raise exception 'Only current or skipped slots can be assigned'; end if;
    end if;
    if action='expire' then
      update draft.draft_picks set skipped_at=now_at where id=slot.id;
      perform draft.advance_clock(target);
    else
      select * into strict chosen from draft.draft_pool_players where draft_id=target and player_id=(args->>'player_id')::uuid;
      if not chosen.eligible then raise exception 'Player is not eligible'; end if;
      insert into draft.draft_selections(draft_id,pick_id,owner_id,player_id,sport,actor_user_id,method)
      values(target,slot.id,slot.current_owner_id,chosen.player_id,chosen.sport,actor,
        case when action='pick' then 'owner' else 'commissioner' end) returning id into selection_id;
      perform draft.check_minimums(target);
      if slot.overall_pick_number=d.current_pick_number then perform draft.advance_clock(target);
      elsif d.status='awaiting_makeups' and not exists(select 1 from draft.draft_picks p where p.draft_id=target
        and not exists(select 1 from draft.draft_selections s where s.pick_id=p.id and s.voided_at is null)) then
        update draft.drafts set status='completed' where id=target;
      end if;
    end if;

  elsif action='undo' then
    -- Safe initial policy: latest active selection only, no automatic rewind.
    -- Reopened slot becomes an unfilled makeup pick; current turn is preserved.
    if d.status not in ('paused','awaiting_makeups','completed') then raise exception 'Pause before undo'; end if;
    if coalesce(length(trim(args->>'reason')),0)=0 then raise exception 'Undo reason required'; end if;
    select s.* into strict selection from draft.draft_selections s join draft.draft_events e
      on e.payload->'selection'->>'id'=s.id::text and e.event_type='selection'
      where s.draft_id=target and s.voided_at is null order by e.id desc limit 1;
    if selection.id is distinct from (args->>'selection_id')::uuid then raise exception 'Only latest active selection can be undone'; end if;
    update draft.draft_selections set voided_at=now_at,void_reason=args->>'reason' where id=selection.id;
    update draft.draft_picks set skipped_at=now_at where id=selection.pick_id;
    if d.status='completed' then update draft.drafts set status='awaiting_makeups' where id=target; end if;
    perform draft.check_minimums(target);
  else
    raise exception 'Unknown draft command';
  end if;
  update draft.drafts set revision=revision+1 where id=target returning * into d;
  result=jsonb_build_object('draft_id',target,'revision',d.revision,'status',d.status,
    'current_pick_number',d.current_pick_number,'deadline_at',d.deadline_at,'selection_id',selection_id);
  insert into draft.draft_events(draft_id,event_type,actor_user_id,payload)
    values(target,action,actor,jsonb_build_object('request_id',request_id,'args',args,'result',result));
  insert into draft.draft_commands(draft_id,request_id,actor_user_id,request_fingerprint,result)
    values(target,request_id,actor,fingerprint,result);
  return result;
end $$;

create or replace function public.trade_command(request_id uuid,action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; commissioner boolean; prior trading.requests; t trading.trades; parent trading.trades; target uuid;
  item jsonb; src uuid; dst uuid; asset_player uuid; asset_pick uuid; actual uuid; year_value integer;
  e bigint; result jsonb; asset_row trading.assets; current_year integer; projected_warnings jsonb;
begin
  select o.id into actor from draft.owner_accounts m join draft.owners o on o.id=m.owner_id where m.auth_user_id=auth.uid() and o.active;
  if actor is null then raise exception 'Owner account required' using errcode='42501'; end if;
  select exists(select 1 from draft.league_roles where auth_user_id=auth.uid() and role='commissioner') into commissioner;
  if request_id is null or action is null or args is null or jsonb_typeof(args)<>'object' then raise exception 'Invalid command'; end if;
  perform pg_advisory_xact_lock(731943,1);
  select * into prior from trading.requests where actor_user_id=auth.uid() and trading.requests.request_id=trade_command.request_id;
  if found then
    if prior.action<>action or prior.args<>args then raise exception 'Request ID reused with different command'; end if;
    return prior.result;
  end if;
  if not exists(select 1 from trading.ledger_import) then raise exception 'Import legacy pick ledger before enabling trades'; end if;
  current_year=extract(year from clock_timestamp() at time zone 'UTC')::integer;
  perform trading.seed_picks(current_year+1);perform trading.seed_picks(current_year+2);
  if action in ('propose','counter') then
    dst=(args->>'recipient_id')::uuid;
    if dst is null or dst=actor or not exists(select 1 from draft.owners o join draft.owner_accounts m on m.owner_id=o.id where o.id=dst and o.active) then raise exception 'Active receiving owner account required'; end if;
    if action='counter' then
      select * into parent from trading.trades where id=(args->>'trade_id')::uuid;
      if parent.recipient_id is distinct from actor then raise exception 'Only receiving owner can counter' using errcode='42501'; end if;
      if parent.proposer_id<>dst or parent.status<>'proposed' or parent.expires_at<=clock_timestamp() or parent.revision is distinct from (args->>'revision')::bigint then raise exception 'Offer changed or expired'; end if;
    end if;
    if jsonb_typeof(args->'assets') is distinct from 'array' or jsonb_array_length(args->'assets') not between 1 and 200 then raise exception 'Choose 1 to 200 assets'; end if;
    insert into trading.trades(proposer_id,recipient_id,parent_id,message) values(actor,dst,parent.id,coalesce(args->>'message','')) returning id into target;
    for item in select value from jsonb_array_elements(args->'assets') loop
      src=(item->>'from_owner_id')::uuid;asset_player=(item->>'player_id')::uuid;asset_pick=(item->>'pick_id')::uuid;
      if src is null or src not in (actor,dst) or num_nonnulls(asset_player,asset_pick)<>1 then raise exception 'Invalid trade asset'; end if;
      if asset_player is not null then
        select owner_id into actual from trading.players where id=asset_player;
        if exists(select 1 from trading.player_reservations where player_id=asset_player) then raise exception 'Player awaiting Fantrax transfer'; end if;
      else
        select owner_id,year into actual,year_value from trading.picks where id=asset_pick;
        if year_value not in (current_year+1,current_year+2) then raise exception 'Only next two rookie draft years can be traded'; end if;
      end if;
      if actual is distinct from src then raise exception 'Asset ownership changed'; end if;
      insert into trading.assets(trade_id,from_owner_id,to_owner_id,player_id,pick_id) values(target,src,case when src=actor then dst else actor end,asset_player,asset_pick);
    end loop;
    if parent.id is not null then
      update trading.trades set status='countered',revision=revision+1 where id=parent.id;
      insert into trading.events(trade_id,actor_user_id,action,details) values(parent.id,auth.uid(),'countered',jsonb_build_object('replacement_id',target));
    end if;
    insert into trading.events(trade_id,actor_user_id,action) values(target,auth.uid(),action) returning id into e;
    perform trading.notify(e,dst,case when action='counter' then 'counter' else 'proposal' end);
  elsif action in ('accept','decline','withdraw','correct') then
    target=(args->>'trade_id')::uuid;
    select * into t from trading.trades where id=target;
    if t.id is null then raise exception 'Trade unavailable' using errcode='42501'; end if;
    if action='correct' then
      if not commissioner or t.status not in ('accepted','completed') then raise exception 'Commissioner correction of accepted trades only' using errcode='42501'; end if;
    elsif (action='withdraw' and actor<>t.proposer_id) or (action in ('accept','decline') and actor<>t.recipient_id) then
      raise exception 'Trade action not permitted' using errcode='42501';
    end if;
    if t.revision is distinct from (args->>'revision')::bigint then raise exception 'Offer changed'; end if;
    if action<>'correct' and (t.status<>'proposed' or t.expires_at<=clock_timestamp()) then raise exception 'Offer closed or expired'; end if;
    if action='accept' and exists(select 1 from draft.owners where id in(t.proposer_id,t.recipient_id) and not active) then raise exception 'Trade owner is inactive'; end if;
    if action in ('decline','withdraw') then
      update trading.trades set status=case when action='decline' then 'declined' else 'withdrawn' end,revision=revision+1 where id=target;
      insert into trading.events(trade_id,actor_user_id,action) values(target,auth.uid(),action) returning id into e;
      if action='decline' then perform trading.notify(e,t.proposer_id,'decline'); end if;
    else
      if action='correct' and (t.corrected_at is not null or length(trim(coalesce(args->>'reason',''))) not between 1 and 2000) then raise exception 'One audited reversal requires a reason'; end if;
      for asset_row in select * from trading.assets where trade_id=target order by id loop
        src=case when action='correct' then asset_row.to_owner_id else asset_row.from_owner_id end;
        dst=case when action='correct' then asset_row.from_owner_id else asset_row.to_owner_id end;
        if asset_row.pick_id is not null then
          select owner_id,year into actual,year_value from trading.picks where id=asset_row.pick_id;
          if actual is distinct from src then raise exception 'Pick ownership changed; cannot transfer'; end if;
          if action='accept' and year_value not in (current_year+1,current_year+2) then raise exception 'Pick year no longer eligible'; end if;
          update trading.picks set owner_id=dst where id=asset_row.pick_id;
          insert into trading.pick_history(pick_id,from_owner_id,to_owner_id,reason) values(asset_row.pick_id,src,dst,action||' trade '||target::text);
        else
          select owner_id into actual from trading.players where id=asset_row.player_id;
          if (action='accept' and actual is distinct from src) or (action='correct' and (actual is null or actual not in (src,dst))) then raise exception 'Player ownership changed'; end if;
          if exists(select 1 from trading.player_reservations where player_id=asset_row.player_id and (action='accept' or trade_id<>target)) then raise exception 'Player already committed'; end if;
          insert into trading.player_reservations values(asset_row.player_id,target) on conflict(player_id) do nothing;
        end if;
      end loop;
      -- No per-sport roster minimums. Preserve historical warning records.
      projected_warnings='[]'::jsonb;
      update trading.trades set status='accepted',accepted_at=coalesce(accepted_at,clock_timestamp()),completed_at=null,
        corrected_at=case when action='correct' then clock_timestamp() else corrected_at end,revision=revision+1,warnings=projected_warnings where id=target;
      insert into trading.events(trade_id,actor_user_id,action,details) values(target,auth.uid(),action,jsonb_build_object('reason',args->>'reason','warnings',projected_warnings)) returning id into e;
      if action='accept' then perform trading.notify(e,t.proposer_id,'acceptance');perform trading.notify(e,t.recipient_id,'acceptance'); end if;
      with changed as (
        update trading.trades other set status='invalidated',revision=revision+1 where other.status='proposed' and other.id<>target and exists(
          select 1 from trading.assets x join trading.assets y on x.player_id=y.player_id or x.pick_id=y.pick_id where x.trade_id=target and y.trade_id=other.id) returning other.id
      ) insert into trading.events(trade_id,action) select id,'conflicting_trade_accepted' from changed;
      perform trading.reconcile();
    end if;
  else raise exception 'Unknown trade action'; end if;
  select jsonb_build_object('trade_id',id,'status',status,'revision',revision,'warnings',trades.warnings) into result from trading.trades where id=target;
  insert into trading.requests values(auth.uid(),request_id,action,args,result);
  return result;
end $$;


commit;
