'use strict';
// Evidence creation, worldline-bound observation, and later commitment choice.
// Deliberately bounded: a missed handoff at a registered location leaves evidence.
// No narrative model and no direct mutation of unrelated actors.
const {propagateBreach}=require('./social-propagation.cjs');
const {createActor,receive,step}=require('./competing-commitments.cjs');
function zoneAt(world,id,minute){
 const actor=world[id];if(!actor)throw Error('Unknown actor: '+id);
 return actor.plan.find(x=>minute>=x.start&&minute<x.end)?.loc||'unknown';
}
function makeBreachEvidence({source,obligation,minute,location,socialCost=2}){
 if(obligation.status!=='breached'||!location||location==='unknown')return null;
 return {id:'breach:'+source.id+':'+obligation.id,kind:'missed_handoff',
   subject:source.id,obligation_id:obligation.id,minute,location,
   status:'breached',socialCost,evidence_roots:[obligation.id]};
}
function encounter({world,observer,evidence,minute}){
 if(!evidence||minute<evidence.minute||zoneAt(world,observer.id,minute)!==evidence.location)return null;
 return {id:'observation:'+observer.id+':'+evidence.id+':'+minute,
   observer:observer.id,subject:evidence.subject,breach_id:evidence.id,minute,
   location:evidence.location,access:'direct',evidence_roots:[evidence.id]};
}
function closeSocialLoop({world,source,observer,relationship,obligation,breachMinute,observationMinute,location='old_town'}){
 const evidence=makeBreachEvidence({source,obligation,minute:breachMinute,location});
 const observation=encounter({world,observer,evidence,minute:observationMinute});
 const social=evidence?propagateBreach({source,observer,breach:evidence,observation,relationship,minute:observationMinute}):null;
 const actor=createActor({id:observer.id,commitments:[
   {id:'fulfill_delivery',priority:5,sensitiveTo:['trade'],deferralCost:1,failureCost:10},
   {id:'verify_partner',priority:3,sensitiveTo:['trust'],deferralCost:1,failureCost:10}
 ]});
 if(social?.status==='applied'){
   receive(actor,{id:social.evidence_roots[1],recipient:observer.id,received:true,minute:observationMinute,
     tags:['trust'],weight:5,reliability:1});
 }
 const decision=step(actor,observationMinute+1);
 return {evidence,observation,social,relationship,decision,actor,
   chain:social?.status==='applied'?[obligation.id,evidence.id,observation.id,social.evidence_roots[1]]:[]};
}
module.exports={zoneAt,makeBreachEvidence,encounter,closeSocialLoop};
