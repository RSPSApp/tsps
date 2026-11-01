const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const DATA = require("../plugins/items/data/openable-items.json");

const AIR_RUNE = 556;
const BONES = 526;

before(() => {
  CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/items/OpenableItems.plugin").register(PluginManager.createApi("OpenableItems"));
});

function playerWith(id, { fill = false, amount = 1 } = {}) {
  const player = {
    getPacketSender: () => ({ sendItemContainer() {}, sendInterfaceRemoval: () => { player.closes++; }, sendSound: (id) => player.sounds.push(id) }),
    getDialogueManager: () => ({ startDialogues: (builder) => player.dialogues.push(builder) }),
    sendMessage: (text) => player.messages.push(text),
    isTeleportingReturn: () => false,
    getHitpoints: () => 10,
    messages: [],
    sounds: [],
    closes: 0,
    getLocation: () => player.location,
    location: { getX: () => 3200, getY: () => 3200 },
    dialogues: [],
  };
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  if (fill) for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new Item(BONES, 1));
  inventory.setItem(7, new Item(id, amount));
  return player;
}

const open = (player, id) => ItemActionPacketListener.handleFirstAction(player, Inventory.INTERFACE_ID, id, 7, "Open");

function idsNamed(name) {
  const ids = [];
  for (let id = 0; id < 40000; id++) {
    const definition = CacheDefinitions.getItem(id);
    if (definition?.name === name && definition.inventoryActions?.includes("Open")) ids.push(id);
  }
  return ids;
}

const expected = (name, noteIt) => {
  const id = ItemIdentifiers[name];
  const note = ItemDefinition.forId(id).getNoteId();
  return noteIt && note >= 0 ? note : id;
};

test("every data row names a real, unnoted item and an item with an Open option", () => {
  const rows = [
    ...DATA.packs.flatMap((pack) => pack.contents.map((content) => content.item)),
    ...DATA.loot.flatMap((container) => container.tables.flatMap((table) => table.entries.map((entry) => entry.item))),
  ];
  for (const name of rows) {
    const id = ItemIdentifiers[name];
    assert.ok(Number.isInteger(id), `${name} is not an ItemIdentifiers constant`);
    assert.equal(ItemDefinition.forId(id).isNoted(), false, `${name} is a note`);
  }
  for (const { name } of [...DATA.packs, ...DATA.loot]) assert.ok(idsNamed(name).length > 0, `${name} has no Open`);
});

test("every pack opens through the packet handler in a full bag, noted unless stackable, and is not worn", () => {
  for (const pack of DATA.packs) {
    for (const id of idsNamed(pack.name)) {
      if (pack.contents.length > 1) continue; // Multi-rune packs need more than the slot they free.
      const player = playerWith(id, { fill: true });
      assert.equal(open(player, id), true, `${pack.name} ${id} was not handled`);
      assert.equal(player.getInventory().getAmount(id), 0, `${pack.name} ${id} was not consumed`);
      const { item, amount } = pack.contents[0];
      const stackable = ItemDefinition.forId(ItemIdentifiers[item]).isStackable();
      const given = expected(item, !stackable);
      assert.equal(player.getInventory().getAmount(given), amount, `${pack.name} gave the wrong amount of ${item}`);
      assert.ok(ItemDefinition.forId(given).isStackable(), `${pack.name} gave ${item} unstacked`);
      assert.equal(ItemDefinition.forId(id).getEquipmentType().getSlot(), -1, `${pack.name} ${id} can be worn`);
    }
  }
});

test("the issue's packs give 100 noted-or-stacked bait and feathers", () => {
  const bait = playerWith(11883);
  open(bait, 11883);
  assert.equal(bait.getInventory().getAmount(313), 100);
  const feathers = playerWith(11881);
  open(feathers, 11881);
  assert.equal(feathers.getInventory().getAmount(314), 100);
  assert.equal(bait.getInventory().getAmount(11883), 0);
});

test("a multi-stack pack keeps the pack when its stacks don't fit, and opens once they do", () => {
  const player = playerWith(20523, { fill: true });
  const pack = player.getInventory().forSlot(7);
  open(player, 20523);
  assert.equal(player.getInventory().forSlot(7), pack);
  assert.match(player.messages.at(-1), /enough inventory space/);
  for (const slot of [0, 1]) player.getInventory().setItem(slot, new Item(-1, 0));
  open(player, 20523);
  assert.equal(player.getInventory().getAmount(20523), 0);
  for (const name of ["CHAOS_RUNE", "DEATH_RUNE", "BLOOD_RUNE"]) assert.equal(player.getInventory().getAmount(ItemIdentifiers[name]), 50);
});

test("a stack of packs loses one at a time, and a stack limit keeps it whole", () => {
  const arrowheads = 11885;
  const player = playerWith(arrowheads, { amount: 3 });
  open(player, arrowheads);
  assert.equal(player.getInventory().getAmount(arrowheads), 2);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BROAD_ARROWHEADS), 100);

  const full = playerWith(12728);
  full.getInventory().setItem(0, new Item(AIR_RUNE, 2147483600));
  const pack = full.getInventory().forSlot(7);
  open(full, 12728);
  assert.equal(full.getInventory().forSlot(7), pack);
  assert.equal(full.getInventory().getAmount(AIR_RUNE), 2147483600);
});

test("loot containers consume themselves and give only their table's items", () => {
  for (const container of DATA.loot) {
    const given = new Set(container.tables.flatMap((table) => table.entries.flatMap((entry) => [
      ItemIdentifiers[entry.item],
      ItemDefinition.forId(ItemIdentifiers[entry.item]).getNoteId(),
    ])));
    const allowed = container.items?.map((name) => ItemIdentifiers[name]);
    for (const id of idsNamed(container.name)) {
      if (allowed && !allowed.includes(id)) continue;
      for (let i = 0; i < 50; i++) {
        const player = playerWith(id);
        assert.equal(open(player, id), true, `${container.name} ${id} was not handled`);
        const held = player.getInventory().getValidItems();
        assert.ok(held.length > 0, `${container.name} gave nothing`);
        for (const item of held) assert.ok(given.has(item.getId()), `${container.name} gave ${item.getId()}`);
      }
    }
  }
});

test("a bag full of gems always gives 40 noted gems; a hunter kit gives one of each tool", () => {
  for (let i = 0; i < 20; i++) {
    const player = playerWith(19473);
    open(player, 19473);
    const held = player.getInventory().getValidItems();
    assert.equal(held.reduce((sum, item) => sum + item.getAmount(), 0), 40);
    for (const item of held) assert.equal(ItemDefinition.forId(item.getId()).isNoted(), true);
  }
  const player = playerWith(11159);
  open(player, 11159);
  assert.equal(player.getInventory().getValidItems().length, 9);
});

test("Pirate's Treasure keeps its casket: the generic table leaves it alone", () => {
  const player = playerWith(ItemIdentifiers.CASKET_3);
  const held = player.getInventory().forSlot(7);
  PluginManager.emitItemAction({ player, interfaceId: Inventory.INTERFACE_ID, item: held, itemId: ItemIdentifiers.CASKET_3, slot: 7, clickType: 1, handled: false });
  assert.equal(player.getInventory().forSlot(7), held);
  assert.deepEqual(player.messages, []);
});

test("Tempoross's casket stays with Tempoross; a note or moved slot opens nothing", () => {
  const tempoross = playerWith(ItemIdentifiers.CASKET_4);
  const before = tempoross.getInventory().forSlot(7);
  PluginManager.emitItemAction({ player: tempoross, interfaceId: Inventory.INTERFACE_ID, item: before, itemId: ItemIdentifiers.CASKET_4, slot: 7, clickType: 1, handled: false });
  assert.equal(tempoross.getInventory().forSlot(7), before, "the generic casket table took Tempoross's casket");

  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(11884, 2), null, "noted bait pack has no Open");
  const player = playerWith(11883);
  assert.equal(ItemActionPacketListener.handleFirstAction(player, Inventory.INTERFACE_ID, 11883, 8, "Open"), false);
  assert.equal(player.getInventory().getAmount(11883), 1);
});

test("captures: a pack plays its sound, says nothing, and fills its own slot", () => {
  const player = playerWith(11881);
  player.getInventory().setItem(2, new Item(-1, 0));
  open(player, 11881);
  assert.deepEqual(player.sounds, [3616]);
  assert.deepEqual(player.messages, []);
  assert.equal(player.getInventory().forSlot(7).getId(), 314);
  assert.equal(player.getInventory().forSlot(7).getAmount(), 100);
  assert.equal(player.dialogues.length, 0);
});

test("captures: a pack joins an existing stack and empties its slot", () => {
  const player = playerWith(11881);
  player.getInventory().setItem(0, new Item(314, 100));
  open(player, 11881);
  assert.equal(player.getInventory().forSlot(0).getAmount(), 200);
  assert.equal(player.getInventory().forSlot(7).getId(), -1);
});

test("captures: a casket plays sound 52 and names its reward in chat and an item box", () => {
  for (let i = 0; i < 200; i++) {
    const player = playerWith(405);
    open(player, 405);
    assert.deepEqual(player.sounds, [52]);
    assert.equal(player.dialogues.length, 1);
    const held = player.getInventory().forSlot(7);
    if (held.getId() === 995) assert.equal(player.messages[0], "You open the casket. Inside you find some coins.");
    if (held.getId() === 1623) assert.equal(player.messages[0], "You open the casket. Inside you find an uncut sapphire.");
    assert.match(player.messages[0], /^You open the casket\. Inside you find (some coins|an? [a-z ]+)\.$/);
  }
});

test("captures: an oyster gives a line only, leaving the pearl or shell in its slot", () => {
  for (let i = 0; i < 50; i++) {
    const player = playerWith(407);
    open(player, 407);
    assert.deepEqual(player.messages, ["You open the oyster shell."]);
    assert.ok([409, 411].includes(player.getInventory().forSlot(7).getId()));
    assert.equal(player.dialogues.length, 0);
  }
});

test("captures: a dossier's contracts are three unstacked items starting in its slot, with sound 6765", () => {
  const contracts = [30810, 30813, 30816, 30819, 30822];
  let seen = 0;
  for (let i = 0; i < 100; i++) {
    const player = playerWith(30803);
    open(player, 30803);
    assert.deepEqual(player.sounds, [6765]);
    const given = player.getInventory().forSlot(7).getId();
    assert.match(player.messages[0], /^You open the dossier and find [a-z' ]+ inside!$/);
    if (!contracts.includes(given)) continue;
    seen++;
    assert.equal(player.getInventory().forSlot(7).getAmount(), 1);
    assert.equal(player.getInventory().getAmount(given), 3);
  }
  assert.ok(seen > 0);
});

const fullExceptSlot7 = (id, free = 0) => {
  const player = playerWith(id, { fill: true });
  for (let slot = 27; slot > 27 - free; slot--) player.getInventory().setItem(slot, new Item(-1, 0)); // Never slot 7.
  return player;
};
const need = { Casket: 1, Oyster: 1, "Bag full of gems": 6, "Hallowed sack": 11, "Spoils of War": 3, "Hunter kit": 9, Dossier: 3 };
const ids = { Casket: 405, Oyster: 407, "Bag full of gems": 19473, "Hallowed sack": 24946, "Spoils of War": 25342, "Hunter kit": 11159, Dossier: 30803 };

test("full bag: single-slot loot opens into its own slot with nothing left over", () => {
  for (const id of [405, 407]) {
    for (let i = 0; i < 50; i++) {
      const player = fullExceptSlot7(id);
      open(player, id);
      assert.equal(player.getInventory().getAmount(id), 0);
      assert.notEqual(player.getInventory().forSlot(7).getId(), -1);
      assert.equal(player.getInventory().getAmount(BONES), 27, "other items untouched");
    }
  }
});

test("too few spaces refuses with the captured line and keeps the item and the bag exactly", () => {
  for (const [name, slots] of Object.entries(need)) {
    if (slots === 1) continue;
    const id = ids[name];
    const player = fullExceptSlot7(id, slots - 2); // One short: the opened item's own slot counts.
    const held = player.getInventory().forSlot(7);
    open(player, id);
    assert.equal(player.getInventory().forSlot(7), held, `${name} was consumed`);
    assert.equal(player.getInventory().getAmount(BONES), 27 - (slots - 2));
    assert.equal(player.messages[0], `You don't have enough inventory space to open that. You need at least ${slots} spaces.`);
    assert.equal(player.dialogues.length, 1);
    assert.deepEqual(player.sounds, []);
  }
});

test("exactly enough spaces always fits the worst roll: nothing is lost to the ground", () => {
  for (const [name, slots] of Object.entries(need)) {
    const id = ids[name];
    for (let i = 0; i < 300; i++) {
      const player = fullExceptSlot7(id, slots - 1);
      const inventory = player.getInventory();
      const forceAdd = inventory.forceAdd;
      inventory.forceAdd = function (who, item) {
        assert.ok(this.getAddableAmount(item) >= item.getAmount(), `${name} overflowed with ${item.getId()}`);
        return forceAdd.call(this, who, item);
      };
      open(player, id);
      assert.equal(inventory.getAmount(id), 0);
      assert.equal(player.messages.some((text) => /enough inventory space/.test(text)), false, `${name} was refused`);
      assert.notEqual(inventory.forSlot(7).getId(), -1, `${name} left its slot empty`);
    }
  }
});

test("a stack of packs in a full bag has no slot to give, so it refuses and keeps the stack", () => {
  const arrowheads = 11885;
  const player = playerWith(arrowheads, { fill: true, amount: 3 });
  open(player, arrowheads);
  assert.equal(player.getInventory().getAmount(arrowheads), 3);
  assert.match(player.messages.at(-1), /enough inventory space/);
  assert.deepEqual(player.sounds, []);
});

test("a pack refused at a stack limit plays nothing; one joining a stack in a full bag empties its slot", () => {
  const limit = fullExceptSlot7(11881);
  limit.getInventory().setItem(0, new Item(314, 2147483600));
  open(limit, 11881);
  assert.equal(limit.getInventory().getAmount(11881), 1);
  assert.deepEqual(limit.sounds, []);

  const merge = fullExceptSlot7(11881);
  merge.getInventory().setItem(0, new Item(314, 5));
  open(merge, 11881);
  assert.equal(merge.getInventory().getAmount(314), 105);
  assert.equal(merge.getInventory().forSlot(7).getId(), -1);
});

test("opening closes any open dialogue, as the oyster capture does", () => {
  for (const id of [11881, 405, 407, 30803]) {
    const player = playerWith(id);
    open(player, id);
    assert.equal(player.closes, 1, `${id} left a dialogue open`);
  }
  const refused = playerWith(19473, { fill: true });
  open(refused, 19473);
  assert.equal(refused.closes, 1);
});

test("Entrana refuses Spoils of War and Hunter kits without consuming them; a pack and a casket still open", () => {
  const island = { getX: () => 2834, getY: () => 3335 };
  for (const [id, message] of [[25342, "You can't open this on Entrana."], [11159, "Some forms of Hunter gear are not appreciated by the monks."]]) {
    const player = playerWith(id);
    player.location = island;
    const held = player.getInventory().forSlot(7);
    open(player, id);
    assert.equal(player.getInventory().forSlot(7), held);
    assert.deepEqual(player.messages, [message]);
  }
  for (const id of [11881, 405]) {
    const player = playerWith(id);
    player.location = island;
    open(player, id);
    assert.equal(player.getInventory().getAmount(id), 0);
  }
});

test("rewards reach the collection log unnoted, and the Spoils pet roll awards through the pet event", () => {
  const seen = [];
  const pets = [];
  const api = PluginManager.createApi("OpenableItemsTest");
  api.onCustomEvent("collection-log:obtain", (request) => seen.push(request));
  api.onCustomEvent("pets:award", (request) => pets.push(request));
  const random = Math.random;
  try {
    Math.random = () => 0.9999999999; // The last entry of a table: the onyx.
    open(playerWith(19473), 19473);
    assert.ok(seen.some((request) => request.itemId === ItemIdentifiers.UNCUT_ONYX), "uncut onyx wasn't logged by its unnoted id");
    assert.deepEqual(pets, []);
    Math.random = () => 0;
    open(playerWith(25342), 25342);
    assert.equal(pets.length, 1);
    assert.equal(pets[0].itemId, ItemIdentifiers.LIL_CREATOR);
  } finally {
    Math.random = random;
  }
});
