// Run after `yarn build`: node --test tests/shades-coffins-bag.test.cjs
//
// Coffins and the Flamtaer bag (Wiki: Broken/Bronze/Steel/Black/Silver/Gold coffin, Flamtaer bag;
// docs/storage-items.md) with the real cache and plugin hooks. Dampe's words come from the generated
// transcript; the hand-outs and the material store are exercised here.
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
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const StorageItems = require("../plugins/items/StorageItems.plugin");
const Storage = require("../plugins/items/storage/Common.StorageItems");
const Coffin = require("../plugins/items/storage/Coffin.StorageItems");
const FlamtaerBag = require("../plugins/items/storage/FlamtaerBag.StorageItems");

let COFFIN;
let BAG;
const BROKEN = Items.BROKEN_COFFIN;
const BRONZE = Items.BRONZE_COFFIN;
const STEEL = Items.STEEL_COFFIN;
const OPEN_BRONZE = Items.OPEN_BRONZE_COFFIN;
const BRONZE_LOCKS = Items.BRONZE_LOCKS;
const STEEL_LOCKS = Items.STEEL_LOCKS;
const BAG_ID = Items.FLAMTAER_BAG;
const TIMBER = Items.TIMBER_BEAM;
const BRICK = Items.LIMESTONE_BRICK;
const PASTE = Items.SWAMP_PASTE;
const PLANKS = Items.PLANK;
let LOAR;
let PHRIN;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  LOAR = CacheDefinitions.getObjId("shade_bones1");
  PHRIN = CacheDefinitions.getObjId("shade_bones2");
  StorageItems.register(PluginManager.createApi("ShadesCoffinBagTest"));
  COFFIN = Storage.FAMILIES.get("coffin");
  BAG = Storage.FAMILIES.get("flamtaer-bag");
});

function createContainer(capacity, initial = [], isBank = false) {
  const items = initial;
  const container = {
    getItems: () => items,
    getValidItems: () => items.filter((item) => item.getId() > 0 && item.getAmount() > 0),
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((total, item) => total + item.getAmount(), 0),
    contains: (id) => items.some((item) => item.getId() === id && item.getAmount() > 0),
    getFreeSlots: () => capacity - container.getValidItems().length,
    isFull: () => container.getFreeSlots() === 0,
    getAddableAmount(item) {
      const requested = Math.max(0, Math.floor(item.getAmount()));
      if (item.getId() < 0 || !Number.isFinite(requested) || requested <= 0) return 0;
      if (isBank || item.getDefinition().isStackable()) {
        const stack = items.find((entry) => entry.getId() === item.getId()
          && JSON.stringify(entry.getMeta() ?? null) === JSON.stringify(item.getMeta() ?? null));
        if (stack) return Math.min(requested, Math.max(0, MAX_STACK_AMOUNT - stack.getAmount()));
        return container.getFreeSlots() > 0 ? Math.min(requested, MAX_STACK_AMOUNT) : 0;
      }
      return Math.min(requested, container.getFreeSlots());
    },
    add(item) {
      const amount = container.getAddableAmount(item);
      if (amount <= 0) return container;
      const stack = items.find((entry) => entry.getId() === item.getId()
        && JSON.stringify(entry.getMeta() ?? null) === JSON.stringify(item.getMeta() ?? null));
      if (stack && (isBank || item.getDefinition().isStackable())) stack.setAmount(stack.getAmount() + amount);
      else if (isBank || item.getDefinition().isStackable()) items.push(item.clone().setAmount(amount));
      else for (let i = 0; i < amount; i++) items.push(new Item(item.getId(), 1));
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
    isFullOf: () => false,
    full() { player.messages.push("inventory full"); },
    refreshItems: () => container,
  };
  return container;
}

let player;
function createPlayer(inventoryItems = []) {
  const inventory = createContainer(28, inventoryItems);
  const banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => createContainer(800, [], true));
  const equipment = Array.from({ length: 14 }, () => new Item(-1, 0));
  const attributes = new Map();
  const varps = new Map();
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    sendVarbit() {}, sendConfig: () => sender, sendInventory: () => sender,
    sendInterfaceScript: () => sender, sendClientScript: () => sender,
    sendSound: () => sender, sendSubInterface: () => sender, sendInterfaceFlagsRange: () => sender,
  };
  const p = {
    messages: [],
    boxes: [],
    status: PlayerStatus.NONE,
    sendMessage: (message) => p.messages.push(String(message)),
    getInventory: () => inventory,
    getBank: (tab) => banks[tab],
    getCurrentBankTab: () => 0,
    isSearchingBank: () => false,
    getStatus: () => p.status,
    getInterfaceId: () => -1,
    setInterfaceId: () => {},
    getEquipment: () => ({
      getItems: () => equipment,
      get: (slot) => equipment[slot],
      getValidItems: () => equipment.filter((item) => item.getId() > 0),
      refreshItems() {},
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (builder) => p.boxes.push([...builder.getDialogues().values()][0].text) }),
  };
  player = p;
  return p;
}

function item(id, count = 1) {
  return Array.from({ length: count }, () => new Item(id, 1));
}

function option(p, held, name) {
  const slot = p.getInventory().getItems().indexOf(held);
  const index = CacheDefinitions.getItem(held.getId()).inventoryActions.indexOf(name);
  return PluginManager.emitItemAction({
    player: p, interfaceId: 149 << 16, item: held, itemId: held.getId(), slot, clickType: index + 1, option: name, handled: false,
  });
}

function familyTotal(p, family) {
  return Storage.total(p, family);
}

test("Dampe hands out a broken coffin once and then refuses", () => {
  const p = createPlayer();
  const npcId = CacheDefinitions.getNpcId("shades_coffin_keeper");
  const first = { player: p, kind: "message", npcId, text: "Dampe hands you a broken coffin.", handled: false };
  Coffin._test.dampeAction(first);
  assert.equal(p.getInventory().getAmount(BROKEN), 1);
  assert.deepEqual(first.box, { items: [BROKEN] });

  const second = { player: p, kind: "message", npcId, text: "Dampe hands you a broken coffin.", handled: false };
  Coffin._test.dampeAction(second);
  assert.equal(p.getInventory().getAmount(BROKEN), 1);

  assert.equal(Coffin._test.dampeCondition({ player: p, npcId, text: "If the player already has one:" }), true);
  assert.equal(Coffin._test.dampeCondition({ player: p, npcId, text: "If the player does not have one:" }), false);
  assert.equal(Coffin._test.dampeCondition({ player: p, npcId, text: "If the player has a broken coffin:" }), true);
});

test("Dampe's Locks option plays the hand-in transcript with the carried coffin and lock", () => {
  const p = createPlayer([new Item(BRONZE), new Item(BRONZE_LOCKS)]);
  const seen = [];
  PluginManager.createApi("DampeLocksTest").onCustomEvent("npc-dialogue:start", (request) => seen.push(request.variant));
  Coffin._test.dampeLocks({ player: p, target: null, npcId: CacheDefinitions.getNpcId("shades_coffin_keeper") });
  assert.deepEqual(seen, ["using-locks-on-dampe-with-a-broken-coffin"]);
});

test("fitting locks upgrades the coffin and keeps the store", () => {
  const p = createPlayer([new Item(BROKEN), new Item(BRONZE_LOCKS)]);
  Storage.setContents(p, COFFIN, [{ id: LOAR, amount: 2 }]);
  assert.equal(Coffin._test.fitLock(p), true);
  assert.equal(p.getInventory().getAmount(BRONZE), 1);
  assert.equal(p.getInventory().getAmount(BROKEN), 0);
  assert.equal(p.getInventory().getAmount(BRONZE_LOCKS), 0);
  assert.equal(Coffin._test.capacity(p), 3);
  assert.equal(Storage.total(p, COFFIN), 2);

  p.getInventory().add(new Item(STEEL_LOCKS));
  assert.equal(Coffin._test.fitLock(p), true);
  assert.equal(p.getInventory().getAmount(STEEL), 1);
  assert.equal(p.getInventory().getAmount(STEEL_LOCKS), 0);
  assert.equal(Coffin._test.capacity(p), 8);
  assert.equal(Storage.total(p, COFFIN), 2);

  const again = createPlayer([new Item(STEEL), new Item(BRONZE_LOCKS)]);
  assert.equal(Coffin._test.fitLock(again), false);
  assert.equal(again.getInventory().getAmount(BRONZE_LOCKS), 1);
  assert.ok(again.messages.includes(Coffin.MESSAGE.BETTER_LOCK));
});

test("Fill respects the tier, Empty returns the highest remains first, Check counts them", () => {
  const p = createPlayer([new Item(BRONZE), ...item(LOAR, 2), ...item(PHRIN, 3)]);
  const coffin = p.getInventory().getItems().find((held) => held.getId() === BRONZE);
  option(p, coffin, "Fill");
  assert.equal(familyTotal(p, COFFIN), 3);
  assert.equal(p.getInventory().getAmount(LOAR) + p.getInventory().getAmount(PHRIN), 2);

  Coffin._test.check({ player: p });
  assert.ok(p.messages.includes("Your coffin is currently holding 3 shade remains."));

  Storage.setContents(p, COFFIN, [{ id: LOAR, amount: 1 }, { id: PHRIN, amount: 1 }]);
  option(p, coffin, "Empty");
  assert.equal(familyTotal(p, COFFIN), 0);
  assert.equal(p.getInventory().getAmount(PHRIN) >= 1, true);
});

test("Configure's remove-lock returns the lock, breaks the coffin and loses the remains", () => {
  const p = createPlayer([new Item(BRONZE)]);
  Storage.setContents(p, COFFIN, [{ id: LOAR, amount: 2 }]);
  Coffin._test.removeLock(p);
  assert.equal(p.getInventory().getAmount(BROKEN), 1);
  assert.equal(p.getInventory().getAmount(BRONZE_LOCKS), 1);
  assert.equal(familyTotal(p, COFFIN), 0);
  assert.ok(p.messages.includes(Coffin.MESSAGE.REMOVED));
});

test("the open coffin is the fill state of the same store", () => {
  const p = createPlayer([new Item(BRONZE)]);
  Storage.toggle(p, COFFIN, p.getInventory().getItems()[0]);
  assert.equal(p.getInventory().getAmount(OPEN_BRONZE), 1);
  assert.equal(p.getInventory().getAmount(BRONZE), 0);
  assert.equal(Storage.hasOpen(p, COFFIN), true);
});

test("the Flamtaer bag stores the three materials up to the Wiki's caps", () => {
  const p = createPlayer([new Item(BAG_ID), ...item(TIMBER, 61), ...item(BRICK, 2), ...item(PASTE, 501), new Item(PLANKS)]);
  const bag = p.getInventory().getItems().find((held) => held.getId() === BAG_ID);
  option(p, bag, "Fill");
  assert.equal(Storage.amountOf(p, BAG, TIMBER), 60);
  assert.equal(Storage.amountOf(p, BAG, BRICK), 2);
  assert.equal(Storage.amountOf(p, BAG, PASTE), 500);
  assert.equal(p.getInventory().getAmount(TIMBER), 1);
  assert.equal(p.getInventory().getAmount(PASTE), 1);
  assert.equal(p.getInventory().getAmount(PLANKS), 1);

  option(p, bag, "Check");
  assert.ok(p.messages.some((line) => line.includes("Timber beams: 60")));
});

test("a carried bag's materials answer the temple's storage:amount / storage:take", () => {
  const p = createPlayer([new Item(BAG_ID)]);
  Storage.setContents(p, BAG, [{ id: BRICK, amount: 2 }, { id: TIMBER, amount: 1 }, { id: PASTE, amount: 10 }]);
  const amount = { player: p, itemId: BRICK, amount: p.getInventory().getAmount(BRICK) };
  PluginManager.emitCustomEvent("storage:amount", amount);
  assert.equal(amount.amount, 2);
  const take = { player: p, itemId: PASTE, amount: 5, taken: 0 };
  PluginManager.emitCustomEvent("storage:take", take);
  assert.equal(take.taken, 5);
  assert.equal(Storage.amountOf(p, BAG, PASTE), 5);
});

test("the Flamtaer bag's store is lost with a carried bag on death, not a banked one", () => {
  const p = createPlayer([new Item(BAG_ID)]);
  Storage.setContents(p, BAG, [{ id: BRICK, amount: 3 }]);
  PluginManager.emitPlayerDeathDrops({ player: p, layout: { inventory: [BAG_ID], equipment: [] }, items: [], untradeables: [] });
  assert.equal(Storage.total(p, BAG), 0);

  Storage.setContents(p, BAG, [{ id: BRICK, amount: 3 }]);
  PluginManager.emitPlayerDeathDrops({ player: p, layout: { inventory: [], equipment: [] }, items: [], untradeables: [] });
  assert.equal(Storage.total(p, BAG), 3);
});

test("the plank refusal is the Wiki's line", () => {
  const p = createPlayer([new Item(BAG_ID), new Item(PLANKS)]);
  const bag = p.getInventory().getItems().find((held) => held.getId() === BAG_ID);
  option(p, bag, "Fill");
  assert.ok(p.messages.includes(FlamtaerBag.MESSAGE.PLANKS));
});
