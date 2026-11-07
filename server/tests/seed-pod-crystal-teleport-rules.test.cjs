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
  assert.deepEqual(xy(f), [2465, 3496], f.messages.join(" | "));
  assert.ok(f.messages.includes("The Royal seed pod teleports you to the Grand Tree."), f.messages.join(" | "));
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
  assert.ok(f.messages.includes("A magical spell is blocking you from teleporting."), f.messages.join(" | "));
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
