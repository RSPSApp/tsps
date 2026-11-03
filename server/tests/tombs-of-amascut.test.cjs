// Run after `yarn build`: node --test tests/tombs-of-amascut.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NpcIdentifiers: Npcs } = require('../dist/util/NpcIdentifiers');

const NOTED_DUNG = () => {
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const noted = ItemDefinition.forId(I.FOSSILISED_DUNG)?.getNoteId?.() ?? -1;
  return noted > 0 ? noted : I.FOSSILISED_DUNG;
};

test("Tombs of Amascut NPCs don't block or die with the player's animations", () => {
  CachePipeline.initialize();
  new NpcDefinitionLoader().load();
  const anims = (id) => [NpcDefinition.forId(id).getDefenceAnim(), NpcDefinition.forId(id).getDeathAnim()];
  // Without their own, they fell back to the player's block (424) and death (836).
  assert.deepEqual(anims(Npcs.ZEBAK_2), [-1, 9634], 'NPC_ZEBAK01_DEATH; Zebak has no block animation');
  assert.deepEqual(anims(Npcs.KEPHRI), [-1, 9582], 'NPC_KEPHRI_DEATH');
  assert.deepEqual(anims(Npcs.BABOON_BRAWLER), [-1, 9755], 'NPC_MANDRILL_DESPAWN02');
  assert.deepEqual(anims(Npcs.SOLDIER_SCARAB), [-1, 9590], 'NPC_SCARAB_DEATH');
  for (let id = 11689; id <= 11804; id++) {
    const definition = NpcDefinition.forId(id);
    if (!definition?.getName?.() || definition.getName() === 'null') continue;
    assert.notEqual(definition.getDefenceAnim(), 424, `${id} ${definition.getName()} blocks like a player`);
    assert.notEqual(definition.getDeathAnim(), 836, `${id} ${definition.getName()} dies like a player`);
  }
});

test('the chest follows the Wiki: unique and pet chances, and the unique weights by raid level', () => {
  const Rewards = require('../plugins/minigames/toa/Loot.TombsOfAmascut');
  // 1% per 10,500 - 20 x RL points, RL scaled at 310 (a third) and 430 (a sixth).
  assert.equal(Rewards.uniqueChancePercent(20000, 300).toFixed(2), (20000 / 4500).toFixed(2));
  assert.equal(Rewards.uniqueChancePercent(20000, 430).toFixed(4), (20000 / (10500 - 20 * 350)).toFixed(4));
  assert.equal(Rewards.uniqueChancePercent(90000, 600), Rewards.uniqueChancePercent(64000, 600), 'points capped at 64,000');
  // 1% per 350,000 - 700 x RL points, RL scaled at 400 and 550.
  assert.equal(Rewards.petChancePercent(35000, 0).toFixed(2), '0.10', '35,000 points at raid level 0');
});

test('reward points: a 5,000 start, room points capped and added on completion, and the MVP bonus (Wiki)', () => {
  const { Raid } = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  const a = { name: 'a' };
  const b = { name: 'b' };
  const room = { def: { key: 'CRONDIS_PUZZLE', puzzle: true, path: 'CRONDIS' } };
  const members = new Map([[a, { points: 5000, roomPoints: 0, roomScores: [], tallies: {} }], [b, { points: 5000, roomPoints: 0, roomScores: [], tallies: {} }]]);
  const raid = Object.assign(Object.create(Raid.prototype), {
    players: [a, b], members, member: (player) => members.get(player), roomFor: () => room,
  });
  raid.addPoints(a, 25000);
  raid.addPoints(b, 1000);
  assert.equal(members.get(a).roomPoints, 20000, 'a room caps at 20,000');
  assert.equal(members.get(a).points, 5000, 'nothing counts until the room is completed');
  raid.completeRoomPoints(room);
  assert.equal(members.get(a).points, 5000 + 20000 + 400 + 300 * 2, 'room points, Crondis completion and the MVP bonus');
  assert.equal(members.get(b).points, 5000 + 1000 + 400);
  assert.equal(raid.lootPoints(a), 20000 + 400 + 600, 'the 5,000 start is taken off for the loot');
});

test('returning from a path lands on free Nexus floor, never inside its doorway', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { Location } = require('../dist/game/model/Location');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  CachePipeline.initialize();
  RegionManager.init();
  Shared.bind({ core: PluginManager.getCoreApi() });
  for (const path of Shared.PATHS) {
    for (let dx = 0; dx <= path.spread; dx++) {
      const tile = new Location(path.back.x + dx, path.back.y, 0);
      assert.ok(Shared.floorFree(null, tile), `${path.name}: (${tile.getX()}, ${tile.getY()}) is blocked`);
    }
  }
});

test('::toaskiptoreward can force a unique and the pet to one player', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  const Rewards = require('../plugins/minigames/toa/Loot.TombsOfAmascut');
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent: () => {} });
  const playerStub = () => {
    const attributes = new Map();
    const empty = { contains: () => false };
    return {
      getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
      getInventory: () => empty, getEquipment: () => empty, getBank: () => empty,
    };
  };
  const a = playerStub();
  const b = playerStub();
  // No points at all: without forcing, there would be no purple and no pet.
  const raid = {
    players: [a, b], raidLevel: 0, totalDeaths: 1, lootPoints: () => 0,
    settings: { isActive: () => false },
    forcedLoot: { player: b, unique: I.TUMEKENS_SHADOW_UNCHARGED_, pet: true },
  };
  const { uniqueWinner, uniqueId, petWinner } = Rewards.rollRaidLoot(raid);
  assert.equal(uniqueWinner, b);
  assert.equal(uniqueId, I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(petWinner, b);
  // Wiki: the unique waits in the sarcophagus; the finder's chest has no common rolls.
  const ids = Rewards.lootOf(b).map((entry) => entry.id);
  assert.equal(Rewards.sealedUnique(b), I.TUMEKENS_SHADOW_UNCHARGED_, 'the unique is sealed in the sarcophagus');
  assert.ok(!ids.includes(I.TUMEKENS_SHADOW_UNCHARGED_), 'not in the chest');
  assert.ok(!ids.includes(NOTED_DUNG()), 'and no fossilised dung in its place');
  assert.ok(ids.includes(I.TUMEKENS_GUARDIAN), 'the pet is in the chest');
  assert.ok(Rewards.hasRewards(b));
  // Tertiaries (the thread, a jewel) may come too: they're rolled whatever the points.
  assert.equal(Rewards.lootOf(a)[0].id, NOTED_DUNG(), 'noted (Wiki)');
  // Opening it (or the lobby chest) moves the unique to the front of the loot.
  assert.equal(Rewards.unsealUnique(b), I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(Rewards.lootOf(b)[0].id, I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(Rewards.sealedUnique(b), -1);
});

test('the collection log gets the loot when it is claimed (as in OSRS), once; the pet winner rolls only the pet', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  const Rewards = require('../plugins/minigames/toa/Loot.TombsOfAmascut');
  const events = [];
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent: (name, event) => events.push({ name, ...event, drops: event.drops && [...event.drops] }) });
  const playerStub = () => {
    const attributes = new Map();
    const empty = { contains: () => false };
    return {
      getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
      getInventory: () => empty, getEquipment: () => empty, getBank: () => empty,
    };
  };
  const a = playerStub();
  const b = playerStub();
  Rewards.rollRaidLoot({
    players: [a, b], raidLevel: 0, totalDeaths: 1, lootPoints: () => 0,
    settings: { isActive: () => false },
    forcedLoot: { player: b, unique: I.TUMEKENS_SHADOW_UNCHARGED_, pet: true },
  });
  const logged = (player) => events.filter((e) => e.name === 'collection-log:obtain' && e.player === player).map((e) => e.itemId);
  assert.deepEqual(logged(a), [], 'nothing as the loot is rolled');
  assert.deepEqual(logged(b), []);
  const rolls = events.filter((e) => e.name === 'npc-drops:roll');
  assert.deepEqual(rolls.map((e) => [e.player, e.drops.map((d) => d.id)]), [[b, [I.TUMEKENS_GUARDIAN]]], 'only the pet is rolled');
  // Searching the sarcophagus (or opening a chest) opens the loot.
  Rewards.unsealUnique(b);
  Rewards.logClaimed(b);
  Rewards.logClaimed(a);
  assert.equal(logged(a)[0], NOTED_DUNG());
  assert.ok(logged(b).includes(I.TUMEKENS_SHADOW_UNCHARGED_), 'the shadow, once the sarcophagus is searched');
  const before = events.length;
  Rewards.logClaimed(b);
  assert.equal(events.length, before, 'reopening logs nothing again');
});

test('floor decorations block only with blockWalk 1, so the Scabaras pressure plates are walkable', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { Location } = require('../dist/game/model/Location');
  CachePipeline.initialize();
  RegionManager.init();
  const FLOOR_DECORATION = 0x40000;
  const area = new PrivateArea([]);
  // 45351 (a sum puzzle pressure plate) is interactive, but its blockWalk is 0.
  ObjectManager.register(new GameObject(45351, new Location(3541, 5285, 0), 22, 1, area), true);
  assert.equal(RegionManager.getClipping(3541, 5285, 0, area) & FLOOR_DECORATION, 0, 'a plate is walked on');
  // One with blockWalk 1 still blocks (154, Rocks).
  assert.equal(ObjectDefinition.forId(154).clipType, 1);
  ObjectManager.register(new GameObject(154, new Location(3542, 5285, 0), 22, 0, area), true);
  assert.equal(RegionManager.getClipping(3542, 5285, 0, area) & FLOOR_DECORATION, FLOOR_DECORATION);
});

test("boss drops (Wiki): the capture book for those without it, the trophy for the top damager", () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  const { Room } = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  const core = PluginManager.getCoreApi();
  const dropped = [];
  Shared.bind({
    core: { ...core, ItemOnGroundManager: { registerLocation: (player, item) => dropped.push([player.name, item.getId()]) } },
  });
  const player = (name, { varbit = 0, banked = false } = {}) => {
    const none = { contains: () => false };
    return {
      name,
      getPacketSender: () => ({ getVarbit: () => varbit }),
      getInventory: () => none,
      getBank: () => ({ contains: () => banked }),
    };
  };
  const a = player('a');
  const b = player('b', { banked: true });
  const c = player('c', { varbit: 1 });
  const zebak = { __toaDamageBy: new Map([[a, 120], [b, 300], [c, 50]]) };
  const room = Object.assign(Object.create(Room.prototype), {
    def: { key: 'CRONDIS_BOSS', osmumten: { x: 3928, y: 5408, z: 0 } },
    roomPlayers: () => [a, b, c],
    lootSource: () => zebak,
    raid: { area: null },
  });
  Object.defineProperty(room, 'key', { value: 'CRONDIS_BOSS' });
  room.dropBossLoot();
  // Crondis' capture (27308) to a only (b banked it, c read it); the Fang (27219) to b, the top damager.
  assert.deepEqual(dropped, [['a', 27308], ['b', 27219]]);
  Shared.bind({ core });
});

test("the party panel's buttons follow the cache: Accept 36-43, Decline 44-51, invocations from 52", () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const Lobby = require('../plugins/minigames/toa/Lobby.TombsOfAmascut');
  const Parties = require('../plugins/minigames/toa/Parties.TombsOfAmascut');
  CachePipeline.initialize();
  const buttons = new Map();
  const noop = () => {};
  const api = new Proxy({ core: PluginManager.getCoreApi() }, {
    get: (target, key) => key in target ? target[key]
      : key === 'onInterfaceActionButton' ? (uid, handler) => buttons.set(uid, handler) : noop,
  });
  Lobby(api);
  const fakePlayer = (name) => {
    const attributes = new Map();
    const sender = new Proxy({}, { get: (_, key) => key === 'getVarbit' ? () => 0 : () => sender });
    return {
      name, messages: [],
      getUsername: () => name, getDisplayName: () => name,
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      sendMessage(message) { this.messages.push(message); },
      getPacketSender: () => sender,
      getSkillManager: () => ({ getMaxLevel: () => 99, getCombatLevel: () => 126 }),
      getInterfaceId: () => -1,
    };
  };
  const click = buttons.get((774 << 16) | 1);
  const leader = fakePlayer('Leader');
  const party = Parties.createParty(leader);
  Parties.stateOf(leader).viewing = party;
  const first = fakePlayer('First');
  const second = fakePlayer('Second');
  party.apply(first);
  party.apply(second);

  click({ player: leader, slot: 36 });
  assert.deepEqual(party.players, [leader, first], 'Accept on the first applicant');
  click({ player: leader, slot: 44 });
  assert.deepEqual(party.applicants, [], 'Decline on the (new) first applicant');
  assert.ok(party.blocked.includes(second));

  click({ player: leader, slot: 52 });
  assert.equal(party.settings.isActive('TRY_AGAIN'), true, "the first invocation (enum 4664's first)");
  party.disband();
});

test('struct reads decode the struct archive once, so the first party (44 invocation structs) does not stall', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
  CachePipeline.initialize();
  CacheDefinitions.structArchive = undefined;
  CacheDefinitions.structParams.clear();
  const fromStore = CacheIndexDat2.fromStore;
  let reads = 0;
  CacheIndexDat2.fromStore = (...args) => { reads++; return fromStore.apply(CacheIndexDat2, args); };
  try {
    for (const id of [417, 418, 419, 420, 2971]) CacheDefinitions.getStructParams(id);
  } finally {
    CacheIndexDat2.fromStore = fromStore;
  }
  assert.equal(reads, 1, 'one decode for every struct');
  assert.equal(CacheDefinitions.getStructParams(2971).get(1160), 'Insanity');
});

test('raid scaling rounds hitpoints as the Wiki DPS calculator does; Zebak matches the checkpoints', () => {
  const { Raid } = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  const scaled = (base, raidLevel, size) => {
    const raid = Object.assign(Object.create(Raid.prototype), { settings: { raidLevel }, original: { size } });
    let hp = 0;
    raid.scale({ getDefinition: () => ({ getHitpoints: () => base }), setMaxHitpoints: (v) => { hp = v; }, setHitpoints() {}, setRollFactor() {} }, 0);
    return hp;
  };
  assert.deepEqual([scaled(580, 0, 1), scaled(580, 150, 1), scaled(580, 300, 1), scaled(580, 150, 2)], [580, 930, 1280, 1760]);
  assert.equal(scaled(150, 100, 1), 210, 'to 5 between 100 and 300');
  assert.equal(scaled(48, 100, 1), 67, 'not rounded below 100');
});

test("Zebak (Wiki, captures): rocks wear down, the first roar breaks the jugs, clouds pay for moving, the barrage, enrage and his Defence floor", () => {
  CachePipeline.initialize();
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const Raid = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  let ZebakRoom = null;
  const register = Raid.registerRoom;
  Raid.registerRoom = (key, Room) => { if (key === 'CRONDIS_BOSS') ZebakRoom = Room; };
  const noop = () => {};
  require('../plugins/minigames/toa/Zebak.TombsOfAmascut')(new Proxy({ core: PluginManager.getCoreApi() }, { get: (t, k) => k in t ? t[k] : noop }));
  Raid.registerRoom = register;
  const { Location } = require('../dist/game/model/Location');
  const hits = new Map();
  const mob = (name, x, y, hp = 100) => ({
    name, hp, max: hp, loc: new Location(x, y, 0), transform: -1,
    getHitpoints() { return this.hp; }, setHitpoints(v) { this.hp = v; },
    getMaxHitpoints() { return this.max; }, getLocation() { return this.loc; },
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (list) => hits.set(name, (hits.get(name) ?? 0) + list.reduce((s, h) => s + h.getDamage(), 0)) }) }),
    setNpcTransformationId(id) { this.transform = id; },
    getPrayerActive: () => [],
    performGraphic: noop,
    getPacketSender() { const sender = new Proxy({}, { get: () => () => sender }); return sender; },
  });
  const room = Object.assign(Object.create(ZebakRoom.prototype), {
    boulders: [], jugs: new Set(), clouds: new Set(), queued: ['waves'], specialsDone: 2, lastPhase: false, attackSpeed: 7,
    raid: { damageFactor: () => 1 }, graphic: noop, push: noop, isSwimming: () => false, objectAt: () => null,
    later: (ticks, action) => action(), breakJug: (jug) => { jug.broken = true; },
  });
  room.challengePlayers = () => [player];
  const player = mob('player', 3930, 5408, 99);

  // Each roar wave takes 50 off every rock (Wiki); the first breaks every jug a tick later (223/00014 T+38).
  const rock = mob('rock', 3927, 5410, 150);
  const jug = mob('jug', 3935, 5410, 20);
  room.boulders = [rock];
  room.jugs = new Set([jug]);
  room.scream(true);
  room.scream(false);
  assert.equal(hits.get('rock'), 100);
  assert.equal(jug.broken, true);

  // A cloud loses 2 for each tile it moves.
  const cloud = mob('cloud', 3930, 5400, 30);
  cloud.getMovementQueue = () => ({ size: () => 1 });
  cloud.__toaCloud = { delay: 4, target: player, switchTicks: 5, last: new Location(3927, 5400, 0) };
  room.clouds = new Set([cloud]);
  room.tickClouds([player]);
  assert.equal(hits.get('cloud'), 6, 'three tiles moved');

  // The barrage (Wiki): 8-11 to those not praying Magic, healing him about two thirds of it.
  const zebak = mob('zebak', 3918, 5404, 1000);
  zebak.hp = 500;
  zebak.getCurrentDefinition = () => ({ getStats: () => [0, 0, 70] });
  let defence = 70;
  zebak.getDefenceLevel = () => defence;
  zebak.setDefenceLevel = (v) => { defence = v; };
  room.zebak = zebak;
  hits.delete('player');
  room.bloodBarrage([player]);
  assert.ok(hits.get('player') >= 8 && hits.get('player') <= 11, 'an 8-11 barrage');
  assert.ok(zebak.hp > 500 && zebak.hp < 500 + hits.get('player'), 'healed by less than it dealt');

  // His Defence drains to 50 at most; at 25% he enrages and a queued special is dropped.
  defence = 40;
  zebak.hp = 240;
  room.checkPhases();
  assert.equal(defence, 50);
  assert.equal(room.lastPhase, true);
  assert.deepEqual(room.queued, []);
  assert.equal(zebak.transform, 11732, 'TOA_ZEBAK_ENRAGED');
  assert.equal(room.attackSpeed, 4);
});

function toaApi(events = []) {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent: (name, event) => events.push({ name, ...event }) });
  return Shared;
}

function playerStub(name = 'a') {
  const attributes = new Map();
  const empty = { contains: () => false, getValidItems: () => [] };
  const messages = [];
  const varbits = new Map();
  return {
    name, messages, varbits,
    getUsername: () => name,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => empty, getEquipment: () => empty, getBank: () => empty,
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.set(id, value) }),
  };
}

test('the common table follows the Wiki: 27 entries, its divisors, the cache of runes always one', () => {
  toaApi();
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const { commonTable, uniqueTable } = require('../plugins/minigames/toa/Loot.TombsOfAmascut');
  const table = commonTable(I);
  assert.equal(table.length, 27);
  const divisor = (id) => table.find(([entry]) => entry === id)[1];
  assert.equal(divisor(I.MAHOGANY_LOGS), 180);
  assert.equal(divisor(I.TOADFLAX_SEED), 2000);
  assert.equal(divisor(I.RANARR_SEED), 2500);
  assert.equal(divisor(I.TORSTOL_SEED), 3200);
  assert.equal(divisor(I.SNAPDRAGON_SEED), 3200);
  assert.equal(divisor(I.CACHE_OF_RUNES), 0);
  // The Wiki's table of chances, as weights: 24 up to 300, 22 at 350, 19 at 400, 18 at 450, 16.5 at 500.
  const weights = (level) => {
    const rows = uniqueTable(I, level);
    return { total: rows.reduce((sum, row) => sum + row.weight, 0), fang: rows.find((row) => row.id === I.OSMUMTENS_FANG).weight, light: rows.find((row) => row.id === I.LIGHTBEARER).weight };
  };
  assert.deepEqual(weights(150), { total: 24, fang: 7, light: 7 });
  assert.deepEqual(weights(350), { total: 22, fang: 6, light: 6 });
  assert.deepEqual(weights(400), { total: 19, fang: 4, light: 5 });
  assert.deepEqual(weights(450), { total: 18, fang: 4, light: 4 });
  assert.deepEqual(weights(500), { total: 16.5, fang: 3, light: 3.5 });
  assert.deepEqual(weights(600), weights(500), 'held past 500');
  assert.equal(weights(325).fang, 6.5, 'between the Wiki checkpoints');
});

test('challenge rewards (Wiki): the kit at 350, the ornament kit at 425, remnants need the path at 4, one per raid, phalanx at 500', () => {
  toaApi();
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const Rewards = require('../plugins/minigames/toa/Loot.TombsOfAmascut');
  const roll = (raidLevel, invocations, pathLevels = [0, 0, 0, 0], totalDeaths = 0) => {
    const player = playerStub();
    Rewards.rollRaidLoot({ players: [player], raidLevel, totalDeaths, lootPoints: () => 0, pathLevels, settings: { isActive: (key) => invocations.includes(key) } });
    return Rewards.lootOf(player).map((entry) => entry.id);
  };
  assert.ok(!roll(349, []).includes(I.MASORI_CRAFTING_KIT));
  assert.ok(roll(350, []).includes(I.MASORI_CRAFTING_KIT));
  assert.ok(!roll(424, []).includes(I.MENAPHITE_ORNAMENT_KIT));
  assert.ok(roll(425, []).includes(I.MENAPHITE_ORNAMENT_KIT));
  assert.ok(roll(500, []).includes(I.CURSED_PHALANX));
  assert.ok(!roll(500, [], [0, 0, 0, 0], 1).includes(I.CURSED_PHALANX), 'any death in the party loses them');
  const akkha = ['DOUBLE_TROUBLE', 'KEEP_BACK', 'STAY_VIGILANT', 'FEELING_SPECIAL'];
  const zebak = ['NOT_JUST_A_HEAD', 'ARTERIAL_SPRAY', 'BLOOD_THINNERS', 'UPSET_STOMACH'];
  const wardens = ['ANCIENT_HASTE', 'ACCELERATION', 'PENETRATION', 'OVERCLOCKED', 'OVERCLOCKED_2', 'INSANITY'];
  const het = [0, 0, 4, 0]; // Shared.PATHS' order: Apmeken, Scabaras, Het, Crondis
  assert.ok(!roll(450, akkha).includes(I.REMNANT_OF_AKKHA), 'the path must be at level 4');
  assert.ok(roll(450, akkha, het).includes(I.REMNANT_OF_AKKHA));
  assert.ok(roll(450, wardens).includes(I.ANCIENT_REMNANT), 'the Wardens need only their invocations');
  const both = roll(450, [...akkha, ...zebak], [0, 0, 4, 4]);
  assert.ok(both.includes(I.REMNANT_OF_AKKHA) && !both.includes(I.REMNANT_OF_ZEBAK), 'one a raid, Akkha first (Mod Ash)');
});

test("invocations: the Wiki's levels from the cache structs, its time penalties, its modes", () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  CachePipeline.initialize();
  const Shared = toaApi();
  const { definitions, byKey, InvocationSettings } = require('../plugins/minigames/toa/Invocations.TombsOfAmascut');
  assert.equal(definitions().length, 44);
  const wiki = {
    TRY_AGAIN: 5, PERSISTENCE: 10, SOFTCORE_RUN: 15, HARDCORE_RUN: 25, WALK_FOR_IT: 10, JOG_FOR_IT: 15, RUN_FOR_IT: 20, SPRINT_FOR_IT: 25,
    NEED_SOME_HELP: 15, NEED_LESS_HELP: 25, NO_HELP_NEEDED: 40, WALK_THE_PATH: 50, PATHSEEKER: 15, PATHFINDER: 40, PATHMASTER: 50,
    QUIET_PRAYERS: 20, DEADLY_PRAYERS: 20, ON_A_DIET: 15, DEHYDRATION: 30, OVERLY_DRAINING: 15, LIVELY_LARVAE: 5, MORE_OVERLORDS: 15,
    BLOWING_MUD: 10, MEDIC: 15, AERIAL_ASSAULT: 10, NOT_JUST_A_HEAD: 15, ARTERIAL_SPRAY: 10, BLOOD_THINNERS: 5, UPSET_STOMACH: 15,
    DOUBLE_TROUBLE: 20, KEEP_BACK: 10, STAY_VIGILANT: 15, FEELING_SPECIAL: 20, MIND_THE_GAP: 10, GOTTA_HAVE_FAITH: 10, JUNGLE_JAPES: 5,
    SHAKING_THINGS_UP: 10, BOULDERDASH: 10, ANCIENT_HASTE: 10, ACCELERATION: 10, PENETRATION: 10, OVERCLOCKED: 10, OVERCLOCKED_2: 10, INSANITY: 50,
  };
  for (const [key, level] of Object.entries(wiki)) assert.equal(byKey(key).level, level, key);
  const penalty = (key) => {
    const settings = new InvocationSettings();
    settings.set(key, true);
    return settings.timePenalty();
  };
  assert.deepEqual(['WALK_FOR_IT', 'JOG_FOR_IT', 'RUN_FOR_IT', 'SPRINT_FOR_IT'].map(penalty), [20, 30, 40, 50]);
  assert.deepEqual([149, 150, 299, 300].map(Shared.modeName), ['Entry', 'Normal', 'Normal', 'Expert']);
});

test('combat achievements: a party failure names who, a personal one says You, each once, and tasks finish only in their mode', () => {
  const events = [];
  toaApi(events);
  const CA = require('../plugins/minigames/toa/CombatAchievements.TombsOfAmascut');
  const a = playerStub('a');
  const b = playerStub('b');
  const members = new Map([[a, { failedTasks: new Set(), earnedTasks: new Set() }], [b, { failedTasks: new Set(), earnedTasks: new Set() }]]);
  const raid = { players: [a, b], failedTasks: new Set(), raidLevel: 150, member: (player) => members.get(player) };
  CA.failed(raid, 'Perfect Crondis', 'a lost water from their container.');
  CA.failed(raid, 'Perfect Crondis', 'a lost water again.');
  assert.deepEqual(a.messages, ['You have failed <col=0cc919>Perfect Crondis</col>: a lost water from their container.']);
  assert.equal(b.messages.length, 1);
  CA.failed(raid, 'Dropped the ball', 'You dropped an orb.', a);
  assert.equal(a.messages.length, 2);
  assert.equal(b.messages.length, 1);
  assert.equal(CA.live(raid, 'Dropped the ball', a), false);
  assert.equal(CA.live(raid, 'Dropped the ball', b), true);
  const finished = () => events.filter((e) => e.name === 'combat-achievements:complete').map((e) => [e.player, e.task]);
  CA.completed(raid, 'Dropped the ball');
  assert.deepEqual(finished(), [[b, 'Dropped the ball']]);
  CA.completed(raid, 'Perfect Crondis');
  assert.equal(finished().length, 1, 'failed for the party');
  CA.completed(raid, "Rockin' around the croc", [a]);
  assert.equal(finished().length, 1, 'an Expert task at raid level 150');
});

test('the composites need both tasks in one run, Insanity at Expert', () => {
  const events = [];
  toaApi(events);
  const CA = require('../plugins/minigames/toa/CombatAchievements.TombsOfAmascut');
  const a = playerStub('a');
  const members = new Map([[a, { failedTasks: new Set(), earnedTasks: new Set() }]]);
  const raid = { players: [a], failedTasks: new Set(), raidLevel: 300, member: (player) => members.get(player) };
  const tasks = () => events.filter((e) => e.name === 'combat-achievements:complete').map((e) => e.task);
  CA.completed(raid, 'Perfect Scabaras');
  assert.ok(!tasks().includes('Perfection of Scabaras'));
  CA.completed(raid, 'Perfect Kephri');
  assert.ok(tasks().includes('Perfection of Scabaras'));
  CA.completed(raid, 'Perfect Wardens');
  assert.ok(tasks().includes('Insanity'));
});

test("path levels go to each path's own varbit, and the HUD names its current path as the capture does", () => {
  const Shared = toaApi();
  const byKey = (key) => Shared.PATHS.find((path) => path.key === key);
  assert.deepEqual(['SCABARAS', 'HET', 'APMEKEN', 'CRONDIS'].map((key) => byKey(key).hud), [1, 2, 3, 4]);
  assert.deepEqual(['CRONDIS', 'SCABARAS', 'HET', 'APMEKEN'].map((key) => byKey(key).levelVarbit), [14376, 14377, 14378, 14379]);
});

test('Walk the Path raises two paths, then one and one, and says so as the boss dies', () => {
  toaApi();
  const { Raid } = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  const lines = [];
  const raid = Object.assign(Object.create(Raid.prototype), {
    settings: { isActive: (key) => key === 'WALK_THE_PATH' }, pathsCompleted: [], pathLevels: [0, 0, 0, 0],
    broadcast: (line) => lines.push(line), sendPathLevels: () => {},
  });
  raid.completePath('CRONDIS');
  assert.equal(lines.length, 2);
  assert.equal(raid.pathLevels.reduce((sum, level) => sum + level, 0), 2);
  assert.equal(raid.pathLevels[3], 0, 'never the finished path');
  raid.completePath('CRONDIS');
  assert.equal(lines.length, 2, 'once a path');
  raid.completePath('HET');
  raid.completePath('APMEKEN');
  raid.completePath('SCABARAS');
  assert.equal(raid.pathLevels.reduce((sum, level) => sum + level, 0), 4);
});

test('the unique chance follows the Wiki worked example', () => {
  toaApi();
  const { uniqueChancePercent } = require('../plugins/minigames/toa/Loot.TombsOfAmascut');
  assert.equal(uniqueChancePercent(37000, 400).toFixed(2), '10.00', 'the Wiki: 1% per 3,700 points at raid level 400');
  assert.equal(uniqueChancePercent(64000, 150), 64000 / (10500 - 3000), 'capped by points');
});

test("titles: the Wiki's conditions in the varbits' order, The Leech never for the top damager", () => {
  toaApi();
  const { TITLES } = require('../plugins/minigames/toa/Summary.TombsOfAmascut');
  assert.equal(TITLES.length, 18);
  const member = (over) => ({ damageDone: 0, damageTaken: 0, deaths: 0, tallies: {}, roomScores: [], loadoutValue: 0, ...over });
  const leech = TITLES[2];
  const low = member({ damageDone: 10, roomScores: [1, 1, 1, 1, 1] });
  const high = member({ damageDone: 99, roomScores: [9, 9, 9, 9, 9] });
  assert.equal(leech.earned(low, [low, high]), true);
  assert.equal(leech.earned(high, [low, high]), false);
  const swimmer = TITLES[0];
  assert.equal(swimmer.earned(member({ tallies: { swimTicks: 50 } }), []), true);
  assert.equal(swimmer.earned(member({ tallies: { swimTicks: 49 } }), []), false);
  assert.equal(TITLES[8].earned(member({ tallies: { orbsDropped: 21 } }), []), true, 'The Baller: more than 20');
  assert.equal(TITLES[8].earned(member({ tallies: { orbsDropped: 20 } }), []), false);
});

test("the escape crystal is the raids' one (tob_teleport), not the Gauntlet's", () => {
  CachePipeline.initialize();
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const Shared = toaApi();
  const crystal = CacheDefinitions.getItem(Shared.escapeCrystalId());
  assert.equal(crystal.name, 'Escape crystal');
  // Played over the MCP: with 25961 (gauntlet_escape_crystal, only "Activate") none of these fired.
  assert.deepEqual(crystal.inventoryActions.slice(0, 4), ['Teleport', 'Wear', 'Auto-afk', 'Configure']);
});

/** Registers a unit against a recording api: every hook call is kept by name. */
function recordingApi() {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const calls = [];
  const core = PluginManager.getCoreApi();
  const api = new Proxy({}, {
    get: (_, name) => (name === 'core' ? core : (...args) => { calls.push({ name, args }); }),
  });
  return { api, calls };
}

test("the escape crystal fires on every damage, direct hits included, and its Auto-afk check doesn't throw", () => {
  const Shared = toaApi();
  const Crystal = require('../plugins/minigames/toa/EscapeCrystal.TombsOfAmascut');
  const { api, calls } = recordingApi();
  Crystal(api);
  // Shared.damage queues raw HitDamage and never reaches the hit-modify hook (Zebak's blood barrage).
  assert.ok(calls.some((call) => call.name === 'onCustomEvent' && call.args[0] === 'combat:damage-apply'));
  assert.ok(!calls.some((call) => call.name === 'onPlayerHitModify'));
  assert.ok(!calls.some((call) => call.name === 'onItemAction' && call.args[1]?.Configure), "Configure is the crystal's own (the Theatre's unit)");
  toaApi();
  const player = playerStub('afk');
  const armed = { afk: true, delay: 30, ring: false, teammates: false };
  player.getInventory = () => ({ contains: (id) => id === Shared.escapeCrystalId() });
  // MovementQueue's isMoving is a boolean; isMovings() is the method.
  player.getMovementQueue = () => ({ isMoving: false, isMovings: () => false });
  player.__toaLoginCycle = Shared.cycle();
  assert.equal(Crystal.afkFires(player, armed), true, 'just logged in: fires at once');
  assert.equal(Crystal.afkFires(player, { ...armed, afk: false }), false, 'not armed');
  player.getMovementQueue = () => ({ isMoving: true, isMovings: () => true });
  assert.equal(Crystal.afkFires(player, armed), false, 'never while moving');
});

test("one crystal configuration serves both raids, and the Theatre's unit leaves the tombs' uses alone", () => {
  const TobCrystal = require('../plugins/minigames/tob/EscapeCrystal.TheatreOfBlood');
  const player = playerStub('both');
  player.getLocation = () => ({ getX: () => 3550, getY: () => 5161, getZ: () => 0 });
  player.setAttribute(TobCrystal.ATTR.AFK, true);
  player.setAttribute(TobCrystal.ATTR.DELAY, 2);
  player.setAttribute(TobCrystal.ATTR.TEAMMATES, true);
  const request = { player, afk: false, delay: 30, ring: false, teammates: false };
  TobCrystal.settingsOf(request);
  assert.deepEqual([request.afk, request.delay, request.ring, request.teammates], [true, 2, false, true]);
  // Played over the MCP after main's Theatre crystal arrived: Auto-afk armed at 2 seconds there was
  // invisible here, and its crystal-on-player claimed every use with "...in the Theatre of Blood".
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  const event = { player, target: playerStub('mate'), itemId: ItemIdentifiers.ESCAPE_CRYSTAL_2 };
  TobCrystal.useOnPlayer(event);
  assert.notEqual(event.handled, true);
  assert.deepEqual(player.messages, []);
});

test('leaving the raid mid-entomb lets the player walk again', () => {
  toaApi();
  const Raid = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  const rooms = new Map();
  const register = Raid.registerRoom;
  Raid.registerRoom = (key, RoomClass) => rooms.set(key, RoomClass);
  try {
    require('../plugins/minigames/toa/Wardens.TombsOfAmascut')(recordingApi().api);
  } finally {
    Raid.registerRoom = register;
  }
  toaApi();
  let blocked = true;
  const player = { getMovementQueue: () => ({ setBlockMovement: (value) => { blocked = value; } }), performAnimation: () => {} };
  const room = { stoned: new Map([[player, 999999]]) };
  rooms.get('WARDENS_P1').prototype.onPlayerLeave.call(room, player);
  assert.equal(blocked, false);
  assert.equal(room.stoned.size, 0);
  assert.equal(typeof Raid.Room.prototype.onPlayerLeave, 'function', 'every room has the hook Raid.leave calls');
});

test("the raid's supplies can't be banked, through the deposit pot or anywhere", () => {
  toaApi();
  const Nexus = require('../plugins/minigames/toa/Nexus.TombsOfAmascut');
  const { api, calls } = recordingApi();
  Nexus(api);
  toaApi();
  const refuse = calls.find((call) => call.name === 'onCanBankItem').args[0];
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const ask = (id) => {
    const event = { player: playerStub('bank'), item: { getId: () => id }, allow: null };
    refuse(event);
    return event;
  };
  const nectar = ask(I.NECTAR_4_);
  assert.equal(nectar.allow, false);
  assert.deepEqual(nectar.player.messages, ['A magical force prevents you from banking this item!']);
  assert.equal(ask(I.COINS).allow, null, 'everything else banks as normal');
});

test('the escape crystal never fires on a killing hit, and nothing lands between firing and the move out', () => {
  const Shared = toaApi();
  const Raid = require('../plugins/minigames/toa/RaidState.TombsOfAmascut');
  const Crystal = require('../plugins/minigames/toa/EscapeCrystal.TombsOfAmascut');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { Mobile } = require('../dist/game/entity/impl/Mobile');
  const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
  const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
  const { Location } = require('../dist/game/model/Location');
  const { Item } = PluginManager.getCoreApi();
  // The settings request goes through the real dispatcher here, as on the server.
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent: (name, event) => PluginManager.emitCustomEvent(name, event) });
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new Location(3550, 5161, 0)); // the Nexus, in the tombs
  player.setUsername('toacrystal');
  player.getInventory().setItem(0, new Item(Shared.escapeCrystalId(), 1));
  player.lastInputCycle = Shared.cycle() - 100; // idle a minute, past the 2 seconds
  const left = [];
  const raid = { member: () => ({ ghost: false }), players: [player], leave: (who, options) => left.push(options) };
  const raidOf = Raid.raidOf;
  Raid.raidOf = (who) => (who === player && left.length === 0 ? raid : null);
  PluginManager.customEventHooks.delete('combat:damage-apply');
  PluginManager.customEventHooks.delete('escape-crystal:settings');
  const api = PluginManager.createApi('ToaCrystalTest');
  api.onCustomEvent('combat:damage-apply', Crystal.damageApplied);
  api.onCustomEvent('escape-crystal:settings', (request) => Object.assign(request, { afk: true, delay: 2 }));
  try {
    // 5 HP and a 10: the hit kills in the raid, safely; the crystal stays and the player stays a member.
    player.setHitpoints(5);
    const lethal = new HitDamage(10, HitMask.RED);
    Mobile.prototype.decrementHealth.call(player, lethal);
    assert.equal(left.length, 0, 'no escape on the killing hit');
    assert.equal(player.getInventory().contains(Shared.escapeCrystalId()), true, 'the crystal kept');
    assert.equal(player.getHitpoints(), 0, 'the raid death goes ahead (overkill clamped to 5)');
    // A survivable hit fires it; a hit queued behind it, before the move out, lands as nothing.
    player.isDying = false;
    player.setHitpoints(50);
    Mobile.prototype.decrementHealth.call(player, new HitDamage(3, HitMask.RED));
    assert.equal(left.length, 1, 'escaped');
    assert.equal(player.getInventory().contains(Shared.escapeCrystalId()), false, 'crystal used');
    player.__toaEscapedCycle = -1; // as on a later tick: the same-tick guard isn't what stops it
    const queued = new HitDamage(60, HitMask.RED);
    Mobile.prototype.decrementHealth.call(player, queued);
    assert.equal(queued.getDamage(), 0, 'nothing lands during the teleport');
    assert.equal(player.getHitpoints(), 47);
    left[0].arrived();
    const outside = new HitDamage(4, HitMask.RED);
    Mobile.prototype.decrementHealth.call(player, outside);
    assert.equal(outside.getDamage(), 4, 'out of the tombs, hits land again');
  } finally {
    Raid.raidOf = raidOf;
    PluginManager.customEventHooks.delete('combat:damage-apply');
    PluginManager.customEventHooks.delete('escape-crystal:settings');
  }
});
