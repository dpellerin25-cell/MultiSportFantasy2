// One-command disposable Docker runner. No Supabase credentials or host mounts.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const docker=(args,options={})=>{
  const result=spawnSync('docker',args,{encoding:'utf8',timeout:15000,...options});
  if(result.error||result.status!==0)throw new Error('Docker command failed. Ensure Docker is installed and running.');
  return result.stdout?.trim();
};
let container;
try{
  docker(['info'],{stdio:'ignore'});
  container='multisport-trade-test-'+randomBytes(5).toString('hex');
  const password=randomBytes(24).toString('hex');
  // Password is only for this isolated, loopback-bound disposable database.
  // Pass it through the child environment instead of command-line arguments.
  docker(['run','-d','--name',container,'-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=multisport_trade_test',
    '-p','127.0.0.1::5432','postgres:17-alpine'],
    {timeout:300000,env:{...process.env,POSTGRES_PASSWORD:password},stdio:['ignore','pipe','inherit']});
  console.log(`Disposable container: ${container}`);
  let ready=false;
  for(let i=0;i<40;i++){
    const result=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','multisport_trade_test'],{stdio:'ignore',timeout:3000});
    if(result.status===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error('Disposable PostgreSQL did not become ready in time.');
  const info=JSON.parse(docker(['inspect',container]));
  const binding=info[0]?.NetworkSettings?.Ports?.['5432/tcp']?.[0];
  if(binding?.HostIp!=='127.0.0.1'||!/^\d+$/.test(binding.HostPort))throw new Error('Expected a loopback-only database port.');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./trade-concurrency.test.mjs',import.meta.url))],{
    stdio:'inherit',timeout:180000,
    env:{...process.env,LOCAL_TRADE_TEST_DB_URL:`postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/multisport_trade_test`}
  });
  if(result.error||result.status!==0)throw new Error('Trade concurrency tests did not pass. Keep the output for investigation.');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
  if(container){
    console.log(`Fixtures retained. Inspect with: docker exec -it ${container} psql -U postgres -d multisport_trade_test`);
    console.log(`When finished, remove only this disposable container and its anonymous volume: docker rm -fv ${container}`);
  }
}
