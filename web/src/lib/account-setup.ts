export const resetNotice="If an account exists for this email, a reset link has been requested. Check your inbox and spam folder.";
export function authReturnUrl(site:string|undefined){
 if(!site)throw Error('Account email links are not configured. Contact Doug.');
 const u=new URL(site);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('Invalid account email configuration.');
 return u.origin+'/auth/complete';
}
export function validateNewPassword(password:string,confirmation:string){
 if(password.length<12)throw Error('Use at least 12 characters for your password.');
 if(password!==confirmation)throw Error('The passwords do not match.');
}
export type EmailLink={type:'invite'|'recovery';token_hash:string}|{type:'invite'|'recovery';access_token:string;refresh_token:string};
export function parseEmailLink(url:string):EmailLink{
 const u=new URL(url),fragment=new URLSearchParams(u.hash.slice(1));
 const type=u.searchParams.get('type')||fragment.get('type');
 if(type!=='invite'&&type!=='recovery')throw Error('This link is invalid or expired. Request a new email.');
 const token=u.searchParams.get('token_hash');
 if(token&&token.length<=1024)return {type,token_hash:token};
 const access=fragment.get('access_token'),refresh=fragment.get('refresh_token');
 if(access&&refresh&&access.length<=16384&&refresh.length<=4096)return {type,access_token:access,refresh_token:refresh};
 throw Error('This link is invalid or expired. Request a new email.');
}
