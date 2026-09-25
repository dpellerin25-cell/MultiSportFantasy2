import pg from 'pg';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
let db;
try{
  const [mode,...extra]=process.argv.slice(2);
  if(!['--enable','--status','--disable'].includes(mode)||extra.length||process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw new Error('Use --enable|--status|--disable with TEST confirmation');
  db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();
  if(mode==='--enable'){
    await db.query('begin');
    await db.query("select 'draft.live_updates'::regclass, 'draft.expire_due_picks(integer)'::regprocedure");
    await db.query('create extension if not exists pg_cron');
    if(!(await db.query("select 1 from pg_publication where pubname='supabase_realtime'")).rowCount)throw new Error('Supabase Realtime publication missing');
    if(!(await db.query("select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='draft' and tablename='live_updates'")).rowCount)
      await db.query('alter publication supabase_realtime add table draft.live_updates');
    await db.query("select cron.schedule('multisport-draft-expiry','5 seconds',$1)",["set statement_timeout='4s'; select draft.expire_due_picks(50);"]);
    await db.query('commit');
  }else if(mode==='--disable'){
    await db.query("select cron.unschedule(jobid) from cron.job where jobname='multisport-draft-expiry'");
  }
  console.log(JSON.stringify({project:PROJECT,jobs:(await db.query("select jobid,jobname,schedule,active from cron.job where jobname='multisport-draft-expiry'")).rows,
    publication:(await db.query("select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='draft'")).rows},null,2));
}catch(e){console.error('FAIL live configuration ('+(e.code??e.name)+'). No credentials printed; check prerequisites.');process.exitCode=1;}
finally{if(db){try{await db.query('rollback');}catch{}await db.end();}}
