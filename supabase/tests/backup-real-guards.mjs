import assert from 'node:assert/strict';
export const RESTORE_IMAGE='supabase/postgres:17.6.1.136';
// Verified by the commissioner's read-only source query for the legacy backup.
export const VERIFIED_LEGACY_LOCALE={provider:'i',collation:'en_US.UTF-8',ctype:'en_US.UTF-8',locale:'en-US',version:'153.121'};
export const localeQuery=`select datlocprovider as provider,datcollate as collation,datctype as ctype,datlocale as locale,datcollversion as version from pg_database where datname=$1`;
export function restoreDatabaseSql(locale){
 assert.equal(locale.provider,'i','This restore runner requires the verified ICU provider');
 for(const k of ['collation','ctype','locale'])assert.ok(typeof locale[k]==='string'&&locale[k].length>0&&locale[k].length<128);
 const literal=s=>"'"+s.replaceAll("'","''")+"'";
 return `create database pentagon_restore_real template template0 encoding 'UTF8' locale_provider icu lc_collate ${literal(locale.collation)} lc_ctype ${literal(locale.ctype)} icu_locale ${literal(locale.locale)}`;
}
export function verifyLocale(expected,actual){
 if(['provider','collation','ctype','locale','version'].some(k=>expected[k]!==actual[k])){
  const e=Error('Restore locale differs from source');e.code='RESTORE_LOCALE_MISMATCH';throw e;
 }
}
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
