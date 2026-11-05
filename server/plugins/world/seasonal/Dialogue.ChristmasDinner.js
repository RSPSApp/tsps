"use strict";

const Progress=require('./Progress.ChristmasDinner');
const PAGE='2025 Christmas event';
const SOURCE=require('../../../data/definitions/event-dialogues.json')[PAGE];
const BARTENDER_PAGE='Bartender (Blue Moon Inn)';
const BARTENDER_SOURCE=require('../../../data/definitions/npc-dialogues.json')[BARTENDER_PAGE];
const BARTENDER_VARIANTS=Object.freeze({
  new:'starting-the-event-talking-to-the-bartender-blue-moon-inn-before-starting-the-event',
  active:'starting-the-event-talking-to-the-bartender-after-starting-the-event',
  complete:'completing-the-event-talking-to-the-bartender-after-completing-the-event',
});
const CUSTOMERS=['Sir Prysin','Aggie','Jobless Jim'];
const sessions=new WeakMap();
let enabled=false,epoch=0;

function activate(event){if(event.key!=='christmas-2025')return;enabled=event.active===true;epoch++;}
function active(){return enabled;}
function clear({player,completion}){const session=sessions.get(player);if(completion&&session?.completion!==completion)return;session?.cancel?.();sessions.delete(player);}
function cancelAll(api){for(const player of api.core.World.getPlayers())if(player&&sessions.has(player))clear({player});}
function valid(player,session){return enabled&&session.epoch===epoch&&sessions.get(player)===session&&player.isRegistered()&&Progress.read(player).revision===session.revision&&(!session.guard||session.guard());}
function context(event){
  const session=sessions.get(event.player);
  if(!session||session.page!==PAGE||!event.pages?.some(row=>row.page===PAGE))return null;
  return session;
}
function abort(player,session){
  if(session.cancel){session.cancel();return;}
  player.getDialogueManager().reset();player.getPacketSender().sendInterfaceRemoval();
}
function transition(api,player,session,name,...args){
  if(!valid(player,session)||!Progress[name](api,player,session.revision,...args))return false;
  session.revision=Progress.read(player).revision;
  return true;
}
function start(api,{player,npc,npcId,variant,page=PAGE,select,...options}){
  const source=page===PAGE?SOURCE:page===BARTENDER_PAGE?BARTENDER_SOURCE:null;
  if(!enabled||!player.isRegistered()||!Array.isArray(source?.variants[variant]))return false;
  const previous=sessions.get(player),state=Progress.read(player);
  const session={...options,npc,page,variant,revision:state.revision,customer:state.customer,epoch};
  sessions.set(player,session);
  const request={player,npc,npcId:npc?.getCurrentDefinition(player)?.getId()??npc?.getId()??npcId,variant:{page,variant},exact:true};
  if(typeof select==='function')request.select=select;
  api.emitCustomEvent('npc-dialogue:start',request);
  if(!request.handled){if(previous)sessions.set(player,previous);else sessions.delete(player);return false;}
  previous?.cancel?.();session.cancel=request.cancel;
  return true;
}
function startBartender(api,event){
  const phase=Progress.read(event.player).phase;
  return start(api,{...event,variant:BARTENDER_VARIANTS[phase]??BARTENDER_VARIANTS.active});
}
function choice(api,event){
  const session=sessions.get(event.player);
  if(session?.page!==PAGE||!Object.values(BARTENDER_VARIANTS).includes(session.variant)||
    event.npc!==session.npc||event.npcId!==api.core.CacheDefinitions.getNpcId('bluemoon_bartender')||
    event.npc?.getPrivateArea?.()||event.npc?.getOwner?.())return;
  if(!valid(event.player,session)){session.cancel?.();return;}
  const menu=BARTENDER_SOURCE.variants[BARTENDER_SOURCE.default].find(step=>step.type==='choice');
  // Annual wording includes '?' on the equipment option; the ordinary source
  // omits it on its label. Play its original branch without changing either dump.
  const selected=menu.options.find(option=>option.text===event.option||option.text+'?'===event.option);
  if(!selected?.steps?.length){session.cancel?.();return;}
  // Handoff keeps the ordinary source page/step ids so its existing pub policy
  // owns payment and rewards. Cancelling the old playback stops its empty tail.
  if(!start(api,{player:event.player,npc:event.npc,page:BARTENDER_PAGE,variant:BARTENDER_SOURCE.default,
    select:()=>selected.steps}))session.cancel?.();
}
function substitute(text,state,session){
  const replacements={'[beverage]':state.drink??session.drink,'[main]':state.main??session.main,
    '[side 1]':state.sides[0]??session.sides?.[0],'[side 2]':state.sides[1]??session.sides?.[1],'[side 3]':state.sides[2]??session.sides?.[2],
    '[item]':state.drink,'[Customer]':CUSTOMERS[session.customer],
    '[main course]':state.main,'[sides]':state.sides.join(', ')};
  const remaining=[state.main,...state.sides].filter(item=>item&&!state.gathered.includes(item));
  text=text.replace('[item 1], [item 2], [item 3], [item 4]',remaining.join(', '));
  for(let index=0;index<4;index++)replacements[`[item ${index+1}]`]=remaining[index]??'';
  for(const [key,value] of Object.entries(replacements))if(value!=null)text=text.replaceAll(key,value);
  return text;
}
function condition(api,event){
  const session=context(event);if(!session)return;
  if(!valid(event.player,session))return false;
  const state=Progress.read(event.player),free=event.player.getInventory().getFreeSlots(),held=Progress.held(api,event.player),text=event.text.toLowerCase();
  const known={a4Cd_9:!held&&free===0,tDOH9m:!held&&free>=1,UBCMDT:free===0,
    jSVtqj:!['ingredients','cooked','ready'].includes(state.phase),QLFnhF:['ingredients','cooked'].includes(state.phase),PKCyjm:state.customer===3,
    Utvt5v:state.customer<3,Ev729v:state.customer===3,hHfv3V:state.phase==='drink'&&!state.drinkHeld,z1J2ZK:state.drinkHeld,
    a6ElNN:state.phase==='ingredients'&&state.gathered.length<4,JpGMyh:state.phase==='ingredients'&&state.gathered.length===4,'1xU3U5':state.phase==='cooked',
    Nt1rHh:free<=10,LVNkCf:free===11,uSR1LP:free>=12};
  if(Object.hasOwn(known,event.stepId))return known[event.stepId];
  if(text==='if the player needs to find another beverage:')return state.phase==='drink'&&state.drink!==session.drink;
  if(text.startsWith('if the player needs to find '))return state.phase==='drink'&&state.drink===session.drink&&!state.drinkHeld;
  const ingredient=[...Progress.MAINS,...Progress.SIDES].find(name=>text.includes(name));
  if(ingredient){
    const needed=state.main===ingredient||state.sides.includes(ingredient),already=state.gathered.includes(ingredient);
    if(text.includes('already has'))return already;
    if(text.includes('does not need'))return !needed;
    if(text.includes('needs'))return state.phase==='ingredients'&&needed&&!already;
  }
  // No guessed truth for an unimplemented source condition.
  return false;
}
function line(api,event){
  const session=context(event);if(!session)return;
  const state=Progress.read(event.player),original=String(event.text);
  if(session.completion&&typeof event.step.player!=='string')event.actors=[session.completion.cook];
  event.text=substitute(original,state,session);
  if(event.step.speaker==='[Customer]')event.speakerName=CUSTOMERS[session.customer];
  let before,after;
  if(session.completion&&original==="Here's your very own Christmas dinner!")after=()=>{
    api.emitCustomEvent('christmas-dinner:completion-delivered',{player:event.player});return true;
  };
  if(session.variant==='starting-the-event-talking-to-the-cook'&&state.phase==='new'&&Progress.held(api,event.player)&&original==='Fantastic! Now go deal with that queue!')after=()=>transition(api,event.player,session,'begin');
  if(session.variant==='serving-the-customers-talking-to-the-customer'&&original.startsWith('Let me show'))after=()=>{
    if(!session.escort)return transition(api,event.player,session,'greet',session.customer);
    if(!valid(event.player,session))return false;
    const request={player:event.player,npc:session.npc,customer:session.customer,revision:session.revision};
    api.emitCustomEvent('christmas-dinner:escort',request);
    if(!request.handled)return false;
    session.revision=Progress.read(event.player).revision;return true;
  };
  if(session.variant==='serving-the-customers-talking-to-the-customer-after-picking-a-table'&&original.includes('[beverage]'))before=()=>
    state.phase==='drink'&&state.drink===session.drink?true:transition(api,event.player,session,'orderDrink',session.drink);
  if(session.variant==='serving-the-customers-serving-the-table-after-getting-the-drink'&&original.startsWith('Here is your drink'))before=()=>transition(api,event.player,session,'serveDrink',session.table);
  // Once the guest has shown the order, Inspect and a resumed session must
  // retain it even when the player closes instead of pressing Continue.
  if(['serving-the-customers-serving-the-table-after-getting-the-drink','serving-the-customers-talking-to-the-customer-again-before-getting-the-order'].includes(session.variant)&&original.includes('[main]'))before=()=>transition(api,event.player,session,'orderFood',session.main,session.sides);
  if(session.variant==='serving-the-customers-serving-the-table-with-cooked-food'&&event.step.speaker==='[Customer]')after=()=>transition(api,event.player,session,'serveMeal',session.table);
  if(session.variant==='starting-the-event-talking-to-the-cook-after-losing-the-serving-tray'&&original.startsWith("Not a problem, here's"))before=()=>transition(api,event.player,session,'reclaim');
  event.before=()=>{if(!valid(event.player,session)||(before&&before()!==true))abort(event.player,session);};
  if(after)event.after=()=>{if(!valid(event.player,session)||after()!==true)abort(event.player,session);};
}
function action(api,event){
  const session=context(event);if(!session)return;
  if(!valid(event.player,session)){event.handled=true;event.end=true;return;}
  let result;
  if(event.stepId==='u4QvJB'){
    const request={player:event.player,table:session.table,object:session.object,revision:session.revision};
    api.emitCustomEvent('christmas-dinner:completion',request);
    event.handled=true;event.end=true;return;
  }
  if(event.stepId==='CiFo2c'){
    api.emitCustomEvent('christmas-dinner:completion-emote',{player:event.player});
    event.handled=true;event.end=true;return;
  }
  if(event.stepId==='HH56XK')result=transition(api,event.player,session,'begin');
  if(event.stepId==='dymMku'){event.handled=true;return;}
  if(event.kind==='message'){
    const text=String(event.text??'');
    if(['V0Ww8s','fiWwXq'].includes(event.stepId)){
      const missing=12-event.player.getInventory().getFreeSlots();
      event.player.sendMessage(`You need ${missing} more free inventory slot${missing===1?'':'s'} to receive your Christmas event rewards.`);
      event.handled=true;return;
    }
    if(text.startsWith('You grab ')&&session.variant.startsWith('serving-the-customers-searching-the-bar-'))result=transition(api,event.player,session,'takeDrink',session.drink);
    if(text.startsWith('You place ')){
      const ingredient=[...Progress.MAINS,...Progress.SIDES].find(name=>new RegExp('\\b'+name+'\\b','i').test(text));
      if(ingredient)result=transition(api,event.player,session,'collect',ingredient);
    }
    if(text.startsWith('The Cook loads up your serving platter'))result=transition(api,event.player,session,'cook');
    event.text=substitute(text,Progress.read(event.player),session);
    event.box={items:[Progress.platterId(api)]};
  }
  if(result===false){event.handled=true;event.end=true;}
}

module.exports={start,startBartender,choice,activate,active,clear,cancelAll,condition,line,action};
