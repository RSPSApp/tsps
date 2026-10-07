// Run after `yarn build`: node --test tests/gnome-gliders.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Location } = require("../dist/game/model/Location");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Gliders = require("../plugins/world/GnomeGliders.plugin");

const tasks = [];
Gliders.register({
  getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
  persistAttribute() {},
  onNpcInteraction() {},
  onInterfaceActionClick() {},
  onCustomEvent() {},
  onPlayerLogin() {},
});

let completed = new Set(["The Grand Tree"]);
QuestRuntime.getRegisteredQuests = () =>
  ["The Grand Tree", "One Small Favour", "Monkey Madness II"]
    .filter((name) => name !== "Monkey Madness II" || completed.has("registered:Monkey Madness II"))
    .map((name) => ({ name, isComplete: () => completed.has(name) }));

function createPlayer() {
  const log = [];
  const attributes = new Map();
  let interfaceId = -1;
  let location = new Location(3285, 3212, 0);
  const sender = {
    sendConfig: (id, value) => { log.push(`varp ${id}=${value}`); return sender; },
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    sendInterface: (id) => { interfaceId = id; log.push(`open ${id}`); return sender; },
    sendSubInterface: (_uid, group, _type, options) => {
      log.push(`overlay ${group} fade ${options.postScripts[0].args[1] === 255 ? "out" : "in"}`);
      return sender;
    },
    closeSubInterface: () => { log.push("close overlay"); return sender; },
    sendInterfaceRemoval: () => { log.push(`close ${interfaceId}`); interfaceId = -1; return sender; },
  };
  return {
    log,
    getPacketSender: () => sender,
    getInterfaceId: () => interfaceId,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log.push(message),
    moveTo: (to) => { location = to; log.push(`land ${to.getX()},${to.getY()},${to.getZ()}`); },
    getLocation: () => location,
    getMovementQueue: () => ({ reset() {}, setBlockMovement: (blocked) => log.push(blocked ? "lock" : "unlock") }),
  };
}

function pilot(name, x, y, z = 0, options = ["Glider", null, "Talk-to", null, null]) {
  return {
    npc: { getLocation: () => new Location(x, y, z) },
    definition: { getName: () => name, getActions: () => options },
  };
}

const DALBUR = () => pilot("Captain Dalbur", 3284, 3212);

/** What each tick logs, from the click (tick 0) until the flight's tasks are done. */
function ticks(player, click) {
  tasks.length = 0;
  player.log.length = 0;
  click();
  const out = [player.log.splice(0)];
  while (tasks.some((task) => task.isRunning())) {
    for (const task of tasks.filter((t) => t.isRunning())) task.tick();
    out.push(player.log.splice(0));
  }
  return out;
}

test("the pilots and their options are named as in the cache", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const names = new Map();
  const options = new Set();
  for (let id = 0; id < 20000; id++) {
    const npc = CacheDefinitions.getNpc(id);
    if (!npc?.actions?.includes("Glider")) continue;
    names.set(npc.name, true);
    for (const action of npc.actions) if (action?.startsWith("Glider-to ")) options.add(action);
  }
  for (const destination of Gliders._test.DESTINATIONS) {
    for (const name of destination.pilots) assert.ok(names.has(name), `${name} has a Glider option`);
    assert.ok(options.has(`Glider-to ${destination.name}`), destination.name);
  }
});

test("as captured (Al Kharid to White Wolf Mountain): map, then journey + fade, land, last destination + fade-in, close", () => {
  completed = new Set(["The Grand Tree"]);
  const player = createPlayer();
  const opened = ticks(player, () => Gliders._test.openMap({ player, ...DALBUR() }));
  assert.deepEqual(opened, [["open 138"], ["varbit 12393=1"]], "busy a tick after the map opens");
  const flight = ticks(player, () => Gliders._test.chooseDestination({ player, buttonId: (138 << 16) | 7 }));
  assert.deepEqual(flight, [
    ["lock", "varp 153=32772", "overlay 174 fade out"],
    ["land 2850,3498,0"],
    [],
    ["varbit 9584=4", "overlay 174 fade in"],
    ["varp 153=-1", "varbit 12393=0", "close overlay", "close 138", "unlock"],
  ]);
  assert.equal(player.getAttribute("gnome-gliders:previous"), 4);
});

test("as captured (quick glide to Lemanto Andra): the map opens with the fade on the click tick; busy a tick later", () => {
  const player = createPlayer();
  const quick = pilot("Captain Dalbur", 3284, 3212, 0, ["Glider", null, "Talk-to", "Glider-to Lemanto Andra", null]);
  const flight = ticks(player, () => Gliders._test.quickGlide({ player, clickType: 4, ...quick }));
  assert.deepEqual(flight[0], ["lock", "varp 153=32771", "open 138", "overlay 174 fade out"]);
  assert.deepEqual(flight[1], ["varbit 12393=1", "land 3320,3430,0"]);
  assert.equal(flight.length, 5);
});

test("from the Grand Tree (plane 3) to Varrock, and a stray Captain Errdo far from a glider is not a pilot", () => {
  const player = createPlayer();
  Gliders._test.openMap({ player, ...pilot("Captain Errdo", 2464, 3501, 3) });
  const flight = ticks(player, () => Gliders._test.chooseDestination({ player, buttonId: (138 << 16) | 10 }));
  assert.deepEqual(flight[0].slice(1, 2), ["varp 153=3"], "pilot_journey 3 = from 0 to 3, as captured");
  assert.equal(Gliders._test.openMap({ player, ...pilot("Captain Errdo", 2918, 3057) }), false);
});

test("The Grand Tree is needed; Feldip Hills and Ape Atoll stay shut without their quests", () => {
  completed = new Set();
  const player = createPlayer();
  ticks(player, () => Gliders._test.openMap({ player, ...DALBUR() }));
  assert.deepEqual(player.log, []);
  assert.equal(player.getInterfaceId(), -1);

  completed = new Set(["The Grand Tree"]);
  Gliders._test.openMap({ player, ...DALBUR() });
  for (const button of [21, 25]) {
    assert.deepEqual(ticks(player, () => Gliders._test.chooseDestination({ player, buttonId: (138 << 16) | button })), [[]]);
  }
  assert.deepEqual(ticks(player, () => Gliders._test.chooseDestination({ player, buttonId: (138 << 16) | 13 })), [[]], "not to where you already are");
});

test("as captured (landing on Ape Atoll): its pilot's varbits are set with the close", () => {
  completed = new Set(["The Grand Tree", "Monkey Madness II", "registered:Monkey Madness II"]);
  const player = createPlayer();
  Gliders._test.openMap({ player, ...pilot("Captain Klemfoodle", 2970, 2973) });
  const flight = ticks(player, () => Gliders._test.chooseDestination({ player, buttonId: (138 << 16) | 25 }));
  assert.deepEqual(flight[0].slice(1, 2), ["varp 153=16390"]);
  assert.deepEqual(flight.at(-1).slice(0, 4), ["varp 153=-1", "varbit 12393=0", "varbit 9576=1", "varbit 9575=6"]);
  player.log.length = 0;
  Gliders._test.restoreVarbits({ player });
  assert.deepEqual(player.log, ["varbit 9584=6", "varbit 9576=1", "varbit 9575=6"], "both restored on login");
});

test("closing the map without flying clears busy", () => {
  completed = new Set(["The Grand Tree"]);
  const player = createPlayer();
  Gliders._test.openMap({ player, ...DALBUR() });
  player.log.length = 0;
  Gliders._test.mapClosed({ player, interfaceId: 138 });
  assert.deepEqual(player.log, ["varbit 12393=0"]);
  assert.deepEqual(ticks(player, () => Gliders._test.chooseDestination({ player, buttonId: (138 << 16) | 7 })), [[]]);
});
