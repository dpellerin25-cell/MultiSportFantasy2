// Narrow commissioner confirmation from this conversation, 2026-10-29.
// This is human evidence, not a Fantrax scoring response or a general zero rule.
export const CONFIRMATION_ID='doug-confirmed-nonparticipation-2026-10-29';
export const CONFIRMED_CASES=[
 {sport:'MLB',league:'60ri2nbhmtj4b0km',team:'ef2fvskgmtj4b1bq',owner:'Doug',date:'2026-09-24',period:null,players:{'03oh0':'Willson Contreras','062k5':'Nick Kurtz'}},
 {sport:'NBA',league:'u1byx3qkmtj47ogg',team:'dghm6tvbmtug00lx',owner:'Hatch',date:'2026-10-23',period:null,players:{'06mm1':'Bronny James'}},
 {sport:'PGA',league:'xa7tza2hmthqz8bo',team:'427i3hphmtj6q46k',owner:'Brendan',date:null,period:21,players:{'05lo8':'Ludvig Aberg','01q3f':'Dustin Johnson','01uh8':'Jordan Spieth'}},
];
export function confirmedCase(d){return CONFIRMED_CASES.find(c=>c.sport===d.sport&&c.league===d.league_id&&c.team===d.team_id&&c.owner===d.owner&&c.date===d.scoring_date&&c.period===d.tournament_period);}
