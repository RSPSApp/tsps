// Run after `yarn build`: node --test tests/saw-tool-checks.test.cjs
// Decision approved 2026-11-15: a saw check takes any saw held or worn (items/Saws.js). Wiki (Amy's saw): it works as
// a saw and can be wielded, its off-hand copy in the shield slot. Hunter's tool check took only the plain saw. Real
// Player, real Inventory and Equipment.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const C = require("../plugins/skills/hunter/Context.Hunter");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  C.H.core = core;
});

function player() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  return p;
}

test("Hunter's saw check (crab bases) takes Amy's saw carried or in either hand, and the crystal saw", () => {
  const I = core.ItemIdentifiers;
  const none = player();
  assert.equal(C.hasTool(none, I.SAW), false, "no saw");
  const carried = player();
  carried.getInventory().add(new core.Item(I.AMYS_SAW, 1), false);
  assert.equal(C.hasTool(carried, I.SAW), true, "Amy's saw carried");
  const crystal = player();
  crystal.getInventory().add(new core.Item(I.CRYSTAL_SAW, 1), false);
  assert.equal(C.hasTool(crystal, I.SAW), true, "crystal saw carried");
  const offhand = player();
  offhand.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(I.AMYS_SAW_OFF_HAND_, 1));
  assert.equal(C.hasTool(offhand, I.SAW), true, "Amy's saw in the off-hand");
  const hammer = player();
  hammer.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.IMCANDO_HAMMER, 1));
  assert.equal(C.hasTool(hammer, I.HAMMER), true, "the hammer rule is unchanged");
  assert.equal(C.hasTool(hammer, I.SAW), false, "a hammer is not a saw");
});
