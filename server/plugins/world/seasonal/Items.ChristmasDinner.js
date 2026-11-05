"use strict";

const Progress=require('./Progress.ChristmasDinner');
const Dialogue=require('./Dialogue.ChristmasDinner');

function inspect(api,{player,itemId}){
  if(itemId!==Progress.platterId(api))return false;
  if(!player.isRegistered()||player.getHitpoints()<=0||player.busy()||!Progress.held(api,player))return true;
  const state=Progress.read(player);
  const serving=['drink','ingredients','cooked'].includes(state.phase);
  // Both variants contain only item messages. The canonical dialogue selector
  // uses the event's Cook identity; no NPC is fabricated or placed in the world.
  Dialogue.start(api,{player,npcId:api.core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef'),
    variant:serving?'serving-the-customers-inspecting-the-serving-platter':'starting-the-event-inspecting-the-serving-platter'});
  return true;
}
function destroyPrompt(api,event){
  if(event.item?.getId()!==Progress.platterId(api))return;
  // Serving platter Wiki infobox, revision15194281. The ordinary shared owner
  // still controls confirmation, slot validation, removal and cancellation.
  event.warning='You can get another from the Cook at the Blue Moon Inn.';
}

module.exports={inspect,destroyPrompt};
