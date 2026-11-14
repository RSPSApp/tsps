/** Optional Wiki reward: Kuradal's notes grant Slayer XP once and unlock demonbane crafting. */
module.exports=function registerRewards({api,stage,held,give,val,play,ATTRIBUTES}){
 const {Skill,Bank,Task,TaskManager,HitDamage,HitMask}=api.core;
 const NOTES=29596,KURADAL=13623,RECEIVED='while-guthix-sleeps:duradel-notes',READ='while-guthix-sleeps:duradel-notes-read';
 ATTRIBUTES.push(RECEIVED,READ);
 // Tormented synapse weapons. Captured (rsprox.net recordings 3315 ticks 438-1776 and 3333 ticks
 // 11847-12149, rev 235; 3314 tick 486): Inspect's player lines, the anvil's and the Arclight's
 // refusals, and each result's objectbox with sound 4545, at +5 (bow) or +6 (anvil) ticks. The
 // Wiki (Tormented synapse) gives the levels, the hammer and the 730/73 XP. Ours: the refusals for
 // unread notes, a missing hammer, low levels and Emberlight's charges, and the pick when both an
 // Arclight and a battlestaff are carried; live consumes the bow and the staff's materials at once,
 // ours at the result, so an interrupted craft keeps them.
 const SYNAPSE=29580,HAMMER=2347,IRON_BAR=2351,SCORCHING_BOW=29591,PURGING_STAFF=29594,EMBERLIGHT=29589;
 const CRAFT_SOUND=4545,CHATQUIZ2=555,CHATQUIZ3=556,HUMAN_SMITHING=898,STRINGING_MAGIC_LONGBOW=6689;
 const recipes=[
  {name:'scorching bow',output:SCORCHING_BOW,base:[70],skill:Skill.FLETCHING,ticks:5,anims:[[0,STRINGING_MAGIC_LONGBOW]],made:'while-guthix-sleeps:made-scorching-bow',
   text:'You string the synapse onto the bow. The magical wood burns from the inside, twisting and cracking before settling into a gently smouldering state.'},
  {name:'purging staff',output:PURGING_STAFF,base:[1391],skill:Skill.CRAFTING,ticks:6,anims:[[0,HUMAN_SMITHING],[3,HUMAN_SMITHING]],anvil:true,made:'while-guthix-sleeps:made-purging-staff',
   text:"You hammer the metal onto the battlestaff's tip, forming a brazier. You then insert the synapse into the brazier. The metal turns red hot and the wood smoulders into hardened ash."},
  {name:'Emberlight',output:EMBERLIGHT,base:[19675,30305],skill:Skill.SMITHING,ticks:6,anims:[[0,HUMAN_SMITHING],[3,HUMAN_SMITHING]],anvil:true,made:'while-guthix-sleeps:made-emberlight',
   text:'The synapse writhes as you hammer it into the sword, flaring fire throughout it. Shards of crystal break off, but what remains hardens into a burning, obsidian-like material.'},
 ];
 const NEED_IRON_BAR='You need an iron bar to do that.';
 const NEED_BASE='You require either a battlestaff and an iron bar or Arclight to make a weapon out of this.';
 const SLIDES_OFF='You try to attach the synapse to the sword. The blade sizzles for a moment, but the synapse just slides off it again.';
 const INSPECT_UNREAD="I'm not sure what to do with this... Maybe I could ask one of the heroes that confronted Lucien for some ideas.";
 const INSPECT_READ="Duradel's notes mentioned creating a weapon out of demon parts... Maybe I should try it with this.";
 ATTRIBUTES.push(...recipes.map(r=>r.made));
 const crafting=new WeakSet();
 function possessed(p){return held(p,NOTES)||Array.from({length:Bank.TOTAL_BANK_TABS},(_,i)=>p.getBank(i)).some(bank=>bank.contains(NOTES));}
 /** The objectbox (one item) or objectbox_double (two), as captured; the box writes its mesbox chat line. */
 function box(p,items,text){
  const {DialogueChainBuilder,ItemStatementDialogue,DoubleItemStatementDialogue,EndDialogue}=api.core;
  const chain=new DialogueChainBuilder().add(items.length>1?new DoubleItemStatementDialogue(0,items[0],items[1],text):new ItemStatementDialogue(0,items[0],text));
  chain.add(new EndDialogue(1));p.getDialogueManager().startDialogues(chain);
 }
 function inspect({player:p}){
  const {DialogueChainBuilder,PlayerDialogue,EndDialogue}=api.core,read=!!val(p,READ);
  p.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0,read?INSPECT_READ:INSPECT_UNREAD,read?CHATQUIZ2:CHATQUIZ3)).add(new EndDialogue(1)));
 }
 function talk({player:p,npcId}){if(npcId!==KURADAL||stage(p)<900)return false;play(p,npcId,'post-quest-dialogue-talking-to-kuradal');return true;}
 function condition({player:p,stepId,pages}){
  if(!['omXWyi','yU0Tl1','lIknwQ','vhO3yX','5OgFOR','zVDDzY'].includes(stepId)||stage(p)<900||!pages?.some(v=>v.page.replace(/^Transcript:/,'')==='While Guthix Sleeps'))return;
  const received=val(p,RECEIVED)||possessed(p)||val(p,READ),lost=received&&!val(p,READ)&&!possessed(p),space=p.getInventory().getFreeSlots()>0;
  return {omXWyi:!received,yU0Tl1:!!received&&!lost,lIknwQ:!!lost,vhO3yX:!space,'5OgFOR':space,zVDDzY:!space}[stepId];
 }
 function action(e){if(e.npcId===KURADAL&&e.stepId==='PGNPip'&&stage(e.player)>=900&&!val(e.player,READ)&&!possessed(e.player)&&give(e.player,NOTES)){e.player.setAttribute(RECEIVED,1);e.box={items:[NOTES]};}}
 function read(e){
  const p=e.player;if(e.itemId!==NOTES||String(e.option).toLowerCase()!=='read'||stage(p)<900)return;e.handled=true;
  if(!held(p,NOTES))return;p.getInventory().deleteNumber(NOTES,1);
  if(val(p,READ))return;p.setAttribute(READ,1);p.setAttribute(RECEIVED,1);
  p.getSkillManager().addExperience(Skill.SLAYER,15*p.getSkillManager().getCurrentLevel(Skill.SLAYER));
  p.sendMessage('Duradel’s notes reveal how to create emberlight, the scorching bow and the purging staff from tormented synapses.');
 }
 function ready(p,r){
  if(stage(p)<900||!val(p,READ)){p.sendMessage('Read Duradel’s notes before working with tormented synapses.');return false;}
  const inv=p.getInventory(),manager=p.getSkillManager();
  if(!held(p,SYNAPSE)||!r.base.some(id=>held(p,id)))return false;
  if(r.output===PURGING_STAFF&&!held(p,IRON_BAR)){box(p,[IRON_BAR],NEED_IRON_BAR);return false;}
  if(r.anvil&&!held(p,HAMMER)){p.sendMessage('You need a hammer to work at the anvil.');return false;}
  if(r.output===PURGING_STAFF&&manager.getMaxLevel(Skill.SMITHING)<55){p.sendMessage('You need an unboosted Smithing level of 55.');return false;}
  if(manager.getCurrentLevel(r.skill)<74){
   if(p.getHitpoints()<6){p.sendMessage("I'm not sure I want to try that when I'm this injured.");return false;}
   p.getCombat().getHitQueue().addPendingDamage([new HitDamage(4,HitMask.RED)]);
   p.sendMessage('You burn yourself. You need level 74 '+r.skill.getName()+' to make '+r.name+'.');return false;
  }
  if(r.output===EMBERLIGHT){
   const sword=inv.getItems().find(i=>i&&r.base.includes(i.getId())),s=require('../../items/Arclight.plugin').state(sword);
   if(s.charges+s.infusion<10000){p.sendMessage('Your Arclight needs 10,000 combined charges and infusion to make Emberlight.');return false;}
  }
  return true;
 }
 function craft(p,r){
  if(crafting.has(p)||!ready(p,r))return;
  const inventory=p.getInventory(),synapse=inventory.getItems().find(i=>i?.getId()===SYNAPSE),base=inventory.getItems().find(i=>i&&r.base.includes(i.getId())),origin=p.getLocation().clone();
  crafting.add(p);p.getSkillManager().stopSkillable();
  let tick=0;const task=new Task(1,p);
  const animate=()=>r.anims.forEach(([at,id])=>{if(at===tick)p.performAnimation(new api.core.Animation(id));});
  animate();
  task.execute=()=>{
   tick++;
   const gone=!p.isRegistered()||p.getHitpoints()<=0||!p.getLocation().equals(origin);
   if(gone){task.stop();crafting.delete(p);return;}
   if(tick<r.ticks){animate();return;}
   task.stop();crafting.delete(p);
   if(!inventory.getItems().includes(synapse)||!inventory.getItems().includes(base)||synapse.getId()!==SYNAPSE||!r.base.includes(base.getId())||!ready(p,r))return;
   inventory.deleteNumber(base.getId(),1);if(r.output===PURGING_STAFF)inventory.deleteNumber(IRON_BAR,1);
   synapse.setId(r.output);inventory.refreshItems();
   p.getSkillManager().addExperience(r.skill,val(p,r.made)?73:730);
   if(r.output===PURGING_STAFF)p.getSkillManager().addExperience(Skill.SMITHING,13);
   p.setAttribute(r.made,1);p.getPacketSender().sendSound(CRAFT_SOUND,1,0);box(p,[r.output],r.text);
  };
  TaskManager.submit(task);
 }
 function pair(e){
  const ids=[e.usedItemId,e.usedWithItemId];if(!ids.includes(SYNAPSE))return;
  const r=recipes.find(r=>r.base.some(id=>ids.includes(id)));if(!r)return;
  e.handled=true;
  // Captured: a battlestaff is made into the staff only at an anvil.
  if(r.output===PURGING_STAFF){e.player.sendMessage('Nothing interesting happens.');return;}
  if(r.output===EMBERLIGHT){box(e.player,[SYNAPSE,ids.find(id=>id!==SYNAPSE)],SLIDES_OFF);return;}
  craft(e.player,r);
 }
 function anvil(e){
  if(e.itemId!==SYNAPSE||api.core.ObjectDefinition.forPlayer(e.objectId,e.player)?.getName()!=='Anvil')return;
  e.handled=true;const available=recipes.filter(r=>r.anvil&&r.base.some(id=>held(e.player,id)));
  if(!available.length){box(e.player,[SYNAPSE],NEED_BASE);return;}
  if(available.length===1){craft(e.player,available[0]);return;}
  api.sendMultiChatboxPrompt(e.player,'What would you like to make?',...available.flatMap(r=>[r.name,()=>craft(e.player,r)]));
 }
 function revert({player:p,item}){
  const r=recipes.find(r=>r.output===item.getId());if(!r)return false;
  api.sendMultiChatboxPrompt(p,'Revert this weapon? Only the tormented synapse is returned.','Yes.',()=>{
   if(item.getId()===r.output&&p.getInventory().getItems().includes(item)){item.setId(SYNAPSE);p.getInventory().refreshItems();}
  },'No.',()=>{});
 }
 api.onNpcInteraction('Kuradal',{'Talk-to':talk});api.onNpcDialogueCondition(condition);
 api.onCustomEvent('npc-dialogue:action',action);api.onItemAction(read);
 api.onItemOnItem(pair,{noted:false});api.onItemOnObject(anvil,{noted:false});
 api.onItemAction('Tormented synapse',{Inspect:inspect});api.onItemAction('Scorching bow',{Revert:revert});api.onItemAction('Purging staff',{Revert:revert});api.onItemAction('Emberlight',{Revert:revert});
 return {condition,action,read,ready,craft,pair,anvil,revert,inspect,recipes};
};
