begin;
create table draft.account_invitations (
 id uuid primary key, owner_id uuid not null references draft.owners,
 email text not null, created_by uuid not null references auth.users,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 revoked_at timestamptz, accepted_at timestamptz, accepted_by uuid references auth.users,
 delivery text not null default 'pending' check(delivery in ('pending','sent','unknown','existing_account'))
);
create unique index pending_invite_owner on draft.account_invitations(owner_id) where revoked_at is null and accepted_at is null;
create unique index pending_invite_email on draft.account_invitations(email) where revoked_at is null and accepted_at is null;
create table draft.account_invitation_events (
 id bigint generated always as identity primary key, invitation_id uuid not null references draft.account_invitations,
 actor_id uuid not null references auth.users, action text not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table draft.account_invitations enable row level security;
alter table draft.account_invitation_events enable row level security;
revoke all on draft.account_invitations,draft.account_invitation_events from public,anon,authenticated;
create trigger immutable before update or delete on draft.account_invitation_events for each row execute function trading.immutable_history();

create function public.owner_invitation_state() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform draft.require_commissioner();
 return jsonb_build_object('owners',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.display_name,'linked',a.auth_user_id is not null) order by o.display_name),'[]') from draft.owners o left join draft.owner_accounts a on a.owner_id=o.id where o.active),
 'invitations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from (
 select i.id,o.display_name owner,i.email,i.expires_at,i.created_at,i.revoked_at,i.accepted_at,i.delivery
 from draft.account_invitations i join draft.owners o on o.id=i.owner_id order by i.created_at desc limit 100) x));
end $$;
create function public.prepare_owner_invitation(req uuid,owner uuid,address text,confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior draft.account_invitations; normalized text=lower(trim(address)); existing boolean;
begin
 perform draft.require_commissioner();perform pg_advisory_xact_lock(731945,1);
 if req is null or confirmed is distinct from true or normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Confirm a valid owner and email'; end if;
 select * into prior from draft.account_invitations where id=req;
 if found then
  if prior.owner_id<>owner or prior.email<>normalized or prior.created_by<>auth.uid() then raise exception 'Conflicting invitation retry'; end if;
  return jsonb_build_object('id',req,'created',false,'delivery',prior.delivery);
 end if;
 if not exists(select 1 from draft.owners where id=owner and active) or exists(select 1 from draft.owner_accounts where owner_id=owner) then raise exception 'Owner unavailable or already linked'; end if;
 if exists(select 1 from auth.users u join draft.owner_accounts a on a.auth_user_id=u.id where lower(to_jsonb(u)->>'email')=normalized) then raise exception 'Email already linked to an owner'; end if;
 if exists(select 1 from draft.account_invitations where (owner_id=owner or email=normalized) and revoked_at is null and accepted_at is null) then raise exception 'Revoke the existing pending invitation first'; end if;
 if (select count(*) from draft.account_invitations where created_by=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=5 then raise exception 'Please wait before sending more invitations'; end if;
 existing=exists(select 1 from auth.users u where lower(to_jsonb(u)->>'email')=normalized);
 insert into draft.account_invitations(id,owner_id,email,created_by,delivery) values(req,owner,normalized,auth.uid(),case when existing then 'existing_account' else 'pending' end);
 insert into draft.account_invitation_events(invitation_id,actor_id,action) values(req,auth.uid(),'approved');
 return jsonb_build_object('id',req,'created',true,'email',normalized,'existing_account',existing);
end $$;
create function public.owner_invitation_delivery(invitation uuid,sent boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform draft.require_commissioner();perform pg_advisory_xact_lock(731945,1);
 update draft.account_invitations set delivery=case when sent then 'sent' else 'unknown' end where id=invitation and delivery='pending';
 if found then insert into draft.account_invitation_events(invitation_id,actor_id,action) values(invitation,auth.uid(),case when sent then 'email_sent' else 'email_unconfirmed' end); end if;
end $$;
create function public.revoke_owner_invitation(invitation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform draft.require_commissioner();perform pg_advisory_xact_lock(731945,1);
 update draft.account_invitations set revoked_at=clock_timestamp() where id=invitation and revoked_at is null and accepted_at is null;
 if found then insert into draft.account_invitation_events(invitation_id,actor_id,action) values(invitation,auth.uid(),'revoked'); end if;
end $$;
create function public.my_owner_invitation() returns jsonb language plpgsql security definer set search_path='' as $$
declare email_value text; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select lower(to_jsonb(u)->>'email') into email_value from auth.users u where u.id=auth.uid() and nullif(to_jsonb(u)->>'email_confirmed_at','') is not null;
 select jsonb_build_object('id',i.id,'owner',o.display_name) into result from draft.account_invitations i join draft.owners o on o.id=i.owner_id
 where i.email=email_value and i.revoked_at is null and i.accepted_at is null and i.expires_at>clock_timestamp() and o.active;
 return result;
end $$;
create function public.accept_owner_invitation(invitation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i draft.account_invitations; email_value text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(731943,1); -- serialize with membership changes
 perform pg_advisory_xact_lock(731945,1);
 select * into strict i from draft.account_invitations where id=invitation for update;
 select lower(to_jsonb(u)->>'email') into email_value from auth.users u where u.id=auth.uid() and nullif(to_jsonb(u)->>'email_confirmed_at','') is not null;
 if email_value is null or email_value<>i.email then raise exception 'Verified invited email required' using errcode='42501'; end if;
 if i.accepted_by=auth.uid() and exists(select 1 from draft.owner_accounts where auth_user_id=auth.uid() and owner_id=i.owner_id) then return jsonb_build_object('linked',true); end if;
 if i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=clock_timestamp() or not exists(select 1 from draft.owners where id=i.owner_id and active) then raise exception 'Invitation expired or unavailable'; end if;
 if exists(select 1 from draft.owner_accounts where owner_id=i.owner_id or auth_user_id=auth.uid()) then raise exception 'Account or owner is already linked'; end if;
 insert into draft.owner_accounts(auth_user_id,owner_id) values(auth.uid(),i.owner_id);
 update draft.account_invitations set accepted_at=clock_timestamp(),accepted_by=auth.uid() where id=invitation;
 insert into draft.account_invitation_events(invitation_id,actor_id,action) values(invitation,auth.uid(),'accepted');
 return jsonb_build_object('linked',true);
end $$;
revoke all on function public.owner_invitation_state(),public.prepare_owner_invitation(uuid,uuid,text,boolean),public.owner_invitation_delivery(uuid,boolean),public.revoke_owner_invitation(uuid),public.my_owner_invitation(),public.accept_owner_invitation(uuid) from public,anon,authenticated;
grant execute on function public.owner_invitation_state(),public.prepare_owner_invitation(uuid,uuid,text,boolean),public.owner_invitation_delivery(uuid,boolean),public.revoke_owner_invitation(uuid),public.my_owner_invitation(),public.accept_owner_invitation(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
