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
let core, Common, Instance;
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
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  Common = require('../plugins/bosses/maggotking/Common.MaggotKing');
  Instance = require('../plugins/bosses/maggotking/Instance.MaggotKing');
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
  return Instance.sessionOf(p);
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
