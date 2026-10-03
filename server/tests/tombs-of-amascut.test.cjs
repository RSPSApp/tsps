// Run after `yarn build`: node --test tests/tombs-of-amascut.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NpcIdentifiers: Npcs } = require('../dist/util/NpcIdentifiers');

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
  const Rewards = require('../plugins/minigames/toa/ToaRewards');
  // 1% per 10,500 - 20 x RL points, RL scaled at 310 (a third) and 430 (a sixth).
  assert.equal(Rewards.uniqueChancePercent(20000, 300).toFixed(2), (20000 / 4500).toFixed(2));
  assert.equal(Rewards.uniqueChancePercent(20000, 430).toFixed(4), (20000 / (10500 - 20 * 350)).toFixed(4));
  assert.equal(Rewards.uniqueChancePercent(90000, 600), Rewards.uniqueChancePercent(64000, 600), 'points capped at 64,000');
  // 1% per 350,000 - 700 x RL points, RL scaled at 400 and 550.
  assert.equal(Rewards.petChancePercent(35000, 0).toFixed(2), '0.10', '35,000 points at raid level 0');
});

test('reward points: a 5,000 start, room points capped and added on completion, and the MVP bonus (Wiki)', () => {
  const { Raid } = require('../plugins/minigames/toa/ToaRaid');
  const a = { name: 'a' };
  const b = { name: 'b' };
  const room = { def: { key: 'CRONDIS_PUZZLE', puzzle: true, path: 'CRONDIS' } };
  const members = new Map([[a, { points: 5000, roomPoints: 0 }], [b, { points: 5000, roomPoints: 0 }]]);
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
  const Shared = require('../plugins/minigames/toa/ToaShared');
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
  const Shared = require('../plugins/minigames/toa/ToaShared');
  const Rewards = require('../plugins/minigames/toa/ToaRewards');
  Shared.bind({ core: PluginManager.getCoreApi() });
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
  assert.ok(!ids.includes(I.FOSSILISED_DUNG), 'and no fossilised dung in its place');
  assert.ok(ids.includes(I.TUMEKENS_GUARDIAN), 'the pet is in the chest');
  assert.ok(Rewards.hasRewards(b));
  assert.deepEqual(Rewards.lootOf(a).map((entry) => entry.id), [I.FOSSILISED_DUNG]);
  // Opening it (or the lobby chest) moves the unique to the front of the loot.
  assert.equal(Rewards.unsealUnique(b), I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(Rewards.lootOf(b)[0].id, I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(Rewards.sealedUnique(b), -1);
});

test("Tumeken's shadow: its own spell, the x3 (x4 in the tombs) passive and charges (Wiki)", () => {
  // Its definition: the powered staff's styles and its own bonuses (Wiki: +35 magic attack,
  // +20 magic defence, +1 prayer, two-handed, 85 Magic).
  const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
  const raw = require('../data/definitions/item-gameplay.json');
  for (const id of [27275, 27277]) {
    const entry = raw.find((item) => item.id === id);
    assert.equal(entry.weaponInterface, 'POWERED_STAFF');
    assert.deepEqual(entry.bonuses, [0, 0, 0, 35, 0, 0, 0, 0, 20, 0, 0, 0, 0, 1]);
    assert.equal(entry.requirements[6], 85);
    assert.equal(entry.doubleHanded, true);
  }
  assert.equal(WeaponInterfaces.POWERED_STAFF.getCategory(), 24);
  assert.deepEqual(WeaponInterfaces.POWERED_STAFF.getFightType().map((type) => type.getChildId()), [0, 1, 3]);
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const { Location } = require('../dist/game/model/Location');
  const { Item } = require('../dist/game/model/Item');
  const Shared = require('../plugins/minigames/toa/ToaShared');
  const Items = require('../plugins/minigames/toa/Items.TombsOfAmascut');
  const resolvers = [];
  const providers = [];
  const updates = [];
  const api = {
    core: PluginManager.getCoreApi(),
    registerCombatMethodResolver: (resolver) => resolvers.push(resolver),
    registerBonusProvider: (provider) => providers.push(provider),
    getBonusManager: () => ({ update: (player) => updates.push(player) }),
  };
  require('../plugins/minigames/toa/Shadow.TombsOfAmascut')(api);
  Shared.bind(api);

  const staff = new Item(I.TUMEKENS_SHADOW, 1);
  staff.setMetaValue(Items.SHADOW_CHARGES_KEY, 2);
  const equipment = new Array(14).fill(null);
  equipment[3] = staff;
  let location = new Location(3200, 3200, 0);
  let castSpell = null;
  const messages = [];
  const player = {
    isPlayer: () => true, getAsPlayer: () => player,
    getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
    getLocation: () => location,
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getCombat: () => ({ setCastSpell: (spell) => { castSpell = spell; }, reset: () => {} }),
    getUpdateFlag: () => ({ flag: () => {} }),
    sendMessage: (message) => messages.push(message),
  };
  const npc = { isPlayer: () => false };

  const method = resolvers[0].resolve(player);
  assert.ok(method, 'the shadow attacks with its own method, not a kick');
  assert.equal(method.attackSpeed(player), 5);
  assert.equal(method.attackDistance(player), 8);
  const { FightType } = require('../dist/game/content/combat/FightType');
  player.getFightType = () => FightType.POWERED_STAFF_LONGRANGE;
  assert.equal(method.attackDistance(player), 10, 'Longrange reaches 2 tiles further');

  // Passive: occult (+10%) and a +35 staff: x3 outside, x4 in the tombs, damage capped at 100%.
  const bonuses = () => { const b = new Array(14).fill(0); b[3] = 35; b[12] = 10; return b; };
  let worn = bonuses();
  providers[0].apply({ player, bonuses: worn });
  assert.deepEqual([worn[3], worn[12]], [105, 30]);
  location = new Location(3700, 5200, 0);
  worn = bonuses();
  providers[0].apply({ player, bonuses: worn });
  assert.deepEqual([worn[3], worn[12]], [140, 40]);
  worn = bonuses();
  worn[12] = 40;
  providers[0].apply({ player, bonuses: worn });
  assert.equal(worn[12], 100, 'magic damage caps at 100%');

  // A cast selects its built-in spell (max hit floor(99 / 3) + 1) and spends a charge.
  assert.equal(method.canAttack(player, npc), true);
  assert.equal(castSpell.maximumHit(), 34);
  assert.equal(staff.getMetaValue(Items.SHADOW_CHARGES_KEY), 1);
  assert.equal(method.canAttack(player, npc), true);
  assert.equal(staff.getId(), I.TUMEKENS_SHADOW_UNCHARGED_, 'the last charge leaves it uncharged');
  assert.equal(method.canAttack(player, npc), false);
  assert.match(messages.at(-1), /no charges/);
  staff.setId(I.TUMEKENS_SHADOW);
  staff.setMetaValue(Items.SHADOW_CHARGES_KEY, 5);
  assert.equal(method.canAttack(player, { isPlayer: () => true }), false, 'not against players');
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
  const Shared = require('../plugins/minigames/toa/ToaShared');
  const { Room } = require('../plugins/minigames/toa/ToaRaid');
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
  const Parties = require('../plugins/minigames/toa/ToaParties');
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
      getUsername: () => name,
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
