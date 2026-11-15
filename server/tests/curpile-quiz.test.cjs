// RSPSApp/tsps #5488 item 2: Curpile Fyod's quiz. The transcript's action sXzRb_ ("A random dialogue is selected,
// three times, non-repeating, from the following:") is answered by the quest plugin with three distinct questions
// drawn from the six "Dialogue N" records, the ordinal filled in, the "Dialogue N" labels never shown, and the
// transcript's own follow-up and tally conditions. Real route: PluginManager, the real NpcDialogues runtime, Talk-to
// on Curpile Fyod, dialogue_continue packets. Math.random is stubbed to 0 so the picks are Dialogue 1, 2, 3.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
const savedBots = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Location } = require("../dist/game/model/Location");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const runtime = require("../plugins/quests/QuestRuntime");
const dialogues = require("../data/definitions/npc-dialogues.json");

let core, index = 36000;
const LUMBRIDGE = [3222, 3218, 0];
const MORTTON = { x: 3522, y: 3285 };
const COME = "I've come to help the Myreque. I've brought weapons.";
const LATER = "Hey... Don't tempt me! You's dicing wiv death here my friend!";
const PASS = "Okay, I believes ya... You can go on in. Head through the doors behind the tree. Once you's in, take the first cave on the right.";
const WEAPON_NAMES = [["STEEL_LONGSWORD", 1], ["STEEL_SHORTSWORD", 2], ["STEEL_DAGGER", 1], ["STEEL_MACE", 1], ["STEEL_WARHAMMER", 1]];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(LUMBRIDGE[0], LUMBRIDGE[1]);
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => {
  Math.random = realRandom;
  PM.emitServerShutdown({});
  if (savedBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = savedBots;
});

const quest = () => runtime.getRegisteredQuests().find((q) => q.key === "in_search_of_the_myreque");

/** Talks to Curpile at quest stage `stage` carrying the weapons; `script` picks the options in order. */
async function talkCurpile(stage, script) {
  Math.random = () => 0;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...LUMBRIDGE));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("curpile" + index);
  p.setAttribute("bot-skip-persistence", true);
  for (const [name, amount] of WEAPON_NAMES) p.getInventory().add(new core.Item(core.ItemIdentifiers[name], amount), false);
  quest().setStage(p, stage);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const npc = core.NPC.create(core.NpcIdentifiers.CURPILE_FYOD, new Location(...LUMBRIDGE));
  const lines = [];
  const optionLists = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { if (typeof text === "string") lines.push(text); return original(text, ...rest); };
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Talk-to", clickType: 1, handled: false });
  let picks = 0;
  for (let n = 0; n < 300; n++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) {
      optionLists.push(pending.options.slice());
      const idx = picks < script.length ? pending.options.indexOf(script[picks]) : -1;
      if (idx < 0) break;
      picks++;
      await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: idx + 1 });
      continue;
    }
    if (!p.getDialogueManager().getCurrent()) break;
    await send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  }
  const result = {
    lines, optionLists, open: !!p.getDialogueManager().getCurrent(), stage: quest().getStage(p),
    at: { x: p.getLocation().getX(), y: p.getLocation().getY() },
  };
  p.setRegistered(false); core.TaskManager.cancelTasks(p);
  Math.random = realRandom;
  return result;
}

const allOptions = (r) => r.optionLists.flat();
const QUIZ = [COME, "Sani Piliu.", "Ivan Strom.", "Veliaf Hurtz."];

test("Curpile quiz: no 'Dialogue N' label is ever shown to the player", async () => {
  const r = await talkCurpile(25, QUIZ);
  const labels = allOptions(r).filter((o) => /^Dialogue \d$/.test(o));
  assert.deepEqual(labels, [], `internal selectors shown to the player: ${labels.join(", ")}`);
});

test("Curpile quiz: three distinct questions with first/second/third and final, and follow-ups between them", async () => {
  const r = await talkCurpile(25, QUIZ);
  assert.ok(r.lines.some((l) => l.startsWith("Okay, first question. Name the only female member of the Myreque.")), `first question: ${JSON.stringify(r.lines.slice(-8))}`);
  assert.ok(r.lines.some((l) => l.startsWith("Okay, second question. Who is the youngest member")), "second question");
  assert.ok(r.lines.some((l) => l.startsWith("Okay, third and final question. Who is the leader")), "third and final question");
  assert.ok(r.lines.includes("Okay, interesting answer. That's the first question done."), "first follow-up");
  assert.ok(r.lines.includes("An interesting response. That's the second question answered."), "second follow-up");
  assert.ok(r.lines.includes("Hmm. Very interesting. That's the third question answered."), "third follow-up");
  assert.equal(r.lines.filter((l) => l.includes("[first/second")).length, 0, "no unfilled ordinal placeholder");
});

test("Curpile quiz: three correct passes to stage 55 and plays the passage lines", async () => {
  const r = await talkCurpile(25, QUIZ);
  assert.ok(r.lines.includes(PASS), `passage lines: ${JSON.stringify(r.lines.slice(-4))}`);
  assert.equal(r.stage, 55, "stage 55 after three correct answers");
  assert.equal(r.open, false, "the dialogue ends");
});

test("Curpile quiz: fewer than three correct knocks the player out to Mort'ton", async () => {
  // Dialogue 1 correct; Dialogue 2 and 3 wrong: one correct out of three.
  const r = await talkCurpile(25, [COME, "Sani Piliu.", "Radigad Ponfit.", "Harold Evans."]);
  assert.ok(r.lines.includes("I'm sorry but you only got one question correct! Go on get outta here..."), JSON.stringify(r.lines.slice(-4)));
  assert.deepEqual({ x: r.at.x, y: r.at.y }, { x: MORTTON.x, y: MORTTON.y }, "knocked out to Mort'ton");
  assert.equal(r.stage, 52, "not passed");
});

test("Curpile quiz: talking again after the pass plays the after-convincing variant, not the quiz", async () => {
  const after = dialogues["In Search of the Myreque"].variants["convincing-curpile-fyod-talking-to-curpile-fyod-again-after-convincing-him"];
  const first = after.find((x) => typeof x.text === "string").text;
  const r = await talkCurpile(55, []);
  assert.ok(r.lines.includes(first), `after-convincing line: ${JSON.stringify(r.lines.slice(0, 4))}`);
  assert.ok(!r.lines.includes(LATER), "the quiz does not restart after it is answered");
});

// Known remaining item-2 defect (todo, not a pass): after a knockout the player stays at stage 52 and the next
// Talk-to plays the "again-before-convincing-him" variant, which ends at "Okay, first question..." with no quiz.
// The engine has no way for the quest to splice steps into that variant's jump, so this stays open.
test("Curpile quiz: a retry after a knockout plays the quiz again", { todo: "retry after knockout ends at 'Okay, first question...' (remaining item-2 defect)" }, async () => {
  const r = await talkCurpile(52, QUIZ);
  assert.ok(r.lines.some((l) => l.startsWith("Okay, first question. Name the only female member of the Myreque.")), `retry quiz: ${JSON.stringify(r.lines.slice(-4))}`);
  assert.equal(r.stage, 55, "stage 55 after a passing retry");
});
