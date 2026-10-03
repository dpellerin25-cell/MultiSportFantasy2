import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const doug=randomUUID(),chris=randomUUID(),outsider=randomUUID();
 for(const [u,slug] of [[doug,'doug'],[chris,'chris'],[outsider,null]]){await q('insert into auth.users values($1)',[u]);if(slug)await q('insert into draft.owner_accounts select $1,id from draft.owners where slug=$2',[u,slug]);}
 await q("insert into draft.league_roles values($1,'commissioner')",[doug]);
 const call=async(user,sql,p=[],role='authenticated')=>{
  await q("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await db.exec(`set role ${role}`);
  try{return Object.values((await q(sql,p))[0])[0];}finally{await db.exec('reset role');}
 };
 const get=()=>call(doug,'select public.league_settings_state()');
 const state=await get(),members=state.owners.map(({slug,name})=>({slug,name}));
 const ten=[...members,{slug:'alex',name:'Alex'}],points=ten.map((_,i)=>(9-i)*10);
 const preview=(m=ten,p=points)=>call(doug,'select public.league_settings_preview(2027,$1,$2)',[JSON.stringify(m),p]);
 const apply=(token,request=randomUUID(),m=ten,p=points)=>call(doug,'select public.league_settings_apply($1,2027,$2,$3,$4)',[request,JSON.stringify(m),p,token]);
 for(const u of [chris,outsider,null])await assert.rejects(()=>call(u,'select public.league_settings_state()'),/Commissioner/);
 await assert.rejects(()=>call(null,'select public.league_settings_state()',[],'anon'),/permission denied/);
 await assert.rejects(()=>call(chris,'select public.league_settings_preview(2027,$1,$2)',[JSON.stringify(ten),points]),/Commissioner/);
 await assert.rejects(()=>call(chris,'select public.league_settings_apply($1,2027,$2,$3,$4)',[randomUUID(),JSON.stringify(ten),points,'fake']),/Commissioner/);
 await assert.rejects(()=>call(doug,'select draft.settings_snapshot()'),/permission denied/);
 await assert.rejects(()=>call(doug,'select * from draft.settings_requests'),/permission denied/);
 const count=async()=>Number((await q('select count(*) n from draft.membership_events'))[0].n);
 const before=await count(),review=await preview();assert.equal(review.can_apply,true);assert.equal(review.startup_picks,650);assert.deepEqual(review.added,['Alex']);
 assert.deepEqual(await get(),state);assert.equal(await count(),before);
 const invalid=await preview(ten,Array(10).fill(0));assert.equal(invalid.can_apply,false);assert.match(invalid.blockers[0],/placement table/);
 await assert.rejects(()=>apply('wrong'),/Settings changed/);
 const req=randomUUID(),result=await apply(review.token,req);assert.equal(result.applied,true);
 assert.equal(await count(),before+1);assert.deepEqual(await apply(review.token,req),result);assert.equal(await count(),before+1);
 await assert.rejects(()=>apply(review.token,req,members,points.slice(0,9)),/different settings/);
 await assert.rejects(()=>apply(review.token),/Settings changed/);
 console.log('PASS commissioner-only reads/preview/apply, no preview mutations, invalid points, stale preview rejection and exact retry');
 const ninePoints=members.map((_,i)=>(8-i)*10),back=await preview(members,ninePoints);
 const id=(await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count) values('Blocker fixture','startup',2027,65,10) returning id"))[0].id;
 const blocked=await preview(members,ninePoints);assert.equal(blocked.can_apply,false);assert.match(blocked.blockers[0],/Cancel unused/);
 await assert.rejects(()=>apply(back.token,randomUUID(),members,ninePoints),/Cancel unused/);
 assert.equal(await count(),before+1);assert.equal((await get()).season.owner_slugs.length,10);
 await q("update draft.drafts set status='cancelled' where id=$1",[id]);
 const backAgain=await preview(members,ninePoints);await apply(backAgain.token,randomUUID(),members,ninePoints);
 assert.equal((await get()).season.owner_slugs.length,9);
 console.log('PASS new draft blocker after preview prevents apply, settings/audit unchanged, resolved blocker permits retry through new preview');
}finally{await db.close();}
