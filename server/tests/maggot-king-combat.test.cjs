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
    if (event.target?.__maggotKingSession) finalDamage.push({ attacker: event.attacker, hit: event.hit,
      part: event.damage, before: rolledDamage.get(event.damage), after: event.damage.getDamage(),
      punish: event.target.__maggotKingSession.fight?.launch?.punish });
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
  assert.ok(session);
  // Enter and Fight.start place actors. Complete their ordinary sync/reset turn before input.
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
          mobility: queue.getMobility().canMove(), blocked: queue.isStepBlocked() },
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
  input(p, () => core.PrayerHandler.activatePrayerPrayerId(p, core.PrayerHandler.PROTECT_FROM_MISSILES));
  ticks(1);
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
  input(p, () => p.getMovementQueue().addFirstStep(destination));
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
  assert.equal(larva.npc.getHitpoints(), 0, 'real bow method lands an immediate lethal native hit');
  assert.ok(p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount() < ammoBefore,
    'the fast kill still pays real ammunition');
  assert.ok(p.getCombat().getAttackDelay() > 0 && p.getCombat().getAttackDelay() <= 4,
    'native weapon cooldown replaces the prior20ticks');
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
  input(p, () => p.getMovementQueue().addFirstStep(food));
  assert.ok(p.getLocation().equals(food), 'ordinary movement reaches the actual landed larva');
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
  input(p, () => attack(p, boss));
  for (let tick = 0; tick < 2400 && boss.getHitpoints() > 0; tick++) {
    phases.add(fight.phase);
    lowest = Math.min(lowest, boss.getHitpoints());
    core.World.process();
  }
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
  let clicked = false;
  p.getCombat().setAttackDelay(30);
  p.getSession().setTurnPacketProcessor(() => {
    if (clicked || !fight.head || fight.slamCycle !== core.World.getProcessCycle()) return;
    clicked = true;
    assert.equal(core.CombatFactory.canAttackPermission(q, session.boss, false, core.CombatFactory.getMethod(q)),
      core.CanAttackResponse.CANT_ATTACK_IN_AREA, 'other session never acquires the owner\'s punish');
    attack(p, session.boss);
    // A held native target is setup for the other actor, without manufacturing a fresh NPC click stamp.
    q.getCombat().setAttackDelay(0);
    q.getCombat().attack(other.boss);
  });
  until(() => clicked, 20, 'actual extension tick receives fresh ordinary twin-weapon Attack');
  p.getSession().setTurnPacketProcessor(() => {});
  forced.mock.restore(); random.mock.restore();
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
  equip(p, core.ItemIdentifiers.ELDER_MAUL, core.WeaponInterfaces.MAUL);
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
  p.getCombat().setAttackDelay(30);
  const spent = session.fight.punishSpent;
  until(() => session.fight.head !== null, 20, 'native extension arrives while the target is held');
  assert.equal(p.getCombat().getTarget(), session.boss);
  assert.equal(session.fight.punishSpent, spent, 'retaliation target cannot cross the weapon deadline as a fresh click');
  assert.ok(p.getCombat().getAttackDelay() > 0);
  assert.equal(session.fight.clickCycle, -1);
});
