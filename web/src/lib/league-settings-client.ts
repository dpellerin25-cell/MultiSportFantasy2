import {createClient, type SupabaseClient} from '@supabase/supabase-js';
let client: SupabaseClient | null = null;
const url=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY;
export const leagueSettingsConfigured=url==='https://tgvuntuhdqucazpoxrrg.supabase.co'&&!!key?.startsWith('sb_publishable_');
export function leagueSettingsClient() {
 if(!leagueSettingsConfigured)return null;
 return client??=createClient(url!,key!,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'multisport-draft-test-auth'}});
}
