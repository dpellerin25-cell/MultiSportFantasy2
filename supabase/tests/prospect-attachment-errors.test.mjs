import assert from 'node:assert/strict';
import {prospectAttachmentIssue as explain} from './prospect-attachment-errors.mjs';
for(const message of ['Draft not found','Preview changed; run preview again','Review possible Fantrax duplicate for catalogue startup-2027-066 before attachment','Prospect is already owned: startup-2027-001'])assert.equal(explain({message}),message);
for(const message of ['postgresql://postgres:secret@example/db','Review possible Fantrax duplicate for catalogue secret before attachment','Prospect is already owned: startup-2027-001\nsecret'])assert.ok(!explain({message}).includes('secret'));
console.log('PASS known prospect validation details and unexpected-error redaction');
