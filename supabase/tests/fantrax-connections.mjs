import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export const CONNECTIONS=JSON.parse(readFileSync(process.env.FANTRAX_CONNECTIONS_FILE||new URL('../../scripts/fantrax-connections.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(CONNECTIONS.sports).sort(),['EPL','MLB','NBA','NFL','PGA']);
export const LEAGUES=Object.fromEntries(Object.entries(CONNECTIONS.sports).map(([s,v])=>[s,v.current_league_id]));
assert.equal(new Set(Object.values(LEAGUES)).size,5);
assert.ok(Object.values(LEAGUES).every(id=>/^[a-z0-9]{16}$/.test(id)&&!CONNECTIONS.excluded_league_ids.includes(id)));
export const ROSTER_FILES=Object.entries(CONNECTIONS.sports).map(([s,v])=>[s,v.filename,v.current_league_id]);
