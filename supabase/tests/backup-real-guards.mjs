import assert from 'node:assert/strict';
export const RESTORE_IMAGE='supabase/postgres:17.6.1.136';
export function checkCompatibility(bundle,version,available){
 assert.equal(String(bundle.server_version).split('.')[0],String(version).split('.')[0],'PostgreSQL major version mismatch');
 const missing=bundle.extensions.filter(e=>!available.some(a=>a.name===e.extname&&a.version===e.extversion));
 if(missing.length){const error=Error('Required extension versions unavailable');error.code='EXTENSION_VERSION_MISSING';throw error;}
}
export const bootstrap=`set -eu
umask 077
mkdir -p /tmp/rehearsal-data
printf '%s' "$POSTGRES_PASSWORD" > /tmp/rehearsal-password
initdb -D /tmp/rehearsal-data -U postgres --auth=scram-sha-256 --pwfile=/tmp/rehearsal-password --encoding=UTF8 --locale=C >/dev/null
rm /tmp/rehearsal-password
exec postgres -D /tmp/rehearsal-data -c listen_addresses='' -c unix_socket_directories=/restore-socket -c shared_preload_libraries=pg_cron,pg_stat_statements -c cron.database_name=pentagon_restore_real -c cron.launch_active_jobs=off -c logging_collector=off -c log_statement=none -c log_min_error_statement=panic
`;
