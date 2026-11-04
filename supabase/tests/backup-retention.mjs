import assert from 'node:assert/strict';
import {PROJECT,retention,sha} from './backup-core.mjs';
import {r2Settings,listObjects,r2} from './backup-io.mjs';
try{
 const [mode,approval,...extra]=process.argv.slice(2);
 assert.ok(!extra.length&&['--preview','--apply'].includes(mode));
 assert.equal(process.env.BACKUP_PROJECT_CONFIRM,PROJECT);
 const config=r2Settings(process.env),objects=await listObjects(config),plan=retention(objects);
 const hash=sha(Buffer.from(JSON.stringify(plan)));
 if(mode==='--apply'){
  assert.equal(approval,hash,'Preview changed');
  // Delete only reviewed keys, never whole buckets/prefixes. New objects are unaffected.
  for(const key of plan.remove)await r2(config,'delete-object',['--key',key]);
 }
 console.log(JSON.stringify({applied:mode==='--apply',approval_hash:hash,storage_warning:plan.bytes>=8_000_000_000?'This backup prefix exceeds 8 GB; review account-wide R2 usage.':null,...plan},null,2));
}catch{console.error('Retention failed. No automatic broad deletion. Preview again and review the exact keys before applying.');process.exitCode=1;}
