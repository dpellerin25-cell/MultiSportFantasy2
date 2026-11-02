begin;
-- Explicit immutable season/team approvals survive roster renewals and trades.
create table scoring.sources (
 id uuid primary key default gen_random_uuid(), season_id uuid not null unique references scoring.seasons,
 specification jsonb not null, checksum text not null unique, approved_at timestamptz not null default clock_timestamp(),
 enabled boolean not null default true, publish boolean not null default false
);
create table scoring.jobs (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references scoring.sources,
 owner_id uuid not null references draft.owners, team_id text not null, start_date date not null, end_date date not null,
 source_period integer, due_at timestamptz not null,
 last_attempt timestamptz, last_error text, result_id uuid references scoring.results,
 unique(source_id,owner_id,start_date)
);
create table scoring.fetch_attempts (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references scoring.jobs,
 recorded_at timestamptz not null default clock_timestamp(), status text not null check(status in ('success','pending')),
 detail text not null, result_id uuid references scoring.results, content_hash text
);
create trigger immutable before update or delete on scoring.fetch_attempts for each row execute function scoring.immutable();
create function scoring.protect_source() returns trigger language plpgsql set search_path='' as $$
begin
 if new.specification<>old.specification or new.season_id<>old.season_id or new.checksum<>old.checksum or new.approved_at<>old.approved_at then raise exception 'Source approval is immutable'; end if;
 return new;
end $$;
create trigger protect_source before update on scoring.sources for each row execute function scoring.protect_source();
do $$ declare t text; begin
 foreach t in array array['sources','jobs','fetch_attempts'] loop
 execute format('alter table scoring.%I enable row level security',t);
 execute format('revoke all on scoring.%I from public,anon,authenticated',t);
 end loop;
end $$;
revoke all on function scoring.protect_source() from public,anon,authenticated;
create index scoring_jobs_due on scoring.jobs(due_at,last_attempt);

-- Public player breakdown only. No raw roster counts, test seasons or private audit data.
create function public.player_scoring_totals(sport_value text,cup_year integer,owner_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; oid uuid; answer jsonb;
begin
 if sport_value not in ('NFL','MLB','NBA','EPL','PGA') or cup_year not between 2027 and 2200 or length(owner_name)>100 then raise exception 'Invalid scoring selection'; end if;
 select s.id into sid from scoring.seasons s join scoring.sources src on src.season_id=s.id
 where s.sport::text=sport_value and s.championship_year=cup_year and not s.is_test and src.publish;
 select id into oid from draft.owners where display_name=owner_name;
 if sid is null or oid is null then return jsonb_build_object('available',false,'players','[]'::jsonb); end if;
 with results as materialized (
  select r.*,p.start_date, scoring.evaluate(r.id,clock_timestamp()) outcome,j.last_error
  from scoring.latest_results r join scoring.periods p on p.id=r.period_id
  left join scoring.sources src on src.season_id=p.season_id
  left join scoring.jobs j on j.source_id=src.id and j.owner_id=r.owner_id and j.start_date=p.start_date
  where p.season_id=sid and r.owner_id=oid
 ), player_rows as (
  select c.*,r.observed_at,
   (r.outcome->>'status'='pending' or r.last_error is not null) pending,
   r.outcome->>'status' status
  from results r join scoring.contributions c on c.result_id=r.id
 ), totals as (
  select player_id,(array_agg(player_name order by observed_at desc))[1] player_name,
   sum(case when lineup='ACTIVE' then coalesce(raw_points,0) else 0 end) known_starter_points,
   sum(case when lineup='ACTIVE' and not pending then case when status='penalized' then least(coalesce(raw_points,0),0) else coalesce(raw_points,0) end else 0 end) counted_points,
   sum(case when lineup='ACTIVE' and not pending and status='penalized' then greatest(coalesce(raw_points,0),0) else 0 end) removed_points,
   count(*) filter(where lineup='ACTIVE' and pending) pending_periods,
   count(*) filter(where lineup='ACTIVE' and score_state='unknown') missing_records,
   count(*) filter(where lineup='ACTIVE') starter_periods
  from player_rows group by player_id
 ) select jsonb_build_object('available',true,'players',coalesce((select jsonb_agg(to_jsonb(t) order by counted_points desc,player_name) from totals t),'[]'::jsonb),
 'last_observed_at',(select max(observed_at) from results),
 'pending_periods',(select count(*) from scoring.jobs j join scoring.sources src on src.id=j.source_id
 where src.season_id=sid and j.owner_id=oid and j.due_at<=clock_timestamp() and
 (j.result_id is null or j.last_error is not null or exists(select 1 from results r where r.start_date=j.start_date and r.outcome->>'status'='pending')))) into answer;
 return answer;
end $$;
revoke all on function public.player_scoring_totals(text,integer,text) from public,anon,authenticated;
grant execute on function public.player_scoring_totals(text,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
