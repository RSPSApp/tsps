// Run after `yarn build`: node --test tests/perilous-moons-camp-instance.test.cjs
//
// Perilous Moons' camp phase (#5196, #5161) against rsprox recording 1693 (rev 226). Real Player,
// PlayerSession and ClientConnection, the real plugins and map, object_option packets; each tick
// runs in World.process order. No client ran.
// - Stages 8-14: entering a cavern rebuilds it as the player's own copy (rebuild_region); the
//   antechamber copy has pmoon_camp_supplies_1..3 while a camp is left; an unbuilt camp is the
//   camp spot and the unbuilt range, with the copied map's stools, crate and barrel gone.
// - Build: the spot goes on the click tick, the camp's locs come two ticks on, the tea, varbit,
//   supplies and run energy on the sixth; the last camp sets stage 12 on that tick.
// - From stage 15 the real map; a logout in a copy comes back to it at login.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const OP = { LOC_ADD_CHANGE: 134, LOC_DEL: 135, REBUILD_REGION: 140 };
const SUPPLIES = 28968; // pmoon_camp_supplies (item)
const RAW_BREAM = 29216; // bream_fish_raw: a Neypotzli resource that fizzles outside it
const CAMPS_ATTRIBUTE = "perilous-moons:camps";
const O = { TELEBOX: 51375, TELEBOX_3X3: 51377, DIAGONAL: 51376, CAMP_SPOT: 50858, RANGE_NOT_BUILT: 53007, RANGE: 51362, STOOL: 42092, CRATE: 51371, BARREL: 52425, BARRIER: 51364 };
const TEA = "You drink some tea from the newly built camp and find yourself feeling energised!";
let core;
let next = 5196;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[1439, 9600], [1440, 9630], [1350, 9580], [1374, 9710], [1510, 9693]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, start) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("pmoon" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...start));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { t, player, connection, packets: [], messages: [], tick: 0 };
  const send = session.sendClientPacket.bind(session);
  t.mock.method(session, "sendClientPacket", (frame) => {
    f.packets.push({ tick: f.tick, op: frame[0] });
    return send(frame);
  });
  const message = player.sendMessage;
  t.mock.method(player, "sendMessage", function (text) {
    f.messages.push({ tick: f.tick, text: String(text) });
    return message.apply(this, arguments);
  });
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  core.World.updateLocalNpcs(f.player, [...core.World.getNpcs()]);
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };
const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "perilous_moons");
const copyOf = (f) => (f.player.getPrivateArea() instanceof core.TemplatedInstanceArea ? f.player.getPrivateArea() : null);
const xyz = (l) => [l.getX(), l.getY(), l.getZ()];
/** Where the player stands, in the copied cavern's own tiles when in a copy. */
const source = (f) => xyz(copyOf(f) ? copyOf(f).toSource(f.player.getLocation()) : f.player.getLocation());
const objectAt = (area, id, [x, y, z]) => area.getObjects().find((o) => o.getId() === id && o.getLocation().equals(area.sourceTile(x, y, z))) ?? null;

/** Stands the player on `stand` (source tiles) and clicks loc `id` at `at` (source tiles). */
async function click(f, id, at, stand, settle = 6) {
  const area = copyOf(f);
  const tile = (x, y, z) => (area ? area.sourceTile(x, y, z) : new core.Location(x, y, z));
  f.player.moveTo(tile(...stand));
  ticks(f, 2);
  const target = tile(...at);
  f.clickTick = f.tick;
  await f.connection.dispatch([{ type: "object_option", id, x: target.getX(), y: target.getY(), clickType: 1 }]);
  ticks(f, settle);
}

async function prisonCopy(t, camps) {
  const f = actor(t, [1422, 9614, 1]);
  ticks(f, 2);
  quest().setStage(f.player, 10);
  f.player.setAttribute(CAMPS_ATTRIBUTE, camps);
  f.player.getInventory().add(new core.Item(SUPPLIES, 1), true);
  await click(f, O.DIAGONAL, [1421, 9613, 1], [1422, 9614, 1]);
  return f;
}

test("entering Neypotzli at stage 7 sets 8 and builds the antechamber's copy with its building supplies", async (t) => {
  const f = actor(t, [1439, 9602, 1]);
  ticks(f, 2);
  quest().setStage(f.player, 7);
  const before = f.packets.length;
  await click(f, O.TELEBOX, [1439, 9600, 1], [1439, 9602, 1]);
  assert.equal(quest().getStage(f.player), 8);
  const area = copyOf(f);
  assert.ok(area, "the player is in a templated copy");
  assert.deepEqual(source(f), [1440, 9615, 1], "on the captured landing, in the copy");
  assert.ok(f.packets.slice(before).some((p) => p.op === OP.REBUILD_REGION), "rebuild_region, as live");
  for (const [id, x, y] of [[50855, 1435, 9636], [50856, 1436, 9636], [50857, 1436, 9637]]) {
    assert.ok(objectAt(area, id, [x, y, 1]), `pmoon_camp_supplies ${id} at ${x},${y}`);
  }
  const npcs = [...core.World.getNpcs()].filter((n) => n && n.getPrivateArea?.() === area).map((n) => n.getId());
  assert.ok(npcs.includes(core.NpcIdentifiers.ATTALA), "Attala in the copy");
  assert.ok(npcs.includes(core.NpcIdentifiers.JESSAMINE), "the map's Jessamine copied in");
  assert.equal(npcs.includes(12770), false, "rec 1693's antechamber copy had no sunlight moths");
});

test("an unbuilt camp is the spot and the unbuilt range, with the copied map's camp locs gone", async (t) => {
  const f = await prisonCopy(t, 0);
  const area = copyOf(f);
  assert.ok(area);
  assert.deepEqual(source(f), [1388, 9575, 0], "the prison tunnel's captured landing");
  assert.ok(objectAt(area, O.CAMP_SPOT, [1348, 9580, 0]), "camp spot (50858)");
  assert.ok(objectAt(area, O.RANGE_NOT_BUILT, [1349, 9580, 0]), "unbuilt range (53007)");
  for (const [x, y] of [[1351, 9581], [1348, 9582], [1348, 9581]]) {
    const tile = area.sourceTile(x, y, 0);
    assert.ok(core.World.getRemovedObjects().some((o) => o.getPrivateArea() === area && o.getLocation().equals(tile)),
      `the map's loc at ${x},${y} is removed`);
    assert.equal(area.getObjects().some((o) => o.getLocation().equals(tile)), false);
  }
  // npc-spawns.json has 14 sulphur nagua (13033) in the prison; rec 1693's copy had them too.
  const naguas = [...core.World.getNpcs()].filter((n) => n && n.getPrivateArea?.() === area && n.getId() === 13033);
  assert.equal(naguas.length, 14, "the cavern's own NPCs are copied in");
});

test("Build follows rec 1693 tick by tick, and the third camp sets stage 12", async (t) => {
  const f = await prisonCopy(t, 2 | 4);
  const area = copyOf(f);
  f.player.setRunEnergy(10);
  // Rec 1693 built it from (1351, 9581): the stool's tile, walkable while the camp isn't built.
  f.player.moveTo(area.sourceTile(1351, 9581, 0));
  ticks(f, 2);
  const spot = area.sourceTile(1348, 9580, 0);
  await f.connection.dispatch([{ type: "object_option", id: O.CAMP_SPOT, x: spot.getX(), y: spot.getY(), clickType: 1 }]);
  let built = null;
  for (let i = 0; i < 8 && built === null; i++) {
    tick(f);
    if (!objectAt(area, O.CAMP_SPOT, [1348, 9580, 0])) built = f.tick;
  }
  assert.ok(built !== null, "the camp spot goes");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "not yet held on the click tick");
  tick(f); // +1
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true, "held from the minimap's tick");
  assert.equal(objectAt(area, O.RANGE, [1349, 9580, 0]), null);
  tick(f); // +2
  assert.deepEqual(source(f), [1350, 9582, 0], "rec 1693 tick 1346: moved off the stool's tile as the camp appears");
  for (const [id, x, y, face] of [[O.BARRIER, 1350, 9579, 1], [O.RANGE, 1349, 9580, 0], [O.STOOL, 1348, 9580, 3],
    [O.STOOL, 1351, 9581, 3], [O.CRATE, 1348, 9582, 0], [O.BARREL, 1348, 9581, 2]]) {
    const object = objectAt(area, id, [x, y, 0]);
    assert.ok(object, `${id} at ${x},${y}`);
    assert.equal(object.getFace(), face, `${id} at ${x},${y} faces ${face}`);
  }
  assert.equal(objectAt(area, O.RANGE_NOT_BUILT, [1349, 9580, 0]), null, "the unbuilt range swapped for the range");
  ticks(f, 3); // +5
  assert.equal(f.messages.some((m) => m.text === TEA), false, "no tea before the sixth tick");
  assert.equal(f.player.getInventory().getAmount(SUPPLIES), 1);
  tick(f); // +6
  assert.deepEqual(f.messages.filter((m) => m.text === TEA).map((m) => m.tick), [built + 6]);
  assert.equal(f.player.getInventory().getAmount(SUPPLIES), 0);
  assert.equal(f.player.getAttribute(CAMPS_ATTRIBUTE), 7);
  assert.equal(quest().getStage(f.player), 12);
  assert.equal(f.player.getRunEnergy(), 100);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

test("a built camp's copy keeps the map's camp", async (t) => {
  const f = await prisonCopy(t, 1);
  const area = copyOf(f);
  assert.equal(objectAt(area, O.CAMP_SPOT, [1348, 9580, 0]), null);
  assert.equal(objectAt(area, O.RANGE_NOT_BUILT, [1349, 9580, 0]), null);
  assert.equal(core.World.getRemovedObjects().some((o) => o.getPrivateArea() === area), false);
});

test("Neypotzli's resources keep in a copy of it", async (t) => {
  const f = actor(t, [1422, 9614, 1]);
  ticks(f, 2);
  quest().setStage(f.player, 10);
  f.player.getInventory().add(new core.Item(SUPPLIES, 1), true);
  f.player.getInventory().add(new core.Item(RAW_BREAM, 1), true);
  await click(f, O.DIAGONAL, [1421, 9613, 1], [1422, 9614, 1]);
  assert.ok(copyOf(f));
  ticks(f, 3);
  assert.equal(f.player.getInventory().getAmount(RAW_BREAM), 1);
});

test("from stage 15 the real map: the way out leaves the copy, and the way back in copies nothing", async (t) => {
  const f = actor(t, [1439, 9602, 1]);
  ticks(f, 2);
  quest().setStage(f.player, 7);
  await click(f, O.TELEBOX, [1439, 9600, 1], [1439, 9602, 1]);
  assert.ok(copyOf(f));
  ticks(f, 10); // the entry's camera pull holds the player
  quest().setStage(f.player, 15);
  await click(f, O.TELEBOX_3X3, [1439, 9612, 1], [1440, 9615, 1]);
  // Booleans: a failing assert on the area would print the whole copy.
  assert.equal(copyOf(f) === null, true, "Cam Torum is the real map");
  assert.deepEqual(source(f), [1439, 9599, 1]);
  ticks(f, 2);
  await click(f, O.TELEBOX, [1439, 9600, 1], [1439, 9602, 1]);
  assert.equal(copyOf(f) === null, true, "stage 15: no copy");
  assert.deepEqual(source(f), [1440, 9615, 1]);
});

test("a logout in a copy saves its landing, and the login copies the cavern again", async (t) => {
  const f = await prisonCopy(t, 0);
  const area = copyOf(f);
  f.player.onLogout();
  assert.equal(area.isDestroyed(), true);
  assert.deepEqual(xyz(f.player.getLocation()), [1388, 9575, 0], "saved on the real landing");
  const restored = actor(t, [1388, 9575, 0]);
  quest().setStage(restored.player, 10);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  ticks(restored, 3);
  const again = copyOf(restored);
  assert.ok(again, "back in a copy");
  assert.deepEqual(source(restored), [1388, 9575, 0]);
  assert.ok(objectAt(again, O.CAMP_SPOT, [1348, 9580, 0]));
});

test("a save made inside a copy keeps Neypotzli's resources at login", async (t) => {
  const f = await prisonCopy(t, 0);
  const saved = f.player.getLocation().clone();
  const exit = f.player.getAttribute("perilous-moons:scene-exit");
  assert.deepEqual(exit, [1388, 9575, 0]);
  // A crash: the save holds the copy's tile and the pending exit, and no logout ran.
  const restored = actor(t, [saved.getX(), saved.getY(), saved.getZ()]);
  quest().setStage(restored.player, 10);
  restored.player.setAttribute("perilous-moons:scene-exit", exit);
  restored.player.getInventory().add(new core.Item(RAW_BREAM, 1), true);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  ticks(restored, 3);
  assert.equal(restored.player.getInventory().getAmount(RAW_BREAM), 1, "nothing fizzles");
  assert.ok(copyOf(restored), "back in a copy of the prison");
  assert.deepEqual(source(restored), [1388, 9575, 0]);
});

test("leaving the copy mid-Build closes the Build's fade and builds nothing", async (t) => {
  const f = await prisonCopy(t, 0);
  const area = copyOf(f);
  f.player.moveTo(area.sourceTile(1351, 9581, 0));
  ticks(f, 2);
  const spot = area.sourceTile(1348, 9580, 0);
  await f.connection.dispatch([{ type: "object_option", id: O.CAMP_SPOT, x: spot.getX(), y: spot.getY(), clickType: 1 }]);
  for (let i = 0; i < 8 && objectAt(area, O.CAMP_SPOT, [1348, 9580, 0]); i++) tick(f);
  assert.equal(objectAt(area, O.CAMP_SPOT, [1348, 9580, 0]), null, "Build started");
  const overlay = (161 << 16) | 1;
  assert.ok(f.player.getPacketSender().getSubInterfaceAt(overlay), "faded out");
  f.player.moveTo(new core.Location(3222, 3218, 0)); // a teleport out, as a death's respawn
  ticks(f, 8);
  assert.equal(copyOf(f) === null, true);
  assert.equal(f.player.getPacketSender().getSubInterfaceAt(overlay) == null, true, "the fade is closed");
  assert.equal(f.player.getAttribute(CAMPS_ATTRIBUTE) ?? 0, 0, "no camp counted");
  assert.equal(f.player.getInventory().getAmount(SUPPLIES), 1, "supplies kept");
});
