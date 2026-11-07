"use strict";

const Progress=require('./Progress.ChristmasDinner');
const COSMETICS=Object.freeze(['xmas25_bib','xmas25_christmas_dinner','xmas25_beer_belly_sweater','xmas25_contest_jumper']);
// Wiki 2025 Christmas event (Rewards) and Partyhat set: two noted partyhat sets,
// two noted Santa hats and two noted Christmas crackers. The original video
// (zMOOL1CZhhk 6:31) shows individual noted hats instead; the Wiki wins
// (server/docs/agents/sources.md).
const RARES=Object.freeze(['cert_set_partyhat','cert_santa_hat','cert_christmas_cracker']);
// Christmas event rewards template15083464 intersected with Diango15318540 and
// active enum708's nonnegative catalogue slots. Negative enum keys are rare awards,
// not reclaim slots. Transformed gingerbread shields use their green base family.
const UNLOCKS=Object.freeze([
  'xmas_yoyo','win05_hat1','win05_scarf1','win05_hat2','win05_scarf2','win05_hat3','win05_scarf3','win05_hat4','win05_scarf4',
  'win05_marionette_complete_blue_alive','win05_marionette_complete_red_alive','win05_marionette_complete_green_alive',
  'gub_reindeer_hat','gub_wintumber_tree','black_partyhat','rainbow_partyhat',
  'santa_mask','santa_jacket','santa_pants','santa_gloves','santa_boots',
  'antisanta_mask','antisanta_jacket','antisanta_pants','antisanta_gloves','antisanta_boots',
  'black_santa_hat','inverted_santa_hat','xmas16_snowglobe','xmas16_sack','xmas16_chest',
  'xmas17_imp_head','xmas17_imp_body','xmas17_imp_legs','xmas17_imp_tail','xmas17_imp_gloves','xmas17_imp_boots','xmas17_wom_hat',
  'xmas18_hat','xmas18_top','xmas18_legs','xmas18_candycane','xmas19_shield_1','xmas20_boulder','xmas20_decor',
  'xm21_festive_slippers','xm21_festive_hat','xm21_snowman_ring','xm21_present_1',
  'xmas22_cape','xmas22_jumper','xmas22_goggles','xmas22_coal_sack',
  'xmas22_nutcracker_hat01','xmas22_nutcracker_torso01','xmas22_nutcracker_legs01','xmas22_nutcracker_feet01','xmas22_nutcracker_staff01','xmas22_santa_crown',
  'xmas23_helmet','xmas23_jumper','xmas24_present_hat_festive','xmas24_dog_mask','xmas24_festive_scarf','xmas24_dog_boots',
  ...COSMETICS,
]);
const EVENT_KEY='christmas-2025';
const REQUIRED_FREE_SLOTS=12;
const RARE_PLAY_SECONDS=25*60*60;
const scrolls=new WeakSet();
// IF_SETCOLOUR takes packed RGB555: red128 (the source scroll title), not RGB24.
const SCROLL_TITLE_COLOUR=16<<10;
// Wiki A Merry Christmas (Christmas2022), revision15353886; pinned jingle.sym
// jingle_297 and active index11 group297/file0, CRC2546897257.
const CHRISTMAS_COMPLETE_JINGLE=297;

function show(api,player){
  const cache=api.core.CacheDefinitions,sender=player.getPacketSender();
  sender.sendInterface(cache.getInterfaceId('eventscroll'));
  sender.sendString('Christmas Din-Dins at the Blue Moon Inn',cache.getComponentId('eventscroll:event_title'));
  sender.sendInterfaceColour(cache.getComponentId('eventscroll:event_title'),SCROLL_TITLE_COLOUR);
  sender.sendString('- Lovley Jubbly Bib<br>- Christmas Dinner<br>- Beer Belly Sweater<br>- Jad Jumper',cache.getComponentId('eventscroll:event_rewards'));
  sender.sendString('The Old School team wishes you Happy Holidays!',cache.getComponentId('eventscroll:event_farewell_text'));
  sender.sendInterfaceModel(cache.getComponentId('eventscroll:event_model'),Progress.platterId(api),10);
  sender.sendInterfaceModel(cache.getComponentId('eventscroll:event_type_model'),itemId(api,'santa_hat'),10);
  sender.sendJingle(CHRISTMAS_COMPLETE_JINGLE,0);
  scrolls.add(player);
}
function close(api,event){
  const {player}=event,cache=api.core.CacheDefinitions;
  if(!scrolls.has(player)||player.getInterfaceId()!==cache.getInterfaceId('eventscroll')||event.buttonId!==cache.getComponentId('eventscroll:close_button'))return;
  event.handled=true;
  if((event.opId??event.action)!==1)return;
  scrolls.delete(player);player.getPacketSender().sendInterfaceRemoval();
}

function itemId(api,symbol){
  const id=api.core.CacheDefinitions.getObjId(symbol);
  if(id===null)throw new Error('Missing Christmas reward '+symbol);
  return id;
}
function eligibleForRares(api,player){
  const request={player};api.emitCustomEvent('player:lifetime-seconds',request);
  return typeof request.seconds==='number'&&Number.isFinite(request.seconds)&&request.seconds>=RARE_PLAY_SECONDS;
}
function plan(api,player,revision){
  const state=Progress.read(player),inventory=player.getInventory();
  if(!player.isRegistered()||player.getHitpoints()<=0||state.phase!=='ready'||state.revision!==revision||
    state.customer!==3||!Progress.held(api,player)||inventory.getFreeSlots()<REQUIRED_FREE_SLOTS)return null;
  const copy=new api.core.Inventory(player).setItems(inventory.getCopiedItems());
  const platter=Progress.platterId(api),slot=inventory.getSlotForItemId(platter);
  // The copy is bound to the player: never refresh it, or the client sees a
  // platter-less inventory the server never committed.
  copy.deleteAtSlot(slot,1,false);
  const rewards=COSMETICS.map(symbol=>({symbol,id:itemId(api,symbol),amount:1}));
  if(eligibleForRares(api,player))for(const symbol of RARES)rewards.push({symbol,id:itemId(api,symbol),amount:2});
  for(const row of rewards){
    const item=new api.core.Item(row.id,row.amount);
    if(copy.getAddableAmount(item)!==row.amount)return null;
    copy.add(item,false);
  }
  return {items:copy.getItems(),rewards};
}

function claim(api,player,revision){
  // This plan keeps the event's own gates (progress, the platter, 12 free slots, rares
  // eligibility); EventScheduler's grant re-plans on the live inventory, takes the platter,
  // unlocks Diango's catalogue and records the once-per-account completion in one commit.
  const next=plan(api,player,revision);if(!next)return false;
  const grant={player,eventKey:EVENT_KEY,completion:EVENT_KEY,
    rewards:next.rewards.map(row=>({itemId:row.id,amount:row.amount})),
    take:[{itemId:Progress.platterId(api),amount:1}],unlock:[...UNLOCKS]};
  api.emitCustomEvent('events:grant-reward',grant);
  if(grant.granted!==true){
    // The completion is recorded but the progress is not (a rolled-back save): the rewards were
    // already given, so settle the progress rather than leave the dinner claimable forever.
    if(grant.reason==='already-complete')Progress.complete(api,player,revision);
    return false;
  }
  if(!Progress.complete(api,player,revision))throw new Error('Christmas completion changed during synchronous reward commit');
  for(const row of next.rewards.slice(0,COSMETICS.length))
    player.sendMessage("You've received a holiday item: <col=e00a19>"+api.core.CacheDefinitions.getItem(row.id).name);
  player.sendMessage("You've completed the Christmas event: Christmas Din-Dins at the Blue Moon Inn");
  player.sendMessage('Current and previous Christmas rewards have been unlocked at Diango in Draynor Village.');
  return true;
}

// Saves completed before EventScheduler kept completions are imported on login.
function importClaim(api,{player}){
  let state;try{state=Progress.read(player);}catch{return;}
  if(state.phase==='complete')api.emitCustomEvent('events:record-completion',{player,completion:EVENT_KEY});
}

module.exports={EVENT_KEY,importClaim,COSMETICS,RARES,UNLOCKS,REQUIRED_FREE_SLOTS,RARE_PLAY_SECONDS,eligibleForRares,plan,claim,show,close};
