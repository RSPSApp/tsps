// RSPSApp/tsps#5221 item 1: talking to Zavistic Rarve while the evidence is held but not yet shown gives no quest dialogue.
// Test-first, real route. Run after `yarn build`, from server/: node --test tests/zogre-talk-to-zavistic-inside-guild.test.cjs
//
// Source (origin/main): ZogreFleshEaters.Quest.js zavisticVariant() returns null while progress < 4, so Talk-to falls back to the
// Hand-in-the-Sand line "What are you doing bothering me?". The retail transcript for this state exists in the corpus
// (npc-dialogues.json, page "Zogre Flesh Eaters", variant investigating-b-vahn-talking-to-zavistic-rarve-inside-the-guild) and is
// never played. Its "I'm here about the sicks" choice ends in an action "Continues above from 'There's some undead ogre activity...'",
// whose body is the tail of investigating-b-vahn-ringing-the-bell-outside-the-wizards-guild (the prism / page / tankard branches).
//
// Real route: PluginManager.loadFromDirectory, the real NpcDialogues runtime, PM.emitNpcInteraction Talk-to on Zavistic Rarve.
// Seeded (disclosed): quest stage 2 (started), search progress 3 (items found, not shown), the black prism, torn page and dragon
// inn tankard in the inventory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, afterEach, test } = require("node:test");
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
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const runtime = require("../plugins/quests/QuestRuntime");

runtime.startTranscript = runtime.startTranscript; // real transcript playback; no stubbing

let core, quest = null, index = 12000;
const cleanups = [];
const ZAVISTIC_TILE = [2000, 2000, 0];
const GUILD_OPENER = "What are you doing...Oh, it's you...sorry...didn't realise...what can I do for you?";
const SICKS = "I'm here about the sicks...err Zogres";
const EVIDENCE = [ItemIdentifiers.BLACK_PRISM, ItemIdentifiers.TORN_PAGE, ItemIdentifiers.DRAGON_INN_TANKARD];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(ZAVISTIC_TILE[0], ZAVISTIC_TILE[1]);
  ObjectDefinition.init();
  PM.emitServerStartup({});
  quest = runtime.getRegisteredQuests().find((q) => q.key === "zogre_flesh_eaters");
  assert.ok(quest, "the Zogre Flesh Eaters quest is registered by the production plugin set");
});

after(() => {
  PM.emitServerShutdown({});
  if (savedBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = savedBots;
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

function actor({ items = EVIDENCE, progress = 3 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...ZAVISTIC_TILE));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("zogre" + index);
  p.setAttribute("bot-skip-persistence", true);
  quest.setStage(p, 2);
  // The retail opener and the sicks choice sit in the branch "If the player has started The Hand in the Sand" (an
  // otherQuestStage > 0 check). Without it the not-started branch plays, which has no sicks choice.
  p.setAttribute("quest.hand_in_the_sand.stage", 2);
  p.setAttribute("quest.zogre_flesh_eaters.search", progress);
  for (const id of items) p.getInventory().adds(id, 1);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const npc = core.NPC.create(core.NpcIdentifiers.ZAVISTIC_RARVE, new Location(...ZAVISTIC_TILE));
  const lines = [], messages = [];
  const sender = p.getPacketSender();
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendString", (text) => lines.push(String(text)));
  wrap("sendMessage", (text) => messages.push(String(text)));
  wrap("sendTypedMessage", (type, text) => messages.push(String(text)));
  cleanups.push(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const next = () => send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  async function choose(text) {
    for (let n = 0; !MultiChatboxPrompt.getPending(p) && n < 60; n++) {
      assert.ok(p.getDialogueManager().getCurrent(), `dialogue ended before "${text}"; lines: ${JSON.stringify(lines)}`);
      await next();
    }
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt?.options.includes(text), `"${text}" offered: ${JSON.stringify(prompt?.options)}; lines: ${JSON.stringify(lines)}`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: prompt.options.indexOf(text) + 1 });
  }
  async function playToEnd(limit = 200) {
    for (let n = 0; n < limit && p.getDialogueManager().getCurrent(); n++) {
      if (MultiChatboxPrompt.getPending(p)) break;
      await next();
    }
  }
  const talkTo = () => PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Talk-to", clickType: 1, handled: false });
  return { p, lines, messages, choose, playToEnd, talkTo };
}

test("the guild opener plays when Talk-to finds the evidence held but not shown (no pre-quest line)", async () => {
  const a = actor();
  a.talkTo();
  await a.playToEnd(3);
  console.log(`# T1 opener lines=${JSON.stringify(a.lines.slice(0, 3))}`);
  assert.ok(a.lines.includes(GUILD_OPENER), `the guild opener is spoken: ${JSON.stringify(a.lines.slice(0, 4))}`);
  assert.ok(!a.lines.some((l) => l.includes("bothering me")), "the Hand-in-the-Sand pre-quest line is not spoken");
});

test("the sicks choice continues into the evidence branches: the held prism and page are shown and progress reaches 4", async () => {
  const a = actor();
  a.talkTo();
  await a.choose(SICKS);
  await a.playToEnd();
  console.log(`# T2 progress=${a.p.getAttribute("quest.zogre_flesh_eaters.search")} messages=${JSON.stringify(a.messages)} lines=${JSON.stringify(a.lines.slice(-4))}`);
  assert.ok(a.messages.includes("You show the prism and the necromantic half page to the aged wizard."), `the prism and page are shown: ${JSON.stringify(a.messages)}`);
  assert.equal(Number(a.p.getAttribute("quest.zogre_flesh_eaters.search")), 4, "the evidence hand-in sets progress 4");
});

// Only the after-gathering-evidence variant opens with this note; the inside-the-guild transcript does not. So this fails if
// progress >= 4 were rerouted to the inside-the-guild transcript.
const AFTER_GATHERING_NOTE = "Individual evidence items can be used on Zavistic, which jumps to that section of the dialogue.";

test("CONTROL: with progress 4 the Talk-to plays the after-gathering-evidence hand-in, not the inside-the-guild transcript", async () => {
  const a = actor({ progress: 4 });
  a.talkTo();
  await a.playToEnd(3);
  console.log(`# T3 control lines=${JSON.stringify(a.lines.slice(0, 3))}`);
  assert.ok(a.lines.includes(AFTER_GATHERING_NOTE), `the after-gathering-evidence note is spoken: ${JSON.stringify(a.lines.slice(0, 4))}`);
  assert.ok(!a.lines.some((l) => l.includes("bothering me")), "the pre-quest line is not spoken");
});
