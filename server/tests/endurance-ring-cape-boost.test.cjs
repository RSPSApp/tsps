// Run after `yarn build`: node --test tests/endurance-ring-cape-boost.test.cjs
// Wiki (Ring of endurance): the Agility cape's Stamina Boost "is not doubled and uses no charges". It was doubled to two
// minutes and spent a charge; a stamina dose is still doubled and spends one.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Options = require("../plugins/items/skillcapes/Options.SkillCapes");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function ringWearer() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("endurancecape");
  const ring = new core.Item(core.ItemIdentifiers.RING_OF_ENDURANCE, 1);
  ring.setMetaValue("ring-of-endurance", 100);
  p.getEquipment().setItem(core.Equipment.RING_SLOT, ring);
  p.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(core.ItemIdentifiers.AGILITY_CAPE, 1));
  p.getSkillManager().setMaxLevels(core.Skill.AGILITY, 99, false).setCurrentLevels(core.Skill.AGILITY, 99, false);
  return { p, ring };
}

const remainingMs = (p) => Number(p.getAttribute("potions:stamina:end")) - Date.now();

test("the Agility cape's Stamina Boost is not doubled and spends no ring charge", () => {
  const { p, ring } = ringWearer();
  Options._test.staminaBoost(p);
  assert.ok(remainingMs(p) <= 60_000 && remainingMs(p) > 55_000, `about one minute, got ${remainingMs(p)}`);
  assert.equal(ring.getMetaValue("ring-of-endurance"), 100);
});

test("a stamina dose is still doubled and spends a charge", () => {
  const { p, ring } = ringWearer();
  PM.emitCustomEvent("potions:apply-stamina", { player: p });
  assert.ok(remainingMs(p) > 200_000, "two doses' worth");
  assert.equal(ring.getMetaValue("ring-of-endurance"), 99);
});
