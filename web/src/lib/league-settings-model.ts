export type Member = {slug:string;name:string;active?:boolean};
export type SettingsState = {version:string;season:{championship_year:number;owner_slugs:string[];placement_points:number[]};owners:Member[]};
export type SettingsInput = {year_value:number;members:Member[];points:number[]};
export type SettingsPreview = {token:string;can_apply:boolean;blockers:string[];added:string[];removed:string[];owner_count:number;startup_picks:number;rookie_picks_per_year:number};
export function settingsInput(year:number,members:Member[],points:string[]):SettingsInput {
 if(members.length<2)throw Error('Keep at least two owners.');
 if(new Set(members.map(m=>m.slug)).size!==members.length||members.some(m=>!/^[a-z][a-z0-9_-]*$/.test(m.slug)||!m.name.trim()))throw Error('Each owner needs a unique permanent ID and a name.');
 if(new Set(members.map(m=>m.name.trim())).size!==members.length)throw Error('Owner names must be unique.');
 if(points.length!==members.length||points.some(p=>!p.trim()||!Number.isFinite(Number(p))||Number(p)<0))throw Error('Enter one nonnegative point value per finishing position.');
 const numbers=points.map(Number);
 if(numbers.some((n,i)=>i>0&&n>=numbers[i-1]))throw Error('Placement points must decrease with each finishing position.');
 return {year_value:year,members:members.map(m=>({slug:m.slug,name:m.name.trim()})),points:numbers};
}
export function settingsRequest(input:SettingsInput,preview:SettingsPreview,confirmed:boolean,id:string){
 if(!confirmed||!preview.can_apply)throw Error('Review an unblocked preview and confirm before applying.');
 return {...input,request_id:id,preview_token:preview.token};
}
