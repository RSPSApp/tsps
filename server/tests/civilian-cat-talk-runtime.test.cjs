// Run after `yarn build`: node --test tests/civilian-cat-talk-runtime.test.cjs
// RSPSApp/tsps#5295: the REAL NpcDialogues runtime drives West Ardougne civilians (3505, 3506, 3507) through Talk-to,
// and the item route runs the using variant in order. Registered in this process: NpcDialogues, the real Pets plugin
// (CivilianCats reads the sellable cats from its pets:definitions answer), CivilianCats, and one diary stub. Pets' any-NPC
// hook answers only "Pick-up" and "Metamorphosis" and its click hooks are limited to pet NPC ids (grep of Pets.plugin.js),
// so the any-NPC Talk-to hook that answers civilians is NpcDialogues' (PluginManager.emitNpcInteraction: before-hooks, then
// specific, then any-NPC hooks, stopping once handled).
//
// Scope fact (source): Talk-to picks the variant with pickVariant (NpcDialogues.plugin.js:196-206). The Civilian data has
// no default and no plugin answers npc-dialogue:variant, so every civilian id plays standard-dialogue-civilian-1-blonde-
// short-hair. Variants 2 and 3 are never played by Talk-to; per-variant Talk-to coverage is NOT claimed here.
//
// Channels recorded: dialogue text reaches the client through sender.sendString (Dialogue.sendChatText, Dialogue.ts:24-33)
// and is recorded in `lines`. The receipt is a game message: the plugin calls player.sendMessage, which reaches
// PacketSender.sendMessage (PacketSender.ts:822) and is recorded in `messages`, so the two channels are separate.
//
// Known limits (reported, not hidden):
// - Talk-to variant 1 stops at its unavailable marker (45OMkv) until the sale plugin handles it; the Talk-to tests that
//   reach the offer or the deal are RED on the fix-absent base and say so.
// - The offer line "I'll give you [100/200] Death Runes for the cat." is generated text. An unhandled line shows the literal
//   token (the runtime's gendered rewrite keeps the whole group when no alternative is gendered, NpcDialogues.plugin.js:161-188).
//   The price assertions below discriminate: the literal token fails them.
// - The diary is a stub on diary:is-complete (Progress.isTierComplete is not run). One stub, a mutable flag per actor.
// - The item route is driven through PluginManager.emitItemOnNpc with a real NPC.
//
// Classification on the fix-absent base (1d9a5670 plus this file): the harness proofs (opening lines, the menu offers the
// cat choice) are GREEN; the Talk-to offer and deal tests are RED at the intended lines; the item-route test is a
// composition check that may already be GREEN, because the item route is implemented on that base.

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
/** The diary answer for the next actor: one stub is registered for the whole process, and each actor sets this flag. */
const diaryState = { done: false };
const ITEM = () => core.ItemIdentifiers;
const NPCS = () => core.NpcIdentifiers;
const CIVILIANS = () => [NPCS().CIVILIAN, NPCS().CIVILIAN_2, NPCS().CIVILIAN_3];
const SALE_ADULT = () => ITEM().PET_CAT;
const RUNES = () => ITEM().DEATH_RUNE;
const OFFER_LINE = /I'll give you .*Death Runes for the cat/;
const RECEIPT = /You hand over the cat/;
const CAT_CHOICE = "I have a cat that I could sell.";
const DEAL = "Ok then, you've got a deal.";
const OPENING = "Oh hello, I'm sorry, I'm a bit worn out.";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PM.getCoreApi();
  require("../plugins/npcs/NpcDialogues.plugin").register(PM.createApi("CivilianRuntimeDialogue"));
  require("../plugins/npcs/Pets.plugin").register(PM.createApi("CivilianRuntimePets"));
  require("../plugins/npcs/CivilianCats.plugin").register(PM.createApi("CivilianRuntimeCats"));
  PM.createApi("CivilianRuntimeDiaryStub").onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "ardougne" && request.tier === "easy") request.complete = diaryState.done;
  });
});

afterEach(() => {
  diaryState.done = false;
  while (cleanups.length) cleanups.pop()();
});

/** A real player with a real inventory and a real civilian NPC. Chatbox lines and game messages are recorded apart. */
function actor(npcId, items = [], { diaryDone = false } = {}) {
  const tile = [3300, 3300, 0];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...tile));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("civilian" + index);
  p.setAttribute("bot-skip-persistence", true);
  for (const [id, amount] of items) p.getInventory().adds(id, amount);
  diaryState.done = diaryDone;
  const connection = new ClientConnection(channel);
  connection.player = p;
  const npc = core.NPC.create(npcId, new Location(...tile));
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
  /** Continue until the next menu is pending or the conversation ends. */
  async function playToEnd(limit = 120) {
    for (let n = 0; n < limit && p.getDialogueManager().getCurrent(); n++) {
      if (MultiChatboxPrompt.getPending(p)) break;
      await next();
    }
  }
  return { p, npc, npcId, lines, messages, choose, playToEnd, count: (id) => p.getInventory().getAmount(id) };
}

const talkTo = (a) => PM.emitNpcInteraction({ player: a.p, npc: a.npc, npcId: a.npcId, action: "Talk-to", clickType: 1, handled: false });
const useItem = (a, itemId) => PM.emitItemOnNpc({ player: a.p, target: a.npc, npcId: a.npcId, itemId, handled: false });

// Precondition (GREEN on the base): the sellable set the sale plugin reads is answered by the real Pets table.
test("precondition: pets:definitions answers with the adult cat (the sale plugin reads its sellable set from there)", () => {
  const request = { pets: [] };
  PM.emitCustomEvent("pets:definitions", request);
  assert.ok(request.pets.some((pet) => pet.itemId === SALE_ADULT()), "the adult cat (PET_CAT) is in the pet table answer");
});

// Harness proofs (GREEN on the fix-absent base): the real Talk-to runs and the menu offers the cat choice.
test("harness proof: Talk-to on each civilian plays the variant-1 opening lines and offers the cat choice", async () => {
  for (const npcId of CIVILIANS()) {
    const a = actor(npcId, [[SALE_ADULT(), 1]]);
    talkTo(a);
    await a.playToEnd();
    assert.ok(a.lines.some((line) => line.includes(OPENING)),
      `civilian ${npcId}: the variant-1 opening line is recorded (lines: ${JSON.stringify(a.lines.slice(0, 4))})`);
    await a.choose(CAT_CHOICE);
  }
});

test("harness proof: Talk-to with no cat reaches the no-cat branch and offers no cat choice", async () => {
  const a = actor(NPCS().CIVILIAN, []);
  talkTo(a);
  await a.playToEnd();
  assert.ok(a.lines.some((line) => line.includes(OPENING)), "the opening line is recorded");
  assert.ok(!a.lines.some((line) => /I have a cat that I could sell/.test(line)), "no cat choice is offered without a cat");
});

// Intended reds on the fix-absent base (the sale plugin's Talk-to handling is not in place).
test("Talk-to on each civilian reaches the offer (RED on the fix-absent base: the conversation closes at the unavailable marker)", async () => {
  for (const npcId of CIVILIANS()) {
    const a = actor(npcId, [[SALE_ADULT(), 1]]);
    talkTo(a);
    await a.choose(CAT_CHOICE);
    await a.playToEnd();
    assert.ok(a.lines.some((line) => OFFER_LINE.test(line)), `civilian ${npcId}: the offer line is reached`);
  }
});

test("the offer line shows the real price: 100 Death runes without the easy diary (RED on the base: the offer is not reached)", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  talkTo(a);
  await a.choose(CAT_CHOICE);
  await a.playToEnd();
  const offer = a.lines.find((line) => OFFER_LINE.test(line));
  assert.ok(offer, "the offer line is shown");
  assert.match(offer, /\b100 Death Runes/, `the offer shows the real price 100, not the literal token: ${offer}`);
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

test("the deal reaches 'Hand over the cat and I'll give you the runes' (RED on the base: the deal is after the offer)", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  talkTo(a);
  await a.choose(CAT_CHOICE);
  await a.playToEnd();
  assert.ok(a.lines.some((line) => OFFER_LINE.test(line)), "the offer is reached first");
  await a.choose(DEAL);
  await a.playToEnd();
  assert.ok(a.lines.some((line) => /Hand over the cat and I'll give you the runes/.test(line)), "the deal line is reached");
  // After the deal, Talk-to alone still sells nothing (the sale is the use-on route).
  assert.equal(a.count(SALE_ADULT()), 1, "Talk-to does not take the cat, even at the deal");
  assert.equal(a.count(RUNES()), 0, "Talk-to pays no runes, even at the deal");
  assert.equal(a.messages.filter((text) => RECEIPT.test(text)).length, 0, "no receipt message from Talk-to");
});

// Control (GREEN on the base and on AFTER): a plain Talk-to that stops at the cat menu sells nothing.
test("control: a plain Talk-to that stops at the cat menu sells nothing: the cat stays, no runes, no receipt message", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  talkTo(a);
  await a.choose(CAT_CHOICE);
  assert.equal(a.count(SALE_ADULT()), 1, "the cat is kept at the cat menu (Talk-to does not take it)");
  assert.equal(a.count(RUNES()), 0, "no runes at the cat menu");
  assert.equal(a.messages.filter((text) => RECEIPT.test(text)).length, 0, "no receipt message at the cat menu");
});

// The item route: a composition check of the using variant (it may already be GREEN on this base; the item route is in place).
test("the item route plays the using variant in order: the receipt is one game message at the real price; the cat is removed; 100 runes; the closing line", async () => {
  const a = actor(NPCS().CIVILIAN, [[SALE_ADULT(), 1]]);
  assert.equal(a.count(SALE_ADULT()), 1, "precondition: the adult cat is held");
  assert.equal(a.count(RUNES()), 0, "precondition: no runes are held");
  useItem(a, SALE_ADULT());
  await a.playToEnd();
  assert.equal(a.count(SALE_ADULT()), 0, "the cat is removed");
  assert.equal(a.count(RUNES()), 100, "100 Death runes");
  const receipts = a.messages.filter((text) => RECEIPT.test(text));
  assert.equal(receipts.length, 1, "the receipt is one game message");
  assert.match(receipts[0] ?? "", /You are given 100 Death Runes/, "the receipt names the real price 100 (the tree reads \"You are given [100/200] Death Runes.\")");
  assert.doesNotMatch(receipts[0] ?? "", /\[100\/200\]/, "the receipt carries no raw token");
  assert.ok(a.lines.some((line) => /Great, thanks for that!/.test(line)), "the closing dialogue line is reached");
});

test("a kitten or the Witch's cat used on a civilian is refused through the real runtime: silence, nothing sold", async () => {
  for (const itemId of [ITEM().WITCHS_CAT, ITEM().PET_KITTEN]) {
    const a = actor(NPCS().CIVILIAN, [[itemId, 1]]);
    useItem(a, itemId);
    await a.playToEnd();
    assert.equal(a.count(itemId), 1, `item ${itemId} is kept`);
    assert.equal(a.count(RUNES()), 0, `no runes for item ${itemId}`);
    assert.equal(a.messages.length, 0, `item ${itemId}: nothing is sent as a game message`);
    assert.equal(a.lines.length, 0, `item ${itemId}: no dialogue lines are recorded`);
  }
});
