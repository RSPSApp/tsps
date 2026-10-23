/** OSRS Wiki While Guthix Sleeps and bundled transcript; cache quest DB endstate 900. */
module.exports = function registerWhileGuthixSleeps(api) {
  const { registerQuest, startTranscript } = require('../QuestRuntime');
  const { Location, Skill, PrivateArea, Boundary, HitDamage, HitMask, PrayerHandler, World } = api.core;
  const PAGE = 'While Guthix Sleeps';
  const ASSASSINS_ATTRIBUTE = 'while-guthix-sleeps:assassins-defeated';
  const SHIRT_ATTRIBUTE = 'while-guthix-sleeps:shirt-paid';
  const BROAV_ATTRIBUTE = 'while-guthix-sleeps:broav-trained';
  const TRAIL_ATTRIBUTE = 'while-guthix-sleeps:broav-trail';
  const IVY = 13510, THAERISK = 13511, ASSASSINS = [13514,13515], LAUNDERER = 13516;
  const HUNTER = 1504, BROAV = 13518;
  const DIRTY_SHIRT = 29521, UNCONSCIOUS_BROAV = 29518, TRAINED_BROAV = 29519;
  const COINS = 995, FUNGUS = 2970;
  const TAVERLEY_UP = 53347, TAVERLEY_DOWN = 53348;
  const BROKEN_TABLE = 53277, CLOSED_TABLE = 53278, OPEN_TABLE = 53279;
  const CHAROS = 6465;
  const ATTRIBUTES = [ASSASSINS_ATTRIBUTE, SHIRT_ATTRIBUTE, BROAV_ATTRIBUTE, TRAIL_ATTRIBUTE];
  const sessions = new WeakMap();
  const val = (p,k) => Number(p.getAttribute(k)) || 0;
  const held = (p,id) => p.getInventory().contains(id);
  const stage = p => quest.getStage(p);
  const advance = (p,s) => { if(stage(p)<s) quest.setStage(p,s); };
  const play = (p,id,variant) => startTranscript(api,p,id,PAGE,variant);
  const equipped = (p,id) => p.getEquipment().getItems().some(i=>i?.getId()===id);
  function give(p,id,amount=1) {
    if (held(p,id)) return true;
    if (!p.getInventory().getFreeSlots()) { p.sendMessage('You need a free inventory space.'); return false; }
    p.getInventory().adds(id,amount); return true;
  }
  function requirement(p) {
    const skills = [[Skill.THIEVING,72],[Skill.MAGIC,67],[Skill.AGILITY,66],[Skill.FARMING,65],[Skill.HERBLORE,65],[Skill.HUNTER,62]];
    if(skills.some(([s,l])=>p.getSkillManager().getMaxLevel(s)<l)||(Number(p.getAttribute('quest.points'))||0)<180) return false;
    if(p.getSkillManager().getMaxLevel(Skill.ATTACK)+p.getSkillManager().getMaxLevel(Skill.STRENGTH)<130
      &&p.getSkillManager().getMaxLevel(Skill.ATTACK)<99&&p.getSkillManager().getMaxLevel(Skill.STRENGTH)<99) return false;
    return ['defender_of_varrock','the_path_of_glouphrie','fight_arena','dream_mentor','hand_in_the_sand','wanted','temple_of_the_eye','tears_of_guthix','nature_spirit','a_tail_of_two_cats'].every(key=>{
      const request={player:p,key,complete:false};api.emitCustomEvent('quest:is-complete',request);return request.complete;
    });
  }
  const quest = registerQuest(api, {
    key:'while_guthix_sleeps',name:PAGE,varpId:4092,varbitId:9653,startedValue:1,completionValue:900,questPoints:5,
    rewardLines:['80,000 Thieving XP','75,000 Farming and Herblore XP','50,000 Hunter XP','Access to the Ancient Guthixian Temple'],
    onReward: reward,
    buildJournal(p) {
      const s=stage(p);
      if(!s)return ['Speak to Ivy Sophista in Taverley, in the crystal chest house.','I need 180 Quest Points, 72 Thieving, 67 Magic, 66 Agility, 65 Farming and Herblore, and 62 Hunter.'];
      if(s<30)return ['Speak to Thaerisk upstairs and defend him from Lucien\'s assassins.'];
      if(s<40)return ['Speak to Thaerisk about Movario and investigate the Fight Arena.'];
      if(s<100)return ['Obtain Movario\'s dirty shirt from the Khazard Launderer.','Ask the Feldip Hills hunting expert about catching and training a broav.','Use the shirt on your trained broav in the ruined battlefield building.'];
      if(s<200)return ['Explore Movario\'s base and recover both volumes of his research notes.','Follow the lit floor wires, disable the staircase and chest traps, and balance the pressure gauge.'];
      if(s<300)return ['Show both volumes to Thaerisk and find Idria at McGrubor\'s Wood.'];
      if(s<500)return ['Work with the alliance at the White Knights\' Castle to find Lucien.'];
      if(s<700)return ['Infiltrate the Black Knight Catacombs and investigate the Dark Squall.'];
      if(s<880)return ['Find Movario in the Chasm of Tears and explore the Ancient Guthixian Temple.'];
      if(s<900)return ['Return to the alliance after defeating Lucien\'s tormented demons.'];
      return ['I helped the alliance discover Lucien\'s plan.','The Ancient Guthixian Temple is now accessible.'];
    },
  });
  function reward(p) {
    for(const [skill,xp]of [[Skill.THIEVING,80000],[Skill.FARMING,75000],[Skill.HERBLORE,75000],[Skill.HUNTER,50000]])p.getSkillManager().addExperience(skill,xp);
  }
  function ivy({player,npcId}) {
    if(!stage(player)&&!requirement(player)){player.sendMessage('You do not yet meet the requirements for While Guthix Sleeps.');return true;}
    play(player,npcId,stage(player)>=200?'forming-a-fellowship-talking-to-ivy-sophista':stage(player)?'the-crux-eqal-talking-to-ivy-sophista-talking-to-ivy-again':'the-crux-eqal-talking-to-ivy-sophista');return true;
  }
  function thaerisk({player,npcId}) {
    const s=stage(player);
    if(s>=900){play(player,npcId,'post-quest-dialogue-talking-to-thaerisk');return true;}
    if(s>=300)return false;
    let v=s===0?'the-crux-eqal-talking-to-thaerisk-before-starting-the-quest':s<30?'the-crux-eqal-talking-to-thaerisk-after-starting-the-quest':s<40?'the-crux-eqal-talking-to-thaerisk-after-killing-the-assassins':'the-crux-eqal-talking-to-thaerisk-after-killing-the-assassins-talking-to-thaerisk-again';
    if(s>=100&&s<200&&held(player,29525)&&held(player,29526)&&val(player,'while-guthix-sleeps:notes-read')!==3){player.sendMessage('Read both volumes of Movario’s notes all the way through before showing them to Thaerisk.');return true;}
    if(s>=100)v=held(player,29525)&&held(player,29526)?'forming-a-fellowship-talking-to-thaerisk-with-movario-s-notes':'forming-a-fellowship-talking-to-thaerisk-without-movario-s-notes';
    if(s>=200)v='forming-a-fellowship-talking-to-thaerisk-with-movario-s-notes-talking-to-thaerisk-again';
    play(player,npcId,v);return true;
  }
  function launderer({player,npcId}) {
    if(stage(player)<40||stage(player)>=200)return false;
    if(val(player,SHIRT_ATTRIBUTE)&&!held(player,DIRTY_SHIRT))give(player,DIRTY_SHIRT);
    play(player,npcId,val(player,SHIRT_ATTRIBUTE)?'monitoring-movario-talking-to-the-khazard-launderer-talking-to-the-khazard-launderer-again':'monitoring-movario-talking-to-the-khazard-launderer');return true;
  }
  function hunter({player,npcId}) {
    if(npcId!==HUNTER||stage(player)<40||stage(player)>=200)return false;
    play(player,npcId,held(player,UNCONSCIOUS_BROAV)?'monitoring-movario-talking-to-the-hunting-expert-with-a-broav':'monitoring-movario-talking-to-the-hunting-expert');return true;
  }
  function start({player,hook}) {if(hook==='quest:while-guthix-sleeps:start'&&!stage(player)&&requirement(player))advance(player,10);}
  function line(e) {
    const {player,text,npcId}=e;
    if(npcId===THAERISK&&stage(player)===30&&text==='According to our spies, Movario has hired a member of the Khazard Army called Darve to act as his bodyguard. As such, I\'d recommend you begin at the Fight Arena.')e.after=()=>advance(player,40);
    if(npcId===THAERISK&&stage(player)>=100&&stage(player)<200&&text.startsWith('Head for the hidden entrance to the temple at McGrubor'))e.after=()=>advance(player,200);
  }
  function action({player,stepId,npcId}) {
    if(stepId==='c_eyt5'&&npcId===THAERISK&&stage(player)<30)ambush(player);
    if(stepId==='Ydfl3K'&&npcId===LAUNDERER&&!val(player,SHIRT_ATTRIBUTE)&&player.getInventory().getAmount(COINS)>=500){player.getInventory().deleteNumber(COINS,500);player.setAttribute(SHIRT_ATTRIBUTE,1);}
    if(stepId==='B-CCWE'&&npcId===LAUNDERER){player.setAttribute(SHIRT_ATTRIBUTE,1);give(player,DIRTY_SHIRT);}
    if(stepId==='yDZ8x8'&&npcId===HUNTER)give(player,FUNGUS);
    if(stepId==='bti8GZ'&&npcId===HUNTER&&held(player,UNCONSCIOUS_BROAV)){player.getInventory().deleteNumber(UNCONSCIOUS_BROAV,1);give(player,TRAINED_BROAV);player.setAttribute(BROAV_ATTRIBUTE,1);}
  }
  function condition({player,stepId,pages,text}) {
    if(!pages?.some(p=>p.page.replace(/^Transcript:/,'')===PAGE))return;
    const known={'-FdFB2':true,'CrWVlN':false,'eX5ZCW':true,'ty1vnJ':false,'MTSYQB':player.getInventory().getAmount(COINS)<500,'XDhCSl':player.getInventory().getAmount(COINS)>=500,'fybOZL':!player.getInventory().getFreeSlots(),'eg19BN':equipped(player,CHAROS)};
    if(stepId in known)return known[stepId];
    if(text?.includes('sided with Lucien'))return false;
    if(text?.includes('sided with the Guardians of Armadyl'))return true;
  }
  class AssassinArea extends PrivateArea {
    constructor(p){super([new Boundary(2907,2920,3445,3458,1)]);this.player=p;this.ticks=0;this.special=0;this.assassins=[];}
    isMulti(){return true;}
    process(mobile){
      if(mobile!==this.player)return;
      this.ticks++;
      const [first,second]=this.assassins, p=this.player;
      // Thaerisk's scripted damage has no player killer, so it emits no NPC death event.
      this.assassins.forEach((n,i)=>{if(n&&(n.getHitpoints()<=0||n.getArea?.()===null||(n.getIndex&&(n.getIndex()<0||World.getNpcs().get(n.getIndex())!==n))))p.setAttribute(ASSASSINS_ATTRIBUTE,val(p,ASSASSINS_ATTRIBUTE)|(1<<i));});
      if((val(p,ASSASSINS_ATTRIBUTE)&3)===3&&stage(p)<30){p.setAttribute(ASSASSINS_ATTRIBUTE,3);advance(p,30);p.sendMessage('Both assassins have been defeated. Speak to Thaerisk.');}
      for(const n of this.assassins)if(n?.getHitpoints()>0)n.getCombat().getLastAttack().reset();
      if(second?.getHitpoints()>0&&this.ticks%5===0)second.getCombat().getHitQueue().addPendingDamage([new HitDamage(15,HitMask.RED)]);
      if(first?.getHitpoints()>0&&this.ticks%5===0){
        if(this.ticks%20===0){first.forceChat('Now!');this.special=this.ticks+2;}
        hit(p,p.getPrayerActive()[PrayerHandler.PROTECT_FROM_MISSILES]?0:Math.floor(Math.random()*17));
      }
      if(this.special===this.ticks&&second?.getHitpoints()>0){second.forceChat('Nothing personal, adventurer!');hit(p,p.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE]?0:25+Math.floor(Math.random()*29));}
    }
    postLeave(mobile,logout){if(mobile===this.player){for(const n of this.assassins)if(n)api.removeNpc(n);if(this.ally)api.removeNpc(this.ally);sessions.delete(this.player);}super.postLeave(mobile,logout);}
  }
  function hit(p,n){if(n>0)p.getCombat().getHitQueue().addPendingDamage([new HitDamage(n,HitMask.RED)]);}
  function ambush(player){
    if(sessions.has(player))return;
    const area=new AssassinArea(player);sessions.set(player,area);area.enter(player);
    const ally=api.spawnNpc({id:THAERISK,x:2913,y:3451,z:1,wanderRadius:0,owner:player,ownerOnly:true});area.enter(ally);area.ally=ally;
    ASSASSINS.forEach((id,i)=>{if(val(player,ASSASSINS_ATTRIBUTE)&(1<<i))return;const n=api.spawnNpc({id,x:2913+i*3,y:3450+i,z:1,wanderRadius:0,owner:player,ownerOnly:true});n.setMaxHitpoints(275).setHitpoints(275).setScriptedMovement(true);area.enter(n);area.assassins[i]=n;});
  }
  function killed({npc,killer}){
    if(!ASSASSINS.includes(npc.getId()))return;
    const player=npc.getOwner?.()||killer?.getAsPlayer?.();if(!player||!sessions.has(player))return;
    const bit=1<<ASSASSINS.indexOf(npc.getId());player.setAttribute(ASSASSINS_ATTRIBUTE,val(player,ASSASSINS_ATTRIBUTE)|bit);
    if(val(player,ASSASSINS_ATTRIBUTE)===3){advance(player,30);player.sendMessage('Both assassins have been defeated. Speak to Thaerisk.');}
  }
  function ladder({player,objectId}){
    if(![TAVERLEY_UP,TAVERLEY_DOWN].includes(objectId))return false;
    player.moveTo(new Location(2914,3450,objectId===TAVERLEY_UP?1:0));return true;
  }
  function replace(player,id,tile,type=10,face=0){const area=player.getPrivateArea();if(!area)throw Error('Quest scenery must belong to a private area');let old=api.core.ObjectManager.objectsAt(new Location(...tile)).find(o=>o.getPrivateArea()===area&&o.getType()===type);if(!old){const placed=(api.core.MapObjects.mapObjects.get(api.core.MapObjects.getHash(...tile))||[]).find(o=>o.getType()===type);if(placed)old=new api.core.GameObject(placed.getId(),placed.getLocation(),type,placed.getFace(),area);}if(old)api.core.ObjectManager.deregister(old,true);const o=new api.core.GameObject(id,new Location(...tile),type,face,area);api.core.ObjectManager.register(o,true);return o;}
  function track(event){
    const {player,itemId,target:npc}=event;
    if(itemId!==DIRTY_SHIRT||npc?.getId()!==BROAV||npc.getOwner?.()!==player)return false;
    event.handled=true;
    const p=player.getLocation();
    if(Math.abs(p.getX()-2519)>15||Math.abs(p.getY()-3249)>15){player.sendMessage('The broav cannot pick up a scent here. Try the ruined building near the battlefield.');return true;}
    npc.getMovementQueue().addSteps(new Location(2519,3248,0));player.getInventory().deleteNumber(DIRTY_SHIRT,1);player.setAttribute(TRAIL_ATTRIBUTE,1);player.sendMessage('Your broav follows the scent towards the broken table and squeals.');player.getPacketSender().sendVarbit(10840,1);return true;
  }
  function table({player,objectId,definition}){
    objectId=definition?.id??objectId;
    if(![BROKEN_TABLE,CLOSED_TABLE,OPEN_TABLE].includes(objectId))return false;
    if(!val(player,TRAIL_ATTRIBUTE))return true;
    if(objectId===BROKEN_TABLE){player.setAttribute(TRAIL_ATTRIBUTE,2);player.getPacketSender().sendVarbit(10840,2);player.sendMessage('You find a trapdoor underneath the broken table.');}
    if(objectId===CLOSED_TABLE){player.setAttribute(TRAIL_ATTRIBUTE,3);player.getPacketSender().sendVarbit(10840,3);}
    if(objectId===OPEN_TABLE){advance(player,100);api.emitCustomEvent('wgs:enter-movario',{player});}
    return true;
  }
  function login({player}){player.getPacketSender().sendVarbit(10840,val(player,TRAIL_ATTRIBUTE));}
  const context={api,quest,stage,advance,held,give,val,play,replace,hit,ATTRIBUTES};
  require('../wgs/Movario.WhileGuthixSleeps')(context);
  require('../wgs/Fellowship.WhileGuthixSleeps')(context);
  require('../wgs/DarkSquall.WhileGuthixSleeps')(context);
  require('../wgs/Surok.WhileGuthixSleeps')(context);
  require('../wgs/Alliance.WhileGuthixSleeps')(context);
  require('../wgs/Chasm.WhileGuthixSleeps')(context);
  require('../wgs/Temple.WhileGuthixSleeps')(context);
  require('../wgs/Stone.WhileGuthixSleeps')(context);
  require('../wgs/Rewards.WhileGuthixSleeps')(context);
  for(const key of ATTRIBUTES)api.persistAttribute(key);
  api.onNpcInteraction('Ivy Sophista',{'Talk-to':ivy});
  api.onNpcInteraction('Thaerisk',{'Talk-to':thaerisk});
  api.onNpcInteraction('Khazard Launderer',{'Talk-to':launderer});
  api.onNpcInteraction('Hunting expert',{'Talk-to':hunter});
  api.onObjectInteraction('Ladder',{'Climb-up':ladder,'Climb-down':ladder});
  api.onObjectInteraction('Broken table',{Search:table});
  api.onObjectInteraction('Trapdoor table',{Open:table});
  api.onObjectInteraction('Trapdoor',{'Climb-down':table});
  api.onItemOnNpc(track,{noted:false});
  api.onNpcDeath(killed);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent('npc-dialogue:hook',start);
  api.onCustomEvent('npc-dialogue:line',line);
  api.onCustomEvent('npc-dialogue:action',action);
  api.onPlayerLogin(login);
};
