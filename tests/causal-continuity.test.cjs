'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {runContinuity,location}=require('../engine/causal-continuity.cjs');
const ui=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function world(seed){
 const a=ui.indexOf('function seeded(seed)'),b=ui.indexOf('\nfunction worldMinute()',a);
 assert.ok(a>=0&&b>a);
 const c={Math,Date,Set,worldSeed:seed,world:{},worldEvents:[],worldIntersections:new Set(),
 worldLastMinute:-1,worldOffsetMin:0,worldStartedAt:0,pendingFieldObservations:[],
 surfacedFieldObservations:new Set(),worldLog(){},worldTick(){}};
 vm.createContext(c);vm.runInContext(ui.slice(a,b)+'\nbuildIndependentWorld(worldSeed)',c);
 return c.world;
}
function trio(seed){
 const original=world(seed);
 const depart=original.JebWorld.plan[1].start;
 const minute=depart-1;
 const zone=location(original,'JebWorld',minute);
 assert.equal(zone,'creek');
 return ['control','unheard','received'].map(mode=>runContinuity({
  world:original,seed,mode,minute,playerZone:mode==='unheard'?'old_town':zone
 }));
}
test('same seeded world diverges ONLY after delivered report',()=>{
 const [a,b,c]=trio(12345);
 assert.deepEqual(a.world,b.world);
 assert.notDeepEqual(a.world.JebWorld.plan,c.world.JebWorld.plan);
 assert.equal(c.world.JebWorld.plan[1].start,a.world.JebWorld.plan[1].start+3);
 for(const id of ['Oattes','Rangers','Riders','Historical']){
  assert.deepEqual(a.world[id].plan,c.world[id].plan);
 }
 assert.equal(c.otherUnchanged,true);
 assert.equal(a.reports.length,0);
 assert.equal(b.reports.length,0);
 assert.equal(c.reports[0].truth_status,'reported-not-established');
 const change=c.timeline.find(e=>e.kind==='actor_decision');
 assert.equal(change.status,'qualified');
 assert.deepEqual(change.evidence_roots,[c.reports[0].id]);
});
test('unheard warning cannot alter plans despite same content',()=>{
 const [a,b]=trio(7612);
 assert.deepEqual(a.world,b.world);
 assert.equal(b.timeline[0].status,'not_delivered');
});
test('recorded warning does not magically establish danger',()=>{
 const c=trio(2026)[2];
 assert.equal(c.world.JebWorld.knowledge.includes('riders are dangerous'),false);
 assert.equal(c.reports[0].truth_status,'reported-not-established');
});
test('policy decision is deterministic over multiple seeds',()=>{
 for(const seed of [1,23,101,731,12345,95218]){
  const [a,b,c]=trio(seed);
  assert.equal(b.policy.response,'keep plan');
  assert.equal(c.world.JebWorld.plan[1].start-a.world.JebWorld.plan[1].start,3);
  assert.deepEqual(trio(seed),[a,b,c]);
 }
});
