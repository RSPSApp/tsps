// Run after `yarn build`: node --test tests/arceuus-akd-lock.test.cjs
// Wiki (Arceuus spellbook): every Arceuus combat spell but Ghostly Grasp and Inferior Demonbane, and every utility
// spell but Resurrect Crops and the reanimations, needs A Kingdom Divided; the teleports need only the book. They all
// cast without it. Real engine: every plugin loaded, a real Player, ArceuusSpells.handleSpell and Spell.canCast.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");

let core, next = 9600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const REFUSAL = "You need to complete A Kingdom Divided to cast this spell.";
const akd = () => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "a_kingdom_divided");

function caster(t, done) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("akd" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  p.setSpellbook(core.MagicSpellbook.ARCEUUS);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevel(core.Skill.MAGIC, 99, false);
  const q = akd(); assert.ok(q); q.setStage(p, done ? q.completionValue : 0);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

test("Ward of Arceuus is refused before A Kingdom Divided, spending nothing, and casts after it", (t) => {
  const runes = [[566, 4], [561, 2], [564, 1]];
  const f = caster(t, false);
  for (const [id, n] of runes) f.p.getInventory().add(new core.Item(id, n), false);
  ArceuusSpells.handleSpell(f.p, "Ward of Arceuus");
  assert.ok(f.messages.includes(REFUSAL), f.messages.join(" | "));
  assert.equal(f.p.getInventory().getAmount(566), 4, "no soul runes spent");
  assert.equal(ArceuusSpells.hasWard(f.p), false);
  const g = caster(t, true);
  for (const [id, n] of runes) g.p.getInventory().add(new core.Item(id, n), false);
  ArceuusSpells.handleSpell(g.p, "Ward of Arceuus");
  assert.equal(g.messages.includes(REFUSAL), false);
  assert.equal(ArceuusSpells.hasWard(g.p), true, "cast after the quest");
});

test("the Wiki's exceptions and the teleports need no quest; the locked combat spells do", (t) => {
  const f = caster(t, false);
  const disabled = (name) => {
    const spell = core.CacheDefinitions.getSpellByName(name);
    assert.ok(spell, name);
    return PM.emitSpellDisabled(f.p, core.MagicSpellbook.ARCEUUS, spell.itemId, null);
  };
  for (const name of ["Ghostly Grasp", "Inferior Demonbane", "Basic Reanimation", "Master Reanimation", "Resurrect Crops"]) {
    assert.notEqual(disabled(name), true, `${name} is open`);
  }
  for (const name of ["Skeletal Grasp", "Superior Demonbane", "Dark Demonbane", "Death Charge", "Shadow Veil", "Dark Lure"]) {
    assert.equal(disabled(name), true, `${name} needs the quest`);
  }
  // The teleports carry no spell item (spell id 0).
  assert.notEqual(PM.emitSpellDisabled(f.p, core.MagicSpellbook.ARCEUUS, 0, null), true);
});
