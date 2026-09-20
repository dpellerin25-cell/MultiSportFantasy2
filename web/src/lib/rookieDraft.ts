export const DRAFT_OWNERS = [
  "Brendan", "Chris", "Doug", "Hatch", "Jack", "Jacob", "Nik", "Ryan", "Tucker",
] as const;

export type DraftTrade = {
  id: string;
  year: number;
  round: number;
  originalOwner: string;
  from: string;
  to: string;
  tradedAt: string;
};

export type DraftLedger = { version: 1; trades: DraftTrade[] };
export type RookiePick = {
  id: string;
  year: number;
  round: number;
  originalOwner: string;
  owner: string;
};
export type TransferInput = Omit<DraftTrade, "id" | "tradedAt">;

export function getDraftYears(now = new Date()): number[] {
  const nextYear = now.getUTCFullYear() + 1;
  return [nextYear, nextYear + 1];
}

export function pickId(year: number, round: number, owner: string) {
  return `${year}:${round}:${owner}`;
}

export function buildRookiePicks(ledger: DraftLedger, years = getDraftYears()): RookiePick[] {
  const picks = years.flatMap((year) =>
    Array.from({ length: 10 }, (_, index) =>
      DRAFT_OWNERS.map((originalOwner) => ({
        id: pickId(year, index + 1, originalOwner),
        year,
        round: index + 1,
        originalOwner,
        owner: originalOwner as string,
      }))
    ).flat()
  );
  const byId = new Map(picks.map((pick) => [pick.id, pick]));
  for (const trade of ledger.trades) {
    const pick = byId.get(pickId(trade.year, trade.round, trade.originalOwner));
    if (pick) pick.owner = trade.to;
  }
  return picks;
}

export function validateTransfer(value: unknown, years = getDraftYears()): TransferInput {
  if (!value || typeof value !== "object") throw new Error("Choose a pick and its new owner.");
  const input = value as Partial<TransferInput>;
  const isOwner = (owner: unknown): owner is string =>
    typeof owner === "string" && DRAFT_OWNERS.some((name) => name === owner);
  if (!Number.isInteger(input.year) || !years.includes(input.year!)) {
    throw new Error("Only picks in the next two draft years can be traded.");
  }
  if (!Number.isInteger(input.round) || input.round! < 1 || input.round! > 10) {
    throw new Error("The round must be between 1 and 10.");
  }
  if (!isOwner(input.originalOwner) || !isOwner(input.from) || !isOwner(input.to)) {
    throw new Error("Choose a valid league owner.");
  }
  if (input.from === input.to) throw new Error("Choose a different owner.");
  return input as TransferInput;
}

export function applyTransfer(
  ledger: DraftLedger,
  input: TransferInput,
  id: string,
  tradedAt: string,
  years = getDraftYears()
): DraftLedger {
  validateTransfer(input, years);
  const pick = buildRookiePicks(ledger, years).find(
    (entry) => entry.id === pickId(input.year, input.round, input.originalOwner)
  );
  if (!pick || pick.owner !== input.from) {
    throw new Error("This pick has changed owners. Refresh the picks before trying again.");
  }
  return { version: 1, trades: [...ledger.trades, { ...input, id, tradedAt }] };
}

export function parseLedger(value: unknown): DraftLedger {
  if (!value || typeof value !== "object") throw new Error("Invalid draft ledger.");
  const ledger = value as DraftLedger;
  if (ledger.version !== 1 || !Array.isArray(ledger.trades)) throw new Error("Invalid draft ledger.");
  // Replay each year's history to reject corrupt or contradictory ownership records.
  let checked: DraftLedger = { version: 1, trades: [] };
  const ids = new Set<string>();
  for (const trade of ledger.trades) {
    if (!trade || !Number.isInteger(trade.year) || trade.year < 2027 ||
        typeof trade.id !== "string" || !trade.id || ids.has(trade.id) ||
        typeof trade.tradedAt !== "string" || !Number.isFinite(Date.parse(trade.tradedAt))) {
      throw new Error("Invalid draft trade history.");
    }
    const input = validateTransfer(trade, [trade.year]);
    checked = applyTransfer(checked, input, trade.id, trade.tradedAt, [trade.year]);
    ids.add(trade.id);
  }
  return checked;
}
