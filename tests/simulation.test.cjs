'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSimulation,interact,advance,save,restore}=require('../engine/simulation.cjs');
test('player warning produces persistent causal chain in one simulation',()=>{
 const s=createSimulation(12345);
 const warn=interact(s,{verb:'warn',text:'I saw four armed riders'});
 assert.equal(warn.status,'delivered');
 advance(s,30);
 assert.equal(s.actors.JebWorld.commitments.find(c=>c.id==='delivery').status,'breached');
 assert.equal(s.evidence.length,1);
 assert.equal(s.observations.length,1);
 assert.equal(s.relationship.trust,3);
 assert.ok(s.events.some(x=>x.kind==='social_change'));
 assert.ok(s.actors.Oattes.history.some(x=>x.kind==='commitment_decision'&&x.commitment_id==='verify_partner'&&x.choice==='pursue'));
});
test('without warning no delivery breach or relationship change',()=>{
 const s=createSimulation(12345);advance(s,30);
 assert.equal(s.evidence.length,0);assert.equal(s.relationship.trust,5);
});
test('unheard warning does not change actor commitments',()=>{
 const s=createSimulation(12345);s.player.zone='old_town';
 assert.equal(interact(s,{verb:'warn',text:'Danger'}).status,'not_delivered');
 advance(s,30);assert.equal(s.evidence.length,0);
});
test('checkpoint resumes without replaying evidence or social effects',()=>{
 const a=createSimulation(731);interact(a,{verb:'warn',text:'Danger'});advance(a,8);
 const b=restore(save(a));
 advance(a,30);advance(b,30);
 assert.deepEqual(b,a);assert.equal(b.evidence.length,1);assert.equal(b.relationship.trust,3);
});
test('duplicate command does not apply a warning twice',()=>{
 const s=createSimulation(12345);
 interact(s,{id:'player-1',verb:'warn',text:'Danger'});
 assert.equal(interact(s,{id:'player-1',verb:'warn',text:'Danger'}).status,'duplicate');
 assert.equal(s.actors.JebWorld.signals.length,1);
});
test('Do action uses action gate, does not magically seize a horse',()=>{
 const s=createSimulation(12345);
 const r=interact(s,{verb:'take',target:'Ranger horse'});
 assert.equal(r.status,'rejected');assert.equal(s.events.at(-1).kind,'action_resolution');
});
