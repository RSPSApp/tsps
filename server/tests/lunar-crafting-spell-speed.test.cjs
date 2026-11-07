// Run after `yarn build`: node --test tests/lunar-crafting-spell-speed.test.cjs
// Spin Flax casts once every 5 ticks and Tan Leather every 3 (Wiki, Casting speed). With no gate, every queued click
// cast in the same tick: 28 flax spun in one tick for six casts' XP. Real Player and inventory, the plugin's handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core, cast;
let cycle = 1000;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PluginManager.getCoreApi();
  core = real;
  real.World.getProcessCycle = () => cycle;
  require("../plugins/skills/craftingspells/Lunar.CraftingSpells")({ core: real, onSpellCast: (handler) => { cast = handler; }, emitCustomEvent() {} });
});

function caster() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("lunar-crafter");
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  for (const skill of [core.Skill.MAGIC, core.Skill.DEFENCE, core.Skill.CRAFTING]) p.getSkillManager().setLevel(skill, 99);
  const I = core.ItemIdentifiers;
  for (const [slot, id] of [I.ASTRAL_RUNE, I.NATURE_RUNE, I.AIR_RUNE].entries()) p.getInventory().setItem(slot, new core.Item(id, 1000));
  for (let slot = 3; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.FLAX, 1));
  return p;
}

test("Spin Flax: several casts in one tick spin one batch; the next cast waits 5 ticks", () => {
  const p = caster();
  const strings = () => p.getInventory().getAmount(core.ItemIdentifiers.BOW_STRING);
  for (let i = 0; i < 4; i++) cast({ player: p, spellName: "Spin Flax", handled: false });
  assert.equal(strings(), 5, "one cast's five");
  cycle += 4;
  cast({ player: p, spellName: "Spin Flax", handled: false });
  assert.equal(strings(), 5, "4 ticks on: still waiting");
  cycle += 1;
  cast({ player: p, spellName: "Spin Flax", handled: false });
  assert.equal(strings(), 10, "5 ticks on: the next cast");
});
