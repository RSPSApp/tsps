// Run after `yarn build`: node --test tests/fremennik-isles-ore-lines.test.cjs
// The Fremennik Isles' ore request: the blanks "[six/seven/eight]" and "[tin/coal/mithril]" in the King's and Thorkel's
// lines are filled from the player's Mining tier. The line event's `definition` is the NPC being talked to (King Sorvott
// is cache npc 1897, "King Gjuki Sorvott IV"), so the gate must match that name, or his lines keep the literal blanks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const KING_SORVOTT = 1897; // "King Gjuki Sorvott IV"
const THORKEL = 1899; // "Thorkel Silkbeard"
const STAGE_TUNA_TASK = 2;
const STAGE_ORE_TASK = 3;
const SPOT = { x: 2660, y: 3700 };
let core;
let next = 9400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { stage, mining }) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("isleore" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(SPOT.x, SPOT.y, 0));
  p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.MINING, mining, false).setCurrentLevels(core.Skill.MINING, mining, false);
  t.mock.method(p.getPacketSender(), "sendMessage", () => p.getPacketSender());
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  QuestRuntime.questNamed("The Fremennik Isles").setStage(p, stage);
  return p;
}

/** The runtime's line event: `definition` is the NPC being talked to, with the step's own text. */
function speak(p, talkedToId, text, speaker) {
  const npc = new NPC(talkedToId, new core.Location(SPOT.x, SPOT.y, 0));
  npc.setRegistered(true);
  const event = { player: p, npcId: talkedToId, definition: npc.getCurrentDefinition(p),
    step: { type: "line", speaker, text }, text, skip: false };
  PM.emitCustomEvent("npc-dialogue:line", event);
  return event.text;
}

// Mining tiers (TheFremennikIsles.Quest.js miningTier): 1 = tin/eight, 2 = coal/seven, 55 = mithril/six.
const TIERS = [
  { mining: 1, word: "eight", ore: "tin" },
  { mining: 2, word: "seven", ore: "coal" },
  { mining: 55, word: "six", ore: "mithril" },
];

for (const { mining, word, ore } of TIERS) {
  test(`King Sorvott's ore line fills with ${word} ${ore} at Mining ${mining}`, t => {
    const p = actor(t, { stage: STAGE_ORE_TASK, mining });
    const out = speak(p, KING_SORVOTT,
      "Please hurry back with [six/seven/eight] [tin/coal/mithril], Keldagrim's traders are drinking my cellars dry.",
      "King Sorvott IV");
    assert.equal(out, `Please hurry back with ${word} ${ore}, Keldagrim's traders are drinking my cellars dry.`);
  });

  test(`King Sorvott's tuna-delivery line, spoken by Thorkel, fills with ${word} ${ore} at Mining ${mining}`, t => {
    const p = actor(t, { stage: STAGE_TUNA_TASK, mining });
    const out = speak(p, KING_SORVOTT, "We need [six/seven/eight] pieces of [tin/coal/mithril] for Keldagrim's merchants.", "Thorkel Silkbeard");
    assert.equal(out, `We need ${word} pieces of ${ore} for Keldagrim's merchants.`);
  });

  test(`Thorkel's ore line still fills with ${word} ${ore} at Mining ${mining}`, t => {
    const p = actor(t, { stage: STAGE_ORE_TASK, mining });
    const out = speak(p, THORKEL, "Of course. Please bring [six/seven/eight] pieces of [tin/coal/mithril] ore.", "Thorkel Silkbeard");
    assert.equal(out, `Of course. Please bring ${word} pieces of ${ore} ore.`);
  });
}

test("a line that is not the Fremennik blank is left alone", t => {
  const p = actor(t, { stage: STAGE_ORE_TASK, mining: 1 });
  const text = "Keldagrim has no need of you today.";
  assert.equal(speak(p, KING_SORVOTT, text, "King Sorvott IV"), text);
});

/**
 * The King's ore hand-in through the real transcript runtime (QuestRuntime.startTranscript, the dialogue manager's own
 * Continue), recording what the client is sent: dialogue text, item boxes and game messages.
 */
function handIn(t, { mining, ore, female = false }) {
  const p = actor(t, { stage: STAGE_ORE_TASK, mining });
  if (female) p.getAppearance().setPronouns(1);
  p.getInventory().adds(ore, 8);
  const sent = [];
  const sender = p.getPacketSender();
  for (const name of ["sendString", "sendMessage"]) {
    const original = sender[name].bind(sender);
    t.mock.method(sender, name, (...args) => {
      for (const arg of args) if (typeof arg === "string") sent.push(arg);
      return name === "sendMessage" ? sender : original(...args);
    });
  }
  const api = { core, emitCustomEvent: (name, event) => PM.emitCustomEvent(name, event) };
  assert.equal(QuestRuntime.startTranscript(api, p, KING_SORVOTT, "The Fremennik Isles",
    "starting-off-ore-delivery-talking-to-king-sorvott-iv"), true);
  for (let i = 0; i < 12; i++) p.getDialogueManager().advance();
  return { p, sent };
}

test("the ore hand-in boxes fill from each player's own tier, and [man/woman] from their gender", (t) => {
  // Mining 1 first: before the fix its fill was written into the shared transcript step, so the next player saw it.
  const tin = handIn(t, { mining: 1, ore: core.ItemIdentifiers.TIN_ORE });
  assert.ok(tin.sent.includes("Thorkel Silkbeard takes eight lumps of tin."), JSON.stringify(tin.sent));
  // Wiki (The Fremennik Isles): "The king's reward for the ores is 5,000 coins.", whatever the ore.
  assert.ok(tin.sent.includes("Thorkel Silkbeard hands you 5000 coins."));
  assert.equal(tin.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 5000);
  assert.ok(tin.sent.includes("This man has gathered the remaining ore needed by Keldagrim's merchants."));
  assert.ok(tin.sent.includes("Please reward this man for his efforts."));

  const mithril = handIn(t, { mining: 55, ore: core.ItemIdentifiers.MITHRIL_ORE, female: true });
  assert.ok(mithril.sent.includes("Thorkel Silkbeard takes six lumps of mithril."), JSON.stringify(mithril.sent));
  assert.ok(mithril.sent.includes("Thorkel Silkbeard hands you 5000 coins."));
  assert.ok(!mithril.sent.some((text) => text.includes("eight lumps of tin")),
    "the first player's tier does not leak into the transcript");
  assert.ok(mithril.sent.includes("This woman has gathered the remaining ore needed by Keldagrim's merchants."));
  assert.ok(mithril.sent.includes("Please reward this woman for her efforts."));
  assert.equal(mithril.p.getInventory().getAmount(core.ItemIdentifiers.MITHRIL_ORE), 2, "six lumps taken");
  assert.equal(mithril.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 5000);
  assert.ok(!mithril.sent.some((text) => /\[[^\]]*\/[^\]]*\]|\[amount\]/.test(text)), "no blank left unfilled");
});

test("the Troll King bridge message fills its bare X with the trolls still to kill", (t) => {
  const p = actor(t, { stage: 19, mining: 1 });
  p.setAttribute("quest.the_fremennik_isles.troll-kills", 3);
  const sent = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (text) => { sent.push(text); return p.getPacketSender(); });
  const text = "You have X more trolls to kill before you can kill the Troll King.";
  const event = { player: p, npcId: THORKEL, step: { type: "message", text, id: "3CHUQU" }, text, stepId: "3CHUQU",
    kind: "message", handled: false };
  PM.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.deepEqual(sent, ["You have 7 more trolls to kill before you can kill the Troll King."]);
  assert.equal(event.step.text, text, "the shared transcript step is left as it was");
});

test("Hrafn's translation requires a worn catspeak amulet or Dragon Slayer II", (t) => {
  const raw = require("../data/definitions/npc-dialogues.json")["The Fremennik Isles"]
    .variants["starting-off-talking-to-king-sorvott-iv"];
  const catLine = raw.find(step => step.speaker_ids?.includes(core.NpcIdentifiers.HRH_HRAFN));
  const original = catLine.text;
  const [, sounds, translation] = original.match(/^(.*?)\s+\((.+)\)$/);
  const amulets = [
    core.ItemIdentifiers.CATSPEAK_AMULET,
    core.ItemIdentifiers.CATSPEAK_AMULET_E_,
    core.ItemIdentifiers.CATSPEAK_AMULET_2,
    core.ItemIdentifiers.CATSPEAK_AMULET_E__2,
  ];
  const cases = [
    { name: "no catspeak", expected: sounds },
    { name: "carried amulet", carried: amulets[0], expected: sounds },
    ...amulets.map(worn => ({ name: `worn ${worn}`, worn, expected: translation })),
    { name: "Dragon Slayer II", dragonSlayer: true, expected: translation },
  ];
  for (const { name, carried, worn, dragonSlayer, expected } of cases) {
    const p = actor(t, { stage: 1, mining: 1 });
    if (carried) p.getInventory().adds(carried, 1);
    if (worn) p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(worn, 1));
    if (dragonSlayer) {
      const ds2 = QuestRuntime.questNamed("Dragon Slayer II");
      ds2.setStage(p, ds2.completionValue);
      assert.equal(ds2.isComplete(p), true);
    }
    const api = { core, emitCustomEvent: (eventName, event) => PM.emitCustomEvent(eventName, event) };
    assert.equal(QuestRuntime.startTranscript(api, p, KING_SORVOTT, "The Fremennik Isles",
      "starting-off-talking-to-king-sorvott-iv"), true);
    p.getDialogueManager().advance();
    const cat = p.getDialogueManager().getCurrent();
    assert.equal(cat.getNpcId(), core.NpcIdentifiers.HRH_HRAFN, `${name}: cat chathead`);
    assert.equal(cat.getText(), expected, name);
    p.getDialogueManager().advance();
    assert.equal(p.getDialogueManager().getCurrent().getNpcId(), core.NpcIdentifiers.GUARD_32,
      `${name}: the quest guard retains its own chathead`);
  }
  assert.equal(catLine.text, original, "each player selects speech without modifying the shared transcript");
});
