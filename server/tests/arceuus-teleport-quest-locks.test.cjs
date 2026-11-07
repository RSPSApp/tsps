// Run after `yarn build`: node --test tests/arceuus-teleport-quest-locks.test.cjs
// Wiki (Arceuus spellbook): Salve Graveyard and Fenkenstrain's Castle Teleport need Priest in Peril, West Ardougne
// Teleport Biohazard, and Harmony Island Teleport The Great Brain Robbery. They cast without the quest, so a free
// Arceuus book reached Morytania past the holy barrier. Real engine: every plugin loaded, a real Player, the spellbook's
// own ArceuusSpells.handleSpell.
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

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9300;
function caster(t, priestInPeril) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("arceuus" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  p.setSpellbook(core.MagicSpellbook.ARCEUUS);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevel(core.Skill.MAGIC, 99, false);
  for (const [id, n] of [[566, 2], [563, 1]]) p.getInventory().add(new core.Item(id, n), false);
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "priest_in_peril");
  assert.ok(quest);
  quest.setStage(p, priestInPeril ? quest.completionValue : 0);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  const teleports = [];
  t.mock.method(core.TeleportHandler, "teleport", (_p, to) => { teleports.push(to); });
  ArceuusSpells.handleSpell(p, "Salve Graveyard Teleport");
  return { p, messages, teleports };
}

test("Salve Graveyard Teleport is refused before Priest in Peril, and spends nothing", (t) => {
  const f = caster(t, false);
  assert.equal(f.teleports.length, 0);
  assert.ok(f.messages.includes("You need to complete Priest in Peril to cast this spell."), f.messages.join(" | "));
  assert.equal(f.p.getInventory().getAmount(566), 2, "no soul runes spent");
});

test("after Priest in Peril it casts", (t) => {
  const f = caster(t, true);
  assert.equal(f.teleports.length, 1);
});
