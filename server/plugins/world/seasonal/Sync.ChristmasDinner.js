"use strict";

const Progress=require('./Progress.ChristmasDinner');
const Scene=require('./Scene.ChristmasDinner');
const Dialogue=require('./Dialogue.ChristmasDinner');

function refresh(api,{player}){
  const active=Scene.active()&&Dialogue.active();
  const state=Progress.read(player),sender=player.getPacketSender();
  const escorting=state.phase!=='new'&&state.phase!=='queue'&&state.customer<3;
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('xmas_25_npc_queue'),active?state.customer+(escorting?1:0):0);
  for(let table=0;table<4;table++){
    let value=0;
    const guest=state.seats.indexOf(table);
    if(active){
      if(guest>=0){
        value=guest<state.customer?3:['food-order','ingredients','cooked'].includes(state.phase)?2:1;
      }else if(state.phase==='table'||state.phase==='ready')value=1;
    }
    // Native archived loc morph indexes:0 empty/no-op,1 empty/Serve,
    //2 drink/Serve,3 dinner/no-op. No guessed quest-stage/client-script values.
    sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('xmas_25_table_id_'+(table+1)),value);
    // Original NPC parents independently morph their seat:0 empty stool,
    //1 Sir Prysin,2 Aggie,3 Jobless Jim. Table scenery alone cannot seat them.
    sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('xmas_25_seat_id_'+(table+1)),active?guest+1:0);
  }
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('xmas_25_bar_interactable'),active&&state.phase==='drink'?1:0);
}
function all(api){for(const player of api.core.World.getPlayers())if(player?.isRegistered())refresh(api,{player});}

module.exports={refresh,all};
