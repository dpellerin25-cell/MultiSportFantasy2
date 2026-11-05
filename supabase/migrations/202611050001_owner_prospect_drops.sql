begin;
-- Owner drops share the roster-import/commissioner lock and immutable request ledger.
create function public.prospect_owner() returns uuid language sql stable security definer set search_path='' as $$
 select a.owner_id from draft.owner_accounts a join draft.owners o on o.id=a.owner_id
 where a.auth_user_id=auth.uid() and o.active
$$;
revoke all on function public.prospect_owner() from public,anon,authenticated;
grant execute on function public.prospect_owner() to authenticated;

create function public.drop_own_prospect(req uuid, prospect uuid, expected_revision integer, confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); owner uuid; p trading.prospects; prior trading.prospect_requests;
 body jsonb; result jsonb; before_state jsonb;
begin
 perform pg_advisory_xact_lock(731943,1);
 owner=public.prospect_owner();
 if actor is null or owner is null then raise exception 'Active linked owner required'; end if;
 if req is null or prospect is null or expected_revision is null or confirmed is distinct from true then
  raise exception 'Confirm that reacquisition is only through the annual league draft';
 end if;
 body=jsonb_build_object('action','owner_drop','id',prospect,'revision',expected_revision,'confirmed',confirmed);
 select * into prior from trading.prospect_requests where request_id=req;
 if found then
  if prior.actor_id<>actor or prior.body<>body then raise exception 'Conflicting prospect retry'; end if;
  return prior.result;
 end if;
 select * into p from trading.prospects where id=prospect for update;
 if p.id is null or p.owner_id<>owner then raise exception 'You may only drop your own prospects'; end if;
 if p.status<>'active' or p.revision<>expected_revision then raise exception 'Prospect changed; refresh before retrying'; end if;
 before_state=to_jsonb(p);
 update trading.prospects set status='removed',ended_at=clock_timestamp(),revision=revision+1 where id=p.id returning * into p;
 insert into trading.prospect_events(prospect_id,actor_id,action,reason,before_state,after_state)
 values(p.id,actor,'owner_drop','Owner confirmed: reacquisition only through the annual league draft',before_state,to_jsonb(p));
 perform trading.refresh_prospect_alerts();
 result=jsonb_build_object('id',p.id,'revision',p.revision,'status',p.status);
 insert into trading.prospect_requests values(req,actor,body,result);
 return result;
end $$;
revoke all on function public.drop_own_prospect(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.drop_own_prospect(uuid,uuid,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
