import pg from 'pg';
import {PROJECT,connectionConfig,signIn} from './hosted-validation.mjs';
import {linkTestAccounts} from './account-links.mjs';
let db,stage='checking settings';
try{
  const [mode,...extra]=process.argv.slice(2);
  if(!['--preview','--apply'].includes(mode)||extra.length||process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw new Error('Use --preview or --apply with TEST confirmation');
  const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL),key=process.env.DRAFT_TEST_PUBLISHABLE_KEY;
  stage='verifying Doug account';const doug=await signIn(key,process.env.DRAFT_TEST_DOUG_EMAIL,process.env.DRAFT_TEST_DOUG_PASSWORD);
  stage='verifying ordinary test account';const owner=await signIn(key,process.env.DRAFT_TEST_OWNER_EMAIL,process.env.DRAFT_TEST_OWNER_PASSWORD);
  stage='connecting with verified TLS';db=new pg.Client(config);await db.connect();
  stage='linking Doug and Chris test identities';console.log(JSON.stringify(await linkTestAccounts(db,doug,owner,{apply:mode==='--apply'}),null,2));
}catch(e){const code=String(e.code??e.name);console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). No partial account links committed.`);process.exitCode=1;}
finally{if(db)await db.end();}
