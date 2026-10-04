// Shared automation logic. No network calls or environment loading on import.
import assert from 'node:assert/strict';
import {getCACertificates} from 'node:tls';

export const ROSTER_FILES=[
  ['NFL','nfl','yg0olhfrmtj45dd6'],['MLB','mlb','60ri2nbhmtj4b0km'],
  ['NBA','nba','u1byx3qkmtj47ogg'],['EPL','premier-league','j08ymyupmtj415q3'],
  ['PGA','pga','xa7tza2hmthqz8bo'],
];

export function syncConnection(env){
  const ref=env.TRADE_ROSTER_PROJECT_REF;
  assert.match(ref??'',/^[a-z]{20}$/,'Set the explicit destination project reference');
  const u=new URL(env.TRADE_ROSTER_DATABASE_URL);
  const direct=u.hostname===`db.${ref}.supabase.co`&&u.username==='postgres';
  const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)&&u.username===`postgres.${ref}`;
  assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&(direct||pooler)&&u.port==='5432'&&u.pathname==='/postgres'&&!u.search&&!u.hash&&u.password,'Use the selected project direct/session-pooler URI on port 5432 with no query parameters');
  const ssl={rejectUnauthorized:true};
  if(env.TRADE_ROSTER_CA_CERT){
    assert.ok(env.TRADE_ROSTER_CA_CERT.includes('-----BEGIN CERTIFICATE-----'),'CA must be PEM certificate text');
    ssl.ca=[...getCACertificates('default'),env.TRADE_ROSTER_CA_CERT];
  }
  return {host:u.hostname,port:5432,database:'postgres',user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl,connectionTimeoutMillis:15000};
}

export function validateRosters(settings,files,now=Date.now()){
  assert.ok(Array.isArray(settings.owners)&&settings.owners.length>=2,'Approved membership required');
  const owners=settings.owners;
  assert.ok(owners.every(o=>typeof o.name==='string'&&o.name.trim()&&/^[a-z][a-z0-9_-]*$/.test(o.slug)));
  assert.equal(new Set(owners.map(o=>o.slug)).size,owners.length);
  assert.equal(new Set(owners.map(o=>o.name)).size,owners.length);
  const expected=owners.map(o=>o.slug).sort(),names=new Map(owners.map(o=>[o.name,o.slug]));
  assert.equal(files.length,5,'All five sports required');
  return ROSTER_FILES.map(([sport,file,league],i)=>{
    const d=files[i];
    assert.equal(d.league_id,league,`${sport}: league mismatch`);
    assert.equal(d.sport,sport==='EPL'?'Premier League':sport,`${sport}: sport mismatch`);
    assert.equal(d.team_count,owners.length);assert.equal(d.rosters.length,owners.length);
    const start=Date.parse(d.fetch_started_at),end=Date.parse(d.updated_at);
    assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=now&&start>=now-6*60*60*1000,`${sport}: missing, stale or invalid fetch timestamps; fetch all rosters again`);
    const rosters=d.rosters.map(r=>{
      assert.ok(Array.isArray(r.players));assert.equal(r.player_count,r.players.length);
      return {owner:names.get(r.owner),players:r.players.map(p=>{
        assert.ok(typeof p.player_id==='string'&&p.player_id.trim()&&typeof p.name==='string'&&p.name.trim(),'Player identity missing');
        return {player_id:p.player_id,name:p.name};
      })};
    }).sort((a,b)=>String(a.owner).localeCompare(String(b.owner)));
    assert.deepEqual(rosters.map(r=>r.owner),expected,'Roster owners differ from approved membership');
    for(const r of rosters)r.players.sort((a,b)=>a.player_id.localeCompare(b.player_id));
    const count=rosters.reduce((n,r)=>n+r.players.length,0);
    assert.equal(d.total_players,count);assert.equal(new Set(rosters.flatMap(r=>r.players.map(p=>p.player_id))).size,count,'Duplicate player');
    // Conservatively use the beginning of the reads, not file-write time. A
    // trade accepted during a fetch must wait for the next complete observation.
    return {sport,league,observed:new Date(start).toISOString(),rosters,count};
  });
}

export async function syncRosters(db,snapshots){
  assert.equal(snapshots.length,5);
  await db.query('begin');
  try{
    await db.query("set local statement_timeout='120s'");
    await db.query("set local lock_timeout='30s'");
    // Same lock as acceptance, membership changes and the existing importer.
    await db.query('select pg_advisory_xact_lock(731943,1)');
    const before=(await db.query("select count(*)::int n from trading.trades where status='completed'")).rows[0].n;
    await db.query('select trading.ingest_roster_batch($1)',[JSON.stringify(snapshots)]);
    const after=(await db.query("select count(*)::int n from trading.trades where status='completed'")).rows[0].n;
    await db.query('commit');
    return {sports:snapshots.map(s=>({sport:s.sport,players:s.count,observed_at:s.observed})),completed_trades:after-before};
  }catch(error){await db.query('rollback');throw error;}
}
