// Run after `yarn build`: node --test tests/crystal-singing.test.cjs
// The Prifddinas singing bowl's recipes (issue 3776; docs/crystal-singing.md): materials, shards, levels, XP and products.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");

const KeyChests = require("../plugins/objects/KeyChests.plugin");
const Singing = require("../plugins/items/CrystalSinging.plugin");

const core = PluginManager.getCoreApi();
const tasks = [];
const objects = new Map();
const itemOnObject = [];
let songComplete = true;
let diaryComplete = true;
const api = {
  core: { ...core, TaskManager: { submit: (task) => tasks.push(task) } },
  persistAttribute() {},
  emitCustomEvent: (name, payload) => {
    if (name === "quest:is-complete") payload.complete = songComplete;
    if (name === "diary:is-complete") payload.complete = diaryComplete;
  },
  onObjectInteraction: (name, options) => objects.set(name, { ...objects.get(name), ...options }),
  onItemOnObject: (item, object, handler) => itemOnObject.push([item, object, handler]),
  onItemOnItem() {},
};
KeyChests.register(api);
Singing.register(api);

const BOWL = CacheDefinitions.getLocId("prif_singing_bowl");

function createPlayer({ smithing = 99, crafting = 99, items = [] } = {}) {
  const inventory = new Map(items);
  const attributes = new Map();
  const player = {
    messages: [], xp: [], inventory, menu: null, statements: 0, sounds: [], animations: 0,
    sendMessage(message) { player.messages.push(message); },
    performAnimation() { player.animations++; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendSound: (id) => player.sounds.push(id), sendInterface: (id) => { player.interfaceId = id; }, sendCreationMenu: (menu) => { player.menu = menu; } }),
    getDialogueManager: () => ({ startDialogues: () => { player.statements++; } }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.SMITHING ? smithing : skill === Skill.CRAFTING ? crafting : 99),
      addExperiences: (skill, amount) => player.xp.push([skill, amount]),
    }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      refreshItems() {},
    }),
  };
  return player;
}

const SHARD = I.CRYSTAL_SHARD;
/** [recipe product, the materials the recipe needs besides shards, shards, level, xp] from the captures and the Wiki. */
const EXPECTED = [
  ["ETERNAL_TELEPORT_CRYSTAL", [[I.ENHANCED_CRYSTAL_TELEPORT_SEED, 1]], 100, 80, 5000],
  ["BLADE_OF_SAELDOR", [[I.ENHANCED_CRYSTAL_WEAPON_SEED, 1]], 100, 82, 5000],
  ["BOW_OF_FAERDHINEN", [[I.ENHANCED_CRYSTAL_WEAPON_SEED, 1]], 100, 82, 5000],
  ["CRYSTAL_BOW_3", [[I.CRYSTAL_WEAPON_SEED, 1]], 40, 78, 2000],
  ["CRYSTAL_HALBERD_3", [[I.CRYSTAL_WEAPON_SEED, 1]], 40, 78, 2000],
  ["CRYSTAL_SHIELD_3", [[I.CRYSTAL_WEAPON_SEED, 1]], 40, 78, 2000],
  ["CRYSTAL_AXE", [[I.CRYSTAL_TOOL_SEED, 1], [I.DRAGON_AXE, 1]], 120, 76, 6000],
  ["CRYSTAL_PICKAXE", [[I.CRYSTAL_TOOL_SEED, 1], [I.DRAGON_PICKAXE, 1]], 120, 76, 6000],
  ["CRYSTAL_HARPOON", [[I.CRYSTAL_TOOL_SEED, 1], [I.DRAGON_HARPOON, 1]], 120, 76, 6000],
  ["CRYSTAL_FELLING_AXE", [[I.CRYSTAL_TOOL_SEED, 1], [I.DRAGON_FELLING_AXE, 1]], 120, 76, 6000],
];

test("the recipe table matches the captured and Wiki numbers", () => {
  const recipes = Singing._test.resolve();
  for (const [product, materials, shards, level, xp] of EXPECTED) {
    const recipe = recipes.find((row) => row.product === product);
    assert.ok(recipe, product);
    assert.equal(recipe.productId, I[product], product);
    assert.deepEqual(recipe.needs, [...materials.map(([itemId, amount]) => ({ itemId, amount })), { itemId: SHARD, amount: shards }], product);
    assert.equal(recipe.level, level, product);
    assert.equal(recipe.xp, xp, product);
  }
  const key = recipes.find((row) => row.product === "ENHANCED_CRYSTAL_KEY");
  assert.deepEqual([key.level, key.xp], [80, 500]);
});

test("each recipe sings one product from exactly its materials, XP in Smithing and Crafting", () => {
  for (const [product, materials, shards, , xp] of EXPECTED) {
    const player = createPlayer({ items: [...materials, [SHARD, shards + 7]] });
    Singing._test.sing(player, I[product], 1);
    assert.equal(player.inventory.get(I[product]), 1, product);
    assert.equal(player.inventory.get(SHARD), 7, product);
    for (const [itemId] of materials) assert.equal(player.inventory.get(itemId), 0, product);
    assert.deepEqual(player.xp, [[Skill.SMITHING, xp], [Skill.CRAFTING, xp]], product);
    assert.deepEqual(player.sounds, [8]);
  }
});

test("25 weapon seeds sing 25 bows for 1,000 shards and 50,000 XP each skill (capture 1134)", () => {
  const player = createPlayer({ items: [[I.CRYSTAL_WEAPON_SEED, 25], [SHARD, 1063]] });
  Singing._test.sing(player, I.CRYSTAL_BOW_3, 99);
  assert.equal(player.inventory.get(I.CRYSTAL_BOW_3), 25);
  assert.equal(player.inventory.get(SHARD), 63);
  assert.deepEqual(player.xp[0], [Skill.SMITHING, 50000]);
});

test("the song message comes five ticks after the song, and a second song waits for it", () => {
  const player = createPlayer({ items: [[I.CRYSTAL_WEAPON_SEED, 2], [SHARD, 80]] });
  tasks.length = 0;
  Singing._test.sing(player, I.CRYSTAL_BOW_3, 1);
  assert.equal(tasks.length, 1);
  assert.equal(Singing._test.sing(player, I.CRYSTAL_BOW_3, 1), false);
  assert.deepEqual(player.messages, []);
  tasks[0].execute();
  assert.deepEqual(player.messages, [Singing._test.SONG]);
  assert.equal(player.statements, 1);
  assert.equal(Singing._test.sing(player, I.CRYSTAL_BOW_3, 1), true);
});

test("no materials gives the captured statement; low levels name the lowest level offered", () => {
  const empty = createPlayer();
  Singing._test.singCrystal({ player: empty, objectId: BOWL });
  assert.equal(empty.menu, null);
  assert.equal(empty.statements, 1);

  const items = [[I.ENHANCED_CRYSTAL_WEAPON_SEED, 1], [I.CRYSTAL_WEAPON_SEED, 1], [SHARD, 200]];
  const low = createPlayer({ smithing: 77, items });
  Singing._test.singCrystal({ player: low, objectId: BOWL });
  assert.equal(low.menu, null);
  assert.equal(low.statements, 1);

  const mid = createPlayer({ smithing: 78, crafting: 78, items });
  Singing._test.singCrystal({ player: mid, objectId: BOWL });
  assert.deepEqual(mid.menu.getItems(), [I.CRYSTAL_BOW_3, I.CRYSTAL_HALBERD_3, I.CRYSTAL_SHIELD_3], "82-level recipes are not offered at 78");
});

test("Sing-crystal lists every recipe the materials make, the key included", () => {
  const player = createPlayer({ items: [[I.ENHANCED_CRYSTAL_TELEPORT_SEED, 1], [CacheDefinitions.getObjId("crystal_key"), 1], [SHARD, 110]] });
  Singing._test.singCrystal({ player, objectId: BOWL });
  assert.deepEqual(player.menu.getItems(), [I.ETERNAL_TELEPORT_CRYSTAL, CacheDefinitions.getObjId("prif_crystal_key")]);
});

test("an item used on the bowl lists only what it goes into", () => {
  const player = createPlayer({ items: [[I.ENHANCED_CRYSTAL_TELEPORT_SEED, 1], [I.CRYSTAL_WEAPON_SEED, 1], [SHARD, 300]] });
  Singing._test.useOnBowl({ player, itemId: I.CRYSTAL_WEAPON_SEED, objectId: BOWL });
  assert.deepEqual(player.menu.getItems(), [I.CRYSTAL_BOW_3, I.CRYSTAL_HALBERD_3, I.CRYSTAL_SHIELD_3]);
  const key = createPlayer({ items: [[CacheDefinitions.getObjId("crystal_key"), 1], [SHARD, 10]] });
  Singing._test.useOnBowl({ player: key, itemId: CacheDefinitions.getObjId("crystal_key"), objectId: BOWL });
  assert.deepEqual(key.menu.getItems(), [CacheDefinitions.getObjId("prif_crystal_key")]);
});

test("without Song of the Elves the quest recipes are not offered", () => {
  songComplete = false;
  try {
    const player = createPlayer({ items: [[I.CRYSTAL_WEAPON_SEED, 1], [I.ENHANCED_CRYSTAL_TELEPORT_SEED, 1], [SHARD, 200]] });
    Singing._test.singCrystal({ player, objectId: BOWL });
    assert.deepEqual(player.menu.getItems(), [I.ETERNAL_TELEPORT_CRYSTAL]);
  } finally {
    songComplete = true;
  }
});

test("other bowls are left alone, and every input is hooked by item name", () => {
  assert.equal(Singing._test.singCrystal({ player: createPlayer(), objectId: CacheDefinitions.getLocId("gauntlet_singing_bowl") }), false);
  const names = itemOnObject.filter(([, object]) => object === "Singing bowl").map(([item]) => item);
  for (const id of [I.CRYSTAL_WEAPON_SEED, I.CRYSTAL_TOOL_SEED, I.ENHANCED_CRYSTAL_WEAPON_SEED, I.ENHANCED_CRYSTAL_TELEPORT_SEED, I.DRAGON_AXE, CacheDefinitions.getObjId("crystal_key")]) {
    assert.ok(names.includes(core.ItemDefinition.forId(id).getName()), String(id));
  }
  assert.ok(objects.get("Singing bowl")["Sing-crystal"], "Sing-crystal is hooked once, by CrystalSinging");
});

test("the halberd needs the Hard Western Provinces Diary", () => {
  const player = createPlayer({ items: [[I.CRYSTAL_WEAPON_SEED, 1], [SHARD, 40]] });
  diaryComplete = false;
  Singing._test.singCrystal({ player, objectId: BOWL });
  assert.ok(!player.menu.getItems().includes(I.CRYSTAL_HALBERD_3));
  diaryComplete = true;
  Singing._test.singCrystal({ player, objectId: BOWL });
  assert.ok(player.menu.getItems().includes(I.CRYSTAL_HALBERD_3));
});

test("Read on the Crystal Singing Recipes book opens interface prif_recipes (181)", () => {
  assert.equal(CacheDefinitions.getLocId("crystal_singing_recipes") ?? 37344, 37344);
  assert.equal(typeof objects.get("Crystal Singing Recipes").Read, "function");
  const player = createPlayer();
  assert.equal(objects.get("Crystal Singing Recipes").Read({ player, objectId: 37344 }), undefined);
  assert.equal(player.interfaceId, 181);
  const gauntlet = createPlayer();
  assert.equal(objects.get("Crystal Singing Recipes").Read({ player: gauntlet, objectId: 35978 }), false, "the Gauntlet's books are left to its plugin");
  assert.equal(gauntlet.interfaceId, undefined);
});
