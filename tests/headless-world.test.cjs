'use strict';
// Executes shipped Round Rock world functions headlessly. No fake world or LLM.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ui=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function portion(start,end){
  const a=ui.indexOf(start),b=ui.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing production code section '+start);
  return ui.slice(a,b);
}
const worldSource=portion('function seeded(seed)','function gravitySnapshot()');
const exchangeSource=portion("function registerVisitorExchange(raw,intent='say')",'function jebMemorySnapshot()');
function scenario(seed=12345){
  const ctx={
    Math,Date,Set,document:{getElementById(){return null}},
    worldSeed:seed,world:{},worldEvents:[],worldIntersections:new Set(),
    worldLastMinute:-1,worldOffsetMin:0,worldStartedAt:0,
    pendingFieldObservations:[],surfacedFieldObservations:new Set(),
    actorZone:'creek',jebPresence:'present',runId:'headless',turnNumber:0,
    exchangeLedger:[],lineage:[],field:[],
    zoneLabel(zone){return zone;},
    recordLineage(event){this.lineage.push(event)},
    queueFieldObservation(id,description){this.field.push({id,description})},
    renderGravity(){}
  };
  // Callbacks defined as plain functions, since VM does not bind 'this'.
  ctx.recordLineage=(event)=>ctx.lineage.push(event);
  ctx.queueFieldObservation=(id,description)=>ctx.field.push({id,description});
  vm.createContext(ctx);
  vm.runInContext(worldSource+'\n'+exchangeSource+'\nbuildIndependentWorld(worldSeed);',ctx,{timeout:1500});
  return {
    ctx,
    at(minute){ctx.worldOffsetMin=minute;vm.runInContext('worldTick(true)',ctx,{timeout:1000});},
    exchange(text,intent){ctx.turnNumber++;ctx.raw=text;ctx.intent=intent;
      vm.runInContext('registerVisitorExchange(raw,intent)',ctx,{timeout:1000});}
  };
}
test('world advances on schedule without visitor input',()=>{
  const s=scenario();
  const before=s.ctx.world.Rangers.plan.map(x=>[x.start,x.end,x.loc]);
  for(let m=1;m<=30;m++)s.at(m);
  assert.equal(s.ctx.exchangeLedger.length,0);
  assert.deepEqual(s.ctx.world.Rangers.plan.map(x=>[x.start,x.end,x.loc]),before);
  assert.ok(s.ctx.worldEvents.some(e=>e.text.includes('OBSERVATION:')||e.text.includes('intersect')));
});
test('witness can know the patrol; unwitnessed speaker cannot establish it',()=>{
  const s=scenario();
  s.exchange('I saw Rangers by the creek.','say');
  assert.equal(s.ctx.world.JebWorld.knowledge.has('Ranger patrol observed'),false);
  assert.equal(s.ctx.world.JebWorld.heardReports.length,1);
  assert.equal(s.ctx.exchangeLedger[0].transfers[0].truth_status,'reported-not-established');
  for(let m=1;m<=30;m++)s.at(m);
  const observed=s.ctx.world.JebWorld.knowledge.has('Ranger patrol observed');
  const actuallyOverlapped=Array.from({length:31},(_,m)=>m).some(m=>{
    const loc=id=>s.ctx.world[id].plan.find(p=>m>=p.start&&m<p.end)?.loc;
    return loc('JebWorld')===loc('Rangers');
  });
  assert.equal(observed,actuallyOverlapped);
});
test('attempted action is not a spoken report or accomplished action',()=>{
  const s=scenario();
  s.exchange('I seize the Ranger horse.','do');
  assert.equal(s.ctx.exchangeLedger[0].intent,'do');
  assert.equal(s.ctx.world.JebWorld.heardReports.length,0);
  assert.equal(s.ctx.exchangeLedger[0].status,'registered');
  assert.equal(s.ctx.world.Rangers.plan[0].cause,'patrol movement independent of visitor');
});
test('same seed and same events produce the same causal world record',()=>{
  function run(){const s=scenario(731);
    s.exchange('Four men are coming.','say');
    for(let m=1;m<35;m++)s.at(m);
    return {knowledge:Object.fromEntries(Object.entries(s.ctx.world).map(([k,v])=>[k,[...v.knowledge]])),
      intersections:[...s.ctx.worldIntersections],field:s.ctx.field.map(x=>x.id),
      reports:s.ctx.world.JebWorld.heardReports.map(r=>r.text)};}
  assert.deepEqual(run(),run());
});
