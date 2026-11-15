// RSPSApp/tsps #5157 part 1: after a TRUE linear condition branch, its unanswered sibling conditions must not be
// chosen (Veos, Port Sarim: the members branch "Certainly!" teleported the player, then the Trailblazer line
// "I'm afraid access to Great Kourend is currently prohibited." played because it was the first unknown sibling).
// Real route: PluginManager.loadFromDirectory, the real NpcDialogues runtime, PM.emitNpcInteraction Talk-to on Veos,
// dialogue_continue packets. Deterministic: membersWorld from world.json (true in the test tree), X Marks the Spot
// complete, Client of Kourend complete. Also unit tests of chooseCondition on a tail's flagged copies.
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
const { chooseCondition } = require("../plugins/npcs/NpcDialogues.plugin");

let core, index = 16000;
const PORT_SARIM = [3028, 3217, 0];
const TELL = "Tell me more about Great Kourend.";
const TAKE = "That's great, can you take me there please?";
const PROHIBITED = "I'm afraid access to Great Kourend is currently prohibited.";
const CERTAINLY = "Certainly! I hope you don't get seasick, it is a long voyage.";
const UNFORTUNATE = "Unfortunately it seems that you're not quite ready to visit Great Kourend yet. Come back when you are and I'll happily take you there.";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(PORT_SARIM[0], PORT_SARIM[1]);
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (savedBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = savedBots;
});

const questByKey = (key) => runtime.getRegisteredQuests().find((q) => q.key === key);

/** Talks to Veos through the real route; returns the lines, the teleports and whether the dialogue is still open. */
async function talkVeos(npcId, { xmarks, client }, script) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...PORT_SARIM));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("veostail" + index);
  p.setAttribute("bot-skip-persistence", true);
  questByKey("x_marks_the_spot").setStage(p, xmarks);
  questByKey("client_of_kourend").setStage(p, client);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const npc = core.NPC.create(npcId, new Location(...PORT_SARIM));
  const lines = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { if (typeof text === "string") lines.push(text); return original(text, ...rest); };
  const start = p.getLocation();
  const teleports = [];
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Talk-to", clickType: 1, handled: false });
  let picks = 0;
  for (let n = 0; n < 200; n++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) {
      const want = script[picks++];
      if (!want || !pending.options.includes(want)) break;
      await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: pending.options.indexOf(want) + 1 });
      continue;
    }
    if (!p.getDialogueManager().getCurrent()) break;
    await send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  }
  const end = p.getLocation();
  if (end.getX() !== start.getX() || end.getY() !== start.getY()) teleports.push(`${end.getX()},${end.getY()},${end.getZ()}`);
  const open = !!p.getDialogueManager().getCurrent();
  p.setRegistered(false); core.TaskManager.cancelTasks(p);
  return { lines, teleports, open };
}

test("Veos (post-quest 10723): after 'Certainly!' the Trailblazer line does not play, one teleport, the dialogue ends", async () => {
  const r = await talkVeos(core.NpcIdentifiers.VEOS_4, { xmarks: 6, client: 5 }, [TELL, TAKE]);
  assert.ok(r.lines.includes(CERTAINLY), `the members branch plays: ${JSON.stringify(r.lines)}`);
  assert.ok(!r.lines.includes(PROHIBITED), `the Trailblazer line must not play on a members world: ${JSON.stringify(r.lines)}`);
  assert.equal(r.teleports.length, 1, "the members branch teleports the player once");
  assert.equal(r.open, false, "the dialogue ends");
});

test("Veos (Talk-to 8484): same as 10723 with X Marks complete and Client of Kourend not started", async () => {
  const r = await talkVeos(core.NpcIdentifiers.VEOS, { xmarks: 6, client: 0 }, [TELL, TAKE]);
  assert.ok(r.lines.includes(CERTAINLY));
  assert.ok(!r.lines.includes(PROHIBITED), JSON.stringify(r.lines));
  assert.equal(r.teleports.length, 1);
});

// The tail after a chosen linear branch holds its unanswered siblings flagged (afterTrue). Real copies are made by
// NpcDialogues' run(); these mirror that: a flagged sibling is never chosen as the unknown fallback.
const cond = (text, steps = [{ type: "line", text }]) => ({ type: "condition", id: text, text, steps });
const flagged = (c) => ({ ...c, afterTrue: true });
const answers = (map) => (c) => (c.text in map ? map[c.text] : null);

test("chooseCondition: unflagged run keeps the first-unknown fallback", () => {
  const run = [cond("a"), cond("b"), cond("c")];
  assert.equal(chooseCondition(run, answers({ a: false, b: null, c: null })).index, 1);
  assert.equal(chooseCondition(run, answers({ a: false, b: false, c: null })).index, 2);
});

test("chooseCondition: a flagged tail with only false and unknown siblings chooses nothing", () => {
  const tail = [cond("false-one"), cond("unknown-one"), cond("unknown-two")].map(flagged);
  assert.equal(chooseCondition(tail, answers({ "false-one": false })), null);
});

test("chooseCondition: a flagged tail with [false, null, true] chooses the true sibling", () => {
  const tail = [cond("f"), cond("n"), cond("t")].map(flagged);
  assert.equal(chooseCondition(tail, answers({ f: false, t: true })).index, 2);
});

test("chooseCondition: a flagged tail with [true, true, null] chooses the first true; the null is never chosen", () => {
  const tail = [cond("t1"), cond("t2"), cond("n")].map(flagged);
  assert.equal(chooseCondition(tail, answers({ t1: true, t2: true })).index, 0);
  assert.equal(chooseCondition(tail.slice(1), answers({ t2: true })).index, 0);
  assert.equal(chooseCondition(tail.slice(2), answers({})), null);
});
