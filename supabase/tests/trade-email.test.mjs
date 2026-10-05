import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {FROM,emailConfig,notificationPayload,deliverQueue} from './trade-email.mjs';
const env={TRADE_EMAIL_MODE:'test',TRADE_EMAIL_NOT_BEFORE:'2020-01-01T00:00:00Z',TRADE_EMAIL_SITE_URL:'https://example.com',TRADE_EMAIL_TEST_RECIPIENT:'doug@example.com',TRADE_ROSTER_PROJECT_REF:'tgvuntuhdqucazpoxrrg'};
const config=emailConfig(env);
for(const patch of [{TRADE_EMAIL_MODE:'live'},{TRADE_EMAIL_NOT_BEFORE:'bad'},{TRADE_EMAIL_SITE_URL:'http://example.com'},{TRADE_EMAIL_TEST_RECIPIENT:''}])assert.throws(()=>emailConfig({...env,...patch}));
for(const kind of ['proposal','counter','acceptance','decline']){
 const p=notificationPayload({kind,email:'doug@example.com',email_confirmed_at:true,proposer:'<Doug>',recipient:'Chris',assets:[{from_name:'Doug',to_name:'Chris',label:'2027 pick & player'}]},config);
 assert.equal(p.from,FROM);assert.ok(!('reply_to' in p));assert.ok(p.html.includes('&lt;Doug&gt;'));assert.ok(p.text.includes('Please do not reply'));
}
console.log('PASS sender, four templates, HTML escaping, no Reply-To and test destination guards');
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const owners=Object.fromEntries((await q('select id,slug from draft.owners')).map(o=>[o.slug,o.id]));
 const user=randomUUID();await q('insert into auth.users values($1,$2,now())',[user,config.recipient]);
 await q('insert into draft.owner_accounts(auth_user_id,owner_id) values($1,$2)',[user,owners.doug]);
 async function fixture(kind='proposal',message=''){
  const t=(await q('insert into trading.trades(proposer_id,recipient_id,message) values($1,$2,$3) returning id',[owners.chris,owners.doug,message]))[0].id;
  const e=(await q('insert into trading.events(trade_id,action) values($1,$2) returning id',[t,kind]))[0].id;
  return (await q('insert into trading.notifications(event_id,recipient_user_id,kind) values($1,$2,$3) returning id',[e,user,kind]))[0].id;
 }
 let calls=[];const fetcher=async(url,args)=>{calls.push({url,...args});return {ok:true,json:async()=>({id:'receipt'})};};
 const opts={send:true,key:'re_fake',fetcher};
 const id=await fixture();assert.equal((await deliverQueue(db,config)).eligible,1);assert.equal((await q('select attempts from trading.notifications where id=$1',[id]))[0].attempts,0);
 assert.equal((await deliverQueue(db,config,opts)).sent,1);await deliverQueue(db,config,opts);assert.equal(calls.length,1);
 assert.equal(calls[0].headers['Idempotency-Key'],`pentagon-trade/${id}`);
 console.log('PASS migrated queue preview is read-only, provider receipt saved and sent rows not resent');
 const retry=await fixture();await deliverQueue(db,config,{...opts,fetcher:async()=>{throw new Error('network');}});
 const frozen=(await q('select delivery_payload from trading.notifications where id=$1',[retry]))[0].delivery_payload;
 await q('update trading.notifications set next_attempt_at=now() where id=$1',[retry]);
 await deliverQueue(db,{...config,site:'https://changed.example.com'},opts);
 assert.deepEqual(JSON.parse(calls.at(-1).body),frozen);
 console.log('PASS uncertain HTTP failure retries identical frozen payload and stable idempotency key');
 const old=await fixture();await q("update trading.notifications set first_attempt_at=now()-interval '24 hours' where id=$1",[old]);
 const stale=await fixture('proposal','HTTP trade test fixture');
 assert.equal((await deliverQueue(db,config,opts)).held,2);
 assert.equal((await q('select last_error from trading.notifications where id=$1',[old]))[0].last_error,'review_required');
 const rate=await fixture();assert.equal((await deliverQueue(db,config,{...opts,fetcher:async()=>({ok:false,status:429})})).retry,1);
 await q('update trading.notifications set next_attempt_at=now() where id=$1',[rate]);
 assert.equal((await deliverQueue(db,config,{...opts,fetcher:async()=>({ok:false,status:400})})).held,1);
 const hidden=await fixture();assert.equal((await deliverQueue(db,{...config,recipient:'other@example.com'},opts)).sent,0);
 const blocked={query:async()=>({rows:[{locked:false}]})};assert.equal((await deliverQueue(blocked,config,opts)).locked,true);
 console.log('PASS retry window, fixture suppression, rate limits, permanent failures, recipient filtering and busy-worker guard');
 // Simulate provider acceptance followed by failure persisting the receipt.
 let fail=true;const wrapper={query:async(s,p)=>{if(fail&&s.includes("status='sent'")){fail=false;throw new Error('DB loss');}return db.query(s,p);}};
 await assert.rejects(()=>deliverQueue(wrapper,config,opts));const first=calls.at(-1);
 await q('update trading.notifications set next_attempt_at=now() where id=$1',[hidden]);
 await deliverQueue(db,config,opts);assert.equal(calls.at(-1).body,first.body);assert.equal(calls.at(-1).headers['Idempotency-Key'],first.headers['Idempotency-Key']);
 console.log('PASS crash after provider acceptance preserves payload/key for safe retry; no live email sent');
 const cutoff=await fixture();assert.equal((await deliverQueue(db,{...config,since:'2200-01-01T00:00:00Z'},opts)).sent,0);
 await q("update trading.trades set status='withdrawn' where id=(select e.trade_id from trading.events e join trading.notifications n on n.event_id=e.id where n.id=$1)",[cutoff]);
 assert.equal((await deliverQueue(db,config,opts)).held,1);
 const unverified=await fixture();await q('update auth.users set email_confirmed_at=null where id=$1',[user]);assert.equal((await deliverQueue(db,config,opts)).held,1);
 await q('update auth.users set email_confirmed_at=now() where id=$1',[user]);
 const suppressed=await fixture();await q("update trading.notifications set next_attempt_at='infinity' where id=$1",[suppressed]);assert.equal((await deliverQueue(db,config,opts)).sent,0);
 const changed=await fixture();await deliverQueue(db,config,{...opts,fetcher:async()=>{throw new Error('lost');}});
 await q('update auth.users set email=$2 where id=$1',[user,'new@example.com']);await q('update trading.notifications set next_attempt_at=now() where id=$1',[changed]);
 assert.equal((await deliverQueue(db,{...config,recipient:'new@example.com'},opts)).held,1);
 await db.exec('set role authenticated');await assert.rejects(()=>q('select delivery_payload from trading.notifications'));await db.exec('reset role');
 console.log('PASS cutoff, closed offers, unverified and changed recipients, suppression and private payload access');
 // Acceptance fan-out is league-wide; private proposals remain recipient-only.
 for(const slug of ['chris','brendan']){
  const u=randomUUID();await q('insert into auth.users values($1,$2,now())',[u,slug+'@example.com']);
  await q('insert into draft.owner_accounts(auth_user_id,owner_id) values($1,$2)',[u,owners[slug]]);
 }
 const acceptance=await fixture('acceptance');
 const event=(await q('select event_id from trading.notifications where id=$1',[acceptance]))[0].event_id;
 await q("select trading.notify($1,$2,'acceptance')",[event,owners.doug]);
 await q("select trading.notify($1,$2,'acceptance')",[event,owners.chris]);
 assert.equal((await q('select count(*)::int n from trading.notifications where event_id=$1',[event]))[0].n,3);
 const leagueResult=await deliverQueue(db,{...config,recipient:'brendan@example.com'},opts);
 assert.equal(leagueResult.sent,1);assert.ok(JSON.parse(calls.at(-1).body).text.includes('A trade is now pending'));
 const privateId=await fixture();const privateEvent=(await q('select event_id from trading.notifications where id=$1',[privateId]))[0].event_id;
 await q("select trading.notify($1,$2,'proposal')",[privateEvent,owners.doug]);
 assert.equal((await q('select count(*)::int n from trading.notifications where event_id=$1',[privateEvent]))[0].n,1);
 console.log('PASS league-wide acceptance including uninvolved owner, duplicate fan-out prevention and proposal privacy');
 let tick=Date.now()-100000;
 const slugs=Object.keys(owners);
 async function batch(count){
  tick+=1000;
  const snapshots=['NFL','MLB','NBA','EPL','PGA'].map(sport=>({sport,league:'email-'+sport,observed:new Date(tick).toISOString(),rosters:slugs.map(owner=>({owner,players:owner==='doug'&&sport==='NFL'?Array.from({length:count},(_,i)=>({player_id:String(i),name:'Player '+i})):[]}))}));
  await q('select trading.ingest_roster_batch($1)',[JSON.stringify(snapshots)]);
 }
 await batch(65);assert.equal((await q('select count(*)::int n from trading.roster_limit_alerts'))[0].n,0);
 await batch(66);await batch(67);
 assert.equal((await q("select count(*)::int n from trading.notifications where kind='roster_limit'"))[0].n,1);
 const alert=(await q("select id from trading.notifications where kind='roster_limit'"))[0].id;
 // Isolate alert delivery from previous test notifications.
 await q("update trading.notifications set next_attempt_at='infinity' where kind<>'roster_limit'");
 assert.equal((await deliverQueue(db,{...config,recipient:'new@example.com'},opts)).sent,1);
 const mail=JSON.parse(calls.at(-1).body);assert.ok(mail.text.includes('67 players'));assert.ok(mail.text.includes('will not count toward the Pentagon Cup'));assert.ok(mail.text.includes('contact Doug'));assert.ok(mail.text.includes('4 am Eastern'));
 await batch(65);await batch(66);
 assert.equal((await q('select count(*)::int n from trading.roster_limit_alerts'))[0].n,2);
 await batch(65);
 assert.equal((await deliverQueue(db,{...config,recipient:'new@example.com'},opts)).held,1);
 await db.exec('set role authenticated');await assert.rejects(()=>q('select * from trading.roster_limit_alerts'));await db.exec('reset role');

 await q('begin');await batch(66);await q('rollback');
 assert.equal((await q('select count(*)::int n from trading.roster_limit_alerts where resolved_at is null'))[0].n,0);
 console.log('PASS 65/66 boundary, one alert per violation, fresh alert after correction, corrected pending alert suppression and private state');

}finally{await db.close();}
