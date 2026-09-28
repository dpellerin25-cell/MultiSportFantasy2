# Draft rehearsal interface

This adds the round-by-round draft board, every owner's draft roster and sport minimum progress, and commissioner controls to `/draft`. It uses the existing authenticated RPCs and revision subscription. No migrations, new dependencies, new environment variables, or production configuration are required.

Commissioner controls include start, pause, resume, future-turn timer, pre-start order, assignment to the current or skipped pick, and undo of the latest active selection. All commands use the displayed revision and a unique request ID; uncertain network responses retain that exact request for retry. The database remains the authority for permissions, turn ownership, minimum feasibility and duplicate prevention. Changing a timer does not change the current turn's deadline. Undo leaves an unfilled makeup slot and does not rewind the draft.

## Transfer and run

Transfer the reviewed changes to GitHub and pull them into Codespaces using your normal workflow. Restart the website with the existing test-project environment settings. No Supabase migration or player import is needed for this interface update. Do not commit `web/.env.local`.

## Two-account rehearsal

Use only the configured test project. Starting and making picks will persist in that test draft; these are not rollback simulations. No draft was started as part of implementing this interface.

1. Open `/draft` in a normal browser and sign in as Doug. Open the same page in a separate browser or private browsing session and sign in as Chris. Two ordinary tabs share sign-in storage and do not represent two accounts.
2. Confirm each page identifies the correct owner. Only Doug should see Commissioner Controls.
3. Before starting, Doug opens Round-one owner order. Put Doug first and Chris second, with each of the other seven owners appearing exactly once. Save and confirm. Use a comfortable timer such as 300 seconds for the first checks.
4. Doug starts the test draft. Both pages should show Doug on the clock and 585 slots across 65 rounds. Chris cannot select a player during Doug's turn.
5. Doug selects and confirms a player. Check both pages: the player disappears from availability, appears on the board and Doug's roster, updates the sport count, and Chris is now on the clock.
6. Chris makes a selection. Check the same results on both pages. Doug pauses promptly so later owners' clocks do not expire while inspecting results.
7. While paused, refresh Chris's page. Picks and roster counts should survive. Doug can review either owner's roster using the roster dropdown; this never changes the signed-in identity.
8. Test undo while paused: choose the selection most recently made, enter a reason, and confirm. The player should become available on both pages and that slot becomes unfilled. Use Assign current or skipped pick to search for a player and fill that skipped slot. Verify the current turn did not advance.
9. Test the timer: resume and allow a turn to expire (or set a shorter future timer and advance to a new turn). Expiry can take a few seconds after zero because the database worker runs every five seconds. Pause after the skip, then assign a player to the skipped slot. Confirm the following turn and its saved remaining time are preserved.
10. Leave the rehearsal paused when finished.

Changing the order is supported only before starting. This interface does not create, reset, cancel or delete drafts. For another clean rehearsal after starting, use a separately prepared test draft instead of altering database rows manually.

## Local validation

From `web`, run `node tests/draft.test.mjs`, the project lint/type checks and the production build. The frontend tests cover configuration, owner-turn affordances, request identity/revision preservation, commissioner envelopes, roster counting and mocked authenticated RPC transport. The existing `supabase/tests` offline suite covers database behavior. A real two-browser UI rehearsal remains a separate hosted validation step.
