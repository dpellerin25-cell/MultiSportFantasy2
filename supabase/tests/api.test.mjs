import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {validateHostedCommands} from './hosted-validation.mjs';
import {linkTestAccounts} from './account-links.mjs';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;grant usage on schema public to anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const a=randomUUID(),b=randomUUID(),outside=randomUUID();
  await q('insert into auth.users values($1),($2),($3)',[a,b,outside]);
  await linkTestAccounts(db,a,b);assert.equal((await q('select count(*)::int n from draft.owner_accounts'))[0].n,0);
  await linkTestAccounts(db,a,b,{apply:true});await linkTestAccounts(db,a,b,{apply:true});
  assert.equal((await q('select count(*)::int n from draft.league_roles'))[0].n,1);
  await assert.rejects(()=>linkTestAccounts(db,outside,b,{apply:true}),/Conflicting/);
  await assert.rejects(()=>linkTestAccounts(db,a,a,{apply:true}),/distinct/);
  await q('delete from draft.league_roles');await q('delete from draft.owner_accounts');
  console.log('PASS account preview rollback, applied links, idempotent retry and conflict rejection');
  await db.exec('begin');
  let target;
  // Exercise the shared command scenario through the new public API wrapper.
  await validateHostedCommands({query:async(sql,params=[])=>{
    const command=sql.startsWith('select draft.command');
    const result=await db.query(command?sql.replace('draft.command','public.draft_command'):sql,params);
    if(command){
      target=params[0];
      const state=(await q('select public.draft_state($1) s',[target]))[0].s;
      assert.equal(state.revision,result.rows[0].result.revision);
      const page=(await q('select public.draft_available_players($1,null,\'\',null,100) p',[target]))[0].p;
      const paged=[];let cursor=null;
      do{
        const chunk=(await q('select public.draft_available_players($1,null,\'\',$2,1) p',[target,cursor]))[0].p;
        paged.push(...chunk.players.map(p=>p.player_id));cursor=chunk.next_cursor;
        assert.ok(paged.length<=2);
      }while(cursor);
      assert.deepEqual(paged,page.players.map(p=>p.player_id));
      for(const pick of state.picks)if(pick.player_id)assert.ok(!page.players.some(p=>p.player_id===pick.player_id));
      assert.ok(!JSON.stringify(state).includes('actor_user_id'));
    }
    return result;
  }},a,b);
  async function role(who,name,fn){
    await q('savepoint api_check');
    try{await q("select set_config('request.jwt.claim.sub',$1,true)",[who??'']);await q(`set local role ${name}`);await fn();await q('reset role');await q('release savepoint api_check');}
    catch(e){await q('rollback to savepoint api_check');await q('release savepoint api_check');throw e;}
  }
  await assert.rejects(()=>role(outside,'authenticated',()=>q('select public.draft_state($1)',[target])),/access denied/);
  await assert.rejects(()=>role(outside,'authenticated',()=>q('select public.draft_available_players($1)',[target])),/access denied/);
  await assert.rejects(()=>role(null,'anon',()=>q('select public.draft_state($1)',[target])),/permission denied/);
  await assert.rejects(()=>role(a,'authenticated',()=>q('select draft.require_member($1)',[target])),/permission denied/);
  await q("update draft.owners set active=false where slug='chris'");
  await assert.rejects(()=>role(b,'authenticated',()=>q('select public.draft_state($1)',[target])),/access denied/);
  await q("update draft.owners set active=true where slug='chris'");
  await role(a,'authenticated',async()=>{
    const all=[];let cursor=null;
    do{
      const page=(await q('select public.draft_available_players($1,null,\'\',$2,1) p',[target,cursor]))[0].p;
      all.push(...page.players.map(p=>p.player_id));cursor=page.next_cursor;
    }while(cursor);
    assert.equal(new Set(all).size,all.length);assert.equal(all.length,0); // completed fixture
    const empty=(await q("select public.draft_available_players($1,'NFL','no matching name') p",[target]))[0].p;
    assert.equal(empty.players.length,0);
  });
  await assert.rejects(()=>role(a,'authenticated',()=>q('select public.draft_available_players($1,null,\'\',null,101)',[target])),/Invalid player search/);
  console.log('PASS public command/read APIs, drafted-player exclusion, bounded reads, outsider/anon/helper denial');
  await db.exec('rollback');
}finally{await db.close();}
