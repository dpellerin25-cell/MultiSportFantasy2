export function membershipTestConfig(raw) {
 let u;try {u=new URL(raw);}catch {throw Error('A local disposable membership test database is required');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname!=='/multisport_membership_test'||!u.username||!u.password||!u.port||u.search||u.hash)
   throw Error('Only an explicit local multisport_membership_test database is allowed');
 return {connectionString:raw,connectionTimeoutMillis:5000};
}
