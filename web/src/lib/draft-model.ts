export type Player = {
  is_prospect?: boolean;
  source_rank?: number | null;
  player_id: string;
  player_name: string;
  sport: string;
  position: string | null;
  professional_team: string | null;
  availability_status: string;
};
export type Pick = {
  is_prospect?: boolean;
  selection_id: string | null;
  skipped_at: string | null;
  sport: string | null;
  position: string | null;
  professional_team: string | null;
  selected_at: string | null;
  pick_id: string;
  round: number;
  pick_number: number;
  owner_id: string;
  player_id: string | null;
  player_name: string | null;
};
export type DraftState = {
  rules: { sport: string; minimum: number; maximum: number | null }[];
  draft_id: string;
  name: string;
  status: string;
  revision: number;
  rounds: number;
  current_pick_number: number | null;
  timer_seconds: number;
  deadline_at: string | null;
  paused_remaining_seconds: number | null;
  server_time: string;
  viewer_owner_id: string | null;
  viewer_is_commissioner: boolean;
  participants: {
    owner_id: string;
    display_name: string;
    slug: string;
    order_position: number;
  }[];
  picks: Pick[];
};
export type CommissionerAction =
  | "start"
  | "pause"
  | "resume"
  | "set_timer"
  | "set_order"
  | "assign"
  | "undo";

// Display only: never pass these synthetic slots to draft commands.
export function setupOrderPreview(state: DraftState): Pick[] {
  if (state.status !== "setup" || state.picks.length || !Number.isInteger(state.rounds) || state.rounds < 1) return [];
  const order = [...state.participants].sort((a,b)=>a.order_position-b.order_position);
  if (order.length < 2 || new Set(order.map(p=>p.owner_id)).size !== order.length || order.some((p,i)=>p.order_position!==i+1)) return [];
  return Array.from({length:state.rounds*order.length},(_,i)=>{
    const round=Math.floor(i/order.length)+1, slot=i%order.length;
    return {pick_id:`preview-${i+1}`,round,pick_number:i+1,
      owner_id:order[round%2 ? slot : order.length-1-slot].owner_id,
      player_id:null,player_name:null,selection_id:null,skipped_at:null,
      sport:null,position:null,professional_team:null,selected_at:null};
  });
}
export function commissionerCommand(
  state: DraftState,
  action: CommissionerAction,
  args: Record<string, unknown>,
  requestId: string,
) {
  if (!state.viewer_is_commissioner)
    throw new Error("Commissioner access required");
  return {
    target: state.draft_id,
    request_id: requestId,
    expected_revision: state.revision,
    action,
    args,
  };
}
export function rosterProgress(state: DraftState, owner: string) {
  const picks = state.picks.filter((p) => p.owner_id === owner && p.player_id);
  return state.rules.map((rule) => ({
    ...rule,
    count: picks.filter((p) => p.sport === rule.sport).length,
  }));
}
export type PickCommand = {
  target: string;
  request_id: string;
  expected_revision: number;
  action: "pick";
  args: { pick_id: string; player_id: string };
};
export function currentPick(s: DraftState) {
  return s.picks.find((p) => p.pick_number === s.current_pick_number);
}
export function mayPick(s: DraftState, estimatedServerTime: number) {
  return (
    s.status === "running" &&
    !!s.viewer_owner_id &&
    currentPick(s)?.owner_id === s.viewer_owner_id &&
    !!s.deadline_at &&
    Date.parse(s.deadline_at) > estimatedServerTime
  );
}
export function pickCommand(
  s: DraftState,
  p: Player,
  requestId: string,
): PickCommand {
  const pick = currentPick(s);
  if (!pick) throw new Error("There is no active pick. Refresh the draft.");
  return {
    target: s.draft_id,
    request_id: requestId,
    expected_revision: s.revision,
    action: "pick",
    args: { pick_id: pick.pick_id, player_id: p.player_id },
  };
}
export function draftConfig(url?: string, key?: string, target?: string) {
  // Phase 1 is deliberately limited to the tested project, not production.
  if (
    url !== "https://tgvuntuhdqucazpoxrrg.supabase.co" ||
    !key?.startsWith("sb_publishable_") ||
    !target ||
    !/^[0-9a-f-]{36}$/i.test(target)
  )
    return null;
  return { url, key, target };
}
