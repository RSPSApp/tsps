// Run after `yarn build`: node --test tests/dream-mentor-lunar-spells.test.cjs
// Wiki (Dream Mentor, Rewards): the quest gives the ability to use Monster Examine, Humidify, Hunter Kit, Stat Spy,
// Dream, Plank Make and Spellbook Swap. They cast with Lunar Diplomacy alone. Real engine: every plugin loaded, a real
// Player, LunarSpells.handleSelf.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9600;
function caster(t, dreamMentor) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("dreamer" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  for (const skill of [core.Skill.MAGIC, core.Skill.DEFENCE]) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevel(skill, 99, false);
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests();
  for (const [key, done] of [["lunar_diplomacy", true], ["dream_mentor", dreamMentor]]) {
    const q = quests.find((quest) => quest.key === key); q.setStage(p, done ? q.completionValue : 0);
  }
  for (const [id, n] of [[9075, 20], [557, 20], [555, 20], [561, 20], [564, 20], [563, 20], [565, 20]]) p.getInventory().add(new core.Item(id, n), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages, astrals: () => p.getInventory().getAmount(9075) };
}

test("Hunter Kit, Humidify and Spellbook Swap need Dream Mentor, and spend nothing without it", (t) => {
  for (const name of ["hunter kit", "humidify", "spellbook swap"]) {
    const f = caster(t, false);
    LunarSpells.handleSelf(f.p, name, 1);
    assert.ok(f.messages.includes("You need to complete Dream Mentor to cast this spell."), `${name}: ${f.messages.join(" | ")}`);
    assert.equal(f.astrals(), 20, `${name}: no astral runes spent`);
  }
});

test("after Dream Mentor, Hunter Kit casts", (t) => {
  const f = caster(t, true);
  LunarSpells.handleSelf(f.p, "hunter kit", 1);
  assert.ok(f.astrals() < 20, "astral runes spent");
  assert.ok(!f.messages.includes("You need to complete Dream Mentor to cast this spell."));
});
