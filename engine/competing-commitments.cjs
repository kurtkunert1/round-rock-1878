'use strict';
// Multiple obligations and durable consequences. Deterministic bounded policy,
// not an open-domain autonomous-agent claim.
function createActor({id,commitments,inertia=0}){
 if(!id||!Array.isArray(commitments)||!commitments.length)throw Error('actor and commitments required');
 return {id,inertia,commitments:commitments.map(c=>({...c,status:'active',cost:0})),signals:[],history:[],processed:[],minute:0};
}
function receive(state,signal){
 if(!signal?.id||!Number.isFinite(signal.weight)||!Number.isFinite(signal.reliability))throw Error('invalid signal');
 if(state.processed.includes(signal.id))return false;
 if(signal.recipient!==state.id||signal.received!==true)return false;
 state.signals.push({...signal});state.processed.push(signal.id);
 state.history.push({kind:'received',id:signal.id,minute:state.minute,evidence_roots:[signal.id]});
 return true;
}
function step(state,minute,{capacity=1}={}){
 if(minute<=state.minute)throw Error('time must advance');
 state.minute=minute;
 const open=state.commitments.filter(c=>c.status==='active');
 const rows=open.map(c=>{
  const relevant=state.signals.filter(s=>s.minute<=minute&&(s.tags||[]).some(t=>(c.sensitiveTo||[]).includes(t)));
  const pressure=relevant.reduce((n,s)=>n+Math.max(0,s.weight)*Math.max(0,Math.min(1,s.reliability)),0);
  const urgency=Number(c.urgency||0)*Math.max(0,minute-Number(c.due||0));
  return {id:c.id,score:c.priority+urgency+pressure-state.inertia,roots:relevant.map(x=>x.id),pressure};
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const chosen=new Set(rows.slice(0,capacity).map(x=>x.id));
 for(const row of rows){
  const c=state.commitments.find(x=>x.id===row.id);
  if(!chosen.has(c.id)){c.cost+=Number(c.deferralCost||1);if(c.cost>=Number(c.failureCost||Infinity))c.status='breached';}
  const ev={kind:'commitment_decision',minute,actor_id:state.id,commitment_id:c.id,
    choice:chosen.has(c.id)?'pursue':'defer',score:row.score,cumulative_cost:c.cost,
    status:c.status,evidence_roots:row.roots};
  state.history.push(ev);
 }
 return rows.map(r=>({...r,choice:chosen.has(r.id)?'pursue':'defer'}));
}
module.exports={createActor,receive,step};
