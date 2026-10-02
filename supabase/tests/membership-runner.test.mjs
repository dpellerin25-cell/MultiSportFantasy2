import assert from 'node:assert/strict';
import {membershipTestConfig} from './membership-test-config.mjs';
for(const value of [undefined,'bad','postgresql://postgres:fake@db.example.com:5432/multisport_membership_test','postgresql://postgres:fake@localhost:5432/postgres','postgresql://postgres:fake@localhost:5432/multisport_membership_test?host=remote','postgresql://postgres@localhost:5432/multisport_membership_test'])assert.throws(()=>membershipTestConfig(value));
assert.ok(membershipTestConfig('postgresql://postgres:fake@127.0.0.1:5432/multisport_membership_test'));
console.log('PASS membership runner rejects remote, ordinary, missing-credential and override database URLs');
