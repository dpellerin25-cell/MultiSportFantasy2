import { loadPublicPicks } from "@/lib/public-picks";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try {
    const data = await loadPublicPicks(process.env.NEXT_PUBLIC_DRAFT_SUPABASE_URL, process.env.NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY);
    return Response.json(data, { headers });
  } catch {
    return Response.json({ error: "Draft pick ownership is temporarily unavailable. Please refresh." }, { status: 503, headers });
  }
}
// Retired permanently: the old shared password cannot mutate ownership.
export async function POST() {
  return Response.json({ error: "File-based pick editing has been retired. Use authenticated Supabase trade controls." }, { status: 410, headers });
}
