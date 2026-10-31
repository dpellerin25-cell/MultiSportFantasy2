export type Check = {owner:string;owner_id:string;check_id:string|null;complete:boolean|null;total_players:number|null;checked_at:string|null;cap:number|null;revision:number|null;reason:string|null;last_check_date:string|null};
export type Outcome={status:string;reason:string;checks?:unknown[];resolution_id?:string;adjusted_total?:number};
export type PgaResult={result_id:string;owner:string;start_date:string;end_date:string;label:string;is_test:boolean;championship_year:number|null;revision:number;outcome:Outcome};
export type PgaReview=Outcome&{result_id:string;last_resolution_id:string|null;checks:unknown[];waive_total:number;enforce_total:number;positive_points:number;negative_points:number;overage_checks:number};
export type History={id:string;kind:string;occurred_at:string;reason:string;action:string;actor:string;owner:string|null;start_date:string|null;end_date:string|null;is_test:boolean|null};
export type ControlsState={check_date:string;server_time:string;pause:{id:string;paused:boolean;effective_at:string|null;reason:string|null};checks:Check[];pga:PgaResult[];pga_has_more:boolean;history:History[];history_has_more:boolean};
export type Review={kind:'pause';paused:boolean;expected:string;reason:string}|{kind:'pga';choice:'enforce'|'waive';evidence:PgaReview;result:PgaResult;reason:string};
export function checkpointLabel(c:Check){return !c.check_id?'Missing':!c.complete?'Pending — incomplete':c.total_players!>c.cap!?'Complete — over cap':'Complete — compliant';}
export function canReviewPga(o:Outcome){return o.reason==='PGA pause boundary requires policy decision'||!!o.resolution_id;}
export function validateReason(reason:string){if(reason.trim().length<5||reason.trim().length>1000)throw Error('Enter a reason of 5–1000 characters.');return reason.trim();}
export function scoringRequest(review:Review,confirmed:boolean,id:string){
 if(!confirmed)throw Error('Confirm the reviewed change before applying.');
 const reason=validateReason(review.reason);
 if(review.kind==='pause')return {rpc:'scoring_controls_pause',args:{req:id,paused_value:review.paused,explanation:reason,expected_event:review.expected,confirmed:true}};
 if(!canReviewPga(review.evidence)||!Array.isArray(review.evidence.checks)||review.evidence.result_id!==review.result.result_id)throw Error('Review current PGA evidence first.');
 return {rpc:'scoring_controls_pga_resolve',args:{req:id,result_id:review.result.result_id,choice_value:review.choice,explanation:reason,expected_checks:review.evidence.checks,expected_resolution:review.evidence.last_resolution_id,confirmed:true}};
}
