// Run after `yarn build`: node --test tests/wanted-commorb-full-inventory.test.cjs
// Wanted!: buying the commorb from Sir Tiffy takes 10,000 coins and gives the orb. Tiffy's transcript checks for a free
// slot when "Buy One" is picked, but taking off worn gear (which leaves the dialogue open) can fill that slot before
// the last Yes; the coins then went and the orb never arrived, yet the quest moved on. Real engine: every plugin
// loaded, a real Player, a native equipment Remove, the quest's own stage and its dialogue choice events.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let I;
let N;
let QuestRuntime;
let next = 9900;
const MISSION = 4;
const COMMORB = 5;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("wanted" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2997, 3373, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const quest = QuestRuntime.questNamed("Wanted!");
  assert.ok(quest, "the Wanted! quest is registered");
  quest.setStage(p, MISSION);
  const c = new ClientConnection(channel);
  c.player = p;
  return { p, c, inv: p.getInventory(), messages, quest };
}

function choose(f, option) {
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.p, npcId: N.SIR_TIFFY_CASHIEN, option });
}

/** The ring slot's Remove, as the client sends it from the worn-equipment tab. */
async function removeRing(f) {
  await f.c.dispatch([{ type: "widget_action", widgetId: (387 << 16) | 24, groupId: 387, childId: 24, buttonNum: 1 }]);
  f.c.processTurnPackets();
}

test("taking off a ring between Tiffy's room check and the last Yes keeps the coins and the stage", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.COINS, 50_000));
  for (let slot = 1; slot < 27; slot++) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_RECOIL, 1));
  assert.equal(f.inv.getFreeSlots(), 1, "the transcript's room check passes");
  choose(f, "I'd like to buy one, please.");
  choose(f, "Yes.");
  await removeRing(f);
  assert.equal(f.inv.getFreeSlots(), 0, "the ring took the last slot");
  choose(f, "Yes.");
  assert.equal(f.inv.getAmount(I.COINS), 50_000, "the coins stay");
  assert.equal(f.quest.getStage(f.p), MISSION, "the quest waits for the orb");
  assert.equal(f.inv.getAmount(I.COMMORB), 0);
  f.inv.setItem(26, new core.Item(-1, 0));
  choose(f, "I'd like to buy one, please.");
  choose(f, "Yes.");
  choose(f, "Yes.");
  assert.equal(f.inv.getAmount(I.COMMORB), 1, "with a free slot the purchase goes through");
  assert.equal(f.inv.getAmount(I.COINS), 40_000);
  assert.equal(f.quest.getStage(f.p), COMMORB);
});

test("the Varrock mage offers Solus and his other topics when Temple of the Eye is complete", async (t) => {
  const f = actor(t);
  const FUR_CLUE = 8;
  const MAGE_DEAL = 9;
  const EAST = 10;
  f.quest.setStage(f.p, FUR_CLUE);
  const abyss = QuestRuntime.questNamed("Enter the Abyss");
  const temple = QuestRuntime.questNamed("Temple of the Eye");
  abyss.setStage(f.p, abyss.completionValue);
  temple.setStage(f.p, temple.completionValue);
  const chapel = new core.Location(3260, 3383, 0);
  f.p.setLocation(chapel);
  const VARROCK_MAGE_PARENT = 3229;
  const npc = core.NPC.create(VARROCK_MAGE_PARENT, chapel);
  const definition = npc.getCurrentDefinition(f.p);
  assert.equal(definition.getId(), N.MAGE_OF_ZAMORAK_3);
  function talk() {
    assert.equal(PM.emitNpcInteraction({
      player: f.p, npc, definition, npcId: npc.getContentId(f.p), npcIndex: npc.getIndex(),
      clickType: 1, location: { x: chapel.getX(), y: chapel.getY(), z: chapel.getZ() }, handled: false,
    }), true);
  }
  function options() {
    return core.MultiChatboxPrompt.getPending(f.p)?.options;
  }
  async function reply(choice) {
    const widgetId = choice === undefined ? f.p.getPacketSender().getChatboxGroupId() << 16
      : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID;
    await f.c.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]);
    f.c.processTurnPackets();
  }

  talk();
  assert.deepEqual(options(), ["Solus Dellagar.", "Something else."]);
  await reply(2);
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /What do you want/);
  await reply();
  assert.ok(options().includes("Can you tell me more about the Abyss?"));
  assert.equal(f.quest.getStage(f.p), FUR_CLUE);

  f.p.closeInterruptibleInterfaces();
  talk();
  await reply(1);
  assert.equal(f.quest.getStage(f.p), MAGE_DEAL);
  f.p.closeInterruptibleInterfaces();
  for (let slot = 0; slot < 20; slot++) f.inv.setItem(slot, new core.Item(I.RUNE_ESSENCE, 1));
  talk();
  assert.deepEqual(options(), ["Solus Dellagar.", "Something else."]);
  await reply(1);
  for (let i = 0; i < 8 && f.quest.getStage(f.p) !== EAST; i++) await reply();
  assert.equal(f.quest.getStage(f.p), EAST);
  assert.equal(f.inv.getAmount(I.RUNE_ESSENCE), 0);
});

// Tiffy's transcript ends the chat after her full-inventory line (Pih8D4, then "end"). A bag filled after that check
// (a worn ring taken off before the last YES) refused the orb in chat, then still played "Here, take this
// Communications Orb..." and "Okay, thanks Tiffy!", and that line refused a second time.
test("a bag filled before the last YES gets Tiffy's refusal once and the chat ends there", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.COINS, 50_000));
  for (let slot = 1; slot < 27; slot++) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_RECOIL, 1));
  const tiffy = core.NPC.create(N.SIR_TIFFY_CASHIEN, f.p.getLocation());
  assert.equal(PM.emitNpcInteraction({ player: f.p, npc: tiffy, npcId: tiffy.getId(), npcIndex: tiffy.getIndex(), clickType: 1,
    location: { x: 2997, y: 3373, z: 0 }, handled: false }), true);
  const options = () => core.MultiChatboxPrompt.getPending(f.p)?.options;
  const text = () => f.p.getDialogueManager().getCurrent?.()?.getText?.();
  async function reply(choice) {
    const widgetId = choice === undefined ? f.p.getPacketSender().getChatboxGroupId() << 16 : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID;
    await f.c.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]);
    f.c.processTurnPackets();
  }
  /** Continues to the next menu, picking `pick` there. */
  async function until(pick) {
    for (let i = 0; i < 20 && !options(); i++) await reply();
    const index = options().indexOf(pick);
    assert.ok(index >= 0, `${pick} in ${options()}`);
    await reply(index + 1);
  }
  await until("Ask about the Wanted! Quest");
  await until("Buy One");
  await until("YES");
  for (let i = 0; i < 20 && !options(); i++) await reply();
  assert.deepEqual(options(), ["YES", "NO"]);
  await removeRing(f);
  assert.equal(f.inv.getFreeSlots(), 0, "the ring took the last slot");
  await reply(1);
  assert.match(text() ?? "", /you'll need to free up some inventory space first!$/);
  const seen = [];
  for (let i = 0; i < 6 && text(); i++) { await reply(); if (text()) seen.push(text()); }
  assert.deepEqual(seen, [], "nothing follows the refusal");
  assert.equal(options(), undefined);
  assert.deepEqual(f.messages.filter((m) => /free up some inventory space/.test(m)), [], "no second refusal in chat");
  assert.equal(f.inv.getAmount(I.COINS), 50_000);
  assert.equal(f.inv.getAmount(I.COMMORB), 0);
  assert.equal(f.quest.getStage(f.p), MISSION);
});
