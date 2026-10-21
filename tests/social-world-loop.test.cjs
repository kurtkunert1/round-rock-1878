'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createActor,receive,step}=require('../engine/competing-commitments.cjs');
const {closeSocialLoop,zoneAt}=require('../engine/social-world-loop.cjs');
const ui=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function world(seed){
 const a=ui.indexOf('function seeded(seed)'),b=ui.indexOf('\nfunction worldMinute()',a);
 const ctx={Math,Date,Set,worldSeed:seed,world:{},worldEvents:[],worldIntersections:new Set(),worldLastMinute:-1,worldOffsetMin:0,worldStartedAt:0,pendingFieldObservations:[],surfacedFieldObservations:new Set(),worldLog(){},worldTick(){}};
 vm.createContext(ctx);vm.runInContext(ui.slice(a,b)+'\nbuildIndependentWorld(worldSeed)',ctx);
 return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(ctx.world).map(([id,x])=>[id,{plan:x.plan}]))));
}
function breach(){
 const actor=createActor({id:'JebWorld',commitments:[
  {id:'delivery',priority:5,deferralCost:2,failureCost:4,sensitiveTo:['trade']},
  {id:'safety',priority:3,deferralCost:1,failureCost:10,sensitiveTo:['safety']}
 ]});
 receive(actor,{id:'warning',recipient:'JebWorld',received:true,minute:1,weight:5,reliability:.8,tags:['safety']});
 step(actor,2);step(actor,3);
 return actor.commitments.find(x=>x.id==='delivery');
}
function run(seed,visible=true){
 const w=world(seed),obligation=breach();
 assert.equal(obligation.status,'breached');
 const oattesArrival=w.Oattes.plan[1].start;
 const observationMinute=visible?Math.max(4,oattesArrival):Math.max(4,oattesArrival);
 const source={id:'JebWorld'},observer={id:'Oattes',knowledge:[]},relationship={id:'Oattes|JebWorld',trust:5};
 if(!visible)w.Oattes.plan=[{start:0,end:999,loc:'new_town'}];
 return {w,...closeSocialLoop({world:w,source,observer,relationship,obligation,breachMinute:3,observationMinute})};
}
test('worldline encounter generates observation and influences later decision',()=>{
 const r=run(12345);
 assert.equal(zoneAt(r.w,'Oattes',r.observation.minute),'old_town');
 assert.equal(r.social.status,'applied');
 assert.equal(r.relationship.trust,3);
 assert.equal(r.decision.find(x=>x.id==='verify_partner').choice,'pursue');
 assert.equal(r.decision.find(x=>x.id==='fulfill_delivery').choice,'defer');
 assert.equal(r.actor.history.find(x=>x.kind==='received').evidence_roots[0],r.observation.id);
 assert.deepEqual(r.social.evidence_roots,[r.evidence.id,r.observation.id]);
});
test('no worldline encounter means no learned breach or trust change',()=>{
 const r=run(12345,false);
 assert.equal(r.observation,null);
 assert.equal(r.social.status,'not_observed');
 assert.equal(r.relationship.trust,5);
 assert.equal(r.decision.find(x=>x.id==='fulfill_delivery').choice,'pursue');
 assert.equal(r.actor.signals.length,0);
});
test('causal result is repeatable over independent world seeds',()=>{
 for(const seed of [1,23,101,731,12345,95218]){
  const a=run(seed),b=run(seed);
  assert.deepEqual(a,b);assert.equal(a.social.status,'applied');
 }
});
test('no breach means no manufactured evidence or social pressure',()=>{
 const w=world(12345),observer={id:'Oattes',knowledge:[]},relationship={id:'Oattes|JebWorld',trust:5};
 const r=closeSocialLoop({world:w,source:{id:'JebWorld'},observer,relationship,
   obligation:{id:'delivery',status:'active'},breachMinute:3,observationMinute:w.Oattes.plan[1].start});
 assert.equal(r.evidence,null);assert.equal(r.social,null);assert.equal(r.relationship.trust,5);
 assert.equal(r.decision.find(x=>x.id==='fulfill_delivery').choice,'pursue');
});
