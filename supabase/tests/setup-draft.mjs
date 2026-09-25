import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {OWNER_SLUGS,validateSetup,prepareDraft,SetupError} from './draft-setup.mjs';
let db,stage='checking arguments';
try{
  const [mode,file,...extra]=process.argv.slice(2);
  if(!['--template','--preview','--create'].includes(mode)||!file||extra.length)throw new SetupError('Usage: node setup-draft.mjs --template|--preview|--create CONFIG.json');
  if(mode==='--template'){
    await writeFile(file,JSON.stringify({draft_id:randomUUID(),import_id:'e159f9bf-6527-4333-b6b2-d6341ee22fcf',name:'Startup draft rehearsal',championship_year:2027,timer_seconds:null,owner_order:[]},null,2)+'\n',{flag:'wx'});
    console.log('Created template. Choose timer_seconds and owner_order before preview. Owner slugs: '+OWNER_SLUGS.join(', '));
  }else{
    stage='validating configuration';const config=validateSetup(JSON.parse(await readFile(file,'utf8')));
    stage='checking test-project settings';if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw new SetupError('Set DRAFT_TEST_CONFIRM to '+PROJECT);
    db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));stage='connecting with verified TLS';await db.connect();
    stage='preparing draft';console.log(JSON.stringify(await prepareDraft(db,config,{create:mode==='--create'}),null,2));
  }
}catch(e){if(e instanceof SetupError)console.error(e.message);const code=String(e.code??e.name);console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). No partial setup committed.`);process.exitCode=1;}
finally{if(db)await db.end();}
