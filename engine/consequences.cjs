'use strict';
// Deterministic consequence gate. No generative narration, no implied success.
// World state is supplied by the caller and mutated only after preconditions pass.
// Actions outside this bounded grammar are unresolved, never silently fulfilled.
function decideAction(state, action) {
  if(!state || !action || typeof action!=='object') throw new TypeError('state and action required');
  const actor=String(action.actor||'Player');
  const verb=String(action.verb||'').toLowerCase();
  const target=String(action.target||'');
  const id=String(action.id||'');
  if(!id) throw new TypeError('action id required');
  state.events ||= [];
  state.appliedIds ||= [];
  if(state.appliedIds.includes(id)) return {status:'duplicate',action_id:id,changes:[]};
  let status='unresolved', reason='No registered rule permits this action',changes=[];
  const at=String(state.actorZone||'unknown');
  const location=(name)=>{
    const plan=state.world?.[name]?.plan||[];
    return plan.find(p=>state.minute>=p.start&&state.minute<p.end)?.loc||'unknown';
  };
  if(actor!=='Player'){
    status='rejected';reason='Only player action requests are accepted by this gate';
  } else if(verb==='observe' && ['Rangers','Riders','JebWorld'].includes(target)){
    const there=location(target);
    if(there==='unknown'||at==='unknown'){
      status='unresolved';reason='Location evidence insufficient';
    } else if(there!==at){
      status='rejected';reason='Target is not co-located; no observation registered';
    } else {
      status='accepted';reason='Target co-located and directly observable';
      state.playerKnowledge ||= [];
      const marker=target+' observed';
      if(!state.playerKnowledge.includes(marker)){state.playerKnowledge.push(marker);changes=[{object:'Player',property:'knowledge',add:marker}];}
    }
  } else if(verb==='move' && ['creek','old_town','new_town'].includes(target)){
    if(at===target){status='qualified';reason='Already at requested location';}
    else if(!['creek','old_town','new_town'].includes(at)){
      status='unresolved';reason='Origin location is not established';
    } else if(!action.route_verified){
      status='qualified';reason='Route not verified: movement intention recorded, position unchanged';
    } else{
      status='accepted';reason='Registered traversable route';
      state.actorZone=target;changes=[{object:'Player',property:'actorZone',from:at,to:target}];
    }
  } else if(verb==='take'){
    status='rejected';reason='No evidence of ownership, access, or acquisition permission';
  }
  const event={id:'consequence-'+id,kind:'action_resolution',action_id:id,actor,verb,target,minute:state.minute,
    status,reason,changes,evidence_roots:[id],clock:{event_time:action.event_time||null,observation_time:null,ingestion_time:new Date().toISOString()}};
  // Record all decisions, including rejected and unresolved; mutation only for accepted.
  state.events.push(event);state.appliedIds.push(id);
  return {status,reason,changes,event};
}
module.exports={decideAction};
