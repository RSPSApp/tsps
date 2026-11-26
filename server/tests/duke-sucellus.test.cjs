const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const H=require('./helpers/duke-sucellus.cjs');
before(H.initialize);
test('source-cache approach, arrival and front combat tiles are walkable',t=>{
  const h=H.harness(t),s=h.enter();
  for(const [x,y] of [h.C.data.site.outside,h.C.data.site.arrival,[3039,6451],[3035,6451]]) {
    const at=s.tile([x,y]);
    assert.equal(s.area.getClip(at)&0x200100,0,`source tile ${x},${y} must be clear`);
  }
});
test('postquest heavy door reaches asylum gates without replaying the quest prison',t=>{
  const h=H.harness(t);const event={player:h.p,objectId:49513,location:{x:2926,y:10354,z:0},handled:false};
  h.p.setLocation(new h.core.Location(2925,10354,0));
  h.interact(event);assert.equal(event.handled,false);
  h.api.onCustomEvent('quest:is-complete',e=>{e.complete=true;});
  h.interact(event);assert.equal(event.handled,true);
  assert.equal(h.p.getLocation().getX(),3039);assert.equal(h.p.getLocation().getY(),6432);
  assert.equal(h.session,null);
});
test('actual object-hook coordinate payload opens the gate and dispatches preparation actions',t=>{
  const h=H.harness(t);h.api.onCustomEvent('quest:is-complete',e=>{e.complete=true;});
  const gate={player:h.p,objectId:49138,location:{x:3039,y:6433,z:0},handled:false};
  h.interact(gate);assert.equal(gate.handled,true);
  h.move([3031,6453]);const at=h.session.tile([3030,6453]);
  const patch={player:h.p,objectId:47528,location:{x:at.getX(),y:at.getY(),z:0},handled:false};
  h.interact(patch);assert.equal(patch.handled,true);
  assert.equal(h.p.getInventory().getAmount(28345),1);
});
test('quest gate, real private area, owner-only combat and exit cleanup',t=>{
  const h=H.harness(t);
  assert.equal(h.Site.enter(h.p),false);
  const s=h.enter(); assert.ok(s); assert.equal(s.boss.getContentId(h.p),12167);
  assert.equal(s.area.canAttack(h.p,s.boss),false);
  h.add(h.C.data.items.awakenerOrb); h.add(h.C.data.items.poison,2);
  h.move([3039,6451]);
  h.Prep.feed({player:h.p,npc:s.boss});h.Prep.feed({player:h.p,npc:s.boss});
  h.step();
  assert.equal(s.boss.getHitpoints(),485);assert.equal(s.area.canAttack(h.p,s.boss),true);
  assert.equal(s.area.canAttack({},s.boss),false);
  assert.equal(h.p.getInventory().getAmount(h.C.data.items.awakenerOrb),1);
  const grave={player:h.p};h.Site.grave(grave);assert.equal(grave.feeMultiplier,.25);
  h.Site.leave(h.p);assert.equal(s.ended,true);assert.equal(s.area.isDestroyed(),true);
  assert.equal(h.p.getPrivateArea(),null);
});
test('magic uses the real projectile packet argument order and targets its player',t=>{
  const h=H.harness(t);h.enter();h.move([3039,6440]);h.fight.wake();h.fight.auto();
  const packet=h.packets.find(p=>p[0]==='sendProjectile');
  assert.equal(packet[5],2434);assert.equal(packet[8],h.p);
});
test('one styled strike invokes positive damage equipment reactions only once',t=>{
  const h=H.harness(t);h.enter();h.fight.wake();
  const effects=require('../dist/game/content/combat/EquipmentEffects');let charges=0;
  effects.registerIncomingDamageModifier((victim,hit)=>{if(victim===h.p && hit.getDamage()>0)charges++;});
  t.mock.method(Math,'random',()=>.99);h.C.strike(h.fight,'magic',48);h.step();
  assert.equal(charges,1,'the reaction runs once when the queued strike lands');
});
test('powder yield, atomic vat fermentation and two doses wake exactly once',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;
  h.p.getSkillManager().setCurrentLevel(h.core.Skill.HERBLORE,80);
  h.add(i.pestle);h.add(i.arder);h.add(i.musca);
  for(const id of [i.arder,i.musca]) h.Prep.grind({player:h.p,usedItemId:i.pestle,usedWithItemId:id});
  assert.equal(h.p.getInventory().getAmount(i.arderPowder),6);
  h.move([3034,6437]);assert.equal(h.Prep.fill(s,[3034,6438]),true);
  assert.equal(s.vats.size,1);
  assert.equal(s.vats.values().next().value.readyAt,null);
  h.add(i.salt,6);h.Prep.fill(s,[3034,6438]);assert.equal(s.vats.size,1);
  assert.equal(h.p.getInventory().getAmount(i.arderPowder),0);
  h.step(5);assert.equal(s.vats.values().next().value.ready,false);
  h.step();assert.equal(s.vats.values().next().value.ready,true);
  h.Prep.collect(s,[3034,6438]);assert.equal(h.p.getInventory().getAmount(i.poison),1);
  h.add(i.poison,2);h.move([3039,6451]);
  for(let n=0;n<3;n++)h.Prep.feed({player:h.p,npc:s.boss});
  h.step();
  assert.equal(h.p.getInventory().getAmount(i.poison),1);assert.equal(s.meter,200);
  assert.equal(s.fight.active,true);
});
test('unavoidable chip preserves perfection, zero magic removes it, and stopped hits cannot damage',t=>{
  const h=H.harness(t);h.enter();h.move([3039,6451]);h.fight.wake();h.fight.nextAttack=Infinity;
  t.mock.method(Math,'random',()=>0);
  h.C.strike(h.fight,'melee',11,{accurate:false,avoidable:false});h.step();
  assert.equal(h.fight.perfect,true);
  h.C.strike(h.fight,'magic',48,{evenZero:true});h.step();
  assert.equal(h.fight.perfect,false);
  t.mock.method(Math,'random',()=>.99);
  const hp=h.p.getHitpoints();h.C.hurt(h.fight,70);h.fight.stop();h.step();
  assert.equal(h.p.getHitpoints(),hp);
});
test('gaze is avoided behind actual pillars; exposed targets take queued damage',t=>{
  const h=H.harness(t);h.enter();h.move([3035,6451]);h.fight.wake();h.fight.nextAttack=Infinity;
  t.mock.method(Math,'random',()=>.5);
  h.fight.gaze();h.step(5);assert.equal(h.p.getHitpoints(),99);assert.equal(h.fight.perfect,true);
  h.move([3039,6451]);h.fight.gaze();h.step(6);assert.ok(h.p.getHitpoints()<99);
  assert.equal(h.fight.perfect,false);
});
test('positive aimed slam is avoidable by stepping out; queued events cancel on leaving',t=>{
  const h=H.harness(t);h.enter();h.move([3039,6451]);h.fight.wake();h.fight.nextAttack=Infinity;
  t.mock.method(Math,'random',()=>.5);
  h.fight.auto();h.move([3040,6451]);h.step(2);assert.equal(h.fight.perfect,true);
  const f=h.fight;f.gaze();const hp=h.p.getHitpoints();h.Site.leave(h.p);h.step(6);
  assert.equal(h.p.getHitpoints(),hp);assert.equal(f.events.length,0);
});
test('eight-pick patches reset on awakening, supplies survive kills and vanish before death',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3031,6453]);
  for(let n=0;n<10;n++)h.Prep.pick(s,'arder');
  assert.equal(h.p.getInventory().getAmount(i.arder),8);
  h.add(i.poison,3);h.move([3039,6451]);
  h.Prep.feed({player:h.p,npc:s.boss});h.Prep.feed({player:h.p,npc:s.boss});
  h.step();
  assert.equal(s.picks.arder,0);
  const first=s.fight;first.fell();first.won(h.p);
  assert.equal(h.p.getAttribute(h.C.KILLS),1);assert.equal(s.perfectKills,1);
  h.step(24);assert.notEqual(s.fight,first);assert.equal(s.fight.active,false);
  assert.equal(h.p.getInventory().getAmount(i.poison),1);
  assert.equal(h.p.getInventory().getAmount(i.arder),8);
  h.Site.beforePlayerDeath({player:h.p});assert.equal(h.p.getInventory().getAmount(i.poison),0);
  assert.equal(h.p.getInventory().getAmount(i.arder),0);
  const grave={player:h.p};h.Site.grave(grave);assert.ok(grave.tile);
});
test('a finished vat survives a full inventory and collection only grants one dose',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3034,6437]);
  for(const id of [i.salt,i.arderPowder,i.muscaPowder])h.add(id,6);
  h.Prep.fill(s,[3034,6438]);h.step(6);
  for(let n=0;n<28;n++)h.add(526);
  h.Prep.collect(s,[3034,6438]);assert.equal(s.vats.size,1);assert.equal(h.p.getInventory().getAmount(i.poison),0);
  h.p.getInventory().deleteNumber(526,1);h.Prep.collect(s,[3034,6438]);h.Prep.collect(s,[3034,6438]);
  assert.equal(s.vats.size,0);assert.equal(h.p.getInventory().getAmount(i.poison),1);
});
test('perfect reward context only belongs to dead current boss and its owner',t=>{
  const h=H.harness(t),s=h.enter();h.fight.wake();h.fight.fell();s.boss.setHitpoints(0);
  const F=require('../plugins/bosses/dukesucellus/Fight.DukeSucellus');
  const context={};F.context({player:h.p,npc:s.boss,context});assert.equal(context.perfectKill,true);
  const foreign={};F.context({player:{},npc:s.boss,context:foreign});assert.deepEqual(foreign,{});
  const copied={};F.context({player:h.p,npc:{__dukeSucellusFight:h.fight,getHitpoints:()=>0},context:copied});assert.deepEqual(copied,{});
  h.fight.perfect=false;F.context({player:h.p,npc:s.boss,context});assert.equal(context.perfectKill,false);
});
test('kill time runs from waking to the kill count message and reconciles existing generic kill counts',t=>{
  const h=H.harness(t);let total=41;
  h.api.onCustomEvent('combat-achievements:count',e=>{if(e.monster==='Duke Sucellus')e.total=total;});
  const s=h.enter();s.fight.wake();s.fight.nextAttack=Infinity;h.step(3);s.fight.fell();
  total=42;h.step(4);s.fight.won(h.p);
  assert.equal(h.p.getAttribute(h.C.KILLS),42);
  assert.equal(h.p.getAttribute(h.C.BEST),7);
  assert.ok(h.messages.includes('Fight duration: <col=ff0000>0:04.20</col> (new personal best)'));
});
test('actual NPC death task records once and respawns an asleep encounter',t=>{
  const h=H.harness(t),s=h.enter();h.move([3035,6451]);s.fight.wake();s.fight.nextAttack=Infinity;
  const first=s.fight;s.boss.getCombat().addDamage(h.p,1);s.boss.setHitpoints(0);
  h.step(10);assert.equal(first.over,true);assert.equal(first.wonAlready,true);
  assert.equal(h.p.getAttribute(h.C.KILLS),1);
  h.step(15);assert.notEqual(s.fight,first);assert.equal(s.fight.active,false);
  assert.equal(s.boss.getContentId(h.p),12167);assert.equal(s.perfectKills,1);
});
test('source speed achievements use the kill count timer and are excluded on a Slayer task',t=>{
  const h=H.harness(t);const s=h.enter();s.fight.wake();s.fight.fell();s.fight.won(h.p);
  const Data=require('../plugins/achievements/combatachievements/Data.CombatAchievements');Data(h.api);
  for(const name of ['Cold Feet','Mirror Image','Perfect Duke Sucellus','Duke Sucellus Speed-Trialist','Duke Sucellus Speed-Chaser','Duke Sucellus Speed-Runner']) assert.ok(Data.taskNamed(name),name);
  const awards=()=>h.emitted.filter(([name])=>name==='combat-achievements:complete').map(([,e])=>e.task).filter(name=>name.startsWith('Duke Sucellus Speed-'));
  assert.ok(awards().includes('Duke Sucellus Speed-Runner'));
  const before=awards().length;s.reset();s.fight.wake();
  h.api.onCustomEvent('slayer:on-task',e=>{e.onTask=true;});s.fight.fell();s.fight.won(h.p);
  assert.equal(awards().length,before);
});
test('the asylum plays Eye See You from arrival; its copied map has no track of its own',t=>{
  const h=H.harness(t),s=h.enter();
  const {Music}=require('../dist/game/Music');
  const at=h.p.getLocation(),source=Music.instanceSourceTile(s.area,at.getX(),at.getY(),at.getZ());
  assert.deepEqual(Music.tracksAt(source.x,source.y,source.plane,false),[],'nothing to play from the tiles: the previous track would carry on');
  assert.equal(s.area.getMusicTrack(h.p),763);
  h.Site.leave(h.p);
});
