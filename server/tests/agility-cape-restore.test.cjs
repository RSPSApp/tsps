// Run after `yarn build`: node --test tests/agility-cape-restore.test.cjs
// Wiki (Agility cape): it is a graceful cape, with "the same ... 3% increased natural run energy restoration" - worn on its
// own too - and the sixth piece of the set. Alone it gave nothing; with five pieces the set came to 27%, not 30%.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { applyRunEnergyRestoreModifiers } = require("../dist/game/content/combat/EquipmentEffects");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function wearing(items) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("agilitycape");
  p.getSkillManager().setMaxLevels(core.Skill.AGILITY, 99, false).setCurrentLevels(core.Skill.AGILITY, 99, false);
  for (const [slot, id] of items) p.getEquipment().setItem(slot, new core.Item(id, 1));
  return p;
}

test("a worn Agility cape alone restores 3% faster; with five graceful pieces, the full 30%", () => {
  const I = core.ItemIdentifiers, E = core.Equipment;
  assert.equal(applyRunEnergyRestoreModifiers(wearing([[E.CAPE_SLOT, I.AGILITY_CAPE]]), 1000), 1030);
  const five = [[E.HEAD_SLOT, I.GRACEFUL_HOOD], [E.BODY_SLOT, I.GRACEFUL_TOP], [E.LEG_SLOT, I.GRACEFUL_LEGS],
    [E.HANDS_SLOT, I.GRACEFUL_GLOVES], [E.FEET_SLOT, I.GRACEFUL_BOOTS]];
  assert.equal(applyRunEnergyRestoreModifiers(wearing([...five, [E.CAPE_SLOT, I.AGILITY_CAPE]]), 1000), 1300);
  assert.equal(applyRunEnergyRestoreModifiers(wearing([...five, [E.CAPE_SLOT, I.GRACEFUL_CAPE]]), 1000), 1300);
});
