// Fixed SELECTs only. Never invokes application RPCs, Auth APIs or delivery workers.
export const queries = {
 migrations: `select version from supabase_migrations.schema_migrations order by version`,
 owners: `select o.slug,o.active,(a.auth_user_id is not null) linked,(u.id is not null) account_exists from draft.owners o left join draft.owner_accounts a on a.owner_id=o.id left join auth.users u on u.id=a.auth_user_id order by o.slug`,
 commissioners: `select o.slug,o.active from draft.league_roles r left join draft.owner_accounts a on a.auth_user_id=r.auth_user_id left join draft.owners o on o.id=a.owner_id where r.role='commissioner'`,
 settings: `select championship_year,owner_slugs,placement_points from draft.season_settings order by championship_year`,
 policy: `select roster_limit,startup_rounds,annual_rounds,effective_at from draft.roster_policy_versions where effective_at<=now() order by effective_at desc limit 1`,
 drafts: `select d.id,d.kind,d.status,d.championship_year,d.rounds,d.participant_count,d.rounds*d.participant_count planned_picks,(select count(*)::int from draft.draft_picks p where p.draft_id=d.id) stored_picks,(select count(*)::int from draft.draft_selections s where s.draft_id=d.id) selection_history,(select count(*)::int from draft.draft_pool_players p where p.draft_id=d.id) pool_players,exists(select 1 from draft.retired_rehearsals r where r.draft_id=d.id) retired from draft.drafts d order by d.created_at`,
 trades: `select status,count(*)::int records from trading.trades group by status order by status`,
 notifications: `select case when s.notification_id is not null then 'suppressed' else n.status end status,count(*)::int records,min(n.next_attempt_at) earliest_attempt from trading.notifications n left join trading.notification_suppressions s on s.notification_id=n.id group by 1 order by 1`,
 picks: `select year,count(*)::int records,count(*) filter(where owner_id<>original_owner_id)::int transferred from trading.picks group by year order by year`,
 connections: `select sport,league_id,season_year,standings_league_id,standings_championship_year from trading.fantrax_state order by sport`,
 rosters: `select sport,max(observed_at) last_observation from trading.roster_snapshots group by sport order by sport`,
 checks: `with latest as (select distinct on(owner_id,check_date) owner_id,check_date,complete,total_players from scoring.roster_checks order by owner_id,check_date,revision desc) select check_date,count(*)::int owners,count(*) filter(where complete)::int complete_owners from latest group by check_date order by check_date desc limit 7`,
 scoring: `select s.sport,s.season_year,s.championship_year,s.is_test,c.enabled,c.publish,count(j.id)::int jobs,count(j.id) filter(where j.result_id is null)::int awaiting_result,count(j.id) filter(where j.last_error is not null)::int errors,max(j.last_attempt) last_attempt from scoring.seasons s left join scoring.sources c on c.season_id=s.id left join scoring.jobs j on j.source_id=c.id group by s.id,c.id order by s.sport,s.season_year`,
 unresolved: `with latest as(select distinct on(period_id,owner_id) id from scoring.results order by period_id,owner_id,revision desc) select count(*)::int unknown_player_records from scoring.contributions c join latest l on l.id=c.result_id where c.score_state='unknown'`,
 pauses: `select paused,effective_at from scoring.pause_events order by effective_at desc,id desc limit 1`,
 invitations: `select delivery,count(*)::int records,count(*) filter(where accepted_at is not null)::int accepted,count(*) filter(where revoked_at is null and accepted_at is null and expires_at>now())::int outstanding from draft.account_invitations group by delivery order by delivery`,
 security: `select n.nspname schema,c.relname relation,c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('draft','trading','scoring') and c.relkind='r' order by 1,2`,
 constraints: `select n.nspname schema,count(*)::int constraints,count(*) filter(where not c.convalidated)::int unvalidated from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('draft','trading','scoring') group by n.nspname order by 1`,
 grants: `select r.rolname role,n.nspname schema,c.relname relation,has_table_privilege(r.oid,c.oid,'SELECT') can_read,has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') can_write from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace where r.rolname in ('anon','authenticated') and n.nspname in ('draft','trading','scoring') and c.relkind='r' and (has_table_privilege(r.oid,c.oid,'SELECT') or has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) order by 1,2,3`,
};

export async function collectAudit(db) {
 const data={},unavailable=[];
 await db.query('begin isolation level repeatable read read only');
 try {
  await db.query("set local statement_timeout='15s'");
  await db.query("set local lock_timeout='3s'");
  const guard=await db.query('show transaction_read_only');
  if(guard.rows[0]?.transaction_read_only!=='on')throw Error('Read-only guard failed');
  for(const [key,sql] of Object.entries(queries)) {
   await db.query('savepoint audit_check');
   try{data[key]=(await db.query(sql)).rows;}
   catch{await db.query('rollback to savepoint audit_check');unavailable.push(key);}
   await db.query('release savepoint audit_check');
  }
  return {data,unavailable};
 } finally {await db.query('rollback');}
}

export function assessAudit({data:d,unavailable},expected,versions,now=Date.now()) {
 const findings=[];
 const add=(status,check,detail)=>findings.push({status,check,detail});
 const check=(ok,name,detail)=>add(ok?'verified':'needs_attention',name,detail);
 for(const key of unavailable)add('not_yet_verified',key,'Query unavailable: missing migration, insufficient permission, or timeout. No raw database error printed.');
 if(d.migrations){const actual=d.migrations.map(x=>x.version);const missing=versions.filter(x=>!actual.includes(x)),extra=actual.filter(x=>!versions.includes(x));check(!missing.length&&!extra.length,'migration_versions',{missing,unexpected:extra,note:'Version parity only; does not prove deployed SQL contents.'});}
 if(d.owners){const active=d.owners.filter(x=>x.active);check(JSON.stringify(active.map(x=>x.slug).sort())===JSON.stringify(expected.owners.map(x=>x.slug).sort()),'membership','Active owners must match checked-in approved settings.');check(active.every(x=>x.linked&&x.account_exists),'owner_accounts',{unlinked_or_missing:active.filter(x=>!x.linked||!x.account_exists).map(x=>x.slug)});}
 if(d.commissioners)check(d.commissioners.length===1&&d.commissioners[0].slug==='doug'&&d.commissioners[0].active,'commissioner_roles','Expected exactly one active linked commissioner: Doug.');
 if(d.settings){const s=d.settings.find(x=>x.championship_year===expected.championship_year);check(!!s&&JSON.stringify(s.owner_slugs.slice().sort())===JSON.stringify(expected.owners.map(x=>x.slug).sort())&&JSON.stringify(s.placement_points.map(Number))===JSON.stringify(expected.placement_points),'approved_season_settings','Membership and placement points match repository.');}
 if(d.policy)check(d.policy[0]?.roster_limit===80&&d.policy[0]?.startup_rounds===80&&d.policy[0]?.annual_rounds===10,'current_rules','80-player cap, 80 startup rounds, 10 annual rounds.');
 if(d.security)check(d.security.length>0&&d.security.every(x=>x.rls),'table_rls','All inspected private application tables have RLS enabled; this alone does not prove effective permissions.');
 if(d.constraints)check(d.constraints.length===3&&d.constraints.every(x=>x.unvalidated===0),'constraint_validation','Installed constraints are validated; correctness still requires behavior tests.');
 if(d.grants)add('needs_attention','effective_table_grants',{grants:d.grants,note:'Review against intended RLS policies. Read grants may be intentional for Realtime. No table is read under an owner JWT by this audit.'});
 if(d.drafts){const live=d.drafts.filter(x=>!x.retired&&x.status!=='cancelled');add('needs_attention','draft_inventory',{active_candidates:live,note:'No reliable real/test flag on drafts. Commissioner must identify the real startup draft; do not infer from names or delete history.'});}
 if(d.notifications)check(!d.notifications.some(x=>['pending','sending','failed'].includes(x.status)&&x.records>0),'notification_queue','Review outstanding delivery rows before enabling production sends; test/real recipients are not inferred.');
 if(d.trades)add('needs_attention','trade_inventory',{counts:d.trades,note:'Review accepted transfers and fixture provenance. No private messages or recipients exported.'});
 if(d.connections)add('needs_attention','connection_inventory',{connections:d.connections,note:'Database overrides may cover fewer than five sports. Compare with exported runtime registry; old standings may intentionally await approval.'});
 if(d.rosters)check(d.rosters.length===5&&d.rosters.every(x=>Number.isFinite(Date.parse(x.last_observation))&&now-Date.parse(x.last_observation)<36*3600000&&Date.parse(x.last_observation)<=now),'roster_freshness','All five sports observed within 36 hours (operational alert threshold, not eligibility policy).');
 if(d.checks)check(!!d.checks[0]&&d.checks[0].owners===expected.owners.length&&d.checks[0].complete_owners===expected.owners.length&&now-Date.parse(d.checks[0].check_date)<48*3600000,'latest_roster_evidence',{latest:d.checks[0]??null,note:'Latest stored date completeness and 48-hour operational freshness screen, not an eligibility decision.'});
 if(d.scoring){const sources=d.scoring.filter(x=>!x.is_test&&x.championship_year===expected.championship_year&&x.enabled);check(new Set(sources.map(x=>x.sport)).size===5,'championship_sources','All five approved enabled championship sources required eventually; unavailable future leagues remain unverified.');check(!d.scoring.some(x=>x.is_test&&x.publish),'test_scoring_hidden','No test source marked public.');check(!d.scoring.some(x=>x.errors>0),'scoring_errors','Stored job errors require review.');}
 if(d.unresolved)check(d.unresolved[0]?.unknown_player_records===0,'missing_scoring_records',d.unresolved);
 if(d.pauses)add(d.pauses[0]?.paused?'needs_attention':'verified','penalty_pause',d.pauses[0]??{paused:false,note:'No pause recorded.'});
 for(const name of ['hosted_permission_behavior','backup_and_restore','github_workflow_settings_and_runs','vercel_environment_and_deployment','email_delivery_and_recipient_mode','fantrax_lineup_and_renewal_evidence','published_standings_approval'])add('not_yet_verified',name,'Requires dashboard evidence or separately authorized behavior testing; not established by database inventory.');
 return {read_only:true,ready_for_production:false,scope:'Inventory, not production certification. No application commands, sign-ins or emails.',findings,inventory:d};
}
