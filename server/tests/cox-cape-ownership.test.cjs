// Run after `yarn build`: node --test tests/cox-cape-ownership.test.cjs
// Captain Rimor hands out the Xeric's cape a player's Challenge Mode count has earned, once: not while one is owned.
// The ownership check passed a bare id to Bank.contains (it wants an Item), threw, and counted only the inventory, so a
// banked or worn cape got another. Real engine: every plugin loaded, a real Player, inventory, equipment and bank.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const XERICS_GUARD = 22388; // 100 Challenge Mode raids
let core, Rewards;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Rewards = require("../plugins/minigames/cox/Rewards.ChambersOfXeric");
});
after(() => PM.emitServerShutdown({}));

function raider() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("cape-claimer");
  p.setAttribute("cox:challenge-kills", 100);
  return p;
}
const capes = (p) => p.getInventory().getAmount(XERICS_GUARD);

test("a banked or worn Xeric's cape counts: Captain Rimor gives no second one", () => {
  const banked = raider();
  banked.getBank(0).add(new core.Item(XERICS_GUARD, 1), false);
  Rewards.claimCape({ player: banked });
  assert.equal(capes(banked), 0, "banked: none given");

  const worn = raider();
  worn.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(XERICS_GUARD, 1));
  Rewards.claimCape({ player: worn });
  assert.equal(capes(worn), 0, "worn: none given");

  const without = raider();
  Rewards.claimCape({ player: without });
  assert.equal(capes(without), 1, "none owned: one given");
});
