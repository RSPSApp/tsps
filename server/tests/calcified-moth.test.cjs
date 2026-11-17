// Run after `yarn build`: node --test tests/calcified-moth.test.cjs
// Calcified moth Crush (issue 6114). Wiki (Calcified moth): a single-use teleport to Cam Torum (1439, 9550, plane 1),
// "You crush the moth, releasing the energy inside...", needs Perilous Moons up to the city opening after the Sulphur
// Nagua, and doesn't work beyond level 20 Wilderness. Real engine: every plugin loaded, real Players, the item's
// handler through PluginManager.emitItemAction, the quest's real stage.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core, next = 9800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const VARROCK = [3212, 3424, 0];
const DEEP_WILDERNESS = [3093, 3900, 0];
const CAM_TORUM = [1439, 9550, 1];
const CRUSH = "You crush the moth, releasing the energy inside...";
const moth = () => core.CacheDefinitions.getObjId("varlamore_mining_teleport");
const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "perilous_moons");

function actor(t, at, stage, amount = 3) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("moth" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(at[0], at[1]);
  p.setLocation(new core.Location(...at)); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  if (stage) quest().setStage(p, stage);
  p.getInventory().add(new core.Item(moth(), amount), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, conn, messages };
}

function crush(f) {
  const itemId = moth();
  const slot = f.p.getInventory().getSlotForItemId(itemId);
  const clickType = (core.CacheDefinitions.getItem(itemId).inventoryActions ?? []).indexOf("Crush") + 1;
  assert.ok(clickType > 0, "the cache's Crush option");
  const event = { player: f.p, itemId, slot, item: f.p.getInventory().getItems()[slot], option: "Crush", clickType, handled: false };
  PM.emitItemAction(event);
  return event;
}

const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];

test("once the city is open, Crush uses one moth, sends the Wiki's line and lands in Cam Torum", (t) => {
  const f = actor(t, VARROCK, 5);
  const event = crush(f);
  assert.equal(event.handled, true);
  assert.equal(f.p.getInventory().getAmount(moth()), 2, "one moth used on the click");
  assert.deepEqual(f.messages, [CRUSH]);
  tick(3);
  assert.deepEqual(at(f), CAM_TORUM);
  assert.equal(quest().getStage(f.p), 6, "arriving counts as entering the city, as the surface entrance does");
});

test("a finished quest keeps its stage", (t) => {
  const f = actor(t, VARROCK, quest().completionValue);
  crush(f);
  tick(3);
  assert.deepEqual(at(f), CAM_TORUM);
  assert.equal(quest().getStage(f.p), quest().completionValue);
});

for (const stage of [0, 2, 4]) {
  test(`before the city opens (stage ${stage}) the moth is kept and nothing moves`, (t) => {
    const f = actor(t, VARROCK, stage);
    const event = crush(f);
    assert.equal(event.handled, true);
    assert.equal(f.p.getInventory().getAmount(moth()), 3);
    assert.equal(f.messages.length, 1);
    assert.notEqual(f.messages[0], CRUSH);
    tick(4);
    assert.deepEqual(at(f), VARROCK);
  });
}

test("it doesn't work beyond level 20 Wilderness and the moth is kept", (t) => {
  const f = actor(t, DEEP_WILDERNESS, 5);
  assert.ok(core.Wilderness.isIn(f.p));
  f.p.setWildernessLevel(21);
  crush(f);
  assert.equal(f.p.getInventory().getAmount(moth()), 3);
  assert.deepEqual(f.messages, ["You must be below level 20 of Wilderness to use teleportation."]);
  tick(4);
  assert.deepEqual(at(f), DEEP_WILDERNESS);
});

test("it still works at level 20 Wilderness", (t) => {
  const f = actor(t, DEEP_WILDERNESS, 5);
  f.p.setWildernessLevel(20);
  crush(f);
  assert.equal(f.p.getInventory().getAmount(moth()), 2);
  tick(3);
  assert.deepEqual(at(f), CAM_TORUM);
});
