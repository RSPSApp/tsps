// Run after `yarn build`: node --test tests/combination-rune-spell-costs.test.cjs
// Combination and aether runes in spell costs (plugins/items/CombinationRunes.plugin.js). Wiki (Combination
// rune): they "count as one of each type of the runes required to make them" and a cast "will prioritise
// using those runes first, even while having sufficient runes otherwise". Wiki (Aether rune): "one cosmic
// rune and one soul rune"; a spell needing either or both "will spend only one aether rune".
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");

before(async () => {
  await CachePipeline.initialize(process.cwd());
  require("../plugins/items/CombinationRunes.plugin").register(PluginManager.createApi("CombinationRunesTest"));
  require("../plugins/items/ElementalStaves.plugin").register(PluginManager.createApi("CombinationStavesTest"));
  require("../plugins/items/RunePouch.plugin").register(PluginManager.createApi("CombinationPouchTest"));
});

function caster(t, runes, { book = core.MagicSpellbook.NORMAL } = {}) {
  let cycle = 100;
  t.mock.method(core.World, "getProcessCycle", () => cycle++);
  const player = new Player(null);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true }));
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  player.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99);
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  player.setSpellbook(book);
  for (const [id, amount] of runes) player.getInventory().add(new core.Item(id, amount));
  return { player, messages, has: (id) => player.getInventory().getAmount(id) };
}

test("a combination rune pays both of its runes first, even with plain runes enough", (t) => {
  // Fire Strike: 2 air, 3 fire, 1 mind. 2 smoke pay 2 air and 2 fire, a third pays the last fire.
  const { player, has } = caster(t, [[I.SMOKE_RUNE, 10], [I.AIR_RUNE, 10], [I.FIRE_RUNE, 10], [I.MIND_RUNE, 10]]);
  assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(player, true), true);
  assert.equal(has(I.SMOKE_RUNE), 7);
  assert.equal(has(I.AIR_RUNE), 10);
  assert.equal(has(I.FIRE_RUNE), 10);
  assert.equal(has(I.MIND_RUNE), 9);
});

test("combination runes and plain runes together pay a cast neither covers alone", (t) => {
  const { player, has } = caster(t, [[I.SMOKE_RUNE, 2], [I.FIRE_RUNE, 1], [I.MIND_RUNE, 1]]);
  assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(player, false), true, "the check");
  assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(player, true), true, "the cast");
  assert.equal(has(I.SMOKE_RUNE), 0);
  assert.equal(has(I.FIRE_RUNE), 0);
  assert.equal(has(I.MIND_RUNE), 0);
});

test("still short, the refusal names the plain rune and nothing is spent", (t) => {
  const { player, has, messages } = caster(t, [[I.SMOKE_RUNE, 1], [I.MIND_RUNE, 1]]);
  assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(player, true), false);
  assert.match(messages.at(-1), /^You do not have enough (Air|Fire) Runes to cast this spell\.$/);
  assert.equal(has(I.SMOKE_RUNE), 1);
  assert.equal(has(I.MIND_RUNE), 1);
});

test("after a staff: the staff's rune is free, the combination rune pays the other", (t) => {
  // Fire Wave: 5 air, 7 fire, 1 blood. A staff of fire supplies the fire; 5 smoke pay the air.
  const { player, has } = caster(t, [[I.SMOKE_RUNE, 10], [I.BLOOD_RUNE, 1]]);
  player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(I.STAFF_OF_FIRE, 1);
  assert.equal(core.CombatSpells.FIRE_WAVE.canCast(player, true), true);
  assert.equal(has(I.SMOKE_RUNE), 5);
  assert.equal(has(I.BLOOD_RUNE), 0);
});

test("a combination rune only one of whose runes is needed pays that one", (t) => {
  // Wind Strike: 1 air, 1 mind. A dust rune is an air rune here.
  const { player, has } = caster(t, [[I.DUST_RUNE, 3], [I.AIR_RUNE, 3], [I.MIND_RUNE, 3]]);
  assert.equal(core.CombatSpells.WIND_STRIKE.canCast(player, true), true);
  assert.equal(has(I.DUST_RUNE), 2);
  assert.equal(has(I.AIR_RUNE), 3);
});

test("combination runes in the rune pouch count too", (t) => {
  const { player, has } = caster(t, [[I.RUNE_POUCH, 1], [I.MIND_RUNE, 1]]);
  Pouch.store(player, I.SMOKE_RUNE, 3);
  assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(player, true), true);
  assert.equal(Pouch.amountOf(player, I.SMOKE_RUNE), 0);
  assert.equal(has(I.MIND_RUNE), 0);
});

test("the inventory's combination runes go first, the pouch's make up the rest", (t) => {
  const { player, has } = caster(t, [[I.RUNE_POUCH, 1], [I.SMOKE_RUNE, 1], [I.MIND_RUNE, 1]]);
  Pouch.store(player, I.SMOKE_RUNE, 5);
  assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(player, true), true);
  assert.equal(has(I.SMOKE_RUNE), 0);
  assert.equal(Pouch.amountOf(player, I.SMOKE_RUNE), 3);
});

test("autocast checks and pays the same way", (t) => {
  const { player, has } = caster(t, [[I.SMOKE_RUNE, 3], [I.MIND_RUNE, 1]]);
  core.Autocasting.setAutocast(player, core.CombatSpells.FIRE_STRIKE);
  assert.equal(player.getCombat().getAutocastSpell(), core.CombatSpells.FIRE_STRIKE);
  assert.equal(player.getCombat().getAutocastSpell().canCast(player, false), true);
  assert.equal(player.getCombat().getAutocastSpell().canCast(player, true), true);
  assert.equal(has(I.SMOKE_RUNE), 0);
});

test("Lunar: dust or mud runes pay Vengeance's earth runes", (t) => {
  const { player, has } = caster(t, [[I.MUD_RUNE, 6], [I.DUST_RUNE, 4], [I.ASTRAL_RUNE, 4], [I.DEATH_RUNE, 2]],
    { book: core.MagicSpellbook.LUNAR });
  assert.equal(core.EffectSpells.VENGEANCE.canCast(player, true), true);
  assert.equal(has(I.MUD_RUNE) + has(I.DUST_RUNE), 0);
  assert.equal(has(I.ASTRAL_RUNE), 0);
});

test("Arceuus: one aether rune pays Mark of Darkness's soul and cosmic rune", (t) => {
  const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");
  const mark = ArceuusSpells.SELF_SPELLS.get("mark of darkness");
  const { player, has } = caster(t, [[I.AETHER_RUNE, 2], [I.SOUL_RUNE, 5], [I.COSMIC_RUNE, 5]],
    { book: core.MagicSpellbook.ARCEUUS });
  assert.equal(mark.canCast(player, true), true);
  assert.equal(has(I.AETHER_RUNE), 1);
  assert.equal(has(I.SOUL_RUNE), 5);
  assert.equal(has(I.COSMIC_RUNE), 5);
});

test("the item spells (alchemy) pay with combination runes too", (t) => {
  const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");
  const { player } = caster(t, [[I.LAVA_RUNE, 5], [I.NATURE_RUNE, 1]]);
  const costs = new MagicOnItemPacketListener().runeCosts(player, 1178,
    [new core.Item(I.NATURE_RUNE, 1), new core.Item(I.FIRE_RUNE, 5)]);
  assert.deepEqual(costs.map((item) => [item.getId(), item.getAmount()]), [[I.NATURE_RUNE, 1], [I.LAVA_RUNE, 5]]);
});

test("without combination runes the cost is unchanged", (t) => {
  const { player } = caster(t, [[I.AIR_RUNE, 2], [I.FIRE_RUNE, 3], [I.MIND_RUNE, 1]]);
  const ids = core.CombatSpells.FIRE_STRIKE.itemsToConsume(player).map((item) => item.getId()).sort((a, b) => a - b);
  assert.deepEqual(ids, [I.AIR_RUNE, I.MIND_RUNE, I.FIRE_RUNE].sort((a, b) => a - b));
});
