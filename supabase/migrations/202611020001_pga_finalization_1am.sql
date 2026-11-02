begin;
select pg_advisory_xact_lock(731944,1);
-- Shared Eastern deadline for the evaluator and scheduled collector, including DST.
create or replace function scoring.pga_finalization(tournament_end date)
returns timestamptz language sql immutable set search_path='' as $$
 select (tournament_end+2+time '01:00') at time zone 'America/New_York'
$$;
revoke all on function scoring.pga_finalization(date) from public,anon,authenticated;
create or replace function scoring.deadline(period uuid) returns timestamptz
language sql stable set search_path='' as $$
 select case when scope='tournament' then scoring.pga_finalization(end_date)
 else ((end_date+1)+time '04:00') at time zone 'America/New_York' end
 from scoring.periods where id=period
$$;
-- Existing queue entries also use the new deadline. Evidence and audit history stay intact.
update scoring.jobs j set due_at=scoring.pga_finalization(j.end_date)
from scoring.sources src join scoring.seasons s on s.id=src.season_id
where j.source_id=src.id and s.sport='PGA'
and j.due_at is distinct from scoring.pga_finalization(j.end_date);
commit;
