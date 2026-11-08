// Run after `yarn build`: node --test tests/worn-negative-weights.test.cjs
// Wiki (Boots of lightness, Penance gloves): 0.34 kg carried, -4.535 kg worn. The worn weight is a separate cache item
// (89, 10554); the carried total used the inventory item's +0.34 kg for the worn pair too.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("wornweight");
  return p;
}

test("worn boots of lightness and penance gloves weigh -4.535 kg; carried, 0.34 kg", () => {
  for (const [id, slot] of [[88, core.Equipment.FEET_SLOT], [10553, core.Equipment.HANDS_SLOT]]) {
    const worn = player();
    worn.getEquipment().setItem(slot, new core.Item(id, 1));
    assert.equal(worn.getCarriedWeightGrams(), -4535, `${id} worn`);
    assert.equal(worn.getWeightKg(), -4);
    const carried = player();
    carried.getInventory().setItem(0, new core.Item(id, 1));
    assert.equal(carried.getCarriedWeightGrams(), 340, `${id} carried`);
  }
});

test("both worn with graceful still add up", () => {
  const p = player();
  p.getEquipment().setItem(core.Equipment.FEET_SLOT, new core.Item(88, 1));
  p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(10553, 1));
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.GRACEFUL_HOOD, 1));
  assert.equal(p.getCarriedWeightGrams(), -4535 * 2 - 3000);
});
