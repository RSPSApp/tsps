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
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let House;
let Instance;
let Storage;
let yanillePortalId;
let api;
const pinBlocked = new WeakSet();
let pinResume;
const YANILLE_PORTAL_TILE = [2542, 3097, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("CostumeRoomUimTest");
  api.onCustomEvent("bank-pin:guard", (request) => {
    if (pinBlocked.has(request.player)) { request.locked = true; pinResume = request.resume; }
  });
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

test("Ultimate duplicate deposit keeps the second piece in inventory", (t) => {
  const f = costumeFixture(t, "uimdupe", "ultimate");
  storeSplitbark(f, [SPLITBARK[0]]);
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  const slot = f.inventory.getItems().findIndex(item => item.getId() === SPLITBARK[0]);
  const before = inventorySnapshot(f.inventory), stored = { ...f.wardrobe.storage };
  assert.equal(Storage.depositHouseItem(f.player, f.house, f.wardrobe, slot), false);
  assert.deepEqual(inventorySnapshot(f.inventory), before);
  assert.deepEqual(f.wardrobe.storage, stored);
});

test("Ultimate deposit does not copy an item if slot deletion does not occur", (t) => {
  const f = costumeFixture(t, "uimnodelete", "ultimate");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  const slot = f.inventory.getItems().findIndex(item => item.getId() === SPLITBARK[0]);
  const held = f.inventory.getItems()[slot], before = inventorySnapshot(f.inventory), storage = f.wardrobe.storage;
  const original = f.inventory.deleteAtSlot;
  f.inventory.deleteAtSlot = function () { return this; };
  t.after(() => { f.inventory.deleteAtSlot = original; });
  assert.equal(Storage.depositHouseItem(f.player, f.house, f.wardrobe, slot), false);
  assert.equal(f.inventory.getItems()[slot] === held, true);
  assert.deepEqual(inventorySnapshot(f.inventory), before);
  assert.equal(f.wardrobe.storage === storage, true);
});

test("Ultimate deposit restores mutated slots when deletion removes too much", (t) => {
  const f = costumeFixture(t, "uimbaddelete", "ultimate");
  f.inventory.addItem(new Item(SPLITBARK[0], 2));
  f.inventory.addItem(new Item(Items.TINDERBOX, 1).setMeta({ fixture: "keep" }));
  const slot = f.inventory.getItems().findIndex(item => item.getId() === SPLITBARK[0]);
  const beforeItems = f.inventory.getItems().slice(), before = inventorySnapshot(f.inventory), storage = f.wardrobe.storage;
  const held = beforeItems.find(item => item.getId() === Items.TINDERBOX);
  const original = f.inventory.deleteAtSlot;
  f.inventory.deleteAtSlot = function (index) {
    original.call(this, index, 1, false);
    const second = this.getItems().findIndex(item => item.getId() === SPLITBARK[0]);
    original.call(this, second, 1, false);
    return this;
  };
  t.after(() => { f.inventory.deleteAtSlot = original; });
  assert.equal(Storage.depositHouseItem(f.player, f.house, f.wardrobe, slot), false);
  assert.deepEqual(inventorySnapshot(f.inventory), before);
  for (let i = 0; i < beforeItems.length; i++) assert.equal(f.inventory.getItems()[i] === beforeItems[i], true);
  assert.deepEqual(held.getMeta(), { fixture: "keep" });
  assert.equal(f.wardrobe.storage === storage, true);
});

for (const mode of ["none", "ironman"]) {
  test(`${mode} accounts may store duplicate pieces`, (t) => {
    const f = costumeFixture(t, "dupe" + mode, mode);
    storeSplitbark(f, [SPLITBARK[0], SPLITBARK[0]]);
    assert.equal(f.wardrobe.storage[SPLITBARK[0]], 2);
  });
}

for (const mode of ["none", "ironman"]) {
  test(`${mode} players bulk deposit without a new warning`, (t) => {
    const f = promptFixture(t, "bulk" + mode, mode);
    f.inventory.addItem(new Item(SPLITBARK[0], 1));
    openWardrobe(f);
    choosePrompt(f.player, 1);
    assert.equal(core.MultiChatboxPrompt.getPending(f.player), null);
    assert.equal(f.inventory.getAmount(SPLITBARK[0]), 0);
    assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
  });
}

function promptFixture(t, name, mode = "ultimate", hotspotKey = "MAGIC_WARDROBE", buildableKey = "OAK_MAGIC_WARDROBE") {
  const errors = [];
  t.mock.method(console, "error", (...args) => { errors.push(args); });
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  t.after(() => {
    pinBlocked.delete(player);
    try {
      try { House.releaseHouse(player, true); } finally { core.World.getPlayers().remove(player); }
    } finally {
      assert.deepEqual(errors, [], "no native prompt, callback or cleanup errors");
    }
  });
  player.setUsername(name);
  player.setAttribute("bot-skip-persistence", true);
  const save = Instance.createDefaultHouseSave();
  save.location = 6;
  save.rooms[1][4][6] = {
    roomKey: "COSTUME_ROOM", rotation: 0, furniture: { [hotspotKey]: buildableKey },
  };
  player.setAttribute("construction:house", save);
  assert.equal(core.World.getPlayers().add(player), true);
  require("../plugins/modes/ironman/Common.Ironman").setMode(player, mode);
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  assert.equal(query.mode, mode);
  click(player, yanillePortalId, 1, YANILLE_PORTAL_TILE);
  const house = House.houseFor(player);
  assert.equal(house?.owner === player, true);
  assert.equal(player.getPrivateArea() === house, true);
  const room = house.save.rooms[1][4][6];
  const wardrobe = Object.values(room.furnitureByLocation).find(furniture => furniture.hotspotKey === hotspotKey);
  assert.equal(wardrobe?.buildableKey, buildableKey);
  const object = house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === wardrobe;
  });
  assert.ok(object, "real wardrobe object was drawn in the owned house");
  const at = object.getLocation(), location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  player.moveTo(new core.Location(location.x - 1, location.y, location.z));
  return { player, house, room, wardrobe, object, location, inventory: player.getInventory() };
}

function promptItemOnWardrobe(f, id) {
  const itemSlot = f.inventory.getItems().findIndex(item => item.getId() === id);
  assert.notEqual(itemSlot, -1);
  const item = f.inventory.getItems()[itemSlot];
  assert.equal(PluginManager.emitItemOnObject({ player: f.player, object: f.object, objectId: f.object.getId(),
    location: f.location, item, itemId: id, itemSlot, interfaceType: 149, handled: false }), true);
  return itemSlot;
}

function openWardrobe(f) {
  const id = f.object.getId(), definition = ObjectDefinition.forPlayer(id, f.player) ?? ObjectDefinition.forId(id);
  const index = definition.getInteractions().findIndex(action => ["open", "search", "view"].includes(action?.toLowerCase()));
  assert.notEqual(index, -1);
  const at = f.player.getLocation();
  assert.equal(PluginManager.emitObjectInteraction({ player: f.player, object: f.object, objectId: id, definition,
    clickType: index + 1, location: f.location, sourceLocation: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false }), true);
}

function choosePrompt(player, option) {
  assert.ok(core.MultiChatboxPrompt.getPending(player));
  assert.equal(player.getPacketSender().isChatboxInterface(219), true);
  assert.equal(core.MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: 219, slot: option, action: option }), true);
}

const BRONZE_TRIM = { representative: 12215, legs: 12217, skirt: 12219, members: 3206 };
const DEPOSIT_WARNING = "Some sets must be complete to withdraw. Continue?";

function assertBronzeTrimMapping(f) {
  assert.ok([...core.CacheDefinitions.getEnumValues(3294).values()].includes(BRONZE_TRIM.representative));
  assert.equal(core.CacheDefinitions.getEnumValues(3077).get(BRONZE_TRIM.representative), BRONZE_TRIM.members);
  assert.ok([...core.CacheDefinitions.getEnumValues(BRONZE_TRIM.members).values()].includes(BRONZE_TRIM.legs));
  assert.equal(core.CacheDefinitions.getEnumValues(3303).get(BRONZE_TRIM.legs), BRONZE_TRIM.skirt);
  assert.equal(Storage.storageItems(f.wardrobe).get(BRONZE_TRIM.legs), BRONZE_TRIM.representative);
}

test("warning describes supported partial-set withdrawal restriction", (t) => {
  const f = promptFixture(t, "uimwarnplain");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  const title = core.MultiChatboxPrompt.getPending(f.player)?.title;
  choosePrompt(f.player, 1);
  assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, SPLITBARK[0]), false);
  assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 0);
  assert.equal(title, DEPOSIT_WARNING);
});

for (const route of ["individual", "bulk"]) {
  test(`warning does not claim alternate-set pieces are locked on ${route} deposit`, (t) => {
    const f = promptFixture(t, route === "individual" ? "uimbrsingle" : "uimbrbulk", "ultimate", "TREASURE_CHEST", "OAK_TREASURE_CHEST");
    assertBronzeTrimMapping(f);
    f.inventory.addItem(new Item(BRONZE_TRIM.legs, 1));
    if (route === "individual") promptItemOnWardrobe(f, BRONZE_TRIM.legs);
    else { openWardrobe(f); choosePrompt(f.player, 1); }
    const title = core.MultiChatboxPrompt.getPending(f.player)?.title;
    choosePrompt(f.player, 1);
    assert.equal(f.wardrobe.storage[BRONZE_TRIM.legs], 1);
    assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, BRONZE_TRIM.legs), true);
    assert.equal(f.wardrobe.storage[BRONZE_TRIM.legs] ?? 0, 0);
    assert.equal(f.inventory.getAmount(BRONZE_TRIM.legs), 1);
    assert.equal(title, DEPOSIT_WARNING);
  });
}

test("bulk warning stays accurate for mixed supported and alternate sets", (t) => {
  const f = promptFixture(t, "uimmixed", "ultimate", "TREASURE_CHEST", "OAK_TREASURE_CHEST");
  assertBronzeTrimMapping(f);
  const studdedBody = 7362, studdedChaps = 7366;
  assert.equal(core.CacheDefinitions.getEnumValues(3077).get(studdedBody), 3197);
  assert.deepEqual([...core.CacheDefinitions.getEnumValues(3197).values()].sort((a, b) => a - b), [studdedBody, studdedChaps]);
  for (const id of [studdedBody, studdedChaps]) {
    assert.equal(Storage.storageItems(f.wardrobe).get(id), studdedBody);
    assert.equal(core.CacheDefinitions.getEnumValues(3303).has(id), false);
    assert.equal(core.CacheDefinitions.getEnumValues(3304).has(id), false);
    assert.equal(core.ItemDefinition.forId(id).isStackable(), false);
  }
  f.inventory.addItem(new Item(BRONZE_TRIM.legs, 1));
  f.inventory.addItem(new Item(studdedBody, 1));
  openWardrobe(f);
  choosePrompt(f.player, 1);
  const title = core.MultiChatboxPrompt.getPending(f.player)?.title;
  choosePrompt(f.player, 1);
  assert.equal(f.wardrobe.storage[BRONZE_TRIM.legs], 1);
  assert.equal(f.wardrobe.storage[studdedBody], 1);
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, BRONZE_TRIM.legs), true);
  assert.equal(Storage.withdrawHouseItem(f.player, f.house, f.wardrobe, studdedBody), false);
  assert.equal(f.inventory.getAmount(BRONZE_TRIM.legs), 1);
  assert.equal(f.inventory.getAmount(studdedBody), 0);
  assert.equal(f.wardrobe.storage[studdedBody], 1);
  assert.equal(title, DEPOSIT_WARNING);
});

test("Ultimate single-piece confirmation can cancel or deposit", (t) => {
  const f = promptFixture(t, "uimwarn");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.player)?.options, ["Deposit", "Cancel"]);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  choosePrompt(f.player, 2);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
  promptItemOnWardrobe(f, SPLITBARK[0]);
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 0);
  assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
});

test("an already-stored Ultimate piece is refused through item-on-furniture", (t) => {
  const f = promptFixture(t, "uimrepeat");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  choosePrompt(f.player, 1);
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  assert.equal(core.MultiChatboxPrompt.getPending(f.player), null);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
});

test("Ultimate bulk confirmation stores one of two identical pieces", (t) => {
  const f = promptFixture(t, "uimbulk");
  f.inventory.addItem(new Item(SPLITBARK[0], 2));
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 2);
  openWardrobe(f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.player)?.title, "Costume storage");
  choosePrompt(f.player, 1);
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.player)?.options, ["Deposit", "Cancel"]);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 2);
  choosePrompt(f.player, 1);
  assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
});

test("bulk cancel and changed inventory leave all pieces untouched", (t) => {
  const f = promptFixture(t, "uimbcancel");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  openWardrobe(f);
  choosePrompt(f.player, 1);
  choosePrompt(f.player, 2);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
  openWardrobe(f);
  choosePrompt(f.player, 1);
  f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.inventory.getAmount(Items.TINDERBOX), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("changing mode while the storage menu is open prevents bulk deposit", (t) => {
  const f = promptFixture(t, "uimbmode");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  openWardrobe(f);
  require("../plugins/modes/ironman/Common.Ironman").setMode(f.player, "none");
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("replacing the clicked item invalidates a pending confirmation", (t) => {
  const f = promptFixture(t, "uimslot");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  const slot = promptItemOnWardrobe(f, SPLITBARK[0]);
  f.inventory.setItem(slot, new Item(SPLITBARK[0], 1));
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("moving after a warning invalidates confirmation", (t) => {
  const f = promptFixture(t, "uimmoved");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  const at = f.player.getLocation();
  f.player.setLocation(new core.Location(at.getX() + 1, at.getY(), at.getZ()));
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("leaving the private house invalidates confirmation", (t) => {
  const f = promptFixture(t, "uimleave");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  f.house.remove(f.player);
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("replacing the furniture invalidates confirmation", (t) => {
  const f = promptFixture(t, "uimreplace");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  const key = Object.keys(f.room.furnitureByLocation).find(key => f.room.furnitureByLocation[key] === f.wardrobe);
  assert.ok(key);
  f.room.furnitureByLocation[key] = { ...f.wardrobe };
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
  assert.equal(f.room.furnitureByLocation[key].storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("changing mode after the warning invalidates confirmation", (t) => {
  const f = promptFixture(t, "uimmode");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  require("../plugins/modes/ironman/Common.Ironman").setMode(f.player, "none");
  choosePrompt(f.player, 1);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("a newly locked PIN prevents confirmation and a later resume consumes nothing", (t) => {
  const f = promptFixture(t, "uimpin");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  pinResume = null;
  pinBlocked.add(f.player);
  choosePrompt(f.player, 1);
  assert.equal(typeof pinResume, "function");
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
  pinBlocked.delete(f.player);
  pinResume();
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("changing the item during the initial PIN guard prevents a stale resume", (t) => {
  const f = promptFixture(t, "uimpinstale");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  pinResume = null;
  pinBlocked.add(f.player);
  const slot = promptItemOnWardrobe(f, SPLITBARK[0]);
  assert.equal(typeof pinResume, "function");
  f.inventory.setItem(slot, new Item(SPLITBARK[0], 1));
  pinBlocked.delete(f.player);
  pinResume();
  assert.equal(core.MultiChatboxPrompt.getPending(f.player), null);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("changing mode during the initial PIN guard prevents a stale resume", (t) => {
  const f = promptFixture(t, "uimpincode");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  pinResume = null;
  pinBlocked.add(f.player);
  promptItemOnWardrobe(f, SPLITBARK[0]);
  assert.equal(typeof pinResume, "function");
  require("../plugins/modes/ironman/Common.Ironman").setMode(f.player, "none");
  pinBlocked.delete(f.player);
  pinResume();
  assert.equal(core.MultiChatboxPrompt.getPending(f.player), null);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

test("a replacement prompt cannot confirm the earlier deposit", (t) => {
  const f = promptFixture(t, "uimother");
  f.inventory.addItem(new Item(SPLITBARK[0], 1));
  promptItemOnWardrobe(f, SPLITBARK[0]);
  let selected = false;
  api.sendMultiChatboxPrompt(f.player, "Other prompt", "Close", () => { selected = true; });
  assert.equal(core.MultiChatboxPrompt.getPending(f.player)?.title, "Other prompt");
  choosePrompt(f.player, 1);
  assert.equal(selected, true);
  assert.equal(f.inventory.getAmount(SPLITBARK[0]), 1);
  assert.equal(f.wardrobe.storage?.[SPLITBARK[0]] ?? 0, 0);
});

for (const mode of ["none", "ironman"]) {
  test(`${mode} players deposit an individual set piece without a new warning`, (t) => {
    const f = promptFixture(t, "use" + mode, mode);
    f.inventory.addItem(new Item(SPLITBARK[0], 1));
    promptItemOnWardrobe(f, SPLITBARK[0]);
    assert.equal(core.MultiChatboxPrompt.getPending(f.player), null);
    assert.equal(f.inventory.getAmount(SPLITBARK[0]), 0);
    assert.equal(f.wardrobe.storage[SPLITBARK[0]], 1);
  });
}
