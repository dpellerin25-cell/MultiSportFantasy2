begin;
-- An approved supplemental catalogue, separate from immutable Fantrax snapshots.
create table draft.prospect_catalog (
 id text primary key, name text not null, sport draft.sport not null, position text not null,
 source_league text not null, source_sha256 text not null,
 player_id uuid unique references draft.players(id), unique(id,player_id)
);
alter table draft.prospect_catalog enable row level security;
revoke all on draft.prospect_catalog from public,anon,authenticated;
-- CATALOGUE_ROWS

alter table draft.draft_pool_players alter column import_id drop not null;
alter table draft.draft_pool_players add column prospect_catalog_id text;
alter table draft.draft_pool_players add foreign key(prospect_catalog_id,player_id) references draft.prospect_catalog(id,player_id);
alter table draft.draft_pool_players add foreign key(draft_id) references draft.drafts(id);
alter table draft.draft_pool_players add check(import_id is not null or prospect_catalog_id is not null);
alter table trading.prospects add column draft_selection_id uuid unique references draft.draft_selections(id);

create function draft.attach_startup_prospects(target uuid,bindings jsonb default '{}'::jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare d draft.drafts; c draft.prospect_catalog; pid uuid; candidate uuid; n integer; added integer=0;
begin
 perform pg_advisory_xact_lock(731943,1);
 select * into strict d from draft.drafts where id=target for update;
 if d.status<>'setup' or d.kind<>'startup' or d.championship_year<>2027 or exists(select 1 from draft.draft_picks where draft_id=target) then
  raise exception 'Only an unstarted Cup 2027 startup draft may receive this catalogue';
 end if;
 if jsonb_typeof(bindings) is distinct from 'object' or exists(select 1 from jsonb_object_keys(bindings) k where not exists(select 1 from draft.prospect_catalog where id=k)) then raise exception 'Invalid prospect identity mappings'; end if;
 for c in select * from draft.prospect_catalog order by id for update loop
  pid=c.player_id;
  if pid is not null and bindings ? c.id and bindings->>c.id<>pid::text then raise exception 'Existing verified prospect identity cannot be replaced'; end if;
  if pid is null then
   if bindings ? c.id and bindings->>c.id<>'new' then
    pid=(bindings->>c.id)::uuid;
    if pid is null or not exists(select 1 from draft.players where id=pid and sport=c.sport) then raise exception 'Verified mapping must identify a player in the same sport'; end if;
   else
    select count(*) into n from draft.players where sport=c.sport and draft.ranking_name_key(name)=draft.ranking_name_key(c.name);
    if n>0 and bindings->>c.id is distinct from 'new' then raise exception 'Review possible Fantrax duplicate for catalogue % before attachment',c.id; end if;
    insert into draft.players(sport,name,position) values(c.sport,c.name,c.position) returning id into pid;
   end if;
   update draft.prospect_catalog set player_id=pid where id=c.id;
  end if;
  -- A verified Fantrax identity absent from the available snapshot cannot be bypassed.
  if exists(select 1 from draft.player_source_ids where player_id=pid and provider='fantrax')
    and not exists(select 1 from draft.draft_pool_players where draft_id=target and player_id=pid and eligible) then
   raise exception 'Mapped Fantrax player is not in this available draft pool: %',c.id;
  end if;
  if exists(select 1 from trading.prospects where status='active' and sport=c.sport and draft.ranking_name_key(name)=draft.ranking_name_key(c.name))
   or exists(select 1 from trading.players t join draft.player_source_ids s on s.provider='fantrax' and s.external_player_id=t.fantrax_id and s.player_id=pid where t.sport=c.sport and t.owner_id is not null) then
   raise exception 'Prospect is already owned: %',c.id;
  end if;
  if exists(select 1 from draft.draft_pool_players where draft_id=target and player_id=pid and prospect_catalog_id=c.id) then continue; end if;
  insert into draft.draft_pool_players(draft_id,player_id,sport,name,position,availability,eligible,prospect_catalog_id)
  values(target,pid,c.sport,c.name,c.position,'free_agent',true,c.id)
  on conflict(draft_id,player_id) do update set prospect_catalog_id=excluded.prospect_catalog_id;
  added=added+1;
 end loop;
 if added>0 then
  update draft.drafts set revision=revision+1 where id=target;
  insert into draft.draft_events(draft_id,event_type,payload) values(target,'startup_prospect_pool',jsonb_build_object('added',added,'bindings',bindings,'source','Prospect List Startup 2027.xlsx'));
 end if;
 return jsonb_build_object('added',added,'prospects',(select count(*) from draft.draft_pool_players where draft_id=target and prospect_catalog_id is not null),'started',false);
end $$;
revoke all on function draft.attach_startup_prospects(uuid,jsonb) from public,anon,authenticated;

-- Acquire the roster lock before the draft row, including direct authorized commands.
do $$ declare definition text; needle text='select * into strict d from draft.drafts where id=target for update;'; begin
 select pg_get_functiondef('draft.command(uuid,uuid,bigint,text,jsonb)'::regprocedure) into definition;
 if position(needle in definition)=0 then raise exception 'Unexpected draft command definition'; end if;
 execute replace(definition,needle,'perform pg_advisory_xact_lock(731943,1); '||needle);
end $$;

create function draft.record_prospect_selection() returns trigger language plpgsql set search_path='' as $$
declare c draft.prospect_catalog; p trading.prospects; before_state jsonb; fid text; n integer;
begin
 select c0.* into c from draft.draft_pool_players dp join draft.prospect_catalog c0 on c0.id=dp.prospect_catalog_id where dp.draft_id=new.draft_id and dp.player_id=new.player_id;
 if not found then return new; end if;
 perform pg_advisory_xact_lock(731943,1);
 if tg_op='INSERT' then
  select count(distinct external_player_id),min(external_player_id) into n,fid from draft.player_source_ids where player_id=new.player_id and provider='fantrax';
  if n>1 then raise exception 'Ambiguous verified Fantrax identity'; end if;
  if exists(select 1 from trading.players where sport=c.sport and fantrax_id=fid and owner_id is not null) then raise exception 'Prospect is already rostered on Fantrax'; end if;
  insert into trading.prospects(owner_id,sport,name,fantrax_id,verified_at,draft_selection_id)
  values(new.owner_id,c.sport,c.name,fid,case when fid is not null then clock_timestamp() end,new.id) returning * into p;
  insert into trading.prospect_events(prospect_id,actor_id,action,reason,after_state) values(p.id,new.actor_user_id,'draft_pick','Selected from approved startup prospect list',to_jsonb(p));
 elsif old.voided_at is null and new.voided_at is not null then
  select * into strict p from trading.prospects where draft_selection_id=new.id for update;
  if p.status<>'active' then raise exception 'Prospect ownership changed after drafting; commissioner must review before undo'; end if;
  before_state=to_jsonb(p);
  update trading.prospects set status='removed',ended_at=clock_timestamp(),revision=revision+1 where id=p.id returning * into p;
  insert into trading.prospect_events(prospect_id,actor_id,action,reason,before_state,after_state) values(p.id,auth.uid(),'draft_undo',new.void_reason,before_state,to_jsonb(p));
 end if;
 perform trading.refresh_prospect_alerts();
 return new;
end $$;
revoke all on function draft.record_prospect_selection() from public,anon,authenticated;
create trigger record_prospect_selection after insert or update on draft.draft_selections for each row execute function draft.record_prospect_selection();
-- SEARCH_API
-- Label selected prospects without changing existing draft-state authorization.
do $$ declare definition text; begin
 select pg_get_functiondef('public.draft_state(uuid)'::regprocedure) into definition;
 if position('''player_name'',pl.name' in definition)=0 then raise exception 'Unexpected draft state'; end if;
 execute replace(definition,'''player_name'',pl.name','''is_prospect'',pl.prospect_catalog_id is not null,''player_name'',pl.name');
end $$;

create function trading.link_selected_prospect() returns trigger language plpgsql set search_path='' as $$
declare pid uuid; league text; existing uuid;
begin
 if new.draft_selection_id is null or new.fantrax_id is null or new.fantrax_id is not distinct from old.fantrax_id then return new; end if;
 select player_id into strict pid from draft.draft_selections where id=new.draft_selection_id;
 select league_id into league from trading.roster_snapshots where sport=new.sport order by observed_at desc limit 1;
 if league is null then raise exception 'Import current sport rosters before linking a drafted prospect'; end if;
 select player_id into existing from draft.player_source_ids where provider='fantrax' and league_id=league and external_player_id=new.fantrax_id;
 if existing is not null and existing<>pid then raise exception 'Existing Fantrax identity requires reviewed merge'; end if;
 insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values(pid,'fantrax',league,new.fantrax_id) on conflict(provider,league_id,external_player_id) do nothing;
 return new;
end $$;
revoke all on function trading.link_selected_prospect() from public,anon,authenticated;
create trigger link_selected_prospect before update on trading.prospects for each row execute function trading.link_selected_prospect();
notify pgrst,'reload schema';
commit;
