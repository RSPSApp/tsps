// Run after `yarn build`: node --test tests/corporeal-beast.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const Shared = require('../plugins/bosses/corporealbeast/CorpShared');
const Lair = require('../plugins/bosses/corporealbeast/Lair.CorporealBeast');
const Beast = require('../plugins/bosses/corporealbeast/Beast.CorporealBeast');
const Attacks = require('../plugins/bosses/corporealbeast/CorpAttacks');
const DarkCore = require('../plugins/bosses/corporealbeast/DarkCore.CorporealBeast');
const Shields = require('../plugins/bosses/corporealbeast/SpiritShields.CorporealBeast');
const Commands = require('../plugins/bosses/corporealbeast/Commands.CorporealBeast');

const hooks = { objects: {}, zones: [], prompts: [], startup: [], methods: {}, hitModify: [], death: [] };

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onZoneEnter: (zone, handler) => hooks.zones.push({ zone, enter: handler }),
    onZoneExit: (zone, handler) => hooks.zones.push({ zone, exit: handler }),
    onServerStartup: (handler) => hooks.startup.push(handler),
    registerNpcCombatMethodProvider: (ids, Method) => { for (const id of ids) hooks.methods[id] = Method; },
    onNpcHitModify: (handler) => hooks.hitModify.push(handler),
    onNpcDeath: (handler) => hooks.death.push(handler),
    spawnNpc: ({ id, x, y, z }) => fakeNpc(id, x, y, z),
    removeNpc: (npc) => { npc.registered = false; },
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
  };
}

const worldPlayers = [];

function fakeNpc(id, x, y, z = 2) {
  const npc = {
    id, location: new Location(x, y, z), hp: 2000, max: 2000, registered: true, anims: [], flags: new Set(), delay: 0,
    getId: () => id,
    getLocation: () => npc.location,
    moveTo(location) { npc.location = location; },
    getHitpoints: () => npc.hp,
    setHitpoints(value) { npc.hp = value; },
    getMaxHitpoints: () => npc.max,
    heal(amount) { npc.hp = Math.min(npc.max, npc.hp + amount); },
    isRegistered: () => npc.registered,
    performAnimation(animation) { npc.anims.push(animation.getId?.() ?? animation.id); },
    setFlag(flag) { npc.flags.add(flag); },
    setStatRestoreTicks(ticks) { npc.statRestore = ticks; },
    setHealthBar(bar) { npc.healthBar = bar; },
    isPoisoned: () => npc.poisoned === true,
    getMovementQueue: () => ({ setBlockMovement() {} }),
    getCombat: () => ({ setAttackDelay(ticks) { npc.delay = ticks; } }),
  };
  return npc;
}

function fakePlayer({ x, y, z = 2 } = Shared.LOBBY) {
  const p = {
    hp: 99, damage: [], skills: new Map(),
    getHitpoints: () => p.hp,
    isPlayer: () => true,
    getSkillManager: () => ({ decreaseCurrentLevel: (skill, amount) => p.skills.set(skill.getIndex(), amount) }),
    location: new Location(x, y, z), messages: [], attributes: new Map(), subs: [], varbits: new Map(),
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    sendMessage: (message) => p.messages.push(message),
    getAttribute: (key) => p.attributes.get(key),
    target: null,
    getCombat: () => ({
      getTarget: () => p.target,
      getAttacker: () => null,
      getHitQueue: () => ({ addPendingDamage: (hits) => p.damage.push(...hits.map((hit) => hit.getDamage())) }),
    }),
    getPacketSender() {
      const sender = {
        sendSubInterface: (uid, id) => { p.subs.push(['open', uid, id]); return sender; },
        closeSubInterface: (uid) => { p.subs.push(['close', uid]); return sender; },
        sendVarbit: (id, value) => { p.varbits.set(id, value); return sender; },
        sendGraphic: () => sender,
        sendProjectile: () => sender,
      };
      return sender;
    },
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const object = (id, x, y) => ({ objectId: id, object: { getLocation: () => new Location(x, y, 2) } });

before(() => {
  const { World } = PluginManager.getCoreApi();
  World.getPlayers = () => worldPlayers;
  CachePipeline.initialize();
  RegionManager.init();
  const api = fakeApi();
  Lair(api);
  Beast(api);
  DarkCore(api);
});

test('the lair is multi-combat on its own plane only', () => {
  assert.equal(Wilderness.isMulti(2966, 4380, 2), true, 'capture: multi-way on arrival');
  assert.equal(Wilderness.isMulti(2994, 4381, 2), true);
  assert.equal(Wilderness.isMulti(2994, 4253, 2), true, 'the other copy');
  assert.equal(Wilderness.isMulti(2994, 4381, 0), false, 'the same x/y on the surface is not');
});

test('the lair locs are where the cache has them', () => {
  const { MapObjects } = PluginManager.getCoreApi();
  assert.ok(MapObjects.get(Shared.OBJECT.CAVE, new Location(3201, 3679, 0), null));
  assert.ok(MapObjects.get(Shared.OBJECT.CAVE_EXIT, new Location(2963, 4382, 2), null));
  assert.ok(MapObjects.get(Shared.OBJECT.PASSAGE, new Location(2971, 4382, 2), null));
});

test('the passage takes you across a tick later, either way', () => {
  const player = fakePlayer({ x: 2970, y: 4383 });
  assert.equal(hooks.objects.Passage['Go-through']({ player, ...object(Shared.OBJECT.PASSAGE, 2971, 4382) }), true);
  assert.equal(player.location.getX(), 2970, 'not yet');
  ticks(1);
  assert.deepEqual([player.location.getX(), player.location.getY()], [2974, 4383], 'capture: 2970 -> 2974');
  hooks.objects.Passage['Go-through']({ player, ...object(Shared.OBJECT.PASSAGE, 2971, 4382) });
  ticks(1);
  assert.equal(player.location.getX(), 2970, 'and back');
});

test('other "Passage" and "Cave" locs fall through', () => {
  const player = fakePlayer();
  assert.equal(hooks.objects.Passage['Go-through']({ player, ...object(1, 0, 0) }), false);
  assert.equal(hooks.objects.Cave.Enter({ player, objectId: 2 }), false);
});

test('no pets past the passage', () => {
  const player = fakePlayer({ x: 2970, y: 4383 });
  player.attributes.set('pets:current', { isRegistered: () => true });
  hooks.objects.Passage['Go-through']({ player, ...object(Shared.OBJECT.PASSAGE, 2971, 4382) });
  ticks(1);
  assert.equal(player.location.getX(), 2970);
  assert.equal(player.messages.at(-1), 'Your follower hides in fear and refuses to enter the cave.');
});

test('no entering the cave while in combat (Wiki)', () => {
  const player = fakePlayer({ x: 3201, y: 3684, z: 0 });
  player.target = {};
  hooks.objects.Cave.Enter({ player, objectId: Shared.OBJECT.CAVE });
  assert.equal(player.location.getZ(), 0);
  assert.equal(player.messages.at(-1), 'You cannot enter the cave while in combat.');
});

test('the cave leads to the lobby, and its exit asks before the Wilderness', () => {
  const player = fakePlayer({ x: 3201, y: 3684, z: 0 });
  hooks.objects.Cave.Enter({ player, objectId: Shared.OBJECT.CAVE });
  assert.deepEqual([player.location.getX(), player.location.getY(), player.location.getZ()], [2964, 4254, 2], 'the normal room');
  hooks.objects['Cave exit'].Exit({ player, objectId: Shared.OBJECT.CAVE_EXIT });
  const prompt = hooks.prompts.at(-1);
  assert.equal(prompt.title, 'This exit leads to the Wilderness, are you sure?');
  prompt.args[1]();
  assert.deepEqual([player.location.getX(), player.location.getY(), player.location.getZ()], [3206, 3681, 0]);
});

test("the Beast's room shows the damage overlay, in both copies", () => {
  const player = fakePlayer({ x: 2980, y: 4383 });
  assert.equal(hooks.zones.length, 4);
  const room = hooks.zones.filter(({ zone }) => zone === Shared.ROOM_AREAS[0]);
  room.find((hook) => hook.enter).enter({ player });
  assert.deepEqual(player.subs.at(-1), ['open', Shared.OVERLAY_HUD_UID, 13], 'capture: interface 13');
  room.find((hook) => hook.exit).exit({ player });
  assert.deepEqual(player.subs.at(-1), ['close', Shared.OVERLAY_HUD_UID]);
  assert.equal(Shared.inRoom(new Location(2974, 4383, 2)), true);
  assert.equal(Shared.inRoom(new Location(2974, 4255, 2)), true);
  assert.equal(Shared.inRoom(new Location(2970, 4383, 2)), false, 'the lobby is not the room');
});

test('the Beast spawns where the capture saw it, and respawns after 50 ticks', () => {
  const spawns = require('../data/definitions/npc-spawns.json').filter((spawn) => spawn.id === 319);
  assert.deepEqual(spawns.map(({ x, y, direction, wanderRadius }) => [x, y, direction, wanderRadius]),
    [[2994, 4253, 1, 0], [2994, 4381, 1, 0]], 'capture: 2994 4381 facing south, and the same in the other copy');
  hooks.startup.forEach((handler) => handler({}));
  assert.equal(NpcDefinition.forId(319).getRespawn(), 50);
});

// ------------------------------------------------------------------ the Beast

function inRoom(player) {
  worldPlayers.length = 0;
  worldPlayers.push(player);
  return player;
}

test('its attacks: melee 40% only in reach, otherwise one of the three magic attacks', () => {
  const corp = fakeNpc(319, 2994, 4253);
  const beside = fakePlayer({ x: 2993, y: 4255 });
  const far = fakePlayer({ x: 2980, y: 4255 });
  const corner = fakePlayer({ x: 2993, y: 4252 });
  assert.equal(Attacks.inMeleeRange(corp, beside), true);
  assert.equal(Attacks.inMeleeRange(corp, corner), false, 'not from a corner');
  assert.equal(Attacks.choose(corp, beside, () => 0.39), 'melee');
  assert.equal(Attacks.choose(corp, far, () => 0.39), 'drain', 'out of reach it is always magic');
  const picks = [0.1, 0.5, 0.9].map((roll) => Attacks.choose(corp, far, () => roll));
  assert.deepEqual(picks, ['plain', 'drain', 'split']);
});

test("the split lands in six distinct, walkable tiles within 3 (capture: six)", () => {
  const centre = { x: 2980, y: 4255, z: 2 };
  const tiles = Attacks.splitTiles(centre);
  assert.equal(tiles.length, 6);
  assert.equal(new Set(tiles.map(({ x, y }) => `${x},${y}`)).size, 6);
  for (const tile of tiles) assert.ok(Math.max(Math.abs(tile.x - centre.x), Math.abs(tile.y - centre.y)) <= 3);
});

test('melee and ranged deal half unless a Corpbane weapon stabs; magic is full', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const player = (name, bonusType) => ({
    getEquipment: () => ({ getItems: () => { const items = []; items[3] = { getId: () => 1, getDefinition: () => ({ getName: () => name }) }; return items; } }),
    getFightType: () => ({ getBonusType: () => bonusType }),
  });
  assert.equal(Beast.halved(player('Zamorakian spear', 0), CombatType.MELEE), false);
  assert.equal(Beast.halved(player("Osmumten's fang", 0), CombatType.MELEE), false);
  assert.equal(Beast.halved(player('Zamorakian spear', 1), CombatType.MELEE), true, 'a spear on slash is halved');
  assert.equal(Beast.halved(player('Abyssal whip', 0), CombatType.MELEE), true);
  assert.equal(Beast.halved(player('Zamorakian hasta', 0), CombatType.MELEE), true, 'hastas are not Corpbane');
  assert.equal(Beast.halved(player('Twisted bow', 0), CombatType.RANGED), true);
  assert.equal(Beast.halved(player('Trident', 0), CombatType.MAGIC), false);
});

test('a blow on it is halved and counted on the overlay', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const corp = fakeNpc(319, 2994, 4253);
  const player = fakePlayer({ x: 2990, y: 4255 });
  player.getEquipment = () => ({ getItems: () => [] });
  player.getFightType = () => ({ getBonusType: () => 1 });
  const parts = [{ value: 30, getDamage() { return this.value; }, setDamage(v) { this.value = v; } }];
  const hit = { getAttacker: () => player, getCombatType: () => CombatType.MELEE, getHits: () => parts, updateTotalDamage() {}, getTotalDamage: () => parts[0].value };
  hooks.hitModify.forEach((handler) => handler({ npc: corp, hit }));
  assert.equal(parts[0].value, 15);
  assert.equal(player.varbits.get(999), 15);
  hooks.hitModify.forEach((handler) => handler({ npc: corp, hit }));
  assert.equal(player.varbits.get(999), 22, 'it adds up');
  hooks.death.forEach((handler) => handler({ npc: corp }));
  assert.equal(player.varbits.get(999), 0, 'and starts again when it dies');
});

test('every 7 ticks: a stomp for whoever is under it', () => {
  const corp = fakeNpc(319, 2994, 4253);
  const under = inRoom(fakePlayer({ x: 2996, y: 4255 }));
  for (let i = 0; i < 6; i++) Beast.tickBeast(corp);
  assert.equal(under.damage.length, 0);
  Beast.tickBeast(corp);
  assert.equal(under.damage.length, 1);
  assert.ok(under.damage[0] >= 30 && under.damage[0] <= 51);
  assert.ok(corp.anims.includes(1686));
  assert.equal(under.messages.at(-1), "You get trampled under the Beast's massive legs.");
  assert.equal(corp.statRestore, 20, 'drained stats come back every 20 ticks');
  assert.deepEqual(corp.healthBar, { id: 22, width: 160 }, 'capture: headbar 22, 160 wide');
});

test('an empty room heals it 75, then 10 more each time', () => {
  const corp = fakeNpc(319, 2994, 4253);
  corp.hp = 1000;
  worldPlayers.length = 0;
  for (let i = 0; i < 21; i++) Beast.tickBeast(corp);
  assert.equal(corp.hp, 1000 + 75 + 85 + 95);
  const crowd = Array.from({ length: 8 }, () => fakePlayer({ x: 2985, y: 4255 }));
  worldPlayers.push(...crowd);
  corp.hp = 1000;
  for (let i = 0; i < 7; i++) Beast.tickBeast(corp);
  assert.equal(corp.hp, 1040, '8 players: 5 each');
});

// ------------------------------------------------------------------ the dark core

test('the core: 1/8 on a hit of 32+, or an attack under 1,000', () => {
  const corp = fakeNpc(319, 2994, 4253);
  inRoom(fakePlayer({ x: 2985, y: 4258 }));
  DarkCore.beastHit(corp, 31, () => 0);
  assert.equal(DarkCore.coreOf(corp), null, 'too small a hit');
  DarkCore.beastHit(corp, 40, () => 0.5);
  assert.equal(DarkCore.coreOf(corp), null, 'the roll failed');
  DarkCore.beastAttacks(corp, () => 0);
  assert.equal(DarkCore.coreOf(corp), null, 'healthy enough');
  corp.hp = 999;
  DarkCore.beastAttacks(corp, () => 0);
  assert.ok(DarkCore.coreOf(corp));
  assert.equal(corp.delay, 4, 'its attack timer restarts at 4');
  DarkCore.beastDied(corp);
  assert.equal(DarkCore.coreOf(corp), null, 'it goes with the Beast');
});

test('the core jumps to the northernmost player and leeches whoever stands beside it', () => {
  const corp = fakeNpc(319, 2994, 4253);
  corp.hp = 1500;
  const south = fakePlayer({ x: 2985, y: 4250 });
  const north = fakePlayer({ x: 2982, y: 4260 });
  worldPlayers.length = 0;
  worldPlayers.push(south, north);
  const state = DarkCore.sendOut(corp);
  assert.deepEqual(state.target, { x: 2982, y: 4260, z: 2 }, 'the northernmost');
  assert.equal(state.npc.location.getZ(), 3, 'out of sight in flight');
  for (let i = 0; i < 10 && !state.landed; i++) DarkCore.tickCore(state);
  assert.equal(state.landed, true);
  assert.deepEqual([state.npc.location.getX(), state.npc.location.getY(), state.npc.location.getZ()], [2982, 4260, 2]);
  DarkCore.tickCore(state);
  DarkCore.tickCore(state);
  assert.equal(north.damage.length, 1, 'every 2 ticks');
  assert.ok(north.damage[0] >= 5 && north.damage[0] <= 13);
  assert.equal(corp.hp, 1500 + north.damage[0], 'healing the Beast');
  assert.equal(south.damage.length, 0, 'not beside it');
  DarkCore.beastDied(corp);
});

test('poison stuns the core until it hops again, and only once', () => {
  const corp = fakeNpc(319, 2994, 4253);
  const player = inRoom(fakePlayer({ x: 2982, y: 4260 }));
  const state = DarkCore.sendOut(corp);
  for (let i = 0; i < 10 && !state.landed; i++) DarkCore.tickCore(state);
  state.npc.poisoned = true;
  DarkCore.tickCore(state);
  assert.equal(state.stunned, true);
  player.location = new Location(2975, 4250, 2);
  for (let i = 0; i < 2; i++) DarkCore.tickCore(state);
  assert.equal(state.stunned, false, 'it hopped');
  assert.equal(state.canBeStunned, false);
  DarkCore.beastDied(corp);
});

// ------------------------------------------------------------------ spirit shields

function shieldMaker({ prayer = 99, smithing = 99, items = [] } = {}) {
  const { Skill } = PluginManager.getCoreApi();
  const slots = items.map((id) => ({ id }));
  const p = fakePlayer();
  p.xp = 0;
  p.boxes = [];
  p.getSkillManager = () => ({
    getMaxLevel: (skill) => (skill === Skill.PRAYER ? prayer : 99),
    getCurrentLevel: (skill) => (skill === Skill.SMITHING ? smithing : 99),
    addExperience: (skill, amount) => { p.xp += amount; },
  });
  p.getInventory = () => ({
    slots,
    contains: (id) => slots.some((slot) => slot.id === id),
    setItem: (slot, item) => { slots[slot] = { id: item.getId() }; },
    deleteNumber: (id) => { const slot = slots.find((s) => s.id === id); if (slot) slot.id = -1; },
    adds: (id) => slots.push({ id }),
    refreshItems() {},
  });
  p.getDialogueManager = () => ({ startDialogues: (chain) => p.boxes.push(chain) });
  return p;
}

test('a holy elixir blesses a spirit shield, with 85 Prayer', () => {
  const { ITEM } = Shields;
  const item = (id) => ({ getId: () => id });
  const event = (player) => ({ player, usedItem: item(ITEM.HOLY_ELIXIR), usedItemSlot: 0, usedWithItem: item(ITEM.SPIRIT_SHIELD), usedWithItemSlot: 1 });
  const weak = shieldMaker({ prayer: 84, items: [ITEM.HOLY_ELIXIR, ITEM.SPIRIT_SHIELD] });
  Shields.bless(event(weak));
  assert.deepEqual(weak.getInventory().slots.map(({ id }) => id), [ITEM.HOLY_ELIXIR, ITEM.SPIRIT_SHIELD]);
  const player = shieldMaker({ items: [ITEM.HOLY_ELIXIR, ITEM.SPIRIT_SHIELD] });
  Shields.bless(event(player));
  assert.deepEqual(player.getInventory().slots.map(({ id }) => id), [-1, ITEM.BLESSED_SPIRIT_SHIELD]);
  assert.equal(player.boxes.length, 1);
});

test('a sigil on an anvil makes its shield: hammer, 90 Prayer, 85 Smithing, 1,800 XP', () => {
  const { ITEM } = Shields;
  const ELYSIAN_SIGIL = 12819;
  const noHammer = shieldMaker({ items: [ELYSIAN_SIGIL, ITEM.BLESSED_SPIRIT_SHIELD] });
  Shields.attach({ player: noHammer, itemId: ELYSIAN_SIGIL });
  assert.equal(noHammer.xp, 0);
  const lowSmith = shieldMaker({ smithing: 84, items: [ELYSIAN_SIGIL, ITEM.BLESSED_SPIRIT_SHIELD, ITEM.HAMMER] });
  Shields.attach({ player: lowSmith, itemId: ELYSIAN_SIGIL });
  assert.equal(lowSmith.xp, 0);
  const player = shieldMaker({ items: [ELYSIAN_SIGIL, ITEM.BLESSED_SPIRIT_SHIELD, ITEM.HAMMER] });
  Shields.attach({ player, itemId: ELYSIAN_SIGIL });
  assert.equal(player.xp, 1800);
  assert.ok(player.getInventory().contains(12817), 'the elysian spirit shield');
  assert.ok(player.getInventory().contains(ITEM.HAMMER), 'the hammer stays');
  assert.equal(Shields.attach({ player, itemId: 1 }), false, 'other items on an anvil fall through');
});

test('::corpkill finishes the Beast in your room, credited to you', () => {
  const { World } = PluginManager.getCoreApi();
  const corp = fakeNpc(319, 2994, 4253);
  corp.hp = 1234;
  const credited = [];
  const queued = [];
  corp.getCombat = () => ({
    addDamage: (player, amount) => credited.push(amount),
    getHitQueue: () => ({ addPendingDamage: (hits) => queued.push(...hits.map((hit) => hit.getDamage())) }),
  });
  const realGetNpcs = World.getNpcs;
  World.getNpcs = () => [corp];
  try {
    const lobby = fakePlayer({ x: 2966, y: 4252 });
    Commands.killBeast({ player: lobby });
    assert.equal(lobby.messages.at(-1), "Use this in the Corporeal Beast's room.");
    const player = fakePlayer({ x: 2980, y: 4255 });
    Commands.killBeast({ player });
    assert.deepEqual([credited, queued], [[1234], [1234]]);
  } finally {
    World.getNpcs = realGetNpcs;
  }
});

test('its drop table notes what the Wiki notes (adamantite ore, magic logs...)', () => {
  const { tables } = require('../data/definitions/npc-drops.json');
  const noted = tables.corporeal_beast.entries.filter((entry) => entry.noted).map((entry) => entry.name);
  assert.deepEqual(noted, ['Raw shark', 'Pure essence', 'Adamantite bar', 'Green dragonhide', 'Adamantite ore', 'Runite ore',
    'Teak plank', 'Mahogany logs', 'Magic logs', 'White berries', 'Goat horn', 'Antidote++(4)']);
});
