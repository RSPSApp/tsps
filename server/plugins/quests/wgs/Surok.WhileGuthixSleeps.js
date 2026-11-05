/** Wiki Surok encounter; warriors and elemental spell targets use the live cache models. */
module.exports=function registerSurok({api,stage,advance,held,give,play}){
 const {PrivateArea,Boundary,Location,HitDamage,HitMask,Animation,CombatFactory,CombatType,CombatSpells,Item,ItemOnGroundManager,Projectile}=api.core;
 const GUARD=13566,LADDER=53370,LADDER_TOP=53371,SUROK=13482,SQUALL=13565,REVEALED=13549,FALLEN=13551;
 const STRONG=13484,AGILE=13483,SURGES=[13505,13506,13507,13508],OPPOSITES=['wind','fire','water','earth'];
 const LIT_EXPLOSIVE=29573,TELEORB=29536,ROBES=[29566,29568,29570];
 const BLOOD=[CombatSpells.BLOOD_RUSH,CombatSpells.BLOOD_BURST,CombatSpells.BLOOD_BLITZ,CombatSpells.BLOOD_BARRAGE];
 // Every powered staff's built-in spell carries this flag (plugins/items/PoweredStaff.js).
 const powered=s=>s?.poweredStaffSpell===true;
 const WEAKEN=[CombatSpells.WEAKEN,CombatSpells.ENFEEBLE],BIND=[CombatSpells.BIND,CombatSpells.SNARE,CombatSpells.ENTANGLE];
 const ELEMENTS=['WIND','WATER','EARTH','FIRE'].map(element=>['STRIKE','BOLT','BLAST','WAVE','SURGE'].map(tier=>CombatSpells[element+'_'+tier]).filter(Boolean));
 const fights=new WeakMap(),targets=new WeakMap(),climbing=new WeakSet();
 const loc=(x,y,z=2)=>new Location(x,y,z),dressed=p=>ROBES.every(id=>p.getEquipment().contains(id));
 const spell=p=>p.getCombat().getSelectedSpell()??p.getCombat().getCastSpell();
 const damage=(p,n)=>p.getCombat().getHitQueue().addPendingDamage([new HitDamage(n,HitMask.RED)]);
 const random=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
 function remove(f,n){if(n){targets.delete(n);f.enemies.delete(n);api.removeNpc(n);}}
 function spawn(f,id,x,y,hp){
  const n=api.spawnNpc({id,x,y,z:2,wanderRadius:0,owner:f.player,ownerOnly:true});
  if(hp)n.setMaxHitpoints(hp).setHitpoints(hp);
  n.setScriptedMovement(true);n.getMovementQueue().setBlockMovement(true);f.enter(n);f.enemies.add(n);return n;
 }
 class SurokArea extends PrivateArea{
  constructor(player){super([new Boundary(4126,4152,4840,4861,2)]);this.player=player;this.enemies=new Set();this.ticks=0;this.attacks=0;this.specialAt=random(7,8);this.nextAttack=5;this.specials=0;this.started=false;this.incoming=[];}
  isMulti(){return true;}
  canAttack(a,b){return a===this.player&&this.enemies.has(b)&&b!==this.fallen&&b!==this.intro?null:false;}
  process(m){
   if(m!==this.player)return;this.ticks++;
   const due=this.incoming.filter(d=>d.at<=this.ticks);this.incoming=this.incoming.filter(d=>d.at>this.ticks);for(const d of due)damage(this.player,d.n);
   for(const n of this.enemies)n.getCombat().getLastAttack().reset();
   if(this.explosive&&this.ticks>=this.explosive.expires){explode(this);}
   for(const n of [...this.enemies]){
    const t=targets.get(n);if(!t)continue;
    if(n.getHitpoints()<=0){remove(this,n);continue;}
    if(t.weak&&this.ticks<t.boundUntil)continue;
    if(this.ticks% (t.surge?4:2)!==0)continue;
    const p=this.player.getLocation(),l=n.getLocation();
    if(l.getDistance(p)<=1){damage(this.player,random(45,55));if(!t.surge)CombatFactory.freeze(this.player,3);remove(this,n);continue;}
    const dx=Math.sign(p.getX()-l.getX()),dy=Math.sign(p.getY()-l.getY());
    for(const [x,y]of [[dx,dy],[dx,0],[0,dy]]){
     if((x||y)&&api.core.RegionManager.canMove(l.getX(),l.getY(),l.getX()+x,l.getY()+y,2,1,1,this)){n.moveTo(l.transform(x,y));break;}
    }
   }
   if(!this.started||!this.boss||this.boss.getHitpoints()<=0||this.ticks<this.nextAttack||this.player.getHitpoints()<=0)return;
   this.nextAttack=this.ticks+5;
   const b=this.boss,p=this.player;b.performAnimation(CombatSpells.FIRE_SURGE.castAnimation());
   CombatSpells.FIRE_SURGE.castProjectile(b,p)?.sendProjectile();
   // Lands with the surge (51 -> 46 + 10 a tile), not as it is cast; the prayer is still read at the cast.
   land(this,Projectile.ticksToLand(Projectile.arrivalCycles(b,p,Projectile.LEGACY_MAGIC_END_BASE)),p.getPrayerActive()[api.core.PrayerHandler.PROTECT_FROM_MAGIC]?random(0,10):random(0,42));
   if(++this.attacks>=this.specialAt){this.attacks=0;this.specialAt=random(7,8);special(this);}
  }
  postLeave(m,logout){if(m===this.player){for(const n of [...this.enemies])remove(this,n);clearExplosive(this);this.incoming=[];fights.delete(m);if(logout)m.moveTo(loc(4142,4854,1));}super.postLeave(m,logout);}
 }
 // Damage queued now shows next tick; `ticks` out, it waits in the area until the tick before.
 // Surok's defeat and leaving the area drop what is still in flight.
 function land(f,ticks,n){if(ticks<=1)damage(f.player,n);else f.incoming.push({at:f.ticks+ticks-1,n});}
 function clearExplosive(f){if(!f.explosive)return;if(f.explosive.ground)ItemOnGroundManager.deregister(f.explosive.ground);f.player.getInventory().deleteNumber(LIT_EXPLOSIVE,1);f.explosive=null;}
 function explode(f){clearExplosive(f);damage(f.player,random(45,55));f.player.sendMessage('The lit explosive detonates!');}
 function special(f){
  const b=f.boss,l=b.getLocation(),kind=f.specials++%3;
  if(kind===0){
   const id=random(0,1)?STRONG:AGILE,n=spawn(f,id,l.getX()-2,l.getY(),30);targets.set(n,{weak:false,surge:false,boundUntil:0});b.forceChat('Fighting you is beneath me!');
  }else if(kind===1){
   clearExplosive(f);const position=f.player.getLocation().transform(2,0);f.explosive={expires:f.ticks+20,grabbed:false,position};
   f.explosive.ground=ItemOnGroundManager.registerLocation(f.player,new Item(LIT_EXPLOSIVE,1),position);b.forceChat('Magicus ignitus!');
  }else{
   // Launch from Surok: the old horizontal spread placed the fourth spell inside the east wall.
   const count=Math.min(4,1+Math.floor((450-b.getHitpoints())/113));
   for(let i=0;i<count;i++){const index=random(0,3),n=spawn(f,SURGES[index],l.getX(),l.getY(),16);targets.set(n,{surge:true,index});}
   b.forceChat('Witness true sorcery!');
  }
 }
 function start(f){if(f.started)return;remove(f,f.intro);f.intro=null;f.boss=spawn(f,SUROK,4145,4850,450);f.started=true;f.player.sendMessage('Surok protects from melee and missiles. Counter his spells using standard magic.');}
 function climb({player:p,objectId,definition}){
  const id=definition?.id??objectId;
  if(id===LADDER_TOP&&fights.has(p)){p.moveTo(loc(4142,4854,1));return true;}
  if(id!==LADDER||stage(p)<580||stage(p)>=610)return false;
  if(stage(p)<597){climbing.add(p);play(p,GUARD,'the-dark-squall-talking-to-the-elite-black-knight-by-the-ladder');return true;}
  enterRoom(p);return true;
 }
 function enterRoom(p){
  const f=new SurokArea(p);fights.set(p,f);f.enter(p);p.moveTo(loc(4142,4854));
  if(stage(p)>=597)f.fallen=spawn(f,FALLEN,4145,4850,1);
  else{advance(p,590);f.intro=spawn(f,SQUALL,4145,4850,1);play(p,SQUALL,'the-dark-squall-climbing-up-the-ladder-in-the-inner-base');}
  return true;
 }
 function guardTalk({player:p,npcId}){
  if(npcId!==GUARD||stage(p)<580||stage(p)>=610)return false;
  climbing.delete(p);play(p,GUARD,'the-dark-squall-talking-to-the-elite-black-knight-by-the-ladder');return true;
 }
 function guardCondition({player:p,stepId,pages}){
  if(!['a-SLUY','KE9ZPi','sRYfCo','3gavgP'].includes(stepId)||!pages?.some(v=>v.page.replace(/^Transcript:/,'')==='While Guthix Sleeps'))return;
  const robes=dressed(p),elite=[29560,29562,29564].every(id=>p.getEquipment().contains(id));
  const known={'a-SLUY':!robes&&!elite,KE9ZPi:elite,sRYfCo:robes&&!climbing.has(p),'3gavgP':robes&&climbing.has(p)};
  if(stepId in known)return known[stepId];
 }
 function line(e){
  if(e.npcId===GUARD&&e.text==='Yes master!'&&climbing.has(e.player)&&dressed(e.player))e.after=()=>{climbing.delete(e.player);if(stage(e.player)>=580&&stage(e.player)<597)enterRoom(e.player);};
  const f=fights.get(e.player);if(f&&e.text==="You've been quite the problem for some time. I'll be glad to finally have rid of you...")e.after=()=>start(f);}
 function action({player,stepId}){const f=fights.get(player);if(f&&stepId==='tJmXJA')f.intro?.setNpcTransformationId(REVEALED);}
 function hit({npc,hit}){
  const p=hit.getAttacker(),f=fights.get(p);if(!f||!f.enemies.has(npc))return;
  const s=hit.getSpell?.(),t=targets.get(npc),magic=hit.getCombatType()===CombatType.MAGIC;
  if(npc===f.boss){if(!magic||!s||powered(s)){hit.setTotalDamage(0);npc.forceChat('Powered staves are no match for my magic!');}return;}
  if(!t){hit.setTotalDamage(0);return;}
  if(!t.surge){if(!t.weak)hit.setTotalDamage(0);return;}
  const element=['wind','water','earth','fire'][ELEMENTS.findIndex(spells=>spells.includes(s))];
  // Wiki: one opposing elemental spell dispels the incoming attack, regardless of tier.
  hit.setTotalDamage(magic&&element===OPPOSITES[t.index]?npc.getHitpoints():0);
 }
 function spellEffects(e){
  const f=fights.get(e.attacker);if(!f)return;
  if(e.target===f.boss&&BLOOD.includes(e.spell))e.allowed=false;
  const t=targets.get(e.target);if(!t||t.surge)return;
  const strong=e.target.getId()===STRONG,correct=(strong?WEAKEN:BIND).includes(e.spell);
  if(correct){t.weak=true;t.boundUntil=f.ticks+(strong?0:20);e.attacker.sendMessage(strong?'The Strong Warrior is weakened.':'The Agile Warrior is bound.');}
 }
 function hitRoll(e){const t=targets.get(e.target),s=spell(e.attacker);if(t&&((e.target.getId()===STRONG?WEAKEN:BIND).includes(s)||t.surge&&ELEMENTS.some(list=>list.includes(s))))e.forceAccurate=true;}
 function pickup(e){const f=fights.get(e.player);if(!f?.explosive||e.groundItemId!==LIT_EXPLOSIVE||e.groundItem!==f.explosive.ground)return false;e.handled=true;explode(f);return true;}
 function telegrab({player,itemId,position}){const f=fights.get(player);if(itemId===LIT_EXPLOSIVE&&f?.explosive&&f.explosive.position.equals(position)){f.explosive.grabbed=true;f.explosive.ground=null;}}
 function alchemy(e){const f=fights.get(e.player);if(e.itemId===LIT_EXPLOSIVE&&f?.explosive?.grabbed){e.allowed=true;e.coins=0;e.confirm=false;e.keepItem=false;e.recast=false;}}
 function alchemised({player,itemId}){const f=fights.get(player);if(itemId===LIT_EXPLOSIVE&&f?.explosive?.grabbed){f.explosive=null;player.sendMessage('The lit explosive is safely neutralised.');}}
 function death({npc}){
  const p=npc.getOwner(),f=p&&fights.get(p);if(!f)return;
  if(npc===f.boss){for(const n of [...f.enemies])remove(f,n);clearExplosive(f);f.incoming=[];f.boss=null;f.started=false;advance(p,597);f.fallen=spawn(f,FALLEN,4145,4850,1);f.fallen.forceChat('Ugh!');p.sendMessage('Surok collapses. Plant the teleorb on him.');}
  else if(targets.has(npc))remove(f,npc);
 }
 function plant(e){
  const p=e.player,n=e.target??e.npc,f=fights.get(p);if(!f||n!==f.fallen||stage(p)!==597)return false;
  if(e.itemId!==undefined&&e.itemId!==TELEORB)return false;
  if(!held(p,TELEORB)){p.sendMessage('You need the teleorb from Silif.');return true;}
  p.getInventory().deleteNumber(TELEORB,1);advance(p,610);remove(f,f.fallen);p.moveTo(loc(4142,4854,1));p.sendMessage('You plant the teleorb on Surok. Return to the alliance at Falador.');return true;
 }
 function use(e){if(e.itemId===TELEORB&&plant(e))e.handled=true;}
 function login({player}){const l=player.getLocation();if(l.getZ()===2&&l.getX()>=4126&&l.getX()<=4152&&l.getY()>=4840&&l.getY()<=4861)player.moveTo(loc(4142,4854,1));}
 function claimLadder(e){if(climb(e))e.handled=true;}
 api.onCustomEvent('ladders:climb',claimLadder);
 api.onObjectInteraction('Ladder',{'Climb-up':climb,'Climb-down':climb});
 api.onNpcInteraction('Surok Magis',{'Plant-orb':plant});
 api.onNpcInteraction('Elite Black Knight',{'Talk-to':guardTalk});
 api.onNpcDialogueCondition(guardCondition);
 api.onItemOnNpc(use,{noted:false});
 api.onNpcHitModify(hit);
 api.onCombatHitRoll(hitRoll);
 api.onNpcDeath(death);
 api.onGroundItemPickup(pickup);
 api.onCustomEvent('npc-dialogue:line',line);
 api.onCustomEvent('npc-dialogue:action',action);
 api.onCustomEvent('magic:hit-effects',spellEffects);
 api.onCustomEvent('magic:telekinetic-grab',telegrab);
 api.onCustomEvent('magic:alchemy-policy',alchemy);
 api.onCustomEvent('magic:alchemy-completed',alchemised);
 api.onPlayerLogin(login);
 return {hit,hitRoll,spellEffects,pickup,telegrab,alchemy,alchemised,climb,guardCondition,line,climbing,fights,targets,SurokArea};
};
