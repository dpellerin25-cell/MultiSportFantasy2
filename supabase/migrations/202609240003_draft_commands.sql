-- Authenticated transaction API, not yet exposed through the website/Data API.
begin;

create function draft.check_minimums(target uuid) returns void
language plpgsql set search_path='' as $$
declare participant record; rule record; remaining integer; deficits integer; have integer; demand integer; supply integer;
begin
  for participant in select owner_id from draft.draft_participants where draft_id=target loop
    select count(*) into remaining from draft.draft_picks p where p.draft_id=target
      and p.current_owner_id=participant.owner_id and not exists
      (select 1 from draft.draft_selections s where s.pick_id=p.id and s.voided_at is null);
    deficits=0;
    for rule in select * from draft.draft_sport_rules where draft_id=target loop
      select count(*) into have from draft.draft_selections where draft_id=target
        and owner_id=participant.owner_id and sport=rule.sport and voided_at is null;
      if rule.maximum is not null and have>rule.maximum then raise exception 'Sport maximum exceeded'; end if;
      deficits=deficits+greatest(0,rule.minimum-have);
    end loop;
    if deficits>remaining then raise exception 'Insufficient unfilled slots for sport minimums'; end if;
  end loop;
  for rule in select * from draft.draft_sport_rules where draft_id=target loop
    select coalesce(sum(greatest(0,rule.minimum-(select count(*) from draft.draft_selections s
      where s.draft_id=target and s.owner_id=p.owner_id and s.sport=rule.sport and s.voided_at is null))),0)
      into demand from draft.draft_participants p where p.draft_id=target;
    select count(*) into supply from draft.draft_pool_players p where p.draft_id=target
      and p.sport=rule.sport and p.eligible and not exists
      (select 1 from draft.draft_selections s where s.draft_id=target and s.player_id=p.player_id and s.voided_at is null);
    if supply<demand then raise exception 'Insufficient available players for sport minimums'; end if;
  end loop;
end $$;

create function draft.advance_clock(target uuid) returns void
language plpgsql set search_path='' as $$
declare d draft.drafts; next_number integer; unfilled integer;
begin
  select * into strict d from draft.drafts where id=target for update;
  select min(p.overall_pick_number) into next_number from draft.draft_picks p
    where p.draft_id=target and p.overall_pick_number>d.current_pick_number
      and p.skipped_at is null and not exists
      (select 1 from draft.draft_selections s where s.pick_id=p.id and s.voided_at is null);
  if next_number is not null then
    update draft.drafts set current_pick_number=next_number,
      deadline_at=case when status='running' then clock_timestamp()+make_interval(secs=>pick_duration_seconds) else null end,
      paused_remaining_seconds=case when status='paused' then pick_duration_seconds else null end where id=target;
  else
    select count(*) into unfilled from draft.draft_picks p where p.draft_id=target
      and not exists(select 1 from draft.draft_selections s where s.pick_id=p.id and s.voided_at is null);
    update draft.drafts set current_pick_number=null,deadline_at=null,paused_remaining_seconds=null,
      status=case when unfilled=0 then 'completed' else 'awaiting_makeups' end where id=target;
  end if;
end $$;

-- One public command surface, hard-coded operations, no dynamic SQL. Caller
-- identity comes exclusively from the verified auth context, never arguments.
create function draft.command(
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
      (maximum is not null or minimum<>case sport when 'NFL' then 9 when 'NBA' then 8 when 'MLB' then 14 when 'EPL' then 11 when 'PGA' then 6 end))) then
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
revoke all on function draft.check_minimums(uuid) from public,anon,authenticated;
revoke all on function draft.advance_clock(uuid) from public,anon,authenticated;
revoke all on function draft.command(uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function draft.command(uuid,uuid,bigint,text,jsonb) to authenticated;
commit;
