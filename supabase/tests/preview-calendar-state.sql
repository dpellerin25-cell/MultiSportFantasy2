-- Read-only review. Do not modify state based only on a year difference.
begin read only;
select sport, league_id, season_year, standings_league_id,
       standings_championship_year,
       case when sport <> 'MLB' then 'Await dated Fantrax evidence'
            when season_year < 2027 then 'Pre-launch: no championship'
            when league_id <> standings_league_id then 'Retained standings: inspect archive/release history'
            when standings_championship_year <> season_year then 'Review incorrect MLB year before correction'
            else 'MLB mapping consistent' end as review
from trading.fantrax_state order by sport;
rollback;
