# Unrestricted startup allocation

League decision: owners may distribute all 80 startup selections freely across NFL, MLB, NBA, EPL and PGA. All five sport minimums are zero; no per-sport maximum applies. Proposed starting lineups are advisory.

Migration 202610040001_unrestricted_startup_sports.sql updates new startup defaults, startup validation and unfinished existing startup rules under draft-row locks. It increments revisions and records an audit event so connected clients refetch. Picks, selections, deadlines, completed/cancelled draft rules and historical trade warnings remain unchanged. Future accepted trades no longer generate minimum warnings. The website warns about projected rosters above 80, without blocking offers.

Other draft types can still explicitly configure rules. Old generic minimum-enforcement tests remain intentionally valid for those types.

Local validation: run the database test suite and web trade tests. The historical migration test unrestricted-startup.test.mjs deliberately retains its original nine-owner, 65-round fixture; current policy tests cover 80 rounds. See ../ROSTER_POLICY_80.md for current rollout instructions.

After committing/transferring tested files when authorized, link the TEST project tgvuntuhdqucazpoxrrg and inspect a Supabase migration dry run. Apply this migration to TEST before using the changed rules; the existing hosted database retains the old requirements until then. Recheck a startup draft and the owner UI before production.
