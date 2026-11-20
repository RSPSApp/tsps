// The achievement gallery's boss lair display: Jars (costume-room storage on enum 3300) and
// Configure ("Choose a lair"). rsprox 2909 (rev 230) ticks 2171-2180, 2459-2464, 5214-5217;
// 3897 (rev 235) tick 1092; local 1001171 tick 38 (a guest).
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
const { PlayerSession } = require("../dist/net/PlayerSession");
const { TaskManager } = require("../dist/game/task/TaskManager");

let core, api, House, Instance, Storage, BossLair, yanillePortalId, MENU;
const YANILLE_PORTAL_TILE = [2542, 3097, 0];
const JAR_OF_DIRT = 12007, JAR_OF_SAND = 12885, JAR_OF_CHEMICALS = 23064;
const HYDRA_ROW = 8, KRAKEN_ROW = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("BossLairDisplayTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Storage = require("../plugins/skills/construction/Storage.Construction");
  BossLair = require("../plugins/skills/construction/BossLair.Construction");
  House.attach(api);
  require("../plugins/modes/ironman/Common.Ironman").init(api);
  require("../plugins/modes/ironman/Setup.Ironman")(api);
  yanillePortalId = require("../plugins/skills/construction/Estate.Construction").HOUSE_LOCATIONS
    .find(({ id }) => id === 6).portal;
  MENU = core.CacheDefinitions.getInterfaceId("menu");
});

function enter(player) {
  const location = new core.Location(...YANILLE_PORTAL_TILE);
  player.moveTo(new core.Location(YANILLE_PORTAL_TILE[0], YANILLE_PORTAL_TILE[1] - 1, 0));
  const definition = ObjectDefinition.forPlayer(yanillePortalId, player) ?? ObjectDefinition.forId(yanillePortalId);
  PluginManager.emitObjectInteraction({ player, object: new GameObject(yanillePortalId, location, 10, 2, null), definition,
    objectId: yanillePortalId, clickType: 2, location: { x: location.getX(), y: location.getY(), z: 0 },
    sourceLocation: { x: location.getX(), y: location.getY() - 1, z: 0 }, handled: false });
  for (let tick = 0; tick < 3; tick++) TaskManager.process(); // the house loads two ticks later
}

function newPlayer(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  t.after(() => {
    TaskManager.cancelTasks(player.getIndex());
    try { House.releaseHouse(player, true); } finally { core.World.getPlayers().remove(player); }
  });
  player.setUsername(name);
  player.setAttribute("bot-skip-persistence", true);
  return player;
}

function watch(player) {
  const seen = { messages: [], mesboxes: [], scripts: [], animations: [], removals: 0 };
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { seen.messages.push(text); return sendMessage(text); };
  const sender = player.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, text) => { if (type === core.ChatType.MESBOX) seen.mesboxes.push(text); return typed(type, text); };
  const script = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => (seen.scripts.push([id, ...args]), script(id, ...args));
  const iscript = sender.sendInterfaceScript.bind(sender);
  sender.sendInterfaceScript = (id, args, ...rest) => (seen.scripts.push([id, ...args]), iscript(id, args, ...rest));
  const removal = sender.sendInterfaceRemoval.bind(sender);
  sender.sendInterfaceRemoval = (...args) => (seen.removals++, removal(...args));
  const animate = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { seen.animations.push(animation.getId?.() ?? animation.id); return animate(animation); };
  return seen;
}

/** An owned house with a boss lair display in the achievement gallery, the owner beside it. */
function fixture(t, name) {
  const player = newPlayer(t, name);
  const save = Instance.createDefaultHouseSave();
  save.location = 6;
  save.rooms[1][4][6] = { roomKey: "ACHIEVEMENT_GALLERY", rotation: 0, furniture: { BOSS_LAIR_DISPLAY: "BOSS_DISPLAY" } };
  player.setAttribute("construction:house", save);
  assert.equal(core.World.getPlayers().add(player), true);
  enter(player);
  const house = House.houseFor(player);
  assert.equal(house?.owner, player);
  const furniture = Object.values(house.save.rooms[1][4][6].furnitureByLocation).find(entry => entry.hotspotKey === "BOSS_LAIR_DISPLAY");
  const object = house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === furniture;
  });
  assert.ok(object);
  const at = object.getLocation(), location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  player.moveTo(new core.Location(location.x - 1, location.y, location.z));
  return { player, house, furniture, object, location, inventory: player.getInventory(), seen: watch(player) };
}

/** The loc drawn on the display's tile now. */
function drawn(f) {
  return f.house.furnitureObjects.find(object => {
    const at = object.getLocation();
    return at.getX() === f.location.x && at.getY() === f.location.y && at.getZ() === f.location.z;
  })?.getId();
}

/** The display as saved on the owner, as a logout would write it. */
function savedDisplay(f) {
  const saved = JSON.parse(JSON.stringify(f.player.getAttribute("construction:house")));
  return Object.values(saved.rooms[1][4][6].furnitureByLocation).find(entry => entry.hotspotKey === "BOSS_LAIR_DISPLAY");
}

/** The loc the display shows now. */
const shown = (f) => f.furniture.displayObjectId ?? f.object.getId();

function click(f, option, player = f.player) {
  const id = shown(f);
  const definition = ObjectDefinition.forId(id);
  const index = definition.getInteractions().findIndex(action => action === option);
  assert.notEqual(index, -1, `${option} on loc ${id}`);
  const at = player.getLocation();
  const object = new GameObject(id, f.object.getLocation(), f.object.getType(), f.object.getFace(), null);
  assert.equal(PluginManager.emitObjectInteraction({ player, object, objectId: id, definition,
    clickType: index + 1, location: f.location, sourceLocation: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false }), true);
}

function lastMenu(seen) {
  const menu = seen.scripts.findLast(([id]) => id === 217);
  assert.ok(menu, "the lair menu opened");
  return menu;
}

function pick(player, index) {
  const event = { player, groupId: MENU, childId: 3, slot: index, action: index, buttonId: (MENU << 16) | 3, handled: false };
  PluginManager.emitInterfaceActionClick(event);
  assert.equal(event.handled, true);
}

const rowSlot = (row) => row * Storage.ROW_COMPONENTS;
const loc = (name) => core.CacheDefinitions.getLocId(name);

test("Configure lists every lair, struck through until its jar is stored", (t) => {
  const f = fixture(t, "lairmenu");
  f.furniture.storage = { [JAR_OF_CHEMICALS]: 1 };
  click(f, "Configure");
  assert.equal(f.player.getInterfaceId(), MENU);
  const [, , title, labels] = lastMenu(f.seen);
  assert.equal(title, "Choose a lair");
  const options = labels.split("|");
  assert.equal(options.length, 17);
  // rsprox 2909 tick 2172: the first fifteen options as live listed them, Alchemical Hydra's jar stored.
  assert.deepEqual(options.slice(0, 15), ["Empty", "<str>Kraken</str>", "<str>Zulrah</str>", "<str>Kalphite Queen</str>",
    "<str>Cerberus</str>", "<str>Abyssal Sire</str>", "<str>Skotizo</str>", "<str>Grotesque Guardians</str>", "<str>Vorkath</str>",
    "Alchemical Hydra", "<str>Sarachnis</str>", "<str>The Nightmare</str>", "<str>Corporeal Beast</str>",
    "<str>Thermonuclear Smoke Devil</str>", "<str>Araxxor</str>"]);
});

test("picking a stored lair reaches into the display, and the lair shows a tick later", (t) => {
  const f = fixture(t, "lairpick");
  f.furniture.storage = { [JAR_OF_CHEMICALS]: 1 };
  click(f, "Configure");
  pick(f.player, HYDRA_ROW + 1);
  assert.deepEqual(f.seen.animations, [832]); // human_pickuptable
  // The choice is saved with the house at once; the display is redrawn with it a tick later.
  assert.equal(savedDisplay(f).displayObjectId, loc("poh_display_hydra"));
  assert.equal(drawn(f), f.object.getId());
  TaskManager.process();
  assert.equal(drawn(f), loc("poh_display_hydra"));
  assert.equal(f.house.getFurnitureAt(f.location, loc("poh_display_hydra"), f.object.getType()), f.furniture);
  // Empty takes it back to the blank display.
  click(f, "Configure");
  pick(f.player, 0);
  assert.equal(savedDisplay(f).displayObjectId, undefined);
  TaskManager.process();
  assert.equal(drawn(f), f.object.getId());
});

test("a lair without its jar is refused in a message box, then the menu comes back", (t) => {
  const f = fixture(t, "lairnojar");
  click(f, "Configure");
  pick(f.player, 3); // Kalphite Queen (rsprox 2909 tick 5214)
  assert.deepEqual(f.seen.mesboxes, [BossLair.NO_JAR]);
  assert.deepEqual(f.seen.animations, []);
  const menus = f.seen.scripts.filter(([id]) => id === 217).length;
  f.player.getDialogueManager().advance();
  assert.equal(f.seen.scripts.filter(([id]) => id === 217).length, menus + 1);
  assert.equal(f.player.getInterfaceId(), MENU);
  TaskManager.process();
  assert.equal(f.furniture.displayObjectId, undefined);
});

test("picking the lair already shown, or Empty on a blank display, says it's already in that state", (t) => {
  const f = fixture(t, "lairalready");
  f.furniture.storage = { [JAR_OF_CHEMICALS]: 1 };
  f.furniture.displayObjectId = loc("poh_display_hydra");
  f.house.redrawFurniture();
  click(f, "Configure");
  pick(f.player, HYDRA_ROW + 1); // rsprox 2909 tick 4739
  assert.deepEqual(f.seen.mesboxes, [BossLair.ALREADY]);
  assert.deepEqual(f.seen.animations, []);
  TaskManager.process();
  assert.equal(drawn(f), loc("poh_display_hydra"));
  // Empty on the blank display gets the same box.
  f.player.getDialogueManager().advance();
  f.seen.mesboxes.length = 0;
  click(f, "Configure");
  pick(f.player, 0);
  TaskManager.process();
  assert.equal(drawn(f), f.object.getId());
  click(f, "Configure");
  pick(f.player, 0);
  assert.deepEqual(f.seen.mesboxes, [BossLair.ALREADY]);
  assert.deepEqual(f.seen.animations, [832]);
});

test("a guest can't configure the display", (t) => {
  const f = fixture(t, "lairowner");
  const guest = newPlayer(t, "lairguest");
  const seen = watch(guest);
  guest.getPrivateArea = () => f.house;
  guest.moveTo(new core.Location(f.location.x - 1, f.location.y, f.location.z));
  click(f, "Configure", guest);
  assert.deepEqual(seen.messages, [BossLair.NOT_OWNER]);
  assert.notEqual(guest.getInterfaceId(), MENU);
});

test("Jars opens the costume storage on the jars enum, with Store for the owner", (t) => {
  const f = fixture(t, "lairjars");
  click(f, "Jars");
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
  assert.ok(f.seen.scripts.some(([id, ...args]) => id === 3532 && args[0] === BossLair.JARS_ENUM && args[1] === 1), "poh_costumes_init 3300, may change");
});

test("a jar is stored from the side panel", (t) => {
  const f = fixture(t, "lairstore");
  f.inventory.addItem(new Item(JAR_OF_DIRT, 1));
  f.inventory.addItem(new Item(995, 1));
  click(f, "Jars");
  PluginManager.emitInterfaceActionClick({ player: f.player, buttonId: core.CacheDefinitions.getComponentId("poh_costumes_side:items"),
    action: 1, opId: 1, slot: 0, itemId: JAR_OF_DIRT, handled: false });
  assert.equal(f.furniture.storage?.[JAR_OF_DIRT], 1);
  assert.equal(f.inventory.getAmount(JAR_OF_DIRT), 0);
});

test("withdrawing the shown lair's jar closes the storage and empties the display", (t) => {
  const f = fixture(t, "lairwithdraw");
  f.furniture.storage = { [JAR_OF_CHEMICALS]: 1, [JAR_OF_DIRT]: 1 };
  f.furniture.displayObjectId = loc("poh_display_hydra");
  click(f, "Jars");
  f.seen.animations.length = 0;
  const items = core.CacheDefinitions.getComponentId("poh_costumes:items");
  // Another jar comes out and the storage stays open.
  PluginManager.emitInterfaceActionClick({ player: f.player, buttonId: items, action: 1, opId: 1, slot: rowSlot(KRAKEN_ROW), itemId: JAR_OF_DIRT, handled: false });
  assert.equal(f.inventory.getAmount(JAR_OF_DIRT), 1);
  assert.equal(f.player.getInterfaceId(), Storage.MAIN);
  assert.deepEqual(f.seen.animations, []);
  // rsprox 3897 tick 1092: the shown jar comes out, the storage closes, the display empties a tick later.
  PluginManager.emitInterfaceActionClick({ player: f.player, buttonId: items, action: 1, opId: 1, slot: rowSlot(HYDRA_ROW), itemId: JAR_OF_CHEMICALS, handled: false });
  assert.equal(f.inventory.getAmount(JAR_OF_CHEMICALS), 1);
  assert.notEqual(f.player.getInterfaceId(), Storage.MAIN);
  assert.deepEqual(f.seen.animations, [832]);
  assert.equal(savedDisplay(f).displayObjectId, undefined);
  TaskManager.process();
  assert.equal(drawn(f), f.object.getId());
});

test("logging out before the display empties still saves it empty", (t) => {
  const f = fixture(t, "lairlogout");
  f.furniture.storage = { [JAR_OF_CHEMICALS]: 1 };
  click(f, "Configure");
  pick(f.player, HYDRA_ROW + 1);
  TaskManager.process();
  assert.equal(drawn(f), loc("poh_display_hydra"));
  click(f, "Jars");
  const items = core.CacheDefinitions.getComponentId("poh_costumes:items");
  PluginManager.emitInterfaceActionClick({ player: f.player, buttonId: items, action: 1, opId: 1, slot: rowSlot(HYDRA_ROW), itemId: JAR_OF_CHEMICALS, handled: false });
  // Logout cancels the player's tasks before the redraw runs; the saved display is already blank.
  TaskManager.cancelTasks(f.player.getIndex());
  assert.equal(f.inventory.getAmount(JAR_OF_CHEMICALS), 1);
  assert.equal(savedDisplay(f).displayObjectId, undefined);
});
