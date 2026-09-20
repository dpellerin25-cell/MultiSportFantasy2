import assert from "node:assert/strict";
import test from "node:test";
import { applyTransfer, buildRookiePicks, DRAFT_OWNERS, getDraftYears, parseLedger, validateTransfer } from "../src/lib/rookieDraft.ts";

const empty = { version: 1, trades: [] };
const years = [2027, 2028];
const trade = { year: 2027, round: 1, originalOwner: "Doug", from: "Doug", to: "Chris" };

test("each owner begins with ten distinct picks per year, for only two years", () => {
  const picks = buildRookiePicks(empty, years);
  assert.equal(picks.length, 180);
  assert.equal(new Set(picks.map((pick) => pick.id)).size, 180);
  for (const owner of DRAFT_OWNERS) for (const year of years) {
    assert.deepEqual(picks.filter((pick) => pick.owner === owner && pick.year === year).map((pick) => pick.round), [1,2,3,4,5,6,7,8,9,10]);
  }
});

test("a pick can be traded repeatedly without duplication or losing its origin", () => {
  let ledger = applyTransfer(empty, trade, "one", "2026-09-20T12:00:00Z", years);
  ledger = applyTransfer(ledger, { ...trade, from: "Chris", to: "Jack" }, "two", "2026-09-20T13:00:00Z", years);
  const picks = buildRookiePicks(ledger, years);
  assert.equal(picks.length, 180);
  assert.equal(picks.find((pick) => pick.id === "2027:1:Doug").owner, "Jack");
  assert.equal(picks.filter((pick) => pick.owner === "Jack" && pick.year === 2027).length, 11);
  assert.equal(picks.filter((pick) => pick.owner === "Doug" && pick.year === 2027).length, 9);
  assert.equal(ledger.trades.length, 2);
  assert.deepEqual(parseLedger(JSON.parse(JSON.stringify(ledger))), ledger);
});

test("invalid and stale transfers cannot change ownership", () => {
  for (const invalid of [null, {}, { ...trade, round: 0 }, { ...trade, round: 11 }, { ...trade, round: 1.5 }, { ...trade, year: 2029 }, { ...trade, to: "Unknown" }, { ...trade, to: "Doug" }]) {
    assert.throws(() => validateTransfer(invalid, years));
  }
  const ledger = applyTransfer(empty, trade, "one", "2026-09-20T12:00:00Z", years);
  assert.throws(() => applyTransfer(ledger, trade, "two", "2026-09-20T13:00:00Z", years), /changed owners/);
  assert.equal(ledger.trades.length, 1);
});

test("year rollover hides old picks and preserves future traded picks", () => {
  assert.deepEqual(getDraftYears(new Date("2026-12-31T23:59:59Z")), [2027, 2028]);
  const nextYears = getDraftYears(new Date("2027-01-01T00:00:00Z"));
  assert.deepEqual(nextYears, [2028, 2029]);
  const ledger = applyTransfer(empty, { ...trade, year: 2028 }, "one", "2026-09-20T12:00:00Z", years);
  const picks = buildRookiePicks(ledger, nextYears);
  assert.equal(picks.some((pick) => pick.year === 2027), false);
  assert.equal(picks.find((pick) => pick.id === "2028:1:Doug").owner, "Chris");
  assert.equal(picks.filter((pick) => pick.year === 2029 && pick.owner === "Doug").length, 10);
});

test("corrupt history is rejected instead of resetting ownership", () => {
  assert.throws(() => parseLedger({ version: 2, trades: [] }));
  assert.throws(() => parseLedger({ version: 1, trades: [{ ...trade, from: "Chris", id: "one", tradedAt: "2026-09-20T12:00:00Z" }] }));
});
