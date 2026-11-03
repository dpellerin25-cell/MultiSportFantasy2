begin;
create table trading.notification_suppressions (
 notification_id uuid primary key references trading.notifications(id),
 plan_hash text not null check(length(plan_hash)=64),
 reason text not null check(length(trim(reason)) between 10 and 500),
 approved_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 prior_status text not null,
 prior_attempts integer not null,
 prior_error text
);
alter table trading.notification_suppressions enable row level security;
revoke all on trading.notification_suppressions from public,anon,authenticated;
create trigger immutable before update or delete on trading.notification_suppressions
for each row execute function trading.immutable_history();
commit;
