begin;
-- An approved supplemental catalogue, separate from immutable Fantrax snapshots.
create table draft.prospect_catalog (
 id text primary key, name text not null, sport draft.sport not null, position text not null,
 source_league text not null, source_sha256 text not null,
 player_id uuid unique references draft.players(id), unique(id,player_id)
);
alter table draft.prospect_catalog enable row level security;
revoke all on draft.prospect_catalog from public,anon,authenticated;
insert into draft.prospect_catalog(id,name,sport,position,source_league,source_sha256) values
('startup-2027-001','Jeremiah Smith','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-002','Charlie Becker','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-003','Nick Marsh','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-004','Drew Mestemaker','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-005','Jadan Baugh','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-006','Nate Frazier','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-007','Kewan Lacy','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-008','K.J. Duff','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-009','Trey’Dez Green','NFL','TE','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-010','Ryan Coleman-Williams','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-011','Jamari Johnson','NFL','TE','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-012','Cam Coleman','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-013','Trinidad Chambliss','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-014','Dante Moore','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-015','Sam Leavitt','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-016','C.J. Carr','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-017','Wayshawn Parker','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-018','Luke Reynolds','NFL','TE','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-019','Deuce Alexander','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-020','Ryan Wingo','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-021','Jackson Harris','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-022','Bryant Wesco Jr.','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-023','Antwan Raymond','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-024','Dylan Riley','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-025','Amare Thomas','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-026','Junior Sherrill','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-027','Justice Haynes','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-028','Fluff Bothwell','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-029','Reed Harris','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-030','Mario Craver','NFL','WR','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-031','Hollywood Smothers','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-032','L.J. Martin','NFL','RB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-033','Austin Simmons','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-034','Arch Manning','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-035','Darian Mensah','NFL','QB','NFL','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-036','Tyran Stokes','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-037','Caleb Holt','NBA','SG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-038','Jordan Smith Jr.','NBA','SG/PG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-039','Bruce Branch III','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-040','Stefan Joksimovic','NBA','PG/SG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-041','Anthony Thompson','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-042','Brandon McCoy Jr.','NBA','SG/PG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-043','Cameron Williams','NBA','PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-044','Baba Oladotun','NBA','SF/PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-045','Dylan Mingo','NBA','PG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-046','Hugo Yimga-Moukouri','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-047','Amari Allen','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-048','Braylon Mullins','NBA','SG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-049','Jason Crowe Jr.','NBA','PG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-050','Ivan Kharchenkov','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-051','Patrick Ngongba II','NBA','C','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-052','Quentin Coleman','NBA','SG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-053','Thomas Haugh','NBA','PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-054','Tounde Yessoufou','NBA','SG/SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-055','Mikkail Mourtinen','NBA','PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-056','JJ Andrews','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-057','Luigi Suigo','NBA','C','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-058','Motejus Krivas','NBA','C','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-059','Christian Collins','NBA','SF/PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-060','Davis Fogle','NBA','SG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-061','Billy Richmond III','NBA','SF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-062','Alijah Arenas','NBA','SG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-063','Tyler Tanner','NBA','PG','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-064','David Mirkovic','NBA','PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-065','Milan Momcilovic','NBA','SF/PF','NBA','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-066','Kylian Mbappé','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-067','Harry Kane','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-068','Lamine Yamal','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-069','Khvicha Kvaratskhelia','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-070','Ousmane Dembélé','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-071','Julián Álvarez','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-072','Raphinha','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-073','Vinícius Júnior','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-074','Lautaro Martínez','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-075','Michael Olise','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-076','Jude Bellingham','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-077','Serhou Guirassy','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-078','Désiré Doué','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-079','Luis Díaz','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-080','Alejandro Garnacho','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-081','Victor Osimhen','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-082','Jamal Musiala','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-083','Dani Olmo','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-084','Randal Kolo Muani','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-085','Vitinha','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-086','Pedri','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-087','Mason Greenwood','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-088','Marcus Thuram','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-089','Scott McTominay','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-090','Fermín López','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-091','Yan Diomande','EPL','MID','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e'),
('startup-2027-092','Jonathan David','EPL','FWD','Soccer (Not in Premier League)','53aae2c17f27893b25ce2900d1c917abbfc4c445ffd51e78b35174cf2e077b1e');

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
create or replace function public.draft_available_players(target uuid,sport_filter text,search_text text,after_player uuid,page_size integer,position_filter text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform draft.require_member(target);
  if page_size is null or page_size<1 or page_size>100 or search_text is null or length(search_text)>100
    or (sport_filter is not null and sport_filter not in ('NFL','MLB','NBA','EPL','PGA','Prospects')) then
    raise exception 'Invalid player search' using errcode='22023';
  end if;
  if position_filter is not null and (length(position_filter)>20 or position_filter !~ '^[A-Za-z0-9_-]+$') then raise exception 'Invalid position filter' using errcode='22023'; end if;
  if after_player is not null and not exists(select 1 from draft.draft_pool_players where draft_id=target and player_id=after_player) then
    raise exception 'Invalid player cursor' using errcode='22023';
  end if;
  with pool as materialized (
    select p.*,draft.ranking_name_key(p.name) name_key,
      count(*) over(partition by p.sport,draft.ranking_name_key(p.name)) identity_count
    from draft.draft_pool_players p where p.draft_id=target
  ), unique_ranks as (
    select sport,name_key,min(rank) rank from draft.player_ranking_snapshot group by sport,name_key having count(*)=1
  ), ranked as materialized (
    select p.*,r.rank,coalesce(r.rank,2147483647) sort_rank,
      case when r.rank is null then '' else p.sport::text end sort_sport,lower(p.name) sort_name
    from pool p left join unique_ranks r on r.sport=p.sport::text and r.name_key=p.name_key and p.identity_count=1 and p.prospect_catalog_id is null
  ), anchor as (
    select * from ranked where player_id=after_player
  ), candidates as (
    select p.* from ranked p where p.eligible
      and ((sport_filter='Prospects' and p.prospect_catalog_id is not null) or (sport_filter is distinct from 'Prospects' and p.prospect_catalog_id is null and (sport_filter is null or p.sport::text=sport_filter)))
      and (position_filter is null or upper(position_filter)=any(regexp_split_to_array(upper(coalesce(p.position,'')), '[,;/[:space:]]+')))
      and strpos(lower(p.name),lower(search_text))>0
      and (after_player is null or (p.sort_rank,p.sort_sport,p.sort_name,p.player_id) > (select sort_rank,sort_sport,sort_name,player_id from anchor))
      and not exists(select 1 from draft.draft_selections s where s.draft_id=target and s.player_id=p.player_id and s.voided_at is null)
    order by p.sort_rank,p.sort_sport,p.sort_name,p.player_id limit page_size+1
  ), page as (select * from candidates order by sort_rank,sort_sport,sort_name,player_id limit page_size)
  select jsonb_build_object('draft_id',target,'revision',(select revision from draft.drafts where id=target),
    'ranking_snapshot','2026-09-29',
    'available_positions',coalesce((select jsonb_agg(pos order by pos) from (select distinct unnest(regexp_split_to_array(upper(coalesce(p.position,'')), '[,;/[:space:]]+')) pos from pool p where p.eligible and ((sport_filter='Prospects' and p.prospect_catalog_id is not null) or (sport_filter is distinct from 'Prospects' and p.prospect_catalog_id is null and (sport_filter is null or p.sport::text=sport_filter))) and not exists(select 1 from draft.draft_selections s where s.draft_id=target and s.player_id=p.player_id and s.voided_at is null)) options where pos<>''),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(jsonb_build_object('player_id',player_id,'player_name',name,'sport',sport,'position',position,'professional_team',professional_team,'availability_status',case when prospect_catalog_id is not null then 'prospect' else availability::text end,'is_prospect',prospect_catalog_id is not null,'source_rank',rank) order by sort_rank,sort_sport,sort_name,player_id) from page),'[]'::jsonb),
    'next_cursor',case when (select count(*) from candidates)>page_size then (select player_id from page order by sort_rank desc,sort_sport desc,sort_name desc,player_id desc limit 1) else null end
  ) into result;
  return result;
end $$;
revoke all on function public.draft_available_players(uuid,text,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.draft_available_players(uuid,text,text,uuid,integer,text) to authenticated;

create or replace function public.draft_available_players(target uuid,sport_filter text default null,search_text text default '',after_player uuid default null,page_size integer default 50) returns jsonb language sql stable security definer set search_path='' as $$select public.draft_available_players(target,sport_filter,search_text,after_player,page_size,null)$$;

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
