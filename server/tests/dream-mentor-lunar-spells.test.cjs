// Run after `yarn build`: node --test tests/dream-mentor-lunar-spells.test.cjs
// Wiki (Dream Mentor, Rewards): the quest gives the ability to use Monster Examine, Humidify, Hunter Kit, Stat Spy,
// Dream, Plank Make and Spellbook Swap. They cast with Lunar Diplomacy alone when the world's
// quests:equipment-requirements is off. Real engine: every plugin loaded, a real Player, LunarSpells.handleSelf.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/quest-requirements-on.cjs");
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
    assert.ok(f.messages.includes("You must have completed Dream Mentor to use this spell."), `${name}: ${f.messages.join(" | ")}`);
    assert.equal(f.astrals(), 20, `${name}: no astral runes spent`);
  }
});

test("after Dream Mentor, Hunter Kit casts", (t) => {
  const f = caster(t, true);
  LunarSpells.handleSelf(f.p, "hunter kit", 1);
  assert.ok(f.astrals() < 20, "astral runes spent");
  assert.ok(!f.messages.includes("You must have completed Dream Mentor to use this spell."));
});

test("a league relic that unlocks every spell lifts the Dream Mentor requirement (Wiki: Grimoire)", (t) => {
  const f = caster(t, false);
  const api = PM.createApi("RelicUnlockTest");
  let lifted = true;
  api.onCustomEvent("magic:spell-unlocked", (unlock) => { if (lifted && unlock.player === f.p) unlock.unlocked = true; });
  t.after(() => { lifted = false; });
  LunarSpells.handleSelf(f.p, "hunter kit", 1);
  assert.ok(f.astrals() < 20, "Hunter Kit casts with the relic");
  assert.ok(!f.messages.includes("You must have completed Dream Mentor to use this spell."));
});

test("Olm's flames can't be doused with Humidify before Dream Mentor", (t) => {
  const { OlmRoom } = require("../plugins/minigames/cox/Olm.ChambersOfXeric");
  const without = caster(t, false);
  for (const [id, n] of [[555, 3], [554, 1]]) without.p.getInventory().add(new core.Item(id, n), false);
  assert.equal(OlmRoom.prototype.canHumidify.call({}, without.p), false, "no Humidify douse without the quest");
  const done = caster(t, true);
  for (const [id, n] of [[555, 3], [554, 1]]) done.p.getInventory().add(new core.Item(id, n), false);
  assert.equal(OlmRoom.prototype.canHumidify.call({}, done.p), true, "after Dream Mentor it douses");
});

test("quests:equipment-requirements off lifts the Dream Mentor requirement from all seven spells", (t) => {
  const readConfig = PM.getPluginConfig.bind(PM);
  t.mock.method(PM, "getPluginConfig", (key, fallback) => key === "quests:equipment-requirements" ? false : readConfig(key, fallback));
  const { refuseBeforeDreamMentor } = require("../dist/game/content/combat/magic/LunarSpells");
  for (const name of ["monster examine", "humidify", "hunter kit", "stat spy", "dream", "plank make", "spellbook swap"]) {
    const f = caster(t, false);
    assert.equal(refuseBeforeDreamMentor(f.p, name), false, `${name} is open`);
    assert.equal(f.messages.length, 0, `${name}: ${f.messages.join(" | ")}`);
  }
  const f = caster(t, false);
  LunarSpells.handleSelf(f.p, "hunter kit", 1);
  assert.ok(f.astrals() < 20, "Hunter Kit casts without Dream Mentor");
  assert.ok(!f.messages.includes("You must have completed Dream Mentor to use this spell."));
});
