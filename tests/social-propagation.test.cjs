'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createActor,receive,step}=require('../engine/competing-commitments.cjs');
const {propagateBreach}=require('../engine/social-propagation.cjs');
function scenario(observed){
 const jeb=createActor({id:'JebWorld',commitments:[
  {id:'delivery',priority:5,deferralCost:2,failureCost:4,sensitiveTo:['trade']},
  {id:'safety',priority:3,deferralCost:1,failureCost:10,sensitiveTo:['safety']}
 ]});
 receive(jeb,{id:'warning-1',recipient:'JebWorld',received:true,minute:1,weight:5,reliability:.8,tags:['safety']});
 step(jeb,2);step(jeb,3);
 const breached=jeb.commitments.find(c=>c.id==='delivery');
 const oattes={id:'Oattes',knowledge:[]};
 const relation={id:'Oattes|JebWorld',trust:5,history:[]};
 const event={id:'breach-delivery',status:breached.status,minute:3,socialCost:2};
 const obs=observed?{id:'obs-1',observer:'Oattes',subject:'JebWorld',breach_id:event.id,minute:4,access:'direct'}:null;
 const result=propagateBreach({source:jeb,observer:oattes,breach:event,observation:obs,relationship:relation,minute:4});
 return {jeb,oattes,relation,result,event,obs};
}
test('breach is durable whether or not Oattes sees it',()=>{
 const a=scenario(false),b=scenario(true);
 assert.equal(a.jeb.commitments.find(c=>c.id==='delivery').status,'breached');
 assert.deepEqual(a.jeb.commitments,b.jeb.commitments);
 assert.equal(a.relation.trust,5);assert.deepEqual(a.oattes.knowledge,[]);
 assert.equal(b.result.status,'applied');assert.equal(b.relation.trust,3);
 assert.deepEqual(b.result.evidence_roots,['breach-delivery','obs-1']);
 assert.ok(b.oattes.knowledge.includes('observed breach breach-delivery'));
});
test('unverified report cannot change trust',()=>{
 const s=scenario(false);
 const bad={id:'rumor',observer:'Oattes',subject:'JebWorld',breach_id:'breach-delivery',minute:4,access:'reported'};
 assert.equal(propagateBreach({source:s.jeb,observer:s.oattes,breach:s.event,observation:bad,relationship:s.relation,minute:4}).status,'not_observed');
 assert.equal(s.relation.trust,5);
});
test('replay is idempotent and another observer does not inherit knowledge',()=>{
 const s=scenario(true);
 assert.equal(propagateBreach({source:s.jeb,observer:s.oattes,breach:s.event,observation:s.obs,relationship:s.relation,minute:5}).status,'duplicate');
 assert.equal(s.relation.trust,3);
 const other={id:'Rangers',knowledge:[]},r={id:'Rangers|JebWorld',trust:4};
 assert.equal(propagateBreach({source:s.jeb,observer:other,breach:s.event,observation:s.obs,relationship:r,minute:5}).status,'not_observed');
 assert.deepEqual(other.knowledge,[]);
});
test('premature observation cannot propagate future breach',()=>{
 const s=scenario(false);
 const obs={id:'premature',observer:'Oattes',subject:'JebWorld',breach_id:'breach-delivery',minute:2,access:'direct'};
 assert.equal(propagateBreach({source:s.jeb,observer:s.oattes,breach:s.event,observation:obs,relationship:s.relation,minute:4}).status,'not_observed');
});
