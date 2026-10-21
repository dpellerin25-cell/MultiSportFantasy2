begin;
-- Only MLB has captured evidence confirming seasonYear is the calendar year.
-- Other sports remain blocked until their dated metadata has been reviewed.
create function trading.verified_championship_year(s draft.sport, y integer) returns integer
language plpgsql immutable set search_path='' as $$
begin
 if s <> 'MLB' then raise exception 'Unverified Fantrax season year convention'; end if;
 if y is null or y < 2027 then raise exception 'Pre-launch season cannot be a championship'; end if;
 return y;
end $$;
revoke all on function trading.verified_championship_year(draft.sport,integer) from public,anon,authenticated;
create or replace function trading.release_fantrax_standings(s draft.sport, old_id text, new_id text, year integer, checksum text) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(731943,1);
 if year not between 2000 and 2200 or year is null or checksum is null or checksum !~ '^[a-f0-9]{64}$' then raise exception 'Archive evidence required'; end if;
 if exists(select 1 from trading.fantrax_standings_releases where sport=s and old_league_id=old_id and new_league_id=new_id and archive_year=year and archive_checksum=checksum) then return; end if;
 if not exists(select 1 from trading.fantrax_state where sport=s and standings_league_id=old_id and league_id=new_id and old_id<>new_id) then raise exception 'Standings connection changed'; end if;
 update trading.fantrax_state set standings_league_id=new_id,standings_championship_year=trading.verified_championship_year(s,season_year),revision=revision+1 where sport=s;
 insert into trading.fantrax_standings_releases(sport,old_league_id,new_league_id,archive_year,archive_checksum) values(s,old_id,new_id,year,checksum);
end $$;
revoke all on function trading.release_fantrax_standings(draft.sport,text,text,integer,text) from public,anon,authenticated;
-- Explicit bootstrap exception for test/placeholder leagues: never creates a championship archive.
create or replace function trading.release_initial_fantrax_standings(s draft.sport,old_id text,new_id text,checksum text,explanation text) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(731943,1);
 if length(trim(explanation))<20 or explanation is null or checksum is null or checksum !~ '^[a-f0-9]{64}$' then raise exception 'Explicit initial-setup explanation required'; end if;
 if exists(select 1 from trading.fantrax_standings_releases where sport=s) then raise exception 'Initial setup exception already used or standings previously released'; end if;
 if not exists(select 1 from trading.fantrax_state where sport=s and standings_league_id=old_id and league_id=new_id and old_id<>new_id) then raise exception 'Standings state changed'; end if;
 update trading.fantrax_state set standings_league_id=new_id,standings_championship_year=trading.verified_championship_year(s,season_year),revision=revision+1 where sport=s;
 insert into trading.fantrax_standings_releases(sport,old_league_id,new_league_id,archive_year,archive_checksum,release_kind,reason)
 values(s,old_id,new_id,0,checksum,'initial_setup',explanation);
end $$;
revoke all on function trading.release_initial_fantrax_standings(draft.sport,text,text,text,text) from public,anon,authenticated;
commit;
