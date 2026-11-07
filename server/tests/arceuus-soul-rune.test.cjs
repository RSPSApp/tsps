// Run after `yarn build`: node --test tests/arceuus-soul-rune.test.cjs
// Wiki (Arceuus spellbook): these teleports cost soul runes (566). They were listed with 4695, which the cache names
// the mist rune, so a caster holding soul runes was refused and one holding mist runes paid with those.
// Real engine: every plugin loaded, a real Player, the spellbook's own ArceuusSpells.handleSpell.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");

const SOUL = 566;
const MIST = 4695;
const QUESTS = ["priest_in_peril", "biohazard", "great_brain_robbery", "monkey_madness_i"];

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9400;
function cast(t, spell, runes) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("soulrune" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  p.setSpellbook(core.MagicSpellbook.ARCEUUS);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevel(core.Skill.MAGIC, 99, false);
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests();
  for (const key of QUESTS) { const q = quests.find((entry) => entry.key === key); q.setStage(p, q.completionValue); }
  for (const [id, n] of runes) p.getInventory().add(new core.Item(id, n), false);
  const teleports = [];
  t.mock.method(core.TeleportHandler, "teleport", (_p, to) => { teleports.push(to); });
  ArceuusSpells.handleSpell(p, spell);
  return { p, teleports };
}

const OTHERS = [[557, 5], [563, 5], [561, 5], [565, 5]];
for (const spell of ["Respawn Teleport", "Fenkenstrain's Castle Teleport", "West Ardougne Teleport", "Harmony Island Teleport",
  "Cemetery Teleport", "Barrows Teleport", "Ape Atoll Teleport"]) {
  test(`${spell} costs soul runes, not mist runes`, (t) => {
    const soul = cast(t, spell, [[SOUL, 5], ...OTHERS]);
    assert.equal(soul.teleports.length, 1, "casts on soul runes");
    assert.ok(soul.p.getInventory().getAmount(SOUL) < 5, "soul runes spent");
    const mist = cast(t, spell, [[MIST, 5], ...OTHERS]);
    assert.equal(mist.teleports.length, 0, "mist runes don't pay for it");
    assert.equal(mist.p.getInventory().getAmount(MIST), 5);
  });
}
