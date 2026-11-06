"use strict";

const Progress=require('./seasonal/Progress.ChristmasDinner');
const Dialogue=require('./seasonal/Dialogue.ChristmasDinner');
const Scene=require('./seasonal/Scene.ChristmasDinner');
const Items=require('./seasonal/Items.ChristmasDinner');
const Npcs=require('./seasonal/Npcs.ChristmasDinner');
const Sync=require('./seasonal/Sync.ChristmasDinner');
const Objects=require('./seasonal/Objects.ChristmasDinner');
const Actors=require('./seasonal/Actors.ChristmasDinner');
const Completion=require('./seasonal/Completion.ChristmasDinner');
const Rewards=require('./seasonal/Rewards.ChristmasDinner');
const Music=require('./seasonal/Music.ChristmasDinner');
const Snow=require('./seasonal/Snow.ChristmasDinner');

// Set by our own shutdown hook. Shutdown hooks run in plugin load (path) order,
// so world/ChristmasDinner sets it before world/EventScheduler's stop() emits
// events:active false; that close must not take platters from the save.
let shuttingDown=false;

function calendar(api,event){
  if(event.key!=='christmas-2025')return;
  if(!event.active){Snow.cancelAll();Completion.cancelAll(api);Dialogue.activate(event);Dialogue.cancelAll(api);}
  const result=event.active?Scene.open(api):Scene.close(api);
  if(result.handled){if(event.active)Dialogue.activate(event);}
  else {Dialogue.activate({key:event.key,active:false});Dialogue.cancelAll(api);api.log('Christmas scene: '+result.error);}
  // A restart mid-event keeps platters in the save; the login sweep takes them
  // only if the event is closed by then.
  if(!event.active&&!shuttingDown)sweepOnline(api);
  Sync.all(api);
}
function sweepOnline(api){
  for(const player of api.core.World.getPlayers())if(player?.isRegistered())Items.sweep(api,{player});
}
function shutdown(api){shuttingDown=true;calendar(api,{key:'christmas-2025',active:false});}
function regionLoaded(api,event){
  const result=Scene.replay(api,event);
  if(!result.handled){Dialogue.activate({key:'christmas-2025',active:false});Dialogue.cancelAll(api);Sync.all(api);api.log('Christmas scene: '+result.error);}
}

// Plugins load by path, so objects/ScenerySearch registers its catch-all
// Crate Search ("find nothing of interest") before this world plugin. Claim
// only this scene's own crates ahead of every name handler; any other crate
// falls through to its ordinary owner.
function searchSceneCrate(api,event){
  if(String(event.option??'').toLowerCase()!=='search')return;
  if(Objects.search(api,event)!==false)event.handled=true;
}
function canBank(api,event){
  const platter=Progress.platterId(api);
  if(platter===null||event.item?.getId()!==platter)return;
  event.allow=false;
  // The Wiki establishes that the tool is unbankable, without recording the
  // rejection wording. This explanatory message is not capture evidence.
  event.player.sendMessage("You can't bank the serving platter.");
}

module.exports={
  name:'ChristmasDinner',
  register(api){
    api.registerArea(Music.createArea(api));
    api.persistAttribute(Progress.PROGRESS_ATTRIBUTE,Progress.initial());
    api.onPlayerLogin(Rewards.importClaim.bind(null,api));
    api.onPlayerLogin(Sync.refresh.bind(null,api));
    api.onPlayerLogin(Actors.login.bind(null,api));
    api.onPlayerLogin(Items.sweep.bind(null,api));
    api.onCustomEvent('christmas-dinner:changed',Sync.refresh.bind(null,api));
    api.onCustomEvent('christmas-dinner:changed',Actors.changed.bind(null,api));
    api.onCustomEvent('christmas-dinner:escort',Actors.escort.bind(null,api));
    api.onCustomEvent('christmas-dinner:completion',Completion.start.bind(null,api));
    api.onCustomEvent('christmas-dinner:completion-emote',Completion.emote.bind(null,api));
    api.onCustomEvent('christmas-dinner:completion-delivered',Completion.delivered.bind(null,api));
    api.onInterfaceActionClick(Rewards.close.bind(null,api));
    api.onCustomEvent('events:active',calendar.bind(null,api));
    api.onServerShutdown(shutdown.bind(null,api));
    api.onRegionLoaded(regionLoaded.bind(null,api));
    api.onNpcDialogueCondition(Dialogue.condition.bind(null,api));
    api.onBeforeNpcInteraction(Npcs.interact.bind(null,api));
    api.onObjectInteraction('Table',{Serve:Objects.serve.bind(null,api)});
    api.onObjectInteraction('Bar',{'Get Drink From':Objects.drink.bind(null,api)});
    api.onBeforeObjectInteraction(searchSceneCrate.bind(null,api));
    api.onObjectInteraction('Snowball pile',{'Take-from':Snow.take.bind(null,api)});
    api.onCustomEvent('npc-dialogue:line',Dialogue.line.bind(null,api));
    api.onCustomEvent('npc-dialogue:choice',Dialogue.choice.bind(null,api));
    api.onCustomEvent('npc-dialogue:action',Dialogue.action.bind(null,api));
    api.onCanBankItem(canBank.bind(null,api));
    api.onItemAction('Serving platter',{Inspect:Items.inspect.bind(null,api)});
    api.onCustomEvent('destroy-item:prompt',Items.destroyPrompt.bind(null,api));
    api.onCustomEvent('item:discarded',Progress.discard.bind(null,api));
    api.onPlayerLogout(Dialogue.clear);
    api.onPlayerDisconnect(Dialogue.clear);
    api.onPlayerLogout(Snow.clear);
    api.onPlayerDisconnect(Snow.clear);
    api.onPlayerLogout(Actors.clear.bind(null,api));
    api.onPlayerDisconnect(Actors.clear.bind(null,api));
    api.onPlayerLogout(Completion.clear.bind(null,api));
    api.onPlayerDisconnect(Completion.clear.bind(null,api));
  },
};
