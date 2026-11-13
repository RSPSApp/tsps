// Run after `yarn build`: node --test tests/sanfew-goutweed-option.test.cjs
// Transcript:Sanfew guards the post-Eadgar's Ruse goutweed options: "I have some more goutweed for you." only with
// goutweed in the inventory, "Did you say you needed more goutweed?" only without (rsprox_transcripts/233/03249.txt
// shows the latter, with no goutweed held). The quest page's copy of that menu has no guard, so the trade showed with
// no goutweed and gave nothing. Real engine: every plugin loaded, a real Player, Sanfew's real Talk-to transcript
// driven by native dialogue_continue packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

async function resume(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.c.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]);
  f.c.processTurnPackets();
}

async function menu(f) {
  for (let i = 0; i < 40; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    if (pending) return pending.options;
    if (!f.p.getDialogueManager().getCurrent()) return [];
    await resume(f);
  }
  return [];
}

/** Talks to Sanfew after Eadgar's Ruse and opens "Ask general questions." */
async function generalQuestions(t, name, goutweed) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9310 + name.length); p.setUsername(name); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  p.setLocation(new core.Location(2899, 3429, 1));
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => p.setRegistered(false));
  for (const key of ["druidic_ritual", "eadgars_ruse"]) {
    const quest = QuestRuntime.questNamed(key) ?? QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
    quest.setStage(p, quest.completionValue);
  }
  if (goutweed) p.getInventory().setItem(0, new core.Item(I.GOUTWEED, 1));
  const npc = core.NPC.create(core.NpcIdentifiers.SANFEW, new core.Location(2899, 3430, 1));
  PM.emitCustomEvent("npc-dialogue:start", { player: p, npc, npcId: core.NpcIdentifiers.SANFEW, handled: false });
  const f = { p, c };
  const first = await menu(f);
  const general = first.indexOf("Ask general questions.");
  assert.ok(general >= 0, `Sanfew's first menu: ${JSON.stringify(first)}`);
  await resume(f, general + 1);
  return { f, options: await menu(f) };
}

test("without goutweed Sanfew offers 'Did you say you needed more goutweed?', not the trade", async (t) => {
  const { options } = await generalQuestions(t, "sanfewnone", false);
  assert.ok(!options.includes("I have some more goutweed for you."), JSON.stringify(options));
  assert.equal(options[0], "Did you say you needed more goutweed?");
  assert.ok(options.includes("Actually, I don't need to speak to you."));
});

test("with goutweed the trade is offered and gives a herb for it", async (t) => {
  const { f, options } = await generalQuestions(t, "sanfewsome", true);
  assert.ok(!options.includes("Did you say you needed more goutweed?"), JSON.stringify(options));
  const trade = options.indexOf("I have some more goutweed for you.");
  assert.ok(trade >= 0, JSON.stringify(options));
  await resume(f, trade + 1);
  assert.equal(f.p.getInventory().getAmount(I.GOUTWEED), 0, "the goutweed is traded");
  assert.equal(f.p.getInventory().getFreeSlots(), 27, "one herb in its place");
});
