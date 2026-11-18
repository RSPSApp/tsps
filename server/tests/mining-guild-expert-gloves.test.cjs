// Run after `yarn build`: node --test tests/mining-guild-expert-gloves.test.cjs
// Issue 6107: Belona's "Can you combine my mining gloves?" turns Mining gloves and Superior mining
// gloves plus 40 unidentified minerals into Expert mining gloves (Wiki: Expert mining gloves, Belona).
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const BELONA = 7719;
const MINERALS = 21341;
const MINING_GLOVES = 21343;
const SUPERIOR_MINING_GLOVES = 21345;
const EXPERT_MINING_GLOVES = 21392;
const TILE = [3028, 9720, 0];
const NO_GLOVES = "You don't have any gloves for me to combine.";
const NO_MINERALS = "You don't have enough minerals. You need at least 40.";
const COMBINED = "There you go. I've combined your gloves into some Expert mining gloves. Enjoy.";

let core;
let index = 3600;
const cleanups = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  require("../plugins/npcs/NpcDialogues.plugin").register(PM.createApi("BelonaDialogue"));
  require("../plugins/areas/MiningGuild.plugin").register(PM.createApi("BelonaMiningGuild"));
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

/** A real player beside Belona carrying these items, recording the chat lines sent. */
function actor(items) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...TILE));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("belona" + index);
  for (const [id, amount] of items) p.getInventory().adds(id, amount);
  const connection = new ClientConnection(channel); connection.player = p;
  const npc = core.NPC.create(BELONA, new Location(TILE[0] + 1, TILE[1], TILE[2]));
  const lines = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { lines.push(String(text)); return original(text, ...rest); };
  cleanups.push(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const next = () => send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  async function choose(text) {
    for (let n = 0; !MultiChatboxPrompt.getPending(p)?.options.includes(text) && n < 60; n++) {
      assert.ok(p.getDialogueManager().getCurrent() || MultiChatboxPrompt.getPending(p), `dialogue ended before ${text}`);
      if (MultiChatboxPrompt.getPending(p)) assert.fail(`${text} not offered: ${JSON.stringify(MultiChatboxPrompt.getPending(p).options)}`);
      await next();
    }
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt?.options.includes(text), `${text}: ${JSON.stringify(prompt?.options)}`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: prompt.options.indexOf(text) + 1 });
  }
  async function finish() {
    for (let n = 0; p.getDialogueManager().getCurrent() && n < 60; n++) await next();
  }
  const talk = () => PM.emitNpcInteraction({ player: p, npc, npcId: BELONA, action: "Talk-to", clickType: 1, handled: false });
  const said = (text) => lines.some((line) => line.includes(text));
  return { p, talk, choose, finish, said };
}

async function askToCombine(items) {
  const f = actor(items);
  assert.equal(f.talk(), true);
  await f.choose("Can you combine my mining gloves?");
  await f.choose("That's fine. Combine my gloves.");
  await f.finish();
  return f;
}

const amount = (f, id) => f.p.getInventory().getAmount(id);

test("both pairs and 40 minerals: Belona combines them into Expert mining gloves for the fee", async () => {
  const f = await askToCombine([[MINING_GLOVES, 1], [SUPERIOR_MINING_GLOVES, 1], [MINERALS, 55]]);
  assert.equal(f.said(NO_GLOVES), false, "she does not claim there are no gloves");
  assert.equal(f.said(COMBINED), true);
  assert.equal(amount(f, EXPERT_MINING_GLOVES), 1);
  assert.equal(amount(f, MINING_GLOVES), 0);
  assert.equal(amount(f, SUPERIOR_MINING_GLOVES), 0);
  assert.equal(amount(f, MINERALS), 15, "the fee is 40 minerals");
});

test("both pairs but 39 minerals: her not-enough line, nothing taken", async () => {
  const f = await askToCombine([[MINING_GLOVES, 1], [SUPERIOR_MINING_GLOVES, 1], [MINERALS, 39]]);
  assert.equal(f.said(NO_MINERALS), true);
  assert.equal(f.said(NO_GLOVES), false);
  assert.equal(f.said(COMBINED), false);
  assert.equal(amount(f, EXPERT_MINING_GLOVES), 0);
  assert.equal(amount(f, MINING_GLOVES), 1);
  assert.equal(amount(f, MINERALS), 39);
});

test("one pair missing: her no-gloves line, nothing taken", async () => {
  const f = await askToCombine([[MINING_GLOVES, 1], [MINERALS, 100]]);
  assert.equal(f.said(NO_GLOVES), true);
  assert.equal(f.said(COMBINED), false);
  assert.equal(amount(f, EXPERT_MINING_GLOVES), 0);
  assert.equal(amount(f, MINING_GLOVES), 1);
  assert.equal(amount(f, MINERALS), 100);
});

test("the receive step checks again: gloves gone by then means no Expert gloves and the chat ends", () => {
  const plugin = require("../plugins/areas/MiningGuild.plugin");
  const f = actor([[MINING_GLOVES, 1], [MINERALS, 40]]);
  const event = { player: f.p, npcId: BELONA, action: "receive", text: "expert mining gloves", handled: false };
  plugin._test.combineGloves(event);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  assert.equal(amount(f, EXPERT_MINING_GLOVES), 0);
  assert.equal(amount(f, MINERALS), 40);
  const other = { player: f.p, npcId: 1, action: "receive", text: "expert mining gloves", handled: false };
  plugin._test.combineGloves(other);
  assert.equal(other.handled, false, "another NPC's receive step is not ours");
});
