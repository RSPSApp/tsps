// Run after `yarn build`: node --test tests/seed-pod-crystal-teleport-rules.test.cjs
// The royal seed pod and the teleport crystal moved the player with moveTo, so they worked deep in the Wilderness,
// under Tele Block and while busy. They now go through TeleportHandler: the seed pod "can teleport up to level 30
// wilderness" (Wiki, Royal seed pod); the crystal, which the Wiki gives no level of its own, takes the usual 20 and
// keeps its charge when refused. Real engine: every plugin loaded, a real Player, native inventory_action packets.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core, next = 9900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

// Edgeville Wilderness (level 1-ish) and deep Wilderness near the Lava Maze (level ~40).
const SHALLOW = [3093, 3530, 0];
const DEEP = [3060, 3850, 0];

function actor(t, at, item) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("podtele" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(at[0], at[1]);
  p.setLocation(new core.Location(...at)); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getInventory().add(new core.Item(item, 1), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, conn, messages };
}

async function use(f, itemId, option) {
  const slot = f.p.getInventory().getSlotForItemId(itemId);
  await f.conn.dispatch([{ type: "inventory_action", slot, itemId, widgetId: 3214, option }]);
  f.conn.processTurnPackets();
  for (let i = 0; i < 8; i++) core.TaskManager.process();
}

const xy = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];

test("the royal seed pod teleports from shallow Wilderness, with the Wiki's line", async (t) => {
  const f = actor(t, SHALLOW, core.ItemIdentifiers.ROYAL_SEED_POD);
  assert.ok(core.Wilderness.isIn(f.p));
  await use(f, core.ItemIdentifiers.ROYAL_SEED_POD, "Commune");
  assert.deepEqual(xy(f), [2465, 3495], f.messages.join(" | "));
  assert.ok(f.messages.includes("The Royal seed pod teleports you to the Grand Tree."), f.messages.join(" | "));
});

// rsprox.net 1060, 1067, 2950, 3434, 4042, 4155, 4263 (rev 230-239): the pod's own animation and spotanim (delay 5)
// and busy on the click, the landing on tick 4, the pod folding back on tick 5, and on tick 8 the reset, the line
// and busy 0. Sound 469 on the click and the landing (4042).
test("Commune plays the pod's own teleport, tick by tick as captured", async (t) => {
  const C = core.CacheDefinitions;
  const f = actor(t, SHALLOW, core.ItemIdentifiers.ROYAL_SEED_POD);
  const busy = C.getVarbitId("busy");
  let tick = 0;
  const log = [];
  t.mock.method(f.p, "performAnimation", (a) => { if (a) log.push([tick, "seq", a.getId(), a.getDelay?.() ?? 0]); });
  t.mock.method(f.p, "performGraphic", (g) => { if (g) log.push([tick, "spot", g.getId(), g.getDelay?.() ?? 0]); });
  const sender = f.p.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => { if (id === busy) log.push([tick, "busy", value]); return sendVarbit(id, value); });
  t.mock.method(sender, "sendSound", (id) => { log.push([tick, "sound", id]); return sender; });
  t.mock.method(core.Sounds, "playAreaSoundAt", (_p, sound) => { log.push([tick, "sound", sound.getId?.() ?? sound.id]); });
  t.mock.method(core.Sounds, "sendSound", (_p, sound) => { log.push([tick, "sound", sound.getId?.() ?? sound.id]); });
  const slot = f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.ROYAL_SEED_POD);
  await f.conn.dispatch([{ type: "inventory_action", slot, itemId: core.ItemIdentifiers.ROYAL_SEED_POD, widgetId: 3214, option: "Commune" }]);
  f.conn.processTurnPackets();
  const landed = [];
  const lines = [];
  for (tick = 1; tick <= 10; tick++) {
    core.TaskManager.process();
    landed.push(xy(f)[1] === 3495);
    lines.push(f.messages.length);
  }
  const seq = (name) => C.getSeqId(name), spot = (name) => C.getSpotanimId(name);
  assert.deepEqual(log.filter(([at]) => at === 0), [
    [0, "seq", seq("aluft_human_plant_teleport"), 5],
    [0, "spot", spot("aluft_plant_pod"), 5],
    [0, "sound", 469],
    [0, "busy", 1],
  ]);
  assert.equal(landed.indexOf(true) + 1, 4, "lands on tick 4");
  assert.deepEqual(xy(f), [2465, 3495]);
  assert.deepEqual(log.filter(([at]) => at > 0), [
    [4, "sound", 469],
    [5, "seq", seq("aluft_human_plant_teleport_revers"), 0],
    [5, "spot", spot("aluft_plant_pod_revers"), 0],
    [8, "seq", core.Animation.DEFAULT_RESET_ANIMATION.getId(), 0],
    [8, "busy", 0],
  ]);
  assert.equal(lines.indexOf(1) + 1, 8, "the line comes on tick 8");
  assert.deepEqual(f.messages, ["The Royal seed pod teleports you to the Grand Tree."]);
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), false, "free once the pod has folded away");
});

test("the player is held until the pod has folded away", async (t) => {
  const f = actor(t, SHALLOW, core.ItemIdentifiers.ROYAL_SEED_POD);
  const slot = f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.ROYAL_SEED_POD);
  await f.conn.dispatch([{ type: "inventory_action", slot, itemId: core.ItemIdentifiers.ROYAL_SEED_POD, widgetId: 3214, option: "Commune" }]);
  f.conn.processTurnPackets();
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  assert.deepEqual(xy(f), [2465, 3495]);
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), true, "held on tick 5");
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), false, "free on tick 8");
});

test("cancelling the player's own tasks mid-hold does not leave them frozen", async (t) => {
  const f = actor(t, SHALLOW, core.ItemIdentifiers.ROYAL_SEED_POD);
  const slot = f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.ROYAL_SEED_POD);
  await f.conn.dispatch([{ type: "inventory_action", slot, itemId: core.ItemIdentifiers.ROYAL_SEED_POD, widgetId: 3214, option: "Commune" }]);
  f.conn.processTurnPackets();
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), true, "held on tick 5");
  core.TaskManager.cancelTasks(f.p);
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), false);
  assert.deepEqual(f.messages, ["The Royal seed pod teleports you to the Grand Tree."]);
});

test("dying during the hold: no reset, no release and no seed pod line", async (t) => {
  const f = actor(t, SHALLOW, core.ItemIdentifiers.ROYAL_SEED_POD);
  const slot = f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.ROYAL_SEED_POD);
  await f.conn.dispatch([{ type: "inventory_action", slot, itemId: core.ItemIdentifiers.ROYAL_SEED_POD, widgetId: 3214, option: "Commune" }]);
  f.conn.processTurnPackets();
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  t.mock.method(f.p, "isDyingReturn", () => true);
  const resets = [];
  t.mock.method(f.p, "performAnimation", (a) => { resets.push(a?.getId?.()); });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), true, "the death keeps the block");
  assert.deepEqual(resets, [], "the death animation is not cut");
  assert.deepEqual(f.messages, []);
});

test("the royal seed pod is refused above level 30 Wilderness", async (t) => {
  const f = actor(t, DEEP, core.ItemIdentifiers.ROYAL_SEED_POD);
  f.p.setWildernessLevel(40);
  assert.ok(f.p.getWildernessLevel() > 30);
  await use(f, core.ItemIdentifiers.ROYAL_SEED_POD, "Commune");
  assert.deepEqual(xy(f), DEEP.slice(0, 2));
  assert.ok(f.messages.includes("You must be below level 30 of Wilderness to use teleportation."), f.messages.join(" | "));
});

test("the royal seed pod is refused under Tele Block in the Wilderness", async (t) => {
  const f = actor(t, SHALLOW, core.ItemIdentifiers.ROYAL_SEED_POD);
  f.p.getCombat().getTeleblockTimer().start(100);
  await use(f, core.ItemIdentifiers.ROYAL_SEED_POD, "Commune");
  assert.deepEqual(xy(f), SHALLOW.slice(0, 2));
  // The refusal names the time left (4fabd01e5; rsprox_transcripts/232/00435.txt): 100 ticks is 1 minute, 40 seconds.
  assert.ok(f.messages.includes("A teleport block has been cast on you. It should wear off in 1 minute, 40 seconds."),
    f.messages.join(" | "));
});

test("the teleport crystal above level 20 Wilderness is refused and keeps its charge", async (t) => {
  const crystal = core.ItemIdentifiers.TELEPORT_CRYSTAL_4_;
  const f = actor(t, DEEP, crystal);
  f.p.setWildernessLevel(25);
  await use(f, crystal, "Lletya");
  assert.deepEqual(xy(f), DEEP.slice(0, 2));
  assert.ok(f.messages.includes("You must be below level 20 of Wilderness to use teleportation."), f.messages.join(" | "));
  assert.equal(f.p.getInventory().getAmount(crystal), 1, "the charge is kept");
});

test("the teleport crystal from shallow Wilderness uses a charge and reaches Lletya", async (t) => {
  const crystal = core.ItemIdentifiers.TELEPORT_CRYSTAL_4_;
  const f = actor(t, SHALLOW, crystal);
  await use(f, crystal, "Lletya");
  assert.equal(f.p.getInventory().getAmount(crystal), 0);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.TELEPORT_CRYSTAL_3_), 1);
  assert.notDeepEqual(xy(f), SHALLOW.slice(0, 2), f.messages.join(" | "));
  assert.ok(f.messages.includes("You activate the teleport crystal and arrive in Lletya."), f.messages.join(" | "));
});

test("a teleport crystal (5), Eluned's after the hard Western diary, uses a charge to become (4)", async (t) => {
  const crystal = core.ItemIdentifiers.TELEPORT_CRYSTAL_5_;
  const f = actor(t, SHALLOW, crystal);
  await use(f, crystal, "Lletya");
  assert.equal(f.p.getInventory().getAmount(crystal), 0);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.TELEPORT_CRYSTAL_4_), 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.CRYSTAL_TELEPORT_SEED), 0);
  assert.notDeepEqual(xy(f), SHALLOW.slice(0, 2), f.messages.join(" | "));
});
