// House portals in every town: the Enter menu, the loading screen, Friend's house and its refusals.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core, api, House, Menu, portalId, exitPortalId, ids;
const PORTAL_TILE = [2542, 3097, 0];
const pinRequests = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("HousePortalsTest");
  api.onCustomEvent("bank-pin:guard", (request) => pinRequests.push(request));
  require("../plugins/skills/construction/Core.Construction").init(api);
  House = require("../plugins/skills/construction/House.Construction");
  Menu = require("../plugins/skills/construction/Menu.Construction");
  House.attach(api);
  require("../plugins/modes/ironman/Common.Ironman").init(api);
  require("../plugins/modes/ironman/Setup.Ironman")(api);
  portalId = require("../plugins/skills/construction/Estate.Construction").HOUSE_LOCATIONS.find(({ id }) => id === 6).portal;
  exitPortalId = core.CacheDefinitions.getLocId("poh_exit_portal");
  const defs = core.CacheDefinitions;
  ids = {
    loading: defs.getInterfaceId("poh_loading"),
    overlay: defs.getComponentId("toplevel_osrs_stretch:overlay_atmosphere"),
    minimap: defs.getVarbitId("minimap_state"),
    busy: defs.getVarbitId("busy"),
  };
});

/** A player whose packets are recorded as [method, ...args], per tick. */
function playerFixture(name = "houseowner") {
  const player = new Player(null);
  player.setUsername(name);
  const saved = require("../plugins/skills/construction/Instance.Construction").createDefaultHouseSave();
  saved.location = 6;
  player.setAttribute("construction:house", saved);
  player.sent = [];
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === "getVarbit" || key === "getVarp") return () => 0;
    return (...args) => { player.sent.push([key, ...args]); return sender; };
  } });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.setEnteredSyntaxAction = (action) => { player.enteredSyntaxAction = action; };
  player.messages = [];
  player.sendMessage = (message) => { player.messages.push(message); };
  player.getRelations = () => ({ canReceivePrivateMessageFrom: () => true });
  return player;
}

function click(player, objectId, clickType, coordinates = PORTAL_TILE) {
  const location = new core.Location(...coordinates);
  const source = new core.Location(coordinates[0], coordinates[1] - 1, coordinates[2]);
  player.moveTo(source);
  const object = new GameObject(objectId, location, 10, 2, null);
  const definition = ObjectDefinition.forPlayer(objectId, player) ?? ObjectDefinition.forId(objectId);
  return PluginManager.emitObjectInteraction({ player, object, definition, objectId, clickType,
    location: { x: location.getX(), y: location.getY(), z: location.getZ() },
    sourceLocation: { x: source.getX(), y: source.getY(), z: source.getZ() }, handled: false });
}

/** Runs one game tick and returns the packets it sent. */
function tick(player) {
  player.sent = [];
  core.TaskManager.process();
  return player.sent;
}

const has = (sent, method, ...args) => sent.some(([key, ...rest]) => key === method
  && args.every((value, index) => rest[index] === value));

function withPlayerByName(found, run) {
  const original = core.World.getPlayerByName;
  core.World.getPlayerByName = (name) => found(name);
  try { return run(); } finally { core.World.getPlayerByName = original; }
}

function withRefusals(run) {
  const refusals = [];
  const original = Menu.refuse;
  Menu.refuse = (player, problem) => { refusals.push(problem); };
  try { run(refusals); } finally { Menu.refuse = original; }
  return refusals;
}

test("Home shows the loading screen, loads the house two ticks later and closes the screen the tick after", () => {
  const player = playerFixture();
  player.sent = [];
  assert.equal(click(player, portalId, 2), true);
  const click0 = player.sent;
  assert.ok(has(click0, "sendSound", 984));
  assert.ok(has(click0, "sendVarbit", ids.minimap, 2));
  assert.ok(has(click0, "sendCameraReset"));
  assert.ok(has(click0, "sendSubInterface", ids.overlay, ids.loading, 1));
  assert.equal(House.houseFor(player), null, "not inside on the click tick");
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, "held still while loading");

  const tick1 = tick(player);
  assert.ok(has(tick1, "sendJingle", 112));
  assert.ok(has(tick1, "sendVarbit", ids.busy, 1));
  assert.equal(House.houseFor(player), null);

  tick(player);
  assert.equal(House.houseFor(player)?.owner, player, "inside two ticks after the click");

  const tick3 = tick(player);
  assert.ok(has(tick3, "closeSubInterface", ids.overlay));
  assert.ok(has(tick3, "sendVarbit", ids.minimap, 0));
  assert.ok(has(tick3, "sendVarbit", ids.busy, 0));
  assert.deepEqual(player.messages, [], "entering sends no chat line");
  assert.equal(player.getMovementQueue().isMovementBlocked(), false, "free again once the screen closes");
  House.releaseHouse(player, true);
});

test("Enter opens the Select an option menu, whose choices go home, build or visit", () => {
  const player = playerFixture();
  const original = api.sendMultiChatboxPrompt;
  let menu = null;
  api.sendMultiChatboxPrompt = (who, title, ...options) => { menu = { who, title, options }; };
  try {
    assert.equal(click(player, portalId, 1), true);
  } finally {
    api.sendMultiChatboxPrompt = original;
  }
  assert.equal(House.houseFor(player), null, "Enter itself goes nowhere");
  assert.equal(menu.who, player);
  assert.equal(menu.title, "Select an option");
  const labels = menu.options.filter((_, index) => index % 2 === 0);
  assert.deepEqual(labels, ["Go to your house", "Go to your house (building mode)", "Go to a friend's house", "Cancel"]);
  menu.options[5]();
  assert.deepEqual(player.sent.find(([key]) => key === "sendClientScript").slice(1), [109, "Enter name:"]);
  menu.options[3]();
  for (let i = 0; i < 3; i++) tick(player);
  assert.equal(House.houseFor(player)?.buildingMode, true, "the second choice enters in building mode");
  House.releaseHouse(player, true);
});

test("Build mode asks the Bank PIN under the Housing Security System title", () => {
  const player = playerFixture();
  pinRequests.length = 0;
  click(player, portalId, 3);
  assert.equal(pinRequests.at(-1)?.feature, "poh-building-mode");
  const titles = require("../plugins/interface/data/bank-pin.json").guardTitles;
  assert.equal(titles["poh-building-mode"], "Housing Security System");
  for (let i = 0; i < 3; i++) tick(player);
  House.releaseHouse(player, true);
});

test("Friend's house opens the Enter name: dialog", () => {
  const player = playerFixture();
  player.sent = [];
  click(player, portalId, 4);
  assert.deepEqual(player.sent.find(([key]) => key === "sendClientScript").slice(1), [109, "Enter name:"]);
  assert.equal(typeof player.enteredSyntaxAction?.execute, "function");
});

test("an Ironman clicking Friend's house gets the message box and no prompt", () => {
  const player = playerFixture("ironvisitor");
  require("../plugins/modes/ironman/Common.Ironman").setMode(player, "ironman");
  const refusals = withRefusals(() => click(player, portalId, 4));
  assert.deepEqual(refusals, [Menu.messageBox("Ironmen do not visit their friends.<br>Ironmen stand alone.")]);
  assert.equal(player.enteredSyntaxAction, undefined);
});

function hostWithHouse(name = "hosty") {
  const host = playerFixture(name);
  host.getDisplayName = () => "Hosty";
  click(host, portalId, 2);
  for (let i = 0; i < 3; i++) tick(host);
  assert.equal(House.houseFor(host)?.owner, host);
  return host;
}

test("each failed visit gets its own line: offline or private, building mode, locked", () => {
  const guest = playerFixture("guesty");
  click(guest, portalId, 4);
  let refusals = withRefusals(() => withPlayerByName(() => null, () => guest.enteredSyntaxAction.execute("nobody")));
  assert.deepEqual(refusals, ["That player is offline, or has privacy mode enabled."]);

  const host = hostWithHouse();
  const house = House.houseFor(host);
  host.getRelations = () => ({ canReceivePrivateMessageFrom: () => false });
  refusals = withRefusals(() => withPlayerByName(() => host, () => guest.enteredSyntaxAction.execute("hosty")));
  assert.deepEqual(refusals, ["That player is offline, or has privacy mode enabled."], "private chat off");
  host.getRelations = () => ({ canReceivePrivateMessageFrom: () => true });

  house.buildingMode = true;
  refusals = withRefusals(() => withPlayerByName(() => host, () => guest.enteredSyntaxAction.execute("hosty")));
  assert.deepEqual(refusals, ["Hosty is in building mode at the moment."]);
  house.buildingMode = false;

  house.save.locked = true;
  refusals = withRefusals(() => withPlayerByName(() => host, () => guest.enteredSyntaxAction.execute("hosty")));
  assert.deepEqual(refusals, ["Hosty has locked his house to visitors."]);
  house.save.locked = false;
  assert.equal(House.houseFor(guest), null);
  House.releaseHouse(host, true);
});

test("a visit plays the loading screen with its jingle, arrives a tick later and sends no welcome line", () => {
  const host = hostWithHouse("hostv");
  const guest = playerFixture("guestv");
  click(guest, portalId, 4);
  guest.sent = [];
  withPlayerByName(() => host, () => guest.enteredSyntaxAction.execute("hostv"));
  assert.ok(has(guest.sent, "sendSound", 984));
  assert.ok(has(guest.sent, "sendJingle", 112));
  assert.ok(has(guest.sent, "sendSubInterface", ids.overlay, ids.loading, 1));
  assert.equal(House.houseFor(guest), null);
  tick(guest);
  assert.equal(House.houseFor(guest), House.houseFor(host), "inside a tick after the name");
  const closing = tick(guest);
  assert.ok(has(closing, "closeSubInterface", ids.overlay));
  assert.deepEqual(guest.messages, []);
  House.releaseHouse(guest, true);
  House.releaseHouse(host, true);
});

test("a house teleport lands inside at once behind the loading screen, closed two ticks later", () => {
  const player = playerFixture("teleporter");
  player.sent = [];
  api.emitCustomEvent("spell:teleport-arrival", { player, name: "teleport to house" });
  assert.equal(House.houseFor(player)?.owner, player);
  assert.ok(has(player.sent, "sendJingle", 112));
  assert.ok(has(player.sent, "sendSubInterface", ids.overlay, ids.loading, 1));
  assert.equal(has(player.sent, "sendSound", 984), false);
  assert.deepEqual(player.messages, []);
  assert.equal(has(tick(player), "closeSubInterface", ids.overlay), false);
  assert.ok(has(tick(player), "closeSubInterface", ids.overlay));
  House.releaseHouse(player, true);
});

test("a move during the loading screen (another teleport) cancels the entry and closes the screen", () => {
  const player = playerFixture("moved");
  click(player, portalId, 2);
  tick(player);
  player.moveTo(new core.Location(3222, 3218, 0));
  const sent = tick(player);
  assert.ok(has(sent, "closeSubInterface", ids.overlay));
  tick(player);
  assert.equal(House.houseFor(player), null, "no house after being moved away");
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
});

test("loading keeps a movement block another system already held", () => {
  const player = playerFixture("held");
  player.getMovementQueue().setBlockMovement(true);
  click(player, portalId, 2);
  for (let i = 0; i < 3; i++) tick(player);
  assert.equal(House.houseFor(player)?.owner, player);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  House.releaseHouse(player, true);
});

test("the board lists the owner's own house only while it is open to guests", () => {
  const host = hostWithHouse("boardhost");
  const house = House.houseFor(host);
  assert.equal(House.canVisitHouse(host, house), true);
  house.save.locked = true;
  assert.equal(House.canVisitHouse(host, house), false);
  house.save.locked = false;
  house.buildingMode = true;
  assert.equal(House.canVisitHouse(host, house), false);
  house.buildingMode = false;
  House.releaseHouse(host, true);
});

test("leaving by the exit portal plays the portal sound", () => {
  const player = hostWithHouse("leaver");
  player.sent = [];
  const exit = House.houseFor(player).getEntryLocation();
  click(player, exitPortalId, 1, [exit.getX(), exit.getY(), exit.getZ()]);
  assert.equal(House.houseFor(player), null);
  assert.ok(has(player.sent, "sendSound", 984));
});
