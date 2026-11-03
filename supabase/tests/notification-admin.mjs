import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const PROJECT='tgvuntuhdqucazpoxrrg';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inventory=`select n.id,n.kind,n.status,n.attempts,n.first_attempt_at,n.sent_at,e.trade_id,
 coalesce(e.occurred_at,a.opened_at) created_at,o.slug owner,
 (u.email_confirmed_at is not null) email_verified,
 (o.active is true) linked_active_owner,
 (t.message like 'HTTP trade test %') known_fixture_marker,
 t.status trade_status,a.resolved_at roster_alert_resolved_at,
 (n.delivery_payload is not null) frozen_payload,
 (n.provider_id is not null) provider_receipt,
 s.notification_id is not null suppressed,
 s.plan_hash suppression_plan_hash,
 md5(row(n.*,u.email,u.email_confirmed_at,o.slug,o.active,t.status,t.expires_at,a.resolved_at)::text) fingerprint
 from trading.notifications n left join trading.events e on e.id=n.event_id
 left join trading.trades t on t.id=e.trade_id
 left join trading.roster_limit_alerts a on a.id=n.roster_alert_id
 left join auth.users u on u.id=n.recipient_user_id
 left join draft.owner_accounts oa on oa.auth_user_id=n.recipient_user_id
 left join draft.owners o on o.id=oa.owner_id
 left join trading.notification_suppressions s on s.notification_id=n.id`;
export function validatePlan(plan){
 assert.ok(plan&&typeof plan.reason==='string'&&plan.reason.trim().length>=10&&plan.reason.length<=500,'Provide a reason of 10–500 characters');
 assert.ok(Array.isArray(plan.notification_ids)&&plan.notification_ids.length>0&&plan.notification_ids.length<=500,'Select 1–500 notification IDs');
 assert.ok(plan.notification_ids.every(x=>typeof x==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x)),'Invalid notification ID');
 assert.equal(new Set(plan.notification_ids).size,plan.notification_ids.length,'Duplicate notification IDs');
 return {notification_ids:[...plan.notification_ids].sort(),reason:plan.reason.trim()};
}
// The public report deliberately omits emails, bodies, private messages and error text.
const safe=row=>{const {fingerprint,suppression_plan_hash,...report}=row;return report;};
export async function previewQueue(db){
 await db.query('begin isolation level repeatable read read only');
 try{
  const rows=(await db.query(inventory+' order by n.id')).rows;
  return {read_only:true,project:PROJECT,total:rows.length,notifications:rows.map(safe)};
 }finally{await db.query('rollback');}
}
export async function suppressionPlan(db,input,{apply=false,approval}={}){
 const plan=validatePlan(input);
 if(apply)assert.match(approval??'',/^[a-f0-9]{64}$/,'Preview approval hash required');
 await db.query(apply?'begin':'begin isolation level repeatable read read only');
 try{
  await db.query("set local lock_timeout='10s'");
  if(apply){
   // Same session lock key as delivery: wait until the worker finishes, then
   // reject any stale approval. No provider requests occur in this module.
   await db.query('select pg_advisory_xact_lock(731943,2)');
   await db.query('lock table trading.notifications in share row exclusive mode');
  }
  const rows=(await db.query(inventory+' where n.id=any($1::uuid[]) order by n.id',[plan.notification_ids])).rows;
  assert.equal(rows.length,plan.notification_ids.length,'Notification missing');
  if(apply&&rows.every(r=>r.suppressed&&r.suppression_plan_hash===approval)){
   const stored=(await db.query('select reason from trading.notification_suppressions where notification_id=any($1::uuid[])',[plan.notification_ids])).rows;
   assert.ok(stored.every(r=>r.reason===plan.reason),'Retry reason differs');
   // Require the same complete selection on retries, not a subset.
   const count=(await db.query('select count(*)::int n from trading.notification_suppressions where plan_hash=$1',[approval])).rows[0].n;
   assert.equal(count,rows.length,'Retry selection differs');
   await db.query('commit');return {applied:true,already_applied:true,count:rows.length};
  }
  assert.ok(rows.every(r=>!r.suppressed&&['pending','failed'].includes(r.status)&&!r.provider_receipt&&!r.sent_at),'Only unsuppressed pending/failed notifications without receipts may be selected');
  const hash=digest({project:PROJECT,plan,rows});
  if(apply){
   assert.equal(hash,approval,'Queue changed; preview again');
   const actor=(await db.query("select a.auth_user_id from draft.owner_accounts a join draft.owners o on o.id=a.owner_id join draft.league_roles r on r.auth_user_id=a.auth_user_id where o.slug='doug' and o.active and r.role='commissioner'")).rows;
   assert.equal(actor.length,1,'Linked Doug commissioner required');
   await db.query(`insert into trading.notification_suppressions(notification_id,plan_hash,reason,approved_by,prior_status,prior_attempts,prior_error)
    select id,$2,$3,$4,status,attempts,last_error from trading.notifications where id=any($1::uuid[])`,[plan.notification_ids,hash,plan.reason,actor[0].auth_user_id]);
   await db.query("update trading.notifications set status='failed',next_attempt_at='infinity',last_error='administratively_suppressed' where id=any($1::uuid[])",[plan.notification_ids]);
  }
  await db.query(apply?'commit':'rollback');
  return {applied:apply,already_applied:false,approval_hash:hash,reason:plan.reason,count:rows.length,notifications:rows.map(safe),note:'Attempted messages may already have reached the provider. Suppression stops retries; it cannot recall email.'};
 }catch(e){await db.query('rollback');throw e;}
}
