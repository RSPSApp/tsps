// Run after `yarn build`: node --test tests/wilderness-obelisks.test.cjs
//
// The Wilderness obelisks against rsprox recording 3886 (Set Destination, Teleport to
// Destination) and the OSRS Wiki (Wilderness_Obelisk): the menu, the saved choice, the recorded
// tick sequence, the pad, Tele Block, the first activator's rule and the diary gate.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const Obelisks = require("../plugins/areas/WildernessObelisks.plugin");
const T = Obelisks._test;

let core, players, locs, rewardClaimed, handlers;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  World.getPlayers = () => players;
  ObjectManager.register = (object) => locs.push(`${object.getId()}@${object.getLocation().getX()},${object.getLocation().getY()}`);
  ObjectManager.deregister = () => {};
  MapObjects.get = () => null;
  handlers = {};
  Obelisks.register({
    core,
    persistAttribute() {},
    onObjectInteraction: (name, options) => { handlers[name] = options; },
    onInterfaceActionClick() {},
    onCustomEvent() {},
    onPlayerLogin() {},
    onServerShutdown() {},
    emitCustomEvent: (name, request) => {
      if (name === "diary:is-reward-claimed" && request.diary === "wilderness" && request.tier === "hard") request.claimed = rewardClaimed;
    },
  });
});

beforeEach(() => {
  players = [];
  locs = [];
  rewardClaimed = true;
  T.active.clear();
});

function fakePlayer(at, { teleblocked = false } = {}) {
  let tile = new core.Location(at[0], at[1], 0);
  const player = {
    attributes: {}, log: [], interfaceId: -1,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; player.log.push(`move ${to.getX()},${to.getY()}`); },
    isRegistered: () => true,
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    sendMessage: (m) => player.log.push(`message ${m}`),
    setInterfaceId: (id) => { player.interfaceId = id; },
    getInterfaceId: () => player.interfaceId,
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => !teleblocked }) }),
    getPacketSender: () => ({
      sendSound: (id, volume, delay) => player.log.push(`synth ${id} delay ${delay}`),
      sendAreaSound: (id, x, y, z, loops, delay, radius) => player.log.push(`area ${id} ${x},${y} r${radius}`),
      sendGraphic: (graphic, location) => player.log.push(`anim ${graphic.getId()} h${graphic.getHeight()} ${location.getX()},${location.getY()}`),
      sendClientScript: (id, ...args) => player.log.push(`script ${id} ${JSON.stringify(args)}`),
      sendVarbit: (id, value) => player.log.push(`varbit ${id}=${value}`),
      sendInterfaceScript() {}, sendSubInterface: (uid, id) => player.log.push(`open ${id}`), closeSubInterface() {}, sendInterfaceFlagsRange() {},
      sendTypedMessage: (type, m) => player.log.push(`${type === core.ChatType.SPAM ? "spam" : "message"} ${m}`),
    }),
  };
  players.push(player);
  return player;
}

function tick(n) {
  for (let i = 0; i < n; i++) core.TaskManager.process();
}

const LEVEL_13 = 14829;
const choiceVarbit = () => core.CacheDefinitions.getVarbitId("wilderness_portal_choice");

test("Set Destination opens the recorded menu; the choice is wilderness_portal_choice and saved", () => {
  const player = fakePlayer([3156, 3620]);
  handlers.Obelisk["Set Destination"]({ player, objectId: LEVEL_13 });
  assert.ok(player.log.includes("open 187"));
  assert.ok(player.log.includes(`script 217 ${JSON.stringify(["Select Obelisk destination",
    "Level 13 Wilderness|Level 19 Wilderness|Level 27 Wilderness|Level 35 Wilderness|Level 44 Wilderness|Level 50 Wilderness", 1])}`));
  const event = { player, groupId: 187, childId: 3, action: 5, handled: false };
  T.chooseDestination(event);
  assert.equal(event.handled, true);
  assert.ok(player.log.includes(`varbit ${choiceVarbit()}=6`), "recorded: sub 5 -> 6");
  assert.equal(player.attributes["wilderness-obelisks:destination"], 6);
});

test("Teleport to Destination plays the recorded sequence and lands on the chosen pad", () => {
  const player = fakePlayer([3156, 3620]);
  player.attributes["wilderness-obelisks:destination"] = 6;
  handlers.Obelisk["Teleport to Destination"]({ player, objectId: LEVEL_13 });
  assert.deepEqual(locs, ["14825@3154,3618", "14825@3158,3618", "14825@3154,3622", "14825@3158,3622"]);
  assert.deepEqual(player.log.filter((line) => line.startsWith("synth")), Array(4).fill("synth 204 delay 10"));
  player.log.length = 0;
  locs.length = 0;
  tick(7);
  assert.deepEqual(player.log, ["anim 86 h124 3156,3619", "area 1930 3156,3619 r7"]);
  tick(3);
  assert.deepEqual(locs, ["14829@3154,3618", "14829@3158,3618", "14829@3154,3622", "14829@3158,3622"], "the stones back at 10");
  tick(1);
  assert.equal(player.log.filter((line) => line.startsWith("anim 661 h92")).length, 9, "the portal on the nine pad tiles at 11");
  tick(1);
  assert.equal(player.log.some((line) => line.startsWith("move")), false);
  tick(1);
  // rsprox 236/03931.txt:45746: spam.
  assert.ok(player.log.includes("spam Ancient magic teleports you to a place within the wilderness!"));
  const at = player.getLocation();
  assert.ok(at.getX() >= 3306 && at.getX() <= 3308 && at.getY() >= 3915 && at.getY() <= 3917, "on level 50's pad");
});

test("everyone on the pad goes; a Tele Blocked player stays and is told; someone beside the pad stays", () => {
  const activator = fakePlayer([3155, 3619]);
  const rider = fakePlayer([3157, 3621]);
  const blocked = fakePlayer([3156, 3620], { teleblocked: true });
  const beside = fakePlayer([3154, 3620]);
  const dead = fakePlayer([3156, 3621]);
  dead.getHitpoints = () => 0;
  T.activate(activator, 0, 1, false);
  tick(13);
  for (const traveller of [activator, rider]) {
    assert.ok(traveller.log.includes("spam Ancient magic teleports you somewhere in the Wilderness!"));
    assert.ok(traveller.getLocation().getY() > 3660, "at level 19");
  }
  assert.ok(blocked.log.includes("message A magical spell is blocking you from teleporting."));
  assert.equal(blocked.getLocation().getY(), 3620);
  assert.equal(beside.getLocation().getX(), 3154);
  assert.equal(dead.getLocation().getY(), 3621, "a player dying on the pad stays");
});

test("while it's going, another click changes nothing: the first activator's rules", () => {
  const first = fakePlayer([3156, 3620]);
  const second = fakePlayer([3156, 3621]);
  second.attributes["wilderness-obelisks:destination"] = 6;
  assert.equal(T.activate(first, 0, 1, false), true);
  handlers.Obelisk["Teleport to Destination"]({ player: second, objectId: LEVEL_13 });
  tick(13);
  assert.ok(second.getLocation().getY() > 3660 && second.getLocation().getY() < 3700, "level 19, the first player's");
});

test("Activate may send the players back to the same obelisk (Wiki)", (t) => {
  t.mock.method(Math, "random", () => 0);
  const player = fakePlayer([3156, 3620]);
  handlers.Obelisk.Activate({ player, objectId: LEVEL_13 });
  tick(13);
  const at = player.getLocation();
  assert.ok(at.getX() >= 3155 && at.getX() <= 3157 && at.getY() >= 3619 && at.getY() <= 3621);
});

test("Set and Teleport to Destination need the hard Wilderness Diary, and a destination set", () => {
  rewardClaimed = false;
  const player = fakePlayer([3156, 3620]);
  handlers.Obelisk["Set Destination"]({ player, objectId: LEVEL_13 });
  handlers.Obelisk["Teleport to Destination"]({ player, objectId: LEVEL_13 });
  assert.equal(player.log.filter((line) => line.includes("hard Wilderness Diary")).length, 2);
  assert.equal(T.active.size, 0);
  rewardClaimed = true;
  handlers.Obelisk["Teleport to Destination"]({ player, objectId: LEVEL_13 });
  assert.ok(player.log.includes("message You haven't set a destination yet."));
  assert.equal(T.active.size, 0);
  assert.equal(handlers.Obelisk.Activate({ player, objectId: 31554 }), false, "the house's obelisk isn't one of these");
  const stray = { getLocation: () => new core.Location(4091, 4312, 0) };
  assert.equal(handlers.Obelisk.Activate({ player, objectId: 14826, object: stray }), false, "the map's stray copy of level 44's stones");
});

test("a player who logs out or steps off the pad before the teleport stays behind", () => {
  const activator = fakePlayer([3156, 3620]);
  const leaver = fakePlayer([3156, 3621]);
  const walker = fakePlayer([3157, 3621]);
  T.activate(activator, 0, 1, false);
  tick(6);
  leaver.isRegistered = () => false;
  walker.moveTo(new core.Location(3160, 3625, 0));
  tick(7);
  assert.ok(activator.getLocation().getY() > 3660, "the activator still goes");
  assert.equal(leaver.getLocation().getY(), 3621);
  assert.equal(walker.getLocation().getY(), 3625);
});

test("a shutdown mid-activation puts the stones back and ends it, so none is left going", () => {
  const activator = fakePlayer([3156, 3620]);
  T.activate(activator, 0, 1, false);
  tick(2);
  locs.length = 0;
  T.resetActive();
  assert.equal(T.active.size, 0);
  assert.deepEqual(locs, T.stones(T.data.obelisks[0]).map(([x, y]) => `${LEVEL_13}@${x},${y}`), "the four stones are the obelisk again");
  tick(11);
  assert.equal(activator.getLocation().getY(), 3620, "the cancelled activation teleports nobody");
});
