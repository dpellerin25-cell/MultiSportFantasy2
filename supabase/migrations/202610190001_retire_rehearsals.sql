begin;
-- Administrative retirement is explicit and permanent. No client RPC is exposed.
create table draft.retired_rehearsals (
 draft_id uuid primary key references draft.drafts(id),
 reason text not null check(length(trim(reason))>=20),
 prior_state jsonb not null,
 retired_at timestamptz not null default clock_timestamp()
);
alter table draft.retired_rehearsals enable row level security;
revoke all on draft.retired_rehearsals from public,anon,authenticated;
create trigger immutable_rehearsal_retirement before update or delete on draft.retired_rehearsals
 for each row execute function trading.immutable_history();
create function draft.retire_rehearsal(target uuid, expected_revision bigint, explanation text) returns void
language plpgsql set search_path='' as $$
declare d draft.drafts;
begin
 perform pg_advisory_xact_lock(20260925,2);
 perform pg_advisory_xact_lock(731943,1);
 lock table draft.drafts in share row exclusive mode;
 select * into strict d from draft.drafts where id=target for update;
 if exists(select 1 from draft.retired_rehearsals where draft_id=target) then return; end if;
 if d.revision is distinct from expected_revision then raise exception 'Draft changed; preview again'; end if;
 if d.status not in ('paused','awaiting_makeups','cancelled') then raise exception 'Pause rehearsal before retirement; completed drafts are protected'; end if;
 if explanation is null or length(trim(explanation))<20 then raise exception 'Explicit rehearsal retirement reason required'; end if;
 update draft.drafts set status='cancelled',deadline_at=null,paused_remaining_seconds=null,revision=revision+1 where id=target;
 insert into draft.retired_rehearsals(draft_id,reason,prior_state) values(target,explanation,to_jsonb(d));
 insert into draft.draft_events(draft_id,event_type,payload) values(target,'rehearsal_retired',jsonb_build_object('reason',explanation,'prior_state',to_jsonb(d)));
end $$;
revoke all on function draft.retire_rehearsal(uuid,bigint,text) from public,anon,authenticated;
create function draft.protect_retired_rehearsal() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from draft.retired_rehearsals where draft_id=old.id) then raise exception 'Retired rehearsal is immutable'; end if;
 return new;
end $$;
revoke all on function draft.protect_retired_rehearsal() from public,anon,authenticated;
create trigger protect_retired_rehearsal before update or delete on draft.drafts for each row execute function draft.protect_retired_rehearsal();
create or replace function draft.validate_membership(year_value integer, members jsonb, points numeric[], commissioner uuid) returns void
language plpgsql set search_path='' as $$
declare slugs text[]; names text[]; removed uuid[]; y integer;
begin
  perform pg_advisory_xact_lock(20260925,2);
  perform pg_advisory_xact_lock(731943,1);
  lock table draft.drafts in share row exclusive mode;
  if not exists(select 1 from draft.league_roles where auth_user_id=commissioner and role='commissioner') then raise exception 'Verified commissioner required'; end if;
  if jsonb_typeof(members) is distinct from 'array' then raise exception 'Member array required'; end if;
  select array_agg(m->>'slug' order by m->>'slug'),array_agg(m->>'name' order by m->>'slug') into slugs,names from jsonb_array_elements(members) m;
  if cardinality(slugs)<2 or cardinality(slugs) is null or cardinality(slugs)<>(select count(distinct s) from unnest(slugs) s)
    or exists(select 1 from unnest(slugs) s where s is null or s !~ '^[a-z][a-z0-9_-]*$')
    or cardinality(names)<>(select count(distinct n) from unnest(names) n)
    or array_ndims(points) is distinct from 1 or array_lower(points,1) is distinct from 1
    or exists(select 1 from unnest(names) n where n is null or trim(n)='' or length(n)>120)
    or cardinality(points) is distinct from cardinality(slugs)
    or exists(select 1 from unnest(points) p where p is null or p<0 or p::text in ('NaN','Infinity','-Infinity'))
    or exists(select 1 from generate_subscripts(points,1) i where i>1 and points[i]>=points[i-1]) then raise exception 'Unique members and a descending nonnegative placement table required'; end if;
  -- Existing setup drafts must be explicitly cancelled and recreated; never rewrite picks.
  if exists(select 1 from draft.drafts d where not exists(select 1 from draft.retired_rehearsals r where r.draft_id=d.id) and (
    (championship_year>=year_value and current_pick_number is not null)
    or status not in ('cancelled','completed')
    or (championship_year>=year_value and status='completed'))) then raise exception 'Cancel unused setup drafts first; started or completed seasons cannot change membership'; end if;
  if exists(select 1 from draft.season_settings where championship_year>year_value) then raise exception 'Historical season configuration is protected'; end if;
  if exists(select 1 from draft.owners o join jsonb_array_elements(members) m on o.slug=m->>'slug' where o.display_name<>m->>'name') then raise exception 'Use existing owner display names; renaming is a separate historical operation'; end if;
  if not exists(select 1 from draft.owner_accounts a join draft.owners o on o.id=a.owner_id where a.auth_user_id=commissioner and o.slug=any(slugs)) then raise exception 'Commissioner must remain an active member'; end if;
  select coalesce(array_agg(id),'{}') into removed from draft.owners where active and not(slug=any(slugs));
  if exists(select 1 from trading.players where owner_id=any(removed))
    or exists(select 1 from trading.trades where status in ('proposed','accepted') and (proposer_id=any(removed) or recipient_id=any(removed)))
    or exists(select 1 from trading.picks p where (p.original_owner_id=any(removed) or p.owner_id=any(removed)) and
      (p.owner_id<>p.original_owner_id or exists(select 1 from trading.pick_history h where h.pick_id=p.id) or exists(select 1 from trading.assets a where a.pick_id=p.id)))
    then raise exception 'Resolve roster assets, proposals and pick history before removing an owner'; end if;
end $$;
revoke all on function draft.validate_membership(integer,jsonb,numeric[],uuid) from public,anon,authenticated;

commit;
