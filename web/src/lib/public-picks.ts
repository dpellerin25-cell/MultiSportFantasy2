export type PublicPicks = {
  years: number[];
  ledger_ready: boolean;
  owners: { id: string; name: string; slug: string }[];
  picks: { id: string; year: number; round: number; owner_id: string; original_owner_id: string }[];
};

export async function loadPublicPicks(url: string | undefined, key: string | undefined, fetcher: typeof fetch = fetch): Promise<PublicPicks> {
  if (url !== "https://tgvuntuhdqucazpoxrrg.supabase.co" || !key?.startsWith("sb_publishable_")) throw new Error("Pick connection unavailable");
  const response = await fetcher(`${url}/rest/v1/rpc/rookie_pick_ownership`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
    body: "{}", cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Pick catalogue unavailable");
  const data = await response.json();
  if (!data || typeof data.ledger_ready !== "boolean" || !Array.isArray(data.years) || data.years.length !== 2 || !Array.isArray(data.owners) || !Array.isArray(data.picks)) throw new Error("Invalid pick catalogue");
  return data;
}
