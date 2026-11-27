// Run after `yarn build`: node --test tests/song-of-the-elves-bar-tax.test.cjs
// Song of the Elves' insurrection step (the Wiki's "Causing an insurrection") taxes East Ardougne's bar, the Flying
// Horse Inn (npc:east:bartender); the other bars' bartenders keep their own talk
// (plugins/quests/quests/SongOfTheElves.Quest.js). Real engine: every plugin loaded, a real Player, the Talk-to hook
// and real dialogue packets. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

/** Stage 50: the insurrection, when the resistance taxes the shops. */
const INSURRECTION = 50;
const TAX_LINE = "I'm here to tell you about some new taxes.";

let core;
let quest;
let next = 9600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
  quest = QuestRuntime.questNamed("Song of the Elves");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("soteqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2575, 3322, 0));
  p.needsPlacement = false;
  quest.setStage(p, INSURRECTION);
  const connection = new ClientConnection(channel);
  connection.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
  });
  return { p, connection };
}

/** Talks to the NPC and returns the lines shown until a menu or the end. */
async function lines(f, npcId) {
  const npc = core.NPC.create(npcId, new core.Location(2576, 3322, 0));
  const definition = npc.getCurrentDefinition(f.p);
  PM.emitNpcInteraction({ player: f.p, npc, npcId, definition, clickType: definition.getActions().indexOf("Talk-to") + 1, handled: false });
  const said = [];
  for (let i = 0; i < 8 && f.p.getDialogueManager().getCurrent() && !core.MultiChatboxPrompt.getPending(f.p); i++) {
    said.push(String(f.p.getDialogueManager().getCurrent()?.getText?.() ?? ""));
    const group = f.p.getPacketSender().getChatboxGroupId();
    const widgetId = (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0);
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: -1 }]);
    f.connection.processTurnPackets();
  }
  return said;
}

test("the insurrection taxes the Flying Horse Inn's bartender", async (t) => {
  assert.ok((await lines(actor(t), 1319)).includes(TAX_LINE));
});

test("the insurrection leaves the other bars' bartenders their own talk", async (t) => {
  for (const npcId of [1312, 1313, 1314, 1318, 1320, 1310]) {
    const f = actor(t);
    const said = await lines(f, npcId);
    const options = core.MultiChatboxPrompt.getPending(f.p)?.options ?? [];
    assert.ok(said.length > 0 || options.length > 0, `bartender ${npcId} talks or offers a menu`);
    assert.ok(![...said, ...options].includes(TAX_LINE), `bartender ${npcId}: ${said} ${options}`);
  }
});

test("mid-crawl, the insurrection's tax talk is the Flying Horse Inn bartender's Talk-to and the card still starts the drink", async (t) => {
  const barcrawl = QuestRuntime.questNamed("Alfred Grimhand's Barcrawl");
  const f = actor(t);
  barcrawl.setStage(f.p, 1);
  f.p.getInventory().setItem(0, new core.Item(455, 1));
  f.p.getInventory().setItem(1, new core.Item(995, 100));
  assert.ok((await lines(f, 1319)).includes(TAX_LINE));
  f.p.getDialogueManager().interruptDialogue?.();
  const npc = core.NPC.create(1319, new core.Location(2576, 3322, 0));
  assert.equal(PM.emitItemOnNpc({ player: f.p, target: npc, npcId: 1319, targetIndex: 0, item: new core.Item(455, 1), definition: npc.getCurrentDefinition(f.p) }), true);
  assert.equal(String(f.p.getDialogueManager().getCurrent()?.getText?.() ?? ""), "I'm doing Alfred Grimhand's Barcrawl.");
});
