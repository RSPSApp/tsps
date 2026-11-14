// Run after `yarn build`: node --test tests/occult-altar-switch.test.cjs
// The Altar of the Occult and the Jaldraocht pyramid altar switch spellbooks as live does: the occult altar's
// named options say "Your mind fills with knowledge.", pray, open the Magic tab and play sound 1097 (five loops);
// its Venerate opens a menu of the other three books, and a pick says "...new knowledge." in a message box. The
// pyramid altar sends only its own line. Real engine: every plugin loaded, a real Player, the altars' handlers.
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
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const MESBOX = 115;
let core;
let Altars;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Altars = require("../plugins/objects/Altars.plugin")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9600;
function wizard(t, { done = true, defence = 99 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("occult" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevel(core.Skill.MAGIC, 99, false);
  p.getSkillManager().setMaxLevels(core.Skill.DEFENCE, defence, false).setCurrentLevel(core.Skill.DEFENCE, defence, false);
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests();
  for (const key of ["desert_treasure_i", "lunar_diplomacy"]) {
    const q = quests.find((quest) => quest.key === key); assert.ok(q, key);
    q.setStage(p, done ? q.completionValue : 0);
  }
  // Tyss unlocks the Arceuus book (Tyss.plugin.js); a done wizard has spoken to him.
  p.setAttribute("tyss:arceuus-spellbook-unlocked", done);
  const sent = { messages: [], typed: [], tabs: [], sounds: [], anims: [], boxes: 0 };
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { sent.messages.push(m); return sender; });
  t.mock.method(sender, "sendTypedMessage", (type, m) => { sent.typed.push([type, m]); return sender; });
  t.mock.method(sender, "sendTab", (id) => { sent.tabs.push(id); return sender; });
  t.mock.method(sender, "sendSoundEffect", (id, loops) => { sent.sounds.push([id, loops]); return sender; });
  t.mock.method(p, "performAnimation", (anim) => { sent.anims.push(anim.getId()); });
  const start = p.getDialogueManager().startDialogues.bind(p.getDialogueManager());
  t.mock.method(p.getDialogueManager(), "startDialogues", (...args) => { sent.boxes++; return start(...args); });
  return { p, sent };
}

test("a named option on the occult altar: the knowledge line, the pray animation, the Magic tab and sound 1097", (t) => {
  const { p, sent } = wizard(t);
  assert.equal(Altars.ancientSpellbook({ player: p }), true);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.ANCIENT);
  assert.deepEqual(sent.messages, ["Your mind fills with knowledge."]);
  assert.deepEqual(sent.anims, [645]);
  assert.deepEqual(sent.tabs, [6], "the Magic tab");
  assert.deepEqual(sent.sounds, [[1097, 5]]);
  assert.equal(sent.boxes, 0, "no message box");
  assert.equal(Altars.arceuusSpellbook({ player: p }), true);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.ARCEUUS);
});

test("Venerate opens a menu of the other three books; a pick switches with the new-knowledge message box", (t) => {
  const { p, sent } = wizard(t);
  assert.equal(Altars.venerateOccultAltar({ player: p, objectId: 29150 }), true, "handled for the placed altar's own id");
  assert.deepEqual(MultiChatboxPrompt.getPending(p), { title: "Select an option", options: ["Ancient", "Lunar", "Arceuus"] });
  assert.deepEqual(sent.tabs, [6], "the Magic tab opens with the menu");
  assert.equal(p.getSpellbook(), core.MagicSpellbook.NORMAL, "nothing switches yet");
  MultiChatboxPrompt.selectOption(p, 0);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.ANCIENT);
  assert.deepEqual(sent.typed, [[MESBOX, "Your mind fills with new knowledge."]], "the message box's chat line");
  assert.deepEqual(sent.messages, [], "no game message");
  assert.equal(sent.boxes, 1, "the message box");
  assert.deepEqual(sent.anims, [645]);
  assert.deepEqual(sent.tabs, [6, 6]);
  assert.deepEqual(sent.sounds, [[1097, 5]]);

  p.getDialogueManager().reset?.();
  Altars.venerateOccultAltar({ player: p, objectId: 29150 });
  assert.deepEqual(MultiChatboxPrompt.getPending(p).options, ["Standard", "Lunar", "Arceuus"], "on the Ancients");
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  MultiChatboxPrompt.selectOption(p, 0);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.NORMAL);
  assert.equal(sent.sounds.length, 1, "a pick of the book now in use plays nothing");
});

test("the occult altar still refuses a locked book, and Lunar's Defence, with nothing played", (t) => {
  const locked = wizard(t, { done: false });
  Altars.lunarSpellbook({ player: locked.p });
  assert.equal(locked.p.getSpellbook(), core.MagicSpellbook.NORMAL);
  assert.deepEqual(locked.sent.messages, ["You need to complete Lunar Diplomacy to use that spellbook."]);
  assert.deepEqual([locked.sent.anims, locked.sent.sounds, locked.sent.tabs], [[], [], []]);

  const weak = wizard(t, { defence: 1 });
  Altars.lunarSpellbook({ player: weak.p });
  assert.equal(weak.p.getSpellbook(), core.MagicSpellbook.NORMAL);
  assert.deepEqual(weak.sent.messages, ["You need at least level 40 Defence to use the Lunar spellbook."]);
  assert.deepEqual([weak.sent.anims, weak.sent.sounds, weak.sent.tabs], [[], [], []]);
});

test("the Jaldraocht altar sends only its own line, with no animation or sound", (t) => {
  const { p, sent } = wizard(t);
  Altars.handleJaldraochtAltar(p);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.ANCIENT);
  Altars.handleJaldraochtAltar(p);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.NORMAL);
  const lines = sent.messages.filter((m) => !m.includes("Achievement Diary"));
  assert.deepEqual(lines, ["You feel a strange wisdom fill your mind...", "You feel a strange drain upon your memory..."]);
  assert.deepEqual([sent.anims, sent.sounds], [[], []]);
});
