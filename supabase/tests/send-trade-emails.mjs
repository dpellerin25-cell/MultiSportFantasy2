import pg from 'pg';
import {syncConnection} from './trade-roster-sync.mjs';
import {emailConfig,deliverQueue} from './trade-email.mjs';
let db,stage='checking settings';
try {
  const flag=process.argv.slice(2);
  if(flag.length!==1||!['--preview','--send'].includes(flag[0]))throw new Error('arguments');
  const send=flag[0]==='--send';
  const config=emailConfig(process.env);
  if(send&&(process.env.TRADE_EMAIL_ENABLED!=='true'||!process.env.RESEND_API_KEY?.startsWith('re_')))throw new Error('delivery disabled or missing key');
  db=new pg.Client(syncConnection(process.env));
  stage='connecting with verified TLS';await db.connect();
  stage='processing notification queue';
  const result=await deliverQueue(db,config,{send,key:process.env.RESEND_API_KEY});
  console.log(JSON.stringify({mode:send?'send':'preview',...result},null,2));
  console.log(send?'Sent means accepted by Resend. Confirm delivery in Resend and the recipient inbox.':'Preview only. No notifications changed or emails sent.');
  if(result.retry||result.held){console.log('Some notifications need retry or review; inspect private notifications.last_error.');if(send)process.exitCode=1;}
} catch {
  console.error(`Trade email worker failed while ${stage}. Check TRADE_EMAILS.md. No secrets printed; retry preserves provider idempotency within the retry window.`);
  process.exitCode=1;
} finally {if(db)await db.end().catch(()=>{});}
