// Run after `yarn build`: node --test tests/thammaron-dismantle-refused.test.cjs
// Dismantling an uncharged Thammaron's sceptre is refused when the ether can't fit (a stack within 7,500 of the cap).
// The refusal put back the sceptre's own emptied Item (id -1), so the sceptre was lost for no ether. Real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Accursed = require("../plugins/items/AccursedSceptre.plugin");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  Accursed.register(new Proxy({ core }, { get: (object, name) => object[name] ?? (() => {}) }));
});

test("a refused Thammaron's sceptre Dismantle keeps the sceptre", () => {
  const I = core.ItemIdentifiers;
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("thammaron");
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  const sceptre = new core.Item(I.THAMMARONS_SCEPTRE_U_, 1);
  p.getInventory().setItem(0, sceptre);
  p.getInventory().setItem(1, new core.Item(I.REVENANT_ETHER, 2147483647 - 1000));
  assert.equal(Accursed._test.dismantleThammarons({ player: p, item: sceptre }), true);
  assert.equal(messages.at(-1), "You don't have enough inventory space to dismantle your sceptre.");
  assert.equal(p.getInventory().getAmount(I.THAMMARONS_SCEPTRE_U_), 1, "the sceptre is still there");
});
