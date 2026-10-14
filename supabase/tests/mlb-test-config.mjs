export function mlbTestConfig(raw){
 let u;try{u=new URL(raw);}catch{throw Error('Local disposable MLB database URL required');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.pathname!=='/multisport_mlb_test'||u.username!=='postgres'||!u.password||!u.port||u.search||u.hash)
   throw Error('Only explicit loopback multisport_mlb_test database is allowed');
 return {host:'127.0.0.1',port:Number(u.port),user:'postgres',password:decodeURIComponent(u.password),database:'multisport_mlb_test',connectionTimeoutMillis:5000};
}
