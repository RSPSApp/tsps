// Run after yarn build: node --test tests/maggot-king-combat.test.cjs
// Native cache/Player/registered entrance/world ticks. Quest completion and standing are seeded;
// this does not claim quest traversal, socket input, rendering or a retail tick measurement.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { readTemplateRegion } = require('../dist/game/collision/TemplateRegionData');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets, MAIN_INVENTORY_WIDGET_UID } = require('../dist/net/protocol/ClientProtocol');
const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
let core, Common, Instance, Fight;
const rolledDamage = new WeakMap();
const finalDamage = [];
const beforeDefence = new WeakMap();
const defenceRolls = [];
let serial = 0;
const actorIds = new Set();
const errors = [];
const originalError = console.error;
const QUEST_ATTRIBUTE = 'quest.the_blood_moon_rises.stage';
const QUEST_COMPLETE = 110;
const ARENA = { minX: 2904, maxX: 2918, minY: 8033, maxY: 8036, wallY: 8037 };
const RANGED_ANIMATION = 13933;

before(async () => {
  console.error = (...args) => { errors.push(args); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  PM.createApi('MaggotNativePreDamage').onCombatHitDamage(event => {
    if (event.target?.__maggotKingSession) rolledDamage.set(event.damage, event.damage.getDamage());
  });
  PM.createApi('MaggotNativePreDefence').onCustomEvent('combat:defence-roll', event => beforeDefence.set(event, event.defenceRoll));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  PM.createApi('MaggotNativePostDamage').onCombatHitDamage(event => {
    if (event.target?.__maggotKingSession) {
      const row = { attacker: event.attacker, hit: event.hit, part: event.damage,
        before: rolledDamage.get(event.damage), after: event.damage.getDamage(),
        punish: event.target.__maggotKingSession.fight?.launch?.punish, applied: null };
      event.damage.onApplied(actual => { row.applied = actual; });
      finalDamage.push(row);
    }
  });
  PM.createApi('MaggotNativePostDefence').onCustomEvent('combat:defence-roll', event => {
    if (event.target?.__maggotKingSession) defenceRolls.push({ attacker: event.attacker, target: event.target,
      before: beforeDefence.get(event), after: event.defenceRoll });
  });
  Common = require('../plugins/bosses/maggotking/Common.MaggotKing');
  Instance = require('../plugins/bosses/maggotking/Instance.MaggotKing');
  Fight = require('../plugins/bosses/maggotking/Fight.MaggotKing');
  core.RegionManager.loadMapFiles(...Common.data.entrance.slice(0, 2));
});
after(() => {
  try { PM.emitServerShutdown({}); }
  finally { console.error = originalError; assert.deepEqual(errors, [], 'no caught runtime/plugin errors'); }
});

function player(t, complete = true) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const name = `mgnative${++serial}`;
  assert.ok(name.length <= 12, 'native account names fit the base-37 identity limit');
  p.setUsername(name);
  p.setLongUsername(core.Misc.stringToLongBigInt(name));
  const nativeId = p.getLongUsername();
  assert.notEqual(nativeId, 0n, 'native account identity is nonzero');
  assert.equal(actorIds.has(nativeId), false, 'simultaneous and prior fixture actors have distinct native identities');
  actorIds.add(nativeId);
  p.setAttribute('bot-skip-persistence', true);
  // Isolate explicit inputs/standing in these fixtures; the dedicated retaliation case enables it.
  p.setAutoRetaliate(false);
  p.setAttribute(QUEST_ATTRIBUTE, complete ? QUEST_COMPLETE : 0);
  p.getSession().setPlayer(p);
  assert.equal(core.World.getPlayers().add(p), true, 'real player registered');
  for (const skill of [core.Skill.HITPOINTS, core.Skill.DEFENCE, core.Skill.PRAYER]) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  p.setHitpoints(99);
  p.moveTo(Common.loc(Common.data.outside));
  p.setNeedsPlacement(false);
  t.after(() => {
    const session = Instance.sessionOf(p);
    const boss = session?.boss;
    if (session) {
      session.area.leave(p, true);
      assert.equal(session.area.isDestroyed(), true, 'real postLeave destroys owner instance');
      assert.equal(session.ended, true);
      assert.equal(Instance.sessionOf(p), null);
      assert.ok(!session.respawnTask || !session.respawnTask.isRunning());
      if (boss) {
        assert.equal(boss.isRegistered(), false,
          'owner boss is removed by real session cleanup');
      }
    }
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
    core.World.getPlayers().remove(p);
    assert.equal(p.isRegistered(), false);
    assert.equal(Instance.sessionOf(p), null);
    assert.deepEqual(errors, []);
  });
  return p;
}

function enter(p) {
  const at = Common.loc(Common.data.entrance);
  const id = core.ObjectIdentifiers.DARKWOOD_TREES_4;
  const object = core.World.findCacheObject(p, id, at);
  assert.ok(object, 'ordinary Darkwood trees exist in active cache');
  const definition = core.ObjectDefinition.forPlayer(object.getId(), p);
  assert.equal(definition.getName(), 'Darkwood trees');
  const clickType = definition.getInteractions().findIndex(action => action?.toLowerCase() === 'enter') + 1;
  assert.ok(clickType > 0, 'cache exposes Enter');
  assert.equal(PM.emitObjectInteraction({ player: p, object, objectId: id, definition,
    clickType, option: 'enter', location: { x: at.getX(), y: at.getY(), z: at.getZ() },
    sourceLocation: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false }), true);
  const session = Instance.sessionOf(p);
  if (!session) return null; // quest refusal is an expected ordinary entry result
  // Enter and Fight.start place actors. Complete their ordinary sync/reset turn before input.
  assert.equal(session.boss.hasFlag('combat:no-retaliate'), true, 'controller keeps native retaliation from resetting its queue');
  const before = { ownerPlacement: p.isNeedsPlacement(), bossPlacement: session.boss.isNeedsPlacement(),
    validTarget: core.CombatFactory.validTarget(p, session.boss) };
  core.World.process();
  assert.equal(p.isNeedsPlacement(), false, 'native owner placement completed before ordinary input');
  assert.equal(session.boss.isNeedsPlacement(), false, 'native boss placement completed before ordinary input');
  assert.equal(core.CombatFactory.validTarget(p, session.boss), true, 'registered live owner/boss are valid after placement');
  console.log(JSON.stringify({ event: 'maggot-native-placement-boundary', before,
    after: { ownerPlacement: p.isNeedsPlacement(), bossPlacement: session.boss.isNeedsPlacement(),
      validTarget: core.CombatFactory.validTarget(p, session.boss) } }));
  return session;
}

function mapped(area, [x, y]) { return area.tile(x - 2888, y - 8032, 0); }

test('active cache identifies the separated lair floor, bone wall, head definition and projectile LOS', () => {
  const region = readTemplateRegion((45 << 8) | 125);
  assert.ok(region, 'actual cache242 region45_125 loads');
  const locs = region.chunks.flat().filter(loc => loc.plane === 0)
    .map(loc => ({ id: loc.id, x: 2880 + loc.localX, y: 8000 + loc.localY, type: loc.type, face: loc.face }));
  const bones = locs.filter(loc => loc.y === ARENA.wallY && loc.id >= 61051 && loc.id <= 61055);
  assert.equal(bones.length, 17, 'actual named Bones occupy the seventeen-tile separator');
  for (const id of new Set(bones.map(loc => loc.id))) {
    const def = core.ObjectDefinition.forId(id);
    assert.equal(def.getName(), 'Bones');
    assert.equal(def.isSolid(), true);
    assert.equal(def.isImpenetrable(), false, 'walking blocked, projectiles allowed');
  }
  const head = core.ObjectDefinition.forId(core.ObjectIdentifiers.COL_FFFF00_MAGGOT_KING_HEAD_COL);
  assert.equal(head.getSizeX(), 3);
  assert.equal(head.getSizeY(), 4);
  assert.ok(head.getInteractions().includes('Strike'));
  const area = new core.TemplatedInstanceArea(5, 2);
  try {
    for (let x = 0; x < 5; x++) for (let y = 0; y < 2; y++) {
      area.setChunk(0, x, y, { sourceChunkX: (2888 >> 3) + x, sourceChunkY: (8032 >> 3) + y,
        sourcePlane: 0, rotation: 0 });
    }
    const floor = [];
    for (let y = ARENA.minY; y <= ARENA.maxY; y++) {
      const row = [];
      for (let x = ARENA.minX; x <= ARENA.maxX; x++) {
        const tile = mapped(area, [x, y]);
        assert.equal(area.getClip(tile) & core.RegionManager.BLOCKED_MASK, 0, `arena floor ${x},${y} clear`);
        row.push(x);
      }
      floor.push({ y, xs: row });
    }
    const wall = mapped(area, [2911, ARENA.wallY]);
    assert.notEqual(area.getClip(wall) & core.RegionManager.BLOCKED_MASK, 0, 'native copied separator blocks walking');
    const from = mapped(area, [2911, 8036]);
    const to = mapped(area, [2911, 8038]);
    const projectile = core.RegionManager.canProjectileMove(from.getX(), from.getY(), to.getX(), to.getY(), 0, 1, 1, area);
    assert.equal(projectile, true, 'real native projectile ray crosses bone barrier');
    console.log(JSON.stringify({ event: 'maggot-king-native-map', cache: CachePipeline.getActive().name,
      sourceMin: [2888, 8032], chunks: [5, 2], bones, floor, projectile,
      staticExitCaveCount: locs.filter(loc => loc.id === 61994).length,
      limitation: 'native copied-map/collision receipt; body/head/exit placement and retail timing not inferred' }));
  } finally { area.destroy(); }
});

test('registered quest-gated entry reaches the separated combat arena without admitting another player', t => {
  const locked = player(t, false);
  assert.equal(enter(locked), null, 'native quest query refuses unfinished quest');
  const owner = player(t);
  const other = player(t);
  const session = enter(owner);
  const independent = enter(other);
  assert.ok(session && independent, 'registered entrance creates both solo instances');
  assert.notEqual(session.area, independent.area);
  assert.equal(session.boss.getId(), core.NpcIdentifiers.MAGGOT_KING);
  assert.equal(session.boss.getDefinition().getHitpoints(), 1500);
  assert.equal(session.boss.getDefinition().getCombatLevel(), 741);
  assert.equal(session.area.canAttack(other, session.boss), false, 'another actor cannot attack owner boss');
  assert.equal(session.area.canAttack(owner, independent.boss), false, 'owner cannot attack another instance boss');
  const wall = session.tile([2911, 8037, 0]);
  const bones = session.area.getTemplateObjects(wall).filter(object => object.getId() >= 61051 && object.getId() <= 61055);
  console.log(JSON.stringify({ event: 'maggot-king-entry-controls', questRefusal: true, solo: true,
    actualSourceMin: Common.data.sourceMin, actualArrival: Common.data.arrival,
    wallBones: bones.map(object => object.getId()) }));
  assert.ok(bones.length > 0, 'feature-absence target: entering reaches the Wiki wall-separated Maggot King arena');
  const source = [owner.getLocation().getX() - session.area.getBaseX() + Common.data.sourceMin[0],
    owner.getLocation().getY() - session.area.getBaseY() + Common.data.sourceMin[1]];
  assert.ok(source[0] >= ARENA.minX && source[0] <= ARENA.maxX && source[1] >= ARENA.minY && source[1] <= ARENA.maxY,
    'owner arrives on the four-row player floor');
});

test('ordinary ranged Attack starts boss combat and publishes the first ranged animation through native world ticks', t => {
  const owner = player(t);
  const session = enter(owner);
  assert.ok(session && !session.ended, 'real registered entry is active before attack target');
  const boss = session.boss;
  assert.equal(boss.getOwner(), owner);
  assert.equal(boss.getHitpoints(), 1500, 'live boss has its cache hitpoints');
  assert.equal(owner.getHitpoints(), 99, 'owner alive before native ticks');
  // Worn equipment/levels are supplied setup, outside the tested Attack input boundary.
  const style = core.WeaponInterfaces.CROSSBOW;
  owner.getSkillManager().setMaxLevels(core.Skill.RANGED, 99, false).setCurrentLevels(core.Skill.RANGED, 99, false);
  owner.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_CROSSBOW, 1));
  owner.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(core.ItemIdentifiers.RUNITE_BOLTS, 100));
  owner.setWeapon(style);
  owner.setFightType(style.getFightType()[0]);
  core.BonusManager.update(owner);
  owner.setNeedsPlacement(false);
  const method = core.CombatFactory.getMethod(owner);
  assert.equal(method.type(), core.CombatType.RANGED, 'real crossbow selects ranged combat');
  assert.equal(core.CombatFactory.canAttackPermission(owner, boss, false, method), core.CanAttackResponse.CAN_ATTACK);
  assert.equal(core.CombatRange.canReach(owner, method, boss), true, 'actual current scene permits the initiating shot');
  assert.equal(core.World.isPlayerSessionConnected(owner), true, 'native World sees a connected fixture actor');
  assert.equal(owner.getPrivateArea(), session.area);
  assert.equal(boss.getPrivateArea(), session.area);
  assert.ok(session.area.hasMember(owner) && session.area.entities.includes(boss), 'owner and boss are attached');
  const beforeAmmo = owner.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount();
  const attackClick = boss.getCurrentDefinition(owner).getActions().findIndex(action => action?.toLowerCase() === 'attack') + 1;
  assert.ok(attackClick > 0, 'active NPC definition exposes Attack');
  const animations = [];
  let bossTurns = 0;
  const nativeProcess = boss.process;
  t.mock.method(boss, 'process', function() { bossTurns++; return nativeProcess.call(this); });
  const original = boss.performAnimation;
  t.mock.method(boss, 'performAnimation', function(animation) {
    animations.push(animation.getId());
    return original.call(this, animation);
  });
  new NPCOptionPacketListener().executeOption(owner, boss.getIndex(), attackClick);
  assert.equal(owner.getCombat().getTarget(), boss, 'ordinary NPC Attack input selects the session boss');
  for (let tick = 0; tick < 8; tick++) core.World.process();
  const afterAmmo = owner.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount();
  assert.ok(afterAmmo < beforeAmmo, 'native player turn actually commits a crossbow shot');
  assert.ok(bossTurns > 0, 'registered boss mechanics actually processed in the observation window');
  console.log(JSON.stringify({ event: 'maggot-king-native-first-attack', animations,
    ownerHitpoints: owner.getHitpoints(), bossHitpoints: boss.getHitpoints(), ended: session.ended,
    beforeAmmo, afterAmmo, bossTurns, sourceMin: Common.data.sourceMin, arrival: Common.data.arrival,
    ownerPlacement: owner.isNeedsPlacement(), bossPlacement: boss.isNeedsPlacement(),
    ownerAttached: session.area.hasMember(owner), bossAttached: session.area.entities.includes(boss),
    ownerRegistered: owner.isRegistered(), bossRegistered: boss.isRegistered(),
    limitation: 'records real animation publication; no socket/rendering or exact retail cadence claim' }));
  assert.equal(session.ended, false, 'fight remains active at first-attack boundary');
  assert.ok(boss.getHitpoints() > 0 && boss.getHitpoints() <= 1500, 'initiated boss remains alive at observation boundary');
  assert.ok(animations.includes(RANGED_ANIMATION),
    'feature-absence symptom: initiated combat publishes the cache-backed ranged animation');
  assert.equal(boss.getCombat().getTarget(), null, 'native incoming player shots never acquire a competing boss retaliation target');
});

function input(p, action) {
  let used = false;
  p.getSession().setTurnPacketProcessor(() => { if (!used) { used = true; action(); } });
  core.World.process();
  p.getSession().setTurnPacketProcessor(() => {});
  assert.equal(used, true, 'supplied input ran in the native player input phase');
}
function ticks(count) { for (let i = 0; i < count; i++) core.World.process(); }
function attack(p, npc) {
  const option = npc.getCurrentDefinition(p).getActions().findIndex(action => action?.toLowerCase() === 'attack') + 1;
  assert.ok(option > 0);
  new NPCOptionPacketListener().executeOption(p, npc.getIndex(), option);
}
function equip(p, item, weapon, ammo, fightIndex = 0) {
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(item, 1));
  if (ammo) p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(ammo, 5000));
  p.setWeapon(weapon);
  p.setFightType(weapon.getFightType()[fightIndex]);
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.RANGED, core.Skill.MAGIC]) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  core.BonusManager.update(p);
  p.setNeedsPlacement(false);
}
function ranged(p) { equip(p, core.ItemIdentifiers.RUNE_CROSSBOW, core.WeaponInterfaces.CROSSBOW, core.ItemIdentifiers.RUNITE_BOLTS); }
function invulnerable(p) {
  // Full traversal's survival is supplied setup. Separate impact tests below use ordinary 99HP actors.
  p.setAttribute(Player.INFINITE_HEALTH_ATTRIBUTE, true);
}
function until(predicate, limit, description) {
  for (let i = 0; i < limit && !predicate(); i++) core.World.process();
  const passed = predicate();
  if (!passed) console.log(JSON.stringify({ event: 'maggot-native-unreached-boundary', description,
    sessions: [...Instance.sessions.values()].map(session => {
      const boss = session.boss, fight = session.fight, queue = boss?.getMovementQueue();
      return { phase: fight?.phase, tick: fight?.tick, winding: fight?.winding,
        boss: boss && { registered: boss.isRegistered(), placement: boss.isNeedsPlacement(),
          tile: session.worldTile(boss.getLocation()), hitpoints: boss.getHitpoints(),
          destination: queue.getDestination() && session.worldTile(queue.getDestination()),
          mobility: queue.getMobility().canMove(), blocked: queue.isStepBlocked(), size: boss.getSize(),
          route: queue.hasRoute(), lastDestination: [queue.lastDestX, queue.lastDestY],
          replyTarget: boss.getCombat().getTarget() === session.player,
          requestedClose: session.worldTile(fight.posture(session.worldTile(session.player.getLocation())[0], 8038)) },
        owner: { placement: session.player.isNeedsPlacement(), tile: session.worldTile(session.player.getLocation()) } };
    }) }));
  assert.ok(passed, description);
}
function objectInput(p, object, option) {
  const definition = core.ObjectDefinition.forId(object.getId());
  const at = object.getLocation();
  const clickType = definition.getInteractions().findIndex(action => action?.toLowerCase() === option.toLowerCase()) + 1;
  assert.ok(clickType > 0);
  return PM.emitObjectInteraction({ player: p, object, objectId: object.getId(), definition, clickType, option,
    location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false });
}

test('ranged impact reads current prayer and lays consumed bile on the impact tile', t => {
  const p = player(t);
  const session = enter(p);
  const fight = session.fight;
  ranged(p);
  input(p, () => attack(p, session.boss));
  assert.equal(fight.phase, 'ranged');
  // Move before impact; this is supplied standing, separately from native movement coverage below.
  const landing = session.tile([2913, 8035, 0]);
  p.moveTo(landing);
  p.setNeedsPlacement(false); // supplied before-impact standing, not a teleport still being placed
  input(p, () => core.PrayerHandler.activatePrayerPrayerId(p, core.PrayerHandler.PROTECT_FROM_MISSILES));
  assert.equal(p.getHitpoints(), 99, 'impact prayer blocks the ranged hit before later floor contact');
  const poisonTiles = [...fight.floor.values()].filter(object => object.getId() === Fight.BILE_POISON);
  // Area processing consumes the owner's impact tile in the same turn; adjacent pools remain.
  assert.equal(poisonTiles.length, 2);
  assert.ok(poisonTiles.every(object => fight.adjacent(landing).some(tile => tile.equals(object.getLocation()))));
  ticks(1);
  assert.ok(p.getHitpoints() >= 95 && p.getHitpoints() <= 97, 'stepping/standing on bile applies its bounded floor damage once');
  assert.equal(fight.floor.has(fight.key(landing)), false, 'contact consumes the impact tile');
});

test('screech reacts to prayer changes each tick, restores defence and alternates to magic', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  ranged(p);
  input(p, () => attack(p, session.boss));
  until(() => session.fight.phase === 'screech', 60, 'ordinary opening rotation reaches screech');
  assert.equal(session.boss.getDefenceLevel(), 100);
  // Health is ordinary for this bounded impact observation; keep away from the three carrion targets.
  p.setAttribute(Player.INFINITE_HEALTH_ATTRIBUTE, false);
  p.setHitpoints(99);
  // Remove the opening spit's existing poison to isolate this bounded prayer/screech observation.
  p.setPoisonDamage(0); p.setVenomed(false);
  input(p, () => core.PrayerHandler.activatePrayerPrayerId(p, core.PrayerHandler.PROTECT_FROM_MISSILES));
  const first = p.getHitpoints();
  assert.ok(first >= 74 && first <= 84, 'one screech pulse deals15..25 with a protection prayer');
  input(p, () => core.PrayerHandler.deactivatePrayer(p, core.PrayerHandler.PROTECT_FROM_MISSILES));
  assert.equal(p.getHitpoints(), first, 'turning prayer off blocks the next screech pulse');
  invulnerable(p);
  until(() => session.fight.phase !== 'screech', 8, 'screech completes without a stuck phase');
  assert.equal(session.fight.phase, 'magic');
  assert.equal(session.boss.getDefenceLevel(), 200);
  assert.equal(session.fight.screeched, true);
  console.log(JSON.stringify({ event: 'maggot-native-screech', firstDamage: 99 - first, phase: session.fight.phase,
    limit: 'native prayer input/ticks; carrion RNG and timing are documented implementation tuning' }));
});

test('sticky contact follows native walking, consumes the pool, drains a combat stat and delays attacks', t => {
  const p = player(t);
  const session = enter(p);
  const fight = session.fight;
  const destination = session.tile([2912, 8036, 0]);
  // A targeted hazard checkpoint, not evidence of a naturally selected magic splash.
  fight.placeFloor(destination, Fight.BILE_STICKY);
  const skills = [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE];
  for (const skill of skills) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  const beforeStats = skills.map(skill => p.getSkillManager().getCurrentLevel(skill));
  p.getCombat().setAttackDelay(10);
  input(p, () => {
    // The opening ranged impact is due during this bounded sticky observation.
    core.PrayerHandler.activatePrayerPrayerId(p, core.PrayerHandler.PROTECT_FROM_MISSILES);
    p.getMovementQueue().requestWalk(destination);
  });
  assert.ok(p.getLocation().equals(destination), 'native movement actually stepped onto the pool');
  assert.equal(fight.floor.has(fight.key(destination)), false);
  ticks(1);
  const drains = beforeStats.map((level, i) => level - p.getSkillManager().getCurrentLevel(skills[i]));
  assert.equal(drains.filter(amount => amount > 0).length, 1);
  assert.ok(drains.reduce((a, b) => a + b, 0) >= 2 && drains.reduce((a, b) => a + b, 0) <= 4);
  assert.equal(p.getCombat().getAttackDelay(), 9, 'two native elapsed ticks plus one sticky delay');
  assert.ok(p.getHitpoints() >= 95 && p.getHitpoints() <= 97);
});

test('airborne standard bow Attack kills the owned larva and overwrites an existing cooldown', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  // Threshold is supplied. The opening rotation and screech which launch the larva remain native.
  session.boss.setHitpoints(1200);
  until(() => session.fight.larvae.size > 0, 60, 'threshold encounter launches a larva during screech');
  const larva = [...session.fight.larvae][0];
  assert.equal(session.worldTile(larva.npc.getLocation())[0], Fight.FLOOR.minX, 'first larva launches west');
  assert.ok(session.fight.tick < larva.airborneUntil);
  // A held real larva target checks method selection without committing a synthetic attack.
  p.getCombat().attack(larva.npc);
  equip(p, core.ItemIdentifiers.ELDER_MAUL, core.WeaponInterfaces.MAUL);
  assert.equal(core.CombatFactory.getMethod(p).type(), core.CombatType.MELEE,
    'an omitted subtype must not reclassify a melee weapon as an instant ranged larva attack');
  ranged(p);
  assert.equal(core.CombatFactory.getMethod(p), core.CombatFactory.RANGED_COMBAT,
    'heavy crossbow keeps its ordinary ranged method');
  equip(p, core.ItemIdentifiers.MAGIC_SHORTBOW, core.WeaponInterfaces.SHORTBOW, core.ItemIdentifiers.RUNE_ARROW);
  assert.equal(core.WeaponProfiles.ranged(p).rangedDefenceType ?? 'standard', 'standard',
    'ordinary bow inherits native standard ranged defence when its optional subtype is absent');
  const at = session.worldTile(larva.npc.getLocation());
  p.moveTo(session.tile([at[0] + 2, at[1], 0]));
  p.setNeedsPlacement(false);
  p.getCombat().setAttackDelay(20);
  const ammoBefore = p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount();
  input(p, () => attack(p, larva.npc));
  assert.equal(p.getCombat().getTarget(), larva.npc, 'ordinary input retains the real target');
  assert.equal(larva.npc.getCombat().getHitQueue().hasPendingHitFrom(p), true,
    'real bow committed its no-extra-flight hit for the next native NPC reveal turn');
  assert.ok(p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount() < ammoBefore,
    'the fast kill still pays real ammunition');
  assert.ok(p.getCombat().getAttackDelay() > 0 && p.getCombat().getAttackDelay() <= 4,
    'native weapon cooldown replaces the prior20ticks');
  ticks(1); // NPC targets retain CombatFactory's one processing tick even for zero projectile delay
  assert.equal(larva.npc.getHitpoints(), 0, 'committed no-extra-flight bow hit lands on the native reveal turn');
  ticks(1);
  assert.equal(session.fight.larvae.has(larva), false);
});

test('landed larvae traverse their row, eat carrion, heal actual contact loss and reset after stepping off', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  session.boss.setHitpoints(1200);
  until(() => session.fight.larvae.size > 0, 60, 'natural rotation reaches larva launch');
  const larva = [...session.fight.larvae][0];
  until(() => session.fight.tick >= larva.airborneUntil, 5, 'larva naturally lands');
  const [x, y] = session.worldTile(larva.npc.getLocation());
  const food = session.tile([x + larva.direction, y, 0]);
  session.fight.placeFloor(food, Fight.CARRION);
  const before = session.boss.getHitpoints();
  ticks(1);
  assert.ok(larva.npc.getLocation().equals(food));
  assert.equal(session.fight.floor.has(session.fight.key(food)), false);
  assert.equal(session.boss.getHitpoints(), before + 1, 'eaten carrion restores1HP');
  const approach = food.transform(0, y === Fight.FLOOR.maxY ? -1 : 1, 0);
  p.moveTo(approach);
  p.setNeedsPlacement(false); // supplied adjacent standing; actual contact begins with native walking
  // Fight/larva task movement precedes this cycle's client input. Walk to its LIVE tile,
  // one diagonal step from the supplied approach, after that native movement has occurred.
  input(p, () => p.getMovementQueue().requestWalk(larva.npc.getLocation().clone()));
  assert.ok(p.getLocation().equals(larva.npc.getLocation()), 'ordinary movement reaches the live landed larva');
  p.setAttribute(Player.INFINITE_HEALTH_ATTRIBUTE, false);
  p.setHitpoints(99);
  ticks(1);
  assert.equal(p.getHitpoints(), 96);
  assert.equal(session.boss.getHitpoints(), before + 4, 'contact heals the actual3HP lost');
  ticks(1);
  assert.equal(p.getHitpoints(), 92);
  assert.equal(session.boss.getHitpoints(), before + 8);
  const off = food.transform(0, y === Fight.FLOOR.maxY ? -1 : 1, 0);
  input(p, () => p.getMovementQueue().addFirstStep(off));
  ticks(1);
  assert.equal(larva.contact, 0, 'ordinary movement breaks contact and resets its escalating damage');
});

test('edge slams keep body footprints clear; fresh same-tick melee input grants one punish', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  session.boss.setHitpoints(900); // disclosed threshold checkpoint
  until(() => session.fight.phase === 'melee', 70, 'native rotation introduces melee below its threshold');
  const fight = session.fight;
  equip(p, core.ItemIdentifiers.ELDER_MAUL, core.WeaponInterfaces.MAUL);
  for (const edge of [Fight.FLOOR.minX, Fight.FLOOR.maxX]) {
    p.moveTo(session.tile([edge, Fight.FLOOR.maxY, 0]));
    p.setNeedsPlacement(false);
    p.getCombat().setAttackDelay(30);
    const beforeRows = finalDamage.length;
    let clicked = false;
    let oldDelay;
    p.getSession().setTurnPacketProcessor(() => {
      if (clicked || !fight.head || fight.slamCycle !== core.World.getProcessCycle()) return;
      clicked = true;
      oldDelay = p.getCombat().getAttackDelay();
      if (edge === Fight.FLOOR.minX) attack(p, session.boss);
      else {
        const at = fight.head.getLocation();
        new ObjectActionPacketListener().executeAction(p, fight.head.getId(), at.getX(), at.getY(), 1, 'Strike');
      }
    });
    until(() => clicked, 20, 'native input observes an actual head extension after the body finishes walking');
    p.getSession().setTurnPacketProcessor(() => {});
    assert.ok(oldDelay > 0, 'punish actually crosses an outstanding weapon deadline');
    assert.equal(fight.punishSpent, core.World.getProcessCycle(), 'ordinary fresh Attack commits the extension punish');
    assert.equal(p.getCombat().getAttackDelay(), oldDelay, 'punish keeps the prior deadline');
    const parts = finalDamage.slice(beforeRows).filter(row => row.attacker === p);
    assert.ok(parts.length > 0, 'native melee really rolled a hit');
    assert.equal(parts[0].punish, true);
    assert.equal(parts[0].after, Math.floor(parts[0].before * 1.5));
    const bossAt = session.boss.getLocation();
    for (let dx = 0; dx < 5; dx++) for (let dy = 0; dy < 5; dy++) {
      assert.equal(session.area.getClip(bossAt.transform(dx, dy, 0)) & core.RegionManager.BLOCKED_MASK, 0,
        `edge${edge}: actual5x5body remains on clear northern tiles`);
    }
    assert.ok(fight.head);
    const headX = session.worldTile(fight.head.getLocation())[0];
    assert.ok(headX >= Fight.FLOOR.minX && headX + 2 <= Fight.FLOOR.maxX, 'projected head stays within arena');
    const spent = fight.punishSpent;
    ticks(1);
    assert.equal(fight.punishSpent, spent, 'held target does not manufacture another fresh punish');
    p.getCombat().reset();
  }
});

test('whole1500HP encounter traverses rotations and thresholds through real ranged hits, then cleans up and retries', t => {
  const p = player(t);
  const session = enter(p);
  const boss = session.boss;
  const fight = session.fight;
  invulnerable(p);
  ranged(p);
  const phases = new Set();
  let lowest = 1500;
  const rowsBefore = finalDamage.length;
  const ammoBefore = p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount();
  const method = core.CombatFactory.getMethod(p);
  assert.equal(method.type(), core.CombatType.RANGED);
  assert.equal(core.CombatFactory.canAttackPermission(p, boss, false, method), core.CanAttackResponse.CAN_ATTACK);
  assert.equal(core.CombatRange.canReach(p, method, boss), true);
  input(p, () => attack(p, boss));
  assert.equal(p.getCombat().getTarget(), boss, 'ordinary full-fight Attack holds the real boss');
  assert.equal(boss.getCombat().getHitQueue().hasPendingHitFrom(p), true, 'opening shot actually committed to the native target queue');
  assert.ok(p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount() < ammoBefore);
  let allHealing = 0, controllerHealing = 0, walkInputs = 0, retargetInputs = 0;
  const setHitpoints = boss.setHitpoints;
  t.mock.method(boss, 'setHitpoints', function(value) {
    const before = this.getHitpoints();
    const result = setHitpoints.call(this, value);
    allHealing += Math.max(0, this.getHitpoints() - before);
    return result;
  });
  const heal = fight.heal;
  t.mock.method(fight, 'heal', function(amount) {
    const before = boss.getHitpoints();
    const result = heal.call(this, amount);
    controllerHealing += Math.max(0, boss.getHitpoints() - before);
    return result;
  });
  // An actual sustained input sequence: walk off a live larva to break subsequent escalating
  // contact, then reselect Attack when the walk finishes. The current hit still resolves before
  // movement in Player.process; healing and NPC/controller movement remain live.
  const fullInput = () => {
    if (boss.getHitpoints() <= 0 || Instance.sessionOf(p) !== session) return;
    phases.add(fight.phase);
    const larvae = [...fight.larvae].filter(larva => larva.npc.getHitpoints() > 0);
    if (larvae.some(larva => larva.npc.getLocation().equals(p.getLocation()))) {
      const next = [[0, -1], [0, 1], [-1, 0], [1, 0]]
        .map(([dx, dy]) => p.getLocation().transform(dx, dy, 0))
        .find(at => fight.inFloor(at) && p.getMovementQueue().canWalkTo(at)
          && !larvae.some(larva => larva.npc.getLocation().equals(at)));
      if (next) { p.getMovementQueue().requestWalk(next); walkInputs++; return; }
    }
    if (p.getCombat().getTarget() !== boss && p.getMovementQueue().getDestination() === null) {
      attack(p, boss);
      retargetInputs++;
    }
  };
  p.getSession().setTurnPacketProcessor(fullInput);
  try {
    for (let tick = 0; tick < 2400 && boss.getHitpoints() > 0; tick++) {
      phases.add(fight.phase);
      lowest = Math.min(lowest, boss.getHitpoints());
      core.World.process();
    }
  } finally { p.getSession().setTurnPacketProcessor(() => {}); }
  const rows = finalDamage.slice(rowsBefore).filter(row => row.attacker === p);
  console.log(JSON.stringify({ event: 'maggot-native-full-damage-boundary', lowest, bossHitpoints: boss.getHitpoints(),
    phases: [...phases], ammoBefore, ammoAfter: p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount(),
    rolls: rows.length, positiveRolls: rows.filter(row => row.before > 0).length,
    rolled: rows.reduce((sum, row) => sum + row.before, 0), applied: rows.reduce((sum, row) => sum + (row.applied ?? 0), 0),
    appliedRows: rows.filter(row => row.applied !== null).length, targetHeld: p.getCombat().getTarget() === boss,
    ownerTile: session.worldTile(p.getLocation()), bossTile: session.worldTile(boss.getLocation()),
    bossReplyTarget: boss.getCombat().getTarget() === p, bossSize: boss.getSize(),
    allHealing, controllerHealing, walkInputs, retargetInputs }));
  assert.equal(boss.getHitpoints(), 0, 'unseeded boss health reaches death through ordinary player combat');
  for (const phase of ['ranged', 'magic', 'screech', 'melee']) assert.ok(phases.has(phase), `natural traversal saw${phase}`);
  until(() => session.boss === null, 20, 'native death dispatch ends the old controller');
  assert.equal(fight.stopped, true);
  assert.equal(fight.events.length, 0);
  assert.equal(fight.floor.size, 0);
  assert.equal(fight.larvae.size, 0);
  assert.equal(fight.head, null);
  const kills = p.getAttribute('maggot-king:kills');
  assert.equal(kills, 1, 'native killer receives one kill credit');
  until(() => session.boss && session.boss !== boss, 150, 'same room allows a clean retry');
  assert.equal(session.boss.getHitpoints(), 1500);
  assert.equal(session.fight.phase, 'ranged');
  console.log(JSON.stringify({ event: 'maggot-native-full-traversal', phases: [...phases], lowest, kills,
    limitation: 'bossHP/progression/attacks native; quest, equipment and player invulnerability supplied; no client/rendered or natural survival claim' }));
});

test('ordinary owned Escape removes all encounter actors and pending effects; a fresh entry works', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  session.boss.setHitpoints(250);
  until(() => session.fight.larvae.size === 4, 60, 'ending screech launches at most four larvae');
  const fight = session.fight;
  const boss = session.boss;
  const actors = [...fight.larvae].map(larva => larva.npc);
  const exit = session.exit;
  assert.equal(exit.getDefinition().getName(), 'Cave');
  assert.equal(exit.getFace(), 1);
  input(p, () => assert.equal(objectInput(p, exit, 'Quick-escape'), true));
  assert.equal(Instance.sessionOf(p), null);
  assert.equal(session.area.isDestroyed(), true);
  assert.equal(fight.stopped, true);
  assert.equal(fight.events.length, 0);
  assert.equal(fight.larvae.size, 0);
  assert.equal(fight.floor.size, 0);
  assert.equal(boss.isRegistered(), false);
  assert.ok(actors.every(npc => !npc.isRegistered()));
  const hp = p.getHitpoints();
  ticks(10);
  assert.equal(p.getHitpoints(), hp, 'departed owner receives no old-room queued damage');
  assert.ok(enter(p), 'ordinary registered entry permits retry after escape');
});

test('native paid ammunition lands in the player arena and delayed drops cannot survive a destroyed room', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  ranged(p);
  const method = core.CombatFactory.getMethod(p);
  assert.equal(core.CombatFactory.canAttackPermission(p, session.boss, false, method), core.CanAttackResponse.CAN_ATTACK);
  assert.equal(core.CombatRange.canReach(p, method, session.boss), true);
  const bossLocation = session.boss.getLocation().clone();
  const prior = new Set(core.World.getItems());
  // Finite RNG control makes one ammo-loss roll land rather than break. Real ammo/reach/actors are verified above.
  const random = t.mock.method(core.Misc, 'getRandom', maximum => maximum === 99 ? 50 : Math.floor(maximum / 2));
  input(p, () => attack(p, session.boss));
  ticks(4);
  random.mock.restore();
  const drops = core.World.getItems().filter(item => !prior.has(item) && item.getPrivateArea() === session.area
    && item.getItem().getId() === core.ItemIdentifiers.RUNITE_BOLTS);
  assert.ok(drops.length > 0, 'actual shot paid for and registered a native floor stack');
  assert.ok(drops.every(item => session.fight.inFloor(item.getPosition())), 'every captured bolt stack is on reachable player floor');
  assert.ok(session.boss.getLocation().equals(bossLocation), 'landing hook never mutates the target Location');
  const oldArea = session.area;
  // A second real shot is left in flight as the owner escapes.
  p.getCombat().setAttackDelay(0);
  input(p, () => attack(p, session.boss));
  input(p, () => objectInput(p, session.exit, 'Quick-escape'));
  assert.equal(oldArea.isDestroyed(), true);
  ticks(8);
  assert.equal(core.World.getItems().some(item => item.getPrivateArea() === oldArea), false,
    'normal delayed ammo cannot repopulate a destroyed room or follow the owner into their new scene');
});

test('dangerous native death leaves the grave outside, returns to Vampyrium and permits retry', t => {
  const p = player(t);
  const session = enter(p);
  const fight = session.fight;
  const grave = { player: p, tile: null, feeMultiplier: 1 };
  // Direct query verifies the registered death policy; actual native death dispatch follows.
  PM.emitCustomEvent('gravestones:grave-location', grave);
  assert.deepEqual(grave.tile, { x: Common.data.outside[0], y: Common.data.outside[1], z: 0 });
  assert.equal(grave.feeMultiplier, 0.25);
  p.setHitpoints(0);
  until(() => Instance.sessionOf(p) === null, 20, 'native player death reaches the registered recovery handler');
  assert.ok(p.getLocation().equals(Common.loc(Common.data.respawn)), 'player respawns beside the Vampyrium return portal');
  assert.equal(session.area.isDestroyed(), true);
  assert.equal(fight.stopped, true);
  assert.equal(fight.events.length, 0);
  assert.equal(fight.floor.size, 0);
  assert.equal(fight.larvae.size, 0);
  until(() => !p.isDying && p.getHitpoints() > 0, 5, 'native death restoration finishes');
  p.moveTo(Common.loc(Common.data.outside));
  assert.ok(enter(p), 'quest-complete owner may retry after dangerous death');
});


test('native Cave menu input walks to the eastern recovery prop and escapes', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  // Supplied standing two columns from the cave; the final approach and operation are native.
  p.moveTo(session.tile([2917, 8034, 0]));
  p.setNeedsPlacement(false);
  const cave = session.exit;
  const at = cave.getLocation();
  const mask = core.ObjectDefinition.forId(cave.getId()).getBlockingMask() & 15;
  const rotation = cave.getFace();
  const rotated = ((mask << rotation) | (mask >> (4 - rotation))) & 15;
  assert.equal(rotated & 8, 0, 'cache side-access mask permits the west arena approach');
  const old = p.getLocation().clone();
  input(p, () => new ObjectActionPacketListener().executeAction(p, cave.getId(), at.getX(), at.getY(), 2, 'Quick-escape'));
  until(() => Instance.sessionOf(p) === null, 6, 'actual ordinary object route reaches and operates the cave');
  assert.equal(session.area.isDestroyed(), true);
  assert.ok(p.getLocation().equals(Common.loc(Common.data.outside)));
  console.log(JSON.stringify({ event: 'maggot-native-cave-route', sourceStanding: [2917, 8034],
    cave: Common.data.exit, leftSuppliedTile: !p.getLocation().equals(old), policyPlacement: true }));
  assert.ok(enter(p), 'ordinary registered entrance permits retry after native Cave escape');
});

test('poisonous-bile walking contact removes45seconds from a nonboundary dose without moving the status pulse', t => {
  const p = player(t);
  const session = enter(p);
  const clock = p.getCombat().getPoisonClock();
  clock.restore({ counter: 10, ticksUntilPulse: 20 }); // supplied dose checkpoint
  const destination = session.tile([2912, 8036, 0]);
  session.fight.placeFloor(destination, Fight.BILE_POISON);
  input(p, () => p.getMovementQueue().addFirstStep(destination));
  assert.ok(p.getLocation().equals(destination));
  assert.equal(session.fight.floor.has(session.fight.key(destination)), false);
  assert.equal(clock.snapshot().ticksUntilPulse, 19, 'only the one elapsed native tick changed the shared phase');
  assert.equal(clock.secondsRemaining(), 129, '173.4remainingseconds minus45, displayed rounded up');
});

function ordinaryRoom(t, p) {
  const room = new core.TemplatedInstanceArea(5, 5);
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
    room.setChunk(0, x, y, { sourceChunkX: 400 + x, sourceChunkY: 400 + y, sourcePlane: 0, rotation: 0 });
  }
  room.enter(p);
  p.moveTo(room.tile(22, 18, 0));
  p.setNeedsPlacement(false);
  const at = room.tile(24, 18, 0);
  const npc = PM.spawnNpc({ id: core.NpcIdentifiers.SAND_CRAB, x: at.getX(), y: at.getY(), z: 0, owner: p, wanderRadius: 0 });
  assert.ok(npc?.isRegistered());
  npc.setScriptedMovement(true);
  npc.setMultiCombat(true);
  npc.setNeedsPlacement(false);
  room.add(npc);
  t.after(() => { if (p.getPrivateArea() === room) room.leave(p, false); room.destroy(); PM.removeNpc(npc); });
  return { room, npc };
}

test('unrelated ordinary shots keep their target snapshot and original surviving private scene after the owner leaves', t => {
  const p = player(t);
  const keeper = player(t);
  const { room, npc } = ordinaryRoom(t, p);
  room.enter(keeper);
  keeper.moveTo(room.tile(21, 18, 0));
  invulnerable(p);
  ranged(p);
  const method = core.CombatFactory.getMethod(p);
  assert.equal(core.CombatFactory.canAttackPermission(p, npc, false, method), core.CanAttackResponse.CAN_ATTACK);
  assert.equal(core.CombatRange.canReach(p, method, npc), true);
  const targetAtShot = npc.getLocation().clone();
  const prior = new Set(core.World.getItems());
  const random = t.mock.method(core.Misc, 'getRandom', maximum => maximum === 99 ? 50 : Math.floor(maximum / 2));
  input(p, () => attack(p, npc));
  p.getCombat().reset();
  // Mutate the real target's Location after launch to expose a retained reference alias.
  npc.getLocation().add(1, 0);
  assert.ok(!npc.getLocation().equals(targetAtShot));
  p.moveTo(Common.loc(Common.data.outside));
  room.leave(p, false);
  assert.equal(room.isDestroyed(), false, 'second real member keeps the original private scene alive');
  assert.equal(p.getPrivateArea(), null);
  ticks(4);
  random.mock.restore();
  const drops = core.World.getItems().filter(item => !prior.has(item) && !item.isPendingRemoval()
    && item.getItem().getId() === core.ItemIdentifiers.RUNITE_BOLTS);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].getPrivateArea(), room, 'landing belongs to the original surviving scene');
  assert.ok(drops[0].getPosition().equals(targetAtShot), 'unrelated target retains its launch snapshot, with no boss redirect');
  room.leave(keeper, false);
  assert.equal(room.isDestroyed(), true);
});

test('the existing Dizana quiver decrement handler retains one payment and its own delayed scheduling', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  ranged(p);
  p.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(core.ItemIdentifiers.DIZANAS_QUIVER, 1));
  // Incompatible worn arrows force the native crossbow to use the actual registered quiver source.
  p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(core.ItemIdentifiers.RUNE_ARROW, 500));
  p.setAttribute('dizanas-quiver', { id: core.ItemIdentifiers.RUNITE_BOLTS, amount: 100 });
  core.BonusManager.update(p);
  const original = PM.decrementRangedAmmo;
  const calls = [];
  t.mock.method(PM, 'decrementRangedAmmo', function(who, position, amount, delay) {
    const handled = original.call(PM, who, position, amount, delay);
    if (who === p) calls.push({ handled, position: position.clone(), amount, delay });
    return handled;
  });
  const random = t.mock.method(core.Misc, 'getRandom', maximum => maximum === 99 ? 50 : Math.floor(maximum / 2));
  const prior = new Set(core.World.getItems());
  input(p, () => attack(p, session.boss));
  p.getCombat().reset();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].handled, true, 'the real installed quiver handler consumed the decrement route');
  assert.equal(calls[0].amount, 1);
  assert.ok(calls[0].delay > 0);
  assert.equal(p.getAttribute('dizanas-quiver').amount, 100, 'current custom handler keeps its existing landing-time payment');
  assert.equal(p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount(), 500, 'Factory fallback did not touch worn arrows');
  ticks(calls[0].delay);
  random.mock.restore();
  assert.equal(p.getAttribute('dizanas-quiver').amount, 99, 'one cost, not custom plus Factory cost');
  assert.equal(calls.length, 1);
  const drops = core.World.getItems().filter(item => !prior.has(item) && !item.isPendingRemoval()
    && item.getPrivateArea() === session.area && item.getItem().getId() === core.ItemIdentifiers.RUNITE_BOLTS);
  assert.equal(drops.reduce((sum, item) => sum + item.getItem().getAmount(), 0), 1);
  assert.ok(drops.every(item => session.fight.inFloor(item.getPosition())), 'custom handler receives the location snapshot too');
  // Its historical late-scene semantics are outside the Factory fallback guard and are not claimed fixed here.
});

test('real twin crush attacks boost only the first splat and first defence roll; other actors remain ordinary', t => {
  const p = player(t);
  const q = player(t);
  const session = enter(p);
  const other = enter(q);
  invulnerable(p); invulnerable(q);
  session.boss.setHitpoints(900); other.boss.setHitpoints(900); // supplied threshold checkpoints
  until(() => session.fight.phase === 'melee' && other.fight.phase === 'melee', 75, 'both independent native rotations reach melee');
  for (const who of [p, q]) equip(who, core.ItemIdentifiers.TORAGS_HAMMERS, core.WeaponInterfaces.WARHAMMER);
  const fight = session.fight;
  assert.equal(core.CombatFactory.getMethod(p).type(), core.CombatType.MELEE);
  assert.equal(p.getFightType().getBonusType(), 2, 'real crush style');
  const originalAccuracy = core.AccuracyFormulasDpsCalc.rollAccuracy;
  const forced = t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', function(attacker, target, ...args) {
    const actual = originalAccuracy.call(this, attacker, target, ...args);
    // Retain the real defence-roll producer; select two successful outcomes to exercise nonzero first/second splats.
    return (attacker === p && target === session.boss) || (attacker === q && target === other.boss) ? true : actual;
  });
  const random = t.mock.method(Math, 'random', () => 0.5);
  const startDamage = finalDamage.length;
  const startDefence = defenceRolls.length;
  let clicked = false, otherClicked = false;
  assert.equal(core.CombatFactory.validTarget(q, other.boss), true, 'other actor has a live valid own-session target');
  assert.equal(core.CombatFactory.canAttackPermission(q, other.boss, false, core.CombatFactory.getMethod(q)),
    core.CanAttackResponse.CAN_ATTACK);
  assert.equal(session.area.canAttack(q, session.boss), false, 'owner area independently refuses another actor');
  assert.equal(core.CombatFactory.canAttackPermission(q, session.boss, false, core.CombatFactory.getMethod(q)),
    core.CanAttackResponse.INVALID_TARGET, 'native cross-private-scene validation refuses the foreign target before area policy');
  p.getCombat().setAttackDelay(30);
  p.getSession().setTurnPacketProcessor(() => {
    if (clicked || !fight.head || fight.slamCycle !== core.World.getProcessCycle()) return;
    clicked = true;
    attack(p, session.boss);
  });
  // Each actor supplies input in its own native turn; rotating PID must not decide whether
  // the negative control commits before its damage/accuracy observers are inspected.
  q.getSession().setTurnPacketProcessor(() => {
    if (otherClicked || !fight.head || fight.slamCycle !== core.World.getProcessCycle()) return;
    otherClicked = true;
    // Held-target setup does not manufacture a fresh NPC menu click stamp.
    q.getCombat().setAttackDelay(0);
    q.getCombat().attack(other.boss);
  });
  try { until(() => clicked && otherClicked, 20, 'extension tick receives each actor input on its own native turn'); }
  finally {
    p.getSession().setTurnPacketProcessor(() => {});
    q.getSession().setTurnPacketProcessor(() => {});
    forced.mock.restore(); random.mock.restore();
  }
  const parts = finalDamage.slice(startDamage).filter(row => row.attacker === p);
  assert.equal(parts.length, 2, 'installed ordinary twin-weapon method rolled both real splats');
  assert.ok(parts.every(row => row.before > 0), 'selected successful native damage rolls are nonzero');
  assert.equal(parts[0].after, Math.floor(parts[0].before * 1.5));
  assert.equal(parts[1].after, parts[1].before, 'second splat gets no bonus');
  const rolls = defenceRolls.slice(startDefence).filter(row => row.attacker === p);
  assert.equal(rolls.length, 2);
  assert.equal(rolls[0].after, rolls[0].before * 0.15);
  assert.equal(rolls[1].after, rolls[1].before, 'second independent crush accuracy roll is ordinary');
  const negative = finalDamage.slice(startDamage).filter(row => row.attacker === q);
  assert.equal(negative.length, 2);
  assert.ok(negative.every(row => !row.punish && row.after === row.before));
});


test('native object lookup rejects another session cave and a retracted head', t => {
  const p = player(t), q = player(t);
  const session = enter(p), other = enter(q);
  invulnerable(p); invulnerable(q);
  const listener = new ObjectActionPacketListener();
  const foreign = other.exit.getLocation();
  input(p, () => listener.executeAction(p, other.exit.getId(), foreign.getX(), foreign.getY(), 2, 'Quick-escape'));
  ticks(2);
  assert.equal(Instance.sessionOf(p), session, 'foreign private object cannot operate owner recovery');
  assert.equal(Instance.sessionOf(q), other);
  session.boss.setHitpoints(900); // supplied threshold checkpoint
  until(() => session.fight.phase === 'melee' && session.fight.head, 90, 'natural rotation exposes a real head');
  const head = session.fight.head;
  const at = head.getLocation().clone();
  until(() => session.fight.head !== head, 3, 'native next turn retracts the one-tick head');
  p.getCombat().reset();
  const stamp = session.fight.clickCycle;
  const spent = session.fight.punishSpent;
  input(p, () => listener.executeAction(p, head.getId(), at.getX(), at.getY(), 1, 'Strike'));
  assert.equal(session.fight.clickCycle, stamp, 'removed object never reaches the Strike handler');
  assert.equal(session.fight.punishSpent, spent);
  assert.equal(p.getCombat().getTarget(), null);
});

test('native incoming-hit auto-retaliation and a held target never mint a fresh extension punish', t => {
  const p = player(t);
  const session = enter(p);
  invulnerable(p);
  ranged(p); // the opening phase permits ranged, so native permission can retain the retaliation target
  p.setAutoRetaliate(true);
  p.getCombat().reset();
  const random = t.mock.method(Math, 'random', () => 0.99);
  // Supplied incoming blow, but PendingHit landing and CombatFactory retaliation scheduling are native.
  session.fight.blow('control', 'melee', null, 1);
  until(() => p.getCombat().getTarget() === session.boss, 5, 'actual incoming hit schedules auto-retaliation');
  random.mock.restore();
  assert.equal(session.fight.clickCycle, -1, 'retaliation was never an NPC menu click');
  session.boss.setHitpoints(900); // supplied phase checkpoint
  until(() => session.fight.phase === 'melee', 75, 'normal rotation reaches melee');
  equip(p, core.ItemIdentifiers.ELDER_MAUL, core.WeaponInterfaces.MAUL);
  p.getCombat().setAttackDelay(30);
  const spent = session.fight.punishSpent;
  until(() => session.fight.head !== null, 20, 'native extension arrives while the target is held');
  assert.equal(p.getCombat().getTarget(), session.boss);
  assert.equal(session.fight.punishSpent, spent, 'retaliation target cannot cross the weapon deadline as a fresh click');
  assert.ok(p.getCombat().getAttackDelay() > 0);
  assert.equal(session.fight.clickCycle, -1);
});

test('native encounter death claims deferred generic loot after session markers clear, while another same-ID NPC still drops', t => {
  const p = player(t), session = enter(p), boss = session.boss;
  invulnerable(p);
  ranged(p);
  const claims = [], generated = [], deaths = [];
  const beforeCount = { player: p, monster: 'Maggot King', total: null };
  PM.emitCustomEvent('combat-achievements:count', beforeCount);
  assert.equal(typeof beforeCount.total, 'number', 'registered native achievement counter owns this boss');
  const observer = PM.createApi('MaggotDeferredLootControl');
  observer.onCustomEvent('npc-drops:claim', event => {
    if (event.killer === p) claims.push({ npc: event.npc, handled: event.handled, sessionMarker: event.npc.__maggotKingSession });
  });
  observer.onCustomEvent('npc-drops:generated', event => {
    if (event.player === p) generated.push({ npc: event.npc, drops: event.drops });
  });
  observer.onNpcDeath(event => { if (event.killer === p) deaths.push(event); });
  const random = t.mock.method(Math, 'random', () => 0); // select the existing elite tertiary on an unclaimed generic death
  try {
    // Supplied lethal damage; PendingHit, native queue, killer attribution and NPCDeathTask are real.
    core.CombatFactory.addPendingHit(new core.PendingHit(p, boss, core.CombatFactory.RANGED_COMBAT,
      { damage: 1500, delay: 0, rollAccuracy: false, experience: false }));
    until(() => deaths.some(event => event.npc === boss), 25, 'actual native boss death completes all observers');
    assert.equal(boss.getHitpoints(), 0);
    assert.equal(boss.getMaxHitpoints(), 1500);
    assert.equal(boss.__maggotKingSession, null, 'the controller marker was cleared before the late drop observer');
    assert.equal(p.getAttribute('maggot-king:kills'), 1, 'native killer/recovery credit is preserved');
    const afterCount = { player: p, monster: 'Maggot King', total: null };
    PM.emitCustomEvent('combat-achievements:count', afterCount);
    assert.equal(afterCount.total, beforeCount.total + 1, 'native death still reaches the achievement counter exactly once');
    const claim = claims.find(event => event.npc === boss);
    assert.ok(claim);
    assert.equal(claim.handled, true);
    assert.equal(claim.sessionMarker, null);
    assert.equal(generated.some(event => event.npc === boss), false, 'generic roller/generated path was not entered');
    assert.equal(core.World.getItems().some(item => item.getPrivateArea() === session.area), false,
      'the deferred reward slice creates no inaccessible or reachable ground loot');
    until(() => session.boss && session.boss !== boss, 150, 'ordinary same-room combat retry remains available');
    assert.equal(session.boss.getHitpoints(), 1500);

    const at = p.getLocation().clone();
    const other = PM.spawnNpc({ id: core.NpcIdentifiers.MAGGOT_KING, x: at.getX(), y: at.getY(), z: at.getZ(),
      owner: p, wanderRadius: 0 });
    assert.ok(other?.isRegistered());
    other.__skipDefaultRespawn = true; // keep this unrelated drop control from scheduling a separate generic respawn
    session.area.add(other);
    assert.equal(other.__maggotKingSession, undefined, 'the unrelated same-ID actor is not a session boss');
    ticks(1); // complete native placement before the supplied hit
    core.CombatFactory.addPendingHit(new core.PendingHit(p, other, core.CombatFactory.RANGED_COMBAT,
      { damage: 1500, delay: 0, rollAccuracy: false, experience: false }));
    until(() => deaths.some(event => event.npc === other), 25, 'unrelated native death completes');
    assert.equal(claims.find(event => event.npc === other)?.handled, false, 'same NPC id alone does not suppress drops');
    assert.ok(generated.some(event => event.npc === other && event.drops.length > 0), 'actual generic tertiary roll still executes');
    assert.ok(core.World.getItems().some(item => item.getPrivateArea() === session.area && !item.isPendingRemoval()),
      'unrelated generic death still places real loot');
    assert.equal(p.getAttribute('maggot-king:kills'), 1, 'unrelated same-ID death does not count as this session encounter');

    session.area.leave(p, false);
    const late = { killer: p, npc: boss, npcId: core.NpcIdentifiers.MAGGOT_KING, damagers: [p], handled: false };
    PM.emitCustomEvent('npc-drops:claim', late);
    assert.equal(late.handled, true, 'original actor identity survives complete session closure too');
  } finally { random.mock.restore(); }
});

test('native poisonous-bile walking exhaustion delivers one end line through the real Effect', t => {
  const p = player(t), session = enter(p), clock = p.getCombat().getPoisonClock(), lines = [];
  session.fight.nextAttack = 1000; // bounded isolation of concurrent spit/affliction, not a controller bypass
  clock.restore({ counter: 2, ticksUntilPulse: 20 }); // supplied short-dose checkpoint from the review
  t.mock.method(p, 'sendMessage', line => lines.push(line));
  const destination = session.tile([2912, 8036, 0]);
  session.fight.placeFloor(destination, Fight.BILE_POISON);
  input(p, () => p.getMovementQueue().addFirstStep(destination));
  assert.ok(p.getLocation().equals(destination));
  assert.equal(session.fight.floor.has(session.fight.key(destination)), false);
  assert.equal(clock.getCounter(), 0, 'real area floor processing exhausted the dose synchronously');
  ticks(2);
  const ends = () => lines.filter(line => line === '<col=7f007f>Your poison resistance has worn off.</col>');
  assert.equal(ends().length, 1);
  ticks(35);
  assert.equal(ends().length, 1, 'later native task turns do not duplicate expiry');
});

// Existing eggs are supplied. These cases do not exercise the unresolved corpse acquisition roll.
const EGG_POP_CASES = [
  ['base', 'MAGGOT_EGG', 3000], ['sickly', 'MAGGOT_EGG_3', 2500],
  ['warm', 'MAGGOT_EGG_5', 1250], ['pulsating', 'MAGGOT_EGG_7', 500],
  ['wriggling', 'MAGGOT_EGG_9', 10], ['writhing', 'MAGGOT_EGG_11', 2],
];

function eggPlayer(t) {
  const p = player(t);
  // Supplied clear overworld standing: the shared entry helper starts on the solid trees.
  const origin = p.getLocation(), candidates = [];
  for (let radius = 1; radius <= 4; radius++) {
    for (const [dx, dy] of [[-radius, 0], [radius, 0], [0, -radius], [0, radius]]) candidates.push(origin.transform(dx, dy, 0));
  }
  const standing = candidates.find(at => !core.RegionManager.blocked(at, null)
    && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => !core.RegionManager.blocked(at.transform(dx, dy, 0), null)));
  assert.ok(standing, 'loaded native map supplies clear owner and follower standing');
  p.moveTo(standing);
  core.World.process();
  assert.equal(p.isNeedsPlacement(), false);
  assert.equal(core.RegionManager.blocked(p.getLocation(), null), false);
  return p;
}

function popEgg(p, id, slot) {
  const action = core.CacheDefinitions.getItem(id).inventoryActions.findIndex(option => option === 'Pop');
  assert.equal(action, 0, 'current native cache exposes Pop as the first inventory action');
  let handled;
  input(p, () => { handled = ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, id, slot, action + 1); });
  return handled;
}

function releaseFixturePet(p) {
  PM.emitCustomEvent('pets:release', { player: p, npc: p.getAttribute('pets:current') });
  core.World.process();
}

for (const [kind, key, denominator] of EGG_POP_CASES) {
  test(`native ${kind} egg Pop consumes one unit on each side of the published 1/${denominator} threshold`, t => {
    const p = eggPlayer(t);
    const id = core.ItemIdentifiers[key], petId = core.ItemIdentifiers.MAGGOT_MARQUESS;
    const inventory = p.getInventory();
    inventory.setItem(0, new core.Item(id, 2)); // supplied stack, not a corpse reward
    const random = t.mock.method(Math, 'random', () => (1 + 1e-8) / denominator);
    try {
      assert.equal(popEgg(p, id, 0), true);
      assert.equal(inventory.getAmount(id), 1, 'one failed Pop consumes exactly one egg');
      const before = { player: p, itemId: petId, owns: false };
      PM.emitCustomEvent('pets:owns', before);
      assert.equal(before.owns, false, 'a roll just above the published threshold gives no pet');
      random.mock.restore();
      const success = t.mock.method(Math, 'random', () => (1 - 1e-8) / denominator);
      try { assert.equal(popEgg(p, id, 0), true); }
      finally { success.mock.restore(); }
      assert.equal(inventory.getAmount(id), 0, 'the successful Pop consumes the last egg');
      core.World.process();
      const after = { player: p, itemId: petId, owns: false };
      PM.emitCustomEvent('pets:owns', after);
      assert.equal(after.owns, true, 'registered native pet consumer records ownership');
      const current = { player: p, pet: null };
      PM.emitCustomEvent('pets:current', current);
      assert.ok(current.pet?.isRegistered(), 'native pet consumer supplies the actual follower');
      assert.equal(current.pet.getOwner(), p);
      assert.equal(current.pet.getId(), core.NpcIdentifiers.MAGGOT_MARQUESS);
      assert.ok(p.getAttribute('clog.items')?.[petId] >= 1, 'native pet consumer records collection-log ownership');
      assert.equal(inventory.getAmount(petId), 0, 'the follower is not also delivered as an inventory item');
      let stale;
      input(p, () => { stale = ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, id, 0, 1); });
      assert.equal(stale, false, 'repeating the consumed last-unit click cannot roll another award');
      assert.equal(p.getAttribute('pets:current'), current.pet);
    } finally {
      random.mock.restore();
      releaseFixturePet(p);
    }
  });
}

test('native egg Pop refuses stale slots, another container and placeholder copies without consuming an egg', t => {
  const p = eggPlayer(t), inventory = p.getInventory(), id = core.ItemIdentifiers.MAGGOT_EGG;
  inventory.setItem(0, new core.Item(id, 1));
  inventory.setItem(1, new core.Item(core.ItemIdentifiers.BRONZE_DAGGER, 1));
  let handled;
  input(p, () => { handled = ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, id, 1, 1); });
  assert.equal(handled, false);
  assert.equal(inventory.getAmount(id), 1, 'wrong slot does not consume the actual stack');
  inventory.setItem(0, new core.Item(core.ItemIdentifiers.BRONZE_DAGGER, 1));
  input(p, () => { handled = ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, id, 0, 1); });
  assert.equal(handled, false);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BRONZE_DAGGER), 2, 'stale item ID does not consume its replacement');
  const placeholder = core.ItemIdentifiers.MAGGOT_EGG_2;
  inventory.setItem(0, new core.Item(placeholder, 1));
  input(p, () => ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, placeholder, 0, 1, 'Pop'));
  assert.equal(inventory.getAmount(placeholder), 1, 'a display-name copy cannot stand in for a real egg subtype');
  const slot = core.Equipment.AMMUNITION_SLOT;
  p.getEquipment().setItem(slot, new core.Item(id, 1)); // malformed equipment-context negative, not a wearable egg
  input(p, () => { handled = ItemActionPacketListener.handleAction(p, core.Equipment.INVENTORY_INTERFACE_ID, id, slot, 1, 'Pop'); });
  assert.equal(handled, false);
  assert.equal(p.getEquipment().get(slot).getAmount(), 1);
});

test('native pet duplicate refusal consumes a successful egg roll without refund or duplicate delivery', t => {
  const p = eggPlayer(t), id = core.ItemIdentifiers.MAGGOT_EGG_11, petId = core.ItemIdentifiers.MAGGOT_MARQUESS;
  const random = t.mock.method(Math, 'random', () => 0);
  const awards = [], emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => {
    const result = emit(name, event);
    if (name === 'pets:award' && event.player === p && event.source === 'Maggot egg') awards.push(event.awarded);
    return result;
  });
  p.getInventory().setItem(0, new core.Item(id, 2));
  try {
    assert.equal(popEgg(p, id, 0), true);
    core.World.process();
    const first = p.getAttribute('pets:current');
    assert.ok(first?.isRegistered());
    const owned = [...p.getAttribute('pets.owned')];
    assert.equal(popEgg(p, id, 0), true);
    core.World.process();
    assert.equal(p.getInventory().getAmount(id), 0, 'duplicate native award refusal does not refund or reopen the egg roll');
    assert.equal(p.getAttribute('pets:current'), first);
    assert.deepEqual(p.getAttribute('pets.owned'), owned);
    assert.equal(p.getInventory().getAmount(petId), 0);
    assert.deepEqual(awards, [true, false], 'the real native duplicate refusal does not reopen either consumed roll');
  } finally {
    random.mock.restore();
    releaseFixturePet(p);
  }
});

for (const eggCount of [1, 2]) {
  test(`egg Pop with another native follower and a full pack preserves the ${eggCount === 1 ? 'freed-slot pet item' : 'insured full-pack recovery'} outcome`, t => {
    const p = eggPlayer(t), inventory = p.getInventory(), id = core.ItemIdentifiers.MAGGOT_EGG_11;
    const petId = core.ItemIdentifiers.MAGGOT_MARQUESS;
    const existing = { player: p, itemId: core.ItemIdentifiers.PET_CHAOS_ELEMENTAL, source: 'supplied follower setup', awarded: false };
    PM.emitCustomEvent('pets:award', existing); // native award, not a fabricated follower flag
    assert.equal(existing.awarded, true);
    core.World.process();
    const follower = p.getAttribute('pets:current');
    assert.ok(follower?.isRegistered());
    assert.equal(follower.getOwner(), p);
    inventory.setItem(0, new core.Item(id, eggCount));
    for (let slot = 1; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(core.ItemIdentifiers.BRONZE_DAGGER, 1));
    assert.equal(inventory.isFull(), true);
    const messages = [], send = p.sendMessage.bind(p);
    t.mock.method(p, 'sendMessage', (...args) => { messages.push(args[0]); return send(...args); });
    const random = t.mock.method(Math, 'random', () => 0); // selected successful published egg outcome
    try {
      assert.equal(popEgg(p, id, 0), true);
      core.World.process();
      assert.equal(inventory.getAmount(id), eggCount - 1);
      assert.equal(p.getAttribute('pets:current'), follower, 'the existing native follower is not replaced');
      const owns = { player: p, itemId: petId, owns: false };
      PM.emitCustomEvent('pets:owns', owns);
      assert.equal(owns.owns, true, 'native ownership/insurance records the new pet even if delivery has no slot');
      assert.ok(p.getAttribute('clog.items')?.[petId] >= 1);
      assert.equal(inventory.getAmount(petId), eggCount === 1 ? 1 : 0);
      assert.equal(core.World.getItems().some(item => item.getOwner() === p.getUsername() && item.getItem().getId() === petId), false,
        'the egg handler does not bypass native pet delivery by spawning an extra ground copy');
      if (eggCount === 2) assert.ok(messages.some(message => message.includes('Probita can help.')), 'native full-pack recovery feedback is retained');
      else assert.ok(messages.includes('You feel something weird sneaking into your backpack.'));
    } finally {
      random.mock.restore();
      releaseFixturePet(p);
    }
  });
}


// IF_BUTTON2 is widget op2; native cache script7779 resolves it to item action1 (Pop).
function nativeBackpackPopFrame(id, slot) {
  const frame = Buffer.alloc(9);
  frame[0] = ClientPacketId.IF_BUTTON2;
  frame.writeInt32BE(MAIN_INVENTORY_WIDGET_UID, 1);
  frame.writeUInt16BE(slot, 5);
  frame.writeUInt16BE(id, 7);
  return frame;
}

for (const [kind, key, denominator] of EGG_POP_CASES) {
  test(`decoded native backpack ${kind} egg Pop crosses the published threshold through the real turn dispatcher`, async t => {
    const p = eggPlayer(t), inventory = p.getInventory(), id = core.ItemIdentifiers[key];
    const petId = core.ItemIdentifiers.MAGGOT_MARQUESS;
    const connection = new ClientConnection(p.getSession().getChannel());
    connection.player = p;
    const seen = [], emit = PM.emitItemAction.bind(PM);
    t.mock.method(PM, 'emitItemAction', event => {
      if (event.player === p) seen.push({ interfaceId: event.interfaceId, slot: event.slot,
        itemId: event.itemId, clickType: event.clickType, option: event.option });
      return emit(event);
    });
    inventory.setItem(0, new core.Item(id, 2)); // supplied eggs, not a corpse reward
    const currentAction = core.CacheDefinitions.getItem(id).inventoryActions[0];
    assert.equal(currentAction, 'Pop');
    const packets = decodeClientPackets(nativeBackpackPopFrame(id, 0));
    assert.deepEqual(packets, [{ type: 'widget_action', widgetId: MAIN_INVENTORY_WIDGET_UID,
      groupId: 149, childId: 0, buttonNum: 2, slot: 0, itemId: id }]);
    p.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
    let random = t.mock.method(Math, 'random', () => (1 + 1e-8) / denominator);
    try {
      await connection.dispatch(packets);
      assert.equal(inventory.getAmount(id), 2, 'decoded click waits for the real player input turn');
      core.World.process();
      assert.equal(inventory.getAmount(id), 1, 'ordinary native backpack failure consumes exactly one');
      const absent = { player: p, itemId: petId, owns: false };
      PM.emitCustomEvent('pets:owns', absent);
      assert.equal(absent.owns, false);
      random.mock.restore();
      random = t.mock.method(Math, 'random', () => (1 - 1e-8) / denominator);
      await connection.dispatch(decodeClientPackets(nativeBackpackPopFrame(id, 0)));
      core.World.process();
      assert.equal(inventory.getAmount(id), 0, 'ordinary native backpack success consumes exactly one');
      const owned = { player: p, itemId: petId, owns: false };
      PM.emitCustomEvent('pets:owns', owned);
      assert.equal(owned.owns, true);
      const pet = p.getAttribute('pets:current');
      assert.ok(pet?.isRegistered());
      assert.equal(pet.getOwner(), p);
      assert.equal(pet.getId(), core.NpcIdentifiers.MAGGOT_MARQUESS);
      assert.ok(p.getAttribute('clog.items')?.[petId] >= 1);
      assert.equal(inventory.getAmount(petId), 0);
      assert.deepEqual(seen, Array.from({ length: 2 }, () => ({ interfaceId: MAIN_INVENTORY_WIDGET_UID,
        slot: 0, itemId: id, clickType: 1, option: 'Pop' })), 'actual widget UID/action reaches the registered handler');
      await connection.dispatch(decodeClientPackets(nativeBackpackPopFrame(id, 0)));
      core.World.process();
      assert.equal(seen.length, 2, 'stale native last-unit repeat never reaches the item handler');
      assert.equal(p.getAttribute('pets:current'), pet);
    } finally {
      random.mock.restore();
      p.getSession().setTurnPacketProcessor(() => {});
      releaseFixturePet(p);
    }
  });
}

function nativeBurnState(target) {
  const query = { target, remaining: null, stacks: null };
  PM.emitCustomEvent('combat:burn-remaining', query);
  assert.equal(typeof query.remaining, 'number', 'registered shared burn consumer answers');
  assert.equal(typeof query.stacks, 'number');
  return query;
}

function fireFixture(t) {
  const p = player(t), session = enter(p);
  invulnerable(p);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevels(core.Skill.MAGIC, 99, false);
  p.getCombat().reset();
  session.fight.nextAttack = 1000; // isolate the supplied cast/burn probe from competing boss attacks
  const connection = new ClientConnection(p.getSession().getChannel());
  connection.player = p;
  p.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
  const resolved = [], emit = PM.emitCombatHitResolved.bind(PM);
  t.mock.method(PM, 'emitCombatHitResolved', event => {
    if (event.attacker === p) resolved.push(event);
    return emit(event);
  });
  t.after(() => p.getSession().setTurnPacketProcessor(() => {}));
  return { p, session, boss: session.boss, connection, resolved };
}

async function nativeFireCast(f, spell, accuracyScale = 1000000) {
  const key = Object.keys(core.CombatSpells).find(name => core.CombatSpells[name] === spell);
  assert.ok(key, 'native spell identity has its canonical definition');
  const name = key.split('_').map(word => word[0] + word.slice(1).toLowerCase()).join(' ');
  const widget = core.CacheDefinitions.getSpellByName(name);
  assert.ok(widget, 'active cache resolves the actual selected spell widget');
  const required = spell.itemsRequired(f.p);
  for (const rune of required) f.p.getInventory().add(rune.clone(), false); // supplied runes
  const before = required.map(rune => f.p.getInventory().getAmount(rune.getId()));
  const frame = Buffer.alloc(12);
  frame[0] = ClientPacketId.OPNPC_T;
  frame.writeUInt16BE(f.boss.getIndex(), 1);
  frame.writeUInt32LE(widget.widgetId, 3);
  frame.writeUInt16BE(65535, 7);
  frame[9] = (65535 + 128) & 255; frame[10] = 65535 >>> 8; frame[11] = 128;
  const packets = decodeClientPackets(frame);
  assert.deepEqual(packets, [{ type: 'spell_on_npc', targetIndex: f.boss.getIndex(),
    spellWidget: widget.widgetId, spellChild: 65535, spellItemId: 65535 }]);
  const start = f.resolved.length;
  await f.connection.dispatch(packets);
  assert.deepEqual(required.map(rune => f.p.getInventory().getAmount(rune.getId())), before,
    'decoded cast waits for the actual input turn before rune payment');
  for (let turn = 0; turn < 18 && f.resolved.length === start; turn++) {
    // Focused native accuracy setup, not a replacement PendingHit or damage/RNG oracle.
    core.AccuracyFormulasDpsCalc.withAccuracyScale(accuracyScale, () => core.World.process());
  }
  assert.equal(f.resolved.length, start + 1, 'one real queued spell reaches the native impact event');
  const hit = f.resolved.at(-1).hit;
  assert.equal(hit.getSpell(), spell, 'the launched spell identity survives native manual-cast reset');
  assert.equal(hit.getCombatMethod().type(), core.CombatType.MAGIC);
  assert.equal(f.p.getCombat().getCastSpell(), null, 'native hand cast clears active selection');
  for (let i = 0; i < required.length; i++) {
    assert.equal(f.p.getInventory().getAmount(required[i].getId()), before[i] - required[i].getAmount(), 'one rune cost');
  }
  return hit;
}

for (const key of ['FIRE_STRIKE', 'FIRE_BOLT', 'FIRE_BLAST', 'FIRE_WAVE', 'FIRE_SURGE']) {
  test(`decoded native ${key} impact adds a shared five-damage burn after manual-cast selection clears`, async t => {
    const f = fireFixture(t), random = t.mock.method(Math, 'random', () => 0.5);
    try {
      assert.equal(nativeBurnState(f.boss).stacks, 0);
      const hit = await nativeFireCast(f, core.CombatSpells[key]);
      assert.equal(hit.isAccurate(), true, 'supplied accuracy/RNG passes the real native roll');
      assert.ok(hit.getTotalDamage() > 0);
      assert.deepEqual(nativeBurnState(f.boss), { target: f.boss, remaining: 5, stacks: 1 });
      const xp = f.p.getSkillManager().getExperience(core.Skill.MAGIC);
      let hp = f.boss.getHitpoints();
      const pulses = [];
      for (let i = 0; i < 26; i++) {
        ticks(1);
        const after = f.boss.getHitpoints();
        if (after < hp) pulses.push({ cycle: core.World.getProcessCycle(), damage: hp - after });
        hp = after;
      }
      assert.equal(pulses.length, 5);
      assert.deepEqual(pulses.map(pulse => pulse.damage), [1, 1, 1, 1, 1]);
      assert.deepEqual(pulses.slice(1).map((pulse, i) => pulse.cycle - pulses[i].cycle), [4, 4, 4, 4]);
      assert.equal(nativeBurnState(f.boss).stacks, 0);
      assert.equal(nativeBurnState(f.boss).remaining, 0);
      assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC), xp, 'burn pulses do not award spell XP again');
      assert.equal(f.resolved.length, 1, 'status pulses do not reenter ordinary attack resolution');
      assert.equal(f.boss.getCombat().getLastDamager(), f.p, 'native burn attribution retains the owner');
    } finally { random.mock.restore(); }
  });
}

test('decoded fire splash and accurate nonfire spell do not create encounter burn stacks', async t => {
  const f = fireFixture(t), random = t.mock.method(Math, 'random', () => 0.5);
  try {
    const splash = await nativeFireCast(f, core.CombatSpells.FIRE_STRIKE, 0);
    assert.equal(splash.isAccurate(), false);
    assert.equal(nativeBurnState(f.boss).stacks, 0);
    const other = await nativeFireCast(f, core.CombatSpells.WIND_STRIKE);
    assert.equal(other.isAccurate(), true);
    assert.equal(nativeBurnState(f.boss).stacks, 0);
    ticks(24);
    assert.equal(nativeBurnState(f.boss).remaining, 0);
  } finally { random.mock.restore(); }
});

function magicRoll(f) {
  core.AccuracyFormulasDpsCalc.clearRollCache(f.boss);
  core.AccuracyFormulasDpsCalc.clearRollCache(f.p);
  return core.AccuracyFormulasDpsCalc.specialRolls(f.p, f.boss, core.CombatType.MAGIC).defence;
}

function suppliedBurn(f, damage = 5) {
  const event = { attacker: f.p, target: f.boss, damage, applied: false };
  PM.emitCustomEvent('combat:burn', event); // explicit shared-stack setup, not a second fire-input proof
  return event.applied;
}

test('native shared stack queries preserve cap, cadence, expiry and owner credit without refreshing burns', t => {
  const f = fireFixture(t);
  for (let i = 0; i < 5; i++) assert.equal(suppliedBurn(f), true);
  assert.equal(suppliedBurn(f), false, 'sixth stack is discarded');
  for (let i = 0; i < 8; i++) assert.deepEqual(nativeBurnState(f.boss), { target: f.boss, remaining: 25, stacks: 5 });
  let hp = f.boss.getHitpoints();
  const pulses = [];
  for (let i = 0; i < 26; i++) {
    ticks(1);
    nativeBurnState(f.boss); // querying every native turn must not refresh/reschedule
    const after = f.boss.getHitpoints();
    if (after < hp) pulses.push({ cycle: core.World.getProcessCycle(), damage: hp - after });
    hp = after;
  }
  assert.deepEqual(pulses.map(pulse => pulse.damage), [5, 5, 5, 5, 5]);
  assert.deepEqual(pulses.slice(1).map((pulse, i) => pulse.cycle - pulses[i].cycle), [4, 4, 4, 4]);
  assert.equal(nativeBurnState(f.boss).stacks, 0);
  assert.equal(nativeBurnState(f.boss).remaining, 0);
  assert.equal(f.boss.getCombat().getLastDamager(), f.p);
});

test('encounter magic rolls compose live stack reduction and near stance without overwriting bonus drains or screech levels', t => {
  const f = fireFixture(t), npc = f.boss;
  assert.equal(npc.getDefenceBonus(3), 0, 'the pinned native definition starts at zero, not the positive checkpoint');
  assert.equal(magicRoll(f), 209 * 64, 'the unsupplied native zero-bonus roll remains valid');
  npc.setDefenceBonusOverrides([null, null, null, 150, null]); // supplied positive bonus to exercise reduction above the disclosed floor
  assert.equal(npc.getDefenceBonus(3), 150, 'positive-bonus checkpoint uses the real NPC override');
  assert.equal(npc.getCurrentLevel(core.Skill.MAGIC), 200);
  assert.equal(magicRoll(f), 209 * 214);
  for (let i = 1; i <= 5; i++) {
    assert.equal(suppliedBurn(f), true);
    assert.equal(magicRoll(f), 209 * (150 - 20 * i + 64));
  }
  f.session.fight.phase = 'melee'; // supplied stance checkpoint, not a full rotation claim
  assert.equal(magicRoll(f), 209 * (400 - 100 + 64));
  const override = [null, null, null, 30, null]; // supplied permanent bonus-drain state; actual Ayak is separate
  npc.setDefenceBonusOverrides(override);
  assert.equal(magicRoll(f), 209 * (30 + 250 - 100 + 64));
  assert.equal(npc.getDefenceBonus(3), 30, 'roll projection does not rewrite the permanent bonus');
  f.session.fight.phase = 'ranged';
  assert.equal(magicRoll(f), 209 * 64, 'disclosed effective-bonus floor0 policy');
  f.session.fight.screech();
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), 100);
  assert.equal(npc.getCurrentLevel(core.Skill.MAGIC), 200);
  assert.equal(npc.getDefenceBonus(3), 30);
  ticks(6);
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), 200);
  assert.equal(npc.getCurrentLevel(core.Skill.MAGIC), 200);
  assert.equal(npc.getDefenceBonus(3), 30, 'screech does not restore bonus drains');
  f.session.fight.nextAttack = 1000;
  ticks(26);
  assert.equal(nativeBurnState(npc).stacks, 0);
  f.session.fight.phase = 'ranged';
  assert.equal(magicRoll(f), 209 * (30 + 64), 'expiry removes only the transient burn projection');
});

test('closing an owner encounter clears its native burns before removal and a fresh retry inherits none', t => {
  const f = fireFixture(t);
  assert.equal(suppliedBurn(f), true);
  const old = f.boss;
  assert.equal(nativeBurnState(old).stacks, 1);
  f.session.area.leave(f.p, true);
  assert.equal(nativeBurnState(old).stacks, 0);
  assert.equal(nativeBurnState(old).remaining, 0);
  assert.equal(old.isRegistered(), false);
  ticks(1); // settle the native exit placement before the next entry
  const retry = enter(f.p);
  assert.ok(retry?.boss?.isRegistered());
  assert.notEqual(retry.boss, old);
  assert.equal(nativeBurnState(retry.boss).stacks, 0);
  assert.equal(retry.boss.getHitpoints(), 1500);
});

test('real paid Soul Rend keeps its permanent magic bonus drain while encounter burns compose and expire', t => {
  const f = fireFixture(t), npc = f.boss;
  const { CHARGES_KEY } = require('../plugins/items/EyeOfAyak.plugin')._test;
  equip(f.p, core.ItemIdentifiers.EYE_OF_AYAK, core.WeaponInterfaces.STAFF);
  const staff = f.p.getEquipment().get(core.Equipment.WEAPON_SLOT);
  staff.setMetaValue(CHARGES_KEY, 100); // supplied charged weapon, not natural charging/acquisition
  core.CombatSpecial.assign(f.p);
  assert.equal(f.p.getCombatSpecial().getId(), 'eye_of_ayak');
  f.p.setSpecialPercentage(100);
  f.p.setSpecialActivated(true);
  npc.setDefenceBonusOverrides([null, 7, null, 150, null]); // supplied positive starting bonus, not this definition's native zero
  assert.equal(npc.getDefenceBonus(3), 150);
  assert.equal(suppliedBurn(f), true); // supplied live shared stack; fire producer is proved separately
  const random = t.mock.method(Math, 'random', () => 0.5);
  try {
    core.AccuracyFormulasDpsCalc.withAccuracyScale(1000000, () => input(f.p, () => attack(f.p, npc)));
    for (let turn = 0; turn < 8 && staff.getMetaValue(CHARGES_KEY) === 100; turn++) {
      core.AccuracyFormulasDpsCalc.withAccuracyScale(1000000, () => core.World.process());
    }
    assert.equal(staff.getMetaValue(CHARGES_KEY), 99, 'native Soul Rend pays one real staff charge');
    assert.equal(f.p.getSpecialPercentage(), 50, 'native special pays its energy');
    f.p.getCombat().reset(); // isolate the paid pending special from a following normal autoattack
    until(() => f.resolved.length === 1, 10, 'the actual paid native special lands');
    const hit = f.resolved[0].hit;
    assert.equal(hit.isAccurate(), true);
    const damage = hit.getTotalDamage();
    assert.ok(damage > 0);
    const drained = Math.max(0, 150 - damage);
    assert.equal(npc.getDefenceBonus(3), drained, 'real Soul Rend owns the permanent NPC bonus override');
    assert.equal(npc.getDefenceBonus(1), 7, 'another override is preserved');
    assert.equal(nativeBurnState(npc).stacks, 1, 'the powered spell is not mistaken for an ordinary fire spell');
    assert.equal(magicRoll(f), 209 * (Math.max(0, drained - 20) + 64));
    ticks(26);
    assert.equal(nativeBurnState(npc).stacks, 0);
    assert.equal(npc.getDefenceBonus(3), drained);
    assert.equal(magicRoll(f), 209 * (drained + 64), 'burn expiry restores no part of the permanent Soul Rend drain');
    assert.equal(f.resolved.length, 1);
    assert.equal(staff.getMetaValue(CHARGES_KEY), 99);
  } finally { random.mock.restore(); }
});

test('the shared read-only count distinguishes mixed burn durations on an unrelated native player', t => {
  const attacker = player(t), target = player(t);
  let applied = 0;
  const queue = target.getCombat().getHitQueue(), add = queue.addPendingDamage.bind(queue);
  t.mock.method(queue, 'addPendingDamage', parts => {
    for (const part of parts) part.onApplied(amount => { applied += amount; });
    return add(parts);
  });
  try {
    PM.emitCustomEvent('combat:burn', { attacker, target, damage: 5 });
    PM.emitCustomEvent('combat:burn', { attacker, target, damage: 10 });
    assert.deepEqual(nativeBurnState(target), { target, remaining: 15, stacks: 2 }, 'remaining/5 would be the wrong count');
    ticks(26);
    assert.equal(nativeBurnState(target).stacks, 1, 'only the longer native burn remains');
    assert.ok(nativeBurnState(target).remaining > 0);
    ticks(20);
    assert.equal(nativeBurnState(target).stacks, 0);
    assert.equal(nativeBurnState(target).remaining, 0);
    assert.equal(applied, 15, 'the query did not consume or refresh either unrelated burn; native applied-damage observation allows passive healing');
  } finally { PM.emitCustomEvent('combat:clear-burn', { target }); }
});

for (const longDamage of [10, 5]) {
  test(`off-phase expiry removes only unexpired shared stacks from the actual magic roll (${longDamage}+5 damage)`, t => {
    const f = fireFixture(t), start = core.World.getProcessCycle();
    f.boss.setDefenceBonusOverrides([null, null, null, 150, null]); // supplied positive bonus makes live-count changes observable above floor0
    assert.equal(f.boss.getDefenceBonus(3), 150);
    assert.equal(suppliedBurn(f, longDamage), true);
    ticks(1);
    assert.equal(core.World.getProcessCycle(), start + 1);
    assert.equal(suppliedBurn(f, 5), true); // expires start+21, between native pulses20/24
    assert.equal(nativeBurnState(f.boss).stacks, 2);
    ticks(18);
    assert.equal(core.World.getProcessCycle(), start + 19);
    assert.equal(nativeBurnState(f.boss).stacks, 2, 'both entries precede their native expiry');
    assert.equal(magicRoll(f), 209 * (150 - 40 + 64));
    ticks(1); // native pulse20 also removes the earlier short stack in the 5+5 case
    const atExpiry = longDamage === 10 ? 2 : 1;
    assert.equal(nativeBurnState(f.boss).stacks, atExpiry);
    ticks(1);
    assert.equal(core.World.getProcessCycle(), start + 21);
    assert.equal(nativeBurnState(f.boss).stacks, atExpiry, 'native expiresAt >= cycle boundary is inclusive');
    assert.equal(magicRoll(f), 209 * (150 - 20 * atExpiry + 64));
    ticks(1);
    assert.equal(core.World.getProcessCycle(), start + 22);
    const live = longDamage === 10 ? 1 : 0;
    const remaining = longDamage === 10 ? 5 : 0;
    const hp = f.boss.getHitpoints();
    for (let query = 0; query < 3; query++) {
      assert.deepEqual(nativeBurnState(f.boss), { target: f.boss, remaining, stacks: live });
      assert.equal(magicRoll(f), 209 * (150 - 20 * live + 64), 'expired retained entry no longer reduces defence before pulse24');
    }
    assert.equal(f.boss.getHitpoints(), hp, 'read-only queries do not execute a pulse');
    ticks(1);
    assert.equal(f.boss.getHitpoints(), hp, 'native pulse deadline was not moved to cycle23');
    ticks(1);
    assert.equal(core.World.getProcessCycle(), start + 24);
    assert.equal(f.boss.getHitpoints(), hp - live, 'only the original due native pulse executes');
    assert.equal(nativeBurnState(f.boss).stacks, live);
    assert.equal(nativeBurnState(f.boss).remaining, longDamage === 10 ? 4 : 0);
  });
}
