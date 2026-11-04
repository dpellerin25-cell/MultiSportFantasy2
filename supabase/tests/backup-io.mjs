import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {sha,PREFIX} from './backup-core.mjs';
const exec=promisify(execFile);
// Never expose subprocess stderr (it may contain database values or credentials).
export async function command(program,args,env=process.env){
 try{return (await exec(program,args,{env,maxBuffer:32*1024*1024,timeout:20*60*1000,windowsHide:true})).stdout;}
 catch{throw new Error(`${program} failed; raw output withheld`);}
}
export async function pgEnvironment(config,dir){
 const env={...process.env,PGHOST:config.host,PGPORT:String(config.port),PGDATABASE:config.database,PGUSER:config.user,PGPASSWORD:config.password,PGSSLMODE:config.ssl?'verify-full':'disable'};
 if(config.ssl){
  const cert=config.ssl.ca??process.env.NODE_EXTRA_CA_CERTS;
  if(config.ssl.ca){const path=join(dir,'ca.pem');await writeFile(path,Array.isArray(cert)?cert.join('\n'):cert,{mode:0o600});env.PGSSLROOTCERT=path;}
  else if(cert)env.PGSSLROOTCERT=cert;
  else env.PGSSLROOTCERT='system';
 }
 // Prevent inherited service settings overriding explicit destination.
 delete env.PGSERVICE;delete env.PGSERVICEFILE;delete env.PGOPTIONS;
 return env;
}
export function r2Settings(env){
 const endpoint=new URL(env.R2_ENDPOINT);
 assert.match(endpoint.hostname,/^[a-f0-9]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com$/);
 assert.ok(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&endpoint.pathname==='/');
 assert.equal(env.R2_BUCKET,'pentagon-cup-backups');
 assert.ok(env.R2_ACCESS_KEY_ID&&env.R2_SECRET_ACCESS_KEY);
 return {endpoint:endpoint.origin,bucket:env.R2_BUCKET,env:{...env,AWS_ACCESS_KEY_ID:env.R2_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY:env.R2_SECRET_ACCESS_KEY,AWS_DEFAULT_REGION:'auto',AWS_EC2_METADATA_DISABLED:'true',AWS_PAGER:''}};
}
export async function r2(config,operation,args){
 const text=await command('aws',['--endpoint-url',config.endpoint,'s3api',operation,'--bucket',config.bucket,...args,'--output','json'],config.env);
 return text.trim()?JSON.parse(text):{};
}
export async function listObjects(config){
 // AWS CLI follows ListObjectsV2 pagination automatically.
 return (await r2(config,'list-objects-v2',['--prefix',PREFIX])).Contents??[];
}
export async function uploadVerified(config,file,key,dir,request=r2){
 assert.ok(key.startsWith(PREFIX));
 const original=await readFile(file),digest=sha(original);
 await request(config,'put-object',['--key',key,'--body',file,'--content-type','application/octet-stream','--if-none-match','*','--metadata',`sha256=${digest}`]);
 const download=join(dir,'verification.pcbackup');
 await request(config,'get-object',['--key',key,download]);
 assert.equal((await stat(download)).size,original.length);
 assert.equal(sha(await readFile(download)),digest,'Uploaded ciphertext checksum differs');
 return digest;
}
