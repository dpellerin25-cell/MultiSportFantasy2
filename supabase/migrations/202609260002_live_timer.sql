begin;
-- Only a revision signal is published; clients refetch through authorized RPCs.
create table draft.live_updates (
  draft_id uuid primary key references draft.drafts(id),
  revision bigint not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table draft.live_updates enable row level security;
revoke all on draft.live_updates from public,anon,authenticated;
grant select on draft.live_updates to authenticated;
create function draft.can_read_live(target uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  perform draft.require_member(target);
  return true;
exception when insufficient_privilege then return false;
end $$;
revoke all on function draft.can_read_live(uuid) from public,anon;
grant execute on function draft.can_read_live(uuid) to authenticated;
create policy member_live_read on draft.live_updates for select to authenticated
using (draft.can_read_live(draft_id));

create function draft.signal_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  insert into draft.live_updates(draft_id,revision) values(new.id,new.revision)
    on conflict(draft_id) do update set revision=excluded.revision,updated_at=clock_timestamp();
  return new;
end $$;
revoke all on function draft.signal_revision() from public,anon,authenticated;
create trigger signal_draft_revision after insert or update of revision on draft.drafts
for each row execute function draft.signal_revision();
insert into draft.live_updates(draft_id,revision) select id,revision from draft.drafts;

-- Cron invokes as its trusted database administrator, never as an owner.
-- Browser/HTTP roles cannot execute this function.
create function draft.expire_due_picks(batch_size integer default 50) returns integer
language plpgsql security invoker set search_path='' as $$
declare d draft.drafts; slot draft.draft_picks; expired integer=0; stamp timestamptz;
begin
  if batch_size is null or batch_size<1 or batch_size>100 then raise exception 'Invalid timer batch size'; end if;
  for d in select * from draft.drafts where status='running' and deadline_at<=clock_timestamp()
      order by deadline_at,id limit batch_size for update skip locked loop
    -- Same draft-row lock as owner commands. One advance per draft per run.
    stamp=clock_timestamp();
    if d.status<>'running' or d.deadline_at is null or d.deadline_at>stamp then continue; end if;
    select * into strict slot from draft.draft_picks
      where draft_id=d.id and overall_pick_number=d.current_pick_number;
    if slot.skipped_at is not null or exists(select 1 from draft.draft_selections where pick_id=slot.id and voided_at is null) then
      raise exception 'Inconsistent active timer slot';
    end if;
    update draft.draft_picks set skipped_at=stamp where id=slot.id;
    perform draft.advance_clock(d.id);
    update draft.drafts set revision=revision+1 where id=d.id;
    insert into draft.draft_events(draft_id,event_type,actor_user_id,payload)
      values(d.id,'timer_expire',null,jsonb_build_object('pick_id',slot.id,'pick_number',slot.overall_pick_number,
        'expired_deadline',d.deadline_at,'processed_at',stamp,'source','database_timer'));
    expired=expired+1;
  end loop;
  return expired;
end $$;
revoke all on function draft.expire_due_picks(integer) from public,anon,authenticated;
create index due_draft_timers on draft.drafts(deadline_at) where status='running';
commit;
