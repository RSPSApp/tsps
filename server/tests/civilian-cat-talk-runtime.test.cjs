// Run after `yarn build`: node --test tests/civilian-cat-talk-runtime.test.cjs
// RSPSApp/tsps#5295: the REAL NpcDialogues runtime drives West Ardougne civilians (3505, 3506, 3507) through Talk-to,
// and the item route runs the using variant in order. Only NpcDialogues and CivilianCats are registered, so the
// any-NPC Talk-to hook that answers is NpcDialogues' (PluginManager.emitNpcInteraction, PluginManager.ts:1246-1262:
// before-hooks, then specific, then any-NPC hooks, stopping once handled).
//
// Scope fact (source): Talk-to picks the variant with pickVariant (NpcDialogues.plugin.js:196-206). The Civilian data has
// no default and no plugin answers npc-dialogue:variant, so every civilian id plays standard-dialogue-civilian-1-blonde-
// short-hair. Variants 2 and 3 are never played by Talk-to; per-variant Talk-to coverage is NOT claimed here.
//
// Read-only facts this file relies on (verified in source; a run is still needed to confirm them):
// - Lines reach the client through NpcDialogue.ts (sendString at line 34, and sendChatText at line 38); the harness
//   wraps sender.sendString, so the recorded lines are the runtime's own output.
// - The choice steps are answered with MultiChatboxPrompt.getPending and dialogue_continue on OPTIONS_WIDGET_ID (the
//   andras-boat pattern), not blind continues.
//
// Known limits (not resolved by reading; reported, not hidden):
// - The Talk-to variant's unavailable marker (45OMkv) stops the conversation before the offer until the sale plugin
//   handles it. This file is written test-first: the Talk-to tests are expected RED on the fix-absent base.
// - The offer line "I'll give you [100/200] Death Runes for the cat." goes through the runtime's gendered rewrite; the
//   price check reads the recorded line and reds if it shows the wrong price.
// - The diary is a stub on diary:is-complete (Progress.isTierComplete is not run).
// - The item route is driven through PluginManager.emitItemOnNpc with a real NPC.

const assert = require("node:assert/strict");
const path = require("node:path");
const { before, afterEach, test } = require("node:test");
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

let core, index = 9700;
const cleanups = [];
const ITEM = () => core.ItemIdentifiers;
const NPCS = () => core.NpcIdentifiers;
const CIVILIANS = () => [NPCS().CIVILIAN, NPCS().CIVILIAN_2, NPCS().CIVILIAN_3];
const SALE_ADULT = () => ITEM().PET_CAT;
const RUNES = () => ITEM().DEATH_RUNE;
const OFFER_LINE = /I'll give you .*Death Runes for the cat/;
const RECEIPT = /You hand over the cat/;
const CAT_CHOICE = "I have a cat that I could sell.";
const DEAL = "Ok then, you've got a deal.";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PM.getCoreApi();
  require("../plugins/npcs/NpcDialogues.plugin").register(PM.createApi("CivilianRuntimeDialogue"));
  require("../plugins/npcs/CivilianCats.plugin").register(PM.createApi("CivilianRuntimeCats"));
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

/** A real player with a real inventory and a real civilian NPC; sendString output is recorded in order. */
function actor(npcId, items = [], { diaryDone = false } = {}) {
  const tile = [3300, 3300, 0];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...tile));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("civilian" + index);
  p.setAttribute("bot-skip-persistence", true);
  for (const [id, amount] of items) p.getInventory().adds(id, amount);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const npc = core.NPC.create(npcId, new Location(...tile));
  const lines = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { lines.push(String(text)); return original(text, ...rest); };
  const diary = PM.createApi("CivilianRuntimeDiaryStub" + index);
  diary.onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "ardougne" && request.tier === "easy") request.complete = diaryDone;
  });
  cleanups.push(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const next = () => send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  /** Continue until the menu offering `text` is pending, then pick it (the andras-boat choose pattern). */
  async function choose(text) {
    for (let n = 0; !MultiChatboxPrompt.getPending(p) && n < 60; n++) {
      assert.ok(p.getDialogueManager().getCurrent(), `dialogue ended before the choice "${text}"; lines so far: ${JSON.stringify(lines)}`);
      await next();
    }
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt?.options.includes(text), `choice "${text}" offered: ${JSON.stringify(prompt?.options)}`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: prompt.options.indexOf(text) + 1 });
  }
  /** Continue to the end of the conversation, or until a menu is pending. */
  async function playToEnd(limit = 120) {
    for (let n = 0; n < limit && p.getDialogueManager().getCurrent(); n++) {
      if (MultiChatboxPrompt.getPending(p)) break;
      await next();
    }
  }
  return { p, npc, npcId, lines, choose, playToEnd, count: (id) => p.getInventory().getAmount(id) };
}

const talkTo = (a) => PM.emitNpcInteraction({ player: a.p, npc: a.npc, npcId: a.npcId, action: "Talk-to", clickType: 1, handled: false });
const useItem = (a, itemId) => PM.emitItemOnNpc({ player: a.p, target: a.npc, npcId: a.npcId, itemId, handled: false });

test("Talk-to on each civilian (3505, 3506, 3507) reaches the offer and the deal: 'Hand over the cat and I'll give you the runes' (RED on the fix-absent base: it closes at the unavailable marker)", async () => {
  for (const npcId of CIVILIANS()) {
    const a = actor(npcId, [[SALE_ADULT(), 1]]);
    talkTo(a);
    await a.choose(CAT_CHOICE);
    await a.choose(DEAL);
    await a.playToEnd();
    assert.ok(a.lines.some((line) => /Hand over the cat and I'll give you the runes/.test(line)),
      `civilian ${npcId}: the deal reaches "Hand over the cat and I'll give you the runes" (lines: ${JSON.stringify(a.lines)})`);
  }
});

test("the offer line shows the real price: 100 Death runes without the easy diary (RED on the base: the offer is never reached)", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  talkTo(a);
  await a.choose(CAT_CHOICE);
  await a.playToEnd();
  const offer = a.lines.find((line) => OFFER_LINE.test(line));
  assert.ok(offer, "the offer line is shown");
  assert.match(offer, /\b100 Death Runes/, `the offer shows the real price 100, not a gendered 100-or-200: ${offer}`);
});

test("the offer line shows the real price: 200 Death runes with the Ardougne easy diary (RED on the base)", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]], { diaryDone: true });
  talkTo(a);
  await a.choose(CAT_CHOICE);
  await a.playToEnd();
  const offer = a.lines.find((line) => OFFER_LINE.test(line));
  assert.ok(offer, "the offer line is shown");
  assert.match(offer, /\b200 Death Runes/, `the offer shows the real price 200 after the easy diary: ${offer}`);
});

test("a plain Talk-to sells nothing: the cat stays and no runes are paid", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  talkTo(a);
  await a.choose(CAT_CHOICE);
  await a.choose(DEAL);
  await a.playToEnd();
  assert.equal(a.count(SALE_ADULT()), 1, "Talk-to does not take the cat (the sale is the use-on route)");
  assert.equal(a.count(RUNES()), 0, "Talk-to pays no runes");
});

test("the item route plays the using variant in order: receipt once at the real price, cat removed, 100 runes, closing line (RED on the base)", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  assert.equal(a.count(SALE_ADULT()), 1, "precondition: the adult cat is held");
  assert.equal(a.count(RUNES()), 0, "precondition: no runes are held");
  useItem(a, SALE_ADULT());
  await a.playToEnd();
  assert.equal(a.count(SALE_ADULT()), 0, "the cat is removed");
  assert.equal(a.count(RUNES()), 100, "100 Death runes");
  const receipts = a.lines.filter((line) => RECEIPT.test(line));
  assert.equal(receipts.length, 1, "the receipt is shown once");
  assert.doesNotMatch(receipts[0] ?? "", /\[100\/200\]/, "the receipt carries no raw token");
  assert.ok(a.lines.some((line) => /Great, thanks for that!/.test(line)), "the closing line is reached");
});

test("a kitten or the Witch's cat used on a civilian is refused through the real runtime: nothing is sold", async () => {
  for (const itemId of [ITEM().WITCHS_CAT, ITEM().PET_KITTEN]) {
    const a = actor(NPCS().CIVILIAN, [[itemId, 1]]);
    useItem(a, itemId);
    await a.playToEnd();
    assert.equal(a.count(itemId), 1, `item ${itemId} is kept`);
    assert.equal(a.count(RUNES()), 0, `no runes for item ${itemId}`);
  }
});
