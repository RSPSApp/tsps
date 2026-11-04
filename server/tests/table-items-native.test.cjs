// Run after `yarn build`: node --test tests/table-items-native.test.cjs
//
// Native item-on-object dispatch for tables. The native producer captures the clicked Item before
// walking to the table, and the inventory can be rearranged during the walk: a slot switch puts a
// different item (same id, different metadata) in the clicked slot. Only the exact clicked item
// may be removed and placed, or the swap duplicates the item.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { State } = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
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
// Tradeable, droppable, and 36m by the quoted guide price in item-prices.json.
const RANGER_BOOTS = 2577;

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

/** A real player, so the account save serializes its inventory the way a logout does. */
function realPlayer(name, area, location) {
  const player = new Player({ sendClientPacket: () => true, write() {} });
  player.setUsername(name);
  player.setArea(area);
  player.setLocation(location.clone());
  return player;
}

/** Native Use from a real player, with the walk callback held until the test calls it. */
function useOnTableAs(player, item) {
  player.getInventory().setItem(0, item);
  let arrive = null;
  const queue = {
    walkToObject: (_object, callback) => { arrive = callback.execute; },
    reset: () => {},
    walkToReset: () => {},
  };
  player.getMovementQueue = () => queue;
  UseItemPacketListener.itemOnObject(
    player, 149, TABLE_ID, item.getId(), 0, TABLE_LOCATION.getX(), TABLE_LOCATION.getY(),
  );
  assert.equal(typeof arrive, "function", "the item use is queued behind the walk");
  return () => arrive();
}

function savedAmount(persistence, name, itemId) {
  const save = persistence.load(name);
  return (save?.getInventory() ?? [])
    .filter((item) => item.getId() === itemId)
    .reduce((total, item) => total + item.getAmount(), 0);
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

test("a valuable item's removal is saved before the table copy can be taken", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsps-table-save-"));
  const Json = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  const SaveEvents = require("../plugins/persistence/SaveEvents.plugin");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const { loadItemPrices } = require("../plugins/items/ItemDefinitionLoader.plugin")._test;
  const previousDirectory = Json.JsonPlayerPersistence.SAVE_DIRECTORY;
  const previousBackend = GameConstants.PLAYER_PERSISTENCE;
  const items = World.getItems();
  const previousItems = items.splice(0);
  Json.JsonPlayerPersistence.SAVE_DIRECTORY = path.join(directory, "characters");
  let persistence = null;
  Json.register({
    getSkillManager: () => SkillManager,
    setPlayerPersistence: (backend) => { persistence = backend; },
    log() {},
  });
  // SaveEvents reaches the backend through GameConstants, as it does in the running server.
  GameConstants.setPlayerPersistence(persistence);
  // SaveEvents saves a discard when the quoted guide price is at least 10m.
  loadItemPrices();
  SaveEvents.register(PluginManager.createApi("SaveEvents"));
  try {
    const fixture = tableFixture();
    const seller = realPlayer("Table Seller", fixture.area, new Location(3222, 3219, 0));
    const boots = new Item(RANGER_BOOTS, 1);
    assert.ok(boots.getDefinition().getGrandExchangeValue() >= 10_000_000,
      "ranger boots are above the save threshold");
    seller.getInventory().setItem(0, boots);
    persistence.save(seller, "logout");
    await persistence.flush();
    assert.equal(savedAmount(persistence, "Table Seller", RANGER_BOOTS), 1,
      "the saved account starts with the boots");

    // Native use: the click is queued behind the walk, and the arrival moves the boots to the table.
    const arrive = useOnTableAs(seller, boots);
    arrive();
    await persistence.flush();

    assert.equal(savedAmount(persistence, "Table Seller", RANGER_BOOTS), 0,
      "the saved account no longer owns the boots the table holds");
    const [ground] = World.getItems();
    assert.equal(ground.getItem().getId(), RANGER_BOOTS, "the boots are on the table");
    for (let tick = 0; tick < ItemOnGroundManager.PUBLIC_REVEAL_DELAY; tick++) ground.process();
    assert.equal(ground.getState(), State.SEEN_BY_EVERYONE, "the table copy is public after 100 ticks");

    // The stack is now takeable, as it is for another player in the same area.
    const taker = realPlayer("Table Taker", fixture.area, TABLE_LOCATION.clone());
    ItemOnGroundManager.pickup(taker, ground);
    assert.equal(taker.getInventory().getAmount(RANGER_BOOTS), 1, "the taker picks the boots up");
    persistence.save(taker, "logout");
    await persistence.flush();

    assert.equal(savedAmount(persistence, "Table Taker", RANGER_BOOTS), 1,
      "the taker's saved account owns the boots");
    assert.equal(savedAmount(persistence, "Table Seller", RANGER_BOOTS), 0,
      "and the seller's does not: the two files hold one pair between them");
  } finally {
    items.splice(0, items.length, ...previousItems);
    Json.JsonPlayerPersistence.SAVE_DIRECTORY = previousDirectory;
    GameConstants.setPlayerPersistence(previousBackend);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
