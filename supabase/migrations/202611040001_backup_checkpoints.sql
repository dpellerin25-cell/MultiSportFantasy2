begin;
create schema backup;
revoke all on schema backup from public,anon,authenticated;
create table backup.draft_checkpoints (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references draft.drafts(id),
 revision bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 terminal boolean not null,
 completed_rounds jsonb not null,
 corrections text not null,
 payload jsonb not null,
 unique(draft_id,revision)
);
create table backup.receipts (
 checkpoint_id uuid primary key references backup.draft_checkpoints(id),
 object_key text not null,
 sha256 text not null,
 uploaded_at timestamptz not null default clock_timestamp()
);
alter table backup.draft_checkpoints enable row level security;
alter table backup.receipts enable row level security;
revoke all on all tables in schema backup from public,anon,authenticated;
create trigger immutable before update or delete on backup.draft_checkpoints for each row execute function trading.immutable_history();
create trigger immutable before update or delete on backup.receipts for each row execute function trading.immutable_history();
-- Deferred triggers execute after the command's definer context ends. This
-- trigger-only function needs its own private definer context at commit.
create function backup.capture_draft() returns trigger language plpgsql security definer set search_path='' as $$
declare d draft.drafts; rounds jsonb; corrections text; previous backup.draft_checkpoints; body jsonb; t text;
begin
 select * into d from draft.drafts where id=new.id;
 if d.status='setup' or exists(select 1 from draft.retired_rehearsals where draft_id=d.id) then return null; end if;
 if exists(select 1 from backup.draft_checkpoints where draft_id=d.id and revision=d.revision) then return null; end if;
 select coalesce(jsonb_agg(r.round order by r.round),'[]') into rounds from (
  select p.round from draft.draft_picks p where p.draft_id=d.id group by p.round
  having count(*)=d.participant_count and bool_and(p.skipped_at is not null or exists(
   select 1 from draft.draft_selections s where s.pick_id=p.id and s.voided_at is null))
 ) r;
 select md5(coalesce(string_agg(s.id::text||coalesce(s.voided_at::text,''),',' order by s.id),'')) into corrections
 from draft.draft_selections s join draft.draft_picks p on p.id=s.pick_id
 where s.draft_id=d.id and (s.voided_at is not null or p.skipped_at is not null);
 select * into previous from backup.draft_checkpoints where draft_id=d.id order by revision desc limit 1;
 if previous.id is not null and rounds=previous.completed_rounds and corrections=previous.corrections
 and (d.status in ('completed','cancelled'))=previous.terminal then return null; end if;
 body=jsonb_build_object('draft',to_jsonb(d));
 foreach t in array array['draft_participants','draft_picks','draft_selections','draft_events','draft_commands','draft_sport_rules'] loop
  execute format('select $1 || jsonb_build_object(%L,coalesce(jsonb_agg(to_jsonb(x)),''[]'')) from draft.%I x where draft_id=$2',t,t) into body using body,d.id;
 end loop;
 body=body||jsonb_build_object('selected_players',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from draft.draft_pool_players p where p.draft_id=d.id and exists(select 1 from draft.draft_selections s where s.draft_id=d.id and s.player_id=p.player_id)));
 insert into backup.draft_checkpoints(draft_id,revision,terminal,completed_rounds,corrections,payload)
 values(d.id,d.revision,d.status in ('completed','cancelled'),rounds,corrections,body) on conflict do nothing;
 return null;
end $$;
revoke all on function backup.capture_draft() from public,anon,authenticated;
-- Deferred capture includes the command/audit rows written after revision changes.
create constraint trigger backup_round_checkpoint after insert or update on draft.drafts
deferrable initially deferred for each row execute function backup.capture_draft();
commit;
