import {createClient} from '@supabase/supabase-js';
import {authReturnUrl} from '@/lib/account-setup';
export const runtime='nodejs';
export async function POST(request:Request){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 try{
  if(process.env.AUTH_INVITES_ENABLED!=='true')return reply({error:'Invitation email delivery is not enabled yet.'},503);
  const url=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_URL,key=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!secret)return reply({error:'Invitation email delivery is not configured.'},503);
  const redirectTo=authReturnUrl(process.env.NEXT_PUBLIC_AUTH_SITE_URL);
  const token=request.headers.get('authorization');
  if(!token?.startsWith('Bearer '))return reply({error:'Commissioner sign-in required.'},401);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return reply({error:'Invalid request origin.'},403);
  const body=await request.text();if(body.length>2048)return reply({error:'Invalid invitation.'},400);
  const {request_id,owner_id,email,confirmed}=JSON.parse(body);
  if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||![request_id,owner_id].every(x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x))||confirmed!==true)return reply({error:'Confirm the owner and email first.'},400);
  const caller=createClient(url,key,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:authError}=await caller.auth.getUser(token.slice(7));
  if(authError||!user.user)return reply({error:'Commissioner sign-in required.'},401);
  const {data:invite,error}=await caller.rpc('prepare_owner_invitation',{req:request_id,owner:owner_id,address:email,confirmed:true});
  if(error)return reply({error:error.code==='42501'?'Commissioner access required.':'Invitation rejected. Check existing links, pending invitations, and the email. Wait a minute if you sent several invitations.'},409);
  if(!invite.created)return reply({message:`Invitation already recorded. Delivery status: ${invite.delivery}. No duplicate email was sent.`});
  if(invite.existing_account)return reply({message:'This email already has an account. Approval saved: ask the owner to sign in and open Create an Account to accept their owner invitation.'});
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  let sent=false;
  try{const result=await admin.auth.admin.inviteUserByEmail(invite.email,{redirectTo});sent=!result.error;}catch{/* Unknown delivery is never automatically resent. */}
  const {error:recordError}=await caller.rpc('owner_invitation_delivery',{invitation:invite.id,sent});
  return reply({message:sent&&!recordError?'Invitation email sent. Ask the owner to check their inbox and spam folder.':'Invitation recorded, but email delivery could not be confirmed. Check Supabase Auth before resending; retrying this request will not send duplicate mail.'});
 }catch{return reply({error:'Unable to confirm the invitation. Refresh invitation history before trying another request.'},500);}
}
