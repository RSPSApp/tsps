// Run after `yarn build`: node --test tests/mimic-second-fight.test.cjs
// A second Mimic fight starts like the first: the earlier fight's arena, destroyed, must not still answer for the
// arena's tiles. Real engine: every plugin loaded, a real Player, area changes through AreaManager.process.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");

let core, Lair, State;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Lair = require("../plugins/bosses/mimic/Lair.Mimic");
  State = require("../plugins/bosses/mimic/State.Mimic");
});
after(() => PM.emitServerShutdown({}));

test("the second Mimic fight keeps its own live arena", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9840);
  p.setUsername("mimicfights");
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setNeedsPlacement(false);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const casket = new core.Item(core.ItemIdentifiers.MIMIC, 1);
  p.getInventory().add(casket, false);
  State.initialize(p.getInventory().getItems().find((item) => item?.getId() === core.ItemIdentifiers.MIMIC), "master", 7);
  for (let fight = 1; fight <= 2; fight++) {
    assert.equal(Lair.enterArena(p), true, `fight ${fight} begins`);
    const arena = p.getArea();
    for (let tick = 0; tick < 3; tick++) AreaManager.process(p);
    assert.equal(p.getArea(), arena, `fight ${fight}: still in its own arena`);
    assert.ok(Lair.sessionOf(arena), `fight ${fight}: its session is live`);
    assert.equal(AreaManager.inMulti(p), true, `fight ${fight}: the arena is multicombat`);
    Lair.end(arena);
    p.setArea(null);
  }
});
