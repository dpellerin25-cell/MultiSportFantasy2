begin;
select pg_advisory_xact_lock(731944,1);
-- New observations explicitly opt into actual scheduled-run timing. Historical
-- payloads and commissioner decisions keep the original fixed-hour interpretation.
create function scoring.roster_check_time(c scoring.roster_checks) returns timestamptz
language sql stable set search_path='' as $$
 select case when c.payload->>'timing_policy'='scheduled-observation-v2'
 then (c.payload->>'observed_at')::timestamptz
 else (c.check_date+time '04:00') at time zone 'America/New_York' end
$$;
revoke all on function scoring.roster_check_time(scoring.roster_checks) from public,anon,authenticated;
do $$ declare definition text; old text; replacement text; begin
 select pg_get_functiondef('scoring.record_roster_check(uuid,jsonb,integer)'::regprocedure) into definition;
 old='if complete and extract(hour from (x->>''observed_at'')::timestamptz at time zone ''America/New_York'')<>4 then';
 if position(old in definition)=0 then raise exception 'Unexpected roster validator'; end if;
 definition=replace(definition,old,'if complete and coalesce(body->>''timing_policy'','''')<>''scheduled-observation-v2'' and extract(hour from (x->>''observed_at'')::timestamptz at time zone ''America/New_York'')<>4 then');
 old='if complete and cardinality(sports)<>5 then';
 replacement=$patch$
 if body ? 'timing_policy' then
   if body->>'timing_policy' is distinct from 'scheduled-observation-v2'
     or (body->>'observed_at')::timestamptz is null
     or (body->>'observed_at')::timestamptz>clock_timestamp()
     or ((body->>'observed_at')::timestamptz at time zone 'America/New_York')::date<>day
     or exists(select 1 from jsonb_array_elements(body->'sports') s
        where (s->>'observed_at')::timestamptz>(body->>'observed_at')::timestamptz)
   then raise exception 'Invalid scheduled observation timing'; end if;
 end if;
 if complete and cardinality(sports)<>5 then
 $patch$;
 if position(old in definition)=0 then raise exception 'Unexpected completeness validator'; end if;
 execute replace(definition,old,replacement);

 select pg_get_functiondef('scoring.evaluate(uuid,timestamptz)'::regprocedure) into definition;
 old='draft.roster_cap_at((day+time ''04:00'') at time zone ''America/New_York'')';
 if position(old in definition)=0 then raise exception 'Unexpected cap evaluator'; end if;
 definition=replace(definition,old,'draft.roster_cap_at(scoring.roster_check_time(c))');
 old='effective_at<=((day+time ''04:00'') at time zone ''America/New_York'')';
 if position(old in definition)=0 then raise exception 'Unexpected pause evaluator'; end if;
 definition=replace(definition,old,'effective_at<=coalesce(scoring.roster_check_time(c),((day+time ''04:00'') at time zone ''America/New_York''))');
 old='deadline=scoring.deadline(p.id);';
 replacement=$patch$
 deadline=scoring.deadline(p.id);
 if p.scope='day' then
   select * into c from scoring.roster_checks where owner_id=r.owner_id
     and check_date=p.end_date+1 and recorded_at<=as_of order by revision desc limit 1;
   if c.payload->>'timing_policy'='scheduled-observation-v2' then deadline=scoring.roster_check_time(c); end if;
 end if;
 $patch$;
 if position(old in definition)=0 then raise exception 'Unexpected deadline evaluator'; end if;
 execute replace(definition,old,replacement);
end $$;
commit;
