import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
export const PROJECT='tgvuntuhdqucazpoxrrg';
export const PREFIX=`pentagon-backups/v1/${PROJECT}/`;
export const SCHEMAS=['draft','trading','scoring','backup','public','auth','supabase_migrations'];
const MAGIC=Buffer.from('PCBACKUP1');
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function keyFrom(value){
 assert.match(value??'',/^[A-Za-z0-9+/]{43}=$/,'32-byte base64 backup key required');
 const key=Buffer.from(value,'base64');assert.equal(key.length,32);return key;
}
export function encryptBundle(bundle,key){
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(MAGIC);
 const ciphertext=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(bundle)))),cipher.final()]);
 return Buffer.concat([MAGIC,nonce,cipher.getAuthTag(),ciphertext]);
}
export function decryptBundle(bytes,key){
 assert.ok(bytes.subarray(0,9).equals(MAGIC),'Unknown backup format');
 const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(9,21));
 decipher.setAAD(MAGIC);decipher.setAuthTag(bytes.subarray(21,37));
 const plaintext=Buffer.concat([decipher.update(bytes.subarray(37)),decipher.final()]);
 const bundle=JSON.parse(gunzipSync(plaintext,{maxOutputLength:1024*1024*1024}).toString());
 assert.equal(bundle.version,1);assert.equal(bundle.project,PROJECT);
 assert.equal(sha(Buffer.from(bundle.dump,'base64')),bundle.dump_sha256,'Dump integrity mismatch');
 return bundle;
}
export function objectKey(kind,id,date=new Date()){
 assert.ok(['daily','manual','draft','final'].includes(kind));assert.match(id,/^[a-zA-Z0-9-]+$/);
 return `${PREFIX}${kind}/${date.toISOString().replaceAll(':','-')}_${id}.pcbackup`;
}
// Retention is calculated only on this tool's exact object naming format.
// Keep latest 14 daily dates and one per each of the latest 8 ISO weeks.
export function retention(objects,now=new Date()){
 const valid=objects.filter(o=>o.Key?.startsWith(PREFIX)&&/^(daily|manual|draft|final)\/\d{4}-\d{2}-\d{2}T[0-9TZ.\-]+_[a-zA-Z0-9-]+\.pcbackup$/.test(o.Key.slice(PREFIX.length)))
  .map(o=>({...o,kind:o.Key.slice(PREFIX.length).split('/')[0],time:new Date(o.LastModified)}))
  .filter(o=>Number.isFinite(+o.time)&&o.time<=now).sort((a,b)=>b.time-a.time||a.Key.localeCompare(b.Key));
 const keep=new Set(),days=new Set(),weeks=new Set();
 for(const o of valid){
  if(['manual','final'].includes(o.kind)){keep.add(o.Key);continue;}
  if(o.kind==='draft'){
   // Only expire draft files once a newer final export exists; active drafts
   // and uncertain/missing final backups are retained conservatively.
   const draftId=o.Key.split('_').at(-1).slice(0,36);
   const final=valid.find(f=>f.kind==='final'&&f.Key.split('_').at(-1).startsWith(draftId+'-')&&f.time>=o.time);
   if(!final||now-final.time<30*86400000)keep.add(o.Key);
   continue;
  }
  const day=o.time.toISOString().slice(0,10),monday=new Date(o.time);
  monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
  const week=monday.toISOString().slice(0,10);
  if(!days.has(day)&&days.size<14){keep.add(o.Key);days.add(day);}
  if(!weeks.has(week)&&weeks.size<8){keep.add(o.Key);weeks.add(week);}
 }
 return {keep:[...keep].sort(),remove:valid.filter(o=>!keep.has(o.Key)).map(o=>o.Key).sort(),bytes:objects.reduce((n,o)=>n+Number(o.Size??0),0)};
}
export const identifier=s=>'"'+s.replaceAll('"','""')+'"';
export async function inventory(db){
 const tables=(await db.query(`select schemaname,tablename from pg_tables where schemaname=any($1) order by 1,2`,[SCHEMAS])).rows;
 const result=[];
 for(const t of tables){
  const name=`${identifier(t.schemaname)}.${identifier(t.tablename)}`;
  // Ordered row hashes verify contents, including IDs, account links and corrections.
  const r=(await db.query(`select count(*)::text count,md5(coalesce(string_agg(h,'' order by h),'')) checksum from (select md5(to_jsonb(t)::text) h from ${name} t) x`)).rows[0];
  result.push({...t,...r});
 }
 return result;
}
