"use strict";

// Wiki: 2025 Christmas event / Serving platter. This owns progression only;
// native dialogue/scene handlers decide when an evidenced action is reached.
const PROGRESS_ATTRIBUTE="christmas-dinner:progress";
const DRINKS=Object.freeze(['beer','dwarven stout','cider','wine','milk','chocolate milk','eggnog']);
const MAINS=Object.freeze(['chicken','beef','jubbly','nut roast','mushroom wellington','trout']);
const SIDES=Object.freeze(['potatoes','sprouts','cauliflower','broccoli','cabbage','peas','parsnips','carrots','stuffing']);
const PHASES=new Set(['new','queue','table','drink-order','drink','food-order','ingredients','cooked','ready','complete']);

function initial(){return {version:1,revision:0,phase:'new',customer:0,seats:[],drink:null,drinkHeld:false,main:null,sides:[],gathered:[]};}
function read(player){
  const raw=player.getAttribute(PROGRESS_ATTRIBUTE);
  if(raw===undefined||raw===null)return initial();
  if(raw.version!==1||!Number.isSafeInteger(raw.revision)||raw.revision<0||!PHASES.has(raw.phase)||
    !Number.isInteger(raw.customer)||raw.customer<0||raw.customer>3||!Array.isArray(raw.seats)||
    !Array.isArray(raw.sides)||!Array.isArray(raw.gathered))throw new Error('Invalid Christmas dinner progress');
  return {...raw,seats:[...raw.seats],sides:[...raw.sides],gathered:[...raw.gathered]};
}
function platterId(api){return api.core.CacheDefinitions.getArchivedId('christmas-2025','obj','xmas25_serving_platter');}
function held(api,player){const id=platterId(api);return id!==null&&player.getInventory().getAmount(id)>0;}
function givePlatter(api,player){
  const id=platterId(api);if(id===null)return false;
  if(held(api,player))return true;
  const inventory=player.getInventory(),item=new api.core.Item(id,1);
  if(inventory.getAddableAmount(item)!==1)return false;
  inventory.addItem(item);
  return inventory.getAmount(id)===1;
}
function save(api,player,state){
  state.revision++;player.setAttribute(PROGRESS_ATTRIBUTE,state);
  api.emitCustomEvent('christmas-dinner:changed',{player});return true;
}
function current(api,player,revision,phase){
  const state=read(player);
  return state.revision===revision&&state.phase===phase&&held(api,player)?state:null;
}
function begin(api,player,revision){
  const state=read(player);
  if(state.revision!==revision||state.phase!=='new'||!givePlatter(api,player))return false;
  state.phase='queue';return save(api,player,state);
}
function reclaim(api,player,revision){
  const state=read(player);
  if(state.revision!==revision||state.phase==='new'||state.phase==='complete'||held(api,player)||!givePlatter(api,player))return false;
  // A new physical platter is empty. The order remains known; collected food
  // and drinks cannot survive destruction/death as an invisible free meal.
  state.drinkHeld=false;state.gathered=[];
  if(state.phase==='cooked')state.phase='ingredients';
  return save(api,player,state);
}
function discard(api,{player,item}){
  if(item?.getId()!==platterId(api)||held(api,player))return;
  const state=read(player);
  state.drinkHeld=false;state.gathered=[];
  if(state.phase==='cooked')state.phase='ingredients';
  save(api,player,state);
}
function greet(api,player,revision,customer){
  const state=current(api,player,revision,'queue');
  if(!state||customer!==state.customer||customer>=3)return false;
  state.phase='table';return save(api,player,state);
}
function seat(api,player,revision,table){
  const state=current(api,player,revision,'table');
  if(!state||!Number.isInteger(table)||table<0||table>=4||state.seats.includes(table))return false;
  state.seats.push(table);state.phase='drink-order';return save(api,player,state);
}
function orderDrink(api,player,revision,drink){
  const state=current(api,player,revision,'drink-order');
  if(!state||!DRINKS.includes(drink))return false;
  state.drink=drink;state.phase='drink';return save(api,player,state);
}
function takeDrink(api,player,revision,drink){
  const state=current(api,player,revision,'drink');
  if(!state||state.drink!==drink||state.drinkHeld)return false;
  state.drinkHeld=true;return save(api,player,state);
}
function serveDrink(api,player,revision,table){
  const state=current(api,player,revision,'drink');
  if(!state||!state.drinkHeld||state.seats[state.customer]!==table)return false;
  state.drinkHeld=false;state.phase='food-order';return save(api,player,state);
}
function orderFood(api,player,revision,main,sides){
  const state=current(api,player,revision,'food-order');
  if(!state||!MAINS.includes(main)||!Array.isArray(sides)||sides.length!==3||new Set(sides).size!==3||!sides.every(side=>SIDES.includes(side)))return false;
  state.main=main;state.sides=[...sides];state.gathered=[];state.phase='ingredients';return save(api,player,state);
}
function collect(api,player,revision,ingredient){
  const state=current(api,player,revision,'ingredients');
  if(!state||![state.main,...state.sides].includes(ingredient)||state.gathered.includes(ingredient))return false;
  state.gathered.push(ingredient);return save(api,player,state);
}
function cook(api,player,revision){
  const state=current(api,player,revision,'ingredients');
  if(!state||state.gathered.length!==4||![state.main,...state.sides].every(item=>state.gathered.includes(item)))return false;
  state.phase='cooked';return save(api,player,state);
}
function serveMeal(api,player,revision,table){
  const state=current(api,player,revision,'cooked');
  if(!state||state.seats[state.customer]!==table)return false;
  state.customer++;state.phase=state.customer===3?'ready':'queue';
  state.drink=null;state.drinkHeld=false;state.main=null;state.sides=[];state.gathered=[];
  return save(api,player,state);
}

// The reward owner has already exchanged the physical platter when this runs.
function complete(api,player,revision){
  const state=read(player);
  if(state.revision!==revision||state.phase!=='ready'||state.customer!==3)return false;
  state.phase='complete';return save(api,player,state);
}

module.exports={PROGRESS_ATTRIBUTE,DRINKS,MAINS,SIDES,initial,read,held,platterId,begin,reclaim,discard,greet,seat,orderDrink,takeDrink,serveDrink,orderFood,collect,cook,serveMeal,complete};
