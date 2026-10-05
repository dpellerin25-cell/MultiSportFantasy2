// Explicitly committed fixtures in TEST only. Retains immutable audit history.
import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {settings,httpApi,prepare,scenario,cleanup} from './trade-http-support.mjs';
let db,users,run,prepared=false,stage='settings',passed=false;
const args=process.argv.slice(2),cleanupOnly=args[0]==='--cleanup';
try{
  if(!(args.length===0||(cleanupOnly&&args.length===2)))throw new Error('Arguments');
  run=cleanupOnly?args[1]:randomUUID();assert.match(run,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const config=settings(process.env);
  assert.equal(process.env.TRADE_HTTP_TEST_CONFIRM,'COMMIT_TEST_FIXTURES','Explicit fixture confirmation required');
  const api=httpApi(process.env.DRAFT_TEST_PUBLISHABLE_KEY);users=[];
  for(const label of ['DOUG','OWNER','THIRD']){
    stage='signing in '+label;users.push(await api.login(process.env[`DRAFT_TEST_${label}_EMAIL`],process.env[`DRAFT_TEST_${label}_PASSWORD`]));
  }
  stage='verified TLS database connection';db=new pg.Client(config);await db.connect();
  await db.query("set statement_timeout='20s';set lock_timeout='5s'");
  assert.equal((await db.query('select pg_try_advisory_lock(731943,2) locked')).rows[0].locked,true,'Another HTTP diagnostic is running');
  console.log('HTTP trade test run ID: '+run);
  if(cleanupOnly){stage='recovery cleanup';await cleanup(db,users[0].id,run);console.log('PASS recovery cleanup; immutable history retained.');}
  else{
    stage='checking linked users and preparing test-only ledger';const fixture=await prepare(db,users,run);prepared=true;
    stage='HTTP trade assertions';const acceptedId=await scenario(api,users,fixture,message=>{console.log(message);stage='checks after '+message;});
    stage='verifying persisted transfer and notification counts';
    assert.equal((await db.query('select count(*)::int n from trading.pick_history where reason=$1',['accept trade '+acceptedId])).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from trading.notifications n join trading.events e on e.id=n.event_id where e.trade_id=$1 and n.kind='acceptance'",[acceptedId])).rows[0].n,(await db.query('select count(*)::int n from draft.owner_accounts a join draft.owners o on o.id=a.owner_id where o.active')).rows[0].n);
    passed=true;
  }
}catch(e){
  if(stage==='settings'&&e.message.startsWith('Missing settings:'))console.error(e.message);
  const code=String(e.code??e.name??'Error');console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). No credentials printed.`);process.exitCode=1;
}finally{
  if(db){
    try{
      await db.query('rollback');
      if(prepared){
        await cleanup(db,users[0].id,run);
        console.log('PASS cleanup: offers closed, accepted fixture picks restored, queued test notifications suppressed. Audit history retained.');
        if(passed)console.log('PASS hosted HTTP trade validation. Email delivery and player/Fantrax transfers were not tested.');
      }
    }catch{console.error('Cleanup requires attention. Keep the run ID; do not delete history or rerun a new test.');process.exitCode=1;}
    await db.end();
  }
  if(run)console.log(`Recovery command if needed: node trade-http.test.mjs --cleanup ${run}`);
}
