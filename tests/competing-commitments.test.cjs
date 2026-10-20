'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createActor,receive,step}=require('../engine/competing-commitments.cjs');
const obligations=[
 {id:'deliver',priority:5,due:4,urgency:0,sensitiveTo:['trade'],deferralCost:2,failureCost:4},
 {id:'protect',priority:3,due:5,urgency:0,sensitiveTo:['safety'],deferralCost:1,failureCost:10}
];
function run({warn=false,actor='JebWorld'}={}){
 const state=createActor({id:actor,commitments:obligations});
 if(warn)receive(state,{id:'warning-1',recipient:actor,received:true,minute:1,weight:5,reliability:.8,tags:['safety']});
 step(state,2);step(state,3);step(state,4);
 return state;
}
test('received warning changes priority while unreceived cannot',()=>{
 const control=run(),warned=run({warn:true});
 assert.equal(control.history.find(e=>e.kind==='commitment_decision').commitment_id,'deliver');
 const at2=warned.history.filter(e=>e.kind==='commitment_decision'&&e.minute===2);
 assert.equal(at2.find(e=>e.commitment_id==='protect').choice,'pursue');
 assert.equal(at2.find(e=>e.commitment_id==='deliver').choice,'defer');
 assert.ok(at2.find(e=>e.commitment_id==='protect').evidence_roots.includes('warning-1'));
});
test('repeated deferral breaches obligation and persists at later steps',()=>{
 const warned=run({warn:true});
 const delivery=warned.commitments.find(c=>c.id==='deliver');
 assert.equal(delivery.status,'breached');assert.equal(delivery.cost,4);
 const future=step(warned,5);
 assert.equal(future.some(e=>e.id==='deliver'),false);
 assert.equal(delivery.status,'breached');
});
test('same engine works for a different actor and provenance is retained',()=>{
 const s=run({warn:true,actor:'Oattes'});
 assert.equal(s.history.find(e=>e.kind==='received').evidence_roots[0],'warning-1');
 assert.equal(s.commitments.find(c=>c.id==='deliver').status,'breached');
});
test('unheard signal and duplicate delivery cannot create extra pressure',()=>{
 const s=createActor({id:'JebWorld',commitments:obligations});
 assert.equal(receive(s,{id:'x',recipient:'Oattes',received:true,minute:1,weight:20,reliability:1,tags:['safety']}),false);
 const signal={id:'x',recipient:'JebWorld',received:true,minute:1,weight:5,reliability:.8,tags:['safety']};
 assert.equal(receive(s,signal),true);assert.equal(receive(s,signal),false);
 assert.equal(s.signals.length,1);
});
test('same events reproduce the same later actor state',()=>{
 assert.deepEqual(run({warn:true}),run({warn:true}));
});
