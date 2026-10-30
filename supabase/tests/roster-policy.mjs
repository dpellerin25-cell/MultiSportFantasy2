import {readFileSync} from 'node:fs';
export const POLICY=JSON.parse(readFileSync(new URL('../../web/data/roster-policy.json',import.meta.url),'utf8'));
export const ROSTER_LIMIT=POLICY.roster_limit;
export const STARTUP_ROUNDS=POLICY.startup_rounds;
