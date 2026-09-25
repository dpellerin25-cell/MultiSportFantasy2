import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {connectionConfig,PROJECT} from './hosted-validation.mjs';
import {validateExport,importPool,PoolValidationError} from './player-pool-import.mjs';
let db,stage='reading and validating export';
try{
  const [mode,path,...extra]=process.argv.slice(2);
  if(!['--validate-only','--import'].includes(mode)||!path||extra.length)throw new Error('Usage');
  const bytes=await readFile(path),pool=validateExport(bytes);
  console.log(JSON.stringify({validated:true,checksum:pool.checksum,...pool.metadata},null,2));
  if(mode==='--import'){
    stage='checking test-project settings';
    if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw new Error('Confirmation');
    const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL);
    stage='connecting with verified TLS';db=new pg.Client(config);await db.connect();
    stage='importing transaction';console.log(JSON.stringify(await importPool(db,bytes),null,2));
  }
}catch(error){
  if(error instanceof PoolValidationError)console.error(error.message);
  const code=String(error.code??error.name??'Error');
  console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). No partial import committed. Usage: node import-player-pool.mjs --validate-only|--import FILE`);
  process.exitCode=1;
}finally{if(db)await db.end();}
