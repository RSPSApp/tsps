// Run after `yarn build`: node --test tests/crystal-bow-shots-per-bow.test.cjs
// A crystal bow drops a stage every 250 shots. The count was kept on the player, keyed by the worn bow's id, so firing
// one shot from a second bow reset the first bow's count: swapping two bows, neither ever degraded. The count is on
// each bow now. Real Player and equipment, the real CombatFactory.decrementAmmo.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

function archer(t) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("crystal-archer");
  t.mock.method(p.getCombat(), "getRangedWeapon", () => RangedWeapon.CRYSTAL_BOW);
  return p;
}
const wield = (p, item) => p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, item);
const fire = (p, shots) => CombatFactory.decrementAmmo(p, p.getLocation(), shots);

test("a kept shot with extra charges given back (combat:consume-charge extra) takes shots off the bow's stage count", (t) => {
  const p = archer(t);
  const bow = new core.Item(I.CRYSTAL_BOW_FULL, 1);
  wield(p, bow);
  fire(p, 10);
  const emit = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (name === "combat:consume-charge" && event.player === p) { event.skip = true; event.extra = 3; return; }
    return emit.call(PluginManager, name, event);
  });
  fire(p, 1);
  assert.equal(bow.getMetaValue(CombatFactory.CRYSTAL_BOW_SHOTS_META), 7);
  fire(p, 5);
  assert.equal(bow.getMetaValue(CombatFactory.CRYSTAL_BOW_SHOTS_META), 0, "never below the stage's start");
});

test("each crystal bow keeps its own shot count: swapping bows doesn't reset it", (t) => {
  const p = archer(t);
  const first = new core.Item(I.CRYSTAL_BOW_FULL, 1);
  const second = new core.Item(I.CRYSTAL_BOW_FULL, 1);
  wield(p, first);
  fire(p, 249);
  assert.equal(first.getId(), I.CRYSTAL_BOW_FULL, "249 shots: still full");
  wield(p, second);
  fire(p, 1);
  wield(p, first);
  fire(p, 1);
  assert.equal(first.getId(), I.CRYSTAL_BOW_9_10, "the 250th shot from this bow drops it a stage");
  assert.equal(second.getId(), I.CRYSTAL_BOW_FULL, "the other bow fired once");
});
