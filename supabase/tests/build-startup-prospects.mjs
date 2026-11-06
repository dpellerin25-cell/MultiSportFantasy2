// Reproducible migration from the supplied workbook transcription; no network.
import {readFile,writeFile} from 'node:fs/promises';
const catalogue=JSON.parse(await readFile(new URL('../../data/startup-prospects-2027.json',import.meta.url),'utf8'));
const quote=x=>"'"+x.replaceAll("'","''")+"'";
// Reconstruct original applied migration; later exclusions have their own migration.
const seed=[...catalogue.players,...(catalogue.excluded_players??[])].sort((a,b)=>a.catalog_id.localeCompare(b.catalog_id)).map(p=>`(${[p.catalog_id,p.name,p.sport,p.position,p.source_league,catalogue.sha256].map(quote).join(',')})`).join(',\n');
const base=await readFile(new URL('../migrations/202609290002_available_position_filter.sql',import.meta.url),'utf8');
let api=base.slice(base.indexOf('create or replace function'),base.indexOf("notify pgrst"));
api=api.replace("'EPL','PGA'))","'EPL','PGA','Prospects'))");
api=api.replaceAll('(sport_filter is null or p.sport::text=sport_filter)',"((sport_filter='Prospects' and p.prospect_catalog_id is not null) or (sport_filter is distinct from 'Prospects' and p.prospect_catalog_id is null and (sport_filter is null or p.sport::text=sport_filter)))");
api=api.replace('and p.identity_count=1','and p.identity_count=1 and p.prospect_catalog_id is null');
api=api.replace("'availability_status',availability,", "'availability_status',case when prospect_catalog_id is not null then 'prospect' else availability::text end,'is_prospect',prospect_catalog_id is not null,");
api+=`\ncreate or replace function public.draft_available_players(target uuid,sport_filter text default null,search_text text default '',after_player uuid default null,page_size integer default 50) returns jsonb language sql stable security definer set search_path='' as $$select public.draft_available_players(target,sport_filter,search_text,after_player,page_size,null)$$;\n`;
const body=await readFile(new URL('./startup-prospects-body.sql',import.meta.url),'utf8');
await writeFile(new URL('../migrations/202611060001_startup_prospect_pool.sql',import.meta.url),body.replace('-- CATALOGUE_ROWS',`insert into draft.prospect_catalog(id,name,sport,position,source_league,source_sha256) values\n${seed};`).replace('-- SEARCH_API',()=>api));

