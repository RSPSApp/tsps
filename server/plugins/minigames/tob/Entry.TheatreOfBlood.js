/**
 * Solo Entry Mode at the cache's real room coordinates, isolated with PrivateArea.
 * Sources: OSRS Wiki Theatre of Blood/Entry Mode and /Strategies (OSRS Index mirror).
 * Normal/Hard Mode and multiplayer parties are separate raid content.
 */
const RAIDS = new WeakMap();
const NPC_RAIDS = new WeakMap();
const PARTY_ATTRIBUTE = "tob:entry-party";
const COMPLETIONS_ATTRIBUTE = "tob:entry-completions";
const TREASURE_READY_ATTRIBUTE = "tob:entry-treasure-ready";
const RAID_ENTRANCE = 32653;
const BARRIER = 32755;
const PASSAGE = 33113;
const XARPUS_EXIT = 32751;
const SUPPLY_CHEST = 32758;
const OPEN_SUPPLY_CHEST = 32759;
const DAWNBRINGER_SKELETON = 32741;
const TREASURE_ENTRANCE = 32738;
// The treasure trapdoor is on the throne tile; the arena's south side is the reachable approach.
const TREASURE_ENTRANCE_TILE = [3167,4323,0];
const REWARD_CHEST = 32992;
// The cache's treasure vault is at 3234,4321; 3234,4307 is a blocked tile outside it.
const TREASURE_ROOM_ENTRY_TILE = [3234,4320,0];
const REWARD_CHEST_TILE = [3234,4321,0];
const TELEPORT_CRYSTAL = 32996;
const SHADOW_EXIT = 33037;
const EXHUMED = 32743;
const ACID_POOL = 32744;
const BLOOD_POOL = 32984;
const SHADOW_TILE = 33035;
const PILLAR = 32687;
const COLLAPSED_PILLAR = 32689;
const MAIDEN = 10814;
const MAIDEN_CRAB = 10820;
const BLOOD_SPAWN = 10821;
const BLOAT = 10812;
const NYLO_SMALL = [10774, 10775, 10776];
const NYLO_LARGE = [10777, 10778, 10779];
const NYLO_FIGHTING_SMALL = [10780, 10781, 10782];
const NYLO_FIGHTING_LARGE = [10783, 10784, 10785];
const NYLO_BOSS = [10787, 10789, 10788]; // melee, ranged, magic
const NYLO_PILLAR = 10790;
// Official Entry Mode wave chart: lowercase is small, uppercase is large,
// ! marks aggressive, and slash-separated styles are the two pre-arena flickers.
const NYLO_WAVES = [
  ["m", "a", "r!"], ["r", "m!", "a"], ["a!", "r", "m"], ["m", "A", "r"],
  ["a", "m", "R"], ["M", "r", "a"], ["M", "a+R!", ""], ["r", "m", "A!"],
  ["a", "", "R!+m"], ["r!+R", "r+r", "r+r!"], ["a!+a", "a+a", "A!"], ["m!+m", "M", "m+m!"],
  ["M!", "r+m", "r+a!"], ["R!", "a+r", "a+m!"], ["a!+r", "A", "m+r!"], ["a/m/r", "m/a/r", "r/a/r"],
  ["A/m/A", "A/m/A", "A/m/A"], ["R/a/R", "R/a/R", "R/a/R!"], ["A/m/A!", "a/m/a", "a/m/a"],
  ["M/r/M", "A/r/m!", "M/r/M"], ["r/m/r+r!", "m/r/m+m!", "a/m/r+a/r/a"],
  ["A/r/m!", "r/a/m+r/a/m", "M/r/M"], ["A/r/M", "A/r/m!", "a/r/m+r/a/r"],
  ["M!", "A!", "R/a/m!"], ["A/m/A", "R", "M!"], ["A", "m/a/m", "A!"],
  ["A/m/A", "M/a/R!", "A"], ["a/m/a+r/a/m", "m/r/m+a/m/r", "m/r/m+r/m/a!"],
  ["a/r/m+r/m/a!", "M", "m/r/a!+r/m/r"], ["A!", "m/r/m+a/r/m", "R/m/R"],
  ["a/r/a+r/m/r", "m/a/r+a/m/r", "m/r/a+r/a/r"],
];
const NYLO_STYLE = {m:0,r:1,a:2};
const BMR_ENCOUNTERS = [
  { room: 2, type: "wave" },
  { room: 0, type: "maiden" },
  { room: 2, type: "wave" },
  { room: 2, type: "vasilias" },
];
const BMR_WAVE = [
  [10804,0,true],[10805,1,true],[10806,2,true],
  [10781,1,false],[10782,2,false],[10781,1,false],[10782,2,false],[10784,1,true],[10785,2,true],
  [10781,1,false],[10782,2,false],[10784,1,true],[10785,2,true],[10781,1,false],[10782,2,false],
].map(([id,style,big],index) => {
  const lane=index%3,rank=Math.floor(index/3),base=[[3288,4248],[3295,4253],[3303,4248]][lane];
  return {id,style,big,tile:[base[0]+rank%3-1,base[1]+Math.floor(rank/3),0]};
});
function readNyloSpec(spec) {
  const aggressive=spec.endsWith("!"),sequence=spec.replace(/!$/,"").split("/");
  return {aggressive,big:sequence[0]===sequence[0].toUpperCase(),styles:sequence.map(style=>NYLO_STYLE[style.toLowerCase()])};
}
function activeNylocas(raid,exclude) {
  return [...raid.npcs].filter(n=>n!==exclude&&NPC_RAIDS.get(n)?.nylo&&(alive(n)||n.isDyingFunction?.()===true)).length;
}
function updateNyloExpiry(raid,npc,d) {
  if(d.exploding) {
    if(raid.tick>=d.despawnsAt){splitNylocas(raid,npc,d);remove(raid,npc);}
    return true;
  }
  if(raid.tick<d.expires)return false;
  if(distance(npc.getLocation(),raid.player.getLocation())<2)damage(raid.player,8);
  if(d.big){d.exploding=true;d.despawnsAt=raid.tick+3;}
  else remove(raid,npc);
  return true;
}
function firstNyloWaveAt(roomStartedAt,currentTick) {
  let tick=roomStartedAt;
  while(tick%4!==2)tick++;
  tick+=4;
  while(tick<=currentTick)tick+=4;
  return tick;
}
function soloNyloPillarHitpoints(cacheHitpoints) {
  // shortcut: the Wiki documents more pillar HP at lower scales but no values; this solo-only raid uses five times the cache baseline.
  return cacheHitpoints * 5;
}
const SOTETSEG = 10865;
const XARPUS = 10768;
const VERZIK_INITIAL = 10830;
const VERZIK_PHASES = [10831, 10833, 10835];
const VERZIK_PURPLE = 10844;
const VERZIK_RED = 10845;
// Wiki: the 12-tick red-crab summon converts damage to healing for its first 8 ticks.
const VERZIK_RED_HEAL_TICKS = 8;
const VERZIK_WEB = 10837;
const VERZIK_TORNADO = 10846;
const ROOMS = [
  { name: "The Maiden of Sugadinti", id: MAIDEN, entry: [3187,4446,0], inside: [3183,4446,0], boss: [3162,4444,0], centre: [3175,4446,0], advice: "the-maiden-of-sugadinti" },
  { name: "Pestilent Bloat", id: BLOAT, entry: [3306,4448,0], inside: [3302,4448,0], boss: [3290,4441,0], centre: [3295,4447,0], supplies: [3301,4446,0], advice: "pestilent-bloat" },
  { name: "Nylocas", id: null, entry: [3295,4257,0], inside: [3295,4253,0], boss: [3293,4246,0], centre: [3295,4248,0], advice: "nylocas" },
  { name: "Sotetseg", id: SOTETSEG, entry: [3279,4305,0], inside: [3279,4310,0], boss: [3277,4327,0], centre: [3279,4318,0], supplies: [3279,4312,0], advice: "sotetseg" },
  { name: "Xarpus", id: XARPUS, entry: [3170,4377,1], inside: [3170,4381,1], boss: [3168,4387,1], centre: [3170,4389,1], advice: "xarpus" },
  { name: "Verzik Vitur", id: VERZIK_INITIAL, entry: [3170,4308,0], inside: [3170,4312,0], boss: [3167,4323,0], centre: [3170,4317,0], advice: "verzik-vitur" },
];
let api, core, NYLO_METHODS;
const loc = ([x,y,z=0]) => new core.Location(x,y,z);
const now = () => core.World.getProcessCycle();
const roll = max => Math.floor(Math.random() * (max + 1));
const alive = npc => npc && npc.getHitpoints() > 0;
const distance = (a,b) => Math.max(Math.abs(a.getX()-b.getX()),Math.abs(a.getY()-b.getY()));
function damage(player, amount) {
  if (amount > 0 && player.getHitpoints() > 0) player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(amount, core.HitMask.RED)]);
}
function restore(player) {
  player.setHitpoints(player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS));
  player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, player.getSkillManager().getMaxLevel(core.Skill.PRAYER), true);
}
function graphic(player, id, position) { player.getPacketSender().sendGlobalGraphic(new core.Graphic(id), position); }
function protection(player, type) {
  const index = type === 0 ? core.PrayerHandler.PROTECT_FROM_MELEE : type === 1 ? core.PrayerHandler.PROTECT_FROM_MISSILES : core.PrayerHandler.PROTECT_FROM_MAGIC;
  return !!player.getPrayerActive()[index];
}
function typeIndex(type) { return type === core.CombatType.MELEE ? 0 : type === core.CombatType.RANGED ? 1 : 2; }
function spawn(raid, id, tile, details = {}) {
  const [x,y,z=0] = tile;
  const npc = api.spawnNpc({id,x,y,z,wanderRadius:0,owner:raid.player,ownerOnly:true});
  if (!npc) throw Error(`Unable to spawn Theatre NPC ${id}`);
  const cachedHp=core.CacheDefinitions.getNpc(id).hitpoints;
  if(cachedHp>0)npc.setMaxHitpoints(cachedHp).setHitpoints(cachedHp);
  npc.setScriptedMovement(true);
  npc.getMovementQueue().setBlockMovement(true);
  if(details.tornado)npc.setMaxHitpoints(1).setHitpoints(1);
  raid.area.enter(npc);
  NPC_RAIDS.set(npc, {raid,...details});
  raid.npcs.add(npc);
  return npc;
}
function remove(raid, npc) { if (!npc) return; api.removeNpc(npc); raid.npcs.delete(npc); NPC_RAIDS.delete(npc); }
function object(raid, id, tile, shape=10) {
  const o = new core.GameObject(id,loc(tile),shape,0,raid.area);
  core.ObjectManager.register(o,true); raid.objects.add(o); return o;
}
function removeObject(raid,o) { core.ObjectManager.deregister(o,true); raid.objects.delete(o); }
function clearRoom(raid) {
  for (const npc of [...raid.npcs]) remove(raid,npc);
  for (const o of [...raid.objects]) removeObject(raid,o);
  raid.effects = []; raid.pools = []; raid.boss = null; raid.dead = false; raid.started = false; raid.tick = 0;
  raid.phase = 0; raid.threshold = 0; raid.attacks = 0; raid.bloatStep = 0; raid.bloatHandsLast = null; raid.maze = null; raid.redShield = 0;
  raid.tornado = null; raid.safe = 0; raid.look = null; raid.supplies = 0;
}
function enterRoom(raid,index) {
  clearRoom(raid); raid.room = index; raid.roomTick = now(); raid.complete = false;
  raid.bmrEncounter = raid.mode === "bmr" ? BMR_ENCOUNTERS[raid.bmrIndex]?.type : null;
  raid.player.getCombat().reset(); raid.player.moveTo(loc(ROOMS[index].entry));
  raid.player.sendMessage(`${ROOMS[index].name}: cross the barrier when ready.`);
  raid.stranger = spawn(raid,core.NpcIdentifiers.MYSTERIOUS_STRANGER_4, [ROOMS[index].entry[0]+1,ROOMS[index].entry[1],ROOMS[index].entry[2]]);
  if (index === 5) raid.boss = spawn(raid,VERZIK_INITIAL,ROOMS[index].boss,{boss:true});
  raid.player.getPacketSender().sendVarbit(6448,0).sendVarbit(6449,100).sendVarbit(6447,2);
}
function startRoom(raid) {
  if (raid.started || raid.complete) return;
  raid.started = true; raid.tick=0;
  const room=ROOMS[raid.room]; raid.player.moveTo(loc(room.inside));
  if (raid.mode === "bmr") {
    if(raid.bmrEncounter === "maiden")raid.boss=spawn(raid,MAIDEN,room.boss,{boss:true});
    else if(raid.bmrEncounter === "vasilias") {
      raid.boss=spawn(raid,NYLO_BOSS[0],room.boss,{boss:true,style:0});
      raid.nextStyle=raid.tick+10;
    } else {
      raid.wave=1;
      for(const {id,style,big,tile} of BMR_WAVE) {
        spawn(raid,id,tile,{nylo:true,style,big,aggressive:true,expires:raid.tick+(big?52:53)});
      }
    }
  } else if (raid.room === 2) {
    raid.wave = 0;
    const pillarHp=soloNyloPillarHitpoints(core.CacheDefinitions.getNpc(NYLO_PILLAR).hitpoints);
    raid.pillars = [[3290,4245,0],[3290,4251,0],[3299,4245,0],[3299,4251,0]].map(p=>{
      const pillar=spawn(raid,NYLO_PILLAR,p,{pillar:true});
      pillar.setMaxHitpoints(pillarHp).setHitpoints(pillarHp);
      return pillar;
    });
    raid.nextWave=firstNyloWaveAt(raid.roomTick,now());
  } else if (raid.room === 5) {
    raid.phase=0; raid.boss.setNpcTransformationId(VERZIK_PHASES[0]).setMaxHitpoints(300).setHitpoints(300);
    raid.pillars = [[3161,4318,0],[3161,4311,0],[3176,4318,0],[3176,4311,0]].map(tile=>({tile,hp:3,o:object(raid,PILLAR,tile)}));
  } else {
    raid.boss=spawn(raid,room.id,room.boss,{boss:true});
    if(raid.room===4)raid.boss.setHitpoints(Math.floor(raid.boss.getMaxHitpoints()*0.75));
  }
}
function roomComplete(raid) {
  if(raid.room===5&&(raid.phase!==2||alive(raid.boss)))return;
  if(raid.complete)return;
  raid.complete=true; raid.started=false;
  const combat=raid.player.getCombat();combat.reset();combat.getHitQueue().clear();
  restore(raid.player);
  for(const npc of [...raid.npcs])if(npc!==raid.stranger)remove(raid,npc);
  for(const o of [...raid.objects])removeObject(raid,o);
  raid.effects=[]; raid.pools=[];
  raid.player.getPacketSender().sendVarbit(6448,100);
  raid.player.sendMessage(`${ROOMS[raid.room].name} defeated. Your hitpoints and prayer are restored.`);
  // The cache seals the two-tile exit walkway until Maiden is defeated.
  if(raid.room===0)for(let x=3176;x<=3177;x++)for(let y=4431;y<=4436;y++)raid.area.setClip(new core.Location(x,y,0),0);
  if(raid.room===1||raid.room===3) {
    raid.supplies=10;
    object(raid,SUPPLY_CHEST,ROOMS[raid.room].supplies);
  }
  if(raid.room===5) {
    raid.player.setAttribute?.(TREASURE_READY_ATTRIBUTE,true);
    raid.player.getMovementQueue?.().setBlockMovement?.(false);
    object(raid,TREASURE_ENTRANCE,TREASURE_ENTRANCE_TILE);
    raid.player.sendMessage("Verzik flees. Enter the treasure room to finish your raid.");
  }
  if(raid.mode==="bmr") {
    raid.player.sendMessage("The encounter is complete. Use the passage to continue.");
    if(raid.bmrIndex===BMR_ENCOUNTERS.length-1)api.emitCustomEvent("tob:bmr-completed",{player:raid.player});
  }
}
function leave(raid, teleport=true) {
  RAIDS.delete(raid.player);
  clearRoom(raid);
  raid.player.getMovementQueue().setBlockMovement(false);
  raid.player.getArea()?.leave(raid.player,false);
  raid.player.getPacketSender().sendVarbit(6440,0);
  if(teleport)raid.player.moveTo(new core.Location(3676,3217,0));
}
function later(raid,ticks,fn) { raid.effects.push({at:raid.tick+ticks,fn}); }
function projectile(raid,id,target=raid.player) {
  core.Projectile.createProjectile(raid.boss,target,id,40,65,31,43).sendProjectile();
}
function addPool(raid,tile,id,life=0,amount=3,heal=false) {
  const existing=raid.pools.find(pool=>pool.o.getId()===id&&pool.tile.every((value,index)=>value===tile[index]));
  if(existing) {
    existing.until=life?Math.max(existing.until,raid.tick+life):0;
    existing.amount=Math.max(existing.amount,amount);
    existing.heal ||= heal;
    return existing;
  }
  const p={o:object(raid,id,tile,22),tile,until:life?raid.tick+life:0,amount,heal};raid.pools.push(p);return p;
}
function maiden(raid) {
  const boss=raid.boss, p=raid.player;
  if(raid.tick%10===0) {
    if(++raid.attacks%3===0) {
      boss.performAnimation(new core.Animation(8092)); projectile(raid,1578);
      const t=p.getLocation(); const tile=[t.getX(),t.getY(),t.getZ()];
      later(raid,2,()=>{
        addPool(raid,tile,BLOOD_POOL,10,2+roll(3),true);
        if(Math.random()<0.1)spawn(raid,BLOOD_SPAWN,tile,{blood:true});
      });
    }else {
      boss.performAnimation(new core.Animation(8091)); projectile(raid,1577);
      later(raid,2,()=>{const hit=protection(p,2)?0:roll(20);damage(p,hit);if(raid.attacks%4===0)p.getSkillManager().decreaseCurrentLevel(core.Skill.STRENGTH,Math.ceil(hit/4),1);});
    }
  }
  if(raid.threshold<3 && boss.getHitpoints()/boss.getMaxHitpoints()<=[0.7,0.5,0.3][raid.threshold]) {
    raid.threshold++;
    for(const y of [4439,4453])spawn(raid,MAIDEN_CRAB,[3178,y,0],{crab:true});
  }
  for(const npc of [...raid.npcs]) {
    const d=NPC_RAIDS.get(npc);if(!alive(npc)||(!d?.crab&&!d?.blood)||raid.tick%2)continue;
    if(npc.getTimers().has(core.TimerKey.FREEZE))continue;
    const t=npc.getLocation();
    if(d.crab) {
      if(distance(t,boss.getLocation())<=5){boss.heal(npc.getHitpoints()*2);remove(raid,npc);}
      else npc.moveTo(new core.Location(t.getX()-1,t.getY()+Math.sign(4446-t.getY()),0));
    }else {addPool(raid,[t.getX(),t.getY(),0],BLOOD_POOL,10,2+roll(3),true);const dx=roll(2)-1,dy=roll(2)-1;const dest=t.transform(dx,dy);if(!core.RegionManager.blocked(dest,0))npc.moveTo(dest);}
  }
}
function bloat(raid) {
  const b=raid.boss,p=raid.player,t=raid.tick;
  const cycle=(t-1)%74;
  if(cycle<42) {
    const path=[[3288,4440],[3299,4440],[3299,4451],[3288,4451]];
    const health=b.getHitpoints()/b.getMaxHitpoints();
    const speed=health<0.6&&(health>=0.4||raid.attacks%2)?2:1;
    raid.bloatStep=((raid.bloatStep||0)+speed)%44;
    const phase=Math.floor(raid.bloatStep/11),from=path[phase],to=path[(phase+1)%4];
    const step=raid.bloatStep%11;
    b.moveTo(new core.Location(Math.round(from[0]+(to[0]-from[0])*step/11),Math.round(from[1]+(to[1]-from[1])*step/11),0));
    if(!behindBloatPillar(p,b))damage(p,protection(p,1)?2+roll(4):3+roll(7));
    if(health<0.9&&t%(health<0.6?4:6)===0) {
      const tiles=bloatHands(raid);for(const tile of tiles)graphic(p,1570+roll(3),tile);
      later(raid,3,()=>{if(tiles.some(tile=>distance(p.getLocation(),tile)===0)){damage(p,15+roll(15));p.getMovementQueue().setBlockMovement(true);later(raid,3,()=>p.getMovementQueue().setBlockMovement(false));}});
    }
  }else if(cycle===42)b.performAnimation(new core.Animation(8082));
  else if(cycle===72){if(!behindBloatPillar(p,b))damage(p,20+roll(20));b.performAnimation(new core.Animation(8080));}
}
function bloatHands(raid) {
  const candidates=[];
  for(let x=3288;x<=3303;x++)for(let y=4440;y<=4455;y++) {
    const tile=new core.Location(x,y,0),key=`${x},${y}`;
    if(!core.RegionManager.blocked(tile,0)&&!raid.bloatHandsLast?.has(key))candidates.push(tile);
  }
  // shortcut: sample walkable floor tiles; captured twelve-centre sampling is needed for matching raid speed records.
  const tiles=[];while(tiles.length<16&&candidates.length)tiles.push(candidates.splice(roll(candidates.length-1),1)[0]);
  raid.bloatHandsLast=new Set(tiles.map(t=>`${t.getX()},${t.getY()}`));return tiles;
}
function behindBloatPillar(player,boss) {
  const origin=boss.getLocation(),target=player.getLocation(),size=boss.getSize();
  for(let x=0;x<size;x++)for(let y=0;y<size;y++) {
    if(x!==0&&y!==0&&x!==size-1&&y!==size-1)continue;
    if(core.RegionManager.canProjectileAttackBounds(origin.transform(x,y),target,1,1,1,1,player.getPrivateArea()))return false;
  }
  return true;
}
function nextWave(raid) {
  if(++raid.wave>NYLO_WAVES.length)return;
  const lanes=[[3288,4248,0],[3295,4253,0],[3303,4248,0]];
  const pillarLoads=new Map(raid.pillars.filter(alive).map(pillar=>[pillar,0]));
  for(const npc of raid.npcs) {
    const d=NPC_RAIDS.get(npc);
    if(d?.nylo&&!d.aggressive&&pillarLoads.has(d.pillarTarget))pillarLoads.set(d.pillarTarget,pillarLoads.get(d.pillarTarget)+1);
  }
  NYLO_WAVES[raid.wave-1].forEach((group,lane)=>{
    for(const spec of group.split("+").filter(Boolean)) {
      const {aggressive,big,styles}=readNyloSpec(spec);
      const style=styles[0],pillarTarget=aggressive?null:choosePillar(raid,new core.Location(...lanes[lane]),pillarLoads);
      if(pillarTarget)pillarLoads.set(pillarTarget,pillarLoads.get(pillarTarget)+1);
      const ids=aggressive?(big?NYLO_FIGHTING_LARGE:NYLO_FIGHTING_SMALL):(big?NYLO_LARGE:NYLO_SMALL);
      spawn(raid,ids[style],lanes[lane],{nylo:true,style,big,aggressive,flashing:styles.length>1?styles:null,flashStep:0,flashAt:raid.tick+1,expires:raid.tick+(big?52:53),pillarTarget});
    }
  });
  raid.nextWave=now()+4;
  raid.player.getPacketSender().sendVarbit(6448,Math.floor(raid.wave*100/31));
}
function choosePillar(raid,position,loads=new Map()) {
  const candidates=raid.pillars.filter(alive);
  if(!candidates.length)return null;
  const distanceTo=pillar=>{const tile=pillar.getLocation();return Math.max(Math.abs(tile.getX()-position.getX()),Math.abs(tile.getY()-position.getY()));};
  const nearest=Math.min(...candidates.map(distanceTo));
  return candidates.filter(pillar=>distanceTo(pillar)<=nearest+1).sort((a,b)=>(loads.get(a)||0)-(loads.get(b)||0)||distanceTo(a)-distanceTo(b))[0];
}
function pillarTarget(raid,npc,d) {
  // Blood Moon uses a scoped Nylocas wave without the Entry Mode pillar phase.
  // Every spider in that encounter targets the player instead of looking up
  // the absent raid.pillars collection.
  if(d.aggressive||raid.mode==="bmr")return raid.player;
  if(!alive(d.pillarTarget)) {
    const loads=new Map(raid.pillars.filter(alive).map(pillar=>[pillar,0]));
    for(const other of raid.npcs) {
      const info=NPC_RAIDS.get(other);
      if(other!==npc&&info?.nylo&&!info.aggressive&&loads.has(info.pillarTarget))loads.set(info.pillarTarget,loads.get(info.pillarTarget)+1);
    }
    d.pillarTarget=choosePillar(raid,npc.getLocation(),loads);
  }
  return d.pillarTarget||raid.player;
}
function nylocas(raid) {
  if(raid.boss) {
    if(raid.tick>=raid.nextStyle) {
      const d=NPC_RAIDS.get(raid.boss), hitpoints=raid.boss.getHitpoints();d.style=(d.style+1+roll(1))%3;
      raid.boss.setNpcTransformationId(NYLO_BOSS[d.style]);
      // Changing the visible Vasilias form resets cache NPC HP; the encounter's
      // one health pool must carry across its melee/ranged/magic transformations.
      raid.boss.setHitpoints(Math.min(hitpoints,raid.boss.getMaxHitpoints()));
      raid.player.getCombat().reset();raid.nextStyle=raid.tick+10;
    }
    if(raid.tick%5===0){const s=NPC_RAIDS.get(raid.boss).style;damage(raid.player,protection(raid.player,s)?0:roll(15));}
    return;
  }
  for(const npc of [...raid.npcs]) {
    const d=NPC_RAIDS.get(npc);if(!alive(npc)||!d?.nylo)continue;
    if(d.flashing&&raid.tick>=d.flashAt) {
      d.flashStep++;
      d.style=d.flashing[d.flashStep];
      npc.setNpcTransformationId((d.aggressive?(d.big?NYLO_FIGHTING_LARGE:NYLO_FIGHTING_SMALL):(d.big?NYLO_LARGE:NYLO_SMALL))[d.style]);
      if(d.flashStep>=d.flashing.length-1)d.flashing=null;
      else d.flashAt=raid.tick+1;
    }
    if(updateNyloExpiry(raid,npc,d))continue;
    if(npc.getTimers().has(core.TimerKey.FREEZE))continue;
    const target=pillarTarget(raid,npc,d);
    if(!core.CombatRange.beside(npc,target)) {
      approachNylocas(npc,target);
    }else if(raid.tick%3===0) {
      if(target===raid.player)attackNylocas(npc,target,d.style);
      else {target.setHitpoints(target.getHitpoints()-1);if(!alive(target))damage(raid.player,30);}
    }
  }
  if(raid.mode==="bmr") {
    if(activeNylocas(raid)===0)roomComplete(raid);
    return;
  }
  if(!raid.pillars.some(alive)){damage(raid.player,raid.player.getHitpoints());return;}
  if(now()>=raid.nextWave) {
    const living=activeNylocas(raid);
    if(raid.wave>=NYLO_WAVES.length) {
      if(!living&&!raid.boss) {
        if(raid.bossAt===undefined)raid.bossAt=raid.tick+22;
        else if(raid.tick>=raid.bossAt){raid.boss=spawn(raid,NYLO_BOSS[0],ROOMS[2].boss,{boss:true,style:0});raid.nextStyle=raid.tick+10;}
      }
    } else if(living<(raid.wave<20?12:24))nextWave(raid);
    else raid.nextWave=now()+4;
  }
}
function attackNylocas(npc,player,style) {
  const method = NYLO_METHODS[style];
  const hit = new core.PendingHit(npc,player,method,{delay:0,experience:false});
  hit.setTotalDamage(protection(player,style)?0:Math.min(8,hit.getTotalDamage()));
  player.getCombat().getHitQueue().addPendingHit(hit);
}
function allowDawnbringer(event) {
  if(event.specialId!=="dawnbringer")return;
  const raid=RAIDS.get(event.attacker);
  if(raid&&raid.room===5&&raid.phase===0&&event.target===raid.boss)event.allow=true;
}
function approachNylocas(npc,target) {
  const p=npc.getLocation(),t=target.getLocation(),size=npc.getSize(),targetSize=target.getSize();
  let x=p.getX(),y=p.getY();
  if(x<t.getX())x=t.getX()-size;
  else if(x>t.getX()+targetSize-1)x=t.getX()+targetSize;
  if(y<t.getY())y=t.getY()-size;
  else if(y>t.getY()+targetSize-1)y=t.getY()+targetSize;
  if(x===p.getX()&&y===p.getY())x=t.getX()-size;
  npc.moveTo(p.transform(Math.sign(x-p.getX()),Math.sign(y-p.getY())));
}
function sotetseg(raid) {
  if(raid.maze) {
    const p=raid.player.getLocation();
    if(!raid.maze.path.has(`${p.getX()},${p.getY()}`))damage(raid.player,11+Math.floor(raid.player.getHitpoints()/15));
    if(raid.tick%7===0)damage(raid.player,1+roll(2));
    return;
  }
  if(raid.threshold<2&&raid.boss.getHitpoints()/raid.boss.getMaxHitpoints()<=[2/3,1/3][raid.threshold]) {raid.threshold++;startMaze(raid);return;}
  if(raid.tick%4===0) {
    const p=raid.player,type=distance(p.getLocation(),raid.boss.getLocation())<=5?0:1+roll(1);
    if(type===0) {raid.boss.performAnimation(new core.Animation(8138));damage(p,protection(p,0)?0:roll(25));}
    else {
      const big=++raid.attacks%10===0;
      raid.boss.performAnimation(new core.Animation(8139));projectile(raid,big?1604:type===2?1606:1607);
      later(raid,2,()=>damage(p,big?15:protection(p,type)?0:roll(20)));
    }
  }
}
function startMaze(raid) {
  raid.player.getCombat().reset();
  const path=new Set();let x=3359;
  for(let y=4307;y<=4329;y++) {
    if(y%3===0&&y<4328){const next=x+ (x<=3358?1:x>=3362?-1:roll(2)-1);for(let xx=Math.min(x,next);xx<=Math.max(x,next);xx++)path.add(`${xx},${y}`);x=next;}
    path.add(`${x},${y}`);
  }
  // The cached portal is fixed; the randomized path must join its approach tile.
  for(let xx=Math.min(x,3357);xx<=Math.max(x,3357);xx++)path.add(`${xx},4329`);
  raid.maze={path,end:[3357,4329,3],objects:[]};
  for(const tile of path){const [px,py]=tile.split(',').map(Number);raid.area.setClip(loc([px,py,3]),0);raid.maze.objects.push(object(raid,SHADOW_TILE,[px,py,3],22));}
  raid.player.moveTo(new core.Location(3359,4307,3));raid.player.sendMessage("Follow the red path to the portal. Straying off it is dangerous.");
}
function xarpus(raid) {
  if(raid.tick<=48) {
    if(raid.tick%4===0) {
      const room=ROOMS[4],tile=[room.centre[0]+roll(16)-8,room.centre[1]+roll(16)-8,1];
      const o=object(raid,EXHUMED,tile,22);
      later(raid,4,()=>{if(distance(raid.player.getLocation(),loc(tile))!==0)raid.boss.heal(10);removeObject(raid,o);});
    }
    return;
  }
  if(raid.boss.getHitpoints()/raid.boss.getMaxHitpoints()<=0.225) {
    if(raid.tick%8===0){raid.look=roll(3);raid.player.sendMessage(`Xarpus turns to face the ${['north-east','north-west','south-west','south-east'][raid.look]} quadrant.`);}
  }else if(raid.tick%4===0) {
    const t=raid.player.getLocation(),tile=[t.getX(),t.getY(),t.getZ()];raid.boss.performAnimation(new core.Animation(8059));projectile(raid,1555);
    later(raid,2,()=>{if(distance(raid.player.getLocation(),loc(tile))<=1)damage(raid.player,roll(15));addPool(raid,tile,ACID_POOL,0,3);});
  }
}
function quadrant(player,centre) { const p=player.getLocation();return p.getX()>=centre[0]?(p.getY()>=centre[1]?0:3):(p.getY()>=centre[1]?1:2); }
function phaseVerzik(raid,next) {
  raid.phase=next;raid.attacks=0;raid.redShield=0;raid.player.getCombat().reset();
  raid.boss.setNpcTransformationId(VERZIK_PHASES[next]).setMaxHitpoints(next===1?400:600).setHitpoints(next===1?400:600);
  raid.boss.moveTo(new core.Location(3167,4318,0));
  if(next===1)for(const pillar of raid.pillars){if(pillar.hp>0&&distance(raid.player.getLocation(),loc(pillar.tile))<=1)damage(raid.player,10+roll(10));if(raid.objects.has(pillar.o))removeObject(raid,pillar.o);object(raid,COLLAPSED_PILLAR,pillar.tile);}
  raid.player.sendMessage(next===1?"Verzik leaves her throne. Keep moving to avoid her bombs.":"Verzik transforms into a nylocas. Watch her attacks and special attacks.");
}
function spawnVerzikAdds(raid,red=false) {
  const id=red?VERZIK_RED:VERZIK_PURPLE;
  const adds=[spawn(raid,id,[3162,4316,0],{red,purple:!red})];
  if(red)adds.push(spawn(raid,id,[3177,4316,0],{red:true}));
  if(red)raid.redShield=raid.tick+VERZIK_RED_HEAL_TICKS;
  later(raid,12,()=>{for(const n of adds){if(alive(n)){raid.boss.heal(n.getHitpoints());remove(raid,n);}}});
}
function verzik(raid) {
  const p=raid.player,b=raid.boss;
  if(raid.phase<2&&b.getHitpoints()<=1){phaseVerzik(raid,raid.phase+1);return;}
  if(raid.phase===0) {
    if(raid.tick%14===0) {
      b.performAnimation(new core.Animation(8109));projectile(raid,1580);
      later(raid,3,()=>{
        const pos=p.getLocation();const cover=raid.pillars.find(pillar=>pillar.hp>0&&pos.getY()<pillar.tile[1]&&Math.abs(pos.getX()-pillar.tile[0])<=1);
        if(cover){if(--cover.hp===0){removeObject(raid,cover.o);object(raid,COLLAPSED_PILLAR,cover.tile);}}
        else damage(p,protection(p,2)?roll(15):roll(45));
      });
    }
    return;
  }
  if(raid.phase===1) {
    if(raid.tick%4===0) {
      const tile=p.getLocation().clone(),mage=b.getHitpoints()/b.getMaxHitpoints()<0.35;
      b.performAnimation(new core.Animation(8114));projectile(raid,mage?1591:1583);
      later(raid,2,()=>{if(distance(p.getLocation(),tile)===0)damage(p,protection(p,mage?2:1)?roll(5):roll(18));});
      if(distance(p.getLocation(),b.getLocation())<=4){damage(p,roll(20));p.moveTo(p.getLocation().transform(0,-2));}
      if(++raid.attacks%5===0) {
        projectile(raid,1585);later(raid,2,()=>damage(p,p.getEquipment().contains(core.ItemIdentifiers.INSULATED_BOOTS)?roll(2):roll(20)));
        spawnVerzikAdds(raid,raid.attacks%10===0);
      }
    }
    return;
  }
  const enrage=b.getHitpoints()/b.getMaxHitpoints()<0.2;
  if(enrage&&!raid.tornado)raid.tornado=spawn(raid,VERZIK_TORNADO,[3160,4310,0],{tornado:true});
  if(alive(raid.tornado)&&raid.tick%2===0) {
    const t=raid.tornado.getLocation(),dest=p.getLocation();raid.tornado.moveTo(t.transform(Math.sign(dest.getX()-t.getX()),Math.sign(dest.getY()-t.getY())));
    graphic(p,1602,raid.tornado.getLocation());
    if(distance(t,dest)<=1){const amount=Math.floor(p.getHitpoints()/2);damage(p,amount);b.heal(amount);}
  }
  if(raid.tick%(enrage?5:7))return;
  if(++raid.attacks%5) {
    const type=distance(p.getLocation(),b.getLocation())<=4?0:1+roll(1);
    b.performAnimation(new core.Animation(type===0?8123:type===1?8125:8124));
    if(type!==0)projectile(raid,type===1?1593:1594);
    later(raid,2,()=>damage(p,type===0?roll(30):protection(p,type)?roll(3):roll(20)));return;
  }
  const special=Math.floor(raid.attacks/5-1)%4;
  if(special===0) {
    const n=spawn(raid,NYLO_SMALL[roll(2)],[3160,4317,0],{explosive:true});
    later(raid,8,()=>{if(alive(n)){if(distance(n.getLocation(),p.getLocation())<2)damage(p,roll(25));remove(raid,n);}});
  }else if(special===1) {
    b.performAnimation(new core.Animation(8127));
    for(let i=0;i<4;i++){const t=p.getLocation().clone();graphic(p,1601,t);later(raid,2+i,()=>{if(distance(p.getLocation(),t)===0){const web=spawn(raid,VERZIK_WEB,[t.getX(),t.getY(),0],{web:true});p.getMovementQueue().setBlockMovement(true);later(raid,5,()=>{if(alive(web))damage(p,20);remove(raid,web);p.getMovementQueue().setBlockMovement(false);});}});}
  }else if(special===2) {
    const tile=[3160+roll(18),4310+roll(12),0];b.performAnimation(new core.Animation(8126));graphic(p,1595,loc(tile));
    raid.safe=raid.tick+7;p.sendMessage(`Stand on the yellow pool at ${tile[0]}, ${tile[1]}!`);
    later(raid,7,()=>{if(distance(p.getLocation(),loc(tile))!==0)damage(p,30+roll(15));raid.safe=0;});
  }else {projectile(raid,1598);later(raid,2,()=>damage(p,25));}
  for(const n of raid.npcs)if(NPC_RAIDS.get(n)?.explosive){const t=n.getLocation(),dest=p.getLocation();n.moveTo(t.transform(Math.sign(dest.getX()-t.getX()),Math.sign(dest.getY()-t.getY())));}
}
function process(raid) {
  if(!raid.started||raid.dead||raid.player.getHitpoints()<=0)return;
  // NPC death hooks normally complete the room. Also observe HP directly: the
  // core can remove a scripted boss after its death tick before that hook runs.
  if(raid.boss&&!alive(raid.boss)){
    if(raid.room===5&&raid.phase<2)phaseVerzik(raid,raid.phase+1);
    else roomComplete(raid);
    return;
  }
  raid.tick++;
  // Scripted fights stay engaged during mechanics where players must stop attacking.
  for(const npc of raid.npcs)npc.getCombat().getLastAttack().reset();
  const due=raid.effects.filter(e=>e.at<=raid.tick);raid.effects=raid.effects.filter(e=>e.at>raid.tick);for(const e of due)e.fn();
  for(const pool of [...raid.pools]) {
    if(pool.until&&raid.tick>=pool.until){removeObject(raid,pool.o);raid.pools.splice(raid.pools.indexOf(pool),1);continue;}
    if(distance(raid.player.getLocation(),loc(pool.tile))===0){damage(raid.player,pool.amount);if(pool.heal&&alive(raid.boss))raid.boss.heal(pool.amount);}
  }
  [maiden,bloat,nylocas,sotetseg,xarpus,verzik][raid.room](raid);
  if(alive(raid.boss))raid.player.getPacketSender().sendVarbit(6448,Math.floor(100*(1-raid.boss.getHitpoints()/raid.boss.getMaxHitpoints())));
}
function createArea() {
  return new (class TheatreArea extends core.PrivateArea {
    constructor(){super([new core.Boundary(3136,3327,4224,4479,0),new core.Boundary(3136,3327,4224,4479,1),new core.Boundary(3328,3391,4288,4351,3)]);}
    isMulti(){return true;}
    process(mobile){if(mobile.isPlayer?.()){const raid=RAIDS.get(mobile.getAsPlayer());if(raid)process(raid);}}
    canAttack(attacker,target){
      if(attacker.isNpc?.())return false;
      const raid=RAIDS.get(attacker),data=NPC_RAIDS.get(target);
      if(!raid||!data||data.raid!==raid||!raid.started||raid.maze||raid.dead||data.pillar||target===raid.stranger)return false;
      if(data.flashing)return false;
      if(target===raid.boss&&((raid.room===4&&raid.tick<=48)||(raid.room===5&&raid.safe>raid.tick)))return false;
      return null;
    }
    canTeleport(){return false;}
    postLeave(mobile,logout){if(mobile.isPlayer?.()){const raid=RAIDS.get(mobile.getAsPlayer());if(raid){RAIDS.delete(raid.player);clearRoom(raid);raid.player.getMovementQueue().setBlockMovement(false);}}super.postLeave(mobile,logout);}
  })();
}
function enter({player,objectId}) {
  if(objectId!==RAID_ENTRANCE)return false;
  if(player.getAttribute(TREASURE_READY_ATTRIBUTE)===true){restoreCompletedRaid(player);return true;}
  if(!player.getAttribute(PARTY_ATTRIBUTE))return false;
  if(!ensureEscapeCrystal(player))return true;
  const area=createArea(),raid={player,area,npcs:new Set(),objects:new Set(),effects:[],pools:[],room:0};
  RAIDS.set(player,raid);area.enter(player);player.getPacketSender().sendVarbit(6440,2);enterRoom(raid,0);return true;
}
function ensureEscapeCrystal(player) {
  const inventory=player.getInventory(),id=core.ItemIdentifiers.ESCAPE_CRYSTAL_2;
  if(inventory.contains(id))return true;
  if(inventory.getFreeSlots()<1){player.sendMessage("You need one free inventory space to enter the Theatre.");return false;}
  inventory.adds(id,1);return true;
}
function startBmr({player}) {
  if(!player||RAIDS.has(player))return;
  if(!ensureEscapeCrystal(player))return;
  const area=createArea(),raid={player,area,npcs:new Set(),objects:new Set(),effects:[],pools:[],room:2,mode:"bmr",bmrIndex:0};
  RAIDS.set(player,raid);area.enter(player);player.getPacketSender().sendVarbit(6440,2);enterRoom(raid,BMR_ENCOUNTERS[0].room);
}
function notice({player,objectId}) {
  if(objectId!==core.ObjectIdentifiers.NOTICE_BOARD_5)return false;
  api.sendMultiChatboxPrompt(player,"Theatre of Blood: choose a mode","Solo Entry Mode.",()=>{player.setAttribute(PARTY_ATTRIBUTE,true);player.sendMessage("Your Entry Mode party is ready. Enter the Theatre when prepared.");},"Normal Mode party.",()=>{player.setAttribute(PARTY_ATTRIBUTE,false);api.emitCustomEvent("tob:normal-party",{player});},"Cancel.",()=>{});return true;
}
function barrier({player,objectId,location}) {
  const raid=RAIDS.get(player);if(!raid||objectId!==BARRIER)return false;
  if(!raid.complete)startRoom(raid);
  else {
    const p=player.getLocation();
    player.moveTo(raid.room===0||raid.room===1?new core.Location(location.x+(p.getX()>location.x?-1:1),p.getY(),p.getZ()):new core.Location(p.getX(),location.y+(p.getY()>location.y?-1:1),p.getZ()));
  }
  return true;
}
function passage({player,objectId}) {
  const raid=RAIDS.get(player);if(!raid||![PASSAGE,XARPUS_EXIT].includes(objectId))return false;
  if(!raid.complete){player.sendMessage("You must defeat this room's challenge first.");return true;}
  if(raid.mode==="bmr") {
    if(raid.bmrIndex<BMR_ENCOUNTERS.length-1){raid.bmrIndex++;enterRoom(raid,BMR_ENCOUNTERS[raid.bmrIndex].room);}
    return true;
  }
  if(raid.room<5)enterRoom(raid,raid.room+1);return true;
}
function treasure({player,objectId}) {
  const raid=RAIDS.get(player);if(!raid||objectId!==TREASURE_ENTRANCE)return false;
  if(raid.room!==5||!raid.complete)return true;
  player.moveTo(loc(TREASURE_ROOM_ENTRY_TILE));object(raid,REWARD_CHEST,REWARD_CHEST_TILE);
  raid.rewardReady=true;return true;
}
function reward({player,objectId}) {
  const raid=RAIDS.get(player);if(!raid||objectId!==REWARD_CHEST||!raid.rewardReady)return false;
  if(!raid.rewardClaimed){raid.rewardClaimed=true;player.setAttribute(COMPLETIONS_ATTRIBUTE,(Number(player.getAttribute(COMPLETIONS_ATTRIBUTE))||0)+1);player.setAttribute(TREASURE_READY_ATTRIBUTE,false);player.getPacketSender().sendVarbit(12972,1);api.emitCustomEvent("tob:completed",{player,mode:"entry"});player.sendMessage("You have completed the Theatre of Blood: Entry Mode.");}
  return true;
}
function teleport({player,objectId}) {
  const raid=RAIDS.get(player);if(!raid||objectId!==TELEPORT_CRYSTAL)return false;
  leave(raid);return true;
}
function shadowExit({player,objectId}) {
  const raid=RAIDS.get(player);if(!raid?.maze||objectId!==SHADOW_EXIT)return false;
  if(distance(player.getLocation(),loc(raid.maze.end))>2){player.sendMessage("Follow the path all the way to the portal.");return true;}
  for(const o of raid.maze.objects)removeObject(raid,o);
  raid.maze=null;player.moveTo(loc(ROOMS[3].inside));return true;
}
function chest({player,objectId}) {
  const raid=RAIDS.get(player);if(!raid||![SUPPLY_CHEST,OPEN_SUPPLY_CHEST].includes(objectId))return false;
  const count=Math.min(raid.supplies||0,player.getInventory().getFreeSlots());
  for(let i=0;i<count;i++)player.getInventory().adds(core.ItemIdentifiers.BANDAGES_4,1);
  raid.supplies-=count;player.sendMessage(count?`You take ${count} bandages.`:"The supply chest is empty, or your inventory is full.");return true;
}
function skeleton({player,objectId}) {
  if(!RAIDS.has(player)||objectId!==DAWNBRINGER_SKELETON)return false;
  if(player.getInventory().contains(core.ItemIdentifiers.DAWNBRINGER)||player.getEquipment().contains(core.ItemIdentifiers.DAWNBRINGER))return true;
  if(!player.getInventory().getFreeSlots()){player.sendMessage("You need a free inventory space.");return true;}
  player.getInventory().adds(core.ItemIdentifiers.DAWNBRINGER,1);player.sendMessage("You recover Dawnbringer from the skeleton.");return true;
}
function talkVerzik({player,npc}) {
  const raid=RAIDS.get(player);if(!raid||npc!==raid.boss||raid.room!==5)return false;
  api.sendMultiChatboxPrompt(player,"Is your party ready?","Yes.",()=>startRoom(raid),"No.",()=>{});return true;
}
function talkStranger({player,npcId,npc}) {
  const raid=RAIDS.get(player);if(!raid||npc!==raid.stranger)return false;
  require("../../quests/QuestRuntime").startTranscript(api,player,npcId,"A Night at the Theatre",`a-night-at-the-theatre-${ROOMS[raid.room].advice}`);return true;
}
function dealtDamage({player,target,hit}) {
  const d=NPC_RAIDS.get(target),raid=d?.raid;if(!raid||raid.player!==player)return;
  const amount=hit.getTotalDamage(),type=typeIndex(hit.getCombatType());
  if(d.nylo) {
    d.lockedPlayers ||= new WeakSet();
    if(d.lockedPlayers.has(player)||type!==d.style) {
      if(type!==d.style)d.lockedPlayers.add(player);
      hit.setTotalDamage(0);
    }
  }
  if(target===raid.boss&&raid.room===2&&type!==d.style){hit.setTotalDamage(0);target.heal(amount);damage(player,amount);}
  if(target===raid.boss&&raid.room===1){if(amount>0)raid.attacks++;if((raid.tick-1)%74<42)hit.setTotalDamage(Math.floor(amount/2));}
  if(target===raid.boss&&raid.room===4&&raid.look===quadrant(player,ROOMS[4].centre)){hit.setTotalDamage(0);damage(player,amount*2);}
  if(raid.room===5&&target===raid.boss&&raid.redShield>raid.tick){hit.setTotalDamage(0);target.heal(amount);}
  if(d.purple){const weapon=player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId();const name=core.ItemDefinition.forId(weapon??-1)?.getName?.()||"";if(/\(p\+*\)|tentacle|blowpipe/i.test(name)){hit.setTotalDamage(target.getHitpoints());}else hit.setTotalDamage(0);}
}
function modifyVerzikHit({npc,hit}) {
  const d=NPC_RAIDS.get(npc),raid=d?.raid;
  if(!raid||raid.room!==5||npc!==raid.boss)return;
  if(raid.phase===0&&raid.player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId()!==core.ItemIdentifiers.DAWNBRINGER)hit.setTotalDamage(Math.min(hit.getTotalDamage(),10));
  if(raid.phase<2)hit.setTotalDamage(Math.min(hit.getTotalDamage(),Math.max(0,npc.getHitpoints()-npc.getCombat().getHitQueue().getQueuedDamage()-1)));
}
function verzikBeforeDeath(event) {
  const {npc}=event;
  const d=NPC_RAIDS.get(npc),raid=d?.raid;
  if(!raid||raid.room!==5||npc!==raid.boss||raid.phase>=2)return;
  event.preventDeath=true;
  npc.getCombat().getHitQueue().clear();
  phaseVerzik(raid,raid.phase+1);
}
function npcDeath({npc}) {
  const d=NPC_RAIDS.get(npc);if(!d)return;const raid=d.raid;
  splitNylocas(raid,npc,d);
  if(d.nylo&&raid.wave>=NYLO_WAVES.length&&!raid.boss&&activeNylocas(raid,npc)===0)raid.bossAt=raid.tick+22;
  if(npc===raid.boss&&(raid.room!==5||(raid.phase===2&&!alive(npc))))roomComplete(raid);
}
function splitNylocas(raid,npc,d) {
  if(!d.big)return;
  for(let i=0;i<2;i++) {
    const style=roll(2),p=npc.getLocation(),pillarTarget=d.pillarTarget;
    spawn(raid,(pillarTarget?NYLO_SMALL:NYLO_FIGHTING_SMALL)[style],[p.getX()+i,p.getY(),p.getZ()],{nylo:true,style,expires:raid.tick+53,pillarTarget});
  }
}
function drops(event) {if(NPC_RAIDS.has(event.npc))event.handled=true;}
function hasCompletion(request) { if((Number(request.player.getAttribute(COMPLETIONS_ATTRIBUTE)) || 0) > 0) request.complete = true; }
function keepItems(event) {if(RAIDS.has(event.player))event.shouldDrop=false;}
function died(event) {
  const raid=RAIDS.get(event.player);if(!raid)return;event.handled=true;
  raid.player.getCombat().reset();raid.dead=true;
  clearRoom(raid);restore(raid.player);enterRoom(raid,raid.room);
  for(let i=0;i<3&&raid.player.getInventory().getFreeSlots();i++)raid.player.getInventory().adds(core.ItemIdentifiers.BANDAGES_4,1);
  raid.player.sendMessage("You may retry this challenge. Entry Mode has unlimited attempts.");
}
function item(event) {
  const {player,itemId,option}=event,raid=RAIDS.get(player);
  if(!raid)return;
  if(itemId===core.ItemIdentifiers.ESCAPE_CRYSTAL_2&&String(option).toLowerCase()==="teleport"){event.handled=true;player.getInventory().deleteNumber(itemId,1);leave(raid);}
  if(itemId!==core.ItemIdentifiers.BANDAGES_4||String(option).toLowerCase()!=="heal")return;
  event.handled=true;player.getInventory().deleteNumber(itemId,1);player.heal(20);player.setRunEnergy(Math.min(100,player.getRunEnergy()+20));
  const skills=player.getSkillManager();skills.increaseCurrentLevel(core.Skill.PRAYER,Math.floor(skills.getMaxLevel(core.Skill.PRAYER)*0.25)+7,skills.getMaxLevel(core.Skill.PRAYER));
  for(const skill of [core.Skill.ATTACK,core.Skill.STRENGTH,core.Skill.DEFENCE,core.Skill.RANGED,core.Skill.MAGIC])skills.increaseCurrentLevel(skill,Math.floor(skills.getMaxLevel(skill)*0.15)+5,Math.floor(skills.getMaxLevel(skill)*1.15)+5);
  api.emitCustomEvent("potions:apply-stamina",{player,durationMs:60_000});
}
function restoreCompletedRaid(player) {
  if(RAIDS.has(player)||player.getAttribute(TREASURE_READY_ATTRIBUTE)!==true)return false;
  const area=createArea(),raid={player,area,npcs:new Set(),objects:new Set(),effects:[],pools:[],room:5,mode:"entry",complete:true,started:false,rewardReady:false,rewardClaimed:false};
  RAIDS.set(player,raid);area.enter(player);player.getMovementQueue?.().setBlockMovement?.(false);player.moveTo(loc(ROOMS[5].entry));
  raid.stranger=spawn(raid,core.NpcIdentifiers.MYSTERIOUS_STRANGER_4,[ROOMS[5].entry[0]+1,ROOMS[5].entry[1],ROOMS[5].entry[2]]);
  object(raid,TREASURE_ENTRANCE,TREASURE_ENTRANCE_TILE);
  player.getPacketSender().sendVarbit(6440,2).sendVarbit(6448,100).sendVarbit(6449,100).sendVarbit(6447,2);
  player.sendMessage("Your completed Entry Mode raid is ready. Enter the treasure room to claim your reward.");
  return true;
}
function login({player}) {
  if(restoreCompletedRaid(player))return;
  const p=player.getLocation();if(p.getX()>=3136&&p.getX()<=3391&&p.getY()>=4224&&p.getY()<=4479){player.moveTo(new core.Location(3676,3217,0));player.sendMessage("Your previous Theatre run is no longer available. Start a new party at the notice board.");}
}
module.exports=function registerEntryTheatreOfBlood(pluginApi) {
  api=pluginApi;core=api.core;
  class NylocasCombatMethod extends core.CombatMethod {
    constructor(type) { super(); this.combatType=type; }
    type() { return this.combatType; }
    hits(npc,player) { return [new core.PendingHit(npc,player,this)]; }
  }
  NYLO_METHODS=[core.CombatType.MELEE,core.CombatType.RANGED,core.CombatType.MAGIC].map(type=>new NylocasCombatMethod(type));
  api.persistAttribute(COMPLETIONS_ATTRIBUTE);
  api.persistAttribute(TREASURE_READY_ATTRIBUTE);
  api.onObjectInteraction("Theatre of Blood",{Enter:enter});
  api.onObjectInteraction("Notice board",{Read:notice,read:notice});
  api.onObjectInteraction("Barrier",{Pass:barrier});
  api.onObjectInteraction("Formidable passage",{Enter:passage,"Quick-Enter":passage});
  api.onObjectInteraction("Door",{Enter:passage,"Quick-enter":passage});
  api.onObjectInteraction("Treasure room",{Enter:treasure});
  api.onObjectInteraction("Monumental chest",{Open:reward,Search:reward});
  api.onObjectInteraction("Teleport crystal",{Use:teleport});
  api.onObjectInteraction("Portal",{Enter:shadowExit});
  api.onObjectInteraction("Chest",{Open:chest,Search:chest});
  api.onObjectInteraction("Skeleton",{Search:skeleton});
  api.onNpcInteraction("Verzik Vitur",{"Talk-to":talkVerzik});
  api.onNpcInteraction("Mysterious Stranger",{"Talk-to":talkStranger});
  api.onPlayerDealtDamage(dealtDamage);
  api.onNpcHitModify(modifyVerzikHit);
  api.onNpcBeforeDeath(verzikBeforeDeath);
  api.onNpcDeath(npcDeath);
  api.onCustomEvent("npc-drops:generated",drops);
  api.onCustomEvent("tob:bmr-start",startBmr);
  api.onCustomEvent("tob:has-completion",hasCompletion);
  api.onCustomEvent("combat-special:can-use",allowDawnbringer);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onPlayerDeath(died);
  api.onItemAction(item);
  api.onPlayerLogin(login);
};
module.exports._test={ROOMS,NYLO_WAVES,BMR_ENCOUNTERS,BMR_WAVE,TREASURE_ENTRANCE_TILE,TREASURE_ROOM_ENTRY_TILE,REWARD_CHEST_TILE,readNyloSpec,firstNyloWaveAt,soloNyloPillarHitpoints,activeNylocas,updateNyloExpiry,typeIndex,quadrant,behindBloatPillar,bloatHands,dealtDamage,modifyVerzikHit,verzikBeforeDeath,npcDeath,spawnVerzikAdds,NPC_RAIDS,startMaze,maiden,roomComplete,nextWave,process,createArea,restoreCompletedRaid,RAIDS,xarpus,splitNylocas,approachNylocas,attackNylocas,allowDawnbringer,item,choosePillar,pillarTarget,startBmr,startRoom,passage,ensureEscapeCrystal};
