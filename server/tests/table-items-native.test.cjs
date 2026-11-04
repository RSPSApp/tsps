// Run after `yarn build`: node --test tests/table-items-native.test.cjs
//
// Native item-on-object dispatch for tables. The native producer captures the clicked Item before
// walking to the table, and the inventory can be rearranged during the walk: a slot switch puts a
// different item (same id, different metadata) in the clicked slot. Only the exact clicked item
// may be removed and placed, or the swap duplicates the item.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Item } = require("../dist/game/model/Item");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const { PluginManager } = require("../dist/plugins/PluginManager");

const TABLE_ID = 593;
const TABLE_LOCATION = new Location(3222, 3218, 0);
const WHIP = 4151;
const TRADEABLE_BOND = 13190;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  // The real API registers the plugin's fallback hook on the native item-on-object event.
  require("../plugins/world/TableItems.plugin").register(PluginManager.createApi("TableItems"));
  // The bond's protection is a registered item-drop policy, so table placement must honour it.
  require("../plugins/items/Bonds.plugin").register(PluginManager.createApi("Bonds"));
});

/** A real cache table in a private area, as the producer path sees it. */
function tableFixture() {
  const area = new PrivateArea();
  const table = new GameObject(TABLE_ID, TABLE_LOCATION.clone(), 10, 0, area);
  return { area, table };
}

function useOnTable({ area, items }) {
  const messages = [];
  const player = {
    getUsername: () => "table-native",
    getLocation: () => new Location(3222, 3219, 0),
    getPrivateArea: () => area,
    setPositionToFace: () => {},
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({ getInterfaceId: () => -1, sendItemContainer: () => {} }),
  };
  const inventory = new Inventory(player);
  items.forEach((item, slot) => inventory.setItem(slot, item));
  player.getInventory = () => inventory;

  // The native producer holds the clicked Item until the walk finishes.
  let arrive = null;
  const queue = {
    walkToObject: (_object, callback) => { arrive = callback.execute; },
    reset: () => {},
    walkToReset: () => {},
  };
  player.getMovementQueue = () => queue;

  UseItemPacketListener.itemOnObject(
    player, 149, TABLE_ID, items[0].getId(), 0, TABLE_LOCATION.getX(), TABLE_LOCATION.getY(),
  );
  assert.equal(typeof arrive, "function", "the item use is queued behind the walk");
  return { player, inventory, messages, arrive: () => arrive() };
}

function presetWhip() {
  return new Item(WHIP, 1, {
    [Item.UNTRADEABLE_META]: true,
    [Item.UNBANKABLE_META]: true,
    [Item.PRESET_META]: true,
  });
}

function newGroundItems(since) {
  return World.getItems().slice(since);
}

test("cache: table 593 is a real table and an abyssal whip is tradeable", () => {
  assert.equal(ObjectDefinition.forId(TABLE_ID).getName(), "Table");
  const whip = new Item(WHIP, 1);
  assert.equal(whip.isTradeable(), true);
  assert.equal(whip.isDropable(), true);
});

test("native use removes the clicked item and places it on the table", () => {
  const since = World.getItems().length;
  try {
    const fixture = tableFixture();
    const whip = new Item(WHIP, 1);
    const { inventory, messages, arrive } = useOnTable({ area: fixture.area, items: [whip] });

    arrive();

    assert.equal(messages.length, 0);
    assert.equal(inventory.getItems()[0].getId(), -1, "the clicked slot is emptied");
    const placed = newGroundItems(since);
    assert.equal(placed.length, 1, "one stack goes on the table");
    const [ground] = placed;
    assert.equal(ground.getItem().getId(), WHIP);
    assert.equal(ground.getItem().getAmount(), 1);
    assert.equal(ground.getPrivateArea(), fixture.area);
    assert.equal(ground.getOwner(), "table-native");
    const timing = ground.getTiming();
    assert.equal(timing.expiresTick - timing.createdTick, 1000, "ten minutes, not the floor timer");
  } finally {
    World.getItems().splice(since);
  }
});

test("a same-id preset swapped into the clicked slot is neither removed nor duplicated", () => {
  const since = World.getItems().length;
  try {
    const fixture = tableFixture();
    const ordinary = new Item(WHIP, 1);
    const preset = presetWhip();
    const { inventory, messages, arrive } = useOnTable({ area: fixture.area, items: [ordinary, preset] });

    // SwitchItemSlotPacketListener runs during the walk: the slot now holds a different whip.
    inventory.swap(0, 1);
    arrive();

    assert.equal(messages.length, 0);
    assert.equal(inventory.getItems()[0], preset, "the preset whip stays in its new slot");
    assert.equal(inventory.getItems()[1], ordinary, "the clicked whip is still carried");
    assert.equal(newGroundItems(since).length, 0, "nothing is placed from a stale callback");
    assert.equal(World.getItems().filter((item) => item.getItem().getId() === WHIP).length, 0);
    assert.equal(inventory.getItems().filter((item) => item?.getId() === WHIP).length, 2,
      "both whips survive: the preset is not deleted in place of the clicked item");
  } finally {
    World.getItems().splice(since);
  }
});

test("an item that becomes untradeable while walking is not placed", () => {
  const since = World.getItems().length;
  try {
    const fixture = tableFixture();
    const whip = new Item(WHIP, 1);
    const { inventory, arrive } = useOnTable({ area: fixture.area, items: [whip] });

    // A preset or another plugin can mark the same object while the player walks.
    whip.setMetaValue(Item.UNTRADEABLE_META, true);
    arrive();

    assert.equal(inventory.getItems()[0], whip, "the item stays carried");
    assert.equal(newGroundItems(since).length, 0);
  } finally {
    World.getItems().splice(since);
  }
});

test("a bond's registered drop policy stops table placement", () => {
  const since = World.getItems().length;
  try {
    const fixture = tableFixture();
    const bond = new Item(TRADEABLE_BOND, 1);
    assert.equal(bond.isTradeable(), true, "the cache bond is tradeable");
    assert.equal(bond.isDropable(), true, "the cache bond passes the plain drop flag");
    const { inventory, messages, arrive } = useOnTable({ area: fixture.area, items: [bond] });

    arrive();

    assert.equal(inventory.getItems()[0], bond, "the bond stays carried");
    assert.equal(newGroundItems(since).length, 0, "no tradeable bond goes on the table");
    assert.deepEqual(messages, ["This object cannot be dropped or destroyed."]);
  } finally {
    World.getItems().splice(since);
  }
});
