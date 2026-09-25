begin;
-- Finalized snapshots are append-only history. Entry writers and finalizers
-- serialize on the same parent row to avoid edits racing finalization.
create function draft.guard_import_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='ready' then raise exception 'Ready import snapshots are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger immutable_ready_import before update or delete on draft.player_pool_imports
for each row execute function draft.guard_import_snapshot();

create function draft.guard_import_entry() returns trigger
language plpgsql set search_path='' as $$
declare target uuid; state text;
begin
  if tg_op='UPDATE' and new.import_id<>old.import_id then
    raise exception 'Cannot move snapshot entries';
  end if;
  if tg_op='DELETE' then target=old.import_id; else target=new.import_id; end if;
  select status into state from draft.player_pool_imports where id=target for update;
  if state is distinct from 'staging' then raise exception 'Only staging imports accept entry changes'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger immutable_ready_entries before insert or update or delete on draft.player_pool_entries
for each row execute function draft.guard_import_entry();
revoke all on function draft.guard_import_snapshot(),draft.guard_import_entry() from public,anon,authenticated;
commit;
