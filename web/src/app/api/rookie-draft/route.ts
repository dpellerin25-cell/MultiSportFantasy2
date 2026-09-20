import { buildRookiePicks, getDraftYears, validateTransfer, type DraftLedger } from "@/lib/rookieDraft";
import { canWriteDrafts, isCommissioner, readDraftLedger, saveDraftTransfer } from "@/lib/rookieDraftStore";

export const runtime = "nodejs";

function response(ledger: DraftLedger) {
  const years = getDraftYears();
  return Response.json({
    years,
    picks: buildRookiePicks(ledger, years),
    trades: ledger.trades.filter((trade) => years.includes(trade.year)),
    editingAvailable: canWriteDrafts(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (request.headers.has("authorization") && !isCommissioner(request)) {
    return Response.json({ error: "Incorrect commissioner password." }, { status: 401 });
  }
  try {
    return response(await readDraftLedger());
  } catch {
    return Response.json({ error: "Draft picks could not be loaded. Please try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isCommissioner(request)) {
    return Response.json({ error: "Commissioner access is required." }, { status: 401 });
  }
  const origin = request.headers.get("origin");
  const expectedOrigin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (origin !== expectedOrigin) {
    return Response.json({ error: "Please save trades from this website." }, { status: 403 });
  }
  if (!canWriteDrafts()) {
    return Response.json({ error: "Commissioner editing is not configured on this server." }, { status: 503 });
  }
  let input;
  try {
    input = validateTransfer(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid transfer." }, { status: 400 });
  }
  try {
    return response(await saveDraftTransfer(input));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" ||
        (error instanceof Error && error.message.startsWith("This pick has changed"))) {
      return Response.json({ error: "The picks changed or another trade is saving. Refresh picks and try again." }, { status: 409 });
    }
    return Response.json({ error: "The trade could not be saved. No successful transfer was confirmed; refresh picks before retrying." }, { status: 500 });
  }
}
