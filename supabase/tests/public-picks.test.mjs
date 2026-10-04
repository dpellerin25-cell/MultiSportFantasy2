import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const read=async(role='anon')=>{await db.exec(`set role ${role}`);try{return (await q('select public.rookie_pick_ownership() d'))[0].d;}finally{await db.exec('reset role');}};
  assert.equal((await read()).ledger_ready,false);
  await q(`select trading.import_pick_ledger('{"version":1,"trades":[]}')`);
  const initial=await read();assert.equal(initial.ledger_ready,true);assert.equal(initial.picks.length,180);
  assert.deepEqual(await read('authenticated'),initial);
  assert.deepEqual(Object.keys(initial).sort(),['ledger_ready','owners','picks','years']);
  assert.deepEqual(Object.keys(initial.owners[0]).sort(),['id','name','slug']);
  assert.deepEqual(Object.keys(initial.picks[0]).sort(),['id','original_owner_id','owner_id','round','year']);
  const ids=Object.fromEntries(initial.owners.map(o=>[o.slug,o.id]));
  const doug=randomUUID(),chris=randomUUID();
  await q('insert into auth.users values($1),($2)',[doug,chris]);
  await q('insert into draft.owner_accounts values($1,$2),($3,$4)',[doug,ids.doug,chris,ids.chris]);
  await q("insert into draft.league_roles values($1,'commissioner')",[doug]);
  const command=async(user,action,args)=>{await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return (await q('select public.trade_command($1,$2,$3) d',[randomUUID(),action,JSON.stringify(args)]))[0].d;}finally{await db.exec('reset role');}};
  const pick=initial.picks.find(p=>p.owner_id===ids.doug);
  const offer=await command(doug,'propose',{recipient_id:ids.chris,message:'PRIVATE SECRET',assets:[{from_owner_id:ids.doug,pick_id:pick.id}]});
  assert.equal(JSON.stringify(await read()).includes('PRIVATE SECRET'),false);
  const accepted=await command(chris,'accept',{trade_id:offer.trade_id,revision:offer.revision});
  assert.equal((await read()).picks.find(p=>p.id===pick.id).owner_id,ids.chris);
  await command(doug,'correct',{trade_id:offer.trade_id,revision:accepted.revision,reason:'Test reversal'});
  assert.equal((await read()).picks.find(p=>p.id===pick.id).owner_id,ids.doug);
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    await assert.rejects(()=>q('select * from trading.picks'),/permission denied/);
    await assert.rejects(()=>q('update trading.picks set owner_id=$1',[ids.chris]),/permission denied/);
    await assert.rejects(()=>q('select trading.seed_picks(2090)'),/permission denied/);
    await db.exec('reset role');
  }
  // Old years never leak through the rolling catalogue.
  await q('select trading.seed_picks($1)',[initial.years[0]-1]);
  assert.equal((await read()).picks.length,180);
  const missing=initial.picks.find(p=>p.owner_id===ids.tucker&&p.year===initial.years[1]);
  await q('delete from trading.picks where id=$1',[missing.id]);
  assert.equal((await read()).ledger_ready,false);
  assert.equal((await read()).picks.length,179); // public reads never seed/write
  const snapshots=['NFL','MLB','NBA','EPL','PGA'].map(sport=>({sport,league:'fixture-'+sport,observed:new Date(Date.now()-1000).toISOString(),rosters:initial.owners.map(o=>({owner:o.slug,players:[]}))}));
  await q('select trading.ingest_roster_batch($1)',[JSON.stringify(snapshots)]);
  assert.equal((await read()).ledger_ready,true);
  assert.equal((await read()).picks.length,180);
  assert.equal((await read()).picks.find(p=>p.id===pick.id).owner_id,ids.doug);
  console.log('PASS anonymous/member ownership parity, acceptance and commissioner reversal visible publicly, private data absent, raw writes/helpers denied, rolling years');
}finally{await db.close();}
