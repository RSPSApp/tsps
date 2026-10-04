// Run after `yarn build`: node --test tests/doom.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { World } = require('../dist/game/World');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const Shared = require('../plugins/bosses/doom/DoomShared');
const Delves = require('../plugins/bosses/doom/DoomDelves');
const Boss = require('../plugins/bosses/doom/DoomBoss');
const Hazards = require('../plugins/bosses/doom/DoomHazards');
const Run = require('../plugins/bosses/doom/DoomRun');
const Lobby = require('../plugins/bosses/doom/Lobby.Doom');
const Delve = require('../plugins/bosses/doom/Delve.Doom');
const Rewards = require('../plugins/bosses/doom/Rewards.Doom');
const Scoreboard = require('../plugins/bosses/doom/Scoreboard.Doom');
const Loot = require('../plugins/bosses/doom/DoomLoot');
const Records = require('../plugins/bosses/doom/DoomRecords');
const Burrow = require('../plugins/bosses/doom/DoomBurrow');
const { chargeTicks } = require('../plugins/bosses/doom/DoomShield');

const hooks = { objects: [], prompts: [], hitModify: [], beforeDeath: [], attack: [], timing: [], roll: [], buttons: {} };
let nextIndex = 1;
const SIZES = { [Shared.NPC.DOOM]: 5, [Shared.NPC.EARTHEN_SHIELD]: 3 };

function fakeNpc(id, x, y) {
  const npc = {
    id, index: nextIndex++, location: new Location(x, y, 0), hp: 2, max: -1, registered: true,
    anims: [], gfx: [], flags: new Set(), facing: null, headIcon: -1, area: null,
    transform: -1, locked: false,
    getId: () => (npc.transform !== -1 ? npc.transform : id),
    setNpcTransformationId(value) { npc.transform = value; },
    setHitpointsLocked(value) { npc.locked = value; },
    getIndex: () => npc.index,
    getLocation: () => npc.location,
    moveTo(location) { npc.location = location; },
    exactMoves: [],
    exactMove(location, options) {
      npc.exactMoves.push({ from: npc.location, to: location, options, tick: npc.tickOf?.() });
      npc.location = location;
    },
    getSize: () => SIZES[id] ?? 1,
    getHitpoints: () => npc.hp,
    setHitpoints(value) { npc.hp = value; },
    setMaxHitpoints(value) { npc.max = value; },
    getMaxHitpoints: () => npc.max,
    heal(amount) { npc.hp = Math.min(npc.max, npc.hp + amount); },
    isRegistered: () => npc.registered,
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc: () => npc,
    setArea(area) { npc.area = area; },
    getPrivateArea: () => npc.area,
    setFlag(flag) { npc.flags.add(flag); },
    setHealthBar(bar) { npc.bar = bar; },
    headbars: [], splats: [], shown: [], displayed: [],
    showHeadbar(barId, options) { npc.headbars.push({ id: barId, ...options }); },
    removeHeadbar(barId) { npc.headbars.push({ id: barId, remove: true }); },
    showHitsplat(damage, splat, health) { npc.shown.push({ damage, splat: splat.mine, health }); },
    setDisplayedHealth(health) { npc.displayed.push(health); },
    setHeadIcon(icon) { npc.headIcon = icon; },
    setMobileInteraction(mobile) { npc.facing = mobile; },
    faced: [],
    faceTile(location) { npc.faced.push({ x: location.getX(), y: location.getY(), tick: npc.tickOf?.() }); },
    crawling: false,
    setCrawling(value) { npc.crawling = value; },
    getInteractingMobile: () => npc.facing,
    performAnimation(animation) { npc.anims.push(animation.getId()); },
    performGraphic(graphic) { npc.gfx.push(graphic.getId()); },
    getMovementQueue: () => ({ setBlockMovement() {}, reset() {}, addSteps(location) { npc.location = location; } }),
    getCurrentDefinition: () => NpcDefinition.forId(id),
    getDefinition: () => NpcDefinition.forId(id),
    getCombat: () => ({
      getSelectedSpell: () => null,
      getLastAttack: () => ({ reset() {} }),
      getHitQueue: () => ({
        addPendingDamage: (hits) => {
          for (const hit of hits) npc.splats.push({ damage: hit.getDamage(), splat: hit.getSplatType?.(false) ?? null });
          if (!npc.locked) npc.hp -= hits.reduce((sum, hit) => sum + hit.getDamage(), 0);
        },
      }),
    }),
  };
  return npc;
}

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    registerNpcCombatMethodProvider() {},
    onPlayerLogin() {},
    onZoneEnter() {},
    onObjectInteraction: (handler) => hooks.objects.push(handler),
    onCanAttack: (handler) => hooks.attack.push(handler),
    onNpcBeforeDeath: (handler) => hooks.beforeDeath.push(handler),
    onNpcHitModify: (handler) => hooks.hitModify.push(handler),
    onObjectRoute: (handler) => (hooks.route ??= []).push(handler),
    onAttackTiming: (handler) => hooks.timing.push(handler),
    onCombatHitRoll: (handler) => hooks.roll.push(handler),
    onPlayerDeathItemDrop() {},
    onPlayerDeath() {},
    registerCommand() {},
    onInterfaceActionButton: (uid, handler) => { hooks.buttons[uid] = handler; },
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    spawnNpc: ({ id, x, y }) => fakeNpc(id, x, y),
    removeNpc: (npc) => { npc.registered = false; },
  };
}

function fakePlayer() {
  const attributes = new Map();
  const varbits = new Map();
  const varps = new Map();
  const inventory = new Map();
  const p = {
    location: new Location(1311, 9556, 0), area: null, messages: [], damage: [], gfx: [], anims: [], scripts: [],
    clientScripts: [], inventories: {}, strings: {}, interfaces: [], inventory, freeSlots: 28,
    getInventory: () => ({
      contains: (id) => inventory.has(id),
      getFreeSlots: () => p.freeSlots,
      add(item) { if (!inventory.has(item.getId())) p.freeSlots--; inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
      refreshItems() {},
    }),
    dialogueActive: true, hp: 99, strength: 0, weapon: -1, varbits, varps,
    colours: [], scriptArgs: [], camera: [], hudLog: [], prayer: 30, maxPrayer: 70, special: 50,
    heal(amount) { p.hp = Math.min(99, p.hp + amount); },
    getSkillManager: () => ({
      getMaxLevel: () => p.maxPrayer,
      increaseCurrentLevel(skill, amount, max) { p.prayer = Math.min(max, p.prayer + amount); },
    }),
    getSpecialPercentage: () => p.special,
    setSpecialPercentage(value) { p.special = value; },
    isPlayer: () => true,
    isNpc: () => false,
    getIndex: () => 7,
    getAsPlayer: () => p,
    getSize: () => 1,
    getPrayerActive: () => [],
    isRegistered: () => true,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    getArea: () => p.area,
    setArea(area) { p.area = area; },
    getPrivateArea: () => p.area,
    getHitpoints: () => p.hp,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => p.messages.push(message),
    performGraphic(graphic) { p.gfx.push(graphic.getId()); },
    performAnimation(animation) { p.anims.push(animation.getId()); },
    getMovementQueue: () => ({ reset() {} }),
    getDialogueManager: () => ({ isActive: () => p.dialogueActive, startDialogues() { p.dialogueActive = true; } }),
    getEquipment: () => ({ getItems: () => Object.assign([], { 3: { getId: () => p.weapon } }) }),
    getBonusManager: () => ({ getOtherBonus: () => [p.strength, 0, 0, 0] }),
    getCombat: () => ({
      reset() {},
      getSelectedSpell: () => null,
      getHitQueue: () => ({ addPendingDamage: (hits) => p.damage.push(...hits.map((hit) => hit.getDamage())) }),
    }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        sendConfig: (id, value) => { varps.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendSubInterface: () => sender,
        sendInterfaceDisplayState: (uid, hidden) => { p.hudLog.push(['hide', uid & 0xffff, hidden]); return sender; },
        sendInterfaceScript: (id, args) => { p.scripts.push(id); p.scriptArgs.push([id, args]); p.hudLog.push(['script', id, args?.at(-1)]); return sender; },
        sendInterfaceColour: (uid, colour) => { p.colours.push([uid & 0xffff, colour]); p.hudLog.push(['colour', uid & 0xffff, colour]); return sender; },
        sendCameraShake: (axis, random) => { p.camera.push(['shake', axis, random]); return sender; },
        sendCameraReset: () => { p.camera.push(['reset']); return sender; },
        sendGraphic: () => sender,
        sendObject: () => sender,
        sendObjectRemoval: () => sender,
        sendSong: () => sender,
        sendInventory: (id, size, items) => { p.inventories[id] = items.map((item) => ({ ...item })); return sender; },
        sendInterface: (id) => { p.interfaces.push(id); return sender; },
        sendInterfaceRemoval: () => { p.interfaces.push(-1); return sender; },
        sendClientScript: (id, ...args) => { p.clientScripts.push([id, ...args]); return sender; },
        sendString: (text, uid) => { p.strings[uid] = text; return sender; },
        sendInterfaceFlagsRange: () => sender,
      };
      return sender;
    },
  };
  return p;
}

const strikes = [];
Boss.AttackCycle.prototype.strike = function (style, maxHit, delay) {
  strikes.push({ style, maxHit, delay, at: this.run.ticks });
};

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  ObjectDefinition.init();
  const api = fakeApi();
  Lobby(api);
  Delve(api);
  Rewards(api);
  Scoreboard(api);
  Records.resetWorld();
});

function objectsHere(id, tile) {
  return World.getObjects().filter((object) => object.getId() === id
    && object.getLocation().getX() === tile.x && object.getLocation().getY() === tile.y);
}

/** A run whose Doom has surfaced, with its attacks held unless `attacks` is set. */
function surfacedRun({ attacks = false, random = () => 0.99 } = {}) {
  const player = fakePlayer();
  const run = Run.start(player, { random });
  player.dialogueActive = false;
  ticks(1);
  if (!attacks) run.attacks.active = false;
  run.hazards.nextLarvaAt = Infinity;
  return { player, run };
}

// ------------------------------------------------------------------ data

test('the delve table follows the Wiki', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((level) => Delves.delve(level).hp),
    [525, 550, 575, 600, 625, 650, 650, 675, 625, 625]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((level) => Delves.delve(level).speed), [6, 6, 5, 5, 5, 5, 4, 4]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((level) => Delves.delve(level).shockwaves), [1, 1, 2, 2, 3, 3, 4, 5]);
  assert.deepEqual([1, 3, 4, 6].map((level) => Delves.delve(level).beam), [60, 60, 80, 99]);
});

test('the cache has the Doom, its larvae and locs where the capture put them', () => {
  assert.equal(CacheDefinitions.getNpc(Shared.NPC.DOOM).name, 'Doom of Mokhaiotl');
  assert.equal(CacheDefinitions.getNpc(Shared.NPC.LARVA).hitpoints, 2);
  assert.equal(CacheDefinitions.getNpc(Shared.NPC.VOLATILE_EARTH).hitpoints, 1);
  assert.equal(CacheDefinitions.getNpc(Shared.NPC.EARTHEN_SHIELD).size, 3);
  assert.deepEqual(CacheDefinitions.getObject(Shared.OBJECT.GAP_EXIT).actions.slice(0, 2), ['Exit', 'Quick-exit']);
  assert.deepEqual(CacheDefinitions.getObject(Shared.OBJECT.BURROW_HOLE).actions.slice(0, 2), ['Investigate', 'Descend']);
  const entrance = CacheDefinitions.getObject(Shared.OBJECT.ENTRANCE);
  assert.equal(entrance.transformVarbit, Shared.VARBIT.FINAL_DAWN);
  assert.equal(entrance.transforms[Shared.FINAL_DAWN_COMPLETE], Shared.OBJECT.ENTRANCE_OPEN);
  assert.equal(CacheDefinitions.getObject(Shared.OBJECT.ENTRANCE_OPEN).actions[0], 'Pass-through');
});

test('the arrival, the volatile earth tiles and the lobby tiles are open floor', () => {
  const free = ({ x, y, z = 0 }) => (RegionManager.getClipping(x, y, z, null) & 0x1280100) === 0;
  for (const key of ['ARRIVAL', 'LOBBY', 'LOBBY_GAP', 'RESPAWN', 'RUINS']) assert.ok(free(Shared.TILES[key]), key);
  for (const [x, y] of Hazards.EARTH.pool) assert.ok(free({ x, y }), `earth at ${x},${y}`);
  for (const [x, y] of Hazards.EARTH.pool) assert.ok(free(Shared.shift({ x, y }, true)), `deep earth at ${x},${y}`);
  assert.ok(free(Shared.shift(Shared.TILES.DESCENT, true)), 'where descending lands');
  assert.ok(!Shared.inArena(Shared.loc(Shared.TILES.LOBBY_GAP)), 'the lobby is outside the instance');
  assert.ok(Shared.inArena(Shared.loc(Shared.TILES.ARRIVAL)));
});

// ------------------------------------------------------------------ geometry

test('a thrown rock bursts beside the Doom, towards the player (capture)', () => {
  const boss = fakeNpc(Shared.NPC.DOOM, 1309, 9571);
  const at = (x, y) => ({ getLocation: () => new Location(x, y, 0) });
  // Capture: player tile at the throw -> where it burst.
  for (const [player, burst] of [[[1309, 9568], [1309, 9570]], [[1308, 9575], [1308, 9575]], [[1306, 9576], [1308, 9574]]]) {
    const tile = Boss.burstTile(boss, at(...player));
    assert.ok(Math.abs(tile.x - burst[0]) <= 1 && Math.abs(tile.y - burst[1]) <= 1, `${player} -> ${tile.x},${tile.y}`);
    assert.equal(Shared.distanceTo(boss, tile), 1, 'just outside the Doom');
  }
});

test('the tongue reaches only the sides of the Doom', () => {
  const boss = fakeNpc(Shared.NPC.DOOM, 1309, 9571);
  assert.ok(Boss.besideBoss(boss, new Location(1308, 9575, 0)), 'west side (capture)');
  assert.ok(Boss.besideBoss(boss, new Location(1310, 9576, 0)), 'north side (capture)');
  assert.ok(!Boss.besideBoss(boss, new Location(1308, 9570, 0)), 'not the corner');
  assert.ok(!Boss.besideBoss(boss, new Location(1307, 9573, 0)), 'not two tiles away');
});

// ------------------------------------------------------------------ the run

test('the gap starts a run; the Doom surfaces when the player moves', () => {
  const player = fakePlayer();
  const run = Run.start(player);
  assert.deepEqual([player.location.getX(), player.location.getY()], [1311, 9559]);
  assert.equal(player.area, run.area);
  assert.ok(player.messages.includes('<col=ef1020>Delve level: 1</col>'));
  assert.equal(objectsHere(Shared.OBJECT.GAP_EXIT, Shared.TILES.GAP).length, 1, 'the gap becomes the exit');
  ticks(3);
  assert.equal(run.boss, null, 'not while the prompt is up');
  player.location = new Location(1311, 9561, 0);
  ticks(1);
  const boss = run.boss;
  assert.equal(boss.getId(), Shared.NPC.DOOM);
  assert.deepEqual([boss.location.getX(), boss.location.getY()], [1309, 9571]);
  assert.deepEqual(boss.anims, [12418]);
  assert.deepEqual(boss.gfx, [3372]);
  assert.equal(boss.getHitpoints(), 525);
  assert.equal(player.varps.get(Shared.VARP.HUD_NPC), Shared.NPC.DOOM);
  assert.equal(player.varbits.get(Shared.VARBIT.HUD_HP), 525);
  assert.equal(player.varbits.get(Shared.VARBIT.HUD_MAX), 525);
  assert.equal(player.varbits.get(Shared.VARBIT.HUD_BOSS), 1);
  assert.ok(player.varps.has(Shared.VARP.LEVEL_START), 'the level start time is sent');
  assert.ok(player.scripts.includes(2376) && player.scripts.includes(2887), 'the HUD opens and fades in');
  run.end('exit');
});

test('its first attack comes 6 ticks after surfacing; orbs land 7 ticks after', () => {
  const { player, run } = surfacedRun({ attacks: true, random: () => 0.99 });
  run.attacks.nextShockwaveAt = Infinity;
  player.location = new Location(1311, 9563, 0);
  ticks(5);
  assert.deepEqual(run.boss.anims, [12418]);
  ticks(1);
  assert.equal(run.boss.anims.at(-1), Boss.ANIM.ORB, 'random 0.99: an orb first');
  ticks(6);
  assert.equal(player.damage.length, 0, 'still in flight');
  ticks(1);
  assert.ok(player.gfx.includes(2490) || player.gfx.includes(2492), 'its impact graphic');
  assert.deepEqual(strikes.at(-1).maxHit, 47, 'delve 1 orbs hit up to 47');
  run.end('exit');
});

test('beside the Doom it lashes with its tongue, every 4 ticks', () => {
  const { player, run } = surfacedRun({ attacks: true });
  run.attacks.nextShockwaveAt = Infinity;
  player.location = new Location(1308, 9575, 0);
  ticks(6);
  assert.equal(run.boss.anims.at(-1), Boss.ANIM.TONGUE);
  ticks(4);
  assert.equal(run.boss.anims.filter((id) => id === Boss.ANIM.TONGUE).length, 2);
  run.end('exit');
});

test('a larva crawls to the Doom: charge, damage and healing grow (capture)', () => {
  const { player, run } = surfacedRun();
  run.boss.hp = 400;
  for (let n = 1; n <= 2; n++) {
    player.location = new Location(1311, 9565, 0);
    run.hazards.spawnLarva();
    const larva = [...run.hazards.larvae][0];
    const at = larva.getLocation();
    assert.ok(at.getY() < 9565, 'past the player, away from the Doom');
    assert.ok(larva, 'a larva dropped');
    assert.deepEqual(larva.gfx, [3417]);
    assert.deepEqual(larva.anims, [12458]);
    const before = player.damage.length;
    ticks(40);
    assert.equal(larva.registered, false, 'it went into the Doom');
    assert.equal(player.varbits.get(Shared.VARBIT.MISSED_ORBS), n);
    assert.equal(player.damage.slice(before).at(-1), n, 'the player takes the charge');
    assert.ok(player.gfx.includes(3426));
  }
  assert.equal(run.boss.getHitpoints(), 400 + 10 + 11);
  run.end('exit');
});

test('larvae take 1 a hit unless demonbane, and nothing through their prayer', () => {
  const { CombatType, HitDamage, HitMask } = PluginManager.getCoreApi();
  const { player, run } = surfacedRun();
  const larva = run.spawnNpc(Shared.NPC.LARVA, { x: 1305, y: 9565 });
  larva.__doomLarva = { protect: 'melee' };
  const hitWith = (type, damage) => {
    const parts = [new HitDamage(damage, HitMask.RED)];
    const hit = { getAttacker: () => player, getCombatType: () => type, getHits: () => parts, updateTotalDamage() {}, getTotalDamage: () => parts.reduce((sum, part) => sum + part.getDamage(), 0) };
    for (const handler of hooks.hitModify) handler({ npc: larva, hit });
    return parts[0].getDamage();
  };
  assert.equal(hitWith(CombatType.RANGED, 30), 1);
  assert.equal(hitWith(CombatType.MELEE, 30), 0, 'it prays melee');
  player.weapon = 29591;
  assert.equal(hitWith(CombatType.RANGED, 30), 30, 'scorching bow is demonbane');
  run.end('exit');
});

test('a killed larva bursts into the Doom, sparing the player', () => {
  const { player, run } = surfacedRun();
  const larva = run.spawnNpc(Shared.NPC.LARVA, { x: 1308, y: 9573 });
  larva.__doomLarva = { protect: null, movedAt: 0 };
  run.hazards.larvae.add(larva);
  player.location = new Location(1307, 9573, 0);
  const hp = run.boss.getHitpoints();
  const event = { npc: larva, preventDeath: false };
  for (const handler of hooks.beforeDeath) handler(event);
  assert.ok(event.preventDeath);
  assert.ok(hp - run.boss.getHitpoints() >= 5 && hp - run.boss.getHitpoints() <= 10);
  assert.equal(player.damage.length, 0);
  run.end('exit');
});

test('a rock bursts, lands and leaves a rock where the player stood (capture)', () => {
  const { PrayerHandler } = PluginManager.getCoreApi();
  const { player, run } = surfacedRun();
  player.location = new Location(1308, 9571, 0);
  let off = 0;
  const deactivate = PrayerHandler.deactivatePrayer;
  const activated = PrayerHandler.isActivated;
  PrayerHandler.isActivated = () => true;
  PrayerHandler.deactivatePrayer = () => { off++; };
  try {
    run.hazards.burstRock({ x: 1309, y: 9570 }, 'ranged');
  } finally {
    PrayerHandler.deactivatePrayer = deactivate;
    PrayerHandler.isActivated = activated;
  }
  assert.equal(off, 3, 'protection prayers go off');
  run.attacks.active = true;
  run.attacks.nextAt = Infinity;
  run.attacks.nextShockwaveAt = Infinity;
  ticks(3);
  assert.equal(objectsHere(Shared.OBJECT.ROCK, { x: 1308, y: 9571 }).length, 1);
  assert.ok(player.anims.includes(1114), 'thrown aside');
  assert.ok(player.location.getX() !== 1308 || player.location.getY() !== 9571);
  run.end('exit');
  assert.equal(objectsHere(Shared.OBJECT.ROCK, { x: 1308, y: 9571 }).length, 0, 'gone with the run');
});

test('two volatile earth make a shield that walks from the second to the first', () => {
  const { player, run } = surfacedRun();
  run.hazards.spawnVolatileEarth();
  const count = run.hazards.earth.size;
  assert.ok(count >= 19 && count <= 28, `${count} volatile earth (capture: 19-28)`);
  const earths = [...run.hazards.earth];
  const second = earths[0];
  const far = (earth) => Math.max(Math.abs(earth.getLocation().getX() - second.getLocation().getX()), Math.abs(earth.getLocation().getY() - second.getLocation().getY()));
  const first = earths.slice(1).sort((a, b) => far(b) - far(a))[0];
  assert.ok(far(first) >= 4, 'two far apart');
  for (const earth of [first, second]) {
    const event = { npc: earth, preventDeath: false };
    for (const handler of hooks.beforeDeath) handler(event);
  }
  const shield = run.hazards.shield.npc;
  assert.equal(shield.getId(), Shared.NPC.EARTHEN_SHIELD);
  assert.ok(shield.anims.includes(12436));
  const centre = [second.location.getX(), second.location.getY()];
  assert.deepEqual([shield.location.getX() + 1, shield.location.getY() + 1], centre, 'centred on the second');
  assert.equal(run.hazards.earth.size, 0, 'the rest die');
  assert.ok(earths.filter((earth) => earth !== first && earth !== second).every((earth) => earth.anims.includes(12433)));
  player.location = new Location(centre[0], centre[1] + 1, 0);
  assert.ok(run.hazards.sheltered(player));
  ticks(2);
  const towards = [Math.sign(first.location.getX() - centre[0]), Math.sign(first.location.getY() - centre[1])];
  assert.deepEqual([shield.location.getX() + 1, shield.location.getY() + 1], [centre[0] + towards[0], centre[1] + towards[1]], 'a step (diagonal first) every 2 ticks at delve 1');
  ticks(50);
  assert.equal(run.hazards.shield, null, 'gone on arriving');
  run.end('exit');
});

test('a shockwave hits everyone outside the shield 21 ticks after the earth', () => {
  const { player, run } = surfacedRun();
  run.attacks.active = true;
  run.attacks.nextAt = Infinity;
  run.attacks.nextShockwaveAt = run.ticks + 1;
  player.location = new Location(1311, 9563, 0);
  ticks(1);
  assert.ok(run.hazards.earth.size >= 19);
  ticks(20);
  assert.equal(player.damage.length, 0);
  assert.deepEqual(run.boss.anims.slice(-3), [Boss.ANIM.AREA_CHARGE, Boss.ANIM.AREA_LOOP, Boss.ANIM.AREA_SLAM]);
  ticks(1);
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] >= 26 && player.damage[0] <= 42);
  ticks(3);
  assert.equal(run.hazards.earth.size, 0, 'the earth goes three ticks later');
  run.end('exit');
});

test('the melee charge: only melee lands, with a fifth of the Strength bonus, and holds its attacks', () => {
  const { CombatType, HitDamage, HitMask } = PluginManager.getCoreApi();
  const { player, run } = surfacedRun();
  run.attacks.active = true;
  run.attacks.startCharge();
  const hitWith = (type, damage) => {
    const parts = [new HitDamage(damage, HitMask.RED)];
    const hit = { getAttacker: () => player, getCombatType: () => type, getHits: () => parts, updateTotalDamage() {}, getTotalDamage: () => parts.reduce((sum, part) => sum + part.getDamage(), 0) };
    for (const handler of hooks.hitModify) handler({ npc: run.boss, hit });
    return parts[0].getDamage();
  };
  assert.equal(run.boss.headIcon, 6, 'it prays Magic and Ranged (capture)');
  assert.equal(hitWith(CombatType.RANGED, 30), 0);
  player.strength = 132;
  const hp = run.boss.getHitpoints();
  assert.equal(hitWith(CombatType.MELEE, 0), 1, 'always lands');
  assert.equal(run.attacks.charging, false);
  assert.equal(run.boss.headIcon, -1);
  assert.equal(run.attacks.nextAt, run.ticks + 7, 'capture: 7 ticks after the hit at delve 1');
  ticks(1);
  assert.equal(hp - run.boss.getHitpoints(), 26, 'floor(132 / 5) the next tick');
  assert.equal(hitWith(CombatType.RANGED, 30), 30, 'back to normal');
  run.end('exit');
});

test('an unanswered charge fires the beam', () => {
  const { player, run } = surfacedRun();
  run.attacks.active = true;
  run.attacks.nextShockwaveAt = Infinity;
  run.attacks.startCharge();
  ticks(13);
  assert.ok(run.boss.anims.includes(Boss.ANIM.BEAM_FIRE), 'fires 13 ticks in (capture)');
  assert.ok(!player.damage.includes(60));
  ticks(1);
  assert.ok(player.damage.includes(60), 'and hits the next tick');
  assert.ok(run.boss.anims.includes(Boss.ANIM.BEAM_FIRE));
  run.end('exit');
});

test('beaten, it leaves a burrow hole; descending starts delve 2', () => {
  const { player, run } = surfacedRun();
  const boss = run.boss;
  const event = { npc: boss, preventDeath: false };
  for (const handler of hooks.beforeDeath) handler(event);
  assert.ok(event.preventDeath);
  assert.equal(run.stage, 'burrowing');
  assert.ok(player.messages.some((message) => /^Delve level: 1 duration: <col=ef1020>\d+:\d\d\.\d\d<\/col>/.test(message)));
  assert.ok(player.messages.some((message) => message.startsWith('Total duration: ')));
  assert.equal(player.varps.get(Shared.VARP.LAST_LEVEL), 0, 'level 1 is 0');
  assert.equal(player.varps.get(Shared.VARP.LEVEL_COMPLETIONS), 1);
  assert.equal(player.varps.get(Shared.VARP.HUD_NPC), -1, 'the HUD goes');
  ticks(4);
  assert.equal(run.stage, 'burrowing');
  ticks(1);
  assert.equal(run.stage, 'hole', 'the hole opens 5 ticks after (capture)');
  assert.equal(boss.registered, true, 'the Doom is still there');
  ticks(2);
  assert.equal(boss.registered, false, 'gone at 7');
  assert.equal(objectsHere(Shared.OBJECT.BURROW_HOLE, Shared.TILES.BOSS).length, 1);
  assert.deepEqual(player.getAttribute(Run.ATTR.COMPLETIONS), { 1: 1 });
  run.descend();
  ticks(2);
  assert.equal(run.level, 2);
  const deep = Shared.shift(Shared.TILES.DESCENT, true);
  assert.deepEqual([player.location.getX(), player.location.getY()], [deep.x, deep.y], 'into the deeper square (capture)');
  ticks(2);
  assert.equal(run.boss, null, 'it waits while "You jump further into the burrow..." is up');
  player.dialogueActive = false;
  assert.equal(objectsHere(Shared.OBJECT.BURROW_HOLE, Shared.TILES.BOSS).length, 0);
  assert.ok(player.messages.includes('<col=ef1020>Delve level: 2</col>'));
  player.location = new Location(deep.x, deep.y + 1, 0);
  ticks(1);
  assert.equal(run.boss.getHitpoints(), 550);
  const bossAt = Shared.shift(Shared.TILES.BOSS, true);
  assert.deepEqual([run.boss.location.getX(), run.boss.location.getY()], [bossAt.x, bossAt.y]);
  assert.ok(Shared.inArena(player.location));
  run.end('exit');
});

test('the hole shows the loot; claiming moves it to the chest; Leave ends the run', () => {
  const { player, run } = surfacedRun();
  run.defeated();
  ticks(5);
  assert.ok(run.loot.length >= 1, 'a delve rolls loot');
  const event = { player, option: 'Investigate', clickType: 1 };
  Delve.useHole(event);
  assert.equal(player.interfaces.at(-1), Rewards.INTERFACE);
  assert.deepEqual(player.clientScripts.at(-1), [7927, 0, 0, 0], 'the level 0-based (capture)');
  assert.match(player.strings[(919 << 16) | 20], /^Value: [\d,]+ GP$/);
  assert.deepEqual(player.inventories[Rewards.INVENTORY.HOLE], run.loot);
  const loot = run.loot.map((item) => ({ ...item }));
  Rewards.clickClaim({ player });
  assert.equal(run.stage, 'claimed');
  assert.deepEqual(player.clientScripts.at(-1), [7927, 0, 1, 0]);
  assert.deepEqual(Rewards.unclaimed(player), loot);
  Rewards.clickTakeAll({ player });
  assert.deepEqual(Rewards.unclaimed(player), []);
  assert.ok(loot.every((item) => player.inventory.get(item.id) === item.amount));
  Rewards.clickLeave({ player });
  assert.equal(Run.runOf(player), null);
  ticks(2);
  assert.deepEqual([player.location.getX(), player.location.getY()], [1311, 9556]);
});

test('leaving without claiming leaves the loot in the lobby chest; dying deeper loses it', () => {
  const { player, run } = surfacedRun();
  run.defeated();
  ticks(5);
  const loot = run.loot.map((item) => ({ ...item }));
  run.end('exit');
  assert.deepEqual(Rewards.unclaimed(player), loot);
  player.location = new Location(1307, 9549, 0);
  assert.equal(Rewards.lookInChest({ player }), true);
  assert.deepEqual(player.clientScripts.at(-1), [7927, 0, 0, 1], 'the chest view');
  assert.deepEqual(player.inventories[Rewards.INVENTORY.CLAIM], loot);

  const second = surfacedRun();
  second.run.defeated();
  ticks(5);
  second.run.descend();
  ticks(2);
  second.run.end('death');
  assert.deepEqual(Rewards.unclaimed(second.player), [], 'died after descending');
});

test('only the run\'s player may attack its NPCs', () => {
  const { player, run } = surfacedRun();
  const other = fakePlayer();
  const check = (attacker, target) => {
    const event = { attacker, target, allow: null };
    for (const handler of hooks.attack) handler(event);
    return event.allow;
  };
  assert.equal(check(player, run.boss), null);
  assert.equal(check(other, run.boss), false);
  assert.equal(check(run.boss, player), false, 'its attacks are scripted');
  run.end('exit');
});

// ------------------------------------------------------------------ delves 3+

function runAt(level, random = () => 0.99) {
  const player = fakePlayer();
  const run = Run.start(player, { random });
  run.startLevel(level);
  const arrival = run.tile({ x: 1311, y: 9561, z: 0 });
  player.location = new Location(arrival.x, arrival.y, 0);
  ticks(1);
  run.attacks.active = false;
  run.hazards.nextLarvaAt = Infinity;
  return { player, run };
}

function hitBoss(run, player, type, damage) {
  const { HitDamage, HitMask } = PluginManager.getCoreApi();
  const parts = [new HitDamage(damage, HitMask.RED)];
  const hit = { getAttacker: () => player, getCombatType: () => type, getHits: () => parts, updateTotalDamage() {}, getTotalDamage: () => parts.reduce((sum, part) => sum + part.getDamage(), 0) };
  for (const handler of hooks.hitModify) handler({ npc: run.boss, hit });
  return parts[0].getDamage();
}

test('from delve 3 a hit sprays acid, which burns and envenoms', () => {
  const { CombatType, CombatFactory } = PluginManager.getCoreApi();
  const { player, run } = runAt(3);
  run.attacks.active = true;
  run.attacks.nextAt = Infinity;
  run.attacks.nextShockwaveAt = Infinity;
  hitBoss(run, player, CombatType.RANGED, 20);
  ticks(1);
  assert.ok(run.acid.pools.size >= 1, 'acid landed');
  const [tile] = [...run.acid.pools.keys()].map((key) => key.split(',').map(Number));
  assert.ok(Shared.distanceTo(run.boss, { x: tile[0], y: tile[1] }) >= 1 && Shared.distanceTo(run.boss, { x: tile[0], y: tile[1] }) <= 5);
  let venom = 0;
  const poison = CombatFactory.poisonEntity;
  CombatFactory.poisonEntity = (entity, severity, type) => { if (type === 2) venom++; };
  try {
    player.location = new Location(tile[0], tile[1], 0);
    const before = player.damage.length;
    ticks(1);
    assert.equal(player.damage.length, before + 1);
    assert.ok(player.damage.at(-1) >= 1 && player.damage.at(-1) <= 7);
    assert.equal(venom, 1);
  } finally {
    CombatFactory.poisonEntity = poison;
  }
  run.end('exit');
  assert.equal(run.acid.pools.size, 0);
});

test('no acid at delves 1-2', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = runAt(2);
  run.attacks.active = true;
  hitBoss(run, player, CombatType.RANGED, 20);
  ticks(1);
  assert.equal(run.acid.pools.size, 0);
  run.end('exit');
});

test('delve 3: the shield rises at 75% after two attacks; only demonbane harms it', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = runAt(3);
  run.attacks.active = true;
  run.attacks.nextShockwaveAt = Infinity;
  player.location = new Location(run.tile({ x: 1311, y: 9563 }).x, run.tile({ x: 1311, y: 9563 }).y, 0);
  run.attacks.nextAt = run.ticks + 1;
  ticks(1);
  run.attacks.nextAt = run.ticks + 1;
  ticks(1);
  assert.equal(run.attacks.phase, 'attacks', 'not yet: above 75%');
  run.boss.hp = Math.floor(575 * 0.75);
  run.attacks.nextAt = run.ticks + 1;
  ticks(1);
  assert.equal(run.attacks.phase, 'shield');
  assert.equal(run.boss.anims.at(-1), Boss.ANIM.BEAM_CHARGE, 'its charge animation first');
  ticks(2);
  assert.equal(run.boss.getId(), Shared.NPC.DOOM_SHIELDED);
  assert.equal(player.varps.get(Shared.VARP.HUD_NPC), Shared.NPC.DOOM_SHIELDED);
  assert.equal(player.varbits.get(Shared.VARBIT.HUD_HP), 500);
  assert.equal(hitBoss(run, player, CombatType.RANGED, 40), 0);
  assert.ok(player.messages.at(-1).includes('The demonic shield resists your attack!'));
  player.weapon = 29591;
  assert.equal(hitBoss(run, player, CombatType.RANGED, 0), 1, 'demonbane always lands');
  assert.equal(run.shield.points, 499);
  run.shield.stored = 12;
  const hp = run.boss.getHitpoints();
  hitBoss(run, player, CombatType.RANGED, 600);
  assert.equal(run.attacks.phase, 'attacks', 'broken');
  assert.equal(run.boss.getId(), Shared.NPC.DOOM);
  assert.equal(run.boss.anims.at(-1), Boss.ANIM.ROCK_THROW, 'it breaks into a rock throw (capture)');
  assert.equal(run.boss.getHitpoints(), hp - 12, 'the stored damage lands');
  run.end('exit');
});

test('an unbroken shield fires the beam and drops', () => {
  const { player, run } = runAt(4);
  run.attacks.active = true;
  run.attacks.phase = 'shield';
  run.shield.start();
  ticks(chargeTicks(4));
  assert.equal(chargeTicks(4), 17, 'capture: 510 cycles');
  assert.ok(player.damage.includes(80), 'delve 4 beam');
  assert.equal(run.attacks.phase, 'attacks');
  run.end('exit');
});

test('delve 4: coloured larvae take only their own style', () => {
  const { CombatType, HitDamage, HitMask } = PluginManager.getCoreApi();
  const { player, run } = runAt(4);
  player.weapon = 29591;
  const kind = run.hazards.larvaKind(false);
  assert.ok([Shared.NPC.LARVA_RANGED, Shared.NPC.LARVA_MAGIC].includes(kind.id), 'no melee larvae outside the shield');
  const larva = run.spawnNpc(Shared.NPC.LARVA_RANGED, { x: 1305, y: 9565 });
  larva.__doomLarva = { style: 'ranged' };
  const hitWith = (type) => {
    const parts = [new HitDamage(30, HitMask.RED)];
    const hit = { getAttacker: () => player, getCombatType: () => type, getHits: () => parts, updateTotalDamage() {} };
    run.hazards.modifyLarvaHit(larva, hit);
    return parts[0].getDamage();
  };
  assert.equal(hitWith(CombatType.MAGIC), 0);
  assert.equal(hitWith(CombatType.RANGED), 30);
  run.end('exit');
});

test('delve 5: after the shield it burrows, zooms past the player and surfaces into a shockwave', () => {
  const { player, run } = runAt(5);
  run.boss.tickOf = () => run.ticks;
  run.attacks.active = true;
  const south = Shared.shift({ x: 1311, y: 9564 }, true);
  player.location = new Location(south.x, south.y, 0);
  const shockwaves = [];
  const startShockwave = run.attacks.startShockwave.bind(run.attacks);
  run.attacks.startShockwave = (options) => { shockwaves.push(options); startShockwave(options); };
  run.attacks.phase = 'shield';
  run.shield.start();
  run.shield.damage(500);
  assert.equal(run.attacks.phase, 'burrow');
  assert.ok(run.boss.anims.includes(12420));
  ticks(5);
  assert.equal(run.boss.getId(), Shared.NPC.DOOM_BURROWED, 'burrowed 5 ticks on (capture)');
  ticks(1);
  assert.ok(run.hazards.rocks.length >= 20, 'rocks land at 6 (capture: 24)');
  ticks(Burrow.BURROW.firstEye - 1 + Burrow.BURROW.eyeTicks + 3);
  const at = Shared.frame(run.boss.location);
  assert.ok(at.y < 9571, 'it went south, towards the player');
  assert.ok(run.boss.anims.includes(12417));
  // Capture: each tick of a zoom is one teleport and exact_move with delay1 0, delay2 30 and the
  // direction of travel - npc.exactMove's defaults, so no options are passed.
  const glides = run.boss.exactMoves;
  assert.ok(glides.length >= 2, `${glides.length} glides`);
  for (const [index, glide] of glides.entries()) {
    const dx = glide.to.getX() - glide.from.getX();
    const dy = glide.to.getY() - glide.from.getY();
    assert.ok(Math.max(Math.abs(dx), Math.abs(dy)) <= 4, `glide ${index}: at most 4 tiles a tick`);
    assert.equal(glide.options, undefined, 'the defaults: cycles 0-30, facing the way it goes');
    if (index > 0 && glides[index - 1].tick === glide.tick - 1) {
      assert.ok(glides[index - 1].to.equals(glide.from), 'each glide starts where the last ended');
    }
  }
  ticks(40);
  assert.equal(run.attacks.phase, 'attacks', 'surfaced');
  assert.equal(run.boss.getId(), Shared.NPC.DOOM);
  assert.deepEqual(shockwaves, [{ afterBurrow: true }], 'volatile earth as it surfaces');
  run.end('exit');
});

test('a car slam: rocks shelter the player, and a rock under its centre blocks it', () => {
  const { player, run } = runAt(6);
  run.attacks.phase = 'burrow';
  run.burrow.zoomsLeft = 3;
  const centre = run.burrow.centre;
  player.location = new Location(centre.x, centre.y - 6, 0);
  run.hazards.addRock({ x: centre.x, y: centre.y - 4 });
  run.hazards.addRock({ x: centre.x + 6, y: centre.y });
  const before = player.damage.length;
  run.burrow.slam();
  assert.equal(player.damage.length, before, 'sheltered');
  assert.equal(run.hazards.rocks.length, 0, 'unsheltered rocks break');
  run.hazards.addRock({ x: centre.x, y: centre.y });
  run.hazards.addRock({ x: centre.x + 6, y: centre.y });
  run.burrow.slam();
  assert.equal(player.damage.length, before, 'rockblock');
  assert.equal(run.hazards.rocks.length, 1, 'only the blocking rock goes');
  run.hazards.clearRocks();
  run.burrow.slam();
  assert.equal(player.damage.length, before + 1, 'nothing in the way');
  run.end('exit');
});

test('the burrowed Doom tramples the player in its path', () => {
  assert.deepEqual([5, 6, 7, 8, 12].map(Burrow.trample), [10, 20, 30, 40, 40]);
  assert.deepEqual(Burrow.octant({ x: 0, y: 0 }, { x: 5, y: -1 }), { dx: 1, dy: 0 });
  assert.deepEqual(Burrow.octant({ x: 0, y: 0 }, { x: -4, y: -5 }), { dx: -1, dy: -1 });
});

test('descending to delve 6 clears the acid', () => {
  const { run } = runAt(5);
  run.acid.place(run.tile({ x: 1305, y: 9565 }));
  run.hazards.descended(6);
  assert.equal(run.acid.pools.size, 0);
  run.end('exit');
});

// ------------------------------------------------------------------ loot and records

test('loot quantities scale with the delve (Wiki formula)', () => {
  assert.equal(Loot.TABLE.reduce((sum, row) => sum + row[3], 0), Loot.TABLE_WEIGHT);
  assert.deepEqual([1, 2, 3, 4, 8, 9].map((level) => Loot.scaled(100, level)), [50, 65, 100, 105, 117, 120]);
  assert.deepEqual([1, 2, 3, 4, 8, 12].map(Loot.tears), [0, 0, 50, 60, 100, 100]);
  assert.equal(Loot.rollUnique(1, () => 0), null, 'no uniques at delve 1');
  assert.equal(Loot.rollUnique(2, () => 0), Loot.ITEM.MOKHAIOTL_CLOTH);
  assert.equal(Loot.rollUnique(4, () => 0.0001), Loot.ITEM.MOKHAIOTL_CLOTH);
  assert.equal(Loot.rollDom(5, () => 0), undefined);
  assert.equal(Loot.rollDom(6, () => 0), true);
  const { items } = Loot.roll(3, () => 0.5);
  assert.ok(items.some((item) => item.id === Loot.ITEM.DEMON_TEAR && item.amount === 50));
});

test('the scoreboard shows personal and world records', () => {
  Records.resetWorld();
  const player = fakePlayer();
  Records.completed(player, 1, 100);
  Records.completed(player, 1, 80);
  Records.completed(player, 9, 200);
  Records.died(player);
  const lines = Scoreboard.lines(player);
  assert.equal(lines.get(44), '3', 'total completions');
  assert.equal(lines.get(46), '2');
  assert.equal(lines.get(47), '0:48.00', 'best delve 1 time');
  assert.equal(lines.get(70), '1', 'deep delves');
  assert.equal(lines.get(14), '2', 'world delve 1 completions');
  assert.equal(lines.get(72), '9', 'deepest delve');
  assert.equal(lines.get(74), '1', 'deaths');
  Scoreboard.read({ player, option: 'General-stats' });
  assert.equal(player.interfaces.at(-1), 920);
});

// ------------------------------------------------------------------ the second capture

test('the burrowed eye: compass direction, as far as the player plus four (capture, both zooms)', () => {
  const { player, run } = runAt(5);
  run.attacks.phase = 'burrow';
  const deep = (x, y) => Shared.shift({ x, y }, true);
  // Zoom 1: centre (1311, 9573), player at (1308, 9579): it stopped with its south-west tile at (1299, 9581).
  let at = deep(1308, 9579);
  player.location = new Location(at.x, at.y, 0);
  run.burrow.aim();
  let end = run.burrow.step.path.at(-1);
  assert.deepEqual(Shared.frame(end), { x: 1299, y: 9581, z: 0 });
  // Zoom 2: from (1299, 9581), player at (1309, 9581): it stopped at (1311, 9581).
  const from = deep(1299, 9581);
  run.boss.location = new Location(from.x, from.y, 0);
  at = deep(1309, 9581);
  player.location = new Location(at.x, at.y, 0);
  run.burrow.aim();
  end = run.burrow.step.path.at(-1);
  assert.deepEqual(Shared.frame(end), { x: 1311, y: 9581, z: 0 });
  assert.equal(Burrow.speed(5), 4, '4 tiles a tick (capture)');
  run.end('exit');
});

test('acid goes one way for a whole delve, with 2 blobs at delve 3 and 3 from delve 4 (capture)', () => {
  const Acid = require('../plugins/bosses/doom/DoomAcid');
  assert.deepEqual([3, 4, 7, 8].map(Acid.extraBlobs), [1, 2, 2, 3]);
  const { player, run } = runAt(4);
  run.attacks.active = true;
  run.attacks.nextAt = Infinity;
  run.attacks.nextShockwaveAt = Infinity;
  const { CombatType } = PluginManager.getCoreApi();
  const direction = run.acid.direction;
  for (let hit = 0; hit < 4; hit++) hitBoss(run, player, CombatType.RANGED, 10);
  ticks(1);
  const centre = { x: run.boss.location.getX() + 2, y: run.boss.location.getY() + 2 };
  for (const key of run.acid.pools.keys()) {
    const [x, y] = key.split(',').map(Number);
    const out = direction.dx !== 0 ? (x - centre.x) * direction.dx : (y - centre.y) * direction.dy;
    assert.ok(out >= 1, `${key} lies ${direction.name} of the Doom`);
  }
  const edge = { x: centre.x + direction.dx * 3, y: centre.y + direction.dy * 3 };
  assert.ok(run.acid.has(edge.x, edge.y), 'always the tile past its edge');
  run.hazards.addRock(edge);
  assert.ok(!run.acid.has(edge.x, edge.y), 'a rock covers the acid');
  run.hazards.breakRockAt(edge.x, edge.y);
  assert.ok(run.acid.has(edge.x, edge.y), 'and it is back when the rock breaks');
  run.end('exit');
});

test('rocks and orbs by delve (capture)', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(Hazards.rockPieces), [8, 12, 15, 17, 18]);
  assert.deepEqual([0, 1, 2].map((index) => Hazards.rockOrbFlight(4, index).end), [90, 120, 150]);
  assert.deepEqual([0, 1].map((index) => Hazards.rockOrbFlight(2, index).end), [150, 180]);
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => Boss.orbFlight(level).end), [205, 205, 175, 175, 145]);
});

test('coloured larvae show the prayers they use (capture: 6 melee, 7 magic, 8 ranged)', () => {
  const { player, run } = runAt(4);
  player.location = new Location(run.tile({ x: 1311, y: 9565 }).x, run.tile({ x: 1311, y: 9565 }).y, 0);
  for (let attempt = 0; attempt < 12; attempt++) run.hazards.spawnLarva({ shield: true });
  const icons = { [Shared.NPC.LARVA_MELEE]: 6, [Shared.NPC.LARVA_MAGIC]: 7, [Shared.NPC.LARVA_RANGED]: 8 };
  for (const larva of run.hazards.larvae) assert.equal(larva.headIcon, icons[larva.id]);
  run.end('exit');
});

test('death puts the player by the gap (capture)', () => {
  const { player } = surfacedRun();
  Delve.dieInRun({ player, handled: false });
  assert.deepEqual([player.location.getX(), player.location.getY()], [1313, 9555]);
  assert.equal(Run.runOf(player), null);
  assert.equal(player.varps.get(Shared.VARP.CURRENT_LEVEL), 0);
});

test('a zoom glides once a tick, breaking rocks and trampling the player along the way', () => {
  const { player, run } = runAt(5);
  run.attacks.phase = 'burrow';
  const start = run.boss.location;
  // Eight tiles west in two ticks; the player and a rock stand in the way of the first stretch.
  const path = Array.from({ length: 8 }, (_, index) => ({ x: start.getX() - 1 - index, y: start.getY() }));
  run.burrow.step = { name: 'move', at: run.ticks, path, travelled: 8, trampled: false };
  run.burrow.zoomsLeft = 2;
  const standing = new Location(start.getX() - 3, start.getY() + 2, 0);
  player.location = standing;
  run.hazards.addRock({ x: start.getX() - 2, y: start.getY() + 4 });
  const hurt = player.damage.length;
  run.burrow.move();
  assert.equal(run.boss.exactMoves.length, 1, 'one glide for the tick');
  assert.equal(run.boss.location.getX(), start.getX() - 4, 'four tiles on');
  assert.equal(run.hazards.rocks.length, 0, 'the rock it passed broke');
  assert.deepEqual(player.damage.slice(hurt), [10], 'trampled once (10 at delve 5)');
  player.location = new Location(start.getX() - 20, start.getY(), 0);
  run.burrow.move();
  assert.equal(run.boss.exactMoves.length, 2);
  assert.ok(run.boss.exactMoves[1].from.equals(run.boss.exactMoves[0].to));
  assert.equal(run.boss.location.getX(), start.getX() - 8);
  assert.equal(player.damage.length, hurt + 1, 'not trampled twice in a zoom');
  run.end('exit');
});

// ------------------------------------------------------------------ bars, colours, splats

test('the melee charge fills its bar (81, 390 cycles); a punish empties it and adds a bonus splat (17)', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = surfacedRun();
  run.attacks.active = true;
  run.attacks.startCharge();
  assert.deepEqual(run.boss.headbars.at(-1), { id: 81, fill: 0, endFill: 100, duration: 390 });
  player.strength = 115;
  hitBoss(run, player, CombatType.MELEE, 10);
  assert.deepEqual(run.boss.headbars.at(-1), { id: 81, fill: 0, endFill: 0, duration: 1 }, 'emptied');
  ticks(1);
  assert.deepEqual(run.boss.splats.at(-1), { damage: 23, splat: 17 }, 'floor(115 / 5) as a bonus hitsplat');
  run.end('exit');
});

test('the shield turns the HUD blue, shows its points on headbar 11, and larvae burst on it as 17s', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = runAt(3);
  run.attacks.active = true;
  player.colours.length = 0;
  run.attacks.phase = 'shield';
  run.shield.start();
  assert.deepEqual(player.colours, [[13, 132], [14, 623], [15, 853]], 'blue (capture)');
  assert.deepEqual(player.scriptArgs.at(-1)[0], 2102);
  assert.deepEqual(run.boss.headbars.at(-1), { id: 81, fill: 0, endFill: 100, duration: 510 });
  player.weapon = 29591;
  hitBoss(run, player, CombatType.RANGED, 43);
  assert.deepEqual(run.boss.displayed.at(-1), { current: 457, max: 500, bar: { id: 11, width: 120 } });
  assert.equal(run.boss.headbars.filter((bar) => bar.duration === 510).length, 2, 'the hit restarts the charge bar');
  run.shield.larvaBurst();
  assert.deepEqual(run.boss.shown.at(-1), { damage: 100, splat: 17, health: { current: 357, max: 500, bar: { id: 11, width: 120 } } });
  player.colours.length = 0;
  run.shield.damage(1000);
  assert.deepEqual(player.colours, [[13, 25600], [14, 576], [15, 800]], 'back to normal');
  run.end('exit');
});

test('burrowing shakes the camera until it turns, then runs a 600-cycle charge bar', () => {
  const { player, run } = runAt(5);
  run.attacks.active = true;
  run.attacks.phase = 'burrow';
  run.burrow.start();
  assert.deepEqual(player.camera, [['shake', 0, 5], ['shake', 1, 5], ['shake', 2, 5]], 'capture: random 5 on each axis');
  ticks(5);
  assert.deepEqual(player.camera.at(-1), ['reset']);
  assert.deepEqual(run.boss.headbars.at(-1), { id: 81, fill: 0, endFill: 100, duration: 600 });
  run.end('exit');
});

test('a larva reaching the Doom shows its heal as a heal splat (6)', () => {
  const { run } = surfacedRun();
  run.boss.hp = 400;
  const larva = run.spawnNpc(Shared.NPC.LARVA, { x: 1311, y: 9573 });
  larva.__doomLarva = { protect: null, movedAt: 0, born: 0 };
  run.hazards.larvae.add(larva);
  run.hazards.larvaReached(larva);
  assert.deepEqual(run.boss.shown.at(-1), { damage: 10, splat: 6, health: undefined });
  run.end('exit');
});

test('killing it with a melee punish throws holy water: acid around it goes, and the player is restored', () => {
  const HolyWater = require('../plugins/bosses/doom/DoomHolyWater');
  const { player, run } = runAt(3);
  run.attacks.active = true;
  const centre = { x: run.boss.location.getX() + 2, y: run.boss.location.getY() + 2 };
  for (let x = centre.x - 8; x <= centre.x + 8; x++) for (let y = centre.y - 8; y <= centre.y + 8; y++) run.acid.place({ x, y, z: 0 });
  const acid = run.acid.pools.size;
  player.hp = 50;
  run.punishedAt = run.ticks;
  assert.ok(HolyWater.punishKill(run));
  run.defeated();
  ticks(2);
  assert.equal(player.hp, 78, '+28 hitpoints');
  assert.equal(player.prayer, 44, '+14 prayer');
  assert.equal(player.special, 75, '+25% special attack');
  assert.ok(run.acid.pools.size < acid, 'acid cleared where it landed');

  const { run: later } = runAt(9);
  later.punishedAt = later.ticks;
  assert.ok(!HolyWater.punishKill(later), 'not past delve 8');
  later.end('exit');
  run.end('exit');
});

test('the HUD opens as the capture does: hp hidden at the delve change, then colours, 2376 and a fade-in', () => {
  const player = fakePlayer();
  const run = Run.start(player);
  assert.deepEqual(player.hudLog.slice(0, 2), [['hide', 5, true], ['script', 2249, (303 << 16) | 1]], 'hp hidden, container emptied');
  player.hudLog.length = 0;
  player.dialogueActive = false;
  ticks(1);
  assert.deepEqual(player.hudLog, [
    ['colour', 13, 25600], ['colour', 14, 576], ['colour', 15, 800],
    ['script', 2376, (303 << 16) | 3],
    ['script', 2887, 254],
  ], 'no un-hiding before 2376, and no 2102 on open');
  run.end('exit');
});

test('the shield loops its charge each tick (12409 with 3412) and a demonbane hit cancels it (12410)', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = runAt(3);
  run.attacks.active = true;
  run.attacks.phase = 'shield';
  run.shield.start();
  run.shield.nextLarvaAt = Infinity;
  run.boss.anims.length = 0;
  run.boss.gfx.length = 0;
  ticks(2);
  assert.deepEqual(run.boss.anims, [12409, 12409]);
  assert.deepEqual(run.boss.gfx, [3412, 3412]);
  player.weapon = 29591;
  hitBoss(run, player, CombatType.RANGED, 20);
  assert.equal(run.boss.anims.at(-1), 12410, 'the hit cancels the charge');
  run.boss.anims.length = 0;
  ticks(1);
  assert.deepEqual(run.boss.anims, [12409], 'and it loops again the tick after');
  run.end('exit');
});


// ------------------------------------------------------------------ larvae, timing, accuracy, facing

test('larvae crawl (capture: every larva step is a crawl)', () => {
  const { player, run } = surfacedRun();
  player.location = new Location(1311, 9565, 0);
  run.hazards.spawnLarva();
  assert.equal([...run.hazards.larvae][0].crawling, true);
  run.end('exit');
});

test('after a rock throw the next orb lands after the rock\'s last orb (capture: 12 ticks at delve 5)', () => {
  const { player, run } = runAt(5);
  const south = Shared.shift({ x: 1311, y: 9562 }, true);
  player.location = new Location(south.x, south.y, 0);
  const attacks = run.attacks;
  attacks.active = true;
  attacks.nextShockwaveAt = Infinity;
  attacks.shieldDue = () => false;
  attacks.sinceRock = 3;
  attacks.nextAt = run.ticks;
  const orbLands = [];
  const orb = attacks.orb.bind(attacks);
  attacks.orb = (style) => { orbLands.push(run.ticks + Math.ceil(Boss.orbFlight(run.level).end / 30)); orb(style); };
  const thrownAt = run.ticks;
  ticks(1);
  assert.equal(attacks.sinceRock, 0, 'it threw a rock');
  ticks(30);
  assert.ok(attacks.rockOrbsLandAt > thrownAt, 'the rock\'s orbs flew');
  assert.ok(orbLands.length >= 1, 'then an orb');
  assert.ok(orbLands[0] > attacks.rockOrbsLandAt, `orb lands at ${orbLands[0]}, the rock's last at ${attacks.rockOrbsLandAt}`);
  run.end('exit');
});

test('larvae and volatile earth can be hit on cooldown; demonbane leaves the timer alone', () => {
  const { player, run } = surfacedRun();
  player.location = new Location(1311, 9565, 0);
  run.hazards.spawnLarva();
  const larva = [...run.hazards.larvae][0];
  const timing = (target) => {
    const event = { attacker: player, target, method: null, ignoreDelay: false, keepDelay: false };
    for (const handler of hooks.timing) handler(event);
    return [event.ignoreDelay, event.keepDelay];
  };
  player.weapon = 4151;
  assert.deepEqual(timing(larva), [true, false], 'any weapon: on cooldown, then its normal delay');
  player.weapon = 29591;
  assert.deepEqual(timing(larva), [true, true], 'demonbane: no delay after');
  const earth = run.spawnNpc(Shared.NPC.VOLATILE_EARTH ?? 14714, { x: 1305, y: 9565 });
  earth.__doomEarth = true;
  assert.deepEqual(timing(earth), [true, true]);
  assert.deepEqual(timing(run.boss), [false, false], 'not the Doom');
  run.end('exit');
});

test('attacks while it charges are 100% accurate: melee in the melee charge, any while burrowed', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = runAt(5);
  const roll = (type) => {
    const event = { attacker: player, target: run.boss, combatType: type, forceAccurate: false, bypassProtectionPrayer: false };
    for (const handler of hooks.roll) handler(event);
    return event.forceAccurate;
  };
  assert.equal(roll(CombatType.MELEE), false, 'not charging');
  run.attacks.active = true;
  run.attacks.phase = 'attacks';
  run.attacks.startCharge();
  assert.equal(roll(CombatType.MELEE), true);
  assert.equal(roll(CombatType.RANGED), false, 'only melee in the melee charge');
  run.attacks.endCharge();
  run.attacks.phase = 'burrow';
  run.burrow.restartCharge();
  assert.equal(roll(CombatType.RANGED), true, 'burrowed: any style');
  assert.equal(roll(CombatType.MAGIC), true);
  run.end('exit');
});

test('burrowed it isn\'t locked on: it faces its stopping corner, then the player\'s tile once (capture)', () => {
  const { player, run } = runAt(5);
  run.boss.tickOf = () => run.ticks;
  run.attacks.active = true;
  const south = Shared.shift({ x: 1311, y: 9564 }, true);
  player.location = new Location(south.x, south.y, 0);
  run.boss.setMobileInteraction(player);
  run.attacks.phase = 'shield';
  run.shield.start();
  run.shield.damage(500);
  assert.equal(run.attacks.phase, 'burrow');
  assert.equal(run.boss.facing, null, 'the lock is cleared as it burrows');
  ticks(5 + Burrow.BURROW.firstEye);
  assert.equal(run.boss.facing, null, 'and stays cleared');
  assert.equal(run.boss.faced.length, 1, 'the eye: it faces where it stops');
  const path = run.burrow.step.path;
  assert.deepEqual([run.boss.faced[0].x, run.boss.faced[0].y], [path.at(-1).x, path.at(-1).y], 'the corner tile');
  while (run.burrow.step?.name !== 'wait' && run.ticks < 200) ticks(1);
  const stopped = run.boss.exactMoves.at(-1).tick;
  ticks(1);
  const last = run.boss.faced.at(-1);
  assert.equal(last.tick, stopped + 1, 'the tick after it stops');
  assert.deepEqual([last.x, last.y], [player.location.getX(), player.location.getY()], 'the player\'s tile');
  while (run.attacks.phase === 'burrow' && run.ticks < 300) ticks(1);
  assert.equal(run.attacks.phase, 'attacks', 'surfaced');
  ticks(1);
  assert.equal(run.boss.facing, player, 'locked on again');
  run.end('exit');
});

test('the burrow hole is used from wherever it is clicked, without walking to it', () => {
  const { player, run } = runAt(2);
  player.location = new Location(run.tile({ x: 1311, y: 9561, z: 0 }).x, run.tile({ x: 1311, y: 9561, z: 0 }).y, 0);
  const route = (objectId) => {
    const event = { player, objectId, clickType: 1, destination: null };
    for (const handler of hooks.route) handler(event);
    return event.destination;
  };
  assert.deepEqual(route(Shared.OBJECT.BURROW_HOLE), { x: player.location.getX(), y: player.location.getY(), z: 0 }, 'its own tile: no walk');
  assert.equal(route(Shared.OBJECT.GAP_EXIT), null, 'other locs are walked to');
  run.end('exit');
});
