// Run after `yarn build`: node --test tests/storage-items.test.cjs
// Checks the storage items against docs/storage-items.md, with the real cache and plugin hooks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

const StorageItems = require("../plugins/items/StorageItems.plugin");
const Storage = require("../plugins/items/storage/Common.StorageItems");
const CoalBag = require("../plugins/items/storage/CoalBag.StorageItems");
const GemBag = require("../plugins/items/storage/GemBag.StorageItems");
const FishBarrel = require("../plugins/items/storage/FishBarrel.StorageItems");
const LogBasket = require("../plugins/items/storage/LogBasket.StorageItems");
const TackleBox = require("../plugins/items/storage/TackleBox.StorageItems");
const ForestryKit = require("../plugins/items/storage/ForestryKit.StorageItems");
const Smithing = require("../plugins/skills/Smithing.plugin");
const Superheat = require("../plugins/skills/smithing/Superheat.Smithing");

const OPEN_COAL_BAG = Items.OPEN_COAL_BAG;
const COAL_BAG = Items.COAL_BAG_2;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  StorageItems.register(PluginManager.createApi("StorageItemsTest"));
  Smithing.register(PluginManager.createApi("SmithingTest"));
  // The SkillCapes plugin's answer, for a player marked as wearing the Smithing cape.
  PluginManager.createApi("SkillCapesTest").onCustomEvent("skillcape:has-perk", (request) => {
    if (request.skill === "SMITHING" && request.player.smithingCape) request.result = true;
  });
});

function createContainer(capacity, initial = []) {
  const items = initial;
  const container = {
    getItems: () => items,
    getValidItems: () => items.filter((item) => item.getId() > 0 && item.getAmount() > 0),
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((total, item) => total + item.getAmount(), 0),
    contains: (id) => items.some((item) => item.getId() === id && item.getAmount() > 0),
    getFreeSlots: () => capacity - container.getValidItems().length,
    isFull: () => container.getFreeSlots() === 0,
    add(item) {
      const stack = items.find((entry) => entry.getId() === item.getId());
      if (stack && item.getDefinition().isStackable()) stack.setAmount(stack.getAmount() + item.getAmount());
      else if (item.getDefinition().isStackable()) items.push(item.clone());
      else for (let i = 0; i < item.getAmount() && container.getFreeSlots() > 0; i++) items.push(new Item(item.getId(), 1));
      return container;
    },
    addItem: (item) => container.add(item, true),
    adds: (id, amount) => container.add(new Item(id, amount), true),
    deleteNumber(id, amount) {
      let left = amount;
      for (const item of [...items]) {
        if (left <= 0 || item.getId() !== id) continue;
        const taken = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - taken);
        left -= taken;
        if (item.getAmount() <= 0) items.splice(items.indexOf(item), 1);
      }
      return container;
    },
    delete: (id, amount) => container.deleteNumber(id, amount),
    deletes: (item) => container.deleteNumber(item.getId(), item.getAmount()),
    isFullOf: () => false,
    refreshItems: () => container,
  };
  return container;
}

function createPlayer(inventoryItems = []) {
  const inventory = createContainer(28, inventoryItems);
  const banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => createContainer(800));
  const equipment = Array.from({ length: 14 }, () => new Item(-1, 0));
  const attributes = new Map();
  const varps = new Map();
  const log = [];
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    getVarbit(id) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return (sender.getVarp(baseVar) >>> startBit) & ((2 ** (endBit - startBit + 1)) - 1);
    },
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((2 ** (endBit - startBit + 1)) - 1) * 2 ** startBit;
      varps.set(baseVar, ((sender.getVarp(baseVar) & ~mask) | ((value * 2 ** startBit) & mask)) | 0);
      return sender;
    },
    sendConfig(id, value) {
      varps.set(id, value | 0);
      return sender;
    },
    sendInventory(id, capacity, items) {
      log.push(`inv ${id} ${capacity} ${items.map((entry) => `${entry.id}x${entry.amount}`).join(",")}`);
      return sender;
    },
    sendInterfaceScript(id, args) {
      log.push(`script ${id} [${args}]`);
      return sender;
    },
    sendClientScript(id, ...args) {
      log.push(`script ${id} [${args}]`);
      return sender;
    },
    sendSound(id) {
      log.push(`sound ${id?.getId?.() ?? id?.id ?? id}`);
      return sender;
    },
    sendSubInterface(target, group, type) {
      log.push(`open ${target >>> 16}:${target & 0xffff} ${group} ${type}`);
      return sender;
    },
    sendInterfaceFlagsRange(uid, from, to, flags) {
      log.push(`flags ${uid >>> 16}:${uid & 0xffff} ${from}-${to} ${flags}`);
      return sender;
    },
  };
  const player = {
    messages: [],
    boxes: [],
    log,
    interfaceId: -1,
    status: PlayerStatus.NONE,
    sendMessage: (message) => player.messages.push(message),
    getInventory: () => inventory,
    getBank: (tab) => banks[tab],
    getCurrentBankTab: () => 0,
    isSearchingBank: () => false,
    getStatus: () => player.status,
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: (id) => { player.interfaceId = id; },
    getEquipment: () => ({
      getItems: () => equipment,
      get: (slot) => equipment[slot],
      getValidItems: () => equipment.filter((item) => item.getId() > 0),
      containsAllItem: () => true,
      refreshItems() {},
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (builder) => player.boxes.push([...builder.getDialogues().values()][0].text) }),
    levels: { magic: 99, smithing: 99 },
    xp: [],
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.SMITHING ? player.levels.smithing : player.levels.magic),
      getMaxLevel: (skill) => (skill === Skill.SMITHING ? player.levels.smithing : player.levels.magic),
      addExperiences: (skill, xp) => player.xp.push([skill.getName?.() ?? String(skill), xp]),
    }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getCombat: () => ({ setCastSpell() {}, reset() {} }),
    performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
    performGraphic: (graphic) => log.push(`gfx ${graphic.getId()}`),
  };
  return player;
}

const items = (id, count) => Array.from({ length: count }, () => new Item(id, 1));

function option(player, item, name, extra = {}) {
  const slot = player.getInventory().getItems().indexOf(item);
  const index = CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf(name);
  return PluginManager.emitItemAction({
    player, interfaceId: 149 << 16, item, itemId: item.getId(), slot, clickType: index + 1, option: name, handled: false, ...extra,
  });
}

function gather(player, itemId, amount = 1) {
  const request = { player, itemId, amount, stored: 0 };
  PluginManager.emitCustomEvent(Storage.GATHER_EVENT, request);
  return request.stored;
}

function room(player, itemId) {
  const request = { player, itemId, room: false };
  PluginManager.emitCustomEvent(Storage.ROOM_EVENT, request);
  return request.room;
}

function storedAmount(player, itemId) {
  const request = { player, itemId, amount: 0 };
  PluginManager.emitCustomEvent(Storage.AMOUNT_EVENT, request);
  return request.amount;
}

const family = (key) => Storage.FAMILIES.get(key);

test("the coal bag fills to 27, or 36 with the Smithing cape's perk, and reports the count", () => {
  const bag = new Item(COAL_BAG, 1);
  const player = createPlayer([bag, ...items(Items.COAL, 27)]);
  option(player, bag, "Fill");
  assert.equal(Storage.total(player, family("coal-bag")), 27);
  assert.equal(player.getInventory().getAmount(Items.COAL), 0);
  assert.deepEqual(player.messages, ["The coal bag contains 27 pieces of coal."]);

  player.getInventory().getItems().push(...items(Items.COAL, 5));
  option(player, bag, "Fill");
  assert.equal(player.messages.at(-1), "The coal bag can hold only 27 pieces of coal.");

  player.smithingCape = true;
  option(player, bag, "Fill");
  assert.equal(Storage.total(player, family("coal-bag")), 32);
  assert.equal(CoalBag.capacity(player), 36);
});

test("the coal bag empties into the inventory and says when it is empty", () => {
  const bag = new Item(COAL_BAG, 1);
  const player = createPlayer([bag]);
  option(player, bag, "Check");
  assert.equal(player.messages.at(-1), "The coal bag is empty.");
  Storage.store(player, family("coal-bag"), Items.COAL, 10);
  option(player, bag, "Empty");
  assert.equal(player.getInventory().getAmount(Items.COAL), 10);
  assert.equal(player.messages.at(-1), "The coal bag is now empty.");
});

test("only an open coal bag takes mined coal, and only while it has room", () => {
  const bag = new Item(COAL_BAG, 1);
  const player = createPlayer([bag, ...items(Items.LOGS, 27)]);
  assert.equal(gather(player, Items.COAL), 0);
  assert.equal(room(player, Items.COAL), false);
  option(player, bag, "Open");
  assert.equal(bag.getId(), OPEN_COAL_BAG);
  option(player, bag, "Close");
  assert.equal(bag.getId(), COAL_BAG, "closes back to the real coal bag, not the unused 764");
  option(player, bag, "Open");
  assert.equal(room(player, Items.COAL), true);
  assert.equal(gather(player, Items.COAL), 1);
  assert.equal(room(player, Items.IRON_ORE), false);
  Storage.store(player, family("coal-bag"), Items.COAL, 26);
  assert.equal(room(player, Items.COAL), false);
});

test("smelting counts and takes the bag's coal after the inventory's", () => {
  const bag = new Item(COAL_BAG, 1);
  const player = createPlayer([bag, new Item(Items.COAL, 1)]);
  Storage.store(player, family("coal-bag"), Items.COAL, 5);
  assert.equal(storedAmount(player, Items.COAL), 5);
  const take = { player, itemId: Items.COAL, amount: 3, taken: 0 };
  PluginManager.emitCustomEvent(Storage.TAKE_EVENT, take);
  assert.equal(take.taken, 3);
  assert.equal(Storage.total(player, family("coal-bag")), 2);
});

test("a coal bag with coal in it can't be destroyed", () => {
  const bag = new Item(COAL_BAG, 1);
  const player = createPlayer([bag]);
  Storage.store(player, family("coal-bag"), Items.COAL, 1);
  const event = { player, interfaceId: 0, item: bag, itemId: bag.getId(), slot: 0, dropToGround: false, handled: false };
  PluginManager.emitItemDropPolicy(event);
  assert.equal(event.handled, true);
  assert.equal(player.messages.at(-1), CoalBag.MESSAGE.CANT_DESTROY);
});

test("the gem bag holds 60 of each uncut gem and takes picked-up gems while open", () => {
  const bag = new Item(Items.GEM_BAG_2, 1);
  const player = createPlayer([bag, ...items(Items.UNCUT_RUBY, 3), ...items(Items.UNCUT_SAPPHIRE, 2)]);
  option(player, bag, "Fill");
  assert.equal(player.messages.at(-1), GemBag.FILLED);
  assert.equal(Storage.amountOf(player, family("gem-bag"), Items.UNCUT_RUBY), 3);
  Storage.store(player, family("gem-bag"), Items.UNCUT_RUBY, 100);
  assert.equal(Storage.amountOf(player, family("gem-bag"), Items.UNCUT_RUBY), 60);
  assert.equal(gather(player, Items.UNCUT_DIAMOND), 0);
  option(player, bag, "Open");
  assert.equal(bag.getId(), Items.OPEN_GEM_BAG);
  option(player, bag, "Close");
  assert.equal(bag.getId(), Items.GEM_BAG_2);
  option(player, bag, "Open");
  assert.equal(gather(player, Items.UNCUT_DIAMOND), 1);
  assert.equal(player.messages.at(-1), GemBag.STRAIGHT_IN);
  // Empty starts with sapphires.
  option(player, bag, "Empty");
  assert.equal(player.getInventory().getAmount(Items.UNCUT_SAPPHIRE), 2);
});

test("the fish barrel takes 28 raw fish, says when it is full, and empties only at a bank", () => {
  const barrel = new Item(Items.OPEN_FISH_BARREL, 1);
  const player = createPlayer([barrel]);
  assert.equal(gather(player, Items.RAW_SHARK, 1), 1);
  assert.equal(gather(player, Items.RAW_KARAMBWANJI, 1), 0, "stackable fish don't go in");
  Storage.store(player, family("fish-barrel"), Items.RAW_SWORDFISH, 26);
  assert.equal(gather(player, Items.RAW_SHARK, 1), 1);
  assert.equal(player.messages.at(-1), FishBarrel.FULL);
  assert.equal(room(player, Items.RAW_SHARK), false);

  option(player, barrel, "Check");
  assert.deepEqual(player.boxes.at(-1), "The barrel contains:<br>2 x Raw shark, 26 x Raw swordfish");

  player.status = PlayerStatus.BANKING;
  player.interfaceId = Bank.MAIN_INTERFACE_ID;
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: barrel, slot: 0, op: 9, handled: false });
  assert.equal(Storage.total(player, family("fish-barrel")), 0);
  assert.equal(player.getBank(Bank.getTabForItem(player, Items.RAW_SHARK)).getAmount(Items.RAW_SHARK), 2);
});

test("a fish barrel that falls on death takes its fish with it; a kept one keeps them", () => {
  const barrel = new Item(Items.FISH_BARREL, 1);
  const player = createPlayer([]);
  Storage.store(player, family("fish-barrel"), Items.RAW_SHARK, 3);
  const kept = { player, killer: null, location: null, items: [], untradeables: [barrel], layout: {} };
  PluginManager.emitPlayerDeathDrops(kept);
  assert.equal(Storage.total(player, family("fish-barrel")), 3);
  const dropped = { player, killer: null, location: null, items: [barrel], untradeables: [], layout: {} };
  PluginManager.emitPlayerDeathDrops(dropped);
  assert.equal(Storage.total(player, family("fish-barrel")), 0);
  assert.deepEqual(dropped.items.slice(1).map((item) => [item.getId(), item.getAmount()]), [[Items.RAW_SHARK, 3]]);
});

test("the log basket takes logs while open, worn or carried, and empties with its messages", () => {
  const basket = new Item(Items.OPEN_LOG_BASKET, 1);
  const player = createPlayer([basket, ...items(Items.LOGS, 25)]);
  assert.equal(gather(player, Items.YEW_LOGS), 1);
  Storage.store(player, family("log-basket"), Items.OAK_LOGS, 27);
  assert.equal(gather(player, Items.YEW_LOGS), 0);
  option(player, basket, "Check", { subOpId: 1 });
  assert.equal(player.messages.at(-1), LogBasket.MESSAGE.EMPTIED_SOME);
  assert.equal(player.getInventory().getFreeSlots(), 0);

  const worn = createPlayer([]);
  worn.getEquipment().getItems()[Equipment.CAPE_SLOT] = new Item(Items.OPEN_LOG_BASKET, 1);
  assert.equal(gather(worn, Items.MAGIC_LOGS), 1);
});

test("the plank sack fills from the sawmill whenever carried and sends its plank varbits", () => {
  const sack = new Item(Items.PLANK_SACK, 1);
  const player = createPlayer([sack]);
  assert.equal(gather(player, Items.OAK_PLANK, 1), 1);
  assert.equal(player.getPacketSender().getVarbit(CacheDefinitions.getVarbitId("plank_sack_oak")), 1);
  assert.equal(storedAmount(player, Items.OAK_PLANK), 1);
});

test("the tackle box opens as captured, stores only tackle, and gives up bait but not gear", () => {
  const box = new Item(Items.TACKLE_BOX, 1);
  const player = createPlayer([box, new Item(Items.FISHING_BAIT, 50), new Item(Items.HARPOON, 1), new Item(Items.LOGS, 1)]);
  option(player, box, "Fill");
  assert.deepEqual(Storage.contents(player, family("tackle-box")).map((entry) => entry.id), [Items.FISHING_BAIT, Items.HARPOON]);
  assert.equal(player.getInventory().getAmount(Items.LOGS), 1);
  assert.equal(storedAmount(player, Items.FISHING_BAIT), 50);
  assert.equal(storedAmount(player, Items.HARPOON), 0, "gear has to come out first");

  option(player, box, "View");
  assert.equal(player.interfaceId, 683);
  assert.deepEqual(player.log.slice(0, 4), [
    `inv 651 35 ${Items.FISHING_BAIT}x50,${Items.HARPOON}x1`,
    "script 917 [-1,-1]",
    "open 161:16 683 0",
    "open 161:74 684 3",
  ]);

  option(player, box, "Empty");
  assert.equal(player.messages.at(-1), TackleBox.MESSAGE.EMPTIED);
  assert.equal(player.getInventory().getAmount(Items.FISHING_BAIT), 50);
});

function kitClick(player, childId, action = 1, slot = -1, groupId = 823) {
  return PluginManager.emitInterfaceActionClick({
    player, buttonId: (groupId << 16) | childId, groupId, childId, action, slot, itemId: -1, handled: false,
  });
}

test("the Forestry kit opens as captured and stores enum 817's items, but no outfit without a pouch", () => {
  const kit = new Item(Items.FORESTRY_KIT, 1);
  const player = createPlayer([kit, new Item(Items.ANIMA_INFUSED_BARK, 40), ...items(Items.OAK_LEAVES, 3), new Item(Items.LUMBERJACK_TOP, 1), new Item(Items.LOGS, 1)]);
  option(player, kit, "Fill");
  assert.deepEqual(Storage.contents(player, family("forestry-kit")), [
    { id: Items.ANIMA_INFUSED_BARK, amount: 40 }, { id: Items.OAK_LEAVES, amount: 3 },
  ]);
  assert.equal(player.getInventory().getAmount(Items.LUMBERJACK_TOP), 1, "the clothes pouch isn't installed");
  assert.equal(player.getInventory().getAmount(Items.LOGS), 1);

  option(player, kit, "Fill");
  assert.equal(player.messages.at(-1), ForestryKit.MESSAGE.NOTHING, "captured line with nothing to store");

  option(player, kit, "View");
  assert.equal(player.interfaceId, 823);
  assert.deepEqual(player.log.slice(0, 6), [
    `inv 814 10 ${Items.ANIMA_INFUSED_BARK}x40,${Items.OAK_LEAVES}x3`,
    "script 917 [-1,-3]",
    "open 161:16 823 0",
    "open 161:74 822 0",
    "flags 823:21 0-252 1150",
    "flags 822:0 0-27 1180734",
  ]);

  kitClick(player, 12);
  assert.equal(player.getPacketSender().getVarbit(14985), 1, "Withdraw-5 selects quantity 1 (5)");
  kitClick(player, 21, 1, 0);
  assert.equal(player.getInventory().getAmount(Items.ANIMA_INFUSED_BARK), 5);
  kitClick(player, 21, 5, 1);
  assert.equal(player.getInventory().getAmount(Items.OAK_LEAVES), 3, "op 5 withdraws all");
  const leaves = player.getInventory().getItems().findIndex((item) => item.getId() === Items.OAK_LEAVES);
  kitClick(player, 0, 2, leaves, 822);
  assert.equal(player.getInventory().getAmount(Items.OAK_LEAVES), 2, "op 2 deposits one");
  kitClick(player, 16);
  assert.equal(Storage.total(player, family("forestry-kit")), 0);
  assert.equal(player.getInventory().getAmount(Items.ANIMA_INFUSED_BARK), 40);
});

test("a carried or worn Forestry kit, or a forestry basket, takes earned leaves and bark", () => {
  assert.equal(gather(createPlayer([]), Items.ANIMA_INFUSED_BARK, 4), 0, "no kit: it goes to the pack");
  const carried = createPlayer([new Item(Items.FORESTRY_KIT, 1)]);
  assert.equal(gather(carried, Items.ANIMA_INFUSED_BARK, 4), 4);
  const worn = createPlayer([]);
  worn.getEquipment().getItems()[Equipment.CAPE_SLOT] = new Item(Items.FORESTRY_KIT, 1);
  assert.equal(gather(worn, Items.LEAVES, 2), 2);
  const basket = createPlayer([new Item(Items.FORESTRY_BASKET, 1)]);
  assert.equal(gather(basket, Items.ANIMA_INFUSED_BARK, 3), 3);
  assert.equal(gather(basket, Items.YEW_LOGS, 1), 0, "a closed basket takes no logs");
  assert.equal(storedAmount(carried, Items.ANIMA_INFUSED_BARK), 4, "the Forestry Shop can spend kit bark");
});

test("the forestry basket's Forestry kit sub-options reach the kit, and Dismantle takes it apart", () => {
  const basket = new Item(Items.FORESTRY_BASKET, 1);
  const player = createPlayer([basket, new Item(Items.ANIMA_INFUSED_BARK, 10), new Item(Items.OAK_LOGS, 1)]);
  option(player, basket, "Fill", { subOpId: 1 });
  assert.equal(Storage.amountOf(player, family("forestry-kit"), Items.ANIMA_INFUSED_BARK), 10);
  assert.equal(Storage.total(player, family("log-basket")), 0, "the kit sub-option doesn't fill the basket");
  option(player, basket, "View", { subOpId: 1 });
  assert.equal(player.interfaceId, 823);

  option(player, basket, "Configure", { subOpId: 2 });
  assert.equal(basket.getId(), Items.LOG_BASKET);
  assert.equal(player.getInventory().getAmount(Items.FORESTRY_KIT), 1);
  assert.equal(player.getInventory().getAmount(Items.STURDY_HARNESS), 1);
  assert.equal(Storage.amountOf(player, family("forestry-kit"), Items.ANIMA_INFUSED_BARK), 10, "the kit keeps its contents");
});

test("the Forestry kit's contents go with the last kit or forestry basket destroyed", () => {
  const player = createPlayer([new Item(Items.FORESTRY_BASKET, 1)]);
  Storage.store(player, family("forestry-kit"), Items.LEAVES, 5);
  PluginManager.emitCustomEvent("destroy-item:destroyed", { player, itemId: Items.FORESTRY_KIT, amount: 1 });
  assert.equal(Storage.total(player, family("forestry-kit")), 5, "the basket still holds a kit");
  player.getInventory().getItems().length = 0;
  PluginManager.emitCustomEvent("destroy-item:destroyed", { player, itemId: Items.FORESTRY_BASKET, amount: 1 });
  assert.equal(Storage.total(player, family("forestry-kit")), 0);
});

test("destroying the last container of a family loses its contents", () => {
  const player = createPlayer([]);
  Storage.store(player, family("tackle-box"), Items.FISHING_BAIT, 5);
  PluginManager.emitCustomEvent("destroy-item:destroyed", { player, itemId: Items.TACKLE_BOX, amount: 1 });
  assert.equal(Storage.total(player, family("tackle-box")), 0);
});

test("the tackle box takes lit lanterns but not unlit ones, and swaps dragged slots", () => {
  const lit = CacheDefinitions.getObjId("oil_lantern_lit");
  const unlit = CacheDefinitions.getObjId("oil_lantern_unlit");
  assert.equal(TackleBox.tackleIds().has(lit), true);
  assert.equal(TackleBox.tackleIds().has(unlit), false);

  const player = createPlayer([new Item(Items.TACKLE_BOX, 1)]);
  const box = family("tackle-box");
  Storage.store(player, box, Items.HARPOON, 1);
  Storage.store(player, box, Items.FISHING_BAIT, 10);
  Storage.store(player, box, Items.LOBSTER_POT, 1);
  player.interfaceId = 683;
  const grid = (683 << 16) | 11;
  const drag = (sourceSlot, targetSlot) => {
    const event = { player, packet: { sourceWidgetId: grid, targetWidgetId: grid, sourceSlot, targetSlot }, handled: false };
    PluginManager.emitCustomEvent("player:widget-action", event);
    return event.handled;
  };
  assert.equal(drag(0, 2), true);
  assert.deepEqual(Storage.contents(player, box).map((entry) => entry.id), [Items.LOBSTER_POT, Items.FISHING_BAIT, Items.HARPOON]);
  drag(0, 20);
  assert.deepEqual(Storage.contents(player, box).map((entry) => entry.id), [Items.FISHING_BAIT, Items.HARPOON, Items.LOBSTER_POT]);
});

function superheat(player, itemId) {
  const slot = player.getInventory().getItems().findIndex((item) => item.getId() === itemId);
  const event = { player, spellName: "Superheat Item", spellWidget: 0, spellItemId: -1, itemId, slot, handled: false };
  PluginManager.emitSpellOnItem(event);
  return event.handled;
}

const runes = () => [new Item(Items.FIRE_RUNE, 100), new Item(Items.NATURE_RUNE, 100)];

test("Superheat Item smelts the cast ore as captured and uses the coal bag after the inventory", () => {
  const bag = new Item(COAL_BAG, 1);
  const player = createPlayer([...runes(), bag, new Item(Items.MITHRIL_ORE, 1), new Item(Items.COAL, 1)]);
  Storage.store(player, family("coal-bag"), Items.COAL, 5);
  assert.equal(superheat(player, Items.MITHRIL_ORE), true);
  assert.equal(player.getInventory().getAmount(Items.MITHRIL_BAR), 1);
  assert.equal(player.getInventory().getAmount(Items.MITHRIL_ORE), 0);
  assert.equal(player.getInventory().getAmount(Items.COAL), 0);
  assert.equal(Storage.total(player, family("coal-bag")), 2);
  assert.equal(player.getInventory().getAmount(Items.FIRE_RUNE), 96);
  assert.equal(player.getInventory().getAmount(Items.NATURE_RUNE), 99);
  assert.deepEqual(player.log.filter((line) => /^(anim|gfx|script|sound)/.test(line)), ["anim 725", "gfx 148", "script 915 [6]", "sound 190"]);
  assert.deepEqual(player.xp.map(([, xp]) => xp), [53, 30]);
});

test("Superheat Item makes steel from iron with two coal, iron without, and refuses coal", () => {
  const player = createPlayer([...runes(), new Item(Items.IRON_ORE, 1), new Item(Items.IRON_ORE, 1), ...items(Items.COAL, 2)]);
  superheat(player, Items.IRON_ORE);
  assert.equal(player.getInventory().getAmount(Items.STEEL_BAR), 1);
  // Skip the 3-tick cast delay.
  player.setAttribute("superheat:next-cast-at", 0);
  player.setAttribute("magic:next-cast-at", 0);
  superheat(player, Items.IRON_ORE);
  assert.equal(player.getInventory().getAmount(Items.IRON_BAR), 1);

  const coal = createPlayer([...runes(), new Item(Items.COAL, 1)]);
  superheat(coal, Items.COAL);
  assert.equal(coal.messages.at(-1), Superheat.MESSAGE.NOT_ORE);
  assert.deepEqual(coal.log.filter((line) => /^(gfx|script|sound)/.test(line)), ["gfx 85", "script 915 [6]", "sound 191"]);
  assert.equal(coal.getInventory().getAmount(Items.FIRE_RUNE), 100, "no runes on a failed cast");
});

test("in the bank, the plank sack's op reads Fill while the inventory has planks, else Empty", () => {
  const sack = new Item(Items.PLANK_SACK, 1);
  const player = createPlayer([new Item(Items.LOGS, 1), sack, new Item(Items.OAK_PLANK, 1)]);
  PluginManager.emitCustomEvent(Bank.REFRESHED_EVENT, { player });
  assert.equal(player.getPacketSender().getVarp(264), 1 << 1, "if4 bit for the sack's slot");
  player.getInventory().deleteNumber(Items.OAK_PLANK, 1);
  PluginManager.emitCustomEvent(Bank.REFRESHED_EVENT, { player });
  assert.equal(player.getPacketSender().getVarp(264), 0);
});

test("coal saved by the old CoalBag plugin moves into the bag on login", () => {
  const player = createPlayer([new Item(COAL_BAG, 1)]);
  player.setAttribute("coal-bag:coal", 12);
  PluginManager.emitPlayerLogin({ player, username: "storetest" });
  assert.equal(Storage.total(player, family("coal-bag")), 12);
  assert.equal(player.getAttribute("coal-bag:coal"), 0);
});
