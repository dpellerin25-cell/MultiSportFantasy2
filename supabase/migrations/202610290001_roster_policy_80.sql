begin;
-- Mirrors web/data/roster-policy.json; parity is verified by roster-policy.test.mjs.
-- Activation is the deployment instant, never a retroactive change to old checks.
select pg_advisory_xact_lock(20260925,2);
select pg_advisory_xact_lock(731943,2); -- serialize with notification delivery
select pg_advisory_xact_lock(731943,1); -- roster imports/trades
select pg_advisory_xact_lock(731944,1); -- scoring corrections/decisions
create table draft.roster_policy_versions (
 version text primary key,
 effective_at timestamptz not null unique,
 roster_limit integer not null check(roster_limit>0),
 startup_rounds integer not null check(startup_rounds>0),
 annual_rounds integer not null check(annual_rounds=10),
 reason text not null
);
insert into draft.roster_policy_versions values
 ('legacy-65','-infinity',65,65,10,'Historical rule retained for checks before activation'),
 ('2026-10-29-80',clock_timestamp(),80,80,10,'Approved October 29, 2026; effective on deployment');
alter table draft.roster_policy_versions enable row level security;
revoke all on draft.roster_policy_versions from public,anon,authenticated;
create trigger immutable_roster_policy before update or delete on draft.roster_policy_versions
 for each row execute function trading.immutable_history();
create function draft.roster_cap_at(at_time timestamptz) returns integer
 language sql stable set search_path='' as $$
 select roster_limit from draft.roster_policy_versions where effective_at<=at_time order by effective_at desc limit 1
$$;
revoke all on function draft.roster_cap_at(timestamptz) from public,anon,authenticated;

-- Existing drafts are grandfathered by identity, not by accepting 65 for new drafts.
create table draft.legacy_startup_rounds (
 draft_id uuid primary key references draft.drafts(id), rounds integer not null,
 preserved_at timestamptz not null default clock_timestamp()
);
insert into draft.legacy_startup_rounds(draft_id,rounds) select id,rounds from draft.drafts where kind='startup';
alter table draft.legacy_startup_rounds enable row level security;
revoke all on draft.legacy_startup_rounds from public,anon,authenticated;
create trigger immutable_legacy_startup before update or delete on draft.legacy_startup_rounds
 for each row execute function trading.immutable_history();
alter table draft.drafts drop constraint startup_round_count;
alter table draft.drafts add constraint startup_round_count check(kind<>'startup' or rounds in (65,80));
create function draft.enforce_startup_policy() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='startup' and new.rounds<>80 and not exists(
   select 1 from draft.legacy_startup_rounds where draft_id=new.id and rounds=new.rounds
 ) then raise exception 'New startup drafts require 80 rounds'; end if;
 if TG_OP='UPDATE' and old.status='setup' and new.status<>'setup' and new.status<>'cancelled'
   and new.kind='startup' and new.rounds<>80 then raise exception 'Preview and transition unstarted draft to 80 rounds before starting'; end if;
 return new;
end $$;
create trigger enforce_startup_policy before insert or update on draft.drafts for each row execute function draft.enforce_startup_policy();
revoke all on function draft.enforce_startup_policy() from public,anon,authenticated;

-- Keep check evidence JSON unchanged: old commissioner resolutions remain valid.
do $$ declare definition text; begin
 select pg_get_functiondef('scoring.evaluate(uuid,timestamptz)'::regprocedure) into definition;
 if position('c.total_players>65' in definition)=0 then raise exception 'Unexpected scoring evaluator; review policy patch'; end if;
 execute replace(definition,'c.total_players>65',
   'c.total_players>draft.roster_cap_at((day+time ''04:00'') at time zone ''America/New_York'')');
 select pg_get_functiondef('public.league_settings_preview(integer,jsonb,numeric[])'::regprocedure) into definition;
 if position('65*jsonb_array_length(members)' in definition)=0 then raise exception 'Unexpected settings preview'; end if;
 execute replace(definition,'65*jsonb_array_length(members)','80*jsonb_array_length(members)');
 select pg_get_functiondef('trading.ingest_roster_batch(jsonb)'::regprocedure) into definition;
 if position('o.n<=65' in definition)=0 then raise exception 'Unexpected alert importer'; end if;
 execute replace(definition,'o.n<=65','o.n<=draft.roster_cap_at(clock_timestamp())');
end $$;

-- Preserve old alert counts and sent/frozen payloads. Record every cleanup action.
create table trading.roster_policy_cleanup (
 policy_version text not null references draft.roster_policy_versions(version),
 alert_id uuid not null references trading.roster_limit_alerts(id),
 prior_state jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(policy_version,alert_id)
);
alter table trading.roster_policy_cleanup enable row level security;
revoke all on trading.roster_policy_cleanup from public,anon,authenticated;
create trigger immutable_policy_cleanup before update or delete on trading.roster_policy_cleanup
 for each row execute function trading.immutable_history();
insert into trading.roster_policy_cleanup(policy_version,alert_id,prior_state)
 select '2026-10-29-80',a.id,jsonb_build_object('alert',to_jsonb(a),'notifications',
   (select coalesce(jsonb_agg(to_jsonb(n)),'[]') from trading.notifications n where n.roster_alert_id=a.id))
 from trading.roster_limit_alerts a where a.resolved_at is null;
update trading.roster_limit_alerts set resolved_at=clock_timestamp() where resolved_at is null and player_count<=80;
update trading.notifications n set status='failed',next_attempt_at='infinity',last_error='roster_policy_80_obsolete_or_delivery_review'
 from trading.roster_limit_alerts a where n.roster_alert_id=a.id and n.status<>'sent'
 and (a.resolved_at is not null or n.first_attempt_at is not null);
-- Unattempted warnings for still-over-cap owners render the new shared template.
-- Uncertain deliveries are held for review, never retried with a changed payload.
commit;
