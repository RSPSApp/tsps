// Run after `yarn build`: node --test tests/wilderness-obelisks-house.test.cjs
//
// The superior garden's Wilderness obelisk (poh_wilderness_obelisk) against rsprox recording 2884
// (rev 230): every option asks on the Wilderness warning screen (475) first; "Enter Wilderness"
// plays human_wilderness_portal and 2 ticks later lands the player, alone, on a Wilderness
// obelisk's pad: Activate a random one, Teleport to destination (hard diary) the one set.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Obelisks = require("../plugins/areas/WildernessObelisks.plugin");
const T = Obelisks._test;

let core, handlers, rewardClaimed, exits, landed, houseHandles, players;
const HOUSE_OBELISK = 31554;
const WARNING = 475;
const MAIN_MODAL = (161 << 16) | 16;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  handlers = {};
  Obelisks.register({
    core,
    getTaskManager: () => core.TaskManager,
    persistAttribute() {},
    onObjectInteraction: (name, options) => { handlers[name] = options; },
    onInterfaceActionClick() {},
    onCustomEvent() {},
    onPlayerLogin() {},
    onServerShutdown() {},
    emitCustomEvent: (name, request) => {
      if (name === "diary:is-reward-claimed" && request.diary === "wilderness" && request.tier === "hard") request.claimed = rewardClaimed;
      if (name === "construction:exit-house") {
        exits.push(request);
        if (houseHandles) {
          request.player.moveTo(request.to);
          request.handled = true;
        }
      }
      if (name === "teleport:landed") landed.push(request);
    },
  });
});

beforeEach(() => {
  rewardClaimed = true;
  houseHandles = true;
  exits = [];
  landed = [];
  players = [];
});

afterEach(() => {
  for (const player of players) if (player.isRegistered()) World.getPlayers().removes(player);
});

const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });

/** A real player in a house-like spot (the recording's 1964,5701 plane 2), its packets logged. */
function housePlayer(name) {
  const player = new Player(new PlayerSession(channel()));
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(1964, 5701, 2));
  assert.equal(World.getPlayers().add(player), true);
  player.needsPlacement = false;
  players.push(player);
  const log = [];
  const sender = player.getPacketSender();
  const spy = (method, line) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { log.push(line(...args)); return original(...args); };
  };
  spy("sendVarbit", (id, value) => `varbit ${id}=${value}`);
  spy("sendSubInterface", (uid, id) => `open ${uid === MAIN_MODAL ? "mainmodal" : uid} ${id}`);
  spy("closeSubInterface", (uid) => `close ${uid === MAIN_MODAL ? "mainmodal" : uid}`);
  spy("sendInterfaceDisplayState", (uid, hide) => `hide ${uid >>> 16}:${uid & 0xffff}=${hide}`);
  spy("sendString", (text, uid) => `text ${uid >>> 16}:${uid & 0xffff} ${text}`);
  spy("sendInterfaceFlagsRange", (uid, from, to) => `events ${uid >>> 16}:${uid & 0xffff} ${from}-${to}`);
  spy("sendTypedMessage", (type, message) => `${type === core.ChatType.SPAM ? "spam" : "message"} ${message}`);
  const message = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { log.push(`message ${text}`); return message(text, ...rest); };
  const animate = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { log.push(`seq ${animation.getId()}`); return animate(animation); };
  return { player, log };
}

function tick(n) {
  for (let i = 0; i < n; i++) core.TaskManager.process();
}

function answer(player, sub) {
  const event = { player, groupId: WARNING, childId: 1, action: sub, handled: false };
  T.chooseDestination(event);
  return event;
}

const portalSeq = () => core.CacheDefinitions.getSeqId("human_wilderness_portal");
const onPad = (at, [cx, cy]) => at.getZ() === 0 && at.getX() > cx && at.getX() < cx + 4 && at.getY() > cy && at.getY() < cy + 4;

test("the house obelisk's options (cache: Activate, Teleport to destination, Set destination) are handled here", () => {
  assert.equal(core.CacheDefinitions.getLocId("poh_wilderness_obelisk"), HOUSE_OBELISK);
  for (const option of ["Activate", "Teleport to destination", "Set destination"]) {
    assert.equal(typeof handlers.Obelisk[option], "function", option);
  }
});

test("Activate shows the recorded warning; Enter Wilderness lands on a random obelisk's pad 2 ticks later", (t) => {
  t.mock.method(Math, "random", () => 0.7); // obelisk 4, level 44: the recording's landing pad
  const { player, log } = housePlayer("pohobel1");
  assert.equal(handlers.Obelisk.Activate({ player, objectId: HOUSE_OBELISK }), true);
  assert.deepEqual(log, [
    `varbit ${core.CacheDefinitions.getVarbitId("cws_warning_id")}=7`,
    "open mainmodal 475",
    "hide 475:13=true",
    "text 475:10 The obelisk will teleport you into the <col=ff0000>Wilderness</col>.<br><br>Do you really wish to go there?",
    "events 475:1 0-1",
    "events 475:13 0-0",
  ]);
  assert.equal(player.getInterfaceId(), WARNING);
  log.length = 0;
  assert.equal(answer(player, 1).handled, true);
  assert.deepEqual(log.slice(0, 2), ["close mainmodal", `seq ${portalSeq()}`]);
  tick(1);
  assert.equal(player.getLocation().getX(), 1964, "still home a tick later");
  tick(1);
  // Recorded at +2: the chosen arrival line (spam), the teleport and seq -1.
  assert.ok(log.includes("spam Ancient magic teleports you to a place within the wilderness!"));
  assert.ok(onPad(player.getLocation(), [2978, 3864]), `on level 44's pad, at ${player.getLocation()}`);
  assert.ok(["seq -1", "seq 65535"].includes(log.at(-1)), `the seq reset last, got ${log.at(-1)}`);
  assert.equal(exits.length, 1, "left through the house");
  assert.equal(landed.length, 1);
  assert.equal(landed[0].fromInstance, true);
  assert.equal(T.active.size, 0, "the Wilderness obelisks' stones aren't started");
});

test("Teleport to destination needs the hard diary and a choice, then goes to the set obelisk", () => {
  const { player, log } = housePlayer("pohobel2");
  rewardClaimed = false;
  handlers.Obelisk["Teleport to destination"]({ player, objectId: HOUSE_OBELISK });
  handlers.Obelisk["Set destination"]({ player, objectId: HOUSE_OBELISK });
  assert.equal(log.filter((line) => line.includes("hard Wilderness Diary")).length, 2);
  assert.equal(player.getInterfaceId(), -1);
  rewardClaimed = true;
  handlers.Obelisk["Teleport to destination"]({ player, objectId: HOUSE_OBELISK });
  assert.ok(log.includes("message You haven't set a destination yet."));
  assert.equal(player.getInterfaceId(), -1);
  // Recorded: Set destination opens menu 187; sub 0 is level 13.
  handlers.Obelisk["Set destination"]({ player, objectId: HOUSE_OBELISK });
  assert.equal(player.getInterfaceId(), 187);
  T.chooseDestination({ player, groupId: 187, childId: 3, action: 0, handled: false });
  assert.equal(player.getAttribute("wilderness-obelisks:destination"), 1);
  handlers.Obelisk["Teleport to destination"]({ player, objectId: HOUSE_OBELISK });
  assert.equal(player.getInterfaceId(), WARNING);
  answer(player, 1);
  tick(2);
  assert.ok(onPad(player.getLocation(), [3154, 3618]), `on level 13's pad, at ${player.getLocation()}`);
});

test("Don't go, or closing the warning, teleports nobody", () => {
  const { player } = housePlayer("pohobel3");
  handlers.Obelisk.Activate({ player, objectId: HOUSE_OBELISK });
  assert.equal(answer(player, 0).handled, true);
  assert.equal(player.getInterfaceId(), -1);
  tick(3);
  assert.equal(player.getLocation().getX(), 1964);
  assert.equal(answer(player, 1).handled, false, "a late Enter after the screen is gone does nothing");
  tick(3);
  assert.equal(player.getLocation().getX(), 1964);
  assert.equal(exits.length, 0);
});

test("outside a house the landing is a plain move", () => {
  houseHandles = false;
  const { player } = housePlayer("pohobel4");
  player.setAttribute("wilderness-obelisks:destination", 6);
  handlers.Obelisk["Teleport to destination"]({ player, objectId: HOUSE_OBELISK });
  answer(player, 1);
  tick(2);
  assert.ok(onPad(player.getLocation(), [3305, 3914]), `on level 50's pad, at ${player.getLocation()}`);
  assert.equal(landed[0].fromInstance, false);
});

test("construction:exit-house takes a player in their house out, as the portal does", () => {
  const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
  const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
  ObjectDefinition.init();
  const api = PluginManager.createApi("WildernessObeliskHouseTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  const House = require("../plugins/skills/construction/House.Construction");
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  House.attach(api);
  require("../plugins/modes/ironman/Common.Ironman").init(api);
  require("../plugins/modes/ironman/Setup.Ironman")(api);
  const portal = require("../plugins/skills/construction/Estate.Construction").HOUSE_LOCATIONS.find(({ id }) => id === 6).portal;
  const player = new Player(null);
  const saved = Instance.createDefaultHouseSave();
  saved.location = 6;
  player.setAttribute("construction:house", saved);
  const sender = new Proxy({}, { get: (_target, key) => key === "getVarbit" || key === "getVarp" ? () => 0 : () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.sendMessage = () => {};
  // Yanille's portal, as ardougne-poh-diary.test.cjs enters the house.
  const at = new core.Location(2542, 3097, 0), from = new core.Location(2542, 3096, 0);
  player.moveTo(from);
  PluginManager.emitObjectInteraction({
    player, object: new GameObject(portal, at, 10, 2, null), definition: ObjectDefinition.forId(portal), objectId: portal, clickType: 2,
    location: { x: 2542, y: 3097, z: 0 }, sourceLocation: { x: 2542, y: 3096, z: 0 }, handled: false,
  });
  tick(3);
  assert.ok(House.houseFor(player), "in the house");
  const to = new core.Location(3156, 3620, 0);
  const request = { player, to, handled: false };
  api.emitCustomEvent("construction:exit-house", request);
  assert.equal(request.handled, true);
  assert.equal(House.houseFor(player), null, "out of the house");
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3156, 3620, 0]);
  const outside = { player, to, handled: false };
  api.emitCustomEvent("construction:exit-house", outside);
  assert.equal(outside.handled, false, "not in a house: nothing to leave");
});
