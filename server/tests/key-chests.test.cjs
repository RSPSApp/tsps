// Run after `yarn build`: node --test tests/key-chests.test.cjs
// Key chests against the real cache: data, loot rolls, fish, key halves, enhanced key (docs/key-chests.md).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");

const KeyChests = require("../plugins/objects/KeyChests.plugin");
const Data = require("../plugins/objects/keychests/Data.KeyChests");
const Loot = require("../plugins/objects/keychests/Loot.KeyChests");
const CrystalKey = require("../plugins/objects/keychests/CrystalKey.KeyChests");

const core = PluginManager.getCoreApi();
const objects = new Map();
const itemOnItem = [];
const itemOnObject = [];
const events = [];
KeyChests.register({
  core,
  persistAttribute() {},
  emitCustomEvent: (name, payload) => events.push([name, payload]),
  onObjectInteraction: (name, options) => objects.set(name, { ...objects.get(name), ...options }),
  onItemOnObject: (item, object) => itemOnObject.push([item, object]),
  onItemOnItem: (a, b, fn) => itemOnItem.push([a, b, fn]),
});

const obj = (name) => CacheDefinitions.getObjId(name);
const chest = (key) => Data.get().chests.find((entry) => entry.key === key);
/** A fixed sequence of random numbers, then 0.5. */
const randoms = (...values) => () => (values.length ? values.shift() : 0.5);

test("every chest, key and loot item is in the cache, and each main table fits its roll", () => {
  for (const entry of Data.get().chests) {
    assert.ok(entry.locId != null, entry.name);
    assert.equal(CacheDefinitions.getObject(entry.locId).name, entry.name === "Crystal chest" ? "Closed chest" : entry.name);
    const total = entry.loot.main.reduce((sum, row) => sum + row.weight, 0);
    if (entry.loot.outOf != null) assert.ok(total <= entry.loot.outOf, `${entry.name}: ${total} > ${entry.loot.outOf}`);
    for (const name of ["Unlock", "Open"]) {
      const options = CacheDefinitions.getObject(entry.locId).actions;
      if (options.includes(name)) assert.ok(objects.get(CacheDefinitions.getObject(entry.locId).name)?.[name], `${entry.name} ${name}`);
    }
  }
  assert.equal(Data.get().chests.find((entry) => entry.key === "larranBig").loot.main.reduce((sum, row) => sum + row.weight, 0), 60);
});

test("the crystal chest always gives an uncut dragonstone; spinach roll with 2,000 coins on 34/128", () => {
  const drops = Loot.roll(chest("crystal"), 1, randoms(0));
  assert.deepEqual(drops.map((drop) => [drop.itemId, drop.amount]), [[obj("uncut_dragonstone"), 1], [obj("spinach_roll"), 1], [obj("coins"), 2000]]);
  const nothing = Loot.roll(chest("crystal"), 1, randoms(127 / 128));
  assert.deepEqual(nothing.map((drop) => drop.itemId), [obj("uncut_dragonstone")], "17/128 is nothing more");
});

test("a pre-roll that hits is the whole reward", () => {
  const drops = Loot.roll(chest("brimstone"), 99, randoms(0, 0));
  assert.deepEqual(drops.map((drop) => drop.itemId), [obj("broken_dragon_hasta")]);
  const elven = Loot.roll(chest("elven"), 99, randoms(0.5, 0, 0));
  assert.deepEqual(elven.map((drop) => drop.itemId), [obj("dragonstone_helmet")]);
});

test("the Elven chest's key halves come with coins and one half", () => {
  const drops = Loot.roll(chest("elven"), 1, randoms(0.5, 0.5, 0, 0.5, 0.9));
  assert.deepEqual(drops.map((drop) => drop.itemId), [obj("uncut_dragonstone"), obj("coins"), obj("keyhalf1")]);
  assert.ok(drops[1].amount >= 10000 && drops[1].amount <= 15000);
});

test("fish: none of the shark-table fish below 17 Fishing; big chest amounts are half again", () => {
  for (let i = 0; i < 500; i++) {
    const fish = Loot.rollFish(1, 1, Math.random);
    assert.ok([obj("raw_monkfish"), obj("raw_swordfish"), obj("raw_tuna"), obj("raw_lobster")].includes(fish.itemId));
  }
  assert.equal(Loot.successChance(-10, 20, 1), 0);
  assert.equal(Loot.successChance(-10, 20, 99), 21 / 256);
  const lure = Loot.rollFish(99, 1.5, randoms(0, 0.99, 0));
  assert.deepEqual([lure.itemId, lure.amount], [obj("shark_lure"), Math.floor(80 * 1.5 * 2)]);
  const manta = Loot.rollFish(99, 1.5, randoms(0, 0, 0));
  assert.deepEqual([manta.itemId, manta.amount, manta.noted], [obj("raw_mantaray"), 120, true]);
});

function createPlayer({ smithing = 99, crafting = 99, items = [] } = {}) {
  const inventory = new Map(items);
  const messages = [];
  const xp = [];
  const player = {
    messages,
    xp,
    inventory,
    menu: null,
    statements: [],
    sendMessage: (message) => messages.push(message),
    performAnimation() {},
    getPacketSender: () => ({ sendSound() {}, sendCreationMenu: (menu) => { player.menu = menu; } }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.statements.push(chain) }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.SMITHING ? smithing : skill === Skill.CRAFTING ? crafting : 99),
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteAtSlot() {},
    }),
  };
  return player;
}

test("the key halves join into a crystal key; the noted halves don't", () => {
  const player = createPlayer();
  assert.equal(CrystalKey.joinHalves({ player, usedItemId: obj("cert_keyhalf1"), usedWithItemId: obj("keyhalf2") }), false);
  CrystalKey.joinHalves({ player, usedItemId: obj("keyhalf1"), usedWithItemId: obj("keyhalf2"), usedItemSlot: 0, usedWithItemSlot: 1 });
  assert.equal(player.inventory.get(obj("crystal_key")), 1);
  assert.deepEqual(player.messages, ["You join the two halves of the key together."]);
  assert.ok(itemOnItem.some(([a, b]) => a === "Loop half of key" && b === "Tooth half of key"));
});

test("the Prifddinas singing bowl sings enhanced crystal keys at 80 Smithing and Crafting", () => {
  const bowl = CacheDefinitions.getLocId("prif_singing_bowl");
  const keys = [[obj("crystal_key"), 2], [obj("prif_crystal_shard"), 25]];
  assert.equal(CrystalKey.singCrystal({ player: createPlayer(), objectId: CacheDefinitions.getLocId("gauntlet_singing_bowl") }), false);
  const empty = createPlayer();
  CrystalKey.singCrystal({ player: empty, objectId: bowl });
  assert.equal(empty.menu, null);
  assert.equal(empty.statements.length, 1);
  const low = createPlayer({ smithing: 79, items: keys });
  CrystalKey.singCrystal({ player: low, objectId: bowl });
  assert.equal(low.menu, null);
  const player = createPlayer({ items: keys });
  CrystalKey.singCrystal({ player, objectId: bowl });
  assert.ok(player.menu);
  player.menu.execute(obj("prif_crystal_key"), 28);
  assert.equal(player.inventory.get(obj("prif_crystal_key")), 2, "as many as the shards allow");
  assert.equal(player.inventory.get(obj("prif_crystal_shard")), 5);
  assert.equal(player.inventory.get(obj("crystal_key")), 0);
  assert.deepEqual(player.xp, [[Skill.SMITHING, 1000], [Skill.CRAFTING, 1000]]);
});

test("the Grubby Chest: two food rolls, a potion roll, a main roll and 1/25 egg sacs; Open and Check are hooked", () => {
  const grubby = chest("grubby");
  assert.ok(objects.get("Grubby Chest")?.Open && objects.get("Grubby Chest")?.Check);
  assert.equal(grubby.keyId, 23499);
  assert.deepEqual(grubby.loot.tables.map((table) => table.main.reduce((sum, row) => sum + row.weight, 0) === table.outOf), [true, true, true]);
  // food 0 (4 sharks) twice, potion 0 (the super set), main 0 (law runes), no egg sac.
  const drops = Loot.roll(grubby, 99, randoms(0, 0, 0, 0, 0.99, 0.99));
  assert.deepEqual(drops.map((drop) => [drop.itemId, drop.amount]), [
    [obj("shark"), 4], [obj("shark"), 4],
    [obj("2dose2attack"), 1], [obj("2dose2strength"), 1], [obj("2dose2defense"), 1],
    [obj("lawrune"), 200],
  ]);
  assert.ok(!drops.some((drop) => drop.bonus));
  const sac = Loot.roll(grubby, 99, randoms(0, 0, 0, 0, 0, 0.99));
  assert.deepEqual(sac.at(-1), { itemId: obj("hosdun_orange_egg_sac"), amount: 1, noted: false, bonus: true });
  const noted = Loot.roll(grubby, 99, randoms(0, 0, 0, 0.7, 0.99, 0.99));
  assert.equal(noted.at(-1).noted, true, "dragon bones come noted");
});

test("the Grubby Chest's box shows the transcript's two pictures (Wiki Transcript:Grubby Chest)", () => {
  const Chests = require("../plugins/objects/keychests/Chests.KeyChests");
  const grubby = chest("grubby");
  const box = (drops) => {
    const player = createPlayer();
    Chests.showItemBox(grubby, player, drops);
    const first = player.statements[0].getDialogues().get(0);
    return [first.getItemIds(), first.getText()];
  };
  assert.deepEqual(box([{ itemId: obj("coins"), amount: 1 }]),
    [[obj("shark"), obj("dragonhide_red")], "You find treasure and supplies within the chest."]);
  assert.deepEqual(box([{ itemId: obj("coins"), amount: 1 }, { itemId: obj("hosdun_blue_egg_sac"), amount: 1, bonus: true }]),
    [[obj("hosdun_orange_egg_sac"), obj("hosdun_blue_egg_sac")], "You find treasure, supplies, and a weirdly coloured egg sac within the chest."]);
});

// The Zombie Pirate's Locker (Wiki: Zombie Pirate's Locker; docs/key-chests.md).
const Chests = require("../plugins/objects/keychests/Chests.KeyChests");
const OPENED = "key-chests:zombie-pirate-locker-opened";
const locker = () => chest("zombiePirateLocker");

function createLockerPlayer({ key = 1, free = 27, amulet = null } = {}) {
  const inventory = new Map(key ? [[obj("zombie_pirate_wildy_key"), key]] : []);
  const player = {
    inventory,
    added: [],
    messages: [],
    sounds: [],
    animations: [],
    attributes: new Map(),
    sendMessage: (message) => player.messages.push(message),
    performAnimation: (animation) => player.animations.push(animation.getId()),
    getAttribute: (name) => player.attributes.get(name),
    setAttribute: (name, value) => player.attributes.set(name, value),
    getPacketSender: () => ({ sendSound: (id) => player.sounds.push(id), sendVarbit() {} }),
    getEquipment: () => ({ getItems: () => [null, null, amulet == null ? null : { getId: () => amulet }] }),
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
    getInventory: () => ({
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      getFreeSlots: () => free,
      forceAdd: (_player, item) => player.added.push([item.getId(), item.getAmount()]),
      refreshItems() {},
    }),
  };
  return player;
}

function lockerObject() {
  const location = new core.Location(3368, 3637, 0);
  return { getLocation: () => location, getType: () => 10, getFace: () => 0 };
}

/** Runs the server's tasks for n ticks, recording the locker's loc swaps instead of placing them. */
function ticks(n, registered = []) {
  const real = core.ObjectManager.register;
  core.ObjectManager.register = (object) => registered.push(object.getId());
  try {
    for (let i = 0; i < n; i++) core.TaskManager.process();
  } finally {
    core.ObjectManager.register = real;
  }
}

/** Math.random as these numbers, then 0.5, while `fn` runs. */
function withRandom(values, fn) {
  const real = Math.random;
  Math.random = randoms(...values);
  try {
    fn();
  } finally {
    Math.random = real;
  }
}

test("the locker's table is the Wiki's 173, after a 1/275 teleport anchoring scroll", () => {
  const entry = locker();
  assert.deepEqual([entry.locId, entry.openLocId, entry.keyId], [53222, 53223, 29449]);
  assert.equal(CacheDefinitions.getObject(entry.locId).name, "Zombie Pirate's Locker");
  assert.equal(entry.loot.main.reduce((sum, row) => sum + row.weight, 0), 173);
  assert.equal(entry.loot.outOf, 173);
  assert.ok(objects.get("Zombie Pirate's Locker")?.Open);
  assert.ok(itemOnObject.some(([item, object]) => item === "Zombie pirate key" && object === "Zombie Pirate's Locker"));
  assert.deepEqual(Loot.roll(entry, 99, randoms(0)), [{ itemId: obj("wilderness_blip_blocking_scroll"), amount: 1, noted: false, preRoll: true }]);
  assert.equal(Loot.roll(entry, 99, randoms(1 / 275))[0].preRoll, undefined, "1/275 exactly");
  // Past the scroll: the first row (60-120 blood runes), the last (10-20 adamant seeds), a noted row.
  assert.deepEqual(Loot.roll(entry, 99, randoms(0.5, 0, 0)).map((drop) => [drop.itemId, drop.amount]), [[obj("bloodrune"), 60]]);
  assert.deepEqual(Loot.roll(entry, 99, randoms(0.5, 172.5 / 173, 0.99)).map((drop) => [drop.itemId, drop.amount]), [[obj("adamant_seed"), 20]]);
  assert.deepEqual(Loot.roll(entry, 99, randoms(0.5, 120.5 / 173, 0)).map((drop) => [drop.itemId, drop.amount, drop.noted]), [[obj("blighted_4dose2restore"), 2, true]]);
});

test("a league's boosted drops raise a pre-roll's chance by the rule's multiplier", () => {
  const entry = locker();
  const scroll = [{ pattern: /^Teleport anchoring scroll$/i, multiplier: 5 }];
  assert.equal(Loot.roll(entry, 99, randoms(4.9 / 275), scroll)[0].preRoll, true);
  assert.equal(Loot.roll(entry, 99, randoms(4.9 / 275))[0].preRoll, undefined);
  assert.equal(Loot.roll(entry, 99, randoms(4.9 / 275), [{ pattern: /^Coins$/, multiplier: 5 }])[0].preRoll, undefined);
});

test("the locker's lines: the loot, and the count in red, once and N times", () => {
  const entry = locker();
  assert.equal(Chests.lootMessage(entry, [{ itemId: obj("coins"), amount: 11714 }]), "You loot the locker and receive <col=ef1020>11,714 x Coins</col>.");
  const player = createLockerPlayer();
  player.attributes.set(OPENED, 1);
  assert.equal(Chests.countMessage(entry, player), "You've opened the Zombie Pirate's locker <col=ef1020>once</col>.");
  player.attributes.set(OPENED, 3);
  assert.equal(Chests.countMessage(entry, player), "You've opened the Zombie Pirate's locker <col=ef1020>3</col> times.");
  assert.equal(Chests.countMessage(chest("brimstone"), player), "You have opened the Brimstone chest 0 times.", "the other chests keep their plain count");
});

test("the locker refuses without a key, and with under two free slots keeps the key", () => {
  const none = createLockerPlayer({ key: 0 });
  Chests.openChest(locker(), none, lockerObject());
  assert.deepEqual([none.messages, none.sounds, none.animations], [["You don't have the key for this locker."], [], []]);
  const full = createLockerPlayer({ free: 1 });
  Chests.openChest(locker(), full, lockerObject());
  ticks(3);
  assert.deepEqual([full.messages, full.sounds, full.animations], [["You'll need two free inventory slots to loot the locker."], [], []]);
  assert.equal(full.inventory.get(obj("zombie_pirate_wildy_key")), 1);
});

test("opening the locker: animation and sound 58, the key and the open locker, the animation again, then sound 51 and the loot", () => {
  const player = createLockerPlayer({ key: 2 });
  const registered = [];
  const openchest = CacheDefinitions.getSeqId("human_openchest");
  events.length = 0;
  withRandom([0.5, 0, 0], () => {
    Chests.openChest(locker(), player, lockerObject());
    assert.deepEqual([player.animations, player.sounds, player.messages], [[openchest], [58], []]);
    ticks(1, registered);
    assert.equal(player.inventory.get(obj("zombie_pirate_wildy_key")), 1, "one key goes");
    assert.deepEqual(registered, [53223]);
    ticks(1, registered);
    assert.deepEqual([player.animations, player.added], [[openchest, openchest], []]);
    ticks(1, registered);
  });
  assert.deepEqual(player.sounds, [58, 51]);
  assert.deepEqual(registered, [53223, 53222]);
  assert.deepEqual(player.added, [[obj("bloodrune"), 60]]);
  assert.deepEqual(player.messages, [
    "You loot the locker and receive <col=ef1020>60 x Blood rune</col>.",
    "You've opened the Zombie Pirate's locker <col=ef1020>once</col>.",
  ]);
  assert.equal(player.attributes.get(OPENED), 1);
  assert.equal(player.attributes.get(Chests.OPENING_ATTRIBUTE), false);
  const event = (name) => events.find(([emitted]) => emitted === name)?.[1];
  assert.equal(event("drops:chance").source, "Zombie Pirate's Locker");
  assert.equal(event("chests:opened").chest, "Zombie Pirate's Locker");
  assert.deepEqual(event("drops:received").drops.map((drop) => drop.itemId), [obj("bloodrune")]);
});

test("the amulet of avarice notes the locker's loot, but not the scroll", () => {
  const avarice = obj("wild_cave_amulet");
  const player = createLockerPlayer({ amulet: avarice });
  // Past the scroll, onto the Rune battleaxe row (2 x, which the amulet notes).
  withRandom([0.5, 44.5 / 173], () => {
    Chests.openChest(locker(), player, lockerObject());
    ticks(3);
  });
  assert.deepEqual(player.added, [[core.ItemDefinition.forId(obj("rune_battleaxe")).getNoteId(), 2]]);
  const plain = createLockerPlayer();
  withRandom([0.5, 44.5 / 173], () => {
    Chests.openChest(locker(), plain, lockerObject());
    ticks(3);
  });
  assert.deepEqual(plain.added, [[obj("rune_battleaxe"), 1], [obj("rune_battleaxe"), 1]], "unnoted, one per slot");
  const scroll = createLockerPlayer({ amulet: avarice });
  withRandom([0], () => {
    Chests.openChest(locker(), scroll, lockerObject());
    ticks(3);
  });
  assert.deepEqual(scroll.added, [[obj("wilderness_blip_blocking_scroll"), 1]]);
});
