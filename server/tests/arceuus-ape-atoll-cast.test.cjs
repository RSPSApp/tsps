// Run after `yarn build`: node --test tests/arceuus-ape-atoll-cast.test.cjs
// The Arceuus Ape Atoll Teleport shares its cache name with the standard one. The click went to the standard
// spell first (core SpellTeleports), which refused it for the book yet reported it handled, so the Arceuus spell
// never ran: no teleport, no runes, no line. Real engine: every plugin loaded, a real Player, the Arceuus spell's own
// widget (218:170) by a native widget_action packet.
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

let core, next = 9990;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3200, 3200);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function caster(t, book) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("apecast" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0)); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.setSpellbook(book);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false); p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests();
  for (const key of ["monkey_madness_i", "recipe_for_disaster"]) { const q = quests.find((x) => x.key === key); q.setStage(p, q.completionValue); }
  return { p, conn };
}

async function click(f, widgetId) {
  await f.conn.dispatch([{ type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 65535, slot: -1, buttonNum: 1 }]);
  f.conn.processTurnPackets();
  for (let i = 0; i < 8; i++) core.TaskManager.process();
}

const ARCEUUS_APE_ATOLL = (218 << 16) | 170;

test("the Arceuus Ape Atoll Teleport casts from the Arceuus book: the dungeon, and its runes", async (t) => {
  assert.equal(core.CacheDefinitions.getSpellName(ARCEUUS_APE_ATOLL, -1), "Ape Atoll Teleport", "the shared name");
  const f = caster(t, core.MagicSpellbook.ARCEUUS);
  for (const [id, n] of [[566, 2], [565, 2], [563, 2]]) f.p.getInventory().add(new core.Item(id, n), false);
  await click(f, ARCEUUS_APE_ATOLL);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [2770, 9100]);
  assert.equal(f.p.getInventory().getAmount(566), 0, "the soul runes went");
});

test("the standard Ape Atoll Teleport still casts from the standard book", async (t) => {
  const f = caster(t, core.MagicSpellbook.NORMAL);
  for (const [id, n] of [[563, 2], [555, 2], [554, 2], [1963, 1]]) f.p.getInventory().add(new core.Item(id, n), false);
  await click(f, core.CacheDefinitions.getSpellByName("Ape Atoll Teleport").widgetId);
  assert.notDeepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3200, 3200]);
  assert.equal(f.p.getInventory().getAmount(1963), 0, "the banana went");
});
