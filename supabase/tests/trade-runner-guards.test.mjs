import assert from 'node:assert/strict';
import {localTradeTestConfig} from './trade-test-config.mjs';
// All must reject before connecting, irrespective of other PG/Supabase settings.
for(const value of ['', 'not-a-uri', 'postgresql://test:fake@remote.invalid/example_trade_test',
  'postgresql://test:fake@127.0.0.1/postgres',
  'postgresql://test:fake@127.0.0.1/example_trade_test?host=remote.invalid',
  'postgresql://test@127.0.0.1/example_trade_test']){
  assert.throws(()=>localTradeTestConfig(value),/Set LOCAL_TRADE_TEST_DB_URL|Only a local disposable/);
}
const local='postgresql://test:fake@127.0.0.1:55433/example_trade_test';
assert.equal(localTradeTestConfig(local).connectionString,local);
console.log('PASS trade runner refuses missing/malformed, remote, non-test, override and missing-credential URLs before connecting');
