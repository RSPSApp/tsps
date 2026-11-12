// House rooms: building, moving and removing a room rebuilds the house behind the loading screen,
// too few coins keeps the room list open, and removing a room that joins two floors warns first.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core, api, House, Menu, Data, Stairs, Nexus, ids;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("HouseRoomRebuildTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  House = require("../plugins/skills/construction/House.Construction");
  Menu = require("../plugins/skills/construction/Menu.Construction");
  Data = require("../plugins/skills/construction/Data.Construction");
  Stairs = require("../plugins/skills/construction/Stairs.Construction");
  Nexus = require("../plugins/skills/construction/Nexus.Construction");
  House.attach(api);
  const defs = core.CacheDefinitions;
  ids = {
    loading: defs.getInterfaceId("poh_loading"),
    overlay: defs.getComponentId("toplevel_osrs_stretch:overlay_atmosphere"),
    minimap: defs.getVarbitId("minimap_state"),
    busy: defs.getVarbitId("busy"),
    roomList: defs.getInterfaceId("poh_add_room"),
    viewer: defs.getInterfaceId("poh_viewer"),
  };
});

/** An owner in building mode whose packets are recorded as [method, ...args]. */
function owner(name) {
  const player = new Player(null);
  player.setUsername(name);
  const saved = require("../plugins/skills/construction/Instance.Construction").createDefaultHouseSave();
  saved.location = 6;
  player.setAttribute("construction:house", saved);
  player.sent = [];
  player.interfaceId = -1;
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === "getVarbit" || key === "getVarp") return () => 0;
    return (...args) => {
      player.sent.push([key, ...args]);
      if (key === "sendInterface") player.interfaceId = args[0];
      if (key === "sendInterfaceRemoval") player.interfaceId = -1;
      return sender;
    };
  } });
  player.getPacketSender = () => sender;
  player.getInterfaceId = () => player.interfaceId;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.messages = [];
  player.sendMessage = (message) => { player.messages.push(message); };
  player.getRelations = () => ({ canReceivePrivateMessageFrom: () => true });
  assert.equal(House.enterHouse(player, true), true);
  player.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  return { player, house: House.houseFor(player) };
}

function tick(player) {
  player.sent = [];
  core.TaskManager.process();
  return player.sent;
}

const has = (sent, method, ...args) => sent.some(([key, ...rest]) => key === method
  && args.every((value, index) => rest[index] === value));

/** Runs `run` with chat menus and message boxes caught instead of shown. */
function withPrompts(run) {
  const prompts = [], warnings = [], refusals = [];
  const originals = { prompt: api.sendMultiChatboxPrompt, warn: Menu.warn, refuse: Menu.refuse };
  api.sendMultiChatboxPrompt = (who, title, ...options) => { prompts.push({ title, options }); };
  Menu.warn = (who, text, then) => { warnings.push({ text, then }); };
  Menu.refuse = (who, problem) => { refusals.push(problem); };
  try { run({ prompts, warnings, refusals }); } finally {
    api.sendMultiChatboxPrompt = originals.prompt;
    Menu.warn = originals.warn;
    Menu.refuse = originals.refuse;
  }
}

/** Clicks the door hotspot that leads to the empty spot `target`. */
function clickDoorTo(player, house, target) {
  const entry = [...house.doorTargets.entries()].find(([, to]) => to.x === target.x && to.y === target.y && to.plane === target.plane);
  assert.ok(entry, "a door hotspot leads there"); 
  const [x, y, z] = entry[0].split(":").map(Number);
  const objectId = [...Data.ROOM_DOOR_HOTSPOT_IDS][0];
  const location = new core.Location(x, y, z);
  const definition = ObjectDefinition.forId(objectId);
  return PluginManager.emitObjectInteraction({ player, object: new GameObject(objectId, location, 0, 0, null), definition, objectId,
    clickType: 1, location: { x, y, z }, sourceLocation: { x, y, z }, handled: false });
}

function pickRoom(player, room) {
  const event = { player, buttonId: (ids.roomList << 16) | 4, groupId: ids.roomList, childId: 4, action: room.id, handled: false };
  PluginManager.emitInterfaceActionClick(event);
  return event;
}

function assertLoadingSequence(player, clickTick, rebuilt) {
  assert.ok(has(clickTick, "sendSubInterface", ids.overlay, ids.loading, 1), "the loading screen at once");
  assert.ok(has(clickTick, "sendVarbit", ids.minimap, 2), "the minimap goes off");
  assert.ok(has(clickTick, "sendJingle", 20), "Basic wood's loading jingle");
  assert.ok(has(clickTick, "sendVarbit", ids.busy, 1));
  assert.equal(has(clickTick, "closeSubInterface", ids.overlay), false);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, "held still while loading");
  const tick1 = tick(player);
  assert.equal(has(tick1, "closeSubInterface", ids.overlay), false, "the screen stays up while the house is rebuilt");
  rebuilt();
  const tick2 = tick(player);
  assert.ok(has(tick2, "closeSubInterface", ids.overlay), "the screen closes two ticks after");
  assert.ok(has(tick2, "sendVarbit", ids.minimap, 0));
  assert.ok(has(tick2, "sendVarbit", ids.busy, 0));
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  return tick2;
}

const PARLOUR_SPOT = { plane: 1, x: 3, y: 5 };

test("too few coins: the chat line, and the room list opens again", () => {
  const { player, house } = owner("poorbuilder");
  const parlour = Data.ROOM_BY_KEY.get("PARLOUR");
  withPrompts(({ prompts, refusals }) => {
    assert.equal(clickDoorTo(player, house, PARLOUR_SPOT), true);
    assert.equal(player.getInterfaceId(), ids.roomList);
    player.sent = [];
    assert.equal(pickRoom(player, parlour).handled, true);
    assert.deepEqual(player.messages, ["You can't afford to build that room."]);
    assert.deepEqual(refusals, []);
    assert.deepEqual(prompts, [], "no rotate/build menu");
    assert.ok(has(player.sent, "sendInterface", ids.roomList), "the list is sent again");
    assert.equal(player.getInterfaceId(), ids.roomList);
    // The reopened list still answers: with the coins, the same pick goes on to the build menu.
    player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, parlour.cost), false);
    pickRoom(player, parlour);
    assert.equal(prompts.at(-1)?.title, "Select an option");
  });
  House.releaseHouse(player, true);
});

test("Build from the door hotspot takes the coins behind the loading screen and rebuilds a tick later", () => {
  const { player, house } = owner("doorbuilder");
  const parlour = Data.ROOM_BY_KEY.get("PARLOUR");
  player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, parlour.cost), false);
  withPrompts(({ prompts }) => {
    clickDoorTo(player, house, PARLOUR_SPOT);
    pickRoom(player, parlour);
    const menu = prompts.at(-1);
    const build = menu.options[menu.options.indexOf("Build") + 1];
    let rebuilds = 0;
    const rebuild = house.rebuild.bind(house);
    house.rebuild = (...args) => { rebuilds++; return rebuild(...args); };
    player.sent = [];
    build();
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, "paid on the click");
    assert.equal(house.getRoom(PARLOUR_SPOT)?.roomKey, "PARLOUR");
    assert.equal(rebuilds, 0, "not rebuilt on the click tick");
    assertLoadingSequence(player, player.sent, () => assert.equal(rebuilds, 1, "rebuilt the tick after"));
    assert.equal(rebuilds, 1);
  });
  assert.deepEqual(player.messages, []);
  House.releaseHouse(player, true);
});

test("removing a room: Room deleted!, then the loading screen; a viewer removal reopens the viewer as it closes", () => {
  const { player, house } = owner("remover");
  const spot = { plane: 1, x: 4, y: 5 };
  withPrompts(({ prompts, warnings }) => {
    let reopened = 0;
    House.removeRoomPrompt(player, house, spot, () => {}, () => reopened++);
    assert.deepEqual(warnings, [], "a parlour removal has no warning");
    assert.equal(prompts.at(-1).title, "Remove the parlour?");
    player.sent = [];
    prompts.at(-1).options[1]();
    assert.equal(house.getRoom(spot), null);
    assert.deepEqual(player.messages, ["Room deleted!"]);
    assertLoadingSequence(player, player.sent, () => assert.equal(reopened, 0));
    assert.equal(reopened, 1, "the viewer comes back with the house");
  });
  House.releaseHouse(player, true);
});

function withStairs(house, position, roomKey, buildableKey) {
  house.placeRoom(position, Data.ROOM_BY_KEY.get(roomKey), 0);
  house.getRoom(position).furnitureByLocation = { stairs: { buildableKey, localX: 3, localY: 3, type: 10 } };
}

test("removing a room whose stairs join another floor warns first, then asks", () => {
  const cases = [
    [{ plane: 0, x: 4, y: 5 }, "DUNGEON_STAIRS", "OAK_STAIRCASE_UP", Stairs.BASEMENT_FROM_GROUND],
    [{ plane: 1, x: 3, y: 4 }, "SKILL_HALL_UP", "OAK_STAIRCASE_DOWN", Stairs.BASEMENT_LEVEL],
    [{ plane: 2, x: 4, y: 5 }, "SKILL_HALL_DOWN", "OAK_STAIRCASE_DOWN", Stairs.UPPER_FROM_GROUND],
    [{ plane: 1, x: 3, y: 4 }, "SKILL_HALL_UP", "OAK_STAIRCASE_UP", Stairs.UPPER_FROM_GROUND],
  ];
  for (const [position, roomKey, stairs, warning] of cases) {
    const { player, house } = owner("stairs" + position.plane + stairs.length);
    withStairs(house, position, roomKey, stairs);
    withPrompts(({ prompts, warnings, refusals }) => {
      House.removeRoomPrompt(player, house, position);
      assert.deepEqual(refusals, []);
      assert.deepEqual(warnings.map(({ text }) => text), [warning], `${roomKey} ${stairs}`);
      assert.deepEqual(prompts, [], "the question waits for the warning");
      warnings[0].then();
      assert.equal(prompts.at(-1).title, `Remove the ${Data.ROOM_BY_KEY.get(roomKey).name}?`);
    });
    House.releaseHouse(player, true);
  }
  assert.equal(Stairs.BASEMENT_LEVEL, "<col=800000>Warning:<col=000000> If you remove this room you may be unable to access the<br><col=000000>basement level.");
});

test("a hall without stairs gets no warning", () => {
  const { player, house } = owner("nostairs");
  house.placeRoom({ plane: 1, x: 3, y: 4 }, Data.ROOM_BY_KEY.get("SKILL_HALL_UP"), 0);
  withPrompts(({ prompts, warnings }) => {
    House.removeRoomPrompt(player, house, { plane: 1, x: 3, y: 4 });
    assert.deepEqual(warnings, []);
    assert.equal(prompts.at(-1).title, "Remove the skill hall?");
  });
  House.releaseHouse(player, true);
});

test("removing the portal nexus room warns that its teleports are paid for again", () => {
  const { player, house } = owner("nexusowner");
  const position = { plane: 1, x: 3, y: 4 };
  house.placeRoom(position, Data.ROOM_BY_KEY.get("PORTAL_NEXUS"), 0);
  house.getRoom(position).furnitureByLocation = { nexus: { buildableKey: "MARBLE_PORTAL_NEXUS", localX: 3, localY: 3, type: 10 } };
  withPrompts(({ prompts, warnings }) => {
    House.removeRoomPrompt(player, house, position);
    assert.deepEqual(warnings.map(({ text }) => text), ["<col=800000>Warning:<col=000000> If you remove this room you will have to pay for your<br><col=000000>teleports to be used in the nexus again."]);
    warnings[0].then();
    assert.equal(prompts.at(-1).title, "Remove the portal nexus?");
  });
  House.releaseHouse(player, true);
});
