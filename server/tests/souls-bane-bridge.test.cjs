// Run after `yarn build`: node --test tests/souls-bane-bridge.test.cjs
// Cache 241, ordinary object packet and movement; no retail client ran.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const QuestRuntime = require('../plugins/quests/QuestRuntime');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
let core, quest, nextIndex = 6100;
const hookErrors=[]; const originalWarn=console.warn, originalError=console.error;
before(async () => {
  console.warn=(...args)=>{ if (String(args[0]).includes('[plugins]') && /failed|threw/i.test(String(args[0]))) hookErrors.push(args.map(String).join(' ')); originalWarn(...args); };
  console.error=(...args)=>{ hookErrors.push(args.map(String).join(' ')); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  // Scope to the real quest and transcript handlers; omit unrelated plugin lifecycle hooks.
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  require('../plugins/quests/quests/SoulsBane.Quest')(PM.createApi('Quests'));
  core.RegionManager.loadMapFiles(3020, 5200);
  quest = QuestRuntime.getRegisteredQuests().find(q => q.key === 'a_souls_bane');
  assert.ok(quest);
  assert.equal(core.CacheDefinitions.getObject(13933).actions[0], 'Use');
  assert.ok(MapObjects.get(13933, new core.Location(3020, 5188, 0), null), 'cache places the bridge exit');
});
after(() => {
  PM.emitServerShutdown({}); console.warn=originalWarn; console.error=originalError;
  assert.deepEqual(hookErrors, [], 'no hidden plugin hook or engine errors');
});
function actor(t, stage) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername('soulsbridge' + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(3020, 5200, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  quest.setStage(p, stage);
  p.getPacketSender().sendVarbit(2020, stage >= 9 ? 1 : 0);
  t.after(() => {
    PM.emitPlayerLogout({player:p,username:p.getUsername()});
    core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p);
    const world=[...core.World.getNpcs()].filter(n=>n?.getOwner?.()===p);
    const queued=core.World.getAddNPCQueue().filter(n=>n?.getOwner?.()===p);
    const tasks={index:core.TaskManager.hasActiveTask(p.getIndex()),player:core.TaskManager.hasActiveTask(p)};
    t.diagnostic(JSON.stringify({cleanup:{worldOwned:world.length,queuedOwned:queued.length,tasks}}));
    p.setRegistered(false);
    assert.equal(world.length,0,'owned NPCs removed on logout'); assert.equal(queued.length,0,'queued owned NPCs removed on logout');
    assert.equal(tasks.index,false,'index tasks stopped'); assert.equal(tasks.player,false,'player tasks stopped');
  });
  return {p,c};
}
async function clickExit(f, onTick) {
  const record = phase => { const pos=f.p.getLocation(); onTick({phase,x:pos.getX(),y:pos.getY(),z:pos.getZ(),stage:quest.getStage(f.p),busy:f.p.busy(),placement:f.p.isNeedsPlacement()}); };
  const emit=PM.emitObjectInteraction;
  PM.emitObjectInteraction=function(event,...rest) {
    if(event.player===f.p) { const pos=f.p.getLocation(); onTick({phase:'object-event',id:event.objectId,option:event.option,x:pos.getX(),y:pos.getY(),z:pos.getZ(),stage:quest.getStage(f.p),busy:f.p.busy(),placement:f.p.isNeedsPlacement()}); }
    return emit.call(PM,event,...rest);
  };
  try {
    record('before-exit-packet');
    await f.c.dispatch([{type:'object_option',id:13933,x:3020,y:5188,clickType:1}]);
    f.c.processTurnPackets(); record('after-exit-packet');
    for(let i=0;i<40;i++) {
      core.TaskManager.process(); f.p.getMovementQueue().beginCycle(); f.p.getMovementQueue().process();
      record('after-movement'); core.TaskManager.processWalkTo(f.p.getIndex()); record('after-interaction');
      PM.updatePlayerZones(f.p); record('after-zone'); f.p.resetUpdating(); record('after-reset');
    }
  } finally { PM.emitObjectInteraction=emit; }
}
async function talkToHuman(f, spawns) {
  async function continueDialogue() {
    for (let i = 0; i < 40 && f.p.getDialogueManager().isActive(); i++) {
      const group = f.p.getPacketSender().getChatboxGroupId();
      await f.c.dispatch([{type:'dialogue_continue', widgetId:(group << 16) | 5, childIndex:-1}]);
      f.c.processTurnPackets(); core.TaskManager.process();
    }
  }
  await continueDialogue();
  const human = spawns.find(s => s.definition.owner === f.p && s.definition.id === 1058)?.npc;
  assert.ok(human && human.getIndex() >= 0, 'human Tolna is registered for ordinary interaction');
  const actions = human.getCurrentDefinition(f.p).getActions();
  const clickType = actions.findIndex(action => action?.toLowerCase() === 'talk-to') + 1;
  assert.ok(clickType);
  await f.c.dispatch([{type:'npc_option', index:human.getIndex(), clickType}]); f.c.processTurnPackets();
  for (let i = 0; i < 20; i++) {
    core.TaskManager.process(); f.p.getMovementQueue().beginCycle(); f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex()); PM.updatePlayerZones(f.p); f.p.resetUpdating();
  }
  assert.ok(f.p.getDialogueManager().isActive(), 'ordinary Talk-to opens human Tolna dialogue');
  await continueDialogue();
  assert.equal(quest.getStage(f.p), 12, 'human Tolna dialogue returns the player to the surface');
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3310, 3455]);
}

test('the bridge exit is used after crossing before the Tolna encounter starts', async t => {
  const f = actor(t, 9); const events = [], spawns = [], ticks = [];
  const emit = PM.emitObjectInteraction, spawn = PM.spawnNpc;
  t.mock.method(PM, 'emitObjectInteraction', (event, ...rest) => {
    const pos = f.p.getLocation();
    events.push({id: event.objectId, option: event.option, clickType: event.clickType, stage: quest.getStage(f.p), x: pos.getX(), y: pos.getY(), z: pos.getZ(), sourceLocation: {...event.sourceLocation}, location: {...event.location}});
    return emit.call(PM, event, ...rest);
  });
  t.mock.method(PM, 'spawnNpc', (definition, ...rest) => {
    const npc = spawn.call(PM, definition, ...rest); spawns.push({definition, npc}); return npc;
  });
  let premature = false;
  await clickExit(f, tick => { ticks.push(tick); if (tick.stage === 10 && !events.some(e => e.id === 13933)) premature = true; });
  t.diagnostic(JSON.stringify({ticks, events}));
  assert.ok(ticks.some(tick => tick.phase === 'after-movement' && tick.x >= 3013 && tick.x <= 3039 && tick.y >= 5185 && tick.y <= 5190 && tick.stage === 9), 'movement reached the final-zone bounds while still at stage 9');
  assert.equal(premature, false, 'crossing alone must not start the encounter');
  assert.ok(events.some(e => e.id === 13933 && e.stage === 9 && e.option === 'use' && e.clickType === 1 && e.location.x === 3020 && e.location.y === 5188 && e.sourceLocation.x === e.x && e.sourceLocation.y === e.y), 'the mapped exit receives Use at stage 9 from the reached tile');
  assert.equal(quest.getStage(f.p), 10);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3086, 5302]);
  const heads = spawns.filter(s => s.definition.owner === f.p && [1075,1076,1077].includes(s.definition.id));
  assert.equal(heads.length, 3, 'existing fallback encounter supplies three heads');
  for (const {npc} of heads) { PM.emitNpcDeath({npc, killer: f.p}); PM.removeNpc(npc); }
  assert.equal(quest.getStage(f.p), 11, 'direct death hooks reach the server human-Tolna state; combat is not tested');
  await talkToHuman(f, spawns);
});
test('the existing incomplete-bridge guard does not start the final encounter', async t => {
  const f = actor(t, 8); const events = []; const emit = PM.emitObjectInteraction;
  t.mock.method(PM, 'emitObjectInteraction', (event, ...rest) => { events.push(event.objectId); return emit.call(PM, event, ...rest); });
  await clickExit(f, () => {});
  assert.ok(!events.includes(13933), 'the existing guard prevents reaching the final exit');
  assert.equal(quest.getStage(f.p), 8);
  assert.ok(f.p.getLocation().getX() >= 3000 && f.p.getLocation().getX() <= 3140 && f.p.getLocation().getY() >= 5170, 'guard did not escape to surface');
});

test('the other exit retains its existing server behavior at stage 9', async t => {
  const f = actor(t, 9);
  await f.c.dispatch([{type: 'object_option', id: 13932, x: 3021, y: 5211, clickType: 1}]);
  f.c.processTurnPackets();
  for (let i = 0; i < 40; i++) {
    core.TaskManager.process(); f.p.getMovementQueue().beginCycle(); f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex()); PM.updatePlayerZones(f.p); f.p.resetUpdating();
  }
  assert.equal(quest.getStage(f.p), 9);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3310, 3455]);
});

async function descendRift(f, t) {
  core.RegionManager.loadMapFiles(3310, 3455);
  const rift = [...MapObjects.mapObjects.values()].flat().find(object => {
    const p = object.getLocation();
    return object.getId() === 13968 && p.getX() >= 3300 && p.getX() <= 3320 && p.getY() >= 3445 && p.getY() <= 3465 && p.getZ() === 0;
  });
  assert.ok(rift, 'cache places the rift near the surface return');
  const def = core.ObjectDefinition.forPlayer(rift.getId(), f.p);
  assert.equal(f.p.getPacketSender().getVarbit(2032), 1, 'attached rope varbit is active');
  assert.equal(def.id, 13970, 'rift resolves to the rope-attached cache child');
  const clickType = def.getInteractions().findIndex(option => option?.toLowerCase() === 'enter') + 1;
  assert.equal(clickType, 1, 'rope-attached rift offers Enter');
  const p = rift.getLocation();
  assert.ok(MapObjects.getPrivateArea(f.p, rift.getId(), p.clone()), 'resolved parent loc exists for this player');
  const observed=[]; const emit=PM.emitObjectInteraction;
  t.mock.method(PM, 'emitObjectInteraction', (event,...rest) => {
    const loc=event.sourceLocation; observed.push({id:event.objectId, option:event.option, resolved:event.definition?.id, x:loc?.x, y:loc?.y});
    return emit.call(PM,event,...rest);
  });
  const trace=[]; const snap=phase=>{const pos=f.p.getLocation();trace.push({phase,x:pos.getX(),y:pos.getY(),z:pos.getZ(),stage:quest.getStage(f.p),busy:f.p.busy(),placement:f.p.isNeedsPlacement()});};
  snap('before-rift-packet');
  await f.c.dispatch([{type:'object_option', id:rift.getId(), x:p.getX(), y:p.getY(), clickType}]);
  f.c.processTurnPackets(); snap('after-rift-packet');
  for (let i = 0; i < 40; i++) {
    core.TaskManager.process(); f.p.getMovementQueue().beginCycle(); f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex()); PM.updatePlayerZones(f.p); snap('before-reset'); f.p.resetUpdating(); snap('after-reset');
  }
  t.diagnostic(JSON.stringify({riftTrace:trace,riftEvents:observed}));
  assert.ok(observed.some(e => e.id===13968 && e.resolved===13970 && e.option==='enter'), 'real packet reaches resolved rope rift Enter handler');
}

test('login preserves the completed bridge after interruption of the server final room', async t => {
  const f = actor(t, 10);
  f.p.setAttribute('souls-bane:rope-attached', 1);
  f.p.setLocation(new core.Location(3086, 5302, 0));
  PM.emitPlayerLogout({player: f.p, username: f.p.getUsername()});
  PM.emitPlayerLogin({player: f.p, username: f.p.getUsername()});
  assert.equal(quest.getStage(f.p), 9);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3310, 3455]);
  t.diagnostic(JSON.stringify({phase:'login-before-reset',busy:f.p.busy(),placement:f.p.isNeedsPlacement()}));
  f.p.resetUpdating(); // Simulated end-of-tick after omitted world/client sync.
  t.diagnostic(JSON.stringify({phase:'login-after-reset',busy:f.p.busy(),placement:f.p.isNeedsPlacement()}));
  await descendRift(f, t);
  assert.equal(quest.getStage(f.p), 9);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3020, 5200]);
  const recoveryTrace=[]; await clickExit(f, tick => recoveryTrace.push(tick));
  t.diagnostic(JSON.stringify({recoveryTrace}));
  assert.equal(quest.getStage(f.p), 10, 'the restored bridge leads to the final encounter again');
});

test('the existing death hook resets an unfinished final encounter', async t => {
  const f = actor(t, 10);
  f.p.setLocation(new core.Location(3086, 5302, 0));
  PM.emitPlayerDeath({player:f.p, handled:false});
  assert.equal(quest.getStage(f.p), 9);
  // The death hook does not perform the engine respawn; provide its surface placement.
  f.p.setLocation(new core.Location(3310,3455,0));
  f.p.setAttribute('souls-bane:rope-attached', 1);
  f.p.getPacketSender().sendVarbit(2032, 1);
  await descendRift(f, t);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3020,5200]);
  const recoveryTrace=[]; await clickExit(f, tick => recoveryTrace.push(tick));
  t.diagnostic(JSON.stringify({recoveryTrace}));
  assert.equal(quest.getStage(f.p), 10);
});

test('stage 11 relog and re-entry restores the server human Tolna state', async t => {
  const f = actor(t, 11);
  f.p.setAttribute('souls-bane:rope-attached', 1);
  f.p.setLocation(new core.Location(3086, 5302, 0));
  PM.emitPlayerLogout({player:f.p, username:f.p.getUsername()});
  PM.emitPlayerLogin({player:f.p, username:f.p.getUsername()});
  assert.equal(quest.getStage(f.p), 11);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3310,3455]);
  t.diagnostic(JSON.stringify({phase:'login-before-reset',busy:f.p.busy(),placement:f.p.isNeedsPlacement()}));
  f.p.resetUpdating(); // Simulated end-of-tick after omitted world/client sync.
  t.diagnostic(JSON.stringify({phase:'login-after-reset',busy:f.p.busy(),placement:f.p.isNeedsPlacement()}));
  const spawns = []; const spawn = PM.spawnNpc;
  t.mock.method(PM, 'spawnNpc', (definition, ...rest) => {
    const npc = spawn.call(PM, definition, ...rest); spawns.push({definition,npc}); return npc;
  });
  await descendRift(f, t);
  assert.equal(quest.getStage(f.p), 11);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3086,5302]);
  assert.ok(spawns.some(s => s.definition.id === 1058 && s.definition.owner === f.p && s.npc), 'human Tolna is restored');
  await talkToHuman(f, spawns);
});
