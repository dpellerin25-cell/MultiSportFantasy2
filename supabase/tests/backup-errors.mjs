// Fixed classifications only: never echo stderr, SQL, rows or connection strings.
export function backupFailureCode(error){
 const text=String(error?.stderr??'');
 for(const code of ['SCHEMA_EXISTS','ROLE_EXISTS','SNAPSHOT_INVALID','AUTH_FAILED','CONNECTION_FAILED','CLIENT_VERSION','PERMISSION_DENIED','FILE_ACCESS','COPY_FAILED']){
  if(text.includes(`BACKUP_CODE:${code}`))return code;
 }
 if(/schema .* already exists/i.test(text))return 'SCHEMA_EXISTS';
 if(/role .* already exists/i.test(text))return 'ROLE_EXISTS';
 if(/invalid snapshot|snapshot.*does not exist/i.test(text))return 'SNAPSHOT_INVALID';
 if(/password authentication failed/i.test(text))return 'AUTH_FAILED';
 if(/connection refused|could not connect|connection .* failed/i.test(text))return 'CONNECTION_FAILED';
 if(/server version mismatch|aborting because of server version/i.test(text))return 'CLIENT_VERSION';
 if(/permission denied/i.test(text))return 'PERMISSION_DENIED';
 if(/no such file|could not open .*file/i.test(text))return 'FILE_ACCESS';
 if(typeof error?.code==='string'&&/^[0-9A-Z_]{2,35}$/.test(error.code))return error.code;
 return 'UNCLASSIFIED';
}
