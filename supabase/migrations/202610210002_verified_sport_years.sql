begin;
-- User-supplied getLeagueInfo date capture confirms all five seasonYear values
-- use the starting calendar year. No saved state, identities or results change.
create or replace function trading.verified_championship_year(s draft.sport, y integer) returns integer
language plpgsql immutable set search_path='' as $$
begin
 if s is null then raise exception 'Sport required'; end if;
 if y is null or y < 2027 then raise exception 'Pre-launch season cannot be a championship'; end if;
 return y;
end $$;
revoke all on function trading.verified_championship_year(draft.sport,integer) from public,anon,authenticated;
commit;
