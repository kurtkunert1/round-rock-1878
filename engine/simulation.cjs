'use strict';
// Persistent, headless integration of the actual Round Rock seed schedules and
// the independent consequence/commitment/social modules. No model or UI required.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createActor,receive,step}=require('./competing-commitments.cjs');
const {makeBreachEvidence,encounter}=require('./social-world-loop.cjs');
const {propagateBreach}=require('./social-propagation.cjs');
const {decideAction}=require('./consequences.cjs');
function seedWorld(seed){
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const a=html.indexOf('function seeded(seed)'),b=html.indexOf('\nfunction worldMinute()',a);
 if(a<0||b<a)throw Error('World-builder not found');
 const c={Math,Date,Set,worldSeed:seed,world:{},worldEvents:[],worldIntersections:new Set(),worldLastMinute:-1,worldOffsetMin:0,worldStartedAt:0,pendingFieldObservations:[],surfacedFieldObservations:new Set(),worldLog(){},worldTick(){}};
 vm.createContext(c);vm.runInContext(html.slice(a,b)+'\nbuildIndependentWorld(worldSeed)',c,{timeout:1000});
 return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(c.world).map(([id,obj])=>[id,{origin:obj.origin,plan:obj.plan,knowledge:[...obj.knowledge]}]))));
}
const location=(s,id,t=s.minute)=>s.world[id].plan.find(p=>t>=p.start&&t<p.end)?.loc||'unknown';
function createSimulation(seed=12345){
 return {schema:1,seed,minute:0,world:seedWorld(seed),player:{zone:'creek',knowledge:[]},
  actors:{
   JebWorld:createActor({id:'JebWorld',commitments:[
    {id:'delivery',priority:5,deferralCost:2,failureCost:4,sensitiveTo:['trade']},
    {id:'safety',priority:3,deferralCost:1,failureCost:10,sensitiveTo:['safety']}]}),
   Oattes:createActor({id:'Oattes',commitments:[
    {id:'fulfill_delivery',priority:5,sensitiveTo:['trade']},
    {id:'verify_partner',priority:3,sensitiveTo:['trust']}]})
  },relationship:{id:'Oattes|JebWorld',trust:5,history:[],processed:[]},
  evidence:[],observations:[],events:[],appliedIds:[],commands:[],nextCommandId:1};
}
function append(s,event){s.events.push({sequence:s.events.length+1,minute:s.minute,...event});}
function interact(s,{verb,target,text,id}){
 if(!id)id='command-'+s.nextCommandId++;
 if(s.commands.some(x=>x.id===id))return {status:'duplicate'};
 const cmd={id,minute:s.minute,verb,target,text:text||null};
 s.commands.push(cmd);
 if(verb==='warn'){
  const contact=location(s,'JebWorld')===s.player.zone;
  const result={status:contact?'delivered':'not_delivered',evidence_roots:[id]};
  append(s,{kind:'communication',command_id:id,...result});
  if(contact){
   receive(s.actors.JebWorld,{id,recipient:'JebWorld',received:true,minute:s.minute,
    tags:['safety'],weight:5,reliability:.8,claim:text||'Warning'});
  }
  return result;
 }
 const st={minute:s.minute,actorZone:s.player.zone,world:s.world,playerKnowledge:s.player.knowledge,
  events:[],appliedIds:[]};
 const result=decideAction(st,{id,verb,target,route_verified:false});
 s.player.zone=st.actorZone;
 for(const e of st.events)append(s,e);
 return result;
}
function tick(s){
 s.minute++;
 for(const [id,actor] of Object.entries(s.actors)){
  const before=actor.commitments.filter(c=>c.status==='breached').map(c=>c.id);
  const decisions=step(actor,s.minute);
  append(s,{kind:'actor_choices',actor:id,decisions});
  for(const c of actor.commitments.filter(c=>c.status==='breached'&&!before.includes(c.id))){
   // A registered missed delivery leaves evidence at its agreed handoff place,
   // regardless of the actor's present location.
   if(id==='JebWorld'&&c.id==='delivery'){
    const ev=makeBreachEvidence({source:{id},obligation:c,minute:s.minute,location:'old_town'});
    s.evidence.push(ev);append(s,{kind:'evidence_created',evidence_id:ev.id,evidence_roots:[c.id]});
   }
  }
 }
 for(const ev of s.evidence){
  if(s.observations.some(x=>x.breach_id===ev.id&&x.observer==='Oattes'))continue;
  const obs=encounter({world:s.world,observer:{id:'Oattes'},evidence:ev,minute:s.minute});
  if(!obs)continue;
  s.observations.push(obs);append(s,{kind:'observation',observation_id:obs.id,evidence_roots:[ev.id]});
  const social=propagateBreach({source:{id:'JebWorld'},observer:s.actors.Oattes,breach:ev,
   observation:obs,relationship:s.relationship,minute:s.minute});
  if(social.status==='applied'){
   append(s,{kind:'social_change',status:social.status,evidence_roots:social.evidence_roots,changes:social.changes});
   receive(s.actors.Oattes,{id:obs.id,recipient:'Oattes',received:true,minute:s.minute,
    tags:['trust'],weight:5,reliability:1});
  }
 }
}
function advance(s,to){
 if(!Number.isSafeInteger(to)||to<s.minute||to>999)throw Error('Invalid simulation minute');
 while(s.minute<to)tick(s);
 return s;
}
function save(s){return JSON.stringify(s);}
function restore(json){
 const s=JSON.parse(json);
 if(s.schema!==1||!Number.isSafeInteger(s.minute)||!s.world||!s.actors||!s.events||
  !Array.isArray(s.evidence)||!Array.isArray(s.observations))throw Error('Invalid checkpoint');
 return s;
}
module.exports={createSimulation,interact,advance,save,restore,location};
