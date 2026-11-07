// Run after `yarn build`: node --test tests/warriors-guild-keg-double-click.test.cjs
// A keg is picked up two ticks after the click, but the click only checked that it wasn't taken yet: clicking it again
// before then counted it twice, past five, and each extra keg paid 10 Strength XP and 10 tokens when the stack fell.
// A keg now counts once, and the stack stops at five. Real engine: every plugin loaded, a real Player in the keg room,
// the plugin's own pick-up handler and the real TaskManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let Kegs;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Kegs = require("../plugins/areas/warriors-guild/Kegs.WarriorsGuild")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("clicking the same keg twice before it is picked up counts it once", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9030); p.setUsername("kegs9030"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2870, 3540, 1)); // the keg room
  t.after(() => { Kegs.balancing.delete(p); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  Kegs.pickUpKeg({ player: p, objectId: 15669 });
  core.TaskManager.process(); // one tick on: the first pick-up is still under way
  Kegs.pickUpKeg({ player: p, objectId: 15669 });
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.equal(Kegs.balancing.get(p)?.kegs, 1, "one keg on the head");
});
