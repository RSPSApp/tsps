// Run after `yarn build`: node --test tests/monkey-speak-dialogue.test.cjs
// Monkeys whose transcript has a "without" and a "with" M'speak amulet section always played the
// first (untranslated) one. Live (rsprox recording 3030) a Mos Le'Harmless monkey answers in
// words; the Wiki's sections give the condition: the amulet worn, or Monkey Madness II complete.
// Real engine: every plugin loaded, a real Player, the monkeys' real transcripts.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { getRegisteredQuests } = require("../plugins/quests/QuestRuntime");
let core, I;
const lines = new Map();
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi(); I = core.ItemIdentifiers;
  PM.emitServerStartup({});
  PM.createApi("monkey speak test").onCustomEvent("npc-dialogue:line", (request) => {
    if (!lines.has(request.player)) lines.set(request.player, []);
    lines.get(request.player).push(request.text);
  });
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 9500;
/** Starts Talk-to with a fresh player; `advance(count)` continues natively until `count` lines were shown or a menu opens. */
function talk(t, npcId, { amulet = false, carried = false, mm2 = false, banana = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername("monkeyspeak" + p.getIndex()); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  p.setLocation(new core.Location(3668, 3010, 0));
  t.after(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); });
  const c = new ClientConnection(channel); c.player = p;
  if (carried) p.getInventory().setItem(0, new core.Item(I.MSPEAK_AMULET, 1));
  if (banana) p.getInventory().setItem(1, new core.Item(I.BANANA, 1));
  if (amulet) p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.MSPEAK_AMULET, 1));
  if (mm2) {
    const quest = getRegisteredQuests().find((q) => q.key === "monkey_madness_ii");
    quest.setStage(p, 1000);
    assert.equal(quest.isComplete(p), true);
  }
  const npc = core.NPC.create(npcId, new core.Location(3669, 3010, 0));
  const start = () => {
    const request = { player: p, npc, npcId, handled: false };
    PM.emitCustomEvent("npc-dialogue:start", request);
    assert.equal(request.handled, true, "the monkey's transcript plays");
  };
  start();
  const said = () => lines.get(p) ?? [];
  const menu = () => core.MultiChatboxPrompt.getPending(p)?.options ?? null;
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); };
  return {
    p, said, menu, start,
    async advance(count = Infinity) {
      for (let i = 0; i < 30 && said().length < count && !menu() && p.getDialogueManager().getCurrent(); i++) {
        const group = p.getPacketSender().getChatboxGroupId();
        await send({ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 });
      }
      return said();
    },
    async choose(text) {
      const index = menu().findIndex((option) => option === text);
      assert.ok(index >= 0, `menu offers ${text}`);
      await send({ type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    },
  };
}
async function opening(t, npcId, options = {}, count = 1) {
  return (await talk(t, npcId, options).advance(count)).slice(0, count);
}

/** Every opening of the Mos Le'Harmless monkeys' understood section (a random step), from the transcript itself. */
const UNDERSTOOD = (() => {
  const dialogues = require("../data/definitions/npc-dialogues.json");
  const section = dialogues["Monkey (monster)"].variants["standard-dialogue-mos-le-harmless-with-an-m-speak-amulet-or-after-completion-of-monkey-madness-ii"];
  assert.equal(section[0].type, "random");
  return section[0].options.map((option) => option.steps[0].npc);
})();

test("a Mos Le'Harmless monkey says 'Eeekeek ookeek!' to a player who can't understand it", async (t) => {
  assert.deepEqual(await opening(t, 2848), ["Eeekeek ookeek!"]);
  assert.deepEqual(await opening(t, 1038, { carried: true }), ["Eeekeek ookeek!"], "carried, not worn");
});

test("worn M'speak amulet: the Mos Le'Harmless monkeys (1038, 2848) talk", async (t) => {
  assert.ok(UNDERSTOOD.includes("Are ye here for...the stuff?") && UNDERSTOOD.length === 5);
  for (const id of [1038, 2848]) {
    for (let n = 0; n < 8; n++) {
      const [line] = await opening(t, id, { amulet: true });
      assert.ok(UNDERSTOOD.includes(line), `monkey ${id}: ${line}`);
    }
  }
});

test("Monkey Madness II complete: understood without the amulet", async (t) => {
  for (let n = 0; n < 8; n++) assert.ok(UNDERSTOOD.includes((await opening(t, 2848, { mm2: true }))[0]));
});

test("the magic carpet monkey (23) picks its section the same way; without a banana the player has none to give", async (t) => {
  assert.deepEqual(await opening(t, 23, {}, 2), ["Who's a cute little monkey?", "Ukkuk oook! Eeek aka, ahh aka gonk."]);
  const f = talk(t, 23, { amulet: true });
  assert.deepEqual((await f.advance()).slice(0, 6), ["Who's a cute little monkey?", "Who's an ugly human? Give me a banana!",
    "What's up with you?", "Stupid human! Give monkey a banana!", "Sorry monkey, I don't have any bananas.",
    "Aghhh. You're a rubbish human, get monkey a banana now."]);
});

test("the magic carpet monkey: a player with a banana is offered to give it, and giving it hands one over", async (t) => {
  const f = talk(t, 23, { amulet: true, banana: true });
  await f.advance();
  assert.deepEqual(f.menu(), ["Give the monkey a banana.", "Don't give it a banana."]);
  assert.ok(!f.said().includes("Sorry monkey, I don't have any bananas."));
  await f.choose("Give the monkey a banana.");
  await f.advance();
  assert.equal(f.p.getInventory().getAmount(I.BANANA), 0, "the banana is handed over");
  assert.ok(f.said().includes("Ha ha! Smelly human gave monkey a banana."));
});

test("the blue monkey (1825): untranslated, then Taunt only until taunted, then Calm only", async (t) => {
  assert.deepEqual(await opening(t, 1825, {}, 2), ["Hey, monkey!", "Eeek! Eeek! Ook!"]);
  const f = talk(t, 1825, { mm2: true });
  await f.advance();
  assert.ok(f.menu().includes("Taunt Monkey") && !f.menu().includes("Calm Monkey"), "a monkey never taunted can't be calmed");
  await f.choose("Taunt Monkey");
  await f.advance();
  assert.ok(f.said().includes("Hey monkey, your mother was an inedible seaweed sandwich!"));
  f.p.closeInterruptibleInterfaces();
  f.start();
  await f.advance();
  assert.ok(f.menu().includes("Calm Monkey") && !f.menu().includes("Taunt Monkey"), "once taunted, only Calm is offered");
});
