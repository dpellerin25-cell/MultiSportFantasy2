begin;
-- Audit only newly committed inaugural handoffs; never rewrite prior MLB history.
alter table trading.fantrax_transition_log add column archive_exemption text
 check (archive_exemption is null or archive_exemption='initial_2027');
create function trading.audit_initial_roster_transition() returns trigger
language plpgsql set search_path='' as $$
begin
 new.archive_exemption := null;
 if new.season_year=2027 and new.old_league_id=(case new.sport
   when 'NFL' then 'yg0olhfrmtj45dd6' when 'NBA' then 'u1byx3qkmtj47ogg'
   when 'EPL' then 'j08ymyupmtj415q3' when 'PGA' then 'xa7tza2hmthqz8bo'
   else null end) then
   new.archive_exemption := 'initial_2027';
 end if;
 return new;
end $$;
revoke all on function trading.audit_initial_roster_transition() from public,anon,authenticated;
create trigger audit_initial_roster_transition before insert on trading.fantrax_transition_log
 for each row execute function trading.audit_initial_roster_transition();
commit;
