"use strict";

const Progress=require('./Progress.ChristmasDinner');
const Dialogue=require('./Dialogue.ChristmasDinner');
const Scene=require('./Scene.ChristmasDinner');
const Actors=require('./Actors.ChristmasDinner');

// Original map placements + Wiki15375309: west half south→north is
// beer/stout/cider; east half south→north eggnog/milk/chocolate milk/wine.
const BAR_DRINKS=Object.freeze({
  xmas25_bar_middle2:'beer',xmas25_bar_middle:'dwarven stout',xmas25_bar_middle3:'cider',
  xmas25_bar_drinks_left:'eggnog',xmas25_bar_drinks_middle:'milk',
  xmas25_bar_drinks_middle2:'chocolate milk',xmas25_bar_drinks_right:'wine',
});
// Original footage zMOOL1CZhhk2:28/2:43 shows vegetable sides and fish mains;
// LYhx7ksRL5E0:56/1:08 independently shows broccoli sides and meat mains.
// Other crates still require their own identity/path evidence.
const CRATE_VARIANTS=Object.freeze({
  xmas25_crate01_fish01:'serving-the-customers-searching-the-main-course-crate',
  xmas25_crate01_meat01:'serving-the-customers-searching-the-main-course-crate',
  xmas25_crate01_vegetable01:'serving-the-customers-searching-the-side-dish-crate',
  xmas25_crate01_broccoli01:'serving-the-customers-searching-the-side-dish-crate',
});
const GUESTS=Object.freeze(['xmas25_sir_prysin','xmas25_aggie','xmas25_jobless_jim']);
function serve(api,{player,object}){
  if(!Scene.active()||!Dialogue.active())return false;
  const row=Scene.objects().find(row=>row.object===object),match=/^xmas25_table_([1-4])$/.exec(row?.symbol??'');
  if(!match||!api.core.World.getObjects().includes(object))return false;
  if(!player.isRegistered()||player.getHitpoints()<=0||player.busy())return true;
  const state=Progress.read(player),table=Number(match[1])-1;
  if(state.phase==='table'&&Progress.held(api,player)&&!state.seats.includes(table)&&Actors.hasEscort(api,player))
    return Progress.seat(api,player,state.revision,table);
  let variant;
  if(!Progress.held(api,player))variant='serving-the-customers-attempting-to-serve-a-table-without-a-serving-platter-in-the-inventory';
  else if(state.phase==='ready'&&!state.seats.includes(table)&&!player.getPrivateArea())variant='completing-the-event-sitting-at-the-table';
  else if(state.seats[state.customer]!==table)variant='serving-the-customers-serving-a-table-when-no-customer-is-waiting';
  else if(state.phase==='ingredients')variant=state.gathered.length===4
    ?'serving-the-customers-attempting-to-serve-a-customer-before-the-ingredients-have-been-cooked'
    :'serving-the-customers-serving-the-table-after-getting-the-order';
  else if(state.phase==='cooked')variant='serving-the-customers-serving-the-table-with-cooked-food';
  // Seating/following and order generation need their own evidenced actor
  // routes. Do not manufacture an order or advance those phases here.
  if(!variant)return true;
  const npcId=api.core.CacheDefinitions.getArchivedId('christmas-2025','npc',GUESTS[state.customer])
    ??api.core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef');
  return Dialogue.start(api,{player,npcId,variant,table,object,
    guard:()=>Scene.active()&&Scene.objects().some(row=>row.object===object)&&api.core.World.getObjects().includes(object)});
}
function drink(api,{player,object}){
  if(!Scene.active()||!Dialogue.active())return false;
  const row=Scene.objects().find(row=>row.object===object),beverage=BAR_DRINKS[row?.symbol];
  if(!beverage||!api.core.World.getObjects().includes(object))return false;
  const state=Progress.read(player);
  if(!player.isRegistered()||player.getHitpoints()<=0||player.busy()||state.phase!=='drink'||!Progress.held(api,player))return true;
  const variant=state.drinkHeld?'serving-the-customers-searching-the-bar-searching-with-the-correct-drink-already'
    :'serving-the-customers-searching-the-bar-'+beverage.replaceAll(' ','-');
  return Dialogue.start(api,{player,npcId:api.core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef'),variant,drink:beverage});
}
function search(api,{player,object}){
  if(!Scene.active()||!Dialogue.active())return false;
  const row=Scene.objects().find(row=>row.object===object);
  if(!row?.symbol.startsWith('xmas25_crate01_')||!api.core.World.getObjects().includes(object))return false;
  if(!player.isRegistered()||player.getHitpoints()<=0||player.busy())return true;
  const state=Progress.read(player),npcId=api.core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef');
  if(state.phase==='new'||state.phase==='complete')return Dialogue.start(api,{player,npcId,
    variant:'completing-the-event-searching-food-crates-before-or-after-completing-the-event'});
  const variant=CRATE_VARIANTS[row.symbol];
  if(!variant)return false;
  if(state.phase!=='ingredients'||!Progress.held(api,player))return true;
  return Dialogue.start(api,{player,npcId,variant});
}

module.exports={serve,drink,search};
