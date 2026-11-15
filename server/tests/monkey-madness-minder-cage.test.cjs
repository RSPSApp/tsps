// Run after `yarn build`: node --test tests/monkey-madness-minder-cage.test.cjs
// Monkey Madness I (#4101): the Monkey Minder's capture. The conversation comes first and the player is placed in the zoo
// pen after the Minder's last line (his cage threat), as the generated transcript has it (no action step places the
// player). Real plugin set, real player in monkey form at stage 8 (chapter 3), real NPC; the dialogue is continued with
// dialogue_continue packets as the client sends them. The pen placement point is inferred from the transcript: no retail
// capture of this sequence is in the corpus.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const core = PM.getCoreApi();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Location } = require("../dist/game/model/Location");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const runtime = require("../plugins/quests/QuestRuntime");

const ZOO_PEN = new Location(2602, 3280, 0);
const ZOO_OUTSIDE = new Location(2596, 3276, 0);
const STAGE_CHAPTERS = 8;
const FIRST_LINE = "Why do you monkeys keep trying to escape? Good thing I've caught you before you got away, you little scoundrel.";
const CAGE_LINE = "Let's put you back in your cage where you belong...";
const LAST_LINE = "I must be imagining things ... monkeys can't talk.";
let index = 19000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(ZOO_OUTSIDE.getX(), ZOO_OUTSIDE.getY());
});

/** A player in monkey form at stage 8, outside the zoo pen, with a recording of the lines the dialogue shows. */
function minderPlayer() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), ZOO_OUTSIDE.clone());
  p.setIndex(index++);
  p.setUsername(`minder${index}`);
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  p.setAttribute("bot-skip-persistence", true);
  const quest = runtime.getRegisteredQuests().find((q) => q.key === "monkey_madness_i");
  quest.setStage(p, STAGE_CHAPTERS);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.KARAMJAN_MONKEY_GREEGREE, 1));
  const connection = new ClientConnection(channel);
  connection.player = p;
  const lines = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (...args) => { lines.push(String(args[0])); return original(...args); };
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  /** Continues the open transcript one line at a time (a menu, if any, takes its first option). */
  async function continueOnce() {
    const prompt = MultiChatboxPrompt.getPending(p);
    if (prompt) {
      await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 });
    } else {
      await send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
    }
  }
  return { p, lines, continueOnce, send, quest };
}

/** The Minder, placed next to the player in the zoo, as a clicked NPC. */
function minder(p) {
  const npc = PM.spawnNpc({ id: core.NpcIdentifiers.MONKEY_MINDER, x: p.getLocation().getX() + 1, y: p.getLocation().getY(), z: 0, ownerOnly: true, owner: p }, "minder-test");
  assert.ok(npc, "the Monkey Minder spawned");
  return npc;
}

test("the Minder's conversation plays before the player is placed in the zoo pen", async (t) => {
  const { p, lines, continueOnce } = minderPlayer();
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const npc = minder(p);
  t.after(() => npc.setRegistered?.(false));
  assert.equal(p.getLocation().getX(), ZOO_OUTSIDE.getX(), "starts outside the pen");
  PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Talk-to", clickType: 1, handled: false });
  assert.ok(!p.getLocation().equals(ZOO_PEN), "not in the pen while his first line is up");
  for (let i = 0; i < 40 && !lines.includes(LAST_LINE); i++) {
    assert.ok(!p.getLocation().equals(ZOO_PEN), `not in the pen while the conversation runs (after ${lines.length} lines)`);
    await continueOnce();
  }
  assert.ok(lines.includes(FIRST_LINE), `his first line is spoken: ${lines.slice(0, 4).join(" | ")}`);
  assert.ok(lines.includes(CAGE_LINE), "the cage threat is spoken before the placement");
  assert.ok(lines.includes(LAST_LINE), "his last line is spoken");
  await continueOnce();
  assert.ok(p.getLocation().equals(ZOO_PEN), `placed in the zoo pen after his last line: at ${p.getLocation().getX()},${p.getLocation().getY()}`);
  assert.equal(p.getAttribute("quest.monkey_madness_i.monkey-captured"), true, "the capture flag is set, as before");
  assert.equal(p.getAttribute("quest.monkey_madness_i.minder-cage-from"), null, "the pending placement is cleared");
  assert.equal(runtime.getRegisteredQuests().find((q) => q.key === "monkey_madness_i").getStage(p), STAGE_CHAPTERS, "the stage is unchanged");
});
