begin;
create function draft.validate_membership(year_value integer, members jsonb, points numeric[], commissioner uuid) returns void
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
  if exists(select 1 from draft.drafts where championship_year>=year_value and current_pick_number is not null)
    or exists(select 1 from draft.drafts where status not in ('cancelled','completed'))
    or exists(select 1 from draft.drafts where championship_year>=year_value and status='completed') then raise exception 'Cancel unused setup drafts first; started or completed seasons cannot change membership'; end if;
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
create or replace function draft.configure_membership(year_value integer, members jsonb, points numeric[], commissioner uuid) returns void
language plpgsql set search_path='' as $$
declare slugs text[]; names text[]; removed uuid[]; y integer;
begin
  perform draft.validate_membership(year_value,members,points,commissioner);
  select array_agg(m->>'slug' order by m->>'slug') into slugs from jsonb_array_elements(members) m;
  select coalesce(array_agg(id),'{}') into removed from draft.owners where active and not(slug=any(slugs));
  delete from trading.picks where original_owner_id=any(removed) and owner_id=original_owner_id
    and year>=extract(year from current_date)::integer+1;
  update draft.owners set active=false where id=any(removed);
  insert into draft.owners(slug,display_name) select m->>'slug',m->>'name' from jsonb_array_elements(members) m
    on conflict(slug) do update set active=true; -- Names are historical identities; replacements use a separate process.
  insert into draft.season_settings(championship_year,owner_slugs,placement_points) values(year_value,slugs,points)
    on conflict(championship_year) do update set owner_slugs=excluded.owner_slugs,placement_points=excluded.placement_points,configured_at=clock_timestamp();
  insert into draft.membership_events(championship_year,commissioner,configuration) values(year_value,commissioner,jsonb_build_object('owners',members,'placement_points',points));
  if exists(select 1 from trading.ledger_import) then
    y=extract(year from current_date)::integer;
    perform trading.seed_picks(y+1);perform trading.seed_picks(y+2);
  end if;
end $$;

create function draft.require_commissioner() returns void language plpgsql stable set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from draft.league_roles r join draft.owner_accounts a on a.auth_user_id=r.auth_user_id join draft.owners o on o.id=a.owner_id where r.auth_user_id=auth.uid() and r.role='commissioner' and o.active) then
   raise exception 'Commissioner access required' using errcode='42501';
 end if;
end $$;
revoke all on function draft.require_commissioner() from public,anon,authenticated;
create function draft.settings_snapshot() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
   'season',(select to_jsonb(s) from draft.season_settings s order by championship_year desc limit 1),
   'owners',(select jsonb_agg(jsonb_build_object('slug',slug,'name',display_name,'active',active) order by slug) from draft.owners)
 );
$$;
revoke all on function draft.settings_snapshot() from public,anon,authenticated;
create function public.league_settings_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb;
begin
 perform draft.require_commissioner();s=draft.settings_snapshot();
 return s||jsonb_build_object('version',md5(s::text));
end $$;
create function public.league_settings_preview(year_value integer,members jsonb,points numeric[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; problem text; token text;
begin
 perform draft.require_commissioner();
 perform pg_advisory_xact_lock(20260925,2);
 perform pg_advisory_xact_lock(731943,1);
 s=draft.settings_snapshot();
 if year_value is distinct from (s->'season'->>'championship_year')::integer then raise exception 'Refresh the current season before editing'; end if;
 begin
   perform draft.validate_membership(year_value,members,points,auth.uid());
 exception when raise_exception then problem=sqlerrm;
 end;
 token=md5(jsonb_build_object('state',s,'year',year_value,'members',members,'points',points)::text);
 return jsonb_build_object('token',token,'can_apply',problem is null,'blockers',case when problem is null then '[]'::jsonb else jsonb_build_array(problem) end,
   'owner_count',jsonb_array_length(members),'startup_picks',65*jsonb_array_length(members),'rookie_picks_per_year',10*jsonb_array_length(members),
   'added',(select coalesce(jsonb_agg(m->>'name'),'[]') from jsonb_array_elements(members) m where not exists(select 1 from draft.owners o where o.slug=m->>'slug' and o.active)),
   'removed',(select coalesce(jsonb_agg(o.display_name order by o.slug),'[]') from draft.owners o where o.active and not exists(select 1 from jsonb_array_elements(members) m where m->>'slug'=o.slug)));
end $$;
create table draft.settings_requests (
 actor uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(actor,request_id)
);
alter table draft.settings_requests enable row level security;
revoke all on draft.settings_requests from public,anon,authenticated;
create trigger immutable_settings_requests before update or delete on draft.settings_requests for each row execute function trading.immutable_history();
create function public.league_settings_apply(request_id uuid,year_value integer,members jsonb,points numeric[],preview_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload_value jsonb; prior draft.settings_requests; s jsonb; result_value jsonb;
begin
 perform draft.require_commissioner();
 if request_id is null or preview_token is null then raise exception 'Preview and request identity required'; end if;
 perform pg_advisory_xact_lock(20260925,2);
 perform pg_advisory_xact_lock(731943,1);
 payload_value=jsonb_build_object('year',year_value,'members',members,'points',points,'token',preview_token);
 select * into prior from draft.settings_requests r where r.actor=auth.uid() and r.request_id=league_settings_apply.request_id;
 if found then
   if prior.payload<>payload_value then raise exception 'Request identity already used for different settings'; end if;
   return prior.result;
 end if;
 s=draft.settings_snapshot();
 if year_value is distinct from (s->'season'->>'championship_year')::integer or preview_token<>md5(jsonb_build_object('state',s,'year',year_value,'members',members,'points',points)::text) then
   raise exception 'Settings changed. Refresh and preview again';
 end if;
 -- Recheck all draft/trade/roster blockers under the original locks at apply time.
 perform draft.configure_membership(year_value,members,points,auth.uid());
 result_value=jsonb_build_object('applied',true,'settings',draft.settings_snapshot());
 insert into draft.settings_requests values(auth.uid(),request_id,payload_value,result_value);
 return result_value;
end $$;
revoke all on function public.league_settings_state(),public.league_settings_preview(integer,jsonb,numeric[]),public.league_settings_apply(uuid,integer,jsonb,numeric[],text) from public,anon,authenticated;
grant execute on function public.league_settings_state(),public.league_settings_preview(integer,jsonb,numeric[]),public.league_settings_apply(uuid,integer,jsonb,numeric[],text) to authenticated;
commit;
