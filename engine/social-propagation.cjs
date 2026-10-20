'use strict';
// Evidence-gated propagation of a commitment breach into a relationship.
// This is bounded policy. A breach exists regardless of who observes it;
// social knowledge and trust only change after a justified observation.
function propagateBreach({source,observer,breach,observation,relationship,minute}){
 if(!source?.id||!observer?.id||!breach?.id||!relationship)throw Error('missing actors, breach, or relationship');
 const result={kind:'social_resolution',minute,source:source.id,observer:observer.id,
  breach_id:breach.id,status:'not_observed',changes:[],evidence_roots:[]};
 if(breach.status!=='breached')return {...result,status:'not_established'};
 if(!observation||observation.observer!==observer.id||observation.subject!==source.id||
    observation.breach_id!==breach.id||observation.minute<breach.minute||
    observation.access!=='direct'){
   return result;
 }
 const key='observed:'+observer.id+':'+breach.id;
 relationship.processed ||= [];
 if(relationship.processed.includes(key))return {...result,status:'duplicate'};
 relationship.processed.push(key);
 observer.knowledge ||= [];
 const fact='observed breach '+breach.id;
 if(!observer.knowledge.includes(fact))observer.knowledge.push(fact);
 const prior=Number(relationship.trust||0);
 const cost=Math.max(0,Number(breach.socialCost||1));
 relationship.trust=Math.max(-10,Math.min(10,prior-cost));
 relationship.history ||= [];
 const roots=[breach.id,observation.id];
 const entry={...result,status:'applied',evidence_roots:roots,changes:[
  {object:observer.id,property:'knowledge',add:fact},
  {object:relationship.id,property:'trust',from:prior,to:relationship.trust}
 ]};
 relationship.history.push(entry);
 return entry;
}
module.exports={propagateBreach};
