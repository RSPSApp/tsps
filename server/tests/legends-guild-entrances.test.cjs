// The Legends' Guild gate and doors as RSProx 20261121T071043 (rev 242) plays them: the click shows both
// leaves as inviswall 38848 with the open leaves one tile north, plays the sound, sends the message, steps
// the player one tile across and restores the leaves two ticks later. Without Legends' Quest, neither opens.
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

let core;
let quest;
let next = 9600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2729, 3349);
  core.RegionManager.loadMapFiles(2729, 3373);
  PM.emitServerStartup({});
  quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "legends_quest");
  assert.ok(quest);
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, complete) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("lg" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  if (complete) quest.setStage(p, 70);
  const c = new ClientConnection(channel);
  c.player = p;
  const f = { p, c, messages: [], log: [], n: 0 };
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { f.messages.push(m); return sender; });
  t.mock.method(sender, "sendSound", (id) => { f.log.push({ n: f.n, kind: "sound", id }); return sender; });
  t.mock.method(sender, "sendObject", (o) => { f.log.push({ n: f.n, kind: "show", id: o.getId() }); return sender; });
  t.mock.method(p.getSession(), "isTileInScene", () => true);
  t.mock.method(core.World, "forEachNetworkPlayer", (visit) => visit(p));
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return f;
}

function tick(f, count) {
  for (let i = 0; i < count; i++) {
    f.n++;
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.resetUpdating();
  }
}

async function click(f, id, x, y) {
  await f.c.dispatch([{ type: "object_option", id, x, y, clickType: 1 }]);
  tick(f, 5);
}
const where = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];
const ENTRANCE_IDS = new Set([38848, 1573, 1574, 2391, 2392, 2896, 2897, 2898, 2899]);
const shown = (f) => f.log.filter((e) => e.kind === "show" && ENTRANCE_IDS.has(e.id)).map((e) => e.id);

test("the doors open for a Legends' Quest player and step them into the guild", async (t) => {
  const f = actor(t, [2728, 3373], true);
  await click(f, 2896, 2728, 3373);
  assert.deepEqual(where(f), [2728, 3374]);
  assert.ok(f.messages.includes("You push the huge Legends' Guild doors open."), f.messages.join(" | "));
  assert.deepEqual(f.log.filter((e) => e.kind === "sound").map((e) => e.id), [46]);
  assert.deepEqual(shown(f), [38848, 2898, 38848, 2899, 2896, 2897]);
});

test("the gate lets a Legends' Quest player out, the guards saluting", async (t) => {
  const f = actor(t, [2729, 3350], true);
  await click(f, 2392, 2729, 3349);
  assert.deepEqual(where(f), [2729, 3349]);
  assert.ok(f.messages.includes("The guards salute you as you walk past."), f.messages.join(" | "));
  assert.deepEqual(f.log.filter((e) => e.kind === "sound").map((e) => e.id), [71]);
  assert.deepEqual(shown(f), [38848, 1573, 38848, 1574, 2391, 2392]);
});

test("without Legends' Quest neither the gate nor the doors open", async (t) => {
  for (const [id, x, y] of [[2392, 2729, 3349], [2896, 2728, 3373]]) {
    const f = actor(t, [x, y], false);
    await click(f, id, x, y);
    assert.deepEqual(where(f), [x, y]);
    assert.ok(f.messages.includes("You need to complete the Legends' quest before you can enter the Legends' Guild."));
    assert.deepEqual(shown(f), []);
  }
});
