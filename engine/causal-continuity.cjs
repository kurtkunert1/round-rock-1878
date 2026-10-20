'use strict';
// Causal-continuity experiment. This is an explicit bounded policy, not proof of
// general actor autonomy or free-form language understanding.
const {decideCommitment,applyDecision}=require('./actor-decisions.cjs');
const location=(world,id,t)=>world[id].plan.find(p=>t>=p.start&&t<p.end)?.loc||'unknown';
function runContinuity({world,seed,mode,minute,playerZone='creek',warning='Four armed riders near the creek',credibility='unverified'}){
  if(!['control','unheard','received'].includes(mode))throw new Error('bad mode');
  const cloned=structuredClone(Object.fromEntries(Object.entries(world).map(([k,v])=>[k,{origin:v.origin,plan:v.plan,knowledge:[...v.knowledge]}])));
  const initial=structuredClone(cloned);
  const timeline=[],reports=[],policy={commitment:'Jeb ordinary creek/Old Town errand',response:'keep plan'};
  const event=(kind,status,basis,roots=[])=>timeline.push({kind,status,basis,evidence_roots:roots,minute});
  const exchange='warning-'+seed+'-'+minute;
  if(mode!=='control'){
    const inContact=playerZone===location(cloned,'JebWorld',minute);
    const delivered=mode==='received'&&inContact;
    event('communication_attempt',delivered?'delivered':'not_delivered',
      delivered?'Player and Jeb co-located':'No verified contact at warning time',[exchange]);
    if(delivered){
      reports.push({id:exchange,claim:warning,truth_status:'reported-not-established',credibility});
      event('heard_report','registered','Jeb heard an unverified player warning',[exchange]);
      const decision=decideCommitment({
        actor:{id:'JebWorld',inertia:0},
        commitment:{id:'Old Town errand',priority:2,sensitiveTo:['safety']},
        signals:[{id:exchange,recipient:'JebWorld',received:true,weight:5,
          reliability:credibility==='known_false'?0:.8,tags:['safety']}],minute
      });
      const applied=applyDecision(cloned,decision,{delay:3});
      policy.response=applied.status==='qualified'?'defer next Old Town departure by 3 minutes':'keep plan';
      event('actor_decision',applied.status,decision.reason,decision.evidence_roots);
    }
  }
  const otherUnchanged=['Oattes','Rangers','Riders','Historical'].every(id=>JSON.stringify(initial[id].plan)===JSON.stringify(cloned[id].plan));
  return {mode,seed,minute,initial,world:cloned,reports,policy,timeline,otherUnchanged};
}
module.exports={runContinuity,location};
