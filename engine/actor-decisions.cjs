'use strict';
// Actor-independent, deterministic decision machinery. Profiles and pressure
// classifications are supplied as evidence; this module never invents them.
function decideCommitment({actor,commitment,signals=[],minute=0}){
 if(!actor||!commitment||!Number.isFinite(commitment.priority))throw new TypeError('actor and commitment priority required');
 const roots=[]; let pressure=0;const reasons=[];
 for(const signal of signals){
  if(signal.recipient!==actor.id||!signal.received)continue;
  if(!signal.id||!Number.isFinite(signal.weight)||!Number.isFinite(signal.reliability))throw new TypeError('registered signal required');
  const relevance=(signal.tags||[]).some(t=>(commitment.sensitiveTo||[]).includes(t));
  if(!relevance)continue;
  const increment=Math.max(0,signal.weight)*Math.max(0,Math.min(1,signal.reliability));
  pressure+=increment;roots.push(signal.id);
  reasons.push({signal_id:signal.id,weighted_pressure:increment});
 }
 const threshold=commitment.priority+(actor.inertia||0);
 const choice=pressure>threshold?'defer':'continue';
 return {actor_id:actor.id,commitment_id:commitment.id,minute,choice,pressure,threshold,
  evidence_roots:roots,reasons,reason:choice==='defer'?'Relevant received pressure exceeded commitment threshold':'Commitment remains stronger than received evidence'};
}
function applyDecision(world,decision,{delay=3}={}){
 if(decision.choice!=='defer')return {status:'no_change',changes:[]};
 const actor=world[decision.actor_id];
 if(!actor)throw new TypeError('unknown actor');
 const leg=actor.plan;
 const i=leg.findIndex(p=>p.start>decision.minute);
 if(i<1||i>=leg.length-1)return {status:'no_change',changes:[]};
 const from=leg[i].start;
 // Preserve adjacent intervals and the duration of the deferred leg.
 leg[i-1].end+=delay;leg[i].start+=delay;leg[i].end+=delay;leg[i+1].start+=delay;
 return {status:'qualified',changes:[{object:decision.actor_id,property:'departure',from,to:from+delay}],
  evidence_roots:decision.evidence_roots,decision};
}
module.exports={decideCommitment,applyDecision};
