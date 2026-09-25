import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const PROJECT = 'tgvuntuhdqucazpoxrrg';
export function connectionConfig(value) {
  const fail = () => { throw new Error('Use the TEST project direct or session-pooler PostgreSQL URL on port 5432, database postgres, with no query parameters.'); };
  let u; try { u = new URL(value); } catch { fail(); }
  const direct = u.hostname === `db.${PROJECT}.supabase.co` && u.username === 'postgres';
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) && u.username === `postgres.${PROJECT}`;
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !(direct || pooler) || u.port !== '5432' || u.pathname !== '/postgres' || u.search || u.hash || !u.password) fail();
  return {host:u.hostname, port:5432, database:'postgres', user:decodeURIComponent(u.username), password:decodeURIComponent(u.password), ssl:{rejectUnauthorized:true}, connectionTimeoutMillis:15000};
}

// Existing confirmed test users only. Never creates users or prints tokens.
export async function signIn(key, email, password, fetcher=fetch) {
  if (!key || !email || !password) throw new Error('Missing test account credentials or publishable API key.');
  const base=`https://${PROJECT}.supabase.co/auth/v1`;
  const response=await fetcher(`${base}/token?grant_type=password`, {method:'POST', headers:{apikey:key,'Content-Type':'application/json'}, body:JSON.stringify({email,password}), signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Test account sign-in failed (HTTP ${response.status}).`);
  const session=await response.json();
  if (!session.access_token) throw new Error('No access token returned.');
  const verified=await fetcher(`${base}/user`, {headers:{apikey:key,Authorization:`Bearer ${session.access_token}`}, signal:AbortSignal.timeout(15000)});
  if (!verified.ok) throw new Error('Test account verification failed.');
  const user=await verified.json();
  if (!user.id || !user.email_confirmed_at || user.email?.toLowerCase() !== email.toLowerCase()) throw new Error('Expected a confirmed test account with matching email.');
  return user.id;
}

// Caller owns the transaction and MUST roll it back, even after success.
export async function validateHostedCommands(db, doug, other, report=console.log) {
  assert.notEqual(doug,other,'Use two distinct test accounts');
  const q=async(sql,p=[])=>(await db.query(sql,p)).rows;
  const owners=await q("select id,slug from draft.owners where slug in ('doug','chris') order by slug desc");
  assert.deepEqual(owners.map(o=>o.slug),['doug','chris']);
  assert.equal((await q('select id from auth.users where id=any($1::uuid[])',[ [doug,other] ])).length,2);
  assert.equal((await q('select 1 from draft.owner_accounts where auth_user_id=any($1::uuid[]) or owner_id=any($2::uuid[])',[[doug,other],owners.map(o=>o.id)])).length,0,'Test accounts/owners must not already be linked');
  assert.equal((await q('select 1 from draft.league_roles where auth_user_id=any($1::uuid[])',[[doug,other]])).length,0,'Use accounts without existing commissioner roles');
  await q('insert into draft.owner_accounts values($1,$2),($3,$4)',[doug,owners[0].id,other,owners[1].id]);
  await q("insert into draft.league_roles values($1,'commissioner')",[doug]);
  const imp=(await q("insert into draft.player_pool_imports(checksum,schema_version,status,completed_at) values($1,1,'ready',now()) returning id",[randomUUID().replaceAll('-','').repeat(2)]))[0].id;
  const d=(await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,import_id) values('ROLLBACK ONLY hosted validation','free_agent',2027,1,2,$1) returning id",[imp]))[0].id;
  const players=[];
  for(let i=0;i<2;i++) {
    const name=`Validation fixture ${i}`;
    const p=(await q("insert into draft.players(sport,name) values('NFL',$1) returning id",[name]))[0].id;
    const s=(await q("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'validation',$2,$3) returning id",[p,d,String(i)]))[0].id;
    await q("insert into draft.player_pool_entries values($1,$2,$3,'NFL',$4,null,null,'free_agent')",[imp,p,s,name]);
    await q("insert into draft.draft_pool_players values($1,$2,$3,'NFL',$4,null,null,'free_agent',true)",[d,imp,p,name]);
    players.push(p);
  }
  async function asRole(who,role,fn) {
    await q('savepoint permission_check');
    try {
      await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[who??'',JSON.stringify({sub:who,role})]);
      await q(role==='anon'?'set local role anon':'set local role authenticated');
      assert.equal((await q('select auth.uid() id'))[0].id,who);
      const result=await fn();
      await q('reset role'); await q('release savepoint permission_check'); return result;
    } catch(error) {await q('rollback to savepoint permission_check');await q('release savepoint permission_check');throw error;}
  }
  async function command(who,action,args={},request=randomUUID(),revision=null) {
    const rev=revision??Number((await q('select revision from draft.drafts where id=$1',[d]))[0].revision);
    return asRole(who,'authenticated',async()=>(await q('select draft.command($1,$2,$3,$4,$5) result',[d,request,rev,action,JSON.stringify(args)]))[0].result);
  }
  await command(doug,'set_order',{owners:owners.map(o=>o.id)});
  await assert.rejects(()=>command(other,'set_timer',{seconds:300}),/Commissioner/);
  await command(doug,'set_timer',{seconds:300});await command(doug,'start');
  report('PASS commissioner setup; other owner cannot use commissioner commands');
  const slots=await q('select id from draft.draft_picks where draft_id=$1 order by overall_pick_number',[d]);
  await assert.rejects(()=>command(other,'pick',{pick_id:slots[0].id,player_id:players[0]}),/on the clock/);
  const rev=Number((await q('select revision from draft.drafts where id=$1',[d]))[0].revision);
  const request=randomUUID(),args={pick_id:slots[0].id,player_id:players[0]};
  const result=await command(doug,'pick',args,request,rev);
  assert.deepEqual(await command(doug,'pick',args,request,rev),result);
  await assert.rejects(()=>command(other,'pick',{pick_id:slots[1].id,player_id:players[0]}),/unique/);
  report('PASS current-owner enforcement, idempotent retry, duplicate-player rejection');
  await command(doug,'pause');
  await assert.rejects(()=>command(other,'pick',{pick_id:slots[1].id,player_id:players[1]}),/current running/);
  await command(doug,'resume');
  await command(other,'pick',{pick_id:slots[1].id,player_id:players[1]});
  report('PASS pause/resume and second owner completion');
  await asRole(other,'authenticated',async()=>assert.equal((await q('select * from draft.drafts where id=$1',[d])).length,0));
  await assert.rejects(()=>asRole(other,'authenticated',()=>q('update draft.drafts set revision=999 where id=$1',[d])),/permission denied/);
  await assert.rejects(()=>asRole(other,'authenticated',()=>q('select draft.advance_clock($1)',[d])),/permission denied/);
  await assert.rejects(()=>asRole(null,'anon',()=>q("select draft.command($1,$2,0,'start')",[d,randomUUID()])),/permission denied/);
  report('PASS private reads, blocked direct writes/helpers, blocked anonymous commands');
}
