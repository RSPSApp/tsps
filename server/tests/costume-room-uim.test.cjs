const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");

let core;
let House;
let Instance;
let Storage;
let yanillePortalId;
let api;
const YANILLE_PORTAL_TILE = [2542, 3097, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("CostumeRoomUimTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Storage = require("../plugins/skills/construction/Storage.Construction");
  House.attach(api);
  require("../plugins/modes/ironman/Common.Ironman").init(api);
  require("../plugins/modes/ironman/Setup.Ironman")(api);
  yanillePortalId = require("../plugins/skills/construction/Estate.Construction").HOUSE_LOCATIONS
    .find(({ id }) => id === 6).portal;
});

function playerFixture() {
  const player = new Player(null);
  const saved = Instance.createDefaultHouseSave();
  saved.location = 6;
  player.setAttribute("construction:house", saved);
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : key === "getVarbit" || key === "getVarp" ? () => 0 : () => sender });
  player.getPacketSender = () => sender;
  player.varbits = varbits;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.setEnteredSyntaxAction = (action) => { player.enteredSyntaxAction = action; };
  return player;
}

function click(player, objectId, clickType, coordinates, source = [coordinates[0], coordinates[1] - 1, coordinates[2]]) {
  const location = new core.Location(...coordinates);
  const sourceLocation = new core.Location(...source);
  player.moveTo(sourceLocation);
  const object = new GameObject(objectId, location, 10, 2, null);
  const cached = core.CacheDefinitions.getObject(objectId);
  const definition = ObjectDefinition.forPlayer(objectId, player)
    ?? ObjectDefinition.forId(cached.transforms?.[0] ?? objectId);
  return PluginManager.emitObjectInteraction({
    player,
    object,
    definition,
    objectId,
    clickType,
    location: { x: location.getX(), y: location.getY(), z: location.getZ() },
    sourceLocation: { x: sourceLocation.getX(), y: sourceLocation.getY(), z: sourceLocation.getZ() },
    handled: false,
  });
}

function registeredHousePlayer(t, name, mode = "none") {
  const player = playerFixture();
  player.setUsername(name);
  player.setAttribute("bot-skip-persistence", true);
  player.getSession = () => ({ sendClientPacket: () => true, getChannel: () => null });
  t.after(() => {
    try {
      House.releaseHouse(player, true);
    } finally {
      core.World.getPlayers().remove(player);
    }
  });
  assert.equal(core.World.getPlayers().add(player), true);
  require("../plugins/modes/ironman/Common.Ironman").setMode(player, mode);
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  assert.equal(query.mode, mode);
  return player;
}

// Enum 3289 selects the wardrobe set; 3077 maps its representative to enum 3086.
const SPLITBARK = [3385, 3387, 3389, 3391, 3393];

function costumeFixture(t, name, mode) {
  const player = registeredHousePlayer(t, name, mode);
  const save = player.getAttribute("construction:house");
  save.rooms[1][4][6] = {
    roomKey: "COSTUME_ROOM", rotation: 0, furniture: { MAGIC_WARDROBE: "OAK_MAGIC_WARDROBE" },
  };
  click(player, yanillePortalId, 1, YANILLE_PORTAL_TILE);
  const house = House.houseFor(player);
  assert.equal(house?.owner === player, true);
  assert.equal(player.getPrivateArea() === house, true);
  const room = house.save.rooms[1][4][6];
  const wardrobe = Object.values(room.furnitureByLocation).find(furniture => furniture.hotspotKey === "MAGIC_WARDROBE");
  assert.equal(wardrobe?.buildableKey, "OAK_MAGIC_WARDROBE");
  assert.ok([...core.CacheDefinitions.getEnumValues(3289).values()].includes(SPLITBARK[0]));
  assert.equal(core.CacheDefinitions.getEnumValues(3077).get(SPLITBARK[0]), 3086);
  assert.deepEqual([...core.CacheDefinitions.getEnumValues(3086).values()].sort((a, b) => a - b), SPLITBARK);
  for (const id of SPLITBARK) {
    assert.equal(Storage.storageItems(wardrobe).get(id), SPLITBARK[0]);
    assert.equal(core.CacheDefinitions.getEnumValues(3303).has(id), false);
    assert.equal(core.CacheDefinitions.getEnumValues(3304).has(id), false);
    assert.equal(core.ItemDefinition.forId(id).isStackable(), false);
  }
  return { player, house, wardrobe, inventory: player.getInventory() };
}

function storeSplitbark(fixture, members) {
  for (const id of members) {
    fixture.inventory.addItem(new Item(id, 1));
    const slot = fixture.inventory.getItems().findIndex(item => item.getId() === id);
    assert.notEqual(slot, -1);
    assert.equal(Storage.depositHouseItem(fixture.player, fixture.house, fixture.wardrobe, slot), true);
    assert.equal(fixture.inventory.getAmount(id), 0);
  }
}

function inventorySnapshot(inventory) {
  return inventory.getItems().map(item => [item.getId(), item.getAmount()]);
}

test("Ultimate players can deposit a partial Splitbark set", (t) => {
  const f = costumeFixture(t, "uimdeposit", "ultimate");
  storeSplitbark(f, SPLITBARK.slice(0, 4));
  assert.deepEqual(f.wardrobe.storage, Object.fromEntries(SPLITBARK.slice(0, 4).map(id => [id, 1])));
});

test("Ultimate players cannot withdraw a partial Splitbark set", (t) => {
  const f = costumeFixture(t, "uimpartial", "ultimate");
  storeSplitbark(f, SPLITBARK.slice(0, 4));
  const beforeStorage = { ...f.wardrobe.storage }, beforeInventory = inventorySnapshot(f.inventory);
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, SPLITBARK[0]), false);
  assert.deepEqual(f.wardrobe.storage, beforeStorage);
  assert.deepEqual(inventorySnapshot(f.inventory), beforeInventory);
});

test("Ultimate players withdraw a complete Splitbark set together", (t) => {
  const f = costumeFixture(t, "uimcomplete", "ultimate");
  storeSplitbark(f, SPLITBARK);
  f.inventory.addItem(new Item(Items.TINDERBOX, 23));
  assert.equal(f.inventory.getFreeSlots(), 5);
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, SPLITBARK[0]), true);
  assert.deepEqual(f.wardrobe.storage, {});
  for (const id of SPLITBARK) assert.equal(f.inventory.getAmount(id), 1);
  assert.equal(f.inventory.getAmount(Items.TINDERBOX), 23);
});

test("Ultimate complete set withdrawal requires room for every piece", (t) => {
  const f = costumeFixture(t, "uimnoroom", "ultimate");
  storeSplitbark(f, SPLITBARK);
  f.inventory.addItem(new Item(Items.TINDERBOX, 24));
  assert.equal(f.inventory.getFreeSlots(), 4);
  const beforeStorage = { ...f.wardrobe.storage }, beforeInventory = inventorySnapshot(f.inventory);
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, SPLITBARK[0]), false);
  assert.deepEqual(f.wardrobe.storage, beforeStorage);
  assert.deepEqual(inventorySnapshot(f.inventory), beforeInventory);
});

test("Ultimate set withdrawal restores inventory if a later add fails", (t) => {
  const f = costumeFixture(t, "uimrollback", "ultimate");
  storeSplitbark(f, SPLITBARK);
  f.inventory.addItem(new Item(Items.TINDERBOX, 1).setMeta({ fixture: "preserve" }));
  const beforeItems = f.inventory.getItems().slice();
  const beforeInventory = inventorySnapshot(f.inventory), beforeStorage = { ...f.wardrobe.storage };
  const held = beforeItems.find(item => item.getId() === Items.TINDERBOX);
  assert.deepEqual(held.getMeta(), { fixture: "preserve" });
  const originalAdd = f.inventory.add;
  let calls = 0;
  f.inventory.add = function (item, refresh) {
    if (++calls === 2) return this;
    return originalAdd.call(this, item, refresh);
  };
  t.after(() => { f.inventory.add = originalAdd; });
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, SPLITBARK[0]), false);
  assert.equal(calls, 2);
  assert.deepEqual(f.wardrobe.storage, beforeStorage);
  assert.deepEqual(inventorySnapshot(f.inventory), beforeInventory);
  for (let i = 0; i < beforeItems.length; i++) assert.equal(f.inventory.getItems()[i] === beforeItems[i], true);
  assert.deepEqual(held.getMeta(), { fixture: "preserve" });
});

test("normal players may withdraw a piece of a partial Splitbark set", (t) => {
  const f = costumeFixture(t, "normalpoh", "none");
  storeSplitbark(f, SPLITBARK.slice(0, 4));
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, SPLITBARK[0]), true);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.deepEqual(f.wardrobe.storage, Object.fromEntries(SPLITBARK.slice(1, 4).map(id => [id, 1])));
});
