begin;
-- One acceptance announcement per linked active owner, including both parties.
create or replace function trading.notify(e bigint,owner uuid,kind text) returns void
language sql set search_path='' as $$
 insert into trading.notifications(event_id,recipient_user_id,kind)
 select e,a.auth_user_id,kind from draft.owner_accounts a
 join draft.owners o on o.id=a.owner_id
 where o.active and (kind='acceptance' or o.id=owner)
 on conflict(event_id,recipient_user_id) do nothing;
$$;

create table trading.roster_limit_alerts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references draft.owners(id),
 player_count integer not null check(player_count>65),
 opened_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz
);
create unique index one_open_roster_limit_alert on trading.roster_limit_alerts(owner_id) where resolved_at is null;
alter table trading.roster_limit_alerts enable row level security;
revoke all on trading.roster_limit_alerts from public,anon,authenticated;
alter table trading.notifications alter column event_id drop not null;
alter table trading.notifications add column roster_alert_id uuid references trading.roster_limit_alerts(id);
alter table trading.notifications drop constraint notifications_kind_check;
alter table trading.notifications add constraint notifications_kind_check
 check(kind in ('proposal','counter','acceptance','decline','roster_limit'));
alter table trading.notifications add constraint notification_source
 check((kind='roster_limit' and roster_alert_id is not null and event_id is null)
 or (kind<>'roster_limit' and event_id is not null and roster_alert_id is null));
alter table trading.notifications add unique(roster_alert_id,recipient_user_id);

-- Inspect only after the entire five-sport batch is validated and imported.
alter function trading.ingest_roster_batch(jsonb) rename to ingest_roster_batch_without_alerts;
create function trading.ingest_roster_batch(snapshots jsonb) returns void
language plpgsql set search_path='' as $$
declare o record; alert uuid;
begin
 perform trading.ingest_roster_batch_without_alerts(snapshots);
 for o in select own.id,own.active,count(p.id)::integer n from draft.owners own
 left join trading.players p on p.owner_id=own.id group by own.id loop
   if not o.active or o.n<=65 then
     update trading.roster_limit_alerts set resolved_at=clock_timestamp() where owner_id=o.id and resolved_at is null;
   else
     insert into trading.roster_limit_alerts(owner_id,player_count) values(o.id,o.n)
       on conflict(owner_id) where resolved_at is null do update set player_count=excluded.player_count
       returning id into alert;
     insert into trading.notifications(roster_alert_id,recipient_user_id,kind)
       select alert,a.auth_user_id,'roster_limit' from draft.owner_accounts a where a.owner_id=o.id
       on conflict(roster_alert_id,recipient_user_id) do nothing;
   end if;
 end loop;
end $$;
revoke all on function trading.ingest_roster_batch(jsonb) from public,anon,authenticated;
commit;
