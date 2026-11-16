// Run after `yarn build`: node --test tests/myreque-quiz-retry.test.cjs
// In Search of the Myreque (#5488 item 2): the quiz retry. After a knock-out the player stays at stage 52 and the next Talk-to
// selects the "again before convincing him" variant, whose tail is a jump above (id 8xSPeu) with no target: the dialogue closed
// after "Okay, first question..." with no quiz. The plugin now starts that variant with a select that plays the first two lines
// and the quiz tail of the first-time variant. Real route: PluginManager, the real NpcDialogues runtime, Talk-to on Curpile Fyod,
// dialogue_continue packets; Math.random is stubbed to 0, so the draws are Dialogues 1, 2, 3.
// Reads the imported record (osrsreboxed-db c971f8ee2) from data/definitions/npc-dialogues.json.
// The route harness follows the read-only reference tests/curpile-quiz.test.cjs at fix/5488-curpile-quiz 3569f7ff2.
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
async function talkCurpile(stage, script, existing) {
  Math.random = () => 0;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = existing ?? new Player(new PlayerSession(channel), new Location(...LUMBRIDGE));
  if (!existing) {
    p.setIndex(index++); p.setRegistered(true); p.setUsername("curpile" + index);
    p.setAttribute("bot-skip-persistence", true);
    for (const [name, amount] of WEAPON_NAMES) p.getInventory().add(new core.Item(core.ItemIdentifiers[name], amount), false);
    quest().setStage(p, stage);
  }
  const connection = new ClientConnection(p.getSession?.().getChannel?.() ?? channel);
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
  Math.random = realRandom;
  result.player = p;
  return result;
}


const allOptionsOf = (r) => r.optionLists.flat();

const RIGHT = ["Sani Piliu.", "Ivan Strom.", "Veliaf Hurtz."];
const ZERO = ["Santi Peliou.", "Sani Piliu.", "Harold Evans."];
const ONE = ["Sani Piliu.", "Radigad Ponfit.", "Harold Evans."];
const TWO = ["Sani Piliu.", "Ivan Strom.", "Harold Evans."];
const FIRST = "Okay, first question. Name the only female member of the Myreque.";
const done = (r) => r.player.setRegistered(false) || core.TaskManager.cancelTasks(r.player);

for (const [name, wrong, said] of [["zero", ZERO, "got no questions correct"], ["one", ONE, "got one question correct"], ["two", TWO, "got two questions correct"]]) {
  test(`Curpile retry: ${name} correct -> knock-out, stage stays 52, Talk-to plays the quiz again from draw 1, three correct -> stage 55`, async () => {
    const first = await talkCurpile(25, [COME, ...wrong]);
    assert.ok(first.lines.some((l) => l.includes(said)), JSON.stringify(first.lines.slice(-4)));
    assert.equal(first.stage, 52, "a knock-out leaves the player questioned");
    assert.deepEqual(first.at, MORTTON);
    const retry = await talkCurpile(52, RIGHT, first.player);
    console.log(`RETRY-LINES ${name} stage=${retry.stage} open=${retry.open} ${JSON.stringify(retry.lines)}`);
    assert.ok(retry.lines.includes("Back again? You ain't getting in 'till you answer my questions."), JSON.stringify(retry.lines.slice(0, 3)));
    assert.equal(retry.lines.filter((l) => l.startsWith("Okay, first question")).length, 1, "the first question is announced once");
    assert.ok(retry.lines.some((l) => l.startsWith(FIRST)), "the retry asks the first drawn question");
    assert.ok(retry.lines.some((l) => l.startsWith("Okay, second question.")) && retry.lines.some((l) => l.startsWith("Okay, third and final question.")), "three questions, ordinals filled");
    assert.equal(retry.lines.filter((l) => l.includes("[first/second")).length, 0);
    assert.ok(retry.lines.includes(PASS), `passage: ${JSON.stringify(retry.lines.slice(-3))}`);
    assert.equal(retry.stage, 55, "stage 55 after the passing retry");
    assert.equal(retry.open, false);
    done(retry);
  });
}

test("Curpile retry: a failed retry stays at 52 and can be retried again; the counter restarts each attempt", async () => {
  const a = await talkCurpile(25, [COME, ...TWO]);
  const b = await talkCurpile(52, ONE, a.player);
  assert.ok(b.lines.some((l) => l.includes("got one question correct")), "the retry's own tally (not carried over from the first attempt)");
  assert.equal(b.stage, 52);
  const c = await talkCurpile(52, RIGHT, b.player);
  assert.equal(c.stage, 55);
  done(c);
});

test("Curpile retry: a retry never shows 'Dialogue N' labels and never ends at the dead jump", async () => {
  const a = await talkCurpile(25, [COME, ...ZERO]);
  const b = await talkCurpile(52, RIGHT, a.player);
  console.log(`RETRY-LINES labels stage=${b.stage} open=${b.open} ${JSON.stringify(b.lines)}`);
  assert.deepEqual(allOptionsOf(b).filter((o) => /^Dialogue \d$/.test(o)), []);
  assert.ok(b.lines.some((l) => l.startsWith(FIRST)), "the retry reaches the first drawn question instead of ending at the dead jump");
  done(b);
});

test("Curpile retry: the first talk, a pass and the after-pass variant are unchanged", async () => {
  const pass = await talkCurpile(25, [COME, ...RIGHT]);
  assert.equal(pass.stage, 55); assert.ok(pass.lines.includes(PASS));
  const again = await talkCurpile(55, [], pass.player);
  assert.ok(!again.lines.includes(LATER), "no quiz after the pass");
  done(again);
});

test("Curpile retry: a quiz abandoned mid-question leaves nothing behind: the next Talk-to scores its own answers once", async () => {
  const a = await talkCurpile(25, [COME, "Sani Piliu."]); // question 1 answered right, question 2 shown and abandoned
  assert.equal(a.stage, 52);
  assert.equal(a.optionLists.length, 3, "the quiz was left at its second question: the first menu, question 1 answered, question 2 shown and not answered");
  const b = await talkCurpile(52, ONE, a.player); // one right, two wrong
  assert.ok(b.lines.some((l) => l.includes("got one question correct")), `scored once, not carried over: ${JSON.stringify(b.lines.slice(-4))}`);
  assert.equal(b.stage, 52);
  done(b);
});

test("Curpile retry: an unreadable quiz tail and an unknown drawn question warn instead of failing silently", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  // (1) the record without its counted random: the retry plays the plain variant and says why
  const page = runtime.loadTranscripts({ core })["In Search of the Myreque"];
  const random = (function find(node) {
    if (Array.isArray(node)) { for (const v of node) { const r = find(v); if (r) return r; } return null; }
    if (!node || typeof node !== "object") return null;
    if (node.type === "random" && node.count > 1) return node;
    for (const v of Object.values(node)) { const r = find(v); if (r) return r; }
    return null;
  })(page.variants["convincing-curpile-fyod-talking-to-curpile-fyod"]);
  const count = random.count;
  random.count = 1;
  try {
    const a = await talkCurpile(25, [COME, ...ZERO]);
    const b = await talkCurpile(52, [], a.player);
    assert.ok(warn.mock.calls.some((c) => /quiz tail is missing or unreadable/.test(String(c.arguments[0]))), "the missing tail is reported");
    done(b);
  } finally { random.count = count; }
  // (2) a drawn question the plugin has no answer for
  warn.mock.resetCalls();
  const player = (await talkCurpile(25, [])).player;
  PM.emitCustomEvent("npc-dialogue:draw", { player, npcId: core.NpcIdentifiers.CURPILE_FYOD, draw: 1, count: 3, text: "Dialogue 9", question: "Okay, [first/second/third and final] question. Who is the Mayor of Nowhere?" });
  assert.ok(warn.mock.calls.some((c) => /no known answer/.test(String(c.arguments[0]))), "the unknown question is reported");
  warn.mock.resetCalls();
  PM.emitCustomEvent("npc-dialogue:draw", { player, npcId: core.NpcIdentifiers.CURPILE_FYOD, draw: 1, count: 3, text: "Dialogue 1", question: "Okay, [first/second/third and final] question. Name the only female member of the Myreque." });
  assert.equal(warn.mock.calls.length, 0, "a known question does not warn");
  done({ player });
});
