// Run after `yarn build`: node --test tests/sophanem-gates.test.cjs
//
// Sophanem's gates are pass-through gates. The north gate (sophanem_gate_left/right 44036/44038 at
// 3283-3284,2809, face 1) used to swing open into its nameless leaves and stay open; the small east gate
// (sophanem_gate_small 44040 at 3322,2761, face 2) had no open pairing at all, so Open did nothing.
// Live (the user's rsprox capture local 1002026 ticks 2150-2154, rev 242; rsprox.net 331 ticks 1367-1372 and
// 13597-13603, 2660, 2666): Open puts inviswall 38848 on the gate tile(s) and the nameless *_inactive leaves on
// the tile past the gate, sound 69 (grate_open), the player steps across on the first tick after reaching the
// gate, and the gate is back two ticks after it opened.
//
// Real plugins, cache map and Players; input goes through ClientConnection and actual World turns.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test, mock } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MovementQueue } = require("../dist/game/model/movement/MovementQueue");

const LEFT = 44036, LEFT_OPEN = 44037, RIGHT = 44038, RIGHT_OPEN = 44039;
const SMALL = 44040, SMALL_OPEN = 44041, INVISWALL = 38848;
const NORTH_Y = 2809, OUTSIDE_Y = 2810;
const SMALL_X = 3322, SMALL_Y = 2761;

let core;
let next = 5800;
const hookErrors = [];
const originalError = console.error;
console.error = (...args) => { hookErrors.push(args.map(String)); originalError(...args); };

before(async () => {
  const worldConfig = require("../dist/game/definition/WorldDefinition");
  const readConfig = worldConfig.readWorldConfig;
  const config = mock.method(worldConfig, "readWorldConfig", (...args) => {
    const actual = readConfig(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false } };
  });
  try {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
    core = PluginManager.getCoreApi();
    core.ObjectDefinition.init();
    core.RegionManager.init();
    core.RegionManager.loadMapFiles(3283, NORTH_Y);
    core.RegionManager.loadMapFiles(SMALL_X, SMALL_Y);
    PluginManager.emitServerStartup({});
  } finally { config.mock.restore(); }
});
after(() => {
  try { PluginManager.emitServerShutdown({}); }
  finally { console.error = originalError; assert.deepEqual(hookErrors, [], "no runtime hook errors"); }
});

const locAt = (id, x, y) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === 0) return object;
    }
  }
  return null;
};
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const northOpen = () => locAt(LEFT_OPEN, 3283, OUTSIDE_Y) != null && locAt(RIGHT_OPEN, 3284, OUTSIDE_Y) != null
  && locAt(INVISWALL, 3283, NORTH_Y) != null && locAt(INVISWALL, 3284, NORTH_Y) != null;
const northShut = () => locAt(LEFT_OPEN, 3283, OUTSIDE_Y) == null && locAt(RIGHT_OPEN, 3284, OUTSIDE_Y) == null
  && locAt(INVISWALL, 3283, NORTH_Y) == null && locAt(INVISWALL, 3284, NORTH_Y) == null
  && locAt(LEFT, 3283, NORTH_Y) != null && locAt(RIGHT, 3284, NORTH_Y) != null;
const smallOpen = () => locAt(SMALL_OPEN, SMALL_X + 1, SMALL_Y) != null && locAt(INVISWALL, SMALL_X, SMALL_Y) != null;
const smallShut = () => locAt(SMALL_OPEN, SMALL_X + 1, SMALL_Y) == null && locAt(INVISWALL, SMALL_X, SMALL_Y) == null
  && locAt(SMALL, SMALL_X, SMALL_Y) != null;

function nativeActor(t, from, running) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const session = new PlayerSession(channel);
  const player = new Player(session, new core.Location(...from, 0));
  const name = "sophgate" + next++;
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  session.setPlayer(player);
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  player.setRunning(running);
  for (let turns = 0; turns < 3; turns++) core.World.process();
  player.setRunEnergyUnits(9000);
  const sounds = [];
  const sendSound = player.getPacketSender().sendSoundEffect.bind(player.getPacketSender());
  t.mock.method(player.getPacketSender(), "sendSoundEffect", (...args) => {
    sounds.push([core.World.getProcessCycle(), ...args]);
    return sendSound(...args);
  });
  t.after(() => {
    try {
      player.closeInterruptibleInterfaces();
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    } finally {
      core.TaskManager.cancelTasks(player.getIndex());
      core.TaskManager.cancelTasks(player);
      if (player.isRegistered()) core.World.getPlayers().remove(player);
    }
  });
  return { player, connection, sounds };
}

const settle = () => { for (let i = 0; i < 12; i++) core.World.process(); };

async function cross(t, { id, x, y, from, stand, to, running, isOpen, isShut }) {
  settle();
  assert.ok(isShut(), "the gate starts shut");
  const f = nativeActor(t, from, running);
  const sentCycle = core.World.getProcessCycle();
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType: 1 }]);
  let arrivalCycle = from[0] === stand[0] && from[1] === stand[1] ? sentCycle : undefined;
  let openCycle, crossCycle, closeCycle;
  for (let turns = 0; turns < 20 && closeCycle == null; turns++) {
    core.World.process();
    const cycle = core.World.getProcessCycle();
    const position = at(f.player);
    if (arrivalCycle == null && position[0] === stand[0] && position[1] === stand[1]) arrivalCycle = cycle;
    if (isOpen() && openCycle == null) openCycle = cycle;
    if (position[0] === to[0] && position[1] === to[1] && crossCycle == null) crossCycle = cycle;
    if (openCycle != null && isShut()) closeCycle = cycle;
  }
  assert.ok(Number.isInteger(openCycle), "Open swaps in the inviswall and the inactive leaves");
  assert.equal(crossCycle, openCycle, "the player steps across on the opening tick");
  assert.equal(openCycle, arrivalCycle + 1, "the gate opens the tick after the player reaches it");
  assert.equal(closeCycle, openCycle + 2, "the gate is back two ticks after opening and never stays open");
  assert.deepEqual(f.sounds.filter(([, sound]) => sound === 69).map(([cycle]) => cycle), [openCycle],
    "one grate_open (69) on the opening tick");
  assert.equal(f.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), false, "crossing permission is released");
  for (let turns = 0; turns < 4; turns++) core.World.process();
  assert.deepEqual(at(f.player), to, "the player stays across");
  return f;
}

const north = { y: NORTH_Y, isOpen: northOpen, isShut: northShut };
for (const row of [
  { label: "left leaf from outside (as captured, local 1002026)", id: LEFT, x: 3283, from: [3283, 2812], stand: [3283, OUTSIDE_Y], to: [3283, NORTH_Y], running: true },
  { label: "right leaf from outside (as captured, 331)", id: RIGHT, x: 3284, from: [3284, OUTSIDE_Y], stand: [3284, OUTSIDE_Y], to: [3284, NORTH_Y], running: false },
  { label: "left leaf from inside the city", id: LEFT, x: 3283, from: [3283, 2806], stand: [3283, NORTH_Y], to: [3283, OUTSIDE_Y], running: false },
]) {
  test(`north gate: ${row.label} opens it for two ticks and walks the player across`, async (t) => {
    await cross(t, { ...north, ...row });
    const left = locAt(LEFT, 3283, NORTH_Y), right = locAt(RIGHT, 3284, NORTH_Y);
    assert.equal(left.getFace(), 1);
    assert.equal(right.getFace(), 1);
  });
}

test("north gate: the inactive leaves stand on the tiles north, turned as captured", async (t) => {
  settle();
  const f = nativeActor(t, [3283, OUTSIDE_Y], false);
  await f.connection.dispatch([{ type: "object_option", id: LEFT, x: 3283, y: NORTH_Y, clickType: 1 }]);
  for (let turns = 0; turns < 4 && !northOpen(); turns++) core.World.process();
  assert.ok(northOpen());
  assert.equal(locAt(LEFT_OPEN, 3283, OUTSIDE_Y).getFace(), 0);
  assert.equal(locAt(RIGHT_OPEN, 3284, OUTSIDE_Y).getFace(), 2);
  assert.equal(locAt(INVISWALL, 3283, NORTH_Y).getFace(), 1);
  assert.equal(locAt(INVISWALL, 3284, NORTH_Y).getFace(), 1);
  settle();
  assert.ok(northShut());
});

const small = { id: SMALL, x: SMALL_X, y: SMALL_Y, isOpen: smallOpen, isShut: smallShut };
for (const row of [
  { label: "from inside the city (as captured, 331)", from: [3316, SMALL_Y], stand: [SMALL_X, SMALL_Y], to: [SMALL_X + 1, SMALL_Y], running: true },
  { label: "from outside", from: [SMALL_X + 1, SMALL_Y], stand: [SMALL_X + 1, SMALL_Y], to: [SMALL_X, SMALL_Y], running: false },
]) {
  test(`small east gate: ${row.label} opens it for two ticks and walks the player across`, async (t) => {
    await cross(t, { ...small, ...row });
  });
}

test("small east gate: the inactive leaf stands east of the gate, turned a quarter", async (t) => {
  settle();
  const f = nativeActor(t, [SMALL_X, SMALL_Y], false);
  await f.connection.dispatch([{ type: "object_option", id: SMALL, x: SMALL_X, y: SMALL_Y, clickType: 1 }]);
  for (let turns = 0; turns < 4 && !smallOpen(); turns++) core.World.process();
  assert.ok(smallOpen());
  assert.equal(locAt(SMALL_OPEN, SMALL_X + 1, SMALL_Y).getFace(), 3);
  assert.equal(locAt(INVISWALL, SMALL_X, SMALL_Y).getFace(), 2);
  settle();
  assert.ok(smallShut());
});
