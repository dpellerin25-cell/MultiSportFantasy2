begin;
-- Report unowned differences, but only owned/traded/live-drafted identities block.
create function trading.renewal_protected_ids(old_id text) returns table(external_id text)
language sql stable set search_path='' as $$
 select src.external_player_id from draft.player_source_ids src
 join draft.draft_selections d on d.player_id=src.player_id
 where src.provider='fantrax' and src.league_id=old_id and d.voided_at is null
 and not exists(select 1 from draft.retired_rehearsals r where r.draft_id=d.draft_id)
 union
 select p.fantrax_id from trading.players p where p.league_id=old_id and (
 p.owner_id is not null or exists(select 1 from trading.player_reservations r where r.player_id=p.id)
 or exists(select 1 from trading.assets a join trading.trades t on t.id=a.trade_id where a.player_id=p.id and t.status in ('proposed','accepted')))
$$;
revoke all on function trading.renewal_protected_ids(text) from public,anon,authenticated;
create or replace function trading.apply_fantrax_renewal(plan jsonb, plan_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare s draft.sport=(plan->>'sport')::draft.sport; old_id text=plan->>'old_league_id'; new_id text=plan->>'new_league_id';
 history text=plan->>'history_id'; target integer=(plan->>'season_year')::integer; st trading.fantrax_state;
 snap uuid; prior_log trading.fantrax_transition_log;
begin
 perform pg_advisory_xact_lock(731943,1);perform pg_advisory_xact_lock(20260925,1);
 select * into prior_log from trading.fantrax_transition_log t where t.plan_hash=apply_fantrax_renewal.plan_hash;
 if found then
   if prior_log.fingerprint<>md5(plan::text) then raise exception 'Conflicting retry'; end if;
   return jsonb_build_object('already_applied',true);
 end if;
 if old_id !~ '^[a-z0-9]{16}$' or new_id !~ '^[a-z0-9]{16}$' or history !~ '^[a-z0-9]{16}$' or old_id=new_id or new_id='xtv5ph2gmulolm8g'
 or old_id is null or new_id is null or history is null or target is null or s is null then raise exception 'Invalid transition identity'; end if;
 if (plan->>'completed_at')::timestamptz > clock_timestamp() or (plan->>'started_at')::timestamptz < clock_timestamp()-interval '6 hours'
 or (plan->>'started_at')::timestamptz > (plan->>'completed_at')::timestamptz or plan->>'started_at' is null or plan->>'completed_at' is null then raise exception 'Stale capture'; end if;
 select * into st from trading.fantrax_state where sport=s;
 if found and (st.league_id<>old_id or st.history_id<>history or target<>st.season_year+1) then raise exception 'Stale connection or invalid next season'; end if;
 if exists(select 1 from trading.league_renewals where sport=s and new_league_id<>old_id) then raise exception 'Unexpected prior handoff'; end if;
 if exists(select 1 from trading.players where sport=s and league_id<>old_id and (owner_id is not null or id in (select player_id from trading.player_reservations)))
 or exists(select 1 from trading.roster_snapshots where league_id=new_id)
 or exists(select 1 from draft.player_source_ids where provider='fantrax' and league_id=new_id) then raise exception 'Destination or current identity conflict'; end if;
 if jsonb_typeof(plan->'players') is distinct from 'array' or jsonb_array_length(plan->'players')=0 then raise exception 'Missing player evidence'; end if;
 if (select count(*) from jsonb_array_elements(plan->'players'))<>(select count(distinct value->>'player_id') from jsonb_array_elements(plan->'players')) then raise exception 'Duplicate evidence'; end if;
 if exists(select 1 from draft.player_source_ids src join draft.players p on p.id=src.player_id where src.provider='fantrax' and src.league_id=old_id and (p.sport<>s or (
   src.external_player_id in (select external_id from trading.renewal_protected_ids(old_id))
   and not exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=src.external_player_id and lower(trim(e->>'player_name'))=lower(trim(p.name)))))) then raise exception 'Protected player evidence missing or name mismatch'; end if;
 if exists(select 1 from trading.players p where p.league_id=old_id and (p.sport<>s or (
   p.fantrax_id in (select external_id from trading.renewal_protected_ids(old_id))
   and not exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=p.fantrax_id and lower(trim(e->>'player_name'))=lower(trim(p.name)))))) then raise exception 'Protected trade player evidence missing or name mismatch'; end if;
 if exists(select 1 from trading.players p join draft.owners o on o.id=p.owner_id where p.league_id=old_id and not exists(
   select 1 from jsonb_array_elements(plan->'rosters') r cross join lateral jsonb_array_elements(r->'players') item
   where item->>'player_id'=p.fantrax_id and (r->>'owner'=o.slug or exists(
     select 1 from trading.player_reservations reservation join trading.assets a on a.trade_id=reservation.trade_id and a.player_id=p.id
     join draft.owners dest on dest.id=a.to_owner_id where reservation.player_id=p.id and dest.slug=r->>'owner')))) then raise exception 'Unexpected roster ownership change'; end if;
 insert into trading.league_renewals(sport,old_league_id,new_league_id,history_id) values(s,old_id,new_id,history)
 on conflict(sport) do update set old_league_id=excluded.old_league_id,new_league_id=excluded.new_league_id,history_id=excluded.history_id,activated_at=clock_timestamp();
 update trading.players p set league_id=new_id where p.sport=s and p.league_id=old_id
 and exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=p.fantrax_id and lower(trim(e->>'player_name'))=lower(trim(p.name)));
 insert into draft.player_source_ids(player_id,provider,league_id,external_player_id)
 select src.player_id,src.provider,new_id,src.external_player_id from draft.player_source_ids src join draft.players p on p.id=src.player_id
 where src.provider='fantrax' and src.league_id=old_id and p.sport=s
 and exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=src.external_player_id and lower(trim(e->>'player_name'))=lower(trim(p.name)));
 -- Unowned mismatches keep their old identities. A later pool import creates a
 -- separate new-season identity; historical pools/selections are never renamed.
 -- This validates complete active membership and reconciles only after a fresh capture.
 select trading.ingest_rosters(s,new_id,(plan->>'started_at')::timestamptz,plan->'rosters',false) into snap;
 insert into trading.fantrax_state(sport,league_id,season_year,standings_league_id,standings_championship_year,history_id)
 values(s,new_id,target,coalesce(st.standings_league_id,plan->>'standings_league_id',old_id),coalesce(st.standings_championship_year,(plan->>'standings_championship_year')::integer,target),history)
 on conflict(sport) do update set league_id=excluded.league_id,season_year=excluded.season_year,revision=trading.fantrax_state.revision+1;
 insert into trading.fantrax_transition_log(plan_hash,fingerprint,sport,old_league_id,new_league_id,season_year)
 values(plan_hash,md5(plan::text),s,old_id,new_id,target);
 return jsonb_build_object('applied',true,'roster_snapshot',snap,'standings_unchanged',true);
end $$;
revoke all on function trading.apply_fantrax_renewal(jsonb,text) from public,anon,authenticated;

commit;
