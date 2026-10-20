'use strict';
// Causal-continuity experiment. This is an explicit bounded policy, not proof of
// general actor autonomy or free-form language understanding.
const {decideAction}=require('./consequences.cjs');
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
      // Bounded decision rule: if a timely report could affect the pending Old
      // Town errand, defer departure by three minutes to investigate locally.
      // This is a defeasible commitment response, NOT established threat truth.
      const leg=cloned.JebWorld.plan;
      const next=leg.findIndex(p=>p.start>minute);
      if(next>=0 && next<leg.length-1 && leg[next].loc==='old_town' && credibility!=='known_false'){
        const delay=3;
        leg[next-1].end+=delay;leg[next].start+=delay;leg[next].end+=delay;leg[next+1].start+=delay;
        policy.response='defer next Old Town departure by 3 minutes';
        event('actor_decision','qualified','Jeb prioritizes checking a timely warning without accepting its truth',[exchange]);
      }else event('actor_decision','no_change','Warning does not justify modifying pending commitments',[exchange]);
    }
  }
  const otherUnchanged=['Oattes','Rangers','Riders','Historical'].every(id=>JSON.stringify(initial[id].plan)===JSON.stringify(cloned[id].plan));
  return {mode,seed,minute,initial,world:cloned,reports,policy,timeline,otherUnchanged};
}
module.exports={runContinuity,location};
