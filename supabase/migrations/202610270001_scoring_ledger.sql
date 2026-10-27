begin;
create schema scoring;
revoke all on schema scoring from public,anon,authenticated;

-- Explicit scope prevents pre-launch diagnostics from becoming Cup results.
create table scoring.seasons (
 id uuid primary key default gen_random_uuid(),
 sport draft.sport not null,
 league_id text not null check(length(trim(league_id))>0),
 season_year integer not null check(season_year between 2000 and 2200),
 championship_year integer,
 is_test boolean not null default true,
 check((is_test and championship_year is null) or
       (not is_test and championship_year is not null and championship_year>=2027 and championship_year=season_year)),
 unique(sport,league_id), unique(id,sport)
);
create unique index one_production_sport_per_cup on scoring.seasons(sport,championship_year) where not is_test;
create table scoring.periods (
 id uuid primary key default gen_random_uuid(),
 season_id uuid not null references scoring.seasons,
 scope text not null check(scope in ('day','tournament')),
 start_date date not null, end_date date not null,
 source_period integer, label text not null,
 check((scope='day' and start_date=end_date and source_period is null) or
       (scope='tournament' and end_date=start_date+3 and extract(isodow from start_date)=4 and source_period is not null and source_period>0)),
 unique(season_id,start_date), unique(season_id,source_period)
);
create function scoring.validate_period() returns trigger language plpgsql set search_path='' as $$
declare s scoring.seasons;
begin
 select * into strict s from scoring.seasons where id=new.season_id;
 if (s.sport='PGA')<>(new.scope='tournament') then raise exception 'Sport and period scope differ'; end if;
 if extract(year from new.start_date)<s.season_year or extract(year from new.end_date)>
    (s.season_year+case when s.sport in ('NFL','NBA','EPL') then 1 else 0 end) then
   raise exception 'Period outside season calendar'; end if;
 return new;
end $$;
create trigger validate_period before insert on scoring.periods for each row execute function scoring.validate_period();

create table scoring.results (
 id uuid primary key default gen_random_uuid(), request_id uuid unique not null,
 period_id uuid not null references scoring.periods, owner_id uuid not null references draft.owners,
 revision integer not null check(revision>0), team_id text not null check(length(trim(team_id))>0),
 observed_at timestamptz not null, recorded_at timestamptz not null default clock_timestamp(),
 starter_total numeric not null, bench_total numeric not null,
 events_finished boolean not null, payload jsonb not null, reason text not null check(length(trim(reason))>0),
 unique(period_id,owner_id,revision)
);
create table scoring.contributions (
 result_id uuid not null references scoring.results,
 player_id text not null check(length(trim(player_id))>0), player_name text not null check(length(trim(player_name))>0),
 lineup text not null check(lineup in ('ACTIVE','BENCH')),
 raw_points numeric, score_state text not null check(score_state in ('known','no_activity','unknown')),
 evidence text,
 check((score_state='known' and raw_points is not null and raw_points::text not in ('NaN','Infinity','-Infinity')) or
       (score_state<>'known' and raw_points is null)),
 check(score_state<>'no_activity' or coalesce(length(trim(evidence)),0)>0),
 primary key(result_id,player_id)
);

-- One owner's five-sport count observation. Corrections append; no overwritten history.
create table scoring.roster_checks (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 owner_id uuid not null references draft.owners, check_date date not null,
 revision integer not null check(revision>0), complete boolean not null,
 total_players integer, payload jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(), reason text not null,
 unique(owner_id,check_date,revision),
 check((complete and total_players is not null and total_players>=0) or (not complete and total_players is null))
);
create table scoring.pause_events (
 id bigint generated always as identity primary key,
 request_id uuid not null unique, paused boolean not null,
 effective_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users, reason text not null check(length(trim(reason))>=5)
);
create table scoring.decisions (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 result_id uuid not null references scoring.results,
 evaluated_at timestamptz not null default clock_timestamp(),
 status text not null check(status in ('pending','eligible','paused','penalized')),
 reason text not null, adjusted_total numeric, removed_positive numeric,
 evidence jsonb not null,
 check((status='pending' and adjusted_total is null and removed_positive is null) or
       (status<>'pending' and adjusted_total is not null and removed_positive is not null and removed_positive>=0))
);
create table scoring.pga_resolutions (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 result_id uuid not null references scoring.results,
 choice text not null check(choice in ('enforce','waive')),
 checks jsonb not null, actor_id uuid not null references auth.users,
 reason text not null check(length(trim(reason))>=5),
 recorded_at timestamptz not null default clock_timestamp(),
 supersedes uuid references scoring.pga_resolutions
);

create function scoring.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Scoring history is immutable; append a revision'; end $$;
do $$ declare t text; begin
 foreach t in array array['seasons','periods','results','contributions','roster_checks','pause_events','decisions','pga_resolutions'] loop
 execute format('alter table scoring.%I enable row level security',t);
 execute format('revoke all on scoring.%I from public,anon,authenticated',t);
 execute format('create trigger immutable before update or delete on scoring.%I for each row execute function scoring.immutable()',t);
 end loop;
end $$;

-- Trusted importer only. Same lock serializes revisions, checks and decisions.
create function scoring.import_result(req uuid, body jsonb, expected_revision integer) returns uuid
language plpgsql set search_path='' as $$
declare previous scoring.results; rid uuid; latest integer; x jsonb; p scoring.periods;
 owner uuid=(body->>'owner_id')::uuid; period uuid=(body->>'period_id')::uuid;
begin
 perform pg_advisory_xact_lock(731944,1);
 select * into previous from scoring.results where request_id=req;
 if found then
   if previous.payload<>body then raise exception 'Conflicting scoring retry'; end if;
   return previous.id;
 end if;
 if req is null or expected_revision is null or expected_revision<0 then raise exception 'Explicit revision and request required'; end if;
 select * into strict p from scoring.periods where id=period;
 select coalesce(max(revision),0) into latest from scoring.results where period_id=period and owner_id=owner;
 if latest<>expected_revision then raise exception 'Stale scoring revision'; end if;
 if jsonb_typeof(body->'players') is distinct from 'array' or coalesce(trim(body->>'reason'),'')='' or
    (body->>'observed_at')::timestamptz is null or (body->>'observed_at')::timestamptz>clock_timestamp() then raise exception 'Invalid scoring evidence'; end if;
 if ((body->>'observed_at')::timestamptz at time zone 'America/New_York')::date<p.start_date then raise exception 'Scoring observation precedes period'; end if;
 if latest>0 and (body->>'observed_at')::timestamptz <= (select observed_at from scoring.results where period_id=period and owner_id=owner and revision=latest) then raise exception 'Older scoring evidence'; end if;
 if (body->>'starter_total')::numeric::text in ('NaN','Infinity','-Infinity') or (body->>'bench_total')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Nonfinite totals'; end if;
 insert into scoring.results(request_id,period_id,owner_id,revision,team_id,observed_at,starter_total,bench_total,events_finished,payload,reason)
 values(req,period,owner,latest+1,body->>'team_id',(body->>'observed_at')::timestamptz,(body->>'starter_total')::numeric,(body->>'bench_total')::numeric,(body->>'events_finished')::boolean,body,body->>'reason') returning id into rid;
 for x in select value from jsonb_array_elements(body->'players') loop
   insert into scoring.contributions(result_id,player_id,player_name,lineup,raw_points,score_state,evidence)
   values(rid,x->>'player_id',x->>'player_name',x->>'lineup',(x->>'points')::numeric,x->>'state',x->>'evidence');
 end loop;
 if (select coalesce(sum(raw_points),0) from scoring.contributions where result_id=rid and lineup='ACTIVE')<>(body->>'starter_total')::numeric or
    (select coalesce(sum(raw_points),0) from scoring.contributions where result_id=rid and lineup='BENCH')<>(body->>'bench_total')::numeric then raise exception 'Scoring totals do not reconcile'; end if;
 return rid;
end $$;

create function scoring.record_roster_check(req uuid, body jsonb, expected_revision integer) returns uuid
language plpgsql set search_path='' as $$
declare prior scoring.roster_checks; latest integer; x jsonb; sports text[]='{}'; n integer=0; rid uuid;
 owner uuid=(body->>'owner_id')::uuid; day date=(body->>'check_date')::date; complete boolean=(body->>'complete')::boolean;
begin
 perform pg_advisory_xact_lock(731944,1);
 select * into prior from scoring.roster_checks where request_id=req;
 if found then
   if prior.payload<>body then raise exception 'Conflicting roster retry'; end if;
   return prior.id;
 end if;
 select coalesce(max(revision),0) into latest from scoring.roster_checks where owner_id=owner and check_date=day;
 if expected_revision is null or latest<>expected_revision then raise exception 'Stale roster revision'; end if;
 if jsonb_typeof(body->'sports') is distinct from 'array' or coalesce(trim(body->>'reason'),'')='' then raise exception 'Roster evidence required'; end if;
 for x in select value from jsonb_array_elements(body->'sports') loop
   if x->>'sport' is null or x->>'sport' not in ('NFL','MLB','NBA','EPL','PGA') or x->>'sport'=any(sports) or
      x->>'count' is null or (x->>'count')!~'^[0-9]+$' or coalesce(trim(x->>'source_ref'),'')='' or
      (x->>'observed_at')::timestamptz is null or (x->>'observed_at')::timestamptz>clock_timestamp() or
      ((x->>'observed_at')::timestamptz at time zone 'America/New_York')::date<>day then raise exception 'Invalid roster observation'; end if;
   -- Only observations from the scheduled 4 a.m. hour qualify as cap evidence.
   if complete and extract(hour from (x->>'observed_at')::timestamptz at time zone 'America/New_York')<>4 then raise exception 'Complete cap check requires 4am evidence'; end if;
   sports=array_append(sports,x->>'sport'); n=n+(x->>'count')::integer;
 end loop;
 if complete and cardinality(sports)<>5 then raise exception 'Five sports required for eligibility'; end if;
 insert into scoring.roster_checks(request_id,owner_id,check_date,revision,complete,total_players,payload,reason)
 values(req,owner,day,latest+1,complete,case when complete then n end,body,body->>'reason') returning id into rid;
 return rid;
end $$;

-- Only the future commissioner UI can call this authenticated command.
create function scoring.set_penalty_pause(req uuid, paused_value boolean, explanation text, expected_event bigint) returns bigint
language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); prior scoring.pause_events; latest bigint; eid bigint;
begin
 perform pg_advisory_xact_lock(731944,1);
 if actor is null or not exists(select 1 from draft.league_roles where auth_user_id=actor and role='commissioner') then raise exception 'Commissioner required'; end if;
 select * into prior from scoring.pause_events where request_id=req;
 if found then
   if prior.actor_id<>actor or prior.paused is distinct from paused_value or prior.reason is distinct from explanation then raise exception 'Conflicting pause retry'; end if;
   return prior.id;
 end if;
 select coalesce(max(id),0) into latest from scoring.pause_events;
 if expected_event is null or latest<>expected_event then raise exception 'Stale pause state'; end if;
 insert into scoring.pause_events(request_id,paused,actor_id,reason) values(req,paused_value,actor,explanation) returning id into eid;
 return eid;
end $$;

-- Read-only evaluator takes an explicit clock for deterministic offline tests.
-- It is NOT exposed to browser roles. Persistence below always uses database time.
create function scoring.deadline(period uuid) returns timestamptz
language sql stable set search_path='' as $$
 select case when scope='tournament' then ((end_date+2)+time '08:00') at time zone 'America/New_York'
 else ((end_date+1)+time '04:00') at time zone 'America/New_York' end
 from scoring.periods where id=period
$$;
create function scoring.evaluate(result uuid, as_of timestamptz) returns jsonb
language plpgsql set search_path='' as $$
declare r scoring.results; p scoring.periods; days date[]; day date; c scoring.roster_checks;
 checks jsonb='[]'; over_count integer=0; paused_count integer=0; pause_id bigint; is_paused boolean;
 missing boolean=false; positive numeric; negative numeric; deadline timestamptz;
 resolution scoring.pga_resolutions;
begin
 select * into strict r from scoring.results where id=result;
 select * into strict p from scoring.periods where id=r.period_id;
 if as_of is null then raise exception 'Evaluation time required'; end if;
 if as_of<r.recorded_at then return jsonb_build_object('status','pending','reason','Result not yet recorded'); end if;
 if exists(select 1 from scoring.results where period_id=r.period_id and owner_id=r.owner_id and revision>r.revision) then raise exception 'Scoring revision superseded'; end if;
 if p.scope='tournament' then
   days=array[p.start_date,p.end_date]; deadline=((p.end_date+2)+time '08:00') at time zone 'America/New_York';
 else
   days=array[p.end_date+1]; deadline=((p.end_date+1)+time '04:00') at time zone 'America/New_York';
 end if;
 deadline=scoring.deadline(p.id);
 if as_of<deadline then return jsonb_build_object('status','pending','reason','Before scoring deadline'); end if;
 foreach day in array days loop
   select * into c from scoring.roster_checks where owner_id=r.owner_id and check_date=day and recorded_at<=as_of order by revision desc limit 1;
   if not found or not c.complete then missing=true; end if;
   if c.complete and c.total_players>65 then over_count=over_count+1; end if;
   select id,paused into pause_id,is_paused from scoring.pause_events where effective_at<=((day+time '04:00') at time zone 'America/New_York') order by effective_at desc,id desc limit 1;
   if coalesce(is_paused,false) then paused_count=paused_count+1; end if;
   checks=checks||jsonb_build_array(jsonb_build_object('date',day,'check_id',c.id,'pause_event_id',pause_id));
 end loop;
 if missing then return jsonb_build_object('status','pending','reason','Missing or incomplete roster checks','checks',checks); end if;
 if p.scope='day' and not r.events_finished then return jsonb_build_object('status','pending','reason','Events not finished','checks',checks); end if;
 if exists(select 1 from scoring.contributions where result_id=result and lineup='ACTIVE' and score_state='unknown') then return jsonb_build_object('status','pending','reason','Unknown starter scoring','checks',checks); end if;
 select coalesce(sum(greatest(raw_points,0)),0),coalesce(sum(least(raw_points,0)),0) into positive,negative from scoring.contributions where result_id=result and lineup='ACTIVE';
 if paused_count>0 and paused_count<cardinality(days) then
   select * into resolution from scoring.pga_resolutions where result_id=result and recorded_at<=as_of order by recorded_at desc,id desc limit 1;
   if not found or resolution.checks<>checks then
     return jsonb_build_object('status','pending','reason','PGA pause boundary requires policy decision','checks',checks);
   end if;
   if resolution.choice='waive' then
     return jsonb_build_object('status','paused','reason','Commissioner waived mixed-pause PGA penalty','adjusted_total',positive+negative,'removed_positive',0,'checks',checks,'resolution_id',resolution.id);
   end if;
   return jsonb_build_object('status',case when over_count=cardinality(days) then 'penalized' else 'eligible' end,
     'reason','Commissioner applied standard PGA cap rule','adjusted_total',case when over_count=cardinality(days) then negative else positive+negative end,
     'removed_positive',case when over_count=cardinality(days) then positive else 0 end,'checks',checks,'resolution_id',resolution.id);
 end if;
 if paused_count=cardinality(days) then return jsonb_build_object('status','paused','reason','Penalties paused at all checks','adjusted_total',positive+negative,'removed_positive',0,'checks',checks); end if;
 if over_count=cardinality(days) then return jsonb_build_object('status','penalized','reason','Over cap at required checks','adjusted_total',negative,'removed_positive',positive,'checks',checks); end if;
 return jsonb_build_object('status','eligible','reason','Roster cap satisfied','adjusted_total',positive+negative,'removed_positive',0,'checks',checks);
end $$;

-- Review token binds a commissioner decision to the exact result and count/pause
-- revisions. This command cannot override unknown scores or missing counts.
create function scoring.review_pga_resolution(result uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare outcome jsonb; last_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from draft.league_roles where auth_user_id=auth.uid() and role='commissioner') then raise exception 'Commissioner required'; end if;
 outcome=scoring.evaluate(result,clock_timestamp());
 select id into last_id from scoring.pga_resolutions where result_id=result order by recorded_at desc,id desc limit 1;
 return outcome||jsonb_build_object('result_id',result,'last_resolution_id',last_id);
end $$;

create function scoring.resolve_pga_pause(req uuid, result uuid, choice_value text, explanation text, expected_checks jsonb, expected_resolution uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); prior scoring.pga_resolutions; outcome jsonb; last_id uuid; rid uuid;
begin
 perform pg_advisory_xact_lock(731944,1);
 if actor is null or not exists(select 1 from draft.league_roles where auth_user_id=actor and role='commissioner') then raise exception 'Commissioner required'; end if;
 select * into prior from scoring.pga_resolutions where request_id=req;
 if found then
   if prior.actor_id<>actor or prior.result_id is distinct from result or prior.choice is distinct from choice_value or prior.reason is distinct from explanation or prior.checks is distinct from expected_checks or prior.supersedes is distinct from expected_resolution then raise exception 'Conflicting PGA resolution retry'; end if;
   return prior.id;
 end if;
 outcome=scoring.evaluate(result,clock_timestamp());
 if outcome->>'reason' is distinct from 'PGA pause boundary requires policy decision' and not(outcome ? 'resolution_id') then raise exception 'Only mixed-pause PGA decisions can be resolved'; end if;
 if expected_checks is null or outcome->'checks' is distinct from expected_checks then raise exception 'Scoring evidence changed; review again'; end if;
 select id into last_id from scoring.pga_resolutions where result_id=result order by recorded_at desc,id desc limit 1;
 if last_id is distinct from expected_resolution then raise exception 'Decision changed; review again'; end if;
 insert into scoring.pga_resolutions(request_id,result_id,choice,checks,actor_id,reason,supersedes)
 values(req,result,choice_value,expected_checks,actor,explanation,last_id) returning id into rid;
 return rid;
end $$;

create function scoring.record_decision(req uuid, result uuid) returns uuid
language plpgsql set search_path='' as $$
declare prior scoring.decisions; outcome jsonb; rid uuid;
begin
 perform pg_advisory_xact_lock(731944,1);
 select * into prior from scoring.decisions where request_id=req;
 if found then
   if prior.result_id<>result then raise exception 'Conflicting decision retry'; end if;
   return prior.id;
 end if;
 outcome=scoring.evaluate(result,clock_timestamp());
 insert into scoring.decisions(request_id,result_id,status,reason,adjusted_total,removed_positive,evidence)
 values(req,result,outcome->>'status',outcome->>'reason',(outcome->>'adjusted_total')::numeric,(outcome->>'removed_positive')::numeric,outcome) returning id into rid;
 return rid;
end $$;

-- Latest revisions only; no production standings are wired to these views.
create view scoring.latest_results as select distinct on(period_id,owner_id) * from scoring.results order by period_id,owner_id,revision desc;
create view scoring.latest_roster_checks as select distinct on(owner_id,check_date) * from scoring.roster_checks order by owner_id,check_date,revision desc;
-- Stored decisions are audit history, not a cache. Re-evaluate latest evidence so
-- a corrected score or count cannot leave a stale penalty in a future reader.
create view scoring.current_outcomes as
 select r.id result_id,r.owner_id,r.revision,p.id period_id,p.start_date,p.end_date,
 s.sport,s.league_id,s.season_year,s.championship_year,s.is_test,
 scoring.evaluate(r.id,clock_timestamp()) outcome
 from scoring.latest_results r join scoring.periods p on p.id=r.period_id
 join scoring.seasons s on s.id=p.season_id;
revoke all on all tables in schema scoring from public,anon,authenticated;
revoke all on all sequences in schema scoring from public,anon,authenticated;
revoke all on all functions in schema scoring from public,anon,authenticated;
grant usage on schema scoring to authenticated;
grant execute on function scoring.set_penalty_pause(uuid,boolean,text,bigint) to authenticated;
grant execute on function scoring.review_pga_resolution(uuid) to authenticated;
grant execute on function scoring.resolve_pga_pause(uuid,uuid,text,text,jsonb,uuid) to authenticated;
commit;


