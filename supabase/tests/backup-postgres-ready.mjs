import pg from 'pg';
// The image starts a temporary Unix-socket server during initialization.
// Probe authenticated TCP through the published port, and reuse that session.
export async function readyPostgres(config,{attempts=45,Client=pg.Client,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let attempt=0;attempt<attempts;attempt++){
  const client=new Client({...config,connectionTimeoutMillis:2000});
  client.on('error',()=>{});
  try{
   await client.connect();
   await client.query('select 1');
   return client;
  }catch(error){
   await client.end().catch(()=>{});
   if(['28P01','28000','42501'].includes(error.code))throw error;
   if(attempt+1<attempts)await sleep(1000);
  }
 }
 const error=new Error('Authenticated TCP startup timed out');error.code='POSTGRES_STARTUP_TIMEOUT';throw error;
}
