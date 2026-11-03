begin;
create table trading.prospects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references draft.owners,
 sport draft.sport not null, name text not null check(length(trim(name)) between 1 and 120),
 fantrax_id text check(fantrax_id ~ '^[A-Za-z0-9_-]{1,64}$'), verified_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), ended_at timestamptz,
 status text not null default 'active' check(status in ('active','removed','confirmed')),
 revision integer not null default 1, confirmed_snapshot uuid references trading.roster_snapshots,
 check((status='active')=(ended_at is null)),check((fantrax_id is null)=(verified_at is null))
);
create unique index prospect_identity on trading.prospects(sport,fantrax_id) where status='active' and fantrax_id is not null;
create unique index prospect_name on trading.prospects(sport,lower(trim(name))) where status='active';
create table trading.prospect_events (
 id bigint generated always as identity primary key, prospect_id uuid not null references trading.prospects,
 actor_id uuid references auth.users, action text not null, reason text not null,
 before_state jsonb, after_state jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table trading.prospect_requests (
 request_id uuid primary key, actor_id uuid not null references auth.users, body jsonb not null,result jsonb not null
);
alter table trading.prospects enable row level security;
alter table trading.prospect_events enable row level security;
alter table trading.prospect_requests enable row level security;
revoke all on trading.prospects,trading.prospect_events,trading.prospect_requests from public,anon,authenticated;
create trigger immutable before update or delete on trading.prospect_events for each row execute function trading.immutable_history();
create trigger immutable before update or delete on trading.prospect_requests for each row execute function trading.immutable_history();

create function trading.prospect_count(target uuid) returns integer language sql stable set search_path='' as $$
 select count(*)::integer from trading.prospects where owner_id=target and status='active'
$$;
revoke all on function trading.prospect_count(uuid) from public,anon,authenticated;

-- Daily evidence is selected as of the actual fetch completion. Later removals
-- cannot erase that checkpoint. Confirmed prospects remain historical evidence.
create function trading.prospect_checkpoint(at_time timestamptz) returns table(id uuid,owner_id uuid,sport draft.sport,fantrax_id text)
language sql stable set search_path='' as $$
 select p.id,p.owner_id,p.sport,case when p.verified_at<=at_time then p.fantrax_id end
 from trading.prospects p where p.created_at<=at_time and (p.ended_at is null or p.ended_at>at_time)
$$;
revoke all on function trading.prospect_checkpoint(timestamptz) from public,anon,authenticated;

create function trading.refresh_prospect_alerts() returns void language plpgsql set search_path='' as $$
declare o record; alert uuid;
begin
 for o in select own.id,own.active,(count(p.id)+trading.prospect_count(own.id))::integer n from draft.owners own
 left join trading.players p on p.owner_id=own.id group by own.id loop
  if not o.active or o.n<=draft.roster_cap_at(clock_timestamp()) then
   update trading.roster_limit_alerts set resolved_at=clock_timestamp() where owner_id=o.id and resolved_at is null;
  else
   insert into trading.roster_limit_alerts(owner_id,player_count) values(o.id,o.n)
   on conflict(owner_id) where resolved_at is null do update set player_count=excluded.player_count returning id into alert;
   insert into trading.notifications(roster_alert_id,recipient_user_id,kind)
   select alert,a.auth_user_id,'roster_limit' from draft.owner_accounts a where a.owner_id=o.id
   on conflict(roster_alert_id,recipient_user_id) do nothing;
  end if;
 end loop;
end $$;
revoke all on function trading.refresh_prospect_alerts() from public,anon,authenticated;

create function public.prospect_command(req uuid,action text,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; p trading.prospects; old_state jsonb; prior trading.prospect_requests; result jsonb; pid uuid;
begin
 perform draft.require_commissioner();actor=auth.uid();
 perform pg_advisory_xact_lock(731943,1);
 if req is null or action is null or jsonb_typeof(args) is distinct from 'object' then raise exception 'Invalid prospect request'; end if;
 select * into prior from trading.prospect_requests where request_id=req;
 if found then
  if prior.actor_id<>actor or prior.body<>jsonb_build_object('action',action,'args',args) then raise exception 'Conflicting prospect retry'; end if;
  return prior.result;
 end if;
 if length(trim(coalesce(args->>'reason',''))) not between 5 and 1000 then raise exception 'Explain this prospect change (5-1000 characters)'; end if;
 if action='add' then
  if not exists(select 1 from draft.owners where id=(args->>'owner_id')::uuid and active) then raise exception 'Active owner required'; end if;
  insert into trading.prospects(owner_id,sport,name,fantrax_id,verified_at)
  values((args->>'owner_id')::uuid,(args->>'sport')::draft.sport,trim(args->>'name'),nullif(trim(args->>'fantrax_id'),''),
   case when nullif(trim(args->>'fantrax_id'),'') is not null then clock_timestamp() end) returning * into p;
 elsif action in ('remove','link') then
  select * into p from trading.prospects where id=(args->>'id')::uuid for update;
  if p.id is null or p.status<>'active' or p.revision is distinct from (args->>'revision')::integer then raise exception 'Prospect changed; refresh before retrying'; end if;
  old_state=to_jsonb(p);
  if action='remove' then
   update trading.prospects set status='removed',ended_at=clock_timestamp(),revision=revision+1 where id=p.id returning * into p;
  else
   if p.fantrax_id is not null then raise exception 'Verified identity is immutable; remove and re-add to correct'; end if;
   if coalesce(args->>'fantrax_id','') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'Verified Fantrax ID required'; end if;
   update trading.prospects set fantrax_id=args->>'fantrax_id',verified_at=clock_timestamp(),revision=revision+1 where id=p.id returning * into p;
  end if;
 else raise exception 'Unknown prospect command'; end if;
 -- A known already-rostered identity must not become an additional cap slot.
 if action='link' and exists(select 1 from trading.players where sport=p.sport and fantrax_id=p.fantrax_id and owner_id=p.owner_id) then
  update trading.prospects set status='confirmed',ended_at=clock_timestamp(),confirmed_snapshot=
   (select snapshot_id from trading.players where sport=p.sport and fantrax_id=p.fantrax_id and owner_id=p.owner_id limit 1)
   where id=p.id returning * into p;
 elsif action in ('add','link') and exists(select 1 from trading.players where sport=p.sport and fantrax_id=p.fantrax_id and owner_id is not null) then
  raise exception 'This Fantrax ID is already rostered. Review the existing roster before adding a prospect';
 end if;
 insert into trading.prospect_events(prospect_id,actor_id,action,reason,before_state,after_state)
 values(p.id,actor,action,args->>'reason',old_state,to_jsonb(p));
 perform trading.refresh_prospect_alerts();
 result=jsonb_build_object('id',p.id,'revision',p.revision,'status',p.status);
 insert into trading.prospect_requests values(req,actor,jsonb_build_object('action',action,'args',args),result);
 return result;
end $$;
revoke all on function public.prospect_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prospect_command(uuid,text,jsonb) to authenticated;

-- Reuse every original import validation, including retired connections,
-- complete membership, freshness and transaction locking.
alter function trading.ingest_rosters(draft.sport,text,timestamptz,jsonb,boolean) rename to ingest_rosters_before_prospects;
create function trading.ingest_rosters(sport_value draft.sport,league text,observed timestamptz,rosters jsonb,defer_reconciliation boolean) returns uuid
language plpgsql set search_path='' as $$
declare snap uuid; p trading.prospects; before_state jsonb;
begin
 snap=trading.ingest_rosters_before_prospects(sport_value,league,observed,rosters,defer_reconciliation);
 for p in select x.* from trading.prospects x join draft.owners o on o.id=x.owner_id
 where x.status='active' and x.sport=sport_value and x.verified_at<=observed
 and exists(select 1 from jsonb_array_elements(rosters) r cross join lateral jsonb_array_elements(r->'players') y
   where r->>'owner'=o.slug and y->>'player_id'=x.fantrax_id) for update of x loop
  before_state=to_jsonb(p);
  update trading.prospects set status='confirmed',ended_at=clock_timestamp(),confirmed_snapshot=snap,revision=revision+1 where id=p.id returning * into p;
  insert into trading.prospect_events(prospect_id,action,reason,before_state,after_state)
  values(p.id,'confirmed','Verified Fantrax ID appeared on the same owner roster',before_state,to_jsonb(p));
 end loop;
 return snap;
end $$;
revoke all on function trading.ingest_rosters_before_prospects(draft.sport,text,timestamptz,jsonb,boolean),trading.ingest_rosters(draft.sport,text,timestamptz,jsonb,boolean) from public,anon,authenticated;

create or replace function trading.ingest_roster_batch(snapshots jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform trading.ingest_roster_batch_without_alerts(snapshots);
 perform trading.refresh_prospect_alerts();
end $$;

-- Membership removal must not orphan prospects. Keep existing checks unchanged.
do $$ declare definition text; begin
 select pg_get_functiondef('draft.validate_membership(integer,jsonb,numeric[],uuid)'::regprocedure) into definition;
 if position('if exists(select 1 from trading.players where owner_id=any(removed))' in definition)=0 then raise exception 'Unexpected membership function'; end if;
 execute replace(definition,'if exists(select 1 from trading.players where owner_id=any(removed))',
 'if exists(select 1 from trading.prospects where owner_id=any(removed) and status=''active'') or exists(select 1 from trading.players where owner_id=any(removed))');
end $$;

create function public.prospect_rosters() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('owners',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.display_name,'slug',o.slug,
 'total', (select count(*) from trading.players p where p.owner_id=o.id)+trading.prospect_count(o.id),
 'fantrax_total',(select count(*) from trading.players p where p.owner_id=o.id)) order by o.display_name),'[]') from draft.owners o where o.active),
 'prospects',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'owner_id',p.owner_id,'name',p.name,'sport',p.sport,'fantrax_id',p.fantrax_id,'revision',p.revision,
 'other_owner_match',exists(select 1 from trading.players t where t.sport=p.sport and t.fantrax_id=p.fantrax_id and t.owner_id<>p.owner_id)) order by p.name),'[]') from trading.prospects p where p.status='active'),
 'sports_observed',(select count(distinct sport) from trading.roster_snapshots))
$$;
revoke all on function public.prospect_rosters() from public,anon,authenticated;
grant execute on function public.prospect_rosters() to anon,authenticated;

create function public.prospect_admin() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform draft.require_commissioner();
 return jsonb_build_object('commissioner',true,'events',(select coalesce(jsonb_agg(x),'[]') from
 (select p.name,p.sport,o.display_name owner,e.action,e.reason,e.recorded_at from trading.prospect_events e
 join trading.prospects p on p.id=e.prospect_id join draft.owners o on o.id=p.owner_id order by e.id desc limit 50) x));
end $$;
revoke all on function public.prospect_admin() from public,anon,authenticated;
grant execute on function public.prospect_admin() to authenticated;

alter function public.trade_rosters() rename to trade_rosters_before_prospects;
create function public.trade_rosters() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=public.trade_rosters_before_prospects();
 return result||jsonb_build_object('prospect_counts',(select coalesce(jsonb_object_agg(owner_id,n),'{}') from
 (select owner_id,count(*)::integer n from trading.prospects where status='active' group by owner_id) x));
end $$;
revoke all on function public.trade_rosters_before_prospects(),public.trade_rosters() from public,anon,authenticated;
grant execute on function public.trade_rosters() to authenticated;
notify pgrst,'reload schema';
commit;
