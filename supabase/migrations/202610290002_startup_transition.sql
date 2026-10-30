begin;
create table draft.startup_transitions (
 draft_id uuid primary key references draft.drafts(id), approval_hash text not null,
 prior_state jsonb not null, applied_at timestamptz not null default clock_timestamp()
);
alter table draft.startup_transitions enable row level security;
revoke all on draft.startup_transitions from public,anon,authenticated;
create trigger immutable_startup_transition before update or delete on draft.startup_transitions
 for each row execute function trading.immutable_history();
create function draft.preview_startup_transition(target uuid) returns jsonb language plpgsql set search_path='' as $$
declare d draft.drafts; plan jsonb; blockers jsonb='[]'; slots bigint; selections bigint; pool bigint;
begin
 select * into strict d from draft.drafts where id=target;
 select count(*) into slots from draft.draft_picks where draft_id=target;
 select count(*) into selections from draft.draft_selections where draft_id=target;
 select count(*) into pool from draft.draft_pool_players where draft_id=target and eligible;
 if d.kind<>'startup' then blockers=blockers||'"Not a startup draft"'::jsonb; end if;
 if d.status<>'setup' or d.current_pick_number is not null or d.deadline_at is not null
   or d.paused_remaining_seconds is not null then blockers=blockers||'"Draft has started, is cancelled, or has clock state"'::jsonb; end if;
 if slots>0 or selections>0 then blockers=blockers||'"Existing picks or selections must be preserved; create a new draft"'::jsonb; end if;
 if exists(select 1 from draft.retired_rehearsals where draft_id=target) then blockers=blockers||'"Retired rehearsal"'::jsonb; end if;
 if pool<80*d.participant_count then blockers=blockers||'"Insufficient eligible pool for 80 rounds"'::jsonb; end if;
 plan=jsonb_build_object('draft_id',target,'name',d.name,'status',d.status,'revision',d.revision,
   'old_rounds',d.rounds,'new_rounds',80,'participant_count',d.participant_count,
   'scheduled_picks',80*d.participant_count,'eligible_pool',pool,'pick_slots',slots,'selections',selections,'blockers',blockers);
 return plan||jsonb_build_object('approval_hash',md5(plan::text));
end $$;
create function draft.apply_startup_transition(target uuid,approval text) returns jsonb language plpgsql set search_path='' as $$
declare plan jsonb; prior draft.startup_transitions;
begin
 perform pg_advisory_xact_lock(20260925,2);
 perform 1 from draft.drafts where id=target for update;
 select * into prior from draft.startup_transitions where draft_id=target;
 if found then
   if prior.approval_hash is distinct from approval then raise exception 'Conflicting transition retry'; end if;
   return jsonb_build_object('already_applied',true,'draft_id',target);
 end if;
 plan=draft.preview_startup_transition(target);
 if plan->>'approval_hash' is distinct from approval then raise exception 'Draft changed; preview again'; end if;
 if jsonb_array_length(plan->'blockers')<>0 then raise exception 'Draft transition blocked'; end if;
 if (plan->>'old_rounds')::int=80 then return jsonb_build_object('already_applied',true,'draft_id',target); end if;
 insert into draft.startup_transitions(draft_id,approval_hash,prior_state) values(target,approval,plan);
 update draft.drafts set rounds=80,revision=revision+1 where id=target;
 insert into draft.draft_events(draft_id,event_type,payload) values(target,'startup_rounds_80',plan);
 return jsonb_build_object('already_applied',false,'draft_id',target,'rounds',80);
end $$;
revoke all on function draft.preview_startup_transition(uuid),draft.apply_startup_transition(uuid,text) from public,anon,authenticated;
commit;
