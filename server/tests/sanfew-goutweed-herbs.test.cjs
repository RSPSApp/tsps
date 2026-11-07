// Run after `yarn build`: node --test tests/sanfew-goutweed-herbs.test.cjs
// Wiki (Sanfew, Goutweed Exchange): "Sanfew will trade any goutweed for a single herb, which is rolled off the standard
// herb drop table." Here each goutweed became a clean ranarr weed, every time. Real engine: every plugin loaded, a real
// Player, Eadgar's Ruse's own handler for the "I have some more goutweed for you." choice.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function trade(t, roll) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9300); p.setUsername("sanfew" + Math.round(roll * 1000)); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.getInventory().setItem(0, new core.Item(I.GOUTWEED, 1));
  t.mock.method(Math, "random", () => roll);
  PM.emitCustomEvent("npc-dialogue:choice", { player: p, npcId: core.NpcIdentifiers.SANFEW, option: "I have some more goutweed for you." });
  return p.getInventory();
}

test("a goutweed is one herb off the Wiki's herb table, grimy, never a set clean ranarr", (t) => {
  const low = trade(t, 0);
  assert.equal(low.getAmount(I.GOUTWEED), 0, "the goutweed is taken");
  assert.equal(low.getAmount(I.GRIMY_GUAM_LEAF), 1, "the table's first row (32/128)");
  assert.equal(low.getAmount(I.RANARR_WEED), 0, "no clean ranarr");
});

test("the table's last row is a grimy dwarf weed", (t) => {
  const high = trade(t, 127.5 / 128);
  assert.equal(high.getAmount(I.GRIMY_DWARF_WEED), 1);
  assert.equal(high.getAmount(I.RANARR_WEED), 0);
});
