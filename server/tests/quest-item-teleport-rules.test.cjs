// Run after `yarn build`: node --test tests/quest-item-teleport-rules.test.cjs
// Drakan's medallion (Sins of the Father's menu), the goblin village sphere and the magic whistle moved the player
// with moveTo, so they ignored the teleport rules. Wiki: the medallion "cannot teleport past level 20", the sphere
// "does not work beyond level 20 Wilderness". Real engine: every plugin loaded, real Players, the items' own handlers
// through PluginManager.emitItemAction and the real multi-choice prompt.
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

let core, next = 9500;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === key);

function actor(t, at, itemId) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("qitele" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(at[0], at[1]);
  p.setLocation(new core.Location(...at)); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getInventory().add(new core.Item(itemId, 1), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, conn, messages };
}

function use(f, itemId, option) {
  const slot = f.p.getInventory().getSlotForItemId(itemId);
  const clickType = (core.CacheDefinitions.getItem(itemId).inventoryActions ?? []).indexOf(option) + 1;
  assert.ok(clickType > 0, `the cache's ${option} option`);
  PM.emitItemAction({ player: f.p, itemId, slot, item: f.p.getInventory().getItems()[slot], option, clickType, handled: false });
}

async function choose(f, pattern) {
  const pending = core.MultiChatboxPrompt.getPending(f.p);
  assert.ok(pending, "the destination prompt");
  const index = pending.options.findIndex((s) => pattern.test(s));
  assert.notEqual(index, -1, pending.options.join(" | "));
  await f.conn.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  f.conn.processTurnPackets();
}

const settle = () => { for (let i = 0; i < 8; i++) core.TaskManager.process(); };
const xy = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];
const WILDERNESS = [3093, 3530, 0];
const MEDALLION = () => core.ItemIdentifiers.DRAKANS_MEDALLION;

test("Drakan's medallion is refused under Tele Block in the Wilderness, and teleports otherwise", async (t) => {
  const blocked = actor(t, WILDERNESS, MEDALLION());
  const sotf = quest("sins_of_the_father"); assert.ok(sotf); sotf.setStage(blocked.p, sotf.completionValue);
  blocked.p.getCombat().getTeleblockTimer().start(100);
  use(blocked, MEDALLION(), "Teleport");
  await choose(blocked, /^Ver Sinhaza/);
  settle();
  assert.deepEqual(xy(blocked), WILDERNESS.slice(0, 2), "not moved");
  assert.ok(blocked.messages.includes("A magical spell is blocking you from teleporting."), blocked.messages.join(" | "));

  const free = actor(t, WILDERNESS, MEDALLION());
  sotf.setStage(free.p, sotf.completionValue);
  use(free, MEDALLION(), "Teleport");
  await choose(free, /^Ver Sinhaza/);
  settle();
  assert.notDeepEqual(xy(free), WILDERNESS.slice(0, 2), "teleported");
});

const SLEPEY_TABLET = () => core.ItemIdentifiers.SLEPEY_TABLET;
const worn = (f, option, clickType) => PM.emitItemAction({
  player: f.p, itemId: MEDALLION(), slot: 0, item: f.p.getInventory().getItems()[0],
  interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, option, clickType, handled: false,
});
const prompt = (f) => core.MultiChatboxPrompt.getPending(f.p).options.filter((o) => o !== "Cancel").map((o) => o.replace(/\.$/, ""));

test("Drakan's medallion lists only the destinations the player has, and lands where live OSRS does", async (t) => {
  // Recordings 396, 403, 1429 (Ver Sinhaza), 396, 411, 1636, 1637 (Darkmeyer), 4269 (Slepe).
  const f = actor(t, WILDERNESS, MEDALLION());
  use(f, MEDALLION(), "Teleport");
  assert.deepEqual(prompt(f), ["Ver Sinhaza"], "Ver Sinhaza needs no quest; Darkmeyer and Slepe are locked");
  await choose(f, /^Ver Sinhaza/);
  settle();
  assert.deepEqual(xy(f), [3649, 3230]);

  const done = actor(t, WILDERNESS, MEDALLION());
  const sotf = quest("sins_of_the_father"); sotf.setStage(done.p, sotf.completionValue);
  use(done, MEDALLION(), "Teleport");
  assert.deepEqual(prompt(done), ["Ver Sinhaza", "Darkmeyer"], "Slepe still needs a Slepey tablet");
  await choose(done, /^Darkmeyer/);
  settle();
  assert.deepEqual(xy(done), [3592, 3337], done.messages.join(" | "));
});

test("a Slepey tablet used on the medallion is used up and unlocks Slepe", async (t) => {
  const f = actor(t, WILDERNESS, MEDALLION());
  f.p.getInventory().add(new core.Item(SLEPEY_TABLET(), 1), false);
  worn(f, "Slepe", 4);
  settle();
  assert.deepEqual(xy(f), WILDERNESS.slice(0, 2), "locked Slepe does nothing");
  PM.emitItemOnItem({
    player: f.p, usedItemId: SLEPEY_TABLET(), usedItemSlot: 1, usedWithItemId: MEDALLION(), usedWithItemSlot: 0,
    usedItem: f.p.getInventory().getItems()[1], usedWithItem: f.p.getInventory().getItems()[0], handled: false,
  });
  assert.equal(f.p.getInventory().getAmount(SLEPEY_TABLET()), 0, "the tablet is used up");
  use(f, MEDALLION(), "Teleport");
  assert.deepEqual(prompt(f), ["Ver Sinhaza", "Slepe"]);
  await choose(f, /^Slepe/);
  settle();
  assert.deepEqual(xy(f), [3166, 7711]);
});

test("every medallion landing is a walkable tile", () => {
  for (const [x, y] of [[3649, 3230], [3592, 3337], [3166, 7711]]) {
    core.RegionManager.loadMapFiles(x, y);
    assert.equal(core.RegionManager.blocked(new core.Location(x, y, 0), null), false, `${x},${y}`);
  }
});

test("the worn medallion's destination options teleport, and a locked one does nothing", (t) => {
  const f = actor(t, WILDERNESS, MEDALLION());
  worn(f, "Darkmeyer", 3);
  settle();
  assert.deepEqual(xy(f), WILDERNESS.slice(0, 2), "Darkmeyer is locked before Sins of the Father");
  worn(f, "Ver Sinhaza", 2);
  settle();
  assert.deepEqual(xy(f), [3649, 3230]);
});

test("the goblin village sphere is refused under Tele Block and is not used up", (t) => {
  const sphere = core.ItemIdentifiers.GOBLIN_VILLAGE_SPHERE;
  const f = actor(t, WILDERNESS, sphere);
  const ham = quest("another_slice_of_ham"); assert.ok(ham); ham.setStage(f.p, 4);
  f.p.getCombat().getTeleblockTimer().start(100);
  use(f, sphere, "Break");
  settle();
  assert.equal(f.p.getInventory().getAmount(sphere), 1, "the sphere is kept");
  assert.deepEqual(xy(f), WILDERNESS.slice(0, 2));
  assert.equal(ham.getStage(f.p), 4, "the quest does not move on");
});

test("the magic whistle waits while the player is busy", (t) => {
  const whistle = core.ItemIdentifiers.MAGIC_WHISTLE;
  const f = actor(t, [2742, 3235, 0], whistle);
  f.p.setInterfaceId(1);
  use(f, whistle, "Blow");
  settle();
  assert.deepEqual(xy(f), [2742, 3235], "not moved while busy");
  assert.ok(f.messages.includes("You cannot do that right now."), f.messages.join(" | "));
});
