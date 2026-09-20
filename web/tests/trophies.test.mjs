import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Compile the real pure scoring/trophy modules in memory; fixtures never enter web/data.
function loadModule(filename, imports = {}) {
  const source = readFileSync(new URL(filename, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(imports[name], `Unexpected dependency: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

const scoring = loadModule("../src/lib/scoring.ts");
const { deriveTrophyCase } = loadModule("../src/lib/trophies.ts", { "./scoring": scoring });
const sports = ["NFL", "MLB", "NBA", "EPL", "PGA"];
const owners = Array.from({ length: 9 }, (_, index) => `Test Owner ${index + 1}`);
const season = (year = 2027, status = "final") => ({
  year, name: `${year} Championship`, sports: sports.map((sport) => ({ sport, label: sport, status })),
});
const archive = (sport) => ({
  sport: sport === "EPL" ? "Premier League" : sport,
  standings: owners.map((team, index) => ({
    team, team_id: `${sport}-${index}`, rank: String(index + 1), fantasyPoints: String(90 - index * 10),
  })),
});

test("live and upcoming seasons award nothing and never load archives", () => {
  const result = deriveTrophyCase([season(2027, "live"), season(2028, "upcoming")], () => { throw new Error("Must not load"); }, owners);
  assert.equal(result.totalTrophies, 0);
  assert.equal(result.history.length, 0);
  assert.equal(result.owners.length, 9);
  assert.ok(result.owners.every((owner) => owner.total === 0));
});

test("one finalized sport awards only that sport", () => {
  const config = season(2027, "live");
  config.sports[0].status = "final";
  let calls = 0;
  const result = deriveTrophyCase([config], (_, sport) => { calls++; return archive(sport); }, owners);
  assert.equal(calls, 1);
  assert.equal(result.totalTrophies, 1);
  assert.equal(result.owners[0].counts.NFL, 1);
  assert.equal(result.owners[0].counts.Overall, 0);
});

test("complete final season awards six titles with the existing unrounded scoring formula", () => {
  const result = deriveTrophyCase([season()], (_, sport) => archive(sport), owners);
  assert.equal(result.totalTrophies, 6);
  assert.equal(result.owners[0].owner, owners[0]);
  assert.equal(result.owners[0].total, 6);
  const expected = 5 * (100 + 10 * (40 / Math.sqrt(6000 / 9)));
  assert.ok(Math.abs(result.history[0].championships[0].score - expected) < 1e-9);
});

test("sport titles follow archived rank, not the derived sport score", () => {
  const config = season(2027, "live");
  config.sports[0].status = "final";
  const data = archive("NFL");
  data.standings[1].fantasyPoints = "100000";
  const result = deriveTrophyCase([config], () => data, owners);
  assert.equal(result.history[0].championships[1].owner, owners[0]);
});

test("missing, malformed, partial, and wrong-sport archives do not fabricate champions", () => {
  for (const invalid of [null, {}, { ...archive("NFL"), standings: [] },
    { ...archive("NFL"), standings: archive("NFL").standings.slice(1) },
    { ...archive("NFL"), sport: "Other" },
    { ...archive("NFL"), standings: archive("NFL").standings.map((row) => ({ ...row, fantasyPoints: "NaN" })) }]) {
    const result = deriveTrophyCase([season()], () => invalid, owners);
    assert.equal(result.totalTrophies, 0);
    assert.ok(result.history[0].championships.every((item) => item.status === "unavailable"));
  }
  const missing = deriveTrophyCase([season()], () => { throw new Error("Missing archive"); }, owners);
  assert.equal(missing.totalTrophies, 0);
});

test("tied first place and tied overall scores are not broken alphabetically", () => {
  const result = deriveTrophyCase([season()], (_, sport) => ({
    ...archive(sport), standings: archive(sport).standings.map((row) => ({ ...row, rank: "1", fantasyPoints: "0" })),
  }), owners);
  assert.equal(result.totalTrophies, 0);
  assert.ok(result.history[0].championships.every((item) => item.status === "tied"));
});

test("inconsistent owner identities block the overall title", () => {
  const result = deriveTrophyCase([season()], (_, sport) => {
    const data = archive(sport);
    if (sport === "PGA") data.standings[8].team = "Different Owner";
    return data;
  }, owners);
  assert.equal(result.totalTrophies, 5);
  assert.equal(result.history[0].championships[0].status, "unavailable");
});

test("multiple seasons accumulate titles and history is newest first", () => {
  const result = deriveTrophyCase([season(2027), season(2028)], (_, sport) => archive(sport), owners);
  assert.equal(result.totalTrophies, 12);
  assert.equal(result.owners[0].counts.Overall, 2);
  assert.equal(result.owners[0].counts.EPL, 2);
  assert.equal(result.history[0].year, 2028);
  assert.equal(result.history[1].year, 2027);
});
