// RSPSApp/tsps#5221 item 3 (candidate): the strange potion is lost when the player hands in the evidence with a full inventory.
// Test-first, real route. Run after `yarn build`, from server/: node --test tests/zogre-potion-full-inventory.test.cjs
//
// Source (read and verified in this worktree): ZogreFleshEaters.Quest.js case "VDahRD" (message step, around line 612-618) runs
//   if (!has(player, STRANGE_POTION)) give(player, STRANGE_POTION);     // give = inventory.adds (line 203)
//   takeAll(player, DRAGON_INN_TANKARD); takeAll(NECROMANCY_BOOK); takeAll(BOOK_OF_H_A_M); takeAll(SIGNED_PORTRAIT);
// so the potion is added BEFORE the four evidence items are removed. ItemContainer.add (ItemContainer.ts, the stack path
// near :538-541 and the non-stack path near :567-571) sends "You couldn't hold all those items." and returns without adding
// when there is no free slot, and nothing else retries: a player holding the four items with a full bag gets the hand-in text,
// no potion, and the four items are then removed (the ask-again branch, condition Rkj_LO, is then the only recovery).
//
// Real route (no step is called by hand): PluginManager.loadFromDirectory (the production plugin set, as the #5157 probes),
// the real NpcDialogues runtime, the real ClientOfKourend-style Talk-to via PluginManager.emitNpcInteraction on Zavistic Rarve
// (NPC 881), the transcript variant 'investigating-b-vahn-talking-to-zavistic-rarve-after-gathering-evidence' (selected by
// zavisticVariant when progress >= 4 and the stage is below Sithik's), the menu choices by text, and the real message step.
//
// Seeded (disclosed): quest stage 3 (barricade; below STAGE_SITHIK 4), the search progress attribute 4 (quest.zogre_flesh_eaters.
// search), the four shown flags (necro_shown, ham_shown, zavistic-tankard-shown, portrait_shown) and the four evidence items in the
// inventory. The full bag is 28 distinct filler items plus the four evidence items (a precondition: free slots 0).
//
// BEFORE (intended red): the potion assertion fails on the base with the full bag (potion absent, items gone).
// Control (green on base): the same hand-in with free slots gives the potion and removes the items.
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
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const runtime = require("../plugins/quests/QuestRuntime");

runtime.startTranscript = () => true;

let core, quest = null, index = 11000;
/** Filler items: the first 24 cache items from 1205 up that have a real, non-stackable name (no placeholder). Verified by the cache. */
function fillers(count) {
  const found = [];
  for (let id = 1205; id < 1700 && found.length < count; id++) {
    const def = ItemDefinition.forId(id);
    if (!def) continue;
    const name = String(def.getName?.() ?? "");
    if (!name || name.toLowerCase() === "null") continue;
    if (def.isStackable?.()) continue;
    if (def.getPlaceholderId?.() > 0) continue;
    found.push(id);
  }
  return found;
}
const cleanups = [];
const POTION = ItemIdentifiers.STRANGE_POTION;
const EVIDENCE = [ItemIdentifiers.DRAGON_INN_TANKARD, ItemIdentifiers.NECROMANCY_BOOK, ItemIdentifiers.BOOK_OF_H_A_M, ItemIdentifiers.SIGNED_PORTRAIT];
const ZAVISTIC_TILE = [2000, 2000, 0];
const SICKS = "I'm here about the sicks...err Zogres";
const SHOW_ITEMS = "I have some items that I'd like you to look at.";

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

/** A real player with a real inventory and a real session; the hand-in state seeded through the quest object and attributes. */
function actor({ fullBag }) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...ZAVISTIC_TILE));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("zogre" + index);
  p.setAttribute("bot-skip-persistence", true);
  quest.setStage(p, 3);
  p.setAttribute("quest.zogre_flesh_eaters.search", 4);
  p.setAttribute("quest.zogre_flesh_eaters.necro_shown", true);
  p.setAttribute("quest.zogre_flesh_eaters.ham_shown", true);
  p.setAttribute("zogre-flesh-eaters:zavistic-tankard-shown", true);
  p.setAttribute("quest.zogre_flesh_eaters.portrait_shown", true);
  for (const id of EVIDENCE) p.getInventory().adds(id, 1);
  if (fullBag) {
    // 24 distinct, cache-verified, non-stackable fillers: with the four evidence items that is 28 slots, a full bag.
    for (const id of fillers(24)) p.getInventory().adds(id, 1);
  }
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
    assert.ok(prompt?.options.includes(text), `"${text}" offered: ${JSON.stringify(prompt?.options)}`);
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

test("PRECONDITION (real route): the free-slot hand-in really happens: the four evidence items are removed (a dead route fails here)", async () => {
  const a = actor({ fullBag: false });
  assert.equal(EVIDENCE.every((id) => a.p.getInventory().getAmount(id) === 1), true, "precondition: all four evidence items are held before the hand-in");
  a.talkTo();
  await a.choose(SICKS);
  await a.choose(SHOW_ITEMS);
  await a.playToEnd();
  console.log(`# P1 free-slot evidenceLeft=${EVIDENCE.map((id) => a.p.getInventory().getAmount(id))} lines=${JSON.stringify(a.lines.slice(-4))}`);
  assert.equal(EVIDENCE.every((id) => a.p.getInventory().getAmount(id) === 0), true, `the hand-in must remove the four evidence items: ${JSON.stringify(a.lines.slice(-4))}`);
});

test("CONTROL (free slots, green on base): the hand-in gives the potion and takes the four evidence items", async () => {
  const a = actor({ fullBag: false });
  assert.ok(a.p.getInventory().getFreeSlots() > 0, "precondition: free slots exist");
  a.talkTo();
  await a.choose(SICKS);
  await a.choose(SHOW_ITEMS);
  await a.playToEnd();
  console.log(`# C1 free-slot potion=${a.p.getInventory().getAmount(POTION)} evidenceLeft=${EVIDENCE.map((id) => a.p.getInventory().getAmount(id))} messages=${JSON.stringify(a.messages)}`);
  assert.equal(a.p.getInventory().getAmount(POTION), 1, "the potion is in the inventory after the hand-in");
  for (const id of EVIDENCE) assert.equal(a.p.getInventory().getAmount(id), 0, `evidence item ${id} is handed over`);
});

test("BEFORE (intended red on base): the hand-in with a FULL bag keeps the strange potion (potion must be in the inventory)", async () => {
  const a = actor({ fullBag: true });
  assert.equal(a.p.getInventory().getFreeSlots(), 0, "precondition: the bag is full (28 slots, four evidence items among them)");
  a.talkTo();
  await a.choose(SICKS);
  await a.choose(SHOW_ITEMS);
  await a.playToEnd();
  console.log(`# B1 full-bag potion=${a.p.getInventory().getAmount(POTION)} evidenceLeft=${EVIDENCE.map((id) => a.p.getInventory().getAmount(id))} messages=${JSON.stringify(a.messages)} stage=${quest.getStage(a.p)}`);
  // Preconditions of the defect path (must hold on the base, or the red below is a wrong route, not the defect):
  assert.equal(EVIDENCE.every((id) => a.p.getInventory().getAmount(id) === 0), true, "precondition: the hand-in removed the four evidence items");
  assert.ok(a.messages.some((m) => m.includes("You couldn't hold all those items.")), `precondition: the full bag was refused: ${JSON.stringify(a.messages)}`);
  // The intended red: the potion is lost.
  assert.equal(a.p.getInventory().getAmount(POTION), 1, "a full bag must not lose the strange potion at the hand-in");
});
