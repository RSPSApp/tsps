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
const { TaskManager } = require("../dist/game/task/TaskManager");

let core, api, House, Instance, Storage, yanillePortalId;
const YANILLE_PORTAL_TILE = [2542, 3097, 0];
// Toy box rows 0-4 (enum 3299) are single toys: bunny ears, scythe, toy warship, yo-yo, rubber chicken.
const TOYS = [1037, 1419, 795, 4079, 4566];
// Magic wardrobe row 8 (enum 3289) is the Splitbark set (enum 3086).
const SPLITBARK = [3385, 3387, 3389, 3391, 3393];
const SPLITBARK_ROW = 8;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("CostumeRoomInterfaceTest");
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

function enter(player) {
  const location = new core.Location(...YANILLE_PORTAL_TILE);
  player.moveTo(new core.Location(YANILLE_PORTAL_TILE[0], YANILLE_PORTAL_TILE[1] - 1, 0));
  const definition = ObjectDefinition.forPlayer(yanillePortalId, player) ?? ObjectDefinition.forId(yanillePortalId);
  PluginManager.emitObjectInteraction({ player, object: new GameObject(yanillePortalId, location, 10, 2, null), definition,
    objectId: yanillePortalId, clickType: 1, location: { x: location.getX(), y: location.getY(), z: 0 },
    sourceLocation: { x: location.getX(), y: location.getY() - 1, z: 0 }, handled: false });
}

/** An owned house with one piece of costume-room furniture, the player beside it. */
function fixture(t, name, hotspotKey, buildableKey) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  t.after(() => {
    TaskManager.cancelTasks(player.getIndex());
    try { House.releaseHouse(player, true); } finally { core.World.getPlayers().remove(player); }
  });
  player.setUsername(name);
  player.setAttribute("bot-skip-persistence", true);
  const save = Instance.createDefaultHouseSave();
  save.location = 6;
  save.rooms[1][4][6] = { roomKey: "COSTUME_ROOM", rotation: 0, furniture: { [hotspotKey]: buildableKey } };
  player.setAttribute("construction:house", save);
  assert.equal(core.World.getPlayers().add(player), true);
  enter(player);
  const house = House.houseFor(player);
  assert.equal(house?.owner, player);
  const furniture = Object.values(house.save.rooms[1][4][6].furnitureByLocation).find(entry => entry.hotspotKey === hotspotKey);
  const object = house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === furniture;
  });
  assert.ok(object);
  const at = object.getLocation(), location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  player.moveTo(new core.Location(location.x - 1, location.y, location.z));
  const messages = [], mesboxes = [], sounds = [], animations = [];
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { messages.push(text); return sendMessage(text); };
  const sender = player.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender), sound = sender.sendSoundEffect.bind(sender);
  sender.sendTypedMessage = (type, text) => { if (type === core.ChatType.MESBOX) mesboxes.push(text); return typed(type, text); };
  sender.sendSoundEffect = (id, ...rest) => { sounds.push(id); return sound(id, ...rest); };
  const animate = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { animations.push(animation.getId?.() ?? animation.id); return animate(animation); };
  return { player, house, furniture, object, location, inventory: player.getInventory(), messages, mesboxes, sounds, animations };
}

function open(f) {
  const id = f.object.getId(), definition = ObjectDefinition.forPlayer(id, f.player) ?? ObjectDefinition.forId(id);
  const index = definition.getInteractions().findIndex(action => ["open", "search", "view"].includes(action?.toLowerCase()));
  assert.notEqual(index, -1);
  const at = f.player.getLocation();
  assert.equal(PluginManager.emitObjectInteraction({ player: f.player, object: f.object, objectId: id, definition,
    clickType: index + 1, location: f.location, sourceLocation: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false }), true);
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
}

function button(f, component, op = 1, slot = -1, itemId = -1) {
  PluginManager.emitInterfaceActionClick({ player: f.player, buttonId: core.CacheDefinitions.getComponentId(component),
    action: op, opId: op, slot, itemId, handled: false });
}

const rowSlot = (row) => row * Storage.ROW_COMPONENTS;
const stored = (f, id) => f.furniture.storage?.[id] ?? 0;

test("Open shows the storage interface instead of a chat menu", (t) => {
  const f = fixture(t, "cosopen", "TOY_BOX", "OAK_TOY_BOX");
  open(f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.player), null);
});

test("deposit inventory: Searching..., four rows a tick from the back, then the interface again", (t) => {
  const f = fixture(t, "cosdeposit", "TOY_BOX", "OAK_TOY_BOX");
  f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  for (const id of TOYS) f.inventory.addItem(new Item(id, 1));
  open(f);
  button(f, "poh_costumes:depositall");
  assert.deepEqual(f.mesboxes, ["Searching..."]);
  assert.notEqual(f.player.getInterfaceId(), Storage.MAIN);
  // The last four slots go first; the first toy waits for the next tick.
  assert.deepEqual(TOYS.map(id => stored(f, id)), [0, 1, 1, 1, 1]);
  assert.equal(f.sounds.filter(id => id === 2238).length, 4);
  assert.equal(f.animations.length, 1);
  TaskManager.process();
  assert.deepEqual(TOYS.map(id => stored(f, id)), [1, 1, 1, 1, 1]);
  assert.equal(f.sounds.filter(id => id === 2238).length, 5);
  assert.equal(f.inventory.getAmount(Items.TINDERBOX), 1);
  for (let tick = 0; tick < 2; tick++) TaskManager.process();
  assert.notEqual(f.player.getInterfaceId(), Storage.MAIN);
  TaskManager.process();
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
  assert.deepEqual(f.messages, []);
});

test("deposit inventory with nothing that belongs says so two ticks in", (t) => {
  const f = fixture(t, "cosnothing", "TOY_BOX", "OAK_TOY_BOX");
  f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  open(f);
  button(f, "poh_costumes:depositall");
  TaskManager.process();
  assert.deepEqual(f.mesboxes, ["Searching..."]);
  TaskManager.process();
  assert.deepEqual(f.mesboxes, ["Searching...", "Your items do not belong in here."]);
  assert.equal(f.inventory.getAmount(Items.TINDERBOX), 1);
});

test("Store from the side panel, with its sound; a wrong item does not belong", (t) => {
  const f = fixture(t, "cosstore", "TOY_BOX", "OAK_TOY_BOX");
  f.inventory.addItem(new Item(TOYS[0], 1));
  f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  open(f);
  button(f, "poh_costumes_side:items", 1, 0, TOYS[0]);
  assert.equal(stored(f, TOYS[0]), 1);
  assert.deepEqual(f.sounds, [2238]);
  button(f, "poh_costumes_side:items", 1, 1, Items.TINDERBOX);
  assert.deepEqual(f.messages, ["That item does not belong in here."]);
  assert.equal(f.inventory.getAmount(Items.TINDERBOX), 1);
});

test("a wrong item used on the furniture does not belong either", (t) => {
  const f = fixture(t, "cosuse", "TOY_BOX", "OAK_TOY_BOX");
  f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  const item = f.inventory.getItems()[0];
  assert.equal(PluginManager.emitItemOnObject({ player: f.player, object: f.object, objectId: f.object.getId(),
    location: f.location, item, itemId: Items.TINDERBOX, itemSlot: 0, interfaceType: 149, handled: false }), true);
  assert.deepEqual(f.messages, ["That item does not belong in here."]);
});

test("Withdraw on a set takes every stored piece that fits", (t) => {
  const f = fixture(t, "cosset", "MAGIC_WARDROBE", "OAK_MAGIC_WARDROBE");
  f.furniture.storage = Object.fromEntries(SPLITBARK.map(id => [id, 1]));
  f.inventory.addItem(new Item(Items.COINS, 1));
  while (f.inventory.getFreeSlots() > 0) f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  open(f);
  button(f, "poh_costumes:items", 1, rowSlot(SPLITBARK_ROW));
  assert.deepEqual(f.messages, ["You don't have enough inventory space to take anything."]);
  f.inventory.deleteNumber(Items.TINDERBOX, 2);
  button(f, "poh_costumes:items", 1, rowSlot(SPLITBARK_ROW));
  assert.deepEqual(SPLITBARK.map(id => stored(f, id)), [0, 0, 1, 1, 1]);
  f.inventory.deleteNumber(Items.TINDERBOX, 10);
  button(f, "poh_costumes:items", 1, rowSlot(SPLITBARK_ROW));
  assert.deepEqual(SPLITBARK.map(id => stored(f, id)), [0, 0, 0, 0, 0]);
  for (const id of SPLITBARK) assert.equal(f.inventory.getAmount(id), 1);
  assert.equal(f.messages.length, 1);
});

test("Withdraw on a single item with a full inventory: too full to take it", (t) => {
  const f = fixture(t, "cossingle", "TOY_BOX", "OAK_TOY_BOX");
  f.furniture.storage = { [TOYS[1]]: 1 };
  while (f.inventory.getFreeSlots() > 0) f.inventory.addItem(new Item(Items.TINDERBOX, 1));
  open(f);
  button(f, "poh_costumes:items", 1, rowSlot(1));
  assert.deepEqual(f.messages, ["Your inventory is too full to take it."]);
  f.inventory.deleteNumber(Items.TINDERBOX, 1);
  button(f, "poh_costumes:items", 1, rowSlot(1));
  assert.equal(f.inventory.getAmount(TOYS[1]), 1);
  assert.equal(stored(f, TOYS[1]), 0);
});

test("an oak cape rack refuses a cape of accomplishment", (t) => {
  const f = fixture(t, "coscape", "CAPE_RACK", "OAK_CAPE_RACK");
  const members = core.CacheDefinitions.getEnumValues(3077);
  const cape = [...core.CacheDefinitions.getEnumValues(3292).values()].map(Number).find(id => members.has(id)
    && [...core.CacheDefinitions.getEnumValues(members.get(id)).values()].some(member => core.ItemDefinition.forId(member).getName().toLowerCase().includes("hood")));
  assert.ok(cape);
  f.inventory.addItem(new Item(cape, 1));
  open(f);
  button(f, "poh_costumes_side:items", 1, 0, cape);
  assert.deepEqual(f.messages, ["You'll need a better cape rack to store capes of accomplishment."]);
  assert.equal(f.inventory.getAmount(cape), 1);
});

test("the treasure chest's tier button: a menu of the tiers it holds, or a tier at once", (t) => {
  const f = fixture(t, "costier", "TREASURE_CHEST", "OAK_TREASURE_CHEST");
  const easy = [...core.CacheDefinitions.getEnumValues(3294).values()].map(Number)[0];
  f.furniture.storage = { [easy]: 1 };
  open(f);
  button(f, "poh_costumes:tier");
  const prompt = core.MultiChatboxPrompt.getPending(f.player);
  assert.equal(prompt?.title, "Select an option");
  assert.deepEqual(prompt.options, ["Beginner", "Easy"]);
  assert.equal(core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: 219, slot: 2, action: 2 }), true);
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
  // On the easy tier, row 0 is the easy enum's first entry.
  button(f, "poh_costumes:items", 1, rowSlot(0));
  assert.equal(stored(f, easy), 0);
  assert.equal(f.inventory.getAmount(easy), 1);
  // Op 6 (Hard) is past what an oak chest holds; op 2 (Beginner) shows that tier.
  button(f, "poh_costumes:tier", 6);
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
  button(f, "poh_costumes:tier", 2);
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
});

test("a mahogany chest's six tiers page in the tier menu", (t) => {
  const f = fixture(t, "costier6", "TREASURE_CHEST", "MAHOGANY_TREASURE_CHEST");
  open(f);
  button(f, "poh_costumes:tier");
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.player)?.options, ["Beginner", "Easy", "Medium", "Hard", "More..."]);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 5, action: 5 });
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.player)?.options, ["Elite", "Master"]);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 2, action: 2 });
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
});

test("Deposit mode flips and keeps poh_costumes_mode", (t) => {
  const f = fixture(t, "cosmode", "TOY_BOX", "OAK_TOY_BOX");
  open(f);
  const varbit = core.CacheDefinitions.getVarbitId("poh_costumes_mode");
  button(f, "poh_costumes:mode");
  assert.equal(f.player.getAttribute("construction:costume-storage-mode"), 1);
  assert.equal(f.player.getPacketSender().getVarbit(varbit), 1);
  button(f, "poh_costumes:mode");
  assert.equal(f.player.getAttribute("construction:costume-storage-mode"), 0);
});

test("clicks after the interface closes do nothing", (t) => {
  const f = fixture(t, "cosclosed", "TOY_BOX", "OAK_TOY_BOX");
  f.furniture.storage = { [TOYS[1]]: 1 };
  open(f);
  f.player.getPacketSender().sendInterfaceRemoval();
  button(f, "poh_costumes:items", 1, rowSlot(1));
  assert.equal(stored(f, TOYS[1]), 1);
});
