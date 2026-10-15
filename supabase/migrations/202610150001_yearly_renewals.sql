-- Generic yearly handoffs. No connection is switched by installation.
begin;
create table trading.fantrax_state (
 sport draft.sport primary key, league_id text not null unique,
 season_year integer not null check(season_year between 2000 and 2200),
 standings_league_id text not null, standings_championship_year integer not null,
 revision integer not null default 1,
 history_id text not null
);
create table trading.fantrax_transition_log (
 plan_hash text primary key check(plan_hash ~ '^[a-f0-9]{64}$'),
 fingerprint text not null, sport draft.sport not null,
 old_league_id text not null, new_league_id text not null,
 season_year integer not null, created_at timestamptz not null default clock_timestamp()
);
create table trading.fantrax_standings_releases (
 id bigint generated always as identity primary key, sport draft.sport not null,
 old_league_id text not null,new_league_id text not null,archive_year integer not null,
 archive_checksum text not null check(archive_checksum ~ '^[a-f0-9]{64}$'),
  release_kind text not null default 'archived_season' check(release_kind in ('archived_season','initial_setup')),
  reason text not null default '',
 created_at timestamptz not null default clock_timestamp()
);
alter table trading.fantrax_state enable row level security;
alter table trading.fantrax_transition_log enable row level security;
alter table trading.fantrax_standings_releases enable row level security;
revoke all on trading.fantrax_state,trading.fantrax_transition_log,trading.fantrax_standings_releases from public,anon,authenticated;
create trigger immutable_transition_history before update or delete on trading.fantrax_transition_log for each row execute function trading.immutable_history();
create trigger immutable_standings_releases before update or delete on trading.fantrax_standings_releases for each row execute function trading.immutable_history();

create function trading.apply_fantrax_renewal(plan jsonb, plan_hash text) returns jsonb
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
 if exists(select 1 from trading.players where sport=s and league_id<>old_id)
 or exists(select 1 from trading.roster_snapshots where league_id=new_id)
 or exists(select 1 from draft.player_source_ids where provider='fantrax' and league_id=new_id) then raise exception 'Destination or current identity conflict'; end if;
 if jsonb_typeof(plan->'players') is distinct from 'array' or jsonb_array_length(plan->'players')=0 then raise exception 'Missing player evidence'; end if;
 if (select count(*) from jsonb_array_elements(plan->'players'))<>(select count(distinct value->>'player_id') from jsonb_array_elements(plan->'players')) then raise exception 'Duplicate evidence'; end if;
 if exists(select 1 from draft.player_source_ids src join draft.players p on p.id=src.player_id where src.provider='fantrax' and src.league_id=old_id and
   (p.sport<>s or (not exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=src.external_player_id and lower(trim(e->>'player_name'))=lower(trim(p.name)))
     and not (coalesce(length(trim(plan->'reviewed_absent_ids'->>src.external_player_id)),0)>=10
       and not exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=src.external_player_id)
       and not exists(select 1 from draft.draft_selections d where d.player_id=p.id and d.voided_at is null))))) then raise exception 'Stored player evidence missing or name mismatch'; end if;
 if exists(select 1 from trading.players p where p.league_id=old_id and (p.sport<>s or not exists(select 1 from jsonb_array_elements(plan->'players') e where e->>'player_id'=p.fantrax_id and lower(trim(e->>'player_name'))=lower(trim(p.name))))) then raise exception 'Trade player evidence missing or name mismatch'; end if;
 if exists(select 1 from trading.players p join draft.owners o on o.id=p.owner_id where p.league_id=old_id and not exists(
   select 1 from jsonb_array_elements(plan->'rosters') r cross join lateral jsonb_array_elements(r->'players') item
   where item->>'player_id'=p.fantrax_id and (r->>'owner'=o.slug or exists(
     select 1 from trading.player_reservations reservation join trading.assets a on a.trade_id=reservation.trade_id and a.player_id=p.id
     join draft.owners dest on dest.id=a.to_owner_id where reservation.player_id=p.id and dest.slug=r->>'owner')))) then raise exception 'Unexpected roster ownership change'; end if;
 insert into trading.league_renewals(sport,old_league_id,new_league_id,history_id) values(s,old_id,new_id,history)
 on conflict(sport) do update set old_league_id=excluded.old_league_id,new_league_id=excluded.new_league_id,history_id=excluded.history_id,activated_at=clock_timestamp();
 update trading.players set league_id=new_id where sport=s and league_id=old_id;
 insert into draft.player_source_ids(player_id,provider,league_id,external_player_id)
 select player_id,provider,new_id,external_player_id from draft.player_source_ids where provider='fantrax' and league_id=old_id;
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

create function trading.release_fantrax_standings(s draft.sport, old_id text, new_id text, year integer, checksum text) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(731943,1);
 if year not between 2000 and 2200 or year is null or checksum is null or checksum !~ '^[a-f0-9]{64}$' then raise exception 'Archive evidence required'; end if;
 if exists(select 1 from trading.fantrax_standings_releases where sport=s and old_league_id=old_id and new_league_id=new_id and archive_year=year and archive_checksum=checksum) then return; end if;
 if not exists(select 1 from trading.fantrax_state where sport=s and standings_league_id=old_id and league_id=new_id and old_id<>new_id) then raise exception 'Standings connection changed'; end if;
 update trading.fantrax_state set standings_league_id=new_id,standings_championship_year=season_year+case when sport in ('NFL','NBA','EPL') then 1 else 0 end,revision=revision+1 where sport=s;
 insert into trading.fantrax_standings_releases(sport,old_league_id,new_league_id,archive_year,archive_checksum) values(s,old_id,new_id,year,checksum);
end $$;
revoke all on function trading.release_fantrax_standings(draft.sport,text,text,integer,text) from public,anon,authenticated;
-- Explicit bootstrap exception for test/placeholder leagues: never creates a championship archive.
create function trading.release_initial_fantrax_standings(s draft.sport,old_id text,new_id text,checksum text,explanation text) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(731943,1);
 if length(trim(explanation))<20 or explanation is null or checksum is null or checksum !~ '^[a-f0-9]{64}$' then raise exception 'Explicit initial-setup explanation required'; end if;
 if exists(select 1 from trading.fantrax_standings_releases where sport=s) then raise exception 'Initial setup exception already used or standings previously released'; end if;
 if not exists(select 1 from trading.fantrax_state where sport=s and standings_league_id=old_id and league_id=new_id and old_id<>new_id) then raise exception 'Standings state changed'; end if;
 update trading.fantrax_state set standings_league_id=new_id,standings_championship_year=season_year+case when sport in ('NFL','NBA','EPL') then 1 else 0 end,revision=revision+1 where sport=s;
 insert into trading.fantrax_standings_releases(sport,old_league_id,new_league_id,archive_year,archive_checksum,release_kind,reason)
 values(s,old_id,new_id,0,checksum,'initial_setup',explanation);
end $$;
revoke all on function trading.release_initial_fantrax_standings(draft.sport,text,text,text,text) from public,anon,authenticated;
commit;
