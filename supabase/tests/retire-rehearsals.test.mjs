import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const actor='00000000-0000-0000-0000-000000000001';
 await q('insert into auth.users values($1)',[actor]);
 await q("insert into draft.owner_accounts select $1,id from draft.owners where slug='doug'",[actor]);
 await q("insert into draft.league_roles values($1,'commissioner')",[actor]);
 const members=await q('select slug,display_name name from draft.owners order by slug');
 const validate=()=>q('select draft.validate_membership(2027,$1,$2,$3)',[JSON.stringify(members),[100,80,65,52,40,30,20,10,0],actor]);
 const d=(await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count) values('Test rehearsal','startup',2027,80,9) returning *"))[0];
 await q('insert into draft.draft_participants select $1,id,row_number() over(order by slug) from draft.owners where active',[d.id]);
 await q('select draft.generate_snake_picks($1)',[d.id]);
 await q("update draft.drafts set status='paused',current_pick_number=3,paused_remaining_seconds=45 where id=$1",[d.id]);
 const before=await q('select * from draft.draft_picks where draft_id=$1 order by overall_pick_number',[d.id]);
 const revision=(await q('select revision from draft.drafts where id=$1',[d.id]))[0].revision;
 await assert.rejects(validate,/started or completed/);
 await assert.rejects(()=>q('select draft.retire_rehearsal($1,$2,$3)',[d.id,revision+1,'Confirmed test rehearsal retirement']),/preview again/);
 await db.exec('set role authenticated');
 await assert.rejects(()=>q('select draft.retire_rehearsal($1,$2,$3)',[d.id,revision,'Confirmed test rehearsal retirement']),/permission denied/);
 await db.exec('reset role');
 await q('select draft.retire_rehearsal($1,$2,$3)',[d.id,revision,'Confirmed test rehearsal retirement']);
 await q('select draft.retire_rehearsal($1,$2,$3)',[d.id,revision,'Confirmed test rehearsal retirement']);
 await validate();
 assert.deepEqual(await q('select * from draft.draft_picks where draft_id=$1 order by overall_pick_number',[d.id]),before);
 assert.equal((await q('select current_pick_number from draft.drafts where id=$1',[d.id]))[0].current_pick_number,3);
 assert.equal((await q('select count(*)::int n from draft.retired_rehearsals'))[0].n,1);
 await assert.rejects(()=>q("update draft.drafts set status='paused' where id=$1",[d.id]),/immutable/);
 await assert.rejects(()=>q('delete from draft.retired_rehearsals'),/immutable/i);
 await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,status,current_pick_number) values('Real draft','startup',2027,80,9,'paused',null)");
 await assert.rejects(validate,/started or completed/);
 console.log('PASS explicit retirement, stale revision/role denial, history and current pick preserved, retry, immutable retirement and other draft blockers');
}finally{await db.close();}

