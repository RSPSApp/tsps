// After the server build, run with node --test --test-concurrency=1.
// Real ClientConnection/World/NPC/HP/task/cache/persistence boundaries. Parent
// chapter checkpoint and preceding gorilla-death producers are supplied setup;
// this is not a natural MMII playthrough or a rendered-client verification.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { MAIN_PROFILE } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const { CombatRange } = require('../dist/game/content/combat/CombatRange');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const Runtime = require('../plugins/quests/QuestRuntime');
const actors = new WeakMap(), fixtures = new Set(), errors = [], tasks = new Set();
let core, quest, serial = 0, oldError, oldWarn, oldSubmit, persistenceBackend, oldRequestSave;
const STAGE = 160, GLOUGH = 7101, RETURN = [2130, 5645, 0];
const FIGHTING = 'monkey-madness-ii:glough-fighting';
const MINIMAP_STATE_VARBIT = 6719;

before(async () => {
  oldError = console.error; oldWarn = console.warn;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); oldError(...args); };
  console.warn = (...args) => {
    if (/\[plugins\].*hook.*(?:failed|threw)/.test(args.map(String).join(' '))) errors.push(args.map(String).join(' '));
    oldWarn(...args);
  };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  oldSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  core.RegionManager.init();
  // Match the canonical GameBuilder NPC consumer after plugin source registration,
  // without starting the engine or spawning the whole world.
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  assert.equal(new NpcDefinitionLoader().load(), true);
  core.RegionManager.loadMapFiles(...RETURN);
  PM.emitServerStartup({});
  quest = Runtime.getRegisteredQuests().find(q => q.key === 'monkey_madness_ii');
  assert.ok(quest, 'existing quest owner registered');
  persistenceBackend = core.GameConstants.PLAYER_PERSISTENCE;
  oldRequestSave = persistenceBackend.requestSave;
  persistenceBackend.requestSave = function(player, reason) {
    const f = actors.get(player); if (f) f.saveReasons.push(reason);
    return oldRequestSave.call(this, player, reason);
  };
  const observe = PM.createApi('GloughNativeFixtureObservation');
  // Deterministic rolls are supplied only for these actors. Packet dispatch,
  // costs/delays, accuracy/damage pipeline and health/death application stay real.
  observe.onCustomEvent('combat:accuracy-rolled', event => {
    const f = actors.get(event.attacker);
    if (f?.specialBaseDamage !== undefined && event.target === f.boss) event.accurate = true;
  });
  observe.onCustomEvent('combat:hit-rolled', event => {
    const f = actors.get(event.attacker);
    if (f?.specialBaseDamage !== undefined && event.target === f.boss) event.damage = f.specialBaseDamage;
  });
  observe.onCustomEvent('loc-teleports:arrived', event => {
    const f = actors.get(event.player);
    if (f) f.arrivals.push({ objectId: event.objectId, source: { ...event.location },
      actual: event.player.getLocation().clone(), area: event.player.getPrivateArea() });
  });
  observe.onCombatHitRoll(event => {
    const player = actors.get(event.attacker);
    const owner = event.attacker.getOwner?.();
    const opponent = owner && actors.get(owner);
    if ((player && event.target.getId?.() === GLOUGH && event.target.getOwner() === event.attacker)
      || (opponent && event.attacker.getId?.() === GLOUGH && event.target === owner)) event.forceAccurate = true;
  });
  observe.onCombatHitDamage(event => {
    const player = actors.get(event.attacker);
    if (player && event.target.getId?.() === GLOUGH && event.target.getOwner() === event.attacker) {
      if (player.playerDamage !== undefined) event.damage.setDamage(player.playerDamage);
    }
    const owner = event.attacker.getOwner?.(), opponent = owner && actors.get(owner);
    if (opponent && event.attacker.getId?.() === GLOUGH && event.target === owner) {
      if (opponent.bossDamage !== undefined) event.damage.setDamage(opponent.bossDamage);
      opponent.swings.push({ type: event.combatType, damage: event.damage.getDamage(), cycle: core.World.getProcessCycle() });
    }
  });
  observe.onCustomEvent('combat:damage-applied', ({ target, hit }) => {
    const f = actors.get(target);
    if (f) f.received.push({ lost: hit.getHealthLost(), cycle: core.World.getProcessCycle(), source: hit.getSource?.() });
    const owner = target.getOwner?.(), fight = owner && actors.get(owner);
    if (fight && target === fight.boss) fight.bossReceived.push({ lost: hit.getHealthLost(),
      damage: hit.getDamage(), reflected: hit.isReflected(), origin: hit.getOrigin(), cycle: core.World.getProcessCycle() });
  });
  observe.onPlayerDeathDrops(event => {
    const f = actors.get(event.player); if (f) f.dropLocations.push(event.location.clone());
  });
  observe.onNpcBeforeDeath(event => {
    const owner = event.npc.getOwner?.(), f = owner && actors.get(owner);
    if (!f || event.npc !== f.boss) return;
    f.bossDeathBoundaries.push({ prevented: event.preventDeath, cycle: core.World.getProcessCycle() });
    if (f.concurrentHazard && !event.preventDeath) {
      f.concurrentHazard = false;
      // Supplied concurrent status hazard, through the actual HitDamage queue;
      // boss lethality/PlayerDeathTask/quest credit remain actual engine work.
      f.p.getCombat().getHitQueue().addPendingDamage([
        new core.HitDamage(20, core.HitMask.GREEN).setSource(f.p),
      ]);
    }
  });
  observe.onCustomEvent('player:died', event => { const f = actors.get(event.player); if (f) f.deaths.push(event); });
});

after(() => {
  try {
    PM.emitServerShutdown({});
    for (const task of tasks) if (task.isRunning()) task.stop();
    assert.deepEqual(errors, [], 'no swallowed plugin/engine errors');
  } finally {
    console.error = oldError; console.warn = oldWarn;
    if (core) core.TaskManager.submit = oldSubmit;
    if (persistenceBackend) persistenceBackend.requestSave = oldRequestSave;
  }
});

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    core.World.process();
    for (const f of fixtures) if (f.boss?.isRegistered()) f.positions.push(sourcePosition(f, f.boss));
  }
}
function until(condition, limit, description) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  assert.ok(condition(), description);
}
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), p = new Player(session), c = new ClientConnection(channel);
  c.player = p; session.setPlayer(p); session.setTurnPacketProcessor(() => c.processTurnPackets());
  p.setUsername(`glough${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  // Supplied ordinary player preference. Every fixture attack is an explicit
  // packet; zero-damage NPC swings must not create unplanned player retaliation.
  p.setAutoRetaliate(false);
  assert.equal(core.World.getPlayers().add(p), true);
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.HITPOINTS, core.Skill.PRAYER]) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  quest.setStage(p, 155);
  p.moveTo(new core.Location(...RETURN));
  const f = { p, c, boss: null, scene: null, playerDamage: 25, bossDamage: 0,
    positions: [], swings: [], received: [], deaths: [], bossReceived: [],
    dropLocations: [], saveReasons: [], bossDeathBoundaries: [], arrivals: [], retryRoutes: [] };
  actors.set(p, f); fixtures.add(f);
  settle(f);
  assert.equal(p.getProfile(), MAIN_PROFILE);
  assert.equal(p.getRights(), core.PlayerRights.NONE, 'ordinary mortal player');
  assert.equal(p.getHitpoints(), 99);
  t.after(() => {
    PM.emitPlayerDisconnect({ player: p, username: p.getUsername() });
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    if (p.getArea()) p.getArea().leave(p, true);
    for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === p) PM.removeNpc(npc);
    for (const item of [...core.World.getItems()]) if (item.getOwner() === p.getUsername()) {
      core.ItemOnGroundManager.deregister(item);
      const index = core.World.getItems().indexOf(item); if (index >= 0) core.World.getItems().splice(index, 1);
    }
    p.closeInterruptibleInterfaces(); p.getMovementQueue().reset(); p.getMovementQueue().walkToReset();
    const index = p.getIndex(); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(index);
    core.World.getPlayers().remove(p); fixtures.delete(f);
    assert.equal(p.isRegistered(), false); assert.equal(core.TaskManager.hasActiveTask(p), false);
  });
  return f;
}
function settle(f) {
  until(() => !f.p.isNeedsPlacement(), 5, 'ordinary World placement settles');
  assert.equal(f.p.isRegistered(), true);
}
async function input(f, packet, turns = 1) { await f.c.dispatch([packet]); tick(turns); }
function sourcePosition(f, actor = f.p) {
  const p = actor.getLocation();
  return f.scene ? [p.getX() - f.scene.getBaseX() + 2048, p.getY() - f.scene.getBaseY() + 5632, p.getZ()]
    : [p.getX(), p.getY(), p.getZ()];
}
function inFinalRoom(f) {
  const [x, y, z] = sourcePosition(f, f.boss);
  return z === 0 && x >= 2070 && x <= 2082 && y >= 5643 && y <= 5654;
}
async function drain(f) {
  for (let i = 0; i < 160 && f.p.getDialogueManager().isActive(); i++) {
    const current = f.p.getDialogueManager().getCurrent();
    const options = core.MultiChatboxPrompt.getPending(f.p)?.options ?? current?.getOptions?.() ?? [];
    if (options.length) {
      const index = options.findIndex(option => (typeof option === 'string' ? option : option.getText?.() ?? option.text) === 'No.');
      assert.ok(index >= 0, 'only the known optional teleport menu is supplied');
      await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: index + 1 }, 4);
    } else {
      const group = f.p.getPacketSender().getChatboxGroupId();
      const child = { 193: 0, 229: 4, 11: 4, 217: 5, 231: 5 }[group];
      assert.ok(Number.isInteger(child), `native continuation for group ${group}`);
      await input(f, { type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: group === 193 ? 0 : -1 }, 4);
    }
  }
  assert.equal(f.p.getDialogueManager().isActive(), false, 'real transcript finishes within bound');
}
async function beginFight(f) {
  f.p.getInventory().adds(4151, 1);
  await input(f, { type: 'inventory_action', widgetId: 3214, itemId: 4151,
    slot: f.p.getInventory().getSlotForItemId(4151), option: 'Wield', optionIndex: 2 }, 4);
  assert.equal(f.p.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId(), 4151, 'ordinary wield producer');
  // The preceding gorilla kills are supplied producer setup, not gorilla combat
  // proof. The actual quest hook and actual mutagen/retreat transcript run.
  f.p.setAttribute('quest.monkey_madness_ii.crash-tortured', 1);
  f.p.setAttribute('quest.monkey_madness_ii.crash-demonic', 1);
  for (const id of [7150, 7144]) {
    const npc = PM.spawnNpc({ id, x: 2130, y: 5646, z: 0, owner: f.p, ownerOnly: true, wanderRadius: 0 });
    assert.ok(npc?.isRegistered());
    PM.emitNpcDeath({ killer: f.p, npc, npcId: id, location: { x: 2130, y: 5646, z: 0 }, remains: null });
    PM.removeNpc(npc);
  }
  assert.equal(quest.getStage(f.p), STAGE);
  await drain(f);
  f.boss = [...core.World.getNpcs()].find(npc => npc?.getId() === GLOUGH && npc.getOwner() === f.p);
  assert.ok(f.boss?.isRegistered(), 'the actual existing quest producer supplies the owned boss');
  assert.equal(f.boss.getMaxHitpoints(), 575); assert.equal(f.boss.getHitpoints(), 575);
  f.scene = f.p.getPrivateArea(); // Canonical area metadata, no new-unit import.
  f.initialBossPosition = sourcePosition(f, f.boss);
  f.positions.length = 0;
  settle(f);
}
function adjacent(f) {
  const b = f.boss.getLocation(), area = f.p.getPrivateArea();
  const candidates = [b.transform(f.boss.getSize(), 0), b.transform(-1, 0), b.transform(0, -1), b.transform(0, f.boss.getSize())];
  const tile = candidates.find(at => !core.RegionManager.blocked(at, area));
  assert.ok(tile, 'cache/collision supplies an ordinary adjacent standing tile');
  f.p.moveTo(tile); settle(f);
}
async function attack(f) {
  const actions = f.boss.getCurrentDefinition(f.p).getActions(), clickType = actions.indexOf('Attack') + 1;
  assert.ok(clickType > 0, 'actual cache attack option');
  await input(f, { type: 'npc_option', index: f.boss.getIndex(), clickType });
}
async function cavernRetry(f) {
  f.p.setAutoRetaliate(false);
  assert.equal(quest.getStage(f.p), STAGE);
  assert.equal(f.p.getPrivateArea(), null);
  f.scene = null;
  core.RegionManager.loadMapFiles(2026, 5612, 0);
  f.p.moveTo(new core.Location(2025, 5612, 0)); settle(f);
  const firstArrival = f.arrivals.length, effects = [];
  const sender = f.p.getPacketSender(), saved = {};
  for (const name of ['sendSubInterface', 'closeSubInterface', 'sendVarbit']) {
    saved[name] = sender[name];
    sender[name] = function(...args) { effects.push({ name, args }); return saved[name].apply(this, args); };
  }
  try {
    await input(f, { type: 'object_option', id: 28686, x: 2026, y: 5612, clickType: 1, action: 'Enter' });
    until(() => f.p.getPrivateArea() != null, 40, 'ordinary cache cavern Enter restarts through actual registered object owners');
    // If LocTeleports wins, its UI steps continue after synchronous scene entry.
    // If the parent generic hook wins, this wait alone proves no captured path.
    tick(12);
  } finally {
    for (const [name, method] of Object.entries(saved)) sender[name] = method;
  }
  f.scene = f.p.getPrivateArea();
  f.boss = [...core.World.getNpcs()].find(npc => npc?.getId() === GLOUGH && npc.getOwner() === f.p);
  assert.ok(f.boss?.isRegistered());
  assert.equal(f.boss.getHitpoints(), 575);
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), false, 'ordinary retry leaves owner movement released');
  assert.equal(f.p.getAttribute(FIGHTING), true);
  assert.equal(quest.getStage(f.p), STAGE);
  const arrivals = f.arrivals.slice(firstArrival), overlay = (161 << 16) | 1;
  if (arrivals.length) {
    assert.equal(arrivals.length, 1);
    assert.equal(arrivals[0].objectId, 28686);
    assert.deepEqual(arrivals[0].source, { x: 2026, y: 5612, z: 0 });
    assert.equal(arrivals[0].area, f.scene, 'actual successful captured arrival consumed into the current scene');
    assert.ok(effects.filter(event => event.name === 'sendSubInterface' && event.args[0] === overlay).length >= 2,
      'captured transition actually emitted both fade overlays');
    assert.ok(effects.some(event => event.name === 'closeSubInterface' && event.args[0] === overlay));
    const minimap = effects.filter(event => event.name === 'sendVarbit' && event.args[0] === MINIMAP_STATE_VARBIT);
    assert.ok(minimap.some(event => event.args[1] === 2) && minimap.some(event => event.args[1] === 0),
      'captured minimap off and restore both executed');
  }
  const route = arrivals.length ? 'captured-arrival-and-fade' : 'parent-object-direct';
  f.retryRoutes.push(route);
  console.info(`Glough ordinary retry producer: ${route}; arrivals=${arrivals.length}`);
}

async function reachSecond(f) {
  adjacent(f); await attack(f);
  until(() => f.boss.getHitpoints() <= 425, 200, 'ordinary player damage crosses first threshold');
  f.p.getCombat().reset();
  until(() => {
    const [x, y] = sourcePosition(f, f.boss);
    return x >= 2070 && x <= 2083 && y >= 5671 && y <= 5683
      && !f.boss.isScriptedMovement() && f.boss.getMovementQueue().size() === 0;
  }, 140, 'actual second-room arrival commits before phase-two damage measurements');
}
function standAtRange(f, range) {
  const b = f.boss.getLocation(), area = f.p.getPrivateArea();
  const candidates = [b.transform(-range, 0), b.transform(f.boss.getSize() - 1 + range, 0),
    b.transform(0, -range), b.transform(0, f.boss.getSize() - 1 + range)];
  const tile = candidates.find(at => !core.RegionManager.blocked(at, area)
    && core.RegionManager.canMovestart(b.transform(-1, 0), at, 1, 1, area)
    && core.RegionManager.canProjectileAttackBounds(at, b, 1, 1, f.boss.getSize(), f.boss.getSize(), area));
  assert.ok(tile, 'actual copied scene supplies an open connected ranged standing tile');
  f.p.moveTo(tile); settle(f);
}
async function prayer(f, child, id) {
  await input(f, { type: 'widget_action', groupId: 541, childId: child,
    widgetId: (541 << 16) | child, buttonNum: 1 });
  assert.equal(core.PrayerHandler.isActivated(f.p, id), true, 'ordinary prayer widget activates selected protection');
}

async function reachFinal(f) {
  adjacent(f); await attack(f);
  until(() => f.boss.getHitpoints() <= 280, 400, 'ordinary attacks cross the second threshold on a living registered boss');
  assert.ok(f.boss.isRegistered() && f.boss.getHitpoints() > 0);
  f.p.getCombat().reset();
  until(() => inFinalRoom(f), 160, 'ordinary Glough damage must cause retreat to the final distinct chamber');
  // Preserve the physical-room assertion above as the first baseline target.
  // Entering its bounding box precedes the exact arrival/phase commit.
  until(() => !f.boss.isScriptedMovement() && f.boss.getMovementQueue().size() === 0
    && f.boss.getMovementQueue().isMovementBlocked(), 120, 'actual final retreat finishes before stationary-phase assertions');
  assert.equal(quest.getStage(f.p), STAGE, 'retreats do not award the quest');
}

test('Glough first-chamber hallway denies pursuit before every step while ordinary in-room combat remains live', async t => {
  // A separate fresh attempt proves real attacks/HP application are enabled;
  // its swings cannot contaminate the hallway observation or advance its phase.
  const control = actor(t); await beginFight(control);
  control.playerDamage = 0; control.bossDamage = 2;
  adjacent(control);
  const healthy = control.p.getHitpoints();
  control.boss.getCombat().attack(control.p);
  until(() => control.swings.length > 0 && control.p.getHitpoints() < healthy,
    40, 'ordinary in-room boss combat actually swings and removes health');
  assert.equal(control.boss.getHitpoints(), 575);

  const f = actor(t); await beginFight(f);
  assert.equal(f.boss.getHitpoints(), 575, 'fresh phase-one boss before the hallway target');
  const boss = f.boss, scene = f.scene;
  const hallway = scene.sourceTile(2109, 5677);
  assert.equal(core.RegionManager.blocked(hallway, scene), false, 'copied map has the reported hallway tile');
  await input(f, { type: 'move', worldX: hallway.getX(), worldY: hallway.getY(), modifierFlags: 0, run: false });
  assert.ok(f.p.getMovementQueue().size() > 0 || f.p.getLocation().equals(hallway),
    'ordinary move packet installs the hallway route');
  until(() => f.p.getLocation().equals(hallway), 12, 'World movement reaches the reported safe tile');
  f.swings.length = 0; f.positions.length = 0;
  boss.getCombat().attack(f.p);
  const observations = [];
  for (let i = 0; i < 30; i++) {
    tick();
    observations.push({ position: sourcePosition(f, boss), queued: boss.getMovementQueue().size() });
  }
  console.info(`Glough first-hallway pursuit observations: ${JSON.stringify(observations)}`);
  assert.ok(observations.every(row => row.position[0] < 2107),
    'the owned boss never takes the boundary step into the eastern hallway');
  assert.equal(f.swings.length, 0, 'hallway safety includes no actual boss swings, not only supplied zero damage');
  assert.ok(observations.every(row => row.queued === 0), 'hallway area denial leaves no combat pursuit queue');
  assert.equal(f.boss, boss); assert.equal(f.p.getPrivateArea(), scene);
  assert.equal(boss.isRegistered(), true); assert.equal(boss.getHitpoints(), 575);
  assert.equal(quest.getStage(f.p), STAGE, 'a denied chase neither resets the attempt nor awards credit');
});

test('Glough an existing ordinary pursuit cannot leak across the hallway and the owner can return to combat', async t => {
  const f = actor(t); await beginFight(f);
  f.playerDamage = 0; f.bossDamage = 2;
  const inside = f.scene.sourceTile(2105, 5677), hallway = f.scene.sourceTile(2109, 5677);
  await input(f, { type: 'move', worldX: inside.getX(), worldY: inside.getY(), modifierFlags: 0, run: false });
  until(() => f.p.getLocation().equals(inside), 12, 'owner first enters the attack-permitted chamber');
  assert.equal(f.boss.getHitpoints(), 575);
  assert.equal(f.scene.canAttack(f.boss, f.p), true);
  f.boss.getCombat().attack(f.p);
  until(() => f.boss.getMovementQueue().size() > 0, 12, 'actual combat queues nonempty pursuit before the owner crosses');
  assert.equal(f.boss.getCombat().getTarget(), f.p);
  await input(f, { type: 'move', worldX: hallway.getX(), worldY: hallway.getY(), modifierFlags: 0, run: false });
  const observations = [];
  for (let i = 0; i < 30; i++) {
    tick(); observations.push({ owner: sourcePosition(f), boss: sourcePosition(f, f.boss),
      queued: f.boss.getMovementQueue().size(), swings: f.swings.length });
  }
  assert.ok(f.p.getLocation().equals(hallway));
  assert.ok(observations.every(row => row.boss[0] < 2107));
  const safe = observations.filter(row => row.owner[0] >= 2107);
  assert.ok(safe.length > 0);
  assert.ok(safe.every(row => row.swings === safe[0].swings), 'no new boss swing while the owner remains beyond the boundary');
  assert.ok(safe.every(row => row.queued === 0), 'nontransient area denial clears the old pursuit');
  console.info(`Glough queued-crossing observations: ${JSON.stringify(observations)}`);
  await input(f, { type: 'move', worldX: inside.getX(), worldY: inside.getY(), modifierFlags: 0, run: false });
  until(() => f.p.getLocation().equals(inside), 12, 'ordinary return walk reenters the chamber');
  const swings = f.swings.length;
  await attack(f);
  until(() => f.swings.length > swings, 40, 'ordinary player Attack reacquires a live in-room boss response');
  assert.equal(f.boss.getHitpoints(), 575); assert.equal(quest.getStage(f.p), STAGE);
});

test('Glough first hallway permits actual Wind Strike damage and rune consumption without boss retaliation', async t => {
  const f = actor(t); await beginFight(f);
  f.playerDamage = 1; f.bossDamage = 2;
  f.p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevels(core.Skill.MAGIC, 99, false);
  const spell = CombatSpells.getCombatSpellByName('Wind Strike');
  const widget = core.CacheDefinitions.getSpellByName('Wind Strike');
  assert.ok(spell && widget, 'actual cache-backed spell producer');
  const costs = spell.itemsRequired(f.p).map(rune => ({ id: rune.getId(), amount: rune.getAmount() }));
  assert.ok(costs.length > 0);
  for (const rune of costs) f.p.getInventory().adds(rune.id, rune.amount * 10);
  const hallway = f.scene.sourceTile(2109, 5677);
  await input(f, { type: 'move', worldX: hallway.getX(), worldY: hallway.getY(), modifierFlags: 0, run: false });
  until(() => f.p.getLocation().equals(hallway), 12, 'ordinary walk reaches the hallway casting tile');
  assert.equal(f.boss.getHitpoints(), 575);
  assert.equal(core.RegionManager.canProjectileAttackTarget(f.p, f.boss), true, 'actual copied projectile line');
  const before = costs.map(rune => f.p.getInventory().getAmount(rune.id));
  f.swings.length = 0; f.positions.length = 0;
  await input(f, { type: 'spell_on_npc', targetIndex: f.boss.getIndex(),
    spellWidget: widget.widgetId, spellChild: -1, spellItemId: widget.itemId });
  until(() => f.boss.getHitpoints() < 575, 30, 'actual magic hit removes boss health from the hallway');
  assert.ok(f.bossReceived.some(hit => hit.lost > 0));
  assert.ok(costs.every((rune, i) => f.p.getInventory().getAmount(rune.id) < before[i]), 'actual cast pays each rune cost');
  assert.ok(f.p.getLocation().equals(hallway), 'casting did not walk into the chamber');
  assert.ok(f.positions.every(([x]) => x < 2107)); assert.equal(f.swings.length, 0);
  assert.equal(quest.getStage(f.p), STAGE);
});

test('Glough ordinary attacks traverse the three chambers and final real death alone grants boss credit', async t => {
  const f = actor(t); await beginFight(f); await reachFinal(f);
  // The first feature assertion above is reachable on the old single-spawn
  // source. New area/cache/save/provider assumptions deliberately follow it.
  assert.ok(f.scene, 'the implemented encounter owns its copied area');
  const [firstX, firstY] = f.initialBossPosition;
  assert.ok(firstX >= 2090 && firstX <= 2107 && firstY >= 5670 && firstY <= 5681, 'independent eastern first chamber');
  assert.ok(f.positions.some(([x, y]) => x >= 2070 && x <= 2083 && y >= 5671 && y <= 5683), 'second room was physically visited');
  const definition = f.boss.getCurrentDefinition(f.p);
  assert.equal(definition.getMaxHit(), 61, 'canonical selected definition supplies normal inherited maximum');
  assert.equal(definition.getAttackSpeed(), 6);
  assert.deepEqual(definition.getStats().slice(0, 5), [260, 270, 248, 262, 250], 'canonical definition combat levels');
  assert.equal(definition.isAggressive(), true);
  assert.equal(f.boss.hasFlag('combat:no-regen'), true);
  assert.equal(f.boss.getSize(), 2);
  adjacent(f); await attack(f);
  let reacquired = 0;
  for (let turns = 0; turns < 240 && quest.getStage(f.p) < 165; turns++) {
    // Canonical forced displacement marks placement, which can end the old
    // attack. Drive the player's ordinary next Attack click; do not replace
    // boss health/death, move the player, or invoke the quest credit helper.
    if (f.boss.isRegistered() && f.boss.getHitpoints() > 0
      && !f.p.isNeedsPlacement() && f.p.getCombat().getTarget() !== f.boss) {
      await attack(f); reacquired++;
    } else tick();
  }
  assert.ok(quest.getStage(f.p) >= 165,
    `ordinary final damage reaches the actual delayed NPCDeathTask credit (reacquired=${reacquired}, bossHP=${f.boss.getHitpoints()}, ownerHP=${f.p.getHitpoints()})`);
  t.diagnostic(`ordinary final-phase Attack reacquisitions: ${reacquired}`);
  await drain(f);
  assert.equal(quest.getStage(f.p), 170);
  assert.equal(f.p.getPrivateArea(), null); assert.equal(f.boss.isRegistered(), false);
  const stage = quest.getStage(f.p);
  PM.emitNpcDeath({ killer: f.p, npc: f.boss, npcId: GLOUGH });
  assert.equal(quest.getStage(f.p), stage, 'duplicate stale death cannot grant credit again');
});

test('control: unrelated and foreign Glough death cannot advance the supplied parent checkpoint', t => {
  const f = actor(t), other = actor(t); quest.setStage(f.p, STAGE);
  const npc = PM.spawnNpc({ id: GLOUGH, x: 2075, y: 5677, z: 0, owner: other.p, ownerOnly: true, wanderRadius: 0 });
  PM.emitNpcDeath({ killer: f.p, npc, npcId: GLOUGH });
  assert.equal(quest.getStage(f.p), STAGE);
  assert.equal(quest.getStage(other.p), 155);
  PM.removeNpc(npc);
});

test('Glough logout clears the actual attempt and JSON hydration returns a saved in-flight actor for a fresh attempt', async t => {
  const f = actor(t); await beginFight(f); await reachFinal(f);
  const persistence = new (require('../plugins/persistence/JsonPlayerPersistence.plugin').JsonPlayerPersistence)();
  const raw = JSON.stringify(PlayerSave.fromPlayer(f.p), persistence.replacer.bind(persistence));
  assert.equal(f.p.getAttribute(FIGHTING), true);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.boss.isRegistered(), false); assert.equal(f.p.getAttribute(FIGHTING), false);
  const g = actor(t);
  persistence.hydratePlayerSave(JSON.parse(raw, persistence.reviver.bind(persistence))).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false }); settle(g);
  assert.equal(quest.getStage(g.p), STAGE);
  assert.equal(g.p.getAttribute(FIGHTING), false);
  assert.deepEqual(sourcePosition(g), RETURN);
  assert.equal([...core.World.getNpcs()].some(npc => npc?.getId() === GLOUGH && npc.getOwner() === g.p), false);
  await cavernRetry(g);
  assert.notEqual(g.boss, f.boss, 'hydrated owner receives a fresh identity and full-health attempt');
});

test('Glough final stationary footprint uses canonical overlap refusal and ordinary attack walks the owner back out', async t => {
  const f = actor(t); await beginFight(f); await reachFinal(f);
  f.p.moveTo(f.boss.getLocation().clone()); settle(f);
  f.playerDamage = 0;
  assert.equal(CombatRange.overlapsEntities(f.p, f.boss), true);
  const swings = f.swings.length;
  const before = f.boss.getHitpoints(), bossTile = f.boss.getLocation().clone();
  tick(12);
  assert.equal(f.swings.length, swings, 'canonical overlapping-footprint refusal prevents owned boss rolls');
  assert.equal(f.boss.getHitpoints(), before); assert.equal(f.boss.getLocation().equals(bossTile), true);
  await attack(f);
  until(() => !CombatRange.overlapsEntities(f.p, f.boss), 24, 'ordinary attack resolves a reachable non-overlapped player tile');
  assert.equal(f.boss.getLocation().equals(bossTile), true, 'final boss remains stationary');
});


test('Glough actual phase-two ranged impact honors the bounded protected ceiling once and the wrong prayer does not reduce it', async t => {
  const f = actor(t); await beginFight(f); await reachSecond(f);
  f.playerDamage = 0; f.boss.getCombat().reset(); f.bossDamage = undefined;
  const oldRandom = Math.random;
  try {
    // Force the maximum raw roll, not a damage override: real PendingHit,
    // style provider, incoming protection, HP cap and HitQueue still execute.
    Math.random = () => 0.999999;
    await prayer(f, 22, core.PrayerHandler.PROTECT_FROM_MISSILES);
    standAtRange(f, 3); f.p.getCombat().reset();
    const from = f.received.length, swings = f.swings.length;
    f.boss.getCombat().attack(f.p);
    until(() => f.received.slice(from).some(hit => hit.source === f.boss && hit.lost > 0), 18,
      'actual ranged impact reaches owner health');
    f.boss.getCombat().reset();
    const ranged = f.swings.slice(swings).filter(hit => hit.type === core.CombatType.RANGED);
    assert.ok(ranged.length > 0, 'actual phase-two provider rolled ranged');
    assert.equal(ranged[0].damage, 42, 'raw42 is the disclosed inferred policy, not a claimed retail measurement');
    assert.equal(f.received.slice(from).find(hit => hit.source === f.boss && hit.lost > 0).lost, 21,
      'matching protection applies approximate half once, not full NPC immunity or double reduction');
    tick(8); f.p.setHitpoints(99);
    await prayer(f, 21, core.PrayerHandler.PROTECT_FROM_MAGIC);
    assert.equal(core.PrayerHandler.isActivated(f.p, core.PrayerHandler.PROTECT_FROM_MISSILES), false);
    standAtRange(f, 3); f.p.getCombat().reset();
    const wrongFrom = f.received.length;
    f.boss.getCombat().attack(f.p); // NPC resumes its normal provider/World combat.
    until(() => f.received.slice(wrongFrom).some(hit => hit.source === f.boss && hit.lost > 0), 18,
      'wrong-prayer ranged impact reaches owner health');
    assert.equal(f.received.slice(wrongFrom).find(hit => hit.source === f.boss && hit.lost > 0).lost, 42);
    f.boss.getCombat().reset();
  } finally { Math.random = oldRandom; }
});

test('Glough a quiet long final-room encounter conserves health and outside travel cancels before an ordinary full-health retry', async t => {
  const f = actor(t); await beginFight(f); await reachFinal(f);
  const oldBoss = f.boss, hp = oldBoss.getHitpoints();
  const baseX = f.scene.getBaseX(), baseY = f.scene.getBaseY();
  f.p.getCombat().reset(); oldBoss.getCombat().reset();
  f.p.moveTo(new core.Location(baseX + 50, baseY + 45, 0)); settle(f);
  tick(48);
  assert.equal(oldBoss.getCombat().getLastAttack().hasElapsed(20000), true,
    'actual game-cycle stopwatch passed generic regeneration delay');
  assert.equal(oldBoss.getHitpoints(), hp, 'owned no-regen flag conserves damage through an idle encounter');
  f.p.moveTo(new core.Location(...RETURN)); settle(f); tick(2);
  assert.equal(oldBoss.isRegistered(), false);
  assert.equal(f.p.getPrivateArea(), null);
  assert.equal(f.p.getAttribute(FIGHTING), false);
  assert.deepEqual(sourcePosition({ ...f, scene: null }), RETURN, 'actual outside destination is preserved');
  await cavernRetry(f);
  assert.notEqual(f.boss, oldBoss);
  PM.emitNpcDeath({ killer: f.p, npc: oldBoss, npcId: GLOUGH });
  assert.equal(quest.getStage(f.p), STAGE, 'stale previous-attempt death cannot credit fresh attempt');
});


function heldItemCount(player, id) {
  return [...player.getInventory().getValidItems(), ...player.getEquipment().getValidItems()]
    .filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0);
}
function deathStoredCount(player, id) {
  const query = { player }; PM.emitCustomEvent('gravestones:state', query);
  const stored = [...(query.grave?.items ?? []), ...(query.office ?? []).filter(Boolean)]
    .filter(item => item.id === id).reduce((n, item) => n + item.amount, 0);
  const floor = [...core.World.getItems()].filter(item => item.getOwner() === player.getUsername()
    && item.getItem().getId() === id).reduce((n, item) => n + item.getItem().getAmount(), 0);
  return stored + floor;
}
function serializePlayer(player) {
  const codec = new (require('../plugins/persistence/JsonPlayerPersistence.plugin').JsonPlayerPersistence)();
  const raw = JSON.stringify(PlayerSave.fromPlayer(player), codec.replacer.bind(codec));
  return { raw, save: codec.hydratePlayerSave(JSON.parse(raw, codec.reviver.bind(codec))) };
}

test('Glough ordinary lethal owner damage runs the dangerous death task, conserves lost items at static return and saves a restartable checkpoint', async t => {
  const f = actor(t); await beginFight(f);
  // Supplied possessions and prior Death introduction avoid an unrelated first-
  // grave tutorial. Actual keep/drop policy, grave and respawn remain enabled.
  PM.emitCustomEvent('gravestones:met-death', { player: f.p });
  const ids = [1277, 1279, 1281, 1283, 1285, 1287];
  for (const id of ids) {
    const item = new core.Item(id, 1); assert.equal(item.isTradeable(), true);
    f.p.getInventory().add(item);
  }
  const before = new Map(ids.map(id => [id, heldItemCount(f.p, id)]));
  f.playerDamage = 0; f.bossDamage = 20; f.p.setHitpoints(10);
  const previousTasks = new Set(tasks);
  adjacent(f); await attack(f);
  until(() => f.deaths.length === 1, 40, 'ordinary boss combat reaches actual PlayerDeathTask drop and respawn');
  assert.ok([...tasks].some(task => !previousTasks.has(task) && task instanceof core.PlayerDeathTask),
    'real engine death task was submitted, not an emitted death callback');
  assert.equal(f.deaths[0].itemsLost, true);
  assert.equal(f.boss.isRegistered(), false); assert.equal(f.p.getPrivateArea(), null);
  assert.equal(f.p.getAttribute(FIGHTING), false); assert.equal(quest.getStage(f.p), STAGE);
  assert.ok(f.dropLocations.length > 0);
  assert.deepEqual([f.dropLocations[0].getX(), f.dropLocations[0].getY(), f.dropLocations[0].getZ()], RETURN,
    'explicit instance cleanup makes ordinary death drop policy use static return');
  assert.ok(ids.some(id => deathStoredCount(f.p, id) > 0), 'dangerous death really loses held possessions');
  for (const id of ids) assert.equal(heldItemCount(f.p, id) + deathStoredCount(f.p, id), before.get(id),
    `kept plus grave/office/floor conserves supplied item ${id}`);
  assert.ok(f.saveReasons.includes('death') && f.saveReasons.includes('respawn'),
    'actual task requests both persistence boundaries; skip-persistence suppresses disk writes');
  const g = actor(t); serializePlayer(f.p).save.applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false }); settle(g);
  assert.equal(quest.getStage(g.p), STAGE); assert.equal(g.p.getPrivateArea(), null);
  assert.equal(g.p.getAttribute(FIGHTING), false);
  assert.equal(g.p.getLocation().equals(core.GameConstants.DEFAULT_LOCATION), true, 'ordinary respawn survived JSON hydration');
  await cavernRetry(g);
});

test('Glough owner death during the actual final delayed boss-death boundary refuses credit and preserves retry progress', async t => {
  const f = actor(t); await beginFight(f); await reachFinal(f);
  PM.emitCustomEvent('gravestones:met-death', { player: f.p });
  f.p.setHitpoints(10); f.playerDamage = 575; f.bossDamage = 0;
  f.concurrentHazard = true;
  adjacent(f); await attack(f);
  until(() => f.deaths.length === 1, 40, 'supplied concurrent queued status hazard runs actual player death after final boss lethality');
  assert.ok(f.bossDeathBoundaries.some(boundary => !boundary.prevented), 'actual final boss death began');
  tick(30);
  assert.equal(quest.getStage(f.p), STAGE, 'owner survival is required at delayed final credit');
  assert.equal(f.boss.isRegistered(), false); assert.equal(f.p.getPrivateArea(), null);
  assert.equal(f.p.getAttribute(FIGHTING), false);
  await cavernRetry(f);
});


test('Glough real recoil health loss arms adjacent magic while zero-loss swings do not, and actual pull obeys the copied scene movement line', async t => {
  const f = actor(t); await beginFight(f); await reachFinal(f);
  f.playerDamage = 0; f.bossDamage = 0;
  f.p.getCombat().reset(); f.boss.getCombat().reset(); tick(8);
  const oldRandom = Math.random;
  try {
    Math.random = () => 0.999999;
    standAtRange(f, 3); f.p.getCombat().reset();
    const from = f.p.getLocation().clone(), swingStart = f.swings.length;
    f.boss.getCombat().attack(f.p);
    until(() => !f.p.getLocation().equals(from), 18, 'ordinary final magic pulls owner to boss perimeter');
    assert.equal(f.swings.slice(swingStart)[0].type, core.CombatType.MAGIC);
    const landing = f.p.getLocation().clone();
    assert.equal(CombatRange.overlapsEntities(f.p, f.boss), false);
    assert.equal(core.RegionManager.canMovestart(from, landing, 1, 1, f.scene), true,
      'actual selected pull has a full canonical walking line, not merely projectile LOS');
    assert.equal((f.scene.getClip(landing) & 0x200100), 0);
    f.boss.getCombat().reset(); tick(8); adjacent(f);
    const zeroFrom = f.bossReceived.length, zeroSwings = f.swings.length;
    f.boss.getCombat().attack(f.p);
    until(() => f.swings.length > zeroSwings, 16, 'ordinary adjacent provider chooses after zero-health-loss magic');
    assert.equal(f.swings[zeroSwings].type, core.CombatType.MELEE,
      'zero-loss prior impacts cannot arm repeated adjacent magic');
    assert.equal(f.bossReceived.slice(zeroFrom).some(hit => hit.lost > 0), false);
    f.boss.getCombat().reset(); tick(8);
    f.p.getInventory().adds(2550, 1);
    await input(f, { type: 'inventory_action', widgetId: 3214, itemId: 2550,
      slot: f.p.getInventory().getSlotForItemId(2550), option: 'Wear', optionIndex: 2 }, 4);
    assert.equal(f.p.getEquipment().get(core.Equipment.RING_SLOT).getId(), 2550);
    adjacent(f); f.p.getCombat().reset(); f.bossDamage = 10;
    const recoilFrom = f.bossReceived.length;
    f.boss.getCombat().attack(f.p);
    until(() => f.bossReceived.slice(recoilFrom).some(hit => hit.reflected && hit.origin === 'recoil' && hit.lost > 0),
      20, 'actual equipped recoil producer reaches boss health through direct HitDamage');
    const recoil = f.bossReceived.slice(recoilFrom).find(hit => hit.origin === 'recoil' && hit.lost > 0);
    assert.equal(recoil.lost, 2, 'ordinary ten damage produces actual ten-percent-plus-one recoil');
    // Re-establish adjacency after the actual knockback, before the next six-
    // tick attack. Thus the next magic cannot be explained by distance alone.
    f.bossDamage = 0; f.p.getCombat().reset(); adjacent(f);
    const armedSwings = f.swings.length;
    assert.equal(CombatRange.overlapsEntities(f.p, f.boss), false);
    until(() => f.swings.length > armedSwings, 16, 'real recoil HP loss arms the adjacent final magic choice');
    assert.equal(f.swings[armedSwings].type, core.CombatType.MAGIC);
  } finally { Math.random = oldRandom; }
});

test('Glough ordinary staggered claw lethality conserves the deferred carrier through both retreats and only final engine death credits', async t => {
  const f = actor(t); await beginFight(f);
  const claws = core.ItemIdentifiers.DRAGON_CLAWS;
  f.p.getInventory().adds(claws, 1);
  await input(f, { type: 'inventory_action', widgetId: 3214, itemId: claws,
    slot: f.p.getInventory().getSlotForItemId(claws), option: 'Wield', optionIndex: 2 }, 4);
  assert.equal(f.p.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(), claws);
  // The claw branch rolls one base damage then distributes it into four
  // splats, bypassing the ordinary per-splat roll observer. Supply that base
  // via the existing canonical roll events, not by constructing a victory hit.
  f.specialBaseDamage = 300;
  adjacent(f);
  await input(f, { type: 'widget_action', groupId: 593, childId: 57, widgetId: (593 << 16) | 57, buttonNum: 1 });
  await attack(f);
  until(() => f.bossDeathBoundaries.some(boundary => boundary.prevented) && f.boss.getHitpoints() === 1,
    30, 'actual staggered special reaches early lethal interception during a retreat');
  f.p.getCombat().reset(); f.specialBaseDamage = undefined;
  assert.equal(f.p.getSpecialPercentage(), 50, 'ordinary special widget consumed the real claw energy cost');
  assert.equal(quest.getStage(f.p), STAGE, 'early lethal is not final-room credit');
  assert.ok(new Set(f.bossReceived.filter(hit => hit.lost > 0).map(hit => hit.cycle)).size >= 2,
    'real special dealt health loss on staggered engine cycles');
  assert.equal(f.bossReceived.reduce((sum, hit) => sum + hit.lost, 0), 575,
    'lethal ordinary hit spent the original 575 health, not discarded damage');
  const direct = new core.HitDamage(7, core.HitMask.GREEN).setSource(f.p);
  // Supplied later queued status boundary control. It bypasses PendingHit just
  // as recoil/status/split splats do; the live engine owns HP application.
  f.boss.getCombat().getHitQueue().addPendingDamage([direct]);
  tick();
  assert.equal(direct.getDamage(), 0); assert.equal(direct.getHealthLost(), 0);
  assert.equal(f.boss.getHitpoints(), 1, 'temporary movement carrier is not fresh damage or XP');
  until(() => inFinalRoom(f), 180, 'already-lethal boss still physically traverses to final chamber');
  assert.ok(f.positions.some(([x, y]) => x >= 2070 && x <= 2083 && y >= 5671 && y <= 5683),
    'overflow cannot skip the actual second room');
  until(() => quest.getStage(f.p) >= 165, 60, 'final exact arrival invokes canonical zero-HP and delayed death credit');
  await drain(f);
  assert.equal(quest.getStage(f.p), 170);
  assert.equal(f.boss.isRegistered(), false); assert.equal(f.p.getPrivateArea(), null);
});

// AFTER-only controls appended after the complete frozen 06ca baseline fixture.
// They qualify normal second-phase combat independently of a geometric lure hypothesis.
async function phaseOnePositive(f, style) {
  await beginFight(f); await reachSecond(f);
  f.playerDamage = 0; f.bossDamage = 2;
  f.p.getCombat().reset(); f.boss.getCombat().reset();
  if (style === core.CombatType.MELEE) adjacent(f);
  else standAtRange(f, 3);
  const oldRandom = Math.random;
  try {
    Math.random = () => 0; // supplied style branch for adjacent phase-one melee
    const method = f.boss.getCombat().resolveMethodForCurrentCycle();
    assert.equal(method.phase, 1, 'the actual owned provider still resolves second phase');
    assert.equal(method.type(), style);
    assert.equal(CombatRange.canReach(f.boss, method, f.p), true, 'actual footprint and copied projectile/edge line permit the positive');
    assert.equal(CombatRange.attackDistance(f.boss, method, f.p), style === core.CombatType.MELEE ? 1 : 6,
      'canonical current TSPS reach, not a new retail range claim or final-phase reach11');
    const hp = f.p.getHitpoints(), before = f.swings.length;
    f.boss.getCombat().attack(f.p);
    until(() => f.swings.slice(before).some(hit => hit.type === style)
      && f.p.getHitpoints() < hp, 24, 'ordinary owned second-phase attack has actual swing and health loss');
    assert.ok(f.boss.getHitpoints() > 280 && f.boss.getHitpoints() <= 425,
      'positive neither resets the first phase nor crosses the final retreat threshold');
    assert.equal(f.boss.getCombat().resolveMethodForCurrentCycle().phase, 1);
    assert.equal(f.boss.getOwner(), f.p); assert.equal(f.boss.getPrivateArea(), f.scene);
    assert.equal(quest.getStage(f.p), STAGE);
  } finally { Math.random = oldRandom; }
}

test('AFTER-only control: second-phase ordinary in-room ranged response keeps the owned attempt live', async t => {
  await phaseOnePositive(actor(t), core.CombatType.RANGED);
});

test('AFTER-only control: second-phase ordinary adjacent melee response keeps the owned attempt live', async t => {
  await phaseOnePositive(actor(t), core.CombatType.MELEE);
});

// AFTER-only geometric qualification. This observes a moving, live phase-one
// lure and an actual ten-tile cast; it does not assert a stationary Wiki safespot
// or identify the visual black-rock landmark from an arbitrary coordinate.
before(() => {
  const observe = PM.createApi('GloughPhaseOneGeometricCastObservation');
  observe.onCustomEvent('magic:cast-committed', event => {
    const f = actors.get(event.player);
    if (!f?.phaseOneProbe) return;
    const method = f.p.getCombat().resolveMethodForCurrentCycle();
    f.phaseOneProbe.casts.push({
      owner: sourcePosition(f), boss: sourcePosition(f, f.boss),
      footprintDistance: CombatRange.footprintDistance(f.boss.getLocation(), f.boss.getSize(), f.p.getLocation()),
      effectiveRange: CombatRange.attackDistance(f.p, method, f.boss),
      reachable: CombatRange.canReach(f.p, method, f.boss),
      projectileLine: core.RegionManager.canProjectileAttackTarget(f.p, f.boss),
      bossPhase: f.phaseOneProbeState.phase,
      cycle: core.World.getProcessCycle(), runesSaved: event.runesSaved,
    });
  });
});

test('AFTER-only qualification: a live second-to-first-room lure permits a real ten-tile magic cast with paid runes', async t => {
  const f = actor(t); await beginFight(f); await reachSecond(f);
  f.playerDamage = 0; f.bossDamage = 0; // actual swings still recorded; not a safety assertion
  f.p.getCombat().reset(); f.boss.getCombat().reset();
  // Retain the existing owned method's authoritative lifecycle state once.
  // Repeated observer reads must not reconstruct a nearby boss's random style.
  assert.ok(CombatRange.footprintDistance(f.boss.getLocation(), f.boss.getSize(), f.p.getLocation()) > 1);
  const phaseState = f.boss.getCombat().resolveMethodForCurrentCycle().state;
  assert.ok(phaseState?.active && phaseState.boss === f.boss && phaseState.player === f.p);
  assert.equal(phaseState.phase, 1); assert.equal(phaseState.pendingPhase, null);
  const probe = f.phaseOneProbe = { casts: [], ticks: [] };
  f.phaseOneProbeState = phaseState;
  const record = () => probe.ticks.push({ owner: sourcePosition(f), boss: sourcePosition(f, f.boss),
    distance: CombatRange.footprintDistance(f.boss.getLocation(), f.boss.getSize(), f.p.getLocation()),
    queued: f.boss.getMovementQueue().size(), swings: f.swings.length,
    phase: phaseState.phase, active: phaseState.active, pendingPhase: phaseState.pendingPhase });
  const walkTo = async (tile, run, limit) => {
    await input(f, { type: 'move', worldX: tile.getX(), worldY: tile.getY(), modifierFlags: 0, run });
    record();
    for (let i = 0; i < limit && !f.p.getLocation().equals(tile); i++) { tick(); record(); }
    assert.ok(f.p.getLocation().equals(tile), 'ordinary move packet reaches the copied geometric candidate');
  };
  try {
    // The retained map's corridor walls lie at y5675/5678. Align the
    // size-two greedy pursuit with the two interior rows using ordinary move
    // packets, rather than asking its south-west anchor to stay at y5677.
    // This is a geometric candidate, not a proven failed position or retail
    // black-rock landmark. No placement, freeze, queue lock or HP setter.
    await walkTo(f.scene.sourceTile(2079, 5676), false, 80);
    assert.equal(phaseState.phase, 1);
    f.boss.getCombat().attack(f.p);
    await walkTo(f.scene.sourceTile(2098, 5676), false, 80);
    // A false run flag follows the player's run preference; it does not force
    // walking. Owner arrival therefore does not establish pursuit completion.
    // Wait for a new ordinary ranged response at this stationary destination,
    // rather than assuming the queued NPC step has already crossed the corridor.
    const responsesAtDestination = f.swings.length;
    const answeredAtDestination = () => f.swings.slice(responsesAtDestination)
      .some(swing => swing.type === core.CombatType.RANGED);
    for (let i = 0; i < 80 && !answeredAtDestination(); i++) { tick(); record(); }
    assert.ok(probe.ticks.some(row => row.boss[0] >= 2084), 'the live size-two boss physically follows out through the connecting corridor');
    assert.ok(answeredAtDestination(), 'ordinary ranged pursuit answers at the stationary destination before the next run input');
    // 2106 is still west of the known first-room hallway boundary2107. This
    // is a geometric range candidate, not the Wiki black-rock coordinate.
    await walkTo(f.scene.sourceTile(2106, 5677), true, 20);
    assert.equal(CombatRange.footprintDistance(f.boss.getLocation(), f.boss.getSize(), f.p.getLocation()), 11,
      'candidate ordering leaves one ordinary NPC step before the ten-tile cast');
    f.p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevels(core.Skill.MAGIC, 99, false);
    const spell = CombatSpells.getCombatSpellByName('Wind Strike');
    const widget = core.CacheDefinitions.getSpellByName('Wind Strike');
    assert.ok(spell && widget);
    const costs = spell.itemsRequired(f.p).map(r => ({ id: r.getId(), amount: r.getAmount() }));
    assert.ok(costs.length > 0);
    for (const r of costs) f.p.getInventory().adds(r.id, r.amount * 10);
    const inventory = costs.map(r => f.p.getInventory().getAmount(r.id)), hp = f.boss.getHitpoints();
    f.playerDamage = 1;
    await input(f, { type: 'spell_on_npc', targetIndex: f.boss.getIndex(),
      spellWidget: widget.widgetId, spellChild: -1, spellItemId: widget.itemId });
    record();
    for (let i = 0; i < 20 && f.boss.getHitpoints() >= hp; i++) { tick(); record(); }
    probe.health = { before: hp, after: f.boss.getHitpoints(), lost: hp - f.boss.getHitpoints() };
    assert.equal(probe.health.lost, 1, 'one supplied-damage cast removes exactly one real boss hitpoint');
    assert.ok(probe.casts.some(c => c.footprintDistance === 10 && c.effectiveRange === 10
      && c.reachable && c.projectileLine && c.bossPhase === 1), 'commit observation binds real footprint-distance10/effective range10/LOS to the live second phase');
    assert.equal(probe.casts.length, 1, 'one manual spell commits once');
    for (const [i, r] of costs.entries()) assert.equal(inventory[i] - f.p.getInventory().getAmount(r.id), r.amount,
      'the actual manual cast pays exactly its required rune amount');
    f.p.getCombat().reset();
    for (let i = 0; i < 30; i++) { tick(); record(); }
    assert.ok(probe.ticks.every(row => row.phase === 1 && row.active && row.pendingPhase === null));
    assert.equal(f.boss.getOwner(), f.p); assert.equal(f.boss.getPrivateArea(), f.scene);
    assert.equal(f.p.getPrivateArea(), f.scene); assert.equal(quest.getStage(f.p), STAGE);
    // Follow-up attacks/movement are reported, never suppressed or called a
    // zero-hit safespot. Stationary retail safety remains separate qualification.
  } finally {
    try {
      // Retain the actual failing observations before clearing the probe. These
      // are diagnostics, not a replacement for any assertion or a new oracle.
      console.info(`Glough phase-one geometric lure/cast trace: ${JSON.stringify({
        ...probe,
        observedTicks: probe.ticks.length, observedCasts: probe.casts.length,
        ticksTruncated: probe.ticks.length > 64, castsTruncated: probe.casts.length > 4,
        ticks: probe.ticks.slice(-64), casts: probe.casts.slice(-4),
      })}`);
    } finally { f.phaseOneProbe = null; f.phaseOneProbeState = null; }
  }
});
