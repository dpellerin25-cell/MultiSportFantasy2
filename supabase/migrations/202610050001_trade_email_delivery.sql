begin;
-- Server-only outbox metadata; existing RLS and table revocations stay in place.
alter table trading.notifications
  add column delivery_payload jsonb,
  add column first_attempt_at timestamptz,
  add column provider_id text,
  add column last_error text;
alter table trading.notifications add constraint notification_payload_object
  check(delivery_payload is null or jsonb_typeof(delivery_payload)='object');
comment on column trading.notifications.sent_at is 'Accepted by the email provider; not proof of inbox delivery.';
commit;
