import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {rosterSyncFailureReason} from './roster-sync-errors.mjs';

test('known roster validation failures have specific safe advice', () => {
  for(const message of ['Complete active-owner snapshot required','Retired league connection',
    'League sport mapping changed','Stale or conflicting snapshot','Invalid snapshot owner',
    'Invalid or duplicate player','All five roster snapshots required','Exactly one snapshot per sport required']) {
    const result=rosterSyncFailureReason({code:'P0001',message,detail:'PRIVATE',where:'PRIVATE',query:'PRIVATE'});
    assert.ok(result.includes(message));
    assert.ok(!result.includes('PRIVATE'));
  }
});

test('unknown or embellished database text never leaks', () => {
  for(const message of ['postgresql://secret:password@host','Retired league connection\nPRIVATE','Invalid snapshot owner: PRIVATE']) {
    const result=rosterSyncFailureReason({code:'P0001',message});
    assert.match(result,/unrecognized database validation/);
    assert.ok(!result.includes(message));
  }
  assert.equal(rosterSyncFailureReason(new Error('PRIVATE')),null);
  assert.equal(rosterSyncFailureReason(null),null);
});

test('constraint and timeout codes expose only fixed advice', () => {
  for(const code of ['23505','23503','23514','55P03','57014']) {
    const result=rosterSyncFailureReason({code,message:'PRIVATE',detail:'PRIVATE'});
    assert.ok(result && !result.includes('PRIVATE'));
  }
  assert.equal(rosterSyncFailureReason({code:'UNKNOWN',message:'PRIVATE'}),null);
});

test('scheduled runner prints safe reason before existing failure summary', () => {
  const runner=readFileSync(new URL('./sync-trade-rosters.mjs',import.meta.url),'utf8');
  assert.match(runner,/rosterSyncFailureReason\(error\)/);
  assert.ok(runner.indexOf("console.error('Import issue: '")<runner.indexOf('Trade roster sync failed'));
});
