'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {decideAction}=require('../engine/consequences.cjs');
function world(){
  return {minute:5,actorZone:'creek',playerKnowledge:[],events:[],appliedIds:[],
    world:{
      Rangers:{plan:[{start:0,end:4,loc:'new_town'},{start:4,end:8,loc:'creek'}]},
      Riders:{plan:[{start:0,end:9,loc:'old_town'}]},
      JebWorld:{plan:[{start:0,end:10,loc:'creek'}]}
    }};
}
test('accepted direct observation updates knowledge and cites exchange',()=>{
  const s=world();const r=decideAction(s,{id:'exchange-1',verb:'observe',target:'Rangers'});
  assert.equal(r.status,'accepted');
  assert.ok(s.playerKnowledge.includes('Rangers observed'));
  assert.deepEqual(r.event.evidence_roots,['exchange-1']);
});
test('observation cannot leap a location boundary',()=>{
  const s=world();const r=decideAction(s,{id:'exchange-2',verb:'observe',target:'Riders'});
  assert.equal(r.status,'rejected');assert.equal(s.playerKnowledge.length,0);
});
test('unverified route cannot teleport player',()=>{
  const s=world();const r=decideAction(s,{id:'exchange-3',verb:'move',target:'old_town'});
  assert.equal(r.status,'qualified');assert.equal(s.actorZone,'creek');
});
test('verified route allows and records controlled change',()=>{
  const s=world();const r=decideAction(s,{id:'exchange-4',verb:'move',target:'old_town',route_verified:true});
  assert.equal(r.status,'accepted');assert.equal(s.actorZone,'old_town');
  assert.deepEqual(r.changes,[{object:'Player',property:'actorZone',from:'creek',to:'old_town'}]);
});
test('unsupported seizure is rejected, not narrated as success',()=>{
  const s=world();const r=decideAction(s,{id:'exchange-5',verb:'take',target:'Ranger horse'});
  assert.equal(r.status,'rejected');assert.deepEqual(r.changes,[]);
});
test('idempotent replay does not change state twice',()=>{
  const s=world();const a={id:'exchange-6',verb:'observe',target:'Rangers'};
  decideAction(s,a);const replay=decideAction(s,a);
  assert.equal(replay.status,'duplicate');assert.equal(s.events.length,1);
});
test('unknown actions are recorded as unresolved',()=>{
  const s=world();const r=decideAction(s,{id:'exchange-7',verb:'fly',target:'the moon'});
  assert.equal(r.status,'unresolved');assert.equal(s.events[0].status,'unresolved');
});
