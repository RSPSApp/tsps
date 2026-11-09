// Run after `yarn build`: node --test tests/wilderness-gwd-ecumenical-keys.test.cjs
//
// Ecumenical keys from the Wilderness God Wars Dungeon's monsters (Wiki, Ecumenical key; recorded:
// rsprox_transcripts/224/01463.txt:137735, an imp at (3041, 10144, 0)): 1/60, a limit of 3 carried and banked (4 and 5
// with the Medium and Hard Wilderness Diary), and past it "You already have enough of these". Real plugins and a real
// Player; the kill's "npc-drops:add" as NpcDrops emits it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Keys = require("../plugins/bosses/godwars/Keys.GodWars")._test;

let core, next = 9960;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("ecu" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, messages };
}
const npcAt = (x, y, z = 0) => ({ getLocation: () => new core.Location(x, y, z) });
function kill(t, f, npc, { random = 0 } = {}) {
  t.mock.method(Math, "random", () => random);
  const drops = [];
  try { PM.emitCustomEvent("npc-drops:add", { player: f.p, npc, npcId: 3134, drops }); } finally { Math.random.mock.restore(); }
  return drops.filter((d) => d.itemId === core.ItemIdentifiers.ECUMENICAL_KEY);
}

test("a kill in the dungeon can drop a key; outside it, never", (t) => {
  const f = actor(t);
  assert.deepEqual(kill(t, f, npcAt(3041, 10144)), [{ itemId: core.ItemIdentifiers.ECUMENICAL_KEY, amount: 1 }]);
  assert.deepEqual(f.messages, ["<col=ef1020>Untradeable drop: Ecumenical key</col>"], "as recorded (224/01463:137735)");
  assert.deepEqual(kill(t, f, npcAt(3041, 10144), { random: 1 / 60 }), [], "a roll other than 1 in 60 drops nothing");
  assert.deepEqual(kill(t, f, npcAt(2900, 5300, 2)), [], "the main God Wars Dungeon");
  assert.deepEqual(kill(t, f, npcAt(3222, 3218)), []);
});

test("the base rate is 1/60, and the limit three keys counting the bank", (t) => {
  const f = actor(t);
  assert.equal(Keys.dropRate(f.p), 60);
  assert.equal(Keys.keyLimit(f.p), 3);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.ECUMENICAL_KEY, 2), false);
  f.p.getBank(0).add(new core.Item(core.ItemIdentifiers.ECUMENICAL_KEY, 1), false);
  assert.deepEqual(kill(t, f, npcAt(3041, 10144)), [], "three held: no key");
  assert.deepEqual(f.messages, ["You already have enough of these"]);
});
