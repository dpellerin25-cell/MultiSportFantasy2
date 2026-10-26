// Exact, fixed database messages only. Never print error.detail/context/query.
const validation = new Map([
  ['Complete active-owner snapshot required', 'The database requires a complete snapshot for every active owner. Compare database membership with the published league settings; also check snapshot structure and observation timestamps.'],
  ['Retired league connection', 'A roster uses a retired Fantrax league. Export the approved runtime connections and fetch fresh rosters from those leagues.'],
  ['League sport mapping changed', 'A roster league conflicts with the sport/league mapping already stored. Check the approved renewal state and runtime connections before retrying.'],
  ['Stale or conflicting snapshot', 'A stored snapshot is newer, or has the same observation time with different contents. Run a fresh five-sport roster fetch; do not edit timestamps or delete snapshots.'],
  ['Invalid snapshot owner', 'A roster owner is inactive, unknown, duplicated, or has an invalid player list. Compare the active database owner slugs with the approved website membership.'],
  ['Invalid or duplicate player', 'A roster contains a missing player identity/name or a duplicate player ID. Inspect the fresh roster files and refetch; do not bypass the validation.'],
  ['All five roster snapshots required', 'The database did not receive a complete five-sport batch. Fetch and import all five sports together.'],
  ['Exactly one snapshot per sport required', 'The batch must contain NFL, MLB, NBA, EPL and PGA exactly once. Check the roster export and runtime sport configuration.'],
]);

const databaseCodes = new Map([
  ['23505', 'A database uniqueness constraint rejected the batch. Check for conflicting identities; existing constraints remain enforced.'],
  ['23503', 'A referenced database record is missing. Check the required migrations and owner/player records.'],
  ['23514', 'A database check constraint rejected the batch. Check the installed migrations and input data.'],
  ['55P03', 'The import could not acquire a database lock in time. Retry after the competing operation finishes.'],
  ['57014', 'The database cancelled the import, possibly due to a timeout. Check database workload before retrying.'],
]);

export function rosterSyncFailureReason(error) {
  if (error?.code === 'P0001') {
    const advice = validation.get(error.message);
    return advice ? `Database validation: ${error.message}. ${advice}`
      : 'An unrecognized database validation rejected the batch. Inspect the private database logs for the matching run; raw error text is withheld.';
  }
  return databaseCodes.get(error?.code) ?? null;
}
