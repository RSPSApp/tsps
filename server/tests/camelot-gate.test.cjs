// Run after `yarn build`: node --test tests/camelot-gate.test.cjs
//
// #6003: the Camelot castle grounds gate (kr_camelot_metalgateclosedl/r 26081/26082 at 2757-2758,3482, face 1)
// opened into its nameless open leaves (26083/26084) and stayed open, so the client showed "Close null" (debug
// ids on) or no menu at all. Capture242/911979 ticks16536-16541,17415-17419 and17539-17543:
// Open puts inviswall38848 on both gate tiles and
// the open leaves on the tiles north (left rotation 0, right rotation 2), sound 69 (grate_open), the player
// steps across in the same tick, and the gate is back two ticks later.
//
// Real plugins/cache and Players. Queued protocol-input cases run ClientConnection through actual World turns;
// the retained legacy cases use ObjectActionPacketListener and the authoritative pursuit/movement/task order.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test, mock } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Direction } = require("../dist/game/model/Direction");
const { MovementQueue } = require("../dist/game/model/movement/MovementQueue");

const LEFT = 26081, RIGHT = 26082, LEFT_OPEN = 26083, RIGHT_OPEN = 26084, INVISWALL = 38848;
const GATE_Y = 3482, NORTH_Y = 3483;

let core;
let next = 5700;
const players = [];
const routeOverrides = new WeakMap();
const observedRoutes = new WeakMap();
function fixtureRouteContract(event) {
  const observed = observedRoutes.get(event.player);
  if (observed) observed.push({ clickType: event.clickType, operateBeforeMovement: event.operateBeforeMovement });
  const override = routeOverrides.get(event.player);
  if (override) Object.assign(event, override);
}
const hookErrors = [];
const originalError = console.error;
console.error = (...args) => { hookErrors.push(args.map(String)); originalError(...args); };

before(async () => {
  const worldConfig = require("../dist/game/definition/WorldDefinition");
  const readConfig = worldConfig.readWorldConfig;
  // Exercise real gameplay startup while keeping the unrelated HTTP admin listener out of this process.
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
  core.RegionManager.loadMapFiles(2757, GATE_Y);
  PluginManager.emitServerStartup({});
  PluginManager.createApi("CamelotRouteContractTest").onObjectRoute(fixtureRouteContract);
  } finally { config.mock.restore(); }
});
after(() => {
  try { PluginManager.emitServerShutdown({}); }
  finally { console.error = originalError; assert.deepEqual(hookErrors, [], "no runtime hook errors"); }
});

function actor(t, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("camelotgate" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const sounds = [];
  t.mock.method(player.getPacketSender(), "sendSoundEffect", (...args) => {
    sounds.push(args);
    return player.getPacketSender();
  });
  return { player, sounds };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().beginCycle();
      player.getMovementQueue().processEntityPursuit();
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

function until(condition, limit = 12) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

const locAt = (id, x, y) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === 0) return object;
    }
  }
  return null;
};
const isOpen = () => locAt(LEFT_OPEN, 2757, NORTH_Y) != null && locAt(RIGHT_OPEN, 2758, NORTH_Y) != null;
const isShut = () => locAt(LEFT_OPEN, 2757, NORTH_Y) == null && locAt(RIGHT_OPEN, 2758, NORTH_Y) == null
  && locAt(INVISWALL, 2757, GATE_Y) == null && locAt(INVISWALL, 2758, GATE_Y) == null
  && locAt(LEFT, 2757, GATE_Y) != null && locAt(RIGHT, 2758, GATE_Y) != null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id, x) => new ObjectActionPacketListener().executeAction(player, id, x, GATE_Y, 1);
const settle = () => tick(12);

function nativeActor(t, from, running) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const session = new PlayerSession(channel);
  const player = new Player(session, new core.Location(...from, 0));
  const name = "camelotnative" + next++;
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  session.setPlayer(player);
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  player.setRunning(running);
  // Settle actual registered-player placement before measuring any input.
  for (let turns = 0; turns < 3; turns++) core.World.process();
  assert.equal(player.isNeedsPlacement(), false);
  assert.equal(player.busy(), false);
  player.setRunEnergyUnits(9000);
  const sounds = [];
  const snapshots = [];
  const sendSound = player.getPacketSender().sendSoundEffect.bind(player.getPacketSender());
  t.mock.method(player.getPacketSender(), "sendSoundEffect", (...args) => {
    sounds.push([core.World.getProcessCycle(), ...args]);
    return sendSound(...args);
  });
  const resetUpdating = player.resetUpdating.bind(player);
  t.mock.method(player, "resetUpdating", () => {
    // Read the actual movement result before normal end-of-sync clearing, then run that owner unchanged.
    snapshots.push({ cycle: core.World.getProcessCycle(), position: at(player),
      walking: player.getWalkingDirection().getId(), running: player.getRunningDirection().getId(),
      moved: player.getMovementQueue().didMoveThisCycle(), ran: player.getMovementQueue().didRunThisCycle(),
      energy: player.getRunEnergyUnits(), forceAbsent: player.getForceMovement() == null,
      placement: player.isNeedsPlacement(), ignoreClipping: player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG) });
    return resetUpdating();
  });
  t.after(() => {
    try {
      player.closeInterruptibleInterfaces();
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    } finally {
      core.TaskManager.cancelTasks(player.getIndex());
      core.TaskManager.cancelTasks(player);
      if (player.isRegistered()) core.World.getPlayers().remove(player);
      routeOverrides.delete(player);
      observedRoutes.delete(player);
    }
    assert.equal(player.isRegistered(), false);
    assert.equal(core.TaskManager.hasWalkToTask(player.getIndex()), false);
  });
  return { player, connection, sounds, snapshots };
}

for (const row of [
  { label: "adjacent left north", id: LEFT, x: 2757, from: [2757, GATE_Y], to: [2757, NORTH_Y], running: false },
  { label: "walking right north approach", id: RIGHT, x: 2758, from: [2758, 3479], to: [2758, NORTH_Y], running: false },
  { label: "adjacent left south", id: LEFT, x: 2757, from: [2757, NORTH_Y], to: [2757, GATE_Y], running: true },
  { label: "running right south approach", id: RIGHT, x: 2758, from: [2761, 3486], to: [2758, GATE_Y], running: true },
]) {
  test(`queued native World input: ${row.label} opens and walks across on one cycle`, async (t) => {
    settle();
    assert.ok(isShut());
    const f = nativeActor(t, row.from, row.running);
    const sentCycle = core.World.getProcessCycle();
    await f.connection.dispatch([{ type: "object_option", id: row.id, x: row.x, y: GATE_Y, clickType: 1 }]);
    assert.ok(isShut(), "input is queued until the owner's World turn");
    assert.deepEqual(at(f.player), row.from, "dispatch does not move or directly execute the gate");
    let openCycle, crossCycle, closeCycle;
    const stand = [row.x, row.to[1] === NORTH_Y ? GATE_Y : NORTH_Y];
    let arrivalCycle = row.from[0] === stand[0] && row.from[1] === stand[1] ? sentCycle : undefined;
    const timeline = [];
    for (let turns = 0; turns < 16 && closeCycle == null; turns++) {
      const energyBefore = f.player.getRunEnergyUnits();
      core.World.process();
      const cycle = core.World.getProcessCycle();
      const position = at(f.player);
      const opened = isOpen();
      timeline.push({ cycle, position, opened, energyBefore, energy: f.player.getRunEnergyUnits() });
      if (arrivalCycle == null && position[0] === stand[0] && position[1] === stand[1]) arrivalCycle = cycle;
      if (opened && openCycle == null) openCycle = cycle;
      if (position[0] === row.to[0] && position[1] === row.to[1] && crossCycle == null) crossCycle = cycle;
      if (openCycle != null && isShut()) closeCycle = cycle;
    }
    console.log("CAMELOT_NATIVE_TIMELINE", JSON.stringify({ label: row.label, sentCycle, openCycle, crossCycle, closeCycle, timeline }));
    assert.ok(Number.isInteger(openCycle), "actual native input opened both leaves");
    assert.ok(Number.isInteger(crossCycle), "actual movement queue crossed the gate");
    assert.equal(crossCycle, openCycle, "recorded opening and ordinary crossing share a world cycle");
    assert.equal(openCycle, arrivalCycle + 1, "opening is the first owner turn after reaching the gate, without an extra task delay");
    assert.equal(closeCycle, openCycle + 2, "both leaves restore two world cycles after opening");
    assert.deepEqual(f.sounds.filter(([, id]) => id === 69).map(([cycle]) => cycle), [openCycle], "one opening sound on that cycle");
    const crossing = f.snapshots.find((frame) => frame.cycle === crossCycle);
    assert.ok(crossing, "actual pre-reset movement result was observed");
    assert.equal(crossing.walking, (row.to[1] === NORTH_Y ? Direction.NORTH : Direction.SOUTH).getId());
    assert.equal(crossing.running, Direction.NONE.getId(), "one ordinary walking step even after a running approach");
    assert.equal(crossing.moved, true);
    assert.equal(crossing.ran, false);
    assert.equal(crossing.energy - timeline.find((frame) => frame.cycle === crossCycle).energyBefore,
      MovementQueue.runEnergyRestoreUnits(f.player), "walking recovery runs once, without a second movement/energy pass");
    assert.equal(crossing.forceAbsent, true, "undefined/null both mean no force movement on the actual owner");
    assert.equal(crossing.placement, false, "the crossing itself was not placement");
    assert.equal(crossing.ignoreClipping, true, "only the opener owns temporary crossing permission");
    assert.equal(f.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), false, "temporary crossing permission is released");
    assert.equal(f.player.getForceMovement() == null, true, "crossing uses ordinary walking");
    assert.equal(f.player.isNeedsPlacement(), false, "crossing is not a placement/teleport");
  });
}

test("two actors and repeated input do not extend restoration or grant a bystander clipping", async (t) => {
  settle();
  const first = nativeActor(t, [2757, GATE_Y], false);
  const second = nativeActor(t, [2758, GATE_Y], false);
  await first.connection.dispatch([
    { type: "object_option", id: LEFT, x: 2757, y: GATE_Y, clickType: 1 },
    { type: "object_option", id: LEFT, x: 2757, y: GATE_Y, clickType: 1 },
  ]);
  core.World.process();
  const opened = core.World.getProcessCycle();
  assert.equal(isOpen(), true);
  assert.deepEqual(at(first.player), [2757, NORTH_Y]);
  assert.deepEqual(at(second.player), [2758, GATE_Y]);
  assert.equal(second.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), false);
  assert.equal(second.player.getMovementQueue().canWalkTo(new core.Location(2758, NORTH_Y, 0)), false,
    "the open gate's invisible wall still blocks the bystander");
  await second.connection.dispatch([{ type: "object_option", id: RIGHT, x: 2758, y: GATE_Y, clickType: 1 }]);
  core.World.process();
  assert.equal(isOpen(), true);
  core.World.process();
  assert.equal(core.World.getProcessCycle(), opened + 2);
  assert.equal(isShut(), true, "later input does not replace the original shared close owner");
  core.World.process();
  assert.equal(first.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), false);
  assert.equal(second.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), false);
  assert.equal([...first.sounds, ...second.sounds].filter(([, id]) => id === 69).length, 1);
});

test("crossing releases only its own temporary clipping flag", async (t) => {
  settle();
  const f = nativeActor(t, [2757, GATE_Y], false);
  f.player.setFlag(MovementQueue.IGNORE_CLIPPING_FLAG, true);
  t.after(() => f.player.removeFlag(MovementQueue.IGNORE_CLIPPING_FLAG));
  await f.connection.dispatch([{ type: "object_option", id: LEFT, x: 2757, y: GATE_Y, clickType: 1 }]);
  for (let turns = 0; turns < 4; turns++) core.World.process();
  assert.deepEqual(at(f.player), [2757, NORTH_Y]);
  assert.equal(isShut(), true);
  assert.equal(f.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), true, "an existing owner's flag survives gate cleanup");
});

for (const [label, timer, opens] of [["freeze", "FREEZE", true], ["stun", "STUN", false]]) {
  test(`existing ${label} mobility policy cannot be bypassed by pre-movement operation`, async (t) => {
    settle();
    const f = nativeActor(t, [2757, GATE_Y], false);
    f.player.getTimers().registers(core.TimerKey[timer], 10);
    await f.connection.dispatch([{ type: "object_option", id: LEFT, x: 2757, y: GATE_Y, clickType: 1 }]);
    core.World.process();
    assert.equal(isOpen(), opens, "reachable frozen operations remain allowed; a stun refuses the existing route");
    for (let turns = 0; turns < 4; turns++) core.World.process();
    assert.deepEqual(at(f.player), [2757, GATE_Y], "no movement lock is bypassed");
    assert.equal(isShut(), true);
    assert.equal(f.player.hasFlag(MovementQueue.IGNORE_CLIPPING_FLAG), false);
    assert.ok(f.snapshots.every((frame) => frame.ran === false));
  });
}

test("real item-on-object input retains the default clickType0 route", async (t) => {
  settle();
  const f = nativeActor(t, [2757, GATE_Y], false);
  f.player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  const slot = f.player.getInventory().getItems().findIndex((item) => item.getId() === core.ItemIdentifiers.ROPE);
  const routes = [];
  observedRoutes.set(f.player, routes);
  await f.connection.dispatch([{ type: "item_on_object", widgetId: Inventory.INTERFACE_ID,
    objectId: LEFT, itemId: core.ItemIdentifiers.ROPE, slot, x: 2757, y: GATE_Y }]);
  core.World.process();
  assert.deepEqual(routes, [{ clickType: 0, operateBeforeMovement: undefined }]);
  assert.equal(isOpen(), false, "using an ordinary item is not an Open operation");
  assert.deepEqual(at(f.player), [2757, GATE_Y]);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ROPE), 1);
});

for (const [label, override, from, afterFirst] of [
  ["destination", { destination: { x: 2757, y: 3481, z: 0 } }, [2757, GATE_Y], [2757, 3481]],
  ["approach range", { approachRange: 1 }, [2757, 3480], [2757, 3481]],
]) {
  test(`an explicit ${label} retains precedence over the pre-movement capability`, async (t) => {
    settle();
    const f = nativeActor(t, from, false);
    routeOverrides.set(f.player, override);
    await f.connection.dispatch([{ type: "object_option", id: LEFT, x: 2757, y: GATE_Y, clickType: 1 }]);
    core.World.process();
    assert.deepEqual(at(f.player), afterFirst, "ordinary override route moves once before its operation");
    if (label === "approach range") {
      assert.equal(isOpen(), true, "existing approach operation runs after reaching its range this turn");
      assert.equal(f.sounds.filter(([, id]) => id === 69).length, 1);
    } else {
      assert.equal(isOpen(), false, "destination override is not operated before its route resolves");
    }
  });
}

for (const [label, transition] of [
  ["bank modal", (p) => p.getBank(0).open()],
  ["death", (p) => p.setHitpoints(0)],
  ["near-gate teleport placement", (p) => p.moveTo(p.getLocation().clone())],
  ["near-gate teleport after placement reset", (p) => {
    p.moveTo(p.getLocation().clone());
    // Use the actual end-of-sync owner to expose a stale operation even after placement has cleared.
    // This is a controlled lifecycle seam, not a claim that these owner calls are native inputs.
    p.resetUpdating();
    assert.equal(p.isNeedsPlacement(), false);
  }],
]) {
  test(`queued Camelot operation is canceled by an intervening ${label}`, async (t) => {
    settle();
    const f = nativeActor(t, [2757, GATE_Y], false);
    const serial = f.player.getTeleportSerial();
    let changed = false;
    // The network-turn seam forwards real input, then applies a real lifecycle owner before pursuit.
    f.player.getSession().setTurnPacketProcessor(() => {
      f.connection.processTurnPackets();
      if (changed) return;
      changed = true;
      transition(f.player);
    });
    await f.connection.dispatch([{ type: "object_option", id: LEFT, x: 2757, y: GATE_Y, clickType: 1 }]);
    core.World.process();
    if (label.startsWith("near-gate")) assert.ok(f.player.getTeleportSerial() > serial);
    assert.equal(isOpen(), false, "invalidated input must not open the gate");
    assert.deepEqual(at(f.player), [2757, GATE_Y], "invalidated input must not cross");
    assert.equal(core.TaskManager.hasWalkToTask(f.player.getIndex()), false, "old input is canceled, not deferred");
    assert.deepEqual(f.sounds.filter(([, id]) => id === 69), []);
  });
}

for (const [label, id, x] of [["left", LEFT, 2757], ["right", RIGHT, 2758]]) {
  test(`as captured: the ${label} leaf opens the gate for two ticks and the player steps north through it`, (t) => {
    settle();
    assert.ok(isShut(), "the gate starts shut");
    const { player, sounds } = actor(t, x, GATE_Y);
    click(player, id, x);
    assert.ok(until(isOpen, 4), "both leaves swing open onto the tiles north");
    // Live steps across on the swap's own tick (242/911979 tick17417).
    assert.deepEqual(at(player), [x, NORTH_Y], "the player crosses on the opening tick");
    assert.equal(locAt(LEFT_OPEN, 2757, NORTH_Y).getFace(), 0);
    assert.equal(locAt(RIGHT_OPEN, 2758, NORTH_Y).getFace(), 2);
    assert.ok(locAt(INVISWALL, 2757, GATE_Y) && locAt(INVISWALL, 2758, GATE_Y), "inviswall on both gate tiles");
    assert.ok(sounds.some(([id]) => id === 69), "grate_open (69)");
    tick();
    assert.deepEqual(at(player), [x, NORTH_Y], "the player is through a tick after the click");
    tick();
    assert.ok(isShut(), "the gate is back by the second tick, with no nameless leaf left standing");
  });
}

test("as captured: from inside the grounds the gate lets the player back out south", (t) => {
  settle();
  const { player } = actor(t, 2758, NORTH_Y);
  click(player, RIGHT, 2758);
  assert.ok(until(() => at(player)[1] === GATE_Y, 6), `the player steps out: ${at(player)}`);
  assert.ok(until(isShut, 3), "the gate is back");
});
