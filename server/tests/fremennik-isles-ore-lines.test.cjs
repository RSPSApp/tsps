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
