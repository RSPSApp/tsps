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

// Lunar's Spellbook Swap (LunarSpells.ts) shares the books' locks (core SpellbookLocks). Captured (a league
// recording): "You need to have completed Desert Treasure I in order to use Ancient Magicks." in a message box.
function swapper(t, dt1) {
  const f = wizard(t, { dt1, lunar: true });
  f.p.setSpellbook(core.MagicSpellbook.LUNAR);
  for (const [id, n] of [[9075, 10], [564, 10], [563, 10]]) f.p.getInventory().add(new core.Item(id, n), false);
  const boxes = [];
  const start = f.p.getDialogueManager().startDialogues.bind(f.p.getDialogueManager());
  t.mock.method(f.p.getDialogueManager(), "startDialogues", (chain, ...rest) => { boxes.push(chain); return start(chain, ...rest); });
  return { ...f, boxes, runes: () => f.p.getInventory().getAmount(9075) };
}

test("Spellbook Swap's Ancient quick pick is refused before Desert Treasure I, and spends nothing", (t) => {
  const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
  const f = swapper(t, false);
  LunarSpells.handleSelf(f.p, "spellbook swap", 3);
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.LUNAR);
  assert.equal(f.runes(), 10, "no runes spent");
  assert.equal(f.boxes.length, 1, "the refusal box");
  const done = swapper(t, true);
  LunarSpells.handleSelf(done.p, "spellbook swap", 3);
  assert.equal(done.p.getSpellbook(), core.MagicSpellbook.ANCIENT, "after the quest, the swap works");
});

test("Spellbook Swap's menu offers only the books the player has access to (Wiki)", (t) => {
  const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
  const f = swapper(t, false);
  LunarSpells.handleSelf(f.p, "spellbook swap", 1);
  assert.deepEqual(f.p.getDialogueManager().getCurrent().getOptions(), ["Standard", "Arceuus"], "no Ancient before Desert Treasure I");
  f.p.getDialogueManager().handleOption(2);
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.ARCEUUS, "the paid cast swaps to the book chosen");
  const done = swapper(t, true);
  LunarSpells.handleSelf(done.p, "spellbook swap", 1);
  assert.deepEqual(done.p.getDialogueManager().getCurrent().getOptions(), ["Standard", "Ancient", "Arceuus"]);
});

test("the occult altar's choice of the book already in use needs no unlock", (t) => {
  const f = wizard(t, { lunar: false });
  f.p.setSpellbook(core.MagicSpellbook.LUNAR);
  require("../plugins/objects/Altars.plugin")._test.lunarSpellbook({ player: f.p });
  assert.ok(!f.messages.includes("You need to complete Lunar Diplomacy to use that spellbook."), f.messages.join(" | "));
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.LUNAR);
});
