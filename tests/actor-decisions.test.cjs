'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decideCommitment,applyDecision}=require('../engine/actor-decisions.cjs');
const plan=()=>[{start:0,end:8,loc:'creek'},{start:8,end:15,loc:'old_town'},{start:15,end:999,loc:'creek'}];
const actor=(id,inertia=0)=>({id,inertia});
const commitment=(id,priority,tags)=>({id,priority,sensitiveTo:tags});
const signal=(id,recipient,weight,reliability,tags,received=true)=>({id,recipient,weight,reliability,tags,received});
test('same mechanism changes different actors when justified',()=>{
 for(const id of ['JebWorld','Oattes','Rangers']){
  const d=decideCommitment({actor:actor(id),commitment:commitment('errand',2,['danger']),signals:[signal('report1',id,5,.8,['danger'])],minute:6});
  assert.equal(d.choice,'defer');const w={[id]:{plan:plan()}};
  assert.equal(applyDecision(w,d).status,'qualified');assert.equal(w[id].plan[1].start,11);
  assert.deepEqual(d.evidence_roots,['report1']);
 }
});
test('unreceived, irrelevant and unreliable messages do not overwrite commitments',()=>{
 for(const s of [signal('unheard','JebWorld',10,1,['danger'],false),signal('irrelevant','JebWorld',10,1,['weather']),signal('weak','JebWorld',10,.1,['danger'])]){
  const d=decideCommitment({actor:actor('JebWorld',1),commitment:commitment('errand',3,['danger']),signals:[s],minute:6});
  assert.equal(d.choice,'continue');
 }
});
test('competing relevant pressures combine but are not treated as proven facts',()=>{
 const d=decideCommitment({actor:actor('Oattes'),commitment:commitment('delivery',4,['safety','urgency']),signals:[signal('a','Oattes',3,.8,['safety']),signal('b','Oattes',3,.8,['urgency'])],minute:6});
 assert.equal(d.choice,'defer');assert.deepEqual(d.evidence_roots,['a','b']);
});
test('actor inertia can preserve an obligation',()=>{
 const signals=[signal('same','Rangers',5,.8,['danger'])];
 assert.equal(decideCommitment({actor:actor('Rangers',3),commitment:commitment('patrol',2,['danger']),signals}).choice,'continue');
 assert.equal(decideCommitment({actor:actor('Rangers',0),commitment:commitment('patrol',2,['danger']),signals}).choice,'defer');
});
test('decision only changes named actor and preserves existing duration',()=>{
 const w={JebWorld:{plan:plan()},Rangers:{plan:plan()}},before=structuredClone(w.Rangers);
 const d=decideCommitment({actor:actor('JebWorld'),commitment:commitment('task',1,['danger']),signals:[signal('e','JebWorld',3,1,['danger'])],minute:5});
 applyDecision(w,d);assert.deepEqual(w.Rangers,before);
 assert.equal(w.JebWorld.plan[1].end-w.JebWorld.plan[1].start,7);
});
