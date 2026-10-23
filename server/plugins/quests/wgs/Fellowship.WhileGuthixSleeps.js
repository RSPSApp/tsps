/** OSRS Wiki fellowship: mercenaries, spy, enriched seed, and seven heroes. */
module.exports=function registerFellowship({api,stage,advance,held,give,val,play,hit,ATTRIBUTES}){
 const {Area,PrivateArea,Boundary,Location,HitDamage,HitMask,PrayerHandler,World}=api.core;
 const MERCENARIES_ATTRIBUTE='while-guthix-sleeps:mercenaries-defeated', RECRUITS_ATTRIBUTE='while-guthix-sleeps:recruits';
 const SEED_ATTRIBUTE='while-guthix-sleeps:seed-on-counter',FREE_SEED_ATTRIBUTE='while-guthix-sleeps:free-seed',HERB_PICKED_ATTRIBUTE='while-guthix-sleeps:herb-picked';
 const DRAYNOR_ATTRIBUTE='while-guthix-sleeps:draynor-teleport',SARIM_ATTRIBUTE='while-guthix-sleeps:sarim-teleport';
 const SKETCHED_ATTRIBUTE='while-guthix-sleeps:spy-sketched';
 const SPY_ALERT_ATTRIBUTE='while-guthix-sleeps:spy-alert-until';
 ATTRIBUTES.push(MERCENARIES_ATTRIBUTE,RECRUITS_ATTRIBUTE,SEED_ATTRIBUTE,FREE_SEED_ATTRIBUTE,DRAYNOR_ATTRIBUTE,SARIM_ATTRIBUTE,SKETCHED_ATTRIBUTE);
 api.persistAttribute(HERB_PICKED_ATTRIBUTE, 0);
 const IDRIA=13540,WOOD_IDRIA=13542,THAERISK=13511,AKRISAE=13543,SILIF=13519;
 const MERCENARIES=[13535,13536,13537],SPY=13545,CAPTIVE=13546,OUTSIDER=13555,DRUID=13554;
 const TELEORB=29536,SEED=5300,ENRICHED_SEED=29538,ENRICHED_HERB=29530;
 const DYE=6955,LENS=4542,ROSE_LENS=6956,SERUM=29532,SUPER_SERUM=29531,SKETCH=29533;
 const PAPYRUS=970,CHARCOAL=973,COINS=995,DIBBER=5343;
 const COUNTERS=[53285,53286,53287],PATCHES=[53290,53291,53292],CELL=53281,DRAWERS=[53306,53307];
 const FIRST=['Turael','Mazchna','Duradel','Cyrisus'],SECOND=['Ghommal','Harrallak Menarous','Sloane'];
 const RECRUIT_IDS=[13618,13620,13622,13559,13613,13615,13616];
 const PREFIX='forming-a-fellowship-',battles=new WeakMap(),actors=new WeakMap();
 function atCastle(p){const l=p.getLocation();return l.getX()>=2948&&l.getX()<=3000&&l.getY()>=3328&&l.getY()<=3355;}
 function sync(p){
  const r=val(p,RECRUITS_ATTRIBUTE);
  if(stage(p)===280&&(r&15)===15)advance(p,300);
  if(stage(p)===320&&(r&127)===127)advance(p,340);
  const s=stage(p);
  p.getPacketSender().sendVarbit(10782,s>=650?2:s>=300?1:0);
  p.getPacketSender().sendVarbit(10792,s>=650?2:s>=340?1:0);
  p.getPacketSender().sendVarbit(10781,stage(p)>=300?2:stage(p)>=280?1:0);
  if(s>=250&&s<280)p.getPacketSender().sendVarbit(1537,val(p,SEED_ATTRIBUTE)===2?3:val(p,SEED_ATTRIBUTE)===1?2:0);
  if(s>=220&&s<900)p.getPacketSender().sendVarbit(10839,1);
 }
 function removeActors(p){for(const n of actors.get(p)||[])api.removeNpc(n);actors.delete(p);}
 function mapChange({player}){
  removeActors(player);sync(player);
  const s=stage(player),l=player.getLocation(),spawns=[];
  if((l.getX()>>6)===46&&(l.getY()>>6)===52&&s>=220&&s<=900){
   spawns.push([IDRIA,2989,3343,0],[AKRISAE,2989,3342,0],[THAERISK,2990,3342,0],[SILIF,2990,3343,0]);
   if(s>=250)spawns.push([s>=620?13548:CAPTIVE,2987,3343,0]);
   if(s>=280&&s<320)spawns.push([DRUID,2963,3338,3]);
  }else if(s===230&&l.getX()>=3070&&l.getX()<=3110&&l.getY()>=3220&&l.getY()<=3270)spawns.push([SPY,3096,3248,0],[OUTSIDER,3088,3251,0]);
  else if(s===210&&l.getX()>=2630&&l.getX()<=2675&&l.getY()>=3475&&l.getY()<=3515)spawns.push([WOOD_IDRIA,2657,3504,0]);
  if(spawns.length)actors.set(player,spawns.map(([id,x,y,z])=>api.spawnNpc({id,x,y,z,wanderRadius:0,owner:player,ownerOnly:true})));
 }
 class MercenaryBattle extends PrivateArea{
  constructor(p){super([new Boundary(2635,2670,3478,3510,0)]);this.player=p;this.enemies=[];this.ticks=0;this.started=false;}
  isMulti(){return true;}
  process(m){
   if(m!==this.player||!this.started)return;const p=this.player;this.ticks++;
   this.enemies.forEach((n,i)=>{
    if(!n||n.getHitpoints()<=0||n.getArea?.()===null||(n.getIndex&&(n.getIndex()<0||World.getNpcs().get(n.getIndex())!==n))){p.setAttribute(MERCENARIES_ATTRIBUTE,val(p,MERCENARIES_ATTRIBUTE)|(1<<i));return;}
    if(i===2&&n.getHitpoints()<30){p.setAttribute(MERCENARIES_ATTRIBUTE,val(p,MERCENARIES_ATTRIBUTE)|4);api.removeNpc(n);this.enemies[i]=null;return;}
    n.getCombat().getLastAttack().reset();
    if(this.ticks%5===0){const prayer=i===2?PrayerHandler.PROTECT_FROM_MAGIC:PrayerHandler.PROTECT_FROM_MELEE;hit(p,p.getPrayerActive()[prayer]?0:Math.floor(Math.random()*19));}
    // Idria also fights; waiting for her is an explicit Wiki route.
    if(this.ticks%8===0)n.getCombat().getHitQueue().addPendingDamage([new HitDamage(8,HitMask.RED)]);
   });
   if(val(p,MERCENARIES_ATTRIBUTE)===7){advance(p,210);p.sendMessage('The mercenaries have been defeated. Speak to Idria.');this.leave(p,false);p.moveTo(new Location(2657,3501,0));mapChange({player:p});}
  }
  postLeave(m,logout){if(m===this.player){for(const n of this.enemies)if(n)api.removeNpc(n);if(this.idria)api.removeNpc(this.idria);battles.delete(m);}super.postLeave(m,logout);}
 }
 function ambush(p){
  if(battles.has(p))return;const area=new MercenaryBattle(p);battles.set(p,area);area.enter(p);
  area.idria=api.spawnNpc({id:WOOD_IDRIA,x:2657,y:3504,z:0,wanderRadius:0,owner:p,ownerOnly:true});area.enter(area.idria);
  MERCENARIES.forEach((id,i)=>{if(val(p,MERCENARIES_ATTRIBUTE)&(1<<i))return;const n=api.spawnNpc({id,x:2654+i*2,y:3502,z:0,wanderRadius:0,owner:p,ownerOnly:true});n.setMaxHitpoints(i===2?100:140).setHitpoints(i===2?100:140).setScriptedMovement(true);area.enter(n);area.enemies[i]=n;});
  play(p,WOOD_IDRIA,PREFIX+'arriving-at-mcgrubor-s-wood');
 }
 class McGruborArrival extends Area{
  constructor(){super([new Boundary(2650,2661,3497,3505,0)]);}
  process(m){if(m.isPlayer?.()&&stage(m)===200)ambush(m);}
 }
 function talk({player,npcId}){
  const s=stage(player);
  if(npcId===WOOD_IDRIA&&s===210){play(player,npcId,PREFIX+'talking-to-idria');return true;}
  if([SPY,OUTSIDER].includes(npcId)&&s===230){player.setAttribute(SPY_ALERT_ATTRIBUTE,Date.now()+30000);play(player,npcId,PREFIX+'capturing-a-spy-talking-to-a-'+(npcId===SPY?'shady-stranger':'suspicious-outsider'));return true;}
  if(npcId===CAPTIVE&&s>=250&&s<=310){
   if(s<300){play(player,npcId,PREFIX+'capturing-a-spy-talking-to-the-shady-stranger-after-the-truth-serum-breaks');return true;}
   if(player.getLocation().getX()>=2988){player.sendMessage('Go inside the cell to speak privately with the stranger.');return true;}
   let v='using-the-serum-talking-to-the-shady-stranger-while-inside-the-cell-with-the-serum';
   if(s===310)v+='-talking-to-the-shady-stranger-again-'+(val(player,SKETCHED_ATTRIBUTE)||held(player,SKETCH)?'after-sketching-the-suspect':held(player,PAPYRUS)&&held(player,CHARCOAL)?'with-the-materials-to-make-a-sketch':'without-the-materials-to-make-a-sketch');
   else if(!held(player,SUPER_SERUM)){player.sendMessage('Bring the super truth serum to the spy.');return true;}
   play(player,npcId,PREFIX+v);return true;
  }
  // The druid at the enriched snapdragon patch replaces a lost harvest.
  if (npcId === DRUID) {
   if (s >= 300) {
    const herbWasPicked = val(player, HERB_PICKED_ATTRIBUTE) > 0;
    const variant = herbWasPicked
     ? held(player, ENRICHED_HERB)
      ? 'after-picking-the-herb'
      : 'after-losing-the-herb'
     : '';
    play(
     player,
     npcId,
     PREFIX + 'using-the-serum-talking-to-the-druid' + (variant ? `-${variant}` : '')
    );
    if (herbWasPicked && !held(player, ENRICHED_HERB)) give(player, ENRICHED_HERB);
    return true;
   }
   if (s >= 280) {
    player.sendMessage('The enriched snapdragon is growing. Recruit the four heroes while it grows.');
    return true;
   }
   return false;
  }
  if(![IDRIA,THAERISK,AKRISAE].includes(npcId)||!atCastle(player)||s<220||s>=400)return false;
  const who=npcId===IDRIA?'idria':npcId===AKRISAE?'akrisae':'thaerisk';let v;
  if(s===220)v='capturing-a-spy-talking-to-thaerisk-idria-or-akrisae';
  else if(s===240)v='capturing-a-spy-talking-to-the-group-after-planting-a-teleorb';
  else if(s===230)v='capturing-a-spy-talking-to-'+who+'-after-receiving-the-teleorb';
  else if(s<280)v=npcId===THAERISK&&held(player,ENRICHED_SEED)?'making-a-replacement-serum-talking-to-thaerisk-with-the-enriched-seed':'capturing-a-spy-talking-to-'+who+'-after-the-truth-serum-breaks';
  else if(s===280)v=npcId===IDRIA?'first-recruitment-talking-to-idria-after-planting-the-seed':'making-a-replacement-serum-talking-to-thaerisk-after-planting-the-enriched-seed';
  else if(s===300){
   if(npcId===THAERISK)v='using-the-serum-talking-to-thaerisk-'+(held(player,ENRICHED_HERB)?'with-the-herb':held(player,SERUM)?'after-receiving-the-truth-serum':held(player,SUPER_SERUM)?'with-the-serum':'after-speaking-to-idria');
   else v='using-the-serum-talking-to-'+(npcId===IDRIA?'idria-after-recruiting-the-first-set-of-heroes':'akrisae-after-speaking-to-idria');
  }else if(s===310)v=npcId===IDRIA&&held(player,SKETCH)?'second-recruitment-talking-to-the-group-after-talking-to-the-spy':'using-the-serum-talking-to-'+who+'-before-making-the-sketch';
  else if(s===320)v='second-recruitment-talking-to-'+(npcId===AKRISAE?'akrisae-after-getting-the-second-recruitment-task-but-before-finishing-recruitment':'idria-after-getting-the-second-recruitment-task');
  else v='second-recruitment-talking-to-'+(npcId===IDRIA?'idria-after-recruiting-the-second-set-of-heroes':'the-akrisae-after-all-the-heroes-are-assembled');
  play(player,npcId,PREFIX+v);return true;
 }
 function betty({player,npcId}){
  if(stage(player)<250||stage(player)>=280)return false;
  const c=val(player,SEED_ATTRIBUTE);play(player,npcId,PREFIX+'making-a-replacement-serum-talking-to-betty'+(c===2?'-after-creating-the-enriched-seed':c===3?'-after-taking-the-enriched-seed':c?'-talking-to-betty-again':''));return true;
 }
 function recruitName(p,name){
  const i=[...FIRST,...SECOND].indexOf(name),s=stage(p);if(i<0||(i<4?s<280||s>310:s<320||s>=400))return false;
  const slug=name.toLowerCase().replace(/ /g,'-');play(p,RECRUIT_IDS[i],PREFIX+(i<4?'first':'second')+'-recruitment-talking-to-'+slug+((i!==3&&(val(p,RECRUITS_ATTRIBUTE)&(1<<i)))?'-talking-to-'+slug+'-again':''));return true;
 }
 function recruit({player,npc,definition}){return recruitName(player,(definition??npc.getCurrentDefinition(player)).getName());}
 function contacts(e){if(stage(e.player)>=280&&stage(e.player)<=310)for(const name of FIRST)if(!e.contacts.includes(name))e.contacts.push(name);}
 function selected(e){if(FIRST.includes(e.name)&&recruitName(e.player,e.name))e.handled=true;}
 function line(e){
  const {player,text}=e,s=stage(player);
  if(s===200&&text==='Kill the Armadyl-worshipping scum!'){const battle=battles.get(player);if(battle)e.after=()=>{battle.started=true;};return;}
  if(s<280||s>=400)return;
  const endings=["Eh, you know what... I'm in!",'I would be glad to','It seems my years of waiting','Then I shall join you there.','I will need to make arrangements','I will join you there as soon as I', 'If by lending my axe'];
  const i=RECRUIT_IDS.indexOf(e.npcId);
  if(i>=0&&text.startsWith(endings[i]))e.after=()=>{player.setAttribute(RECRUITS_ATTRIBUTE,val(player,RECRUITS_ATTRIBUTE)|(1<<i));sync(player);};
 }
 function action({player,stepId}){
  const s=stage(player);if(s<200||s>=400)return;
  if(stepId==='M-1iYQ'&&s===210){advance(player,220);mapChange({player});}
  if(stepId==='-nHiI-'&&s===220&&give(player,TELEORB))advance(player,230);
  if(stepId==='uTUT10'&&!val(player,DRAYNOR_ATTRIBUTE)){player.setAttribute(DRAYNOR_ATTRIBUTE,1);player.moveTo(new Location(3093,3248,0));mapChange({player});}
  if(stepId==='IEZmjv'&&s===240){advance(player,250);mapChange({player});}
  if(stepId==='z_F_Aq'&&!val(player,FREE_SEED_ATTRIBUTE)&&give(player,SEED))player.setAttribute(FREE_SEED_ATTRIBUTE,1);
  if(['PZqoXK','wgs-sarim-after-seed'].includes(stepId)&&!val(player,SARIM_ATTRIBUTE)){player.setAttribute(SARIM_ATTRIBUTE,1);player.moveTo(new Location(3013,3258,0));}
  if(stepId==='1fOFAG'&&held(player,SEED)){player.getInventory().deleteNumber(SEED,1);player.setAttribute(SEED_ATTRIBUTE,1);sync(player);}
  if(stepId==='PilX__'&&player.getInventory().getAmount(COINS)>=20&&player.getInventory().getFreeSlots()){player.getInventory().deleteNumber(COINS,20);player.getInventory().adds(DYE,1);}
  if(stepId==='btLOw_'&&held(player,ENRICHED_HERB))give(player,SERUM);
  if(stepId==='gZGuU3'&&s===300&&held(player,SUPER_SERUM)){player.getInventory().deleteNumber(SUPER_SERUM,1);advance(player,310);}
  if(['_-H5WQ','SqlKov'].includes(stepId)&&s===310&&!held(player,SKETCH)&&held(player,PAPYRUS)&&held(player,CHARCOAL)){player.getInventory().deleteNumber(PAPYRUS,1);player.getInventory().deleteNumber(CHARCOAL,1);player.getInventory().adds(SKETCH,1);player.setAttribute(SKETCHED_ATTRIBUTE,1);}
  if(stepId==='IcllDi'&&s===310&&val(player,SKETCHED_ATTRIBUTE)&&!held(player,SKETCH))give(player,SKETCH);
  if(stepId==='jRTuWB'&&s===310&&held(player,SKETCH)){player.getInventory().deleteNumber(SKETCH,1);advance(player,320);}
  if(stepId==='sFonMo'&&s===340)advance(player,400);
 }
 function condition({player,stepId,pages}){
  if(!pages?.some(p=>p.page.replace(/^Transcript:/,'')==='While Guthix Sleeps'))return;
  const s=stage(player),known={'xbH70-':s<240,XJEoYS:s>=240,TRfR8_:!val(player,DRAYNOR_ATTRIBUTE),LegVrw:!!val(player,DRAYNOR_ATTRIBUTE),mQUtt5:!val(player,FREE_SEED_ATTRIBUTE),'8EZ6Py':!!val(player,FREE_SEED_ATTRIBUTE),SGVzwh:held(player,SEED),VbHcV3:!held(player,SEED),Pl4Rma:held(player,ROSE_LENS),'v-3xu5':!held(player,ROSE_LENS),SofZ28:held(player,ROSE_LENS),nomyMm:player.getInventory().getAmount(COINS)<20,atEpSr:!player.getInventory().getFreeSlots(),YaOsDJ:!held(player,PAPYRUS)||!held(player,CHARCOAL),j99nP_:held(player,PAPYRUS)&&held(player,CHARCOAL),'wgs-sketch-lost':!held(player,SKETCH),'3E4qX2':held(player,SKETCH),Xz5LGu:!held(player,SKETCH)};
  if(stepId in known)return known[stepId];
 }
 function plantOrb(event){
  const {player,itemId,target:npc}=event;
  if(itemId!==TELEORB||stage(player)!==230||![SPY,OUTSIDER].includes(npc.getId())||npc.getOwner?.()!==player)return false;
  event.handled=true;
  if(npc.getId()===OUTSIDER||val(player,SPY_ALERT_ATTRIBUTE)>Date.now()){player.sendMessage('This person is too alert for you to plant anything on them.');return true;}
  if(Math.random()<0.15){hit(player,3);player.sendMessage('The stranger notices your attempt. Try again.');return true;}
  player.getInventory().deleteNumber(TELEORB,1);advance(player,240);player.sendMessage('You plant the teleorb on the stranger.');return true;
 }
 function serumOnSpy(e){
  const {player,itemId,target}=e;
  if(itemId!==SUPER_SERUM||stage(player)!==300||target.getId()!==CAPTIVE||target.getOwner?.()!==player||!held(player,SUPER_SERUM))return false;
  e.handled=true;return talk({player,npcId:CAPTIVE});
 }
 function combine(e){
  const {player}=e;if(stage(player)<250||stage(player)>=320)return;
  const pair=(a,b)=>(e.usedItemId===a&&e.usedWithItemId===b)||(e.usedItemId===b&&e.usedWithItemId===a);
  const recipe=pair(DYE,LENS)?[DYE,LENS,ROSE_LENS]:pair(ENRICHED_HERB,SERUM)?[ENRICHED_HERB,SERUM,SUPER_SERUM]:null;
  if(!recipe)return;e.handled=true;for(const id of recipe.slice(0,2))if(!held(player,id))return;
  for(const id of recipe.slice(0,2))player.getInventory().deleteNumber(id,1);player.getInventory().adds(recipe[2],1);
 }
 function enrich({player,itemId,object}){
  if(itemId!==ROSE_LENS||stage(player)<250||stage(player)>=280||val(player,SEED_ATTRIBUTE)!==1)return false;
  const l=object.getLocation(),p=player.getLocation();if(l.getX()<3009||l.getX()>3017||l.getY()<3256||l.getY()>3263)return false;
  if(p.getX()!==3012||p.getY()!==3258){player.sendMessage('Stand just inside the doorway to focus sunlight on the counter.');return true;}
  player.setAttribute(SEED_ATTRIBUTE,2);sync(player);player.sendMessage('You focus the beam of light onto the snapdragon seed.');return true;
 }
 function takeSeed({player,objectId,definition}){
  objectId=definition?.id??objectId;
  if(!COUNTERS.includes(objectId)||val(player,SEED_ATTRIBUTE)!==2)return false;
  if(give(player,ENRICHED_SEED)){player.setAttribute(SEED_ATTRIBUTE,3);player.getPacketSender().sendVarbit(1537,0);advance(player,270);}return true;
 }
 function plant({player,itemId,objectId}){
  objectId=api.core.ObjectDefinition.forPlayer(objectId,player)?.id??objectId;
  if(itemId!==ENRICHED_SEED||!PATCHES.includes(objectId)||stage(player)!==270)return false;
  if(!held(player,DIBBER)&&!player.getAttribute('barbarian-training:farming')){player.sendMessage('You need a seed dibber to plant this seed.');return true;}
  player.getInventory().deleteNumber(ENRICHED_SEED,1);advance(player,280);sync(player);player.sendMessage('You plant the enriched snapdragon seed.');return true;
 }
 function harvest({ player, objectId, definition }) {
  objectId = definition?.id ?? objectId;
  if (!PATCHES.includes(objectId) || stage(player) < 280 || stage(player) >= 320) return false;
  if (stage(player) < 300) {
   player.sendMessage('The herb is still growing.');
   return true;
  }
  if (give(player, ENRICHED_HERB)) player.setAttribute(HERB_PICKED_ATTRIBUTE, 1);
  return true;
 }
 function inspect({player,objectId,definition}){objectId=definition?.id??objectId;if(!PATCHES.includes(objectId)||stage(player)<250)return false;player.sendMessage(stage(player)>=300?'The enriched snapdragon is ready to harvest.':stage(player)>=280?'The enriched snapdragon is growing.':'A specially prepared herb patch.');return true;}
 function drawers({player,objectId}){if(!DRAWERS.includes(objectId)||stage(player)<250)return false;give(player,PAPYRUS);give(player,CHARCOAL);return true;}
 function cell({player,objectId}){if(objectId!==CELL||stage(player)<220)return false;if(stage(player)<300){player.sendMessage('The gate is securely locked.');return true;}const l=player.getLocation();player.moveTo(new Location(l.getX()<2988?2989:2987,3343,0));return true;}
 function killed({npc,killer}){const p=npc.getOwner?.()||killer?.getAsPlayer?.(),i=MERCENARIES.indexOf(npc.getId());if(p&&i>=0&&battles.has(p))p.setAttribute(MERCENARIES_ATTRIBUTE,val(p,MERCENARIES_ATTRIBUTE)|(1<<i));}
 function logout({player}){removeActors(player);}
 api.registerArea(new McGruborArrival());
 api.onPlayerMapSquareChange(mapChange);
 api.onPlayerLogin(mapChange);
 api.onPlayerLogout(logout);
 for(const name of ['Idria','Akrisae','Thaerisk','Shady stranger','Suspicious outsider','Druid'])api.onNpcInteraction(name,{'Talk-to':talk});
 api.onNpcInteraction('Betty',{'Talk-to':betty});
 for(const name of [...FIRST,...SECOND])api.onNpcInteraction(name,{'Talk-to':recruit});
 api.onNpcDeath(killed);
 api.onItemOnNpc(plantOrb,{noted:false});
 api.onItemOnNpc(serumOnSpy,{noted:false});
 api.onItemOnItem(combine);
 api.onItemOnObject('Rose-tinted lens','Counter',enrich,{noted:false});
 api.onItemOnObject('Enriched snapdragon seed','Herb patch',plant,{noted:false});
 api.onObjectInteraction('Counter',{'Take-from':takeSeed});
 api.onObjectInteraction('Herbs',{Pick:harvest,Inspect:inspect});
 api.onObjectInteraction('Herb patch',{Inspect:inspect});
 api.onObjectInteraction('Drawers',{Search:drawers});
 api.onObjectInteraction('Cell gate',{Open:cell});
 api.onCustomEvent('magic:npc-contact',contacts);
 api.onCustomEvent('magic:npc-contact-selected',selected);
 api.onCustomEvent('npc-dialogue:line',line);
 api.onCustomEvent('npc-dialogue:action',action);
 api.onNpcDialogueCondition(condition);
};
