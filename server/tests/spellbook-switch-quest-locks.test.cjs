// Run after `yarn build`: node --test tests/spellbook-switch-quest-locks.test.cjs
// Wiki: the POH altars switch only to a spellbook the player has "the requirements to access" (Occult altar; the
// Lunar altar names Lunar Diplomacy), and the magic cape "to any spellbook they have unlocked". They switched to the
// Ancients without Desert Treasure I and to the Lunars without Lunar Diplomacy. Real engine: every plugin loaded, a
// real Player, the altars' and the cape's own handlers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let Altars;
let Cape;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Altars = require("../plugins/objects/Altars.plugin")._test;
  Cape = require("../plugins/items/skillcapes/Options.SkillCapes")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9400;
function wizard(t, { dt1 = false, lunar = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("wizard" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  for (const skill of [core.Skill.MAGIC, core.Skill.DEFENCE]) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevel(skill, 99, false);
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests();
  for (const [key, done] of [["desert_treasure_i", dt1], ["lunar_diplomacy", lunar]]) {
    const q = quests.find((quest) => quest.key === key); assert.ok(q, key);
    q.setStage(p, done ? q.completionValue : 0);
  }
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

test("no Ancients from the POH altars or the magic cape before Desert Treasure I", (t) => {
  for (const use of [(p) => Altars.ancientAltar({ player: p }), (p) => Altars.ancientSpellbook({ player: p }), (p) => Cape.changeSpellbook(p, "Ancient")]) {
    const f = wizard(t);
    use(f.p);
    assert.equal(f.p.getSpellbook(), core.MagicSpellbook.NORMAL);
    assert.ok(f.messages.includes("You need to complete Desert Treasure I to use that spellbook."), f.messages.join(" | "));
  }
  const f = wizard(t, { dt1: true });
  Altars.ancientAltar({ player: f.p });
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.ANCIENT, "after the quest, the altar switches");
});

test("no Lunars from the POH altars or the magic cape before Lunar Diplomacy", (t) => {
  for (const use of [(p) => Altars.lunarAltar({ player: p }), (p) => Altars.lunarSpellbook({ player: p }), (p) => Cape.changeSpellbook(p, "Lunar")]) {
    const f = wizard(t);
    use(f.p);
    assert.equal(f.p.getSpellbook(), core.MagicSpellbook.NORMAL);
    assert.ok(f.messages.includes("You need to complete Lunar Diplomacy to use that spellbook."), f.messages.join(" | "));
  }
  const f = wizard(t, { lunar: true });
  Cape.changeSpellbook(f.p, "Lunar");
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.LUNAR, "after the quest, the cape switches");
});
