// Run after `yarn build`: node --test tests/brimhaven-rope-swing-route.test.cjs
// A rope swing click through the real packet, routing and walk-to path, on cache clipping.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const core = PluginManager.getCoreApi();

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.RegionManager.init();
});

/** A player clicking a loc through the real packet listener, run until `cycles` have passed. */
function click(at, objectId, loc, option, cycles = 30) {
  for (const key of ["objectInteractionHooks", "objectRouteHooks"]) PluginManager[key] = [];
  for (const key of ["objectHooksByName", "objectHooksById", "customEventHooks"]) PluginManager[key] = new Map();
  const api = PluginManager.createApi("brimhaven-rope-swing-route");
  require("../plugins/minigames/brimhavenagilityarena/Shared.BrimhavenAgilityArena").init(api);
  require("../plugins/minigames/brimhavenagilityarena/Obstacles.BrimhavenAgilityArena")(api);

  const player = new Player(null);
  player.setUsername("offline1447");
  player.setIndex(1447);
  player.isRegistered = () => true;
  let sender;
  sender = new Proxy({}, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 99, false);
  core.RegionManager.loadMapFiles(loc[0], loc[1], false);
  player.setLocation(new core.Location(at[0], at[1], 3));
  player.setNeedsPlacement(false);

  const seen = [];
  new ObjectActionPacketListener().executeAction(player, objectId, loc[0], loc[1], 1, option);
  for (let n = 0; n < cycles; n++) {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process(); player.getMovementQueue().beginCycle();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    const tile = player.getLocation();
    seen.push(`${tile.getX()},${tile.getY()}`);
  }
  const end = player.getLocation();
  return { seen, end: [end.getX(), end.getY(), end.getZ()] };
}

test("a rope swing clicked from the platform corner walks to the rope's axis and swings", () => {
  const { seen, end } = click([2804, 9587], 3566, [2806, 9585], "Swing-on");
  assert.ok(seen.includes("2806,9587"), `walks to two tiles before the rope: ${seen.join(" ")}`);
  assert.deepEqual(end, [2806, 9582, 3], "lands three tiles past the rope");
});

test("monkey bars are walked to from the platform beside their blocked first bar, then crossed (rsprox 1735)", () => {
  // Each set's end pieces (3564), a start on each side's platform, and where the swing lands.
  const BARS = [
    { ends: [[2771, 9570], [2771, 9577]], sides: [[[2772, 9569], [2772, 9578]], [[2773, 9579], [2772, 9569]]] },
    { ends: [[2774, 9545], [2781, 9545]], sides: [[[2772, 9547], [2782, 9546]], [[2783, 9547], [2773, 9546]]] },
    { ends: [[2793, 9559], [2793, 9566]], sides: [[[2795, 9557], [2794, 9567]], [[2795, 9568], [2794, 9558]]] },
  ];
  for (const { ends, sides } of BARS) {
    for (const loc of ends) {
      for (const [from, landing] of sides) {
        const { seen, end } = click(from, 3564, loc, "Swing-across", 40);
        assert.deepEqual(end, [...landing, 3], `bars at ${loc} from ${from}: ${[...new Set(seen)].join(" ")}`);
      }
    }
  }
});

test('native blade hazards use the shared clock, real clipping, movement and session updates', async t => {
  const Arena = require('../plugins/minigames/BrimhavenAgilityArena.plugin');
  const Shared = require('../plugins/minigames/brimhavenagilityarena/Shared.BrimhavenAgilityArena');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { MapObjects, ObjectManager } = core;
  const resetAnimation = core.Animation.DEFAULT_RESET_ANIMATION.getId();
  Shared.sessions.clear(); Shared.cycle.tick = 0;
  Arena.register(PluginManager.createApi('native-brimhaven-blades'));
  // Production also finishes pending obstacles from Agility's later logout hook.
  require('../plugins/skills/Agility.plugin').register(PluginManager.createApi('native-agility'));
  PluginManager.emitServerStartup({});
  t.after(() => { PluginManager.emitServerShutdown({}); Shared.sessions.clear(); });
  const turn = () => {
    core.World.process();
    core.World.forEachNetworkPlayer(p => p.getSession().flushPackets());
  };
  const phase = n => { while (Shared.cycle.tick % 7 !== n) turn(); };
  const at = (x,y,z=3) => new core.Location(x,y,z);
  const position = p => [p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()];
  const blade = (x,y,id) => MapObjects.get(id,at(x,y),null);
  let index = 1800;
  function actor(test,x,y,z=3,hp=38) {
    const frames=[], events=[];
    const channel={kind:'test',isOpen:()=>true,send:b=>{frames.push(Buffer.from(b));return true;},close(){},onData(){},onClose(){},onError(){}};
    const session=new PlayerSession(channel), p=new Player(session); session.setPlayer(p);
    p.setUsername('native-blade-'+index++); p.setLocation(at(x,y,z)); p.setNeedsPlacement(false); p.setRunning(false);
    p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS,hp,false).setCurrentLevel(core.Skill.HITPOINTS,hp,false);
    p.getSkillManager().setMaxLevels(core.Skill.AGILITY,99,false).setCurrentLevel(core.Skill.AGILITY,99,false);
    // Preserve real World registration and area processing; skip only account-file I/O.
    test.mock.method(p,'onAdd',()=>{}); test.mock.method(p,'onRemove',()=>{});
    const perform=p.performAnimation.bind(p);
    test.mock.method(p,'performAnimation',animation=>{events.push([Shared.cycle.tick,'performAnimation',animation]);return perform(animation);});
    const sender=p.getPacketSender();
    for(const name of ['sendObject','sendObjectRemoval','sendObjectAnimation','sendTypedMessage','sendSoundEffect']) {
      const original=sender[name].bind(sender);
      test.mock.method(sender,name,(...args)=>{events.push([Shared.cycle.tick,name,...args]);return original(...args);});
    }
    assert.equal(core.World.getPlayers().add(p),true); core.World.refreshActiveRegions(); AreaManager.process(p);
    test.after(()=>{
      PluginManager.emitPlayerLogout({player:p,username:p.getUsername()}); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
      core.World.getPlayers().remove(p); core.World.refreshActiveRegions();
    });
    return {p,session,frames,events,xp:p.getSkillManager().getExperience(core.Skill.AGILITY)};
  }

  await t.test('walking onto a saw tile produces three static/four animated ticks, next-tick damage and zero XP',test=>{
    const f=actor(test,2787,9579);
    f.p.getMovementQueue().requestWalk(at(2788,9579)); turn(); turn();
    assert.deepEqual(position(f.p),[2788,9579,3]); assert.ok(blade(2788,9579,3568));
    assert.equal(core.RegionManager.getClipping(2788,9579,3)&0x100,0);
    turn();
    assert.ok(blade(2788,9579,3567),'animated native scenery replaces both ground decorations');
    assert.equal(blade(2788,9579,3568),null); assert.equal(blade(2789,9579,3569),null);
    for(const x of [2788,2789]) assert.ok(core.RegionManager.getClipping(x,9579,3)&0x100);
    assert.equal(f.p.getHitpoints(),38,'hit lands next tick');
    assert.ok(f.events.some(([tick,name,type,text])=>tick===3&&name==='sendTypedMessage'&&text==='You were hit by the saw blade!'));
    assert.ok(f.p.getForceMovement()); assert.ok(f.events.some(([tick,name,animation])=>tick===3&&name==='performAnimation'&&animation.getId()===846));
    turn();
    assert.deepEqual(position(f.p),[2787,9579,3]); assert.equal(f.p.getHitpoints(),35);
    assert.equal(f.events.filter(([tick,name,animation])=>tick===4&&name==='performAnimation'&&animation.getId()===resetAnimation).length,0,
      'the delayed846 pose survives successful movement release without a second animation or an extra stall');
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.AGILITY),f.xp);
    turn();turn(); assert.ok(blade(2788,9579,3567),'four animated ticks'); turn();
    assert.ok(blade(2788,9579,3568)); assert.ok(blade(2789,9579,3569)); assert.equal(blade(2788,9579,3567),null);
    assert.equal(core.RegionManager.getClipping(2788,9579,3)&0x100,0); assert.ok(f.frames.length);
  });

  await t.test('all six halves push outward on both axes, with no Agility requirement',async test=>{
    const cases=[[2761,9584,2761,9583],[2761,9585,2761,9586],[2783,9551,2783,9550],[2783,9552,2783,9553],[2788,9579,2787,9579],[2789,9579,2790,9579]];
    for(const [x,y,dx,dy] of cases) await test.test(`${x},${y}`,sub=>{
      phase(0); const f=actor(sub,dx,dy,3,99); f.p.getSkillManager().setCurrentLevel(core.Skill.AGILITY,1,false);
      f.p.getMovementQueue().requestWalk(at(x,y)); turn();turn();turn();turn();
      assert.deepEqual(position(f.p),[dx,dy,3]); assert.equal(f.p.getHitpoints(),93);
      assert.equal(f.p.getSkillManager().getExperience(core.Skill.AGILITY),f.xp);
    });
  });

  await t.test('early occupancy is not latched; a different plane, teleport or logout cannot be hit remotely',test=>{
    phase(0); const f=actor(test,2787,9579), other=actor(test,2788,9579,0);
    const leaving=actor(test,2789,9579), loggingOut=actor(test,2761,9584);
    f.p.getMovementQueue().requestWalk(at(2788,9579)); turn();
    f.p.getMovementQueue().requestWalk(at(2787,9579)); leaving.p.moveTo(at(2808,3193,0));
    PluginManager.emitPlayerLogout({player:loggingOut.p,username:loggingOut.p.getUsername()}); turn();turn();turn();
    assert.deepEqual(position(f.p),[2787,9579,3]);
    for(const a of [f,other,leaving,loggingOut]) assert.equal(a.p.getHitpoints(),38);
  });

  await t.test('cancelling a pending saw knockback clears its pose/lock and cannot damage after leaving',test=>{
    phase(0); const f=actor(test,2788,9579); turn();turn();turn();
    assert.ok(f.p.getForceMovement());
    core.TaskManager.cancelTasks(f.p); f.p.moveTo(at(2808,3193,0));
    assert.equal(f.p.getForceMovement(),null);
    assert.ok(f.events.some(([tick,name,animation])=>tick===Shared.cycle.tick&&name==='performAnimation'&&animation.getId()===resetAnimation));
    turn(); assert.deepEqual(position(f.p),[2808,3193,0]); assert.equal(f.p.getHitpoints(),38);
    assert.equal(f.p.getAttribute('agility.obstacle'),null);
  });

  await t.test('simultaneous occupants have separate hits; cycle audio reaches five tiles but not six',test=>{
    phase(0);
    const first=actor(test,2788,9579), second=actor(test,2789,9579,3,99);
    const nearby=actor(test,2788,9584), distant=actor(test,2788,9585);
    turn();turn();turn();
    const onset=Shared.cycle.tick;
    for(const f of [first,second,nearby]) assert.equal(f.events.filter(([tick,name,id])=>tick===onset&&name==='sendSoundEffect'&&id===1386).length,1);
    assert.equal(distant.events.filter(([,name,id])=>name==='sendSoundEffect'&&id===1386).length,0);
    turn();
    assert.deepEqual(position(first.p),[2787,9579,3]); assert.deepEqual(position(second.p),[2790,9579,3]);
    assert.equal(first.p.getHitpoints(),35); assert.equal(second.p.getHitpoints(),93);
    assert.equal(nearby.p.getHitpoints(),38); assert.equal(distant.p.getHitpoints(),38);
  });

  await t.test('a removed player cannot finish a pending knockback or receive its queued damage',test=>{
    phase(0); const f=actor(test,2788,9579); turn();turn();turn();
    PluginManager.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    core.World.getPlayers().remove(f.p); core.World.refreshActiveRegions(); turn();
    assert.equal(f.p.getHitpoints(),38); assert.deepEqual(position(f.p),[Shared.HUT.x,Shared.HUT.y,Shared.HUT.z]);
    assert.equal(f.p.getAttribute('agility.obstacle'),null); assert.equal(f.p.getForceMovement(),null);
  });

  await t.test('a late entrant sees the active scenery and its clipping blocks ordinary walking until restoration',test=>{
    phase(3); const f=actor(test,2787,9579); ObjectManager.onRegionChange(f.p,2752,9536);
    assert.ok(f.events.some(([,name,obj])=>name==='sendObject'&&obj.getId()===3567));
    assert.ok(f.events.some(([,name,obj])=>name==='sendObjectRemoval'&&obj.getId()===3568&&obj.getType()===22));
    f.p.getMovementQueue().requestWalk(at(2788,9579)); turn();turn();turn();
    assert.deepEqual(position(f.p),[2787,9579,3]); turn();
    f.p.getMovementQueue().requestWalk(at(2788,9579)); turn();
    assert.deepEqual(position(f.p),[2788,9579,3]); assert.equal(f.p.getHitpoints(),38);
  });

  await t.test('spinning blades animate once for the jumper and an observer, one tick after the jump starts',test=>{
    phase(0); const f=actor(test,2783,9572), observer=actor(test,2785,9573); Shared.setRandom(()=>0);
    f.p.getMovementQueue().requestWalk(at(2783,9573)); turn();turn(); const started=Shared.cycle.tick;
    assert.ok(f.events.some(([tick,name,animation])=>tick===started&&name==='performAnimation'&&animation.getId()===1115)); assert.equal(f.events.filter(([,name])=>name==='sendObjectAnimation').length,0);
    turn();
    for(const a of [f,observer]) {
      const animations=a.events.filter(([,name])=>name==='sendObjectAnimation'); assert.equal(animations.length,1);
      const [tick,,object,animation]=animations[0]; assert.equal(tick,started+1); assert.equal(object.getId(),3580); assert.equal(animation.getId(),1107);
      assert.deepEqual([object.getLocation().getX(),object.getLocation().getY(),object.getFace()],[2782,9573,2]);
    }
    for(let i=0;i<8;i++) turn();
    assert.deepEqual(position(f.p),[2783,9576,3]); assert.equal(f.events.filter(([,name])=>name==='sendObjectAnimation').length,1);
    assert.ok(f.p.getSkillManager().getExperience(core.Skill.AGILITY)>f.xp);
    assert.equal(f.events.filter(([,name])=>name==='performAnimation').at(-1)[2].getId(),resetAnimation,
      'the existing default runner completion still resets other obstacle animations');
  });

  await t.test('shutdown restores all cache decorations/clipping and stops the shared clock',()=>{
    phase(3); PluginManager.emitServerShutdown({});
    for(const [x,y,dx,dy] of [[2761,9584,0,1],[2783,9551,0,1],[2788,9579,1,0]]) {
      assert.ok(blade(x,y,3568)); assert.ok(blade(x+dx,y+dy,3569)); assert.equal(blade(x,y,3567),null);
      assert.equal(core.RegionManager.getClipping(x,y,3)&0x100,0);
    }
    assert.equal(core.World.getRemovedObjects().filter(object=>[3568,3569].includes(object.getId())).length,0);
    assert.equal(core.World.getObjects().filter(object=>object.getId()===3567).length,0);
    const stopped=Shared.cycle.tick; turn(); assert.equal(Shared.cycle.tick,stopped);
  });
});
