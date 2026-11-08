// Run after `yarn build`: node --test tests/grotesque-guardians-log-count.test.cjs
// A Dusk kill is one Grotesque Guardians kill in the collection log. Real engine: every plugin loaded, a real Player and
// a real Dusk NPC, the death through PluginManager.emitNpcDeath (NpcDrops' death roll and the plugin's own both fire).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");

let core, Common, Progress;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Common = require("../plugins/bosses/grotesqueguardians/Common.GrotesqueGuardians");
  Progress = require("../plugins/achievements/collectionlog/Progress.CollectionLog");
});
after(() => PM.emitServerShutdown({}));

test("one Dusk kill adds one to the Grotesque Guardians collection log count", async (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(9801);
  player.setUsername("duskcount");
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player); });
  const at = new core.Location(1696, 4572, 1);
  const dusk = new NPC(Common.duskForms()[0], at);
  player.setLocation(at.clone());
  PM.emitNpcDeath({ killer: player, damagers: [player], npc: dusk, npcId: dusk.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, remains: null });
  await new Promise((resolve) => setImmediate(resolve));
  const counts = Object.values(player.getAttribute(Progress.COUNTS_ATTRIBUTE) ?? {});
  assert.deepEqual(counts, [1], "one category counted once");
});
