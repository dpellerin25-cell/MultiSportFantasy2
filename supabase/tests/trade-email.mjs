import assert from 'node:assert/strict';
export const FROM='Pentagon Cup <notifications@multisportfantasy.com>';
const subjects={proposal:'New trade proposal',counter:'New counteroffer',acceptance:'A trade is now pending',decline:'Trade declined',roster_limit:'Your roster exceeds the 65-player limit'};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function emailConfig(env){
  assert.ok(['test','live'].includes(env.TRADE_EMAIL_MODE),'Set TRADE_EMAIL_MODE to test or live');
  const since=new Date(env.TRADE_EMAIL_NOT_BEFORE);
  assert.ok(Number.isFinite(since.getTime()),'Set TRADE_EMAIL_NOT_BEFORE to an explicit ISO timestamp');
  const site=new URL(env.TRADE_EMAIL_SITE_URL);
  assert.ok(site.protocol==='https:'&&!site.username&&!site.password&&!site.search&&!site.hash&&site.pathname==='/','Use the HTTPS website origin');
  const recipient=env.TRADE_EMAIL_TEST_RECIPIENT?.trim().toLowerCase();
  if(env.TRADE_EMAIL_MODE==='test')assert.ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient??''),'Configure the test recipient');
  // Test projects must never broadcast to every rehearsal account.
  if(env.TRADE_ROSTER_PROJECT_REF==='tgvuntuhdqucazpoxrrg')assert.equal(env.TRADE_EMAIL_MODE,'test','Keep the Supabase test project in test email mode');
  return {mode:env.TRADE_EMAIL_MODE,since:since.toISOString(),recipient,site:site.origin};
}
export function notificationPayload(row,config){
  const subject=subjects[row.kind];assert.ok(subject,'Unsupported notification');
  assert.ok(row.email_confirmed_at&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email??''),'Verified recipient required');
  const intro=row.kind==='roster_limit'
    ? `Your roster has ${row.player_count} players, exceeding the 65-player limit.`
    : row.kind==='acceptance' ? `${row.proposer} and ${row.recipient} have accepted a trade. A trade is now pending in the league.`
    : `${row.proposer} and ${row.recipient}: ${subject.toLowerCase()}.`;
  const lines=(row.assets??[]).map(a=>`${a.from_name} sends ${a.label} to ${a.to_name}.`);
  if(row.kind==='roster_limit')lines.push(
    'Points accumulated while your roster is over the limit will not count toward the Pentagon Cup.',
    'Please reduce your roster to 65 players or fewer in Fantrax. Once corrected, contact Doug if the website needs to be updated before tomorrow at 4 am Eastern. Otherwise, the next daily roster update will reflect the correction.');
  if(row.kind==='acceptance')lines.push('View Accepted Trades on the website for the current status. Player transfers must be made in Fantrax; draft-pick-only trades complete immediately.');
  const link=`${config.site}/rosters`;
  const footer='This is an automated notification. Please do not reply. Open the website to view or respond to the trade.';
  return {from:FROM,to:[row.email],subject:`${config.mode==='test'?'[TEST] ':''}Pentagon Cup: ${subject}`,
    text:[intro,...lines,`View trade: ${link}`,footer].join('\n\n'),
    html:`<div style="font-family:Arial,sans-serif;color:#172554;max-width:600px;margin:auto"><h1 style="font-size:24px">Pentagon Cup</h1><h2 style="font-size:20px">${escape(subject)}</h2><p>${escape(intro)}</p><ul>${lines.map(l=>`<li>${escape(l)}</li>`).join('')}</ul><p><a style="display:inline-block;background:#1e40af;color:white;padding:12px 18px;border-radius:8px" href="${escape(link)}">View trade</a></p><p style="font-size:12px;color:#475569">${footer}</p></div>`};
}
export async function sendNotification(payload,id,key,fetcher=fetch){
  assert.ok(key?.startsWith('re_'),'Resend key required');
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`pentagon-trade/${id}`},body:JSON.stringify(payload,Object.keys(payload).sort()),signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=new Error('Provider rejected request');error.retryable=response.status===429||response.status>=500||response.status===409;error.safeCode=`HTTP_${response.status}`;throw error;}
  const result=await response.json();if(typeof result.id!=='string'||!result.id)throw new Error('Missing provider receipt');
  return result.id;
}

// A session-level lock survives per-message commits and excludes another worker.
// Persist the exact recipient/body before HTTP; a crash reuses both and the key.
export async function deliverQueue(db,config,{send=false,key,fetcher=fetch}={}){
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const summary={eligible:0,sent:0,retry:0,held:0,skipped:0,locked:false};
  const lock=(await q('select pg_try_advisory_lock(731943,2) locked'))[0].locked;
  if(!lock){summary.locked=true;return summary;}
  try{
    const rows=await q(`select n.*,coalesce(e.occurred_at,ra.opened_at) occurred_at,ra.player_count,ra.resolved_at,t.status trade_status,t.expires_at,t.message,
      u.email,u.email_confirmed_at,op.display_name proposer,ot.display_name recipient,
      exists(select 1 from draft.owner_accounts m join draft.owners o on o.id=m.owner_id
        where m.auth_user_id=n.recipient_user_id and o.active and (n.kind='acceptance' or (n.kind='roster_limit' and o.id=ra.owner_id) or o.id in(t.proposer_id,t.recipient_id))) linked,
      coalesce((select jsonb_agg(jsonb_build_object('from_name',f.display_name,'to_name',z.display_name,
        'label',case when a.player_id is not null then p.name||' ('||p.sport::text||')'
          else k.year::text||' round '||k.round::text||' - '||original.display_name||' original pick' end) order by a.id)
        from trading.assets a join draft.owners f on f.id=a.from_owner_id join draft.owners z on z.id=a.to_owner_id
        left join trading.players p on p.id=a.player_id left join trading.picks k on k.id=a.pick_id
        left join draft.owners original on original.id=k.original_owner_id where a.trade_id=t.id),'[]') assets,
      (n.first_attempt_at is not null and n.first_attempt_at<=clock_timestamp()-interval '23 hours') retry_expired,
      (t.expires_at<=clock_timestamp()) offer_expired
      from trading.notifications n left join trading.events e on e.id=n.event_id left join trading.trades t on t.id=e.trade_id
      left join trading.roster_limit_alerts ra on ra.id=n.roster_alert_id
      join auth.users u on u.id=n.recipient_user_id
      left join draft.owners op on op.id=t.proposer_id left join draft.owners ot on ot.id=t.recipient_id
      where n.status in ('pending','failed','sending') and n.next_attempt_at<=clock_timestamp()
        and coalesce(e.occurred_at,ra.opened_at) >= $1
        and ($2::text is null or lower(u.email)=$2)
      order by n.next_attempt_at,n.id limit 20`,[config.since,config.mode==='test'?config.recipient:null]);
    for(const row of rows){
      let reason;
      if(!row.linked||!row.email_confirmed_at)reason='recipient_not_verified_or_linked';
      else if(row.message?.startsWith('HTTP trade test '))reason='test_fixture';
      else if(row.kind==='roster_limit'&&row.resolved_at)reason='roster_corrected';
      else if(row.retry_expired||row.attempts>=8)reason='review_required';
      else if(['proposal','counter'].includes(row.kind)&&(row.trade_status!=='proposed'||row.offer_expired))reason='superseded_offer';
      else if(row.delivery_payload&&row.delivery_payload.to[0]!==row.email)reason='recipient_changed';
      if(reason){summary.held++;if(send)await q("update trading.notifications set status='failed',next_attempt_at='infinity',last_error=$2 where id=$1",[row.id,reason]);continue;}
      let payload;
      try{payload=row.delivery_payload??notificationPayload(row,config);}catch{summary.held++;if(send)await q("update trading.notifications set status='failed',next_attempt_at='infinity',last_error='invalid_payload' where id=$1",[row.id]);continue;}
      summary.eligible++;
      if(!send)continue;
      const claimed=await q(`update trading.notifications set delivery_payload=$2,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),
        status='sending',attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '5 minutes',last_error=null
        where id=$1 and status in ('pending','failed','sending') and next_attempt_at<=clock_timestamp() returning id`,[row.id,JSON.stringify(payload)]);
      if(!claimed.length){summary.skipped++;continue;}
      let provider;
      try{provider=await sendNotification(payload,row.id,key,fetcher);}
      catch(error){
        const retry=error.retryable!==false;
        await q(`update trading.notifications set status='failed',last_error=$2,
          next_attempt_at=case when $3 then clock_timestamp()+interval '10 minutes' else 'infinity'::timestamptz end where id=$1`,[row.id,error.safeCode??'NETWORK_OR_UNCONFIRMED',retry]);
        if(retry)summary.retry++;else summary.held++;
        continue;
      }
      // Deliberately outside HTTP catch: a DB failure after send must preserve
      // frozen sending state for an idempotent retry, not create a new message.
      await q("update trading.notifications set status='sent',sent_at=clock_timestamp(),provider_id=$2,last_error=null where id=$1",[row.id,provider]);
      summary.sent++;
    }
    return summary;
  }finally{await q('select pg_advisory_unlock(731943,2)');}
}
