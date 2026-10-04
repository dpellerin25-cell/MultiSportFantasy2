# Unrestricted startup allocation

League decision: owners may distribute all 65 startup selections freely across NFL, MLB, NBA, EPL and PGA. All five sport minimums are zero; no per-sport maximum applies. Proposed starting lineups are advisory.

Migration 202610040001_unrestricted_startup_sports.sql updates new startup defaults, startup validation and unfinished existing startup rules under draft-row locks. It increments revisions and records an audit event so connected clients refetch. Picks, selections, deadlines, completed/cancelled draft rules and historical trade warnings remain unchanged. Future accepted trades no longer generate minimum warnings. The website warns about projected rosters above 65, without blocking offers.

Other draft types can still explicitly configure rules. Old generic minimum-enforcement tests remain intentionally valid for those types.

Local validation: run the database test suite, including unrestricted-startup.test.mjs (nine owners complete all 65 selections in NFL), plus web trade tests. No hosted migration has been applied by this change.

After committing/transferring tested files when authorized, link the TEST project tgvuntuhdqucazpoxrrg and inspect a Supabase migration dry run. Apply this migration to TEST before using the changed rules; the existing hosted database retains the old requirements until then. Recheck a startup draft and the owner UI before production.
