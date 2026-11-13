// Run after `yarn build`: node --test tests/poh-prize-chest.test.cjs
// A POH prize chest pays its whole prize or none (a prize key is spent per take). A coin stack near the cap, or one
// with other metadata and no free slot, passed the old slot check: the prize was zeroed and the add kept part or none.
// Real engine: every plugin loaded, a real Player and inventory; the house is a stand-in from House.houseFor.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, House, Prizes;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.ObjectDefinition.init();
  I = core.ItemIdentifiers;
  House = require("../plugins/skills/construction/House.Construction");
  Prizes = require("../plugins/skills/construction/Prizes.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9790;
function ownerInBuildingMode(t, prize) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pohprize" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const house = { owner: p, buildingMode: true, save: { prize }, getFurnitureAt: () => ({ buildableKey: "MAHOGANY_PRIZE_CHEST" }) };
  t.mock.method(House, "houseFor", (who) => (who === p ? house : null));
  t.mock.method(House, "saveHouse", () => {});
  return { p, house };
}
const open = (p) => Prizes.open({ player: p, location: new core.Location(0, 0, 0), objectId: 1, object: null });

test("a coin stack near the cap takes none of the prize, which stays in the chest", (t) => {
  const { p, house } = ownerInBuildingMode(t, 100000);
  p.getInventory().setItem(0, new core.Item(I.COINS, 2147483647 - 40000));
  open(p);
  assert.equal(house.save.prize, 100000);
  assert.equal(p.getInventory().getAmount(I.COINS), 2147483647 - 40000);
});

test("a full inventory whose coins carry other metadata takes nothing", (t) => {
  const { p, house } = ownerInBuildingMode(t, 5000);
  const tagged = new core.Item(I.COINS, 10);
  tagged.setMeta({ preset: true });
  p.getInventory().setItem(0, tagged);
  for (let slot = 1; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.BRONZE_SHORTSWORD, 1));
  open(p);
  assert.equal(house.save.prize, 5000);
  assert.equal(p.getInventory().getAmount(I.COINS), 10);
});

test("a full inventory whose last slot is the prize key takes the prize into that slot", (t) => {
  const { p, house } = ownerInBuildingMode(t, 5000);
  house.buildingMode = false;
  const key = require("../plugins/skills/construction/Ids.Construction").obj("poh_prize_key");
  for (let slot = 0; slot < 27; slot++) p.getInventory().setItem(slot, new core.Item(I.BRONZE_SHORTSWORD, 1));
  p.getInventory().setItem(27, new core.Item(key, 1));
  open(p);
  assert.equal(house.save.prize, 0);
  assert.equal(p.getInventory().getAmount(key), 0);
  assert.equal(p.getInventory().getAmount(I.COINS), 5000);
});

test("room for it all takes the prize", (t) => {
  const { p, house } = ownerInBuildingMode(t, 5000);
  open(p);
  assert.equal(house.save.prize, 0);
  assert.equal(p.getInventory().getAmount(I.COINS), 5000);
});

// Registered games-room entry and real house/menu/task lifecycle. The house and equipment are
// seeded; these cases do not claim acquisition or client-rendered overlay behavior.
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let nativeActorId = 0;
function gamesActor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const connection = new ClientConnection(channel); connection.player = p;
  let index;
  t.after(() => {
    try {
      if (p.isRegistered()) PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    } finally {
      try { House.releaseHouse(p, true); }
      finally {
        p.closeInterruptibleInterfaces();
        if (index !== undefined) core.TaskManager.cancelTasks(`construction:ranging:${index}`);
        if (p.isRegistered()) core.World.getPlayers().remove(p);
      }
    }
    assert.equal(House.houseFor(p), null);
    if (index !== undefined) assert.equal(core.TaskManager.hasActiveTask(`construction:ranging:${index}`), false);
  });
  p.setUsername(`pohgame${++nativeActorId}`);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(p), true);
  index = p.getIndex();
  const messages = [], strings = [];
  const sendMessage = p.sendMessage.bind(p), sendString = p.getPacketSender().sendString.bind(p.getPacketSender());
  t.mock.method(p, "sendMessage", text => { messages.push(text); return sendMessage(text); });
  t.mock.method(p.getPacketSender(), "sendString", (text, component) => { strings.push({ text, component }); return sendString(text, component); });
  return { p, connection, messages, strings };
}

function gamesHouse(owner) {
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const save = Instance.createDefaultHouseSave();
  save.rooms[1][4][6] = { roomKey: "GAMES_ROOM", rotation: 0, furniture: { RANGING_GAME: "DARTBOARD", PRIZE_CHEST: "OAK_PRIZE_CHEST" } };
  save.prize = 1000;
  owner.p.setAttribute("construction:house", save);
  assert.equal(House.enterHouse(owner.p, false), true);
  const house = House.houseFor(owner.p);
  assert.ok(house instanceof Instance.PlayerHouseInstance);
  const furniture = house.furnitureEntries().find(entry => entry.furniture.buildableKey === "DARTBOARD")?.furniture;
  assert.ok(furniture);
  const object = house.furnitureObjects.find(candidate => {
    const loc = candidate.getLocation();
    return house.getFurnitureAt({ x: loc.getX(), y: loc.getY(), z: loc.getZ() }, candidate.getId(), candidate.getType()) === furniture;
  });
  assert.ok(object);
  return { house, furniture, object };
}
function shootAt(f, scene) {
  const object = scene.object, at = object.getLocation(), id = object.getId();
  const definition = core.ObjectDefinition.forPlayer(id, f.p) ?? core.ObjectDefinition.forId(id);
  const option = definition.getInteractions().findIndex(action => action?.toLowerCase() === "throw-at");
  assert.notEqual(option, -1);
  const location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  f.p.moveTo(new core.Location(location.x - 1, location.y, location.z));
  f.p.setNeedsPlacement(false);
  assert.equal(PM.emitObjectInteraction({ player: f.p, object, objectId: id, definition, clickType: option + 1,
    location, sourceLocation: { x: location.x - 1, y: location.y, z: location.z }, handled: false }), true);
}
function equipDarts(f) { f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.BRONZE_DART, 10)); }
async function chooseGamePrompt(f, choice) {
  const pending = core.MultiChatboxPrompt.getPending(f.p);
  assert.equal(pending?.title, "Offer the prize for this game?");
  const index = pending.options.indexOf(choice); assert.notEqual(index, -1);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  f.connection.processTurnPackets();
}
function gameTicks(count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
  }
}
function rangingStrings(values) {
  const overlay = require("../plugins/skills/construction/Ids.Construction").iface("poh_ranging");
  return values.filter(value => (value.component >>> 16) === overlay);
}

test("failed equipment does not join an existing game or block its winner", async t => {
  const owner = gamesActor(t), guest = gamesActor(t), scene = gamesHouse(owner);
  scene.house.enter(guest.p);
  equipDarts(owner);
  shootAt(owner, scene); await chooseGamePrompt(owner, "No"); gameTicks(3);
  shootAt(guest, scene);
  assert.ok(guest.messages.includes("You must wield a thrown weapon."));
  for (let shot = 1; shot < 10; shot++) { shootAt(owner, scene); gameTicks(3); }
  assert.ok(owner.strings.some(value => value.text === "Winner!"), "the valid player completes all ten shots");
  assert.equal(guest.strings.some(value => value.text === "Winner!"), false);
});

test("failed and dismissed starts do not reserve a game or its prize", async t => {
  const owner = gamesActor(t), scene = gamesHouse(owner);
  shootAt(owner, scene);
  assert.ok(owner.messages.includes("You must wield a thrown weapon."));
  equipDarts(owner);
  shootAt(owner, scene);
  assert.ok(core.MultiChatboxPrompt.getPending(owner.p));
  owner.p.getPacketSender().sendInterfaceRemoval();
  assert.equal(core.MultiChatboxPrompt.getPending(owner.p), null);
  shootAt(owner, scene); await chooseGamePrompt(owner, "Yes");
  for (let shot = 1; shot < 10; shot++) { gameTicks(3); shootAt(owner, scene); }
  gameTicks(3);
  assert.ok(owner.messages.includes("A little key appears in your pack!"));
});

test("a delayed prize answer after leaving cannot start or reserve a game", async t => {
  const owner = gamesActor(t), scene = gamesHouse(owner);
  equipDarts(owner); shootAt(owner, scene);
  assert.ok(core.MultiChatboxPrompt.getPending(owner.p));
  scene.house.leave(owner.p, false);
  scene.house.enter(owner.p);
  const before = owner.strings.length;
  await chooseGamePrompt(owner, "Yes");
  gameTicks(3);
  assert.deepEqual(rangingStrings(owner.strings.slice(before)), [], "the stale answer sends no ranging overlay");
  shootAt(owner, scene);
  assert.equal(core.MultiChatboxPrompt.getPending(owner.p)?.title, "Offer the prize for this game?");
});

test("equipment removed while the prize prompt is open does not commit the start", async t => {
  const owner = gamesActor(t), scene = gamesHouse(owner);
  equipDarts(owner); shootAt(owner, scene);
  owner.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  await chooseGamePrompt(owner, "Yes");
  assert.ok(owner.messages.includes("You must wield a thrown weapon."));
  equipDarts(owner); shootAt(owner, scene);
  assert.equal(core.MultiChatboxPrompt.getPending(owner.p)?.title, "Offer the prize for this game?");
});

test("building-mode rebuild invalidates pending starts and active shot tasks", async t => {
  const owner = gamesActor(t), scene = gamesHouse(owner);
  equipDarts(owner); shootAt(owner, scene);
  assert.equal(scene.house.rebuild(owner.p, true), true);
  assert.equal(scene.house.rebuild(owner.p, false), true);
  await chooseGamePrompt(owner, "Yes");
  shootAt(owner, scene); await chooseGamePrompt(owner, "No");
  const before = owner.strings.length;
  assert.equal(scene.house.rebuild(owner.p, true), true);
  gameTicks(3);
  assert.deepEqual(rangingStrings(owner.strings.slice(before)), [], "the invalidated task sends no ranging overlay");
  assert.equal(scene.house.rebuild(owner.p, false), true);
  shootAt(owner, scene);
  assert.equal(core.MultiChatboxPrompt.getPending(owner.p)?.title, "Offer the prize for this game?");
});

test("a delayed owner answer cannot replace a game started by a visitor", async t => {
  const owner = gamesActor(t), guest = gamesActor(t), scene = gamesHouse(owner);
  scene.house.enter(guest.p); equipDarts(owner); equipDarts(guest);
  shootAt(owner, scene);
  shootAt(guest, scene); gameTicks(3);
  await chooseGamePrompt(owner, "Yes");
  for (let shot = 1; shot < 10; shot++) { shootAt(guest, scene); gameTicks(3); }
  assert.ok(guest.strings.some(value => value.text === "Winner!"));
  assert.equal(guest.messages.includes("A little key appears in your pack!"), false);
  assert.equal(scene.house.save.prize, 1000);
});

test("a prize taken while the offer is open is not awarded by the later answer", async t => {
  const owner = gamesActor(t), guest = gamesActor(t), scene = gamesHouse(owner);
  scene.house.enter(guest.p); equipDarts(owner); shootAt(owner, scene);
  const key = require("../plugins/skills/construction/Ids.Construction").obj("poh_prize_key");
  guest.p.getInventory().add(new core.Item(key, 1), false);
  const chest = scene.house.furnitureEntries().find(entry => entry.furniture.buildableKey === "OAK_PRIZE_CHEST")?.furniture;
  assert.ok(chest);
  const object = scene.house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return scene.house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === chest;
  });
  assert.ok(object);
  const at = object.getLocation(), id = object.getId();
  const definition = core.ObjectDefinition.forPlayer(id, guest.p) ?? core.ObjectDefinition.forId(id);
  const click = definition.getInteractions().findIndex(action => action?.toLowerCase() === "open") + 1;
  assert.ok(click > 0);
  const location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  guest.p.moveTo(new core.Location(location.x - 1, location.y, location.z));
  assert.equal(PM.emitObjectInteraction({ player: guest.p, object, objectId: id, definition, clickType: click,
    location, sourceLocation: { x: location.x - 1, y: location.y, z: location.z }, handled: false }), true);
  assert.equal(scene.house.save.prize, 0);
  assert.equal(guest.p.getInventory().getAmount(I.COINS), 1000);
  await chooseGamePrompt(owner, "Yes");
  for (let shot = 1; shot < 10; shot++) { gameTicks(3); shootAt(owner, scene); }
  gameTicks(3);
  assert.ok(owner.strings.some(value => value.text === "Winner!"));
  assert.equal(owner.messages.includes("A little key appears in your pack!"), false);
});

// Two games rooms, each with a dartboard: the prize offer belongs to the board it was offered on.
function twoDartboards(owner) {
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const save = Instance.createDefaultHouseSave();
  save.rooms[1][4][6] = { roomKey: "GAMES_ROOM", rotation: 0, furniture: { RANGING_GAME: "DARTBOARD", PRIZE_CHEST: "OAK_PRIZE_CHEST" } };
  save.rooms[1][4][5] = { roomKey: "GAMES_ROOM", rotation: 0, furniture: { RANGING_GAME: "DARTBOARD" } };
  save.prize = 1000;
  owner.p.setAttribute("construction:house", save);
  assert.equal(House.enterHouse(owner.p, false), true);
  const house = House.houseFor(owner.p);
  const boards = house.furnitureEntries().filter(entry => entry.furniture.buildableKey === "DARTBOARD").map(entry => entry.furniture);
  assert.equal(boards.length, 2);
  const objects = boards.map(furniture => house.furnitureObjects.find(candidate => {
    const loc = candidate.getLocation();
    return house.getFurnitureAt({ x: loc.getX(), y: loc.getY(), z: loc.getZ() }, candidate.getId(), candidate.getType()) === furniture;
  }));
  assert.ok(objects.every(Boolean));
  return objects.map(object => ({ house, object }));
}

test("a game given up on one dartboard keeps the prize offered on the other", async t => {
  const owner = gamesActor(t), guest = gamesActor(t), [a, b] = twoDartboards(owner);
  a.house.enter(guest.p); equipDarts(owner); equipDarts(guest);
  shootAt(owner, a); await chooseGamePrompt(owner, "Yes"); gameTicks(3);
  shootAt(guest, b); gameTicks(3);
  a.house.leave(guest.p, false);
  for (let shot = 1; shot < 10; shot++) { shootAt(owner, a); gameTicks(3); }
  assert.ok(owner.strings.some(value => value.text === "Winner!"));
  assert.ok(owner.messages.includes("A little key appears in your pack!"));
});

test("winning on the other dartboard does not take the key for the prize's board", async t => {
  const owner = gamesActor(t), guest = gamesActor(t), [a, b] = twoDartboards(owner);
  a.house.enter(guest.p); equipDarts(owner); equipDarts(guest);
  shootAt(owner, a); await chooseGamePrompt(owner, "Yes"); gameTicks(3);
  for (let shot = 0; shot < 10; shot++) { shootAt(guest, b); gameTicks(3); }
  assert.ok(guest.strings.some(value => value.text === "Winner!"));
  assert.equal(guest.messages.includes("A little key appears in your pack!"), false);
  for (let shot = 1; shot < 10; shot++) { shootAt(owner, a); gameTicks(3); }
  assert.ok(owner.messages.includes("A little key appears in your pack!"));
});
