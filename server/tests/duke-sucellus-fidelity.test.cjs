const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const H=require('./helpers/duke-sucellus.cjs');
before(H.initialize);

test('Duke keeps sleeping and awake scripted HP through the real idle NPC regeneration clock',t=>{
  const h=H.harness(t),s=h.enter(),boss=s.boss;
  h.step(40);boss.getCombat().getLastAttack().reset(1);
  boss.setHitpoints(50);boss.process();
  assert.equal(boss.getHitpoints(),50,'the preparation meter must not be refilled by generic healing');
  h.fight.wake();h.fight.nextAttack=Infinity;
  boss.setHitpoints(300);boss.getCombat().getLastAttack().reset(1);
  for(let i=0;i<5;i++){h.step();boss.process();}
  assert.equal(boss.getHitpoints(),300,'waking does not restore idle regeneration');
  s.reset();assert.equal(s.boss.hasFlag('combat:no-regen'),true,'every respawn owns the same scoped policy');
});

test('vat interactions reach every cache footprint edge, without reaching past it',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items,at=h.C.data.resources.vats[0];
  h.move([3036,6438]);h.add(i.arder,3);
  assert.equal(h.Prep.fill(s,at),true);
  assert.equal(h.p.getInventory().getAmount(i.arder),0);
  for(const tile of [[3033,6438],[3034,6437],[3034,6440],[3036,6438]]){
    h.move(tile);assert.equal(h.Prep.check(s,at),true);
  }
  h.move([3037,6438]);assert.equal(h.Prep.empty(s,at),false);
  h.move([3036,6438]);assert.equal(h.Prep.empty(s,at),true);
  assert.equal(h.p.getInventory().getAmount(i.arderPowder),3);
});

test('salt mining reaches the far edge of its three-tile cache footprint',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;
  h.move([3036,6448]);h.add(i.ironPickaxe);
  h.api.onCustomEvent('mining:best-pickaxe',e=>{e.pickaxe={animation:625,attemptIntervalTicks:4};});
  assert.equal(h.Prep.mine(s,[3033,6448]),true);h.step(4);
  assert.ok(h.p.getInventory().getAmount(i.salt)>0);
});

test('left-click Feed falls back to mushroom powder after poisons, never raw mushrooms',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3039,6451]);
  h.add(i.arder,2);h.add(i.muscaPowder,40);
  h.Prep.feed({player:h.p,npc:s.boss});
  assert.equal(s.meter,5);assert.equal(h.p.getInventory().getAmount(i.muscaPowder),39);
  assert.equal(h.p.getInventory().getAmount(i.arder),2);
  h.add(i.poison);h.Prep.feed({player:h.p,npc:s.boss});
  assert.equal(s.meter,105);assert.equal(h.p.getInventory().getAmount(i.poison),0);
});

test('powder is fed at most once each game cycle and cannot be wasted after waking',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3039,6451]);h.add(i.arderPowder,45);
  for(let n=0;n<50;n++)h.Prep.feed({player:h.p,npc:s.boss});
  assert.equal(s.meter,5);assert.equal(h.p.getInventory().getAmount(i.arderPowder),44);
  for(let n=0;n<39;n++){h.step();h.Prep.feed({player:h.p,npc:s.boss});}
  h.step();
  assert.equal(s.fight.active,true);assert.equal(h.p.getInventory().getAmount(i.arderPowder),5);
  h.Prep.feed({player:h.p,npc:s.boss});assert.equal(h.p.getInventory().getAmount(i.arderPowder),5);
});

test('mushrooms automatically grind immediately, two ticks later, then every three ticks',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.add(i.pestle);h.add(i.arder,4);
  h.Prep.grind({player:h.p,usedItemId:i.pestle,usedWithItemId:i.arder});
  assert.equal(h.p.getInventory().getAmount(i.arder),3);
  // A click is received between cycles: the first task cycle is its response cycle.
  h.step(2);assert.equal(h.p.getInventory().getAmount(i.arder),3);
  h.step();assert.equal(h.p.getInventory().getAmount(i.arder),2);
  h.step(2);assert.equal(h.p.getInventory().getAmount(i.arder),2);
  h.step();assert.equal(h.p.getInventory().getAmount(i.arder),1);
  h.Site.leave(h.p);h.step(3);assert.equal(s.ended,true);
  assert.equal(h.p.getInventory().getAmount(i.arderPowder),0);
});

test('last Slayer assignment kill cannot award an off-task Duke speed achievement',t=>{
  const h=H.harness(t);h.enter();let onTask=true;
  h.api.onCustomEvent('slayer:on-task',e=>{e.onTask=onTask;});
  h.fight.wake();h.fight.fell();onTask=false;h.fight.won(h.p);
  assert.equal(h.emitted.some(([name,e])=>name==='combat-achievements:complete'&&e.task.startsWith('Duke Sucellus Speed-')),false);
});

function slayerState(h){
  const {PacketSender}=require('../dist/net/packet/PacketSender');
  const Data=require('../plugins/skills/slayer/Data.Slayer');
  const State=require('../plugins/skills/slayer/State.Slayer');
  const Tasks=require('../plugins/skills/slayer/Tasks.Slayer');
  h.p.getSession=()=>({sendClientPacket:()=>true,write(){}});
  const sender=new PacketSender(h.p);h.p.getPacketSender=()=>sender;
  for(const unit of [Data,State,Tasks])unit.init(h.api);
  Tasks.attach(h.api);
  const [bossId]=[...Data.get().bosses].find(([id])=>Data.isBossNpc(id,'Duke Sucellus'));
  return {assign(){State.update(h.p,{slayer_target_bossid:bossId,slayer_master:5},
    {slayer_target:Data.BOSS_TASK_ID,slayer_count:2,slayer_count_original:2});
    const request={player:h.p,npc:h.session.boss,onTask:false};h.api.emitCustomEvent('slayer:on-task',request);
    assert.equal(request.onTask,true,'the real Slayer assignment matches this owned Duke');
  },clear(){Tasks.clear(h.p);}};
}
const speedAwards=h=>h.emitted.filter(([name,event])=>name==='combat-achievements:complete'&&event.task.startsWith('Duke Sucellus Speed-'));

for(const assignedAt of ['wake','combat'])
test(`cancelling a real Slayer assignment after Duke ${assignedAt} cannot restore speed eligibility`,t=>{
  const h=H.harness(t),s=h.enter(),slayer=slayerState(h);
  if(assignedAt==='wake')slayer.assign();
  h.fight.wake();h.fight.nextAttack=Infinity;
  if(assignedAt==='combat'){slayer.assign();h.step();}
  slayer.clear();h.fight.fell();h.fight.won(h.p);
  assert.equal(speedAwards(h).length,0);
  // The restriction belongs to one awake encounter, not the whole instance.
  s.reset();h.fight.wake();h.fight.fell();h.fight.won(h.p);
  assert.equal(speedAwards(h).length,3);
});

test('a Slayer assignment cancelled during preparation does not taint the later off-task speed attempt',t=>{
  const h=H.harness(t);h.enter();const slayer=slayerState(h);
  slayer.assign();slayer.clear();h.fight.wake();h.fight.fell();h.fight.won(h.p);
  assert.equal(speedAwards(h).length,3);
});

test('Duke scoreboard opens its cache-native interface with persisted personal records',t=>{
  const h=H.harness(t),R=require('../plugins/bosses/dukesucellus/Records.DukeSucellus');
  h.api.onCustomEvent('quest:is-complete',event=>{event.complete=true;});
  R.resetWorld();R.attach(h.api);
  h.p.setAttribute(h.C.KILLS,12);h.p.setAttribute(h.C.BEST,73);h.p.setAttribute(R.DEATHS,3);
  assert.equal(R.read({player:h.p,objectId:1}),false);
  assert.equal(R.read({player:h.p,objectId:47563}),true);
  assert.ok(h.packets.some(x=>x[0]==='sendInterface'&&x[1]===828));
  const text=id=>h.packets.find(x=>x[0]==='sendString'&&x[2]===((828<<16)|id))?.[1];
  assert.equal(text(9),'12');assert.equal(text(11),'3 (recorded)');assert.equal(text(13),'0:43.8');
  assert.equal(text(15),'0 (recorded)');assert.equal(text(17),'0 (recorded)');
});

test('the native Duke scoreboard parent Read click opens normal records before null-name dispatch',t=>{
  const h=H.harness(t),R=require('../plugins/bosses/dukesucellus/Records.DukeSucellus');R.attach(h.api);
  h.api.onCustomEvent('quest:is-complete',event=>{event.complete=true;});
  const event={player:h.p,objectId:46091,clickType:1,handled:false};
  h.dispatch('onBeforeObjectInteraction',event);
  assert.equal(event.handled,true);
  assert.ok(h.packets.some(packet=>packet[0]==='sendInterface'&&packet[1]===828));
  assert.equal(R.read({player:h.p,objectId:47562}),false,'inactive transform has no Read action');
  assert.equal(R.read({player:h.p,objectId:47564}),false,'awakened records remain unavailable');
  const other={player:h.p,objectId:46091,clickType:2,handled:false};
  h.dispatch('onBeforeObjectInteraction',other);assert.equal(other.handled,false);
});

test('Duke scoreboard rejects forged parent and resolved Read clicks until the quest is complete',t=>{
  const h=H.harness(t),R=require('../plugins/bosses/dukesucellus/Records.DukeSucellus');R.attach(h.api);
  let complete=false;h.api.onCustomEvent('quest:is-complete',event=>{event.complete=complete;});
  h.p.setAttribute(h.C.KILLS,50);
  assert.equal(R.read({player:h.p,objectId:47563}),false);
  const event={player:h.p,objectId:46091,clickType:1,handled:false};
  h.dispatch('onBeforeObjectInteraction',event);
  assert.equal(event.handled,false);
  assert.equal(h.packets.some(packet=>packet[0]==='sendInterface'&&packet[1]===828),false);
  complete=true;h.dispatch('onBeforeObjectInteraction',event);
  assert.equal(event.handled,true);
  assert.equal(R.read({player:h.p,objectId:47563}),true);
});

test('Duke records count a lethal result and an in-instance player death once each',t=>{
  const h=H.harness(t),R=require('../plugins/bosses/dukesucellus/Records.DukeSucellus');
  R.resetWorld();R.attach(h.api);const s=h.enter();h.fight.wake();h.step(3);h.fight.fell();h.fight.won(h.p);h.fight.won(h.p);
  assert.equal(R.worldRecords().kills,1);assert.equal(R.worldRecords().best,3);
  s.reset();h.Site.beforePlayerDeath({player:h.p});h.Site.beforePlayerDeath({player:h.p});
  assert.equal(h.p.getAttribute(R.DEATHS),1);assert.equal(R.worldRecords().deaths,1);
  h.Site.leave(h.p);h.Site.beforePlayerDeath({player:h.p});assert.equal(R.worldRecords().deaths,1);
});

test('salt mining is cancelled by the same keyed action cancellation as other skills',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3033,6447]);
  h.api.onCustomEvent('mining:best-pickaxe',e=>{e.pickaxe={attemptIntervalTicks:3,animation:new h.core.Animation(625)};});
  assert.equal(h.Prep.mine(s,[3033,6448]),true);h.step(3);
  const held=h.p.getInventory().getAmount(i.salt);assert.ok(held>0);
  h.core.TaskManager.cancelTasks(h.p.getIndex());h.step(12);
  assert.equal(h.p.getInventory().getAmount(i.salt),held);
});

test('iron-pickaxe salt mining animates on response but first yields six ticks later, then every seven',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3034,6447]);
  h.p.getSkillManager().setCurrentLevel(h.core.Skill.MINING,99);
  const animations=[];h.p.performAnimation=animation=>animations.push(animation.getId());
  h.api.onCustomEvent('mining:best-pickaxe',e=>{e.pickaxe={attemptIntervalTicks:7,animation:new h.core.Animation(626)};});
  assert.equal(h.Prep.mine(s,[3033,6448]),true);
  h.step();assert.deepEqual(animations,[626]);assert.equal(h.p.getInventory().getAmount(i.salt),0);
  h.step(5);assert.equal(h.p.getInventory().getAmount(i.salt),0);
  h.step();assert.equal(h.p.getInventory().getAmount(i.salt),6);
  h.step(6);assert.equal(h.p.getInventory().getAmount(i.salt),6);
  h.step();assert.equal(h.p.getInventory().getAmount(i.salt),12);
  h.step(7);assert.equal(h.p.getInventory().getAmount(i.salt),18);
});

test('five uninterrupted minutes of salt mining stop with the tired-arms message and a new click restarts it',t=>{
  const h=H.harness(t),s=h.enter(),Hazards=require('../plugins/bosses/dukesucellus/Hazards.DukeSucellus');
  h.move([3034,6447]);
  t.mock.method(Hazards,'preparation',()=>{});
  h.api.onCustomEvent('mining:best-pickaxe',e=>{e.pickaxe={attemptIntervalTicks:3,animation:new h.core.Animation(624)};});
  h.Prep.mine(s,[3033,6448]);
  const tired=()=>h.messages.filter(message=>message==='Your arms get tired from all the mining.');
  h.step(499);assert.equal(tired().length,0);assert.ok(s.action);
  h.step();assert.equal(tired().length,1);assert.equal(s.action,null);
  const held=h.p.getInventory().getAmount(h.C.data.items.salt);
  h.step(10);assert.equal(h.p.getInventory().getAmount(h.C.data.items.salt),held);assert.equal(tired().length,1);
  h.Prep.mine(s,[3033,6448]);h.step(3);
  assert.ok(h.p.getInventory().getAmount(h.C.data.items.salt)>held);
});

// Recorded (rsprox): "You grind the mushroom into dust." is spam (356), not a game message.
test('grinding sends its line as spam',t=>{
  const h=H.harness(t);h.enter();const i=h.C.data.items;h.add(i.pestle);h.add(i.arder,1);
  h.Prep.grind({player:h.p,usedItemId:i.pestle,usedWithItemId:i.arder});
  const spam=h.packets.filter(([name,type])=>name==='sendTypedMessage'&&type===h.core.ChatType.SPAM).map(([, ,text])=>text);
  assert.ok(spam.includes('You grind the mushroom into dust.'),JSON.stringify(spam));
  assert.ok(!h.messages.includes('You grind the mushroom into dust.'),'not a game message');
});

test('a new grinding click cancels the previous mushroom batch',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.add(i.pestle);h.add(i.arder,4);h.add(i.musca,4);
  h.Prep.grind({player:h.p,usedItemId:i.pestle,usedWithItemId:i.arder});
  h.Prep.grind({player:h.p,usedItemId:i.pestle,usedWithItemId:i.musca});h.step(3);
  assert.equal(h.p.getInventory().getAmount(i.arder),3);assert.equal(h.p.getInventory().getAmount(i.musca),2);
});

test('normal melee sends native seven-tile effects and applies chip on its launch cycle',t=>{
  const h=H.harness(t);h.enter();h.move([3040,6451]);h.fight.wake();h.fight.nextAttack=h.session.tick+1;
  t.mock.method(Math,'random',()=>.5);h.step();
  assert.ok(h.p.getHitpoints()<99,'chip is already applied on the attack cycle');
  const effects=h.packets.filter(x=>x[0]==='sendGraphic'&&x[1].getId()>=2440&&x[1].getId()<=2443);
  assert.deepEqual(effects.map(x=>x[1].getId()),[2440,2441,2442,2443,2442,2441,2440]);
  assert.deepEqual(effects.map(x=>h.C.source(h.session,x[2])),Array.from({length:7},(_,n)=>[3036+n,6451]));
});

test('normal magic launches from the mouth with captured native flight and impacts four ticks later',t=>{
  const h=H.harness(t);h.enter();h.move([3039,6440]);h.fight.wake();h.fight.nextAttack=Infinity;
  t.mock.method(Math,'random',()=>.5);h.fight.auto();
  const p=h.packets.find(x=>x[0]==='sendProjectile');
  assert.deepEqual(h.C.source(h.session,p[1]),[3039,6453]);
  assert.deepEqual([p[4],p[5],p[6],p[7],p[9],p[10],p[11],p[12]],[120,2434,87.5,25,50,5,32,null]);
  h.step(3);assert.equal(h.p.getHitpoints(),99);h.step();assert.ok(h.p.getHitpoints()<99);
});

test('two normal gas spits are three ticks apart and finish before the next auto',t=>{
  const h=H.harness(t);h.enter();h.move([3035,6451]);h.fight.wake();h.session.boss.setHitpoints(200);
  h.fight.clock.next=()=> 'gas';h.fight.nextAttack=1;h.step();
  const spit=()=>h.packets.filter(x=>x[0]==='sendProjectile'&&x[5]===2436);
  assert.equal(spit().length,1);h.step(2);assert.equal(spit().length,1);
  h.step();assert.equal(spit().length,2);assert.equal(h.fight.nextAttack,8);
});

test('the dead body remains until the captured normal respawn boundary',t=>{
  const h=H.harness(t);const s=h.enter();h.fight.wake();h.fight.fell();s.boss.setHitpoints(0);
  const event={npc:s.boss,killer:h.p,remains:null};h.dispatch('onNpcDeath',event);
  assert.ok(event.remains?.ticks>0);assert.equal(h.fight.respawnAt,24);
  const old=h.fight;h.step(23);assert.equal(s.fight,old);h.step();assert.notEqual(s.fight,old);
});

test('poison feeding sends the captured green meter instead of changing sleeping hitpoints',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3039,6451]);h.add(i.poison);
  h.Prep.feed({player:h.p,npc:s.boss});
  assert.equal(s.boss.getHitpoints(),200);
  assert.deepEqual(s.boss.getDisplayedHealth(),{current:100,max:200,bar:{id:62,width:160}});
  assert.equal(s.boss.getTickHits().at(-1).getSplatType(true),65);
});

test('a fermenting vat has its native six-tick progress actor and removes it on readiness',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3034,6437]);
  for(const id of [i.arderPowder,i.muscaPowder,i.salt])h.add(id,6);
  h.Prep.fill(s,[3034,6438]);
  const timer=[...s.passive].find(n=>n.getId()===12197);
  assert.ok(timer);assert.deepEqual(timer.getHeadbars(),[{id:33,fill:0,endFill:50,duration:180,delay:0}]);
  h.step(6);assert.equal(s.passive.has(timer),false);
});

test('preparation eyes use independent staggered native cones, not the vent clock',t=>{
  const h=H.harness(t),s=h.enter();h.move([3039,6434]);h.step(2);
  const cones=()=>[...s.passive].filter(n=>[12199,12200,12201].includes(n.getId()));
  assert.deepEqual(cones().map(n=>[n.getId(),h.C.source(s,n.getLocation())]),[[12199,[3028,6444]],[12201,[3046,6444]]]);
  h.step(2);assert.ok(cones().some(n=>n.getId()===12200));
  h.step(6);assert.equal(cones().length,0);
  assert.equal([...s.passive].filter(n=>n.getId()===12198).length,0);
});

for(const [protectedMagic,roll,damage] of [[false,0,50],[false,.999999,70],[true,0,40],[true,.999999,55]])
test(`extremity gaze damage is ${damage} at the ${roll===0?'lower':'upper'} bound with magic protection ${protectedMagic}`,t=>{
  const h=H.harness(t),s=h.enter(),Hazards=require('../plugins/bosses/dukesucellus/Hazards.DukeSucellus');
  h.move([3031,6450]);
  t.mock.method(Math,'random',()=>roll);
  t.mock.method(h.C,'protectedFrom',(_player,prayer)=>protectedMagic&&prayer==='PROTECT_FROM_MAGIC');
  // Keep this a controlled gaze, without unrelated room ice or eye clocks.
  t.mock.method(Hazards,'preparation',()=>{});
  Hazards.eye(h.fight,2);
  h.step(5);
  assert.equal(h.p.getHitpoints(),99-damage);
  assert.equal(h.p.getSkillManager().getCurrentLevel(h.core.Skill.PRAYER),75);
});

test('preparation vents move east independently in each row every 25 ticks',t=>{
  const h=H.harness(t),s=h.enter();h.move([3039,6434]);h.step(15);
  const vents=()=>[...s.passive].filter(n=>n.getId()===12198);
  assert.deepEqual(vents().map(n=>h.C.source(s,n.getLocation())),[[3041,6441],[3038,6445],[3035,6449]]);
  assert.equal(vents()[0].getGraphic().getId(),2431);assert.equal(vents()[0].getGraphic().getDelay(),120);
  h.step(6);assert.equal(vents()[0].getGraphic().getId(),2432);
  h.step(5);assert.equal(vents()[0].getGraphic().getId(),2433);
  h.step(4);assert.equal(vents().length,0);
  h.step(10);assert.deepEqual(vents().map(n=>h.C.source(s,n.getLocation())),[[3035,6441],[3041,6445],[3038,6449]]);
  h.Site.leave(h.p);assert.equal(s.passive.size,0);
});

test('icefall uses the native shadow and impact four ticks apart with safe mushroom tiles',t=>{
  const h=H.harness(t),s=h.enter(),Hazards=require('../plugins/bosses/dukesucellus/Hazards.DukeSucellus');h.move([3031,6442]);
  t.mock.method(Math,'random',()=>.5);Hazards.ice(h.fight,[3031,6442]);
  assert.equal(h.packets.filter(x=>x[0]==='sendGraphic').at(-1)[1].getId(),1447);
  h.step(3);assert.equal(h.p.getHitpoints(),99);h.step();assert.ok(h.p.getHitpoints()<99);
  assert.ok(h.packets.some(x=>x[0]==='sendGraphic'&&x[1].getId()===538));
  h.move([3031,6453]);t.mock.method(Math,'random',()=>0);h.step(8);
  const warned=h.packets.filter(x=>x[0]==='sendGraphic'&&x[1].getId()===1447).map(x=>h.C.source(s,x[2]));
  assert.equal(warned.some(([x,y])=>y>=6451),false);
});

test('the documented wall-adjacent run-through tiles skip the extremities narrow cone tips',()=>{
  const M=require('../plugins/bosses/dukesucellus/Model.DukeSucellus'),d=require('../plugins/bosses/data/duke-sucellus.json');
  for(const x of [3030,3048])for(let y=6439;y<=6453;y+=2)
    assert.equal(d.extremities.some(eye=>M.extremityHit(eye,[x,y])),false,`${x},${y}`);
  assert.equal(M.extremityHit(d.extremities[2],[3032,6450]),true);
});

test('every extremity covers mirrored one-three-five tile cone rows from its cache footprint',()=>{
  const M=require('../plugins/bosses/dukesucellus/Model.DukeSucellus'),d=require('../plugins/bosses/data/duke-sucellus.json');
  for(const eye of d.extremities){
    const centreY=eye.tile[1]+1,west=eye.face===3;
    for(let depth=0;depth<=2;depth++){
      const x=west?3030+depth:3048-depth;
      const hits=[];
      for(let offset=-3;offset<=3;offset++){
        const hit=M.extremityHit(eye,[x,centreY+offset]);
        assert.equal(hit,Math.abs(offset)<=depth,`${eye.tile}, depth ${depth}, offset ${offset}`);
        if(hit)hits.push(offset);
      }
      assert.equal(hits.length,1+2*depth);
    }
    for(const x of west?[3029,3033]:[3045,3049])assert.equal(M.extremityHit(eye,[x,centreY]),false);
  }
});

for(const tile of [[3031,6451],[3047,6451]])
test(`an off-centre north extremity gaze reaches ${tile}`,t=>{
  const h=H.harness(t);h.enter();h.move(tile);
  const Hazards=require('../plugins/bosses/dukesucellus/Hazards.DukeSucellus');
  t.mock.method(Math,'random',()=>0);
  t.mock.method(Hazards,'preparation',()=>{});
  Hazards.eye(h.fight,2);h.step(5);
  assert.equal(h.p.getHitpoints(),49);
  assert.equal(h.p.getTimers().has(h.core.TimerKey.FREEZE),true);
});

test('icefall covers the four corridor entrance corner tiles recorded in ordinary preparation',t=>{
  const h=H.harness(t),s=h.enter();h.move([3039,6434]);
  t.mock.method(Math,'random',()=>0);h.step(4);
  const warned=h.packets.filter(x=>x[0]==='sendGraphic'&&x[1].getId()===1447).map(x=>h.C.source(s,x[2]));
  for(const tile of [[3033,6435],[3033,6436],[3045,6435],[3045,6436]])
    assert.ok(warned.some(at=>at[0]===tile[0]&&at[1]===tile[1]),`missing warning at ${tile}`);
  assert.equal(warned.some(([x,y])=>y===6438||y>=6451||([3033,3045].includes(x)&&y>=6437)),false);
});

test('combat gas spawns a delayed native vent, persists beyond four ticks and cleans up on exit',t=>{
  const h=H.harness(t),s=h.enter();h.move([3035,6451]);h.fight.wake();h.fight.nextAttack=Infinity;
  t.mock.method(Math,'random',()=>.5);h.fight.ignite([3042,6450]);h.step(2);
  const vent=[...s.passive].find(n=>n.getId()===12198);assert.ok(vent);assert.equal(vent.getGraphic().getDelay(),30);
  h.step(4);assert.equal(vent.getGraphic().getId(),2432);assert.equal(s.passive.has(vent),true);
  h.Site.leave(h.p);assert.equal(s.passive.size,0);h.step(20);assert.equal(s.ended,true);
});

test('the filled poison bar wakes Duke on the following cycle without consuming another dose',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3039,6451]);h.add(i.poison,3);
  h.Prep.feed({player:h.p,npc:s.boss});h.Prep.feed({player:h.p,npc:s.boss});h.Prep.feed({player:h.p,npc:s.boss});
  assert.equal(s.meter,200);assert.equal(s.fight.active,false);assert.equal(h.p.getInventory().getAmount(i.poison),1);
  h.step();assert.equal(s.fight.active,true);assert.equal(s.boss.getHitpoints(),485);
});

test('awake room resources become inactive and stale preparation clicks cannot collect items',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.fight.wake();h.move([3031,6453]);
  const event={player:h.p,objectId:47528,location:s.tile([3030,6453]),handled:false};h.interact(event);
  assert.equal(event.handled,true);assert.equal(h.p.getInventory().getAmount(i.arder),0);
});

test('gaze mounts its native overlay and removes it when the warning resolves or the player leaves',t=>{
  const h=H.harness(t);h.enter();h.move([3035,6451]);h.fight.wake();h.fight.nextAttack=Infinity;h.fight.gaze();
  assert.equal(h.p.getPacketSender().isSubInterfaceOpen(829),true);
  h.step(5);assert.equal(h.p.getPacketSender().isSubInterfaceOpen(829),false);
  h.fight.gaze();h.Site.leave(h.p);assert.equal(h.p.getPacketSender().isSubInterfaceOpen(829),false);
});

test('gaze cleanup does not close an atmosphere overlay subsequently owned by a teleport',t=>{
  const h=H.harness(t);h.enter();h.fight.wake();h.fight.nextAttack=Infinity;h.fight.gaze();
  h.p.getPacketSender().sendSubInterface((161<<16)|1,174,1);h.fight.stop();
  assert.equal(h.p.getPacketSender().isSubInterfaceOpen(174),true);
});

test('vats accept partial ingredients, including one-for-one hand-crushed mushrooms',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3034,6437]);h.add(i.muscaPowder,6);h.add(i.salt,6);h.add(i.arder,3);
  h.Prep.fill(s,[3034,6438]);const vat=s.vats.get('3034,6438');
  assert.deepEqual(vat.amounts,{[i.muscaPowder]:6,[i.arderPowder]:3,[i.salt]:6});
  assert.equal(vat.readyAt,null);h.step(7);assert.equal(vat.ready,false);
  h.add(i.arderPowder,3);h.Prep.fill(s,[3034,6438]);h.step(6);assert.equal(vat.ready,true);
  h.Prep.collect(s,[3034,6438]);assert.equal(h.p.getInventory().getAmount(i.poison),1);
});

test('emptying a partially filled vat refunds exactly its ingredients once',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3034,6437]);h.add(i.muscaPowder,3);h.add(i.salt,4);
  h.Prep.fill(s,[3034,6438]);h.Prep.empty(s,[3034,6438]);h.Prep.empty(s,[3034,6438]);
  assert.equal(h.p.getInventory().getAmount(i.muscaPowder),3);assert.equal(h.p.getInventory().getAmount(i.salt),4);assert.equal(s.vats.size,0);
});

test('a full inventory cannot lose or partially duplicate a vat refund',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3034,6437]);h.add(i.muscaPowder,3);h.add(i.salt,4);
  h.Prep.fill(s,[3034,6438]);for(let n=0;n<27;n++)h.add(526);
  h.Prep.empty(s,[3034,6438]);assert.equal(s.vats.size,1);assert.equal(h.p.getInventory().getAmount(i.muscaPowder),0);
  h.p.getInventory().deleteNumber(526,1);h.Prep.empty(s,[3034,6438]);assert.equal(s.vats.size,0);
  assert.equal(h.p.getInventory().getAmount(i.muscaPowder),3);assert.equal(h.p.getInventory().getAmount(i.salt),4);
});

test('picking mushrooms continues every three ticks and respects the eight-pick cap',t=>{
  const h=H.harness(t),s=h.enter(),i=h.C.data.items;h.move([3031,6453]);t.mock.method(Math,'random',()=>.5);
  h.Prep.pick(s,'arder');assert.equal(h.p.getInventory().getAmount(i.arder),1);
  h.step(3);assert.equal(h.p.getInventory().getAmount(i.arder),2);
  h.step(24);assert.equal(h.p.getInventory().getAmount(i.arder),8);
  h.core.TaskManager.cancelTasks(h.p.getIndex());h.step(3);assert.equal(h.p.getInventory().getAmount(i.arder),8);
});

test('Duke auxiliary actors keep scripted HP until their owner session removes them',t=>{
  const h=H.harness(t),s=h.enter();
  h.step(40);
  const actors=[h.C.data.npcs.vatTimer,h.C.data.npcs.vent,...h.C.data.npcs.cones]
    .map(id=>s.spawnPassive(id,[3039,6442]));
  for(const npc of actors){
    assert.ok(npc);
    assert.equal(npc.hasFlag('combat:no-regen'),true);
    npc.setMaxHitpoints(10);npc.setHitpoints(1);
    npc.getCombat().getLastAttack().reset(1);
    npc.process();
    assert.equal(npc.getHitpoints(),1);
  }
  s.end();
  for(const npc of actors){
    assert.equal(npc.__removed,true);
    assert.equal(npc.hasFlag('combat:no-regen'),true,'the policy lasts through removal');
  }
  assert.equal(s.passive.size,0);
});
