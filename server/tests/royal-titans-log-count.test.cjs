// Run after `yarn build`: node --test tests/royal-titans-log-count.test.cjs
// A Royal Titans kill (both titans down) is one kill in the collection log's Royal Titans category, as it is one
// "Your Royal Titans kill count is" (rsprox_transcripts/228/02283.txt, 235/03398.txt). Real engine: every plugin loaded,
// a real encounter (Area.spawnEncounter), deaths through PluginManager.emitNpcDeath, real Players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const BRAN = 30622;
let core, Area, Data, Progress;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Area = require("../plugins/bosses/royaltitans/Area.RoyalTitans");
  Data = require("../plugins/achievements/collectionlog/Data.CollectionLog");
  Progress = require("../plugins/achievements/collectionlog/Progress.CollectionLog");
});
after(() => PM.emitServerShutdown({}));

let next = 9750;
function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("titanlog" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

function encounter(t, players) {
  const session = {
    area: { isDestroyed: () => false, add() {}, remove() {}, getPlayers: () => players },
    owner: players[0], players, branda: null, eldric: null, spawnedAt: 0, over: false, respawnAt: 0,
    claimedBy: null, corpses: [], rows: new Set(), minions: new Set(), staticLocs: [], tileLocs: new Map(), pendingRows: [],
  };
  Area.spawnEncounter(session);
  for (const npc of [session.branda, session.eldric]) {
    const queue = core.World.getAddNPCQueue();
    if (queue.includes(npc)) queue.splice(queue.indexOf(npc), 1);
    core.World.getNpcs().add(npc);
    t.after(() => core.World.getNpcs().remove(npc));
  }
  for (const p of players) p.setLocation(session.branda.getLocation().clone());
  return session;
}

function die(session, npc, killer) {
  const at = npc.getLocation();
  PM.emitNpcDeath({ killer, damagers: session.players, npc, npcId: npc.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, remains: null });
}

test("one Royal Titans kill adds one to the Royal Titans collection log count, for each player", async (t) => {
  const category = Data.categoriesOf(BRAN).find((entry) => /royal titans/i.test(entry.name));
  assert.ok(category, "the log has a Royal Titans category holding Bran");
  const a = player(t), b = player(t);
  const session = encounter(t, [a, b]);
  t.mock.method(Math, "random", () => 0.99);
  die(session, session.branda, a);
  die(session, session.eldric, a);
  await new Promise((resolve) => setImmediate(resolve));
  for (const p of [a, b]) assert.equal(Progress.categoryCount(p, category), 1, p.getUsername());
});
