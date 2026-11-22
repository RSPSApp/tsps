// Run after `yarn build`: node --test tests/brain-living-lower-door.test.cjs
// rsprox 3032 (rev 231), ticks 4905-4910 and 5074-5076: east-west crossing, sound 62,
// immediate in-reach Open, approach Open two ticks after arrival, and restore two ticks later.
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

const DOOR = { id: 22007, x: 3817, y: 2841, z: 0 };
const OPEN = 21953;
const INVISWALL = 38848;
let core;
let next = 6100;
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
    core.RegionManager.loadMapFiles(DOOR.x, DOOR.y);
    PluginManager.emitServerStartup({});
  } finally { config.mock.restore(); }
});

after(() => {
  try { PluginManager.emitServerShutdown({}); }
  finally { console.error = originalError; assert.deepEqual(hookErrors, [], "no runtime hook errors"); }
});

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const locAt = (id, x, y) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === DOOR.z) return object;
    }
  }
  return null;
};
const isOpen = () => locAt(INVISWALL, DOOR.x, DOOR.y) != null && locAt(OPEN, DOOR.x - 1, DOOR.y) != null
  && locAt(DOOR.id, DOOR.x, DOOR.y) == null;
const isShut = () => locAt(DOOR.id, DOOR.x, DOOR.y) != null && locAt(INVISWALL, DOOR.x, DOOR.y) == null
  && locAt(OPEN, DOOR.x - 1, DOOR.y) == null;

function nativeActor(t, from, running = false) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const session = new PlayerSession(channel);
  const player = new Player(session, new core.Location(...from, DOOR.z));
  const name = "livingdoor" + next++;
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
  const sender = player.getPacketSender();
  const sendSound = sender.sendSoundEffect.bind(sender);
  t.mock.method(sender, "sendSoundEffect", (...args) => {
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

async function openAndCross(t, { from, to, running = false, approached = false }) {
  settle();
  assert.ok(isShut(), "door starts shut");
  const f = nativeActor(t, from, running);
  const inputCycle = core.World.getProcessCycle();
  await f.connection.dispatch([{ type: "object_option", id: DOOR.id, x: DOOR.x, y: DOOR.y, clickType: 1 }]);
  let arrivalCycle = approached ? undefined : inputCycle;
  let openCycle, crossCycle, closeCycle;
  for (let turns = 0; turns < 20 && closeCycle == null; turns++) {
    core.World.process();
    const cycle = core.World.getProcessCycle();
    const position = at(f.player);
    if (arrivalCycle == null && position[0] === DOOR.x - 1 && position[1] === DOOR.y) arrivalCycle = cycle;
    if (isOpen() && openCycle == null) openCycle = cycle;
    if (position[0] === to[0] && position[1] === to[1] && crossCycle == null) crossCycle = cycle;
    if (openCycle != null && isShut()) closeCycle = cycle;
  }
  assert.ok(Number.isInteger(openCycle), "Open swaps the door locs");
  assert.equal(crossCycle, openCycle, "the player crosses on the opening tick");
  assert.equal(openCycle, arrivalCycle + (approached ? 2 : 1), approached
    ? "a walked approach opens two ticks after arrival" : "an in-reach click opens on its input tick");
  assert.equal(closeCycle, openCycle + 2, "the closed loc returns two ticks after opening");
  assert.deepEqual(f.sounds.filter(([, id]) => id === 62).map(([cycle]) => cycle), [openCycle],
    "one door_open (62) on the opening tick");
  settle();
  assert.deepEqual(at(f.player), to, "the player remains on the opposite side");
  assert.ok(isShut());
}

test("Living lower door: west-side Open crosses east through the west edge", async (t) => {
  await openAndCross(t, { from: [DOOR.x - 1, DOOR.y], to: [DOOR.x, DOOR.y] });
});

test("Living lower door: east-side in-reach Open crosses west on the input tick", async (t) => {
  await openAndCross(t, { from: [DOOR.x, DOOR.y], to: [DOOR.x - 1, DOOR.y] });
});

test("Living lower door: running approach opens two ticks after arrival", async (t) => {
  await openAndCross(t, { from: [DOOR.x - 1, DOOR.y + 3], to: [DOOR.x, DOOR.y], running: true, approached: true });
});
