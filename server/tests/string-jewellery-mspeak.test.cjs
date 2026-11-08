// Run after `yarn build`: node --test tests/string-jewellery-mspeak.test.cjs
// String Jewellery strings the unstrung M'speak amulet (4022) into the amulet (4021), never the other way round.
// Real Player and inventory through LunarSpells.handleSelf.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  PluginManager.createApi("DreamMentorDone").onCustomEvent("quest:is-complete", (q) => { if (q.key === "dream_mentor") q.complete = true; });
});

function caster(amuletId) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("mspeak-stringer");
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  for (const skill of [core.Skill.MAGIC, core.Skill.DEFENCE, core.Skill.CRAFTING]) p.getSkillManager().setLevel(skill, 99);
  const I = core.ItemIdentifiers;
  for (const [slot, id] of [I.ASTRAL_RUNE, I.WATER_RUNE, I.EARTH_RUNE].entries()) p.getInventory().setItem(slot, new core.Item(id, 100));
  p.getInventory().setItem(3, new core.Item(amuletId, 1));
  return p;
}

test("String Jewellery strings the unstrung M'speak amulet", () => {
  const p = caster(4022);
  LunarSpells.handleSelf(p, "String Jewellery");
  assert.equal(p.getInventory().getAmount(4022), 0);
  assert.equal(p.getInventory().getAmount(4021), 1, "the wearable M'speak amulet");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ASTRAL_RUNE), 98, "one cast's runes");
});

test("String Jewellery leaves a strung M'speak amulet alone and spends nothing", () => {
  const p = caster(4021);
  LunarSpells.handleSelf(p, "String Jewellery");
  assert.equal(p.getInventory().getAmount(4021), 1);
  assert.equal(p.getInventory().getAmount(4022), 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ASTRAL_RUNE), 100);
});
