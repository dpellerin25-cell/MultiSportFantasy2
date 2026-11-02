import test from 'node:test';
import assert from 'node:assert/strict';
import {authReturnUrl,validateNewPassword,parseEmailLink,resetNotice} from '../src/lib/account-setup.ts';
test('fixed email redirect rejects insecure and credential-bearing URLs',()=>{
 assert.equal(authReturnUrl('https://multisportfantasy.com'),'https://multisportfantasy.com/auth/complete');
 assert.equal(authReturnUrl('http://localhost:3000'),'http://localhost:3000/auth/complete');
 for(const url of [undefined,'http://evil.test','https://user:pass@example.test','https://example.test/?next=evil','https://example.test/redirect'])assert.throws(()=>authReturnUrl(url));
});
test('only invite/recovery tokens accepted, including existing implicit email links',()=>{
 assert.deepEqual(parseEmailLink('https://example.test/auth/complete?type=invite&token_hash=abc'),{type:'invite',token_hash:'abc'});
 assert.deepEqual(parseEmailLink('https://example.test/auth/complete#type=recovery&access_token=abc&refresh_token=def'),{type:'recovery',access_token:'abc',refresh_token:'def'});
 for(const url of ['https://example.test','https://example.test/?type=signup&token_hash=abc','https://example.test/#type=recovery&access_token=abc'])assert.throws(()=>parseEmailLink(url));
});
test('password confirmation and non-enumerating reset wording',()=>{
 assert.throws(()=>validateNewPassword('short','short'));assert.throws(()=>validateNewPassword('LongPasswordExample','different'));
 assert.doesNotThrow(()=>validateNewPassword('LongPasswordExample','LongPasswordExample'));
 assert.match(resetNotice,/If an account exists/);assert.match(resetNotice,/spam/);
});
