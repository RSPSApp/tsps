// RSPSApp/tsps#5221 item 2: showing one clue to Zavistic by "Use on" while the player holds BOTH the black prism and the torn
// page plays the same guild conversation Talk-to plays for that pair (bell tail spliced in), which reaches the prism-and-page
// branch (condition Hssvbr, message thEwXi): progress 4, and Zavistic's "go and talk to Sithik" lines. Items are shown, not
// consumed. Run after `yarn build`, from server/:  node --test tests/zogre-use-on-zavistic-progress.test.cjs
// Real route: PluginManager, the real NpcDialogues runtime, PluginManager.emitItemOnNpc with a spawned Zavistic target (the
// call shape of tests/ape-atoll-spell-gate.test.cjs), dialogue_continue packets. Seeded (disclosed): quest stage 2 by default,
// the items in the inventory, search progress 3 (items recovered, not yet shown) unless a test says otherwise.
// Not covered: Talk-to Sithik dispatch in this harness; the Sithik variant is asserted through the quest's selector.
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

let core, quest = null, index = 14000;
const cleanups = [];
const ZAVISTIC_TILE = [2000, 2000, 0];
const PRISM = ItemIdentifiers.BLACK_PRISM, PAGE = ItemIdentifiers.TORN_PAGE;
const SEARCH = "quest.zogre_flesh_eaters.search";
const SICKS = "I'm here about the sicks...err Zogres";
const PRISM_PAGE_SHOWN = "You show the prism and the necromantic half page to the aged wizard.";
const SITHIK_SUGGESTION = "Why not go and talk to him, poke around a bit and see if anything comes up. Let me know how you get on. However, I doubt that 'Sithik' had anything to do with it.";
const GUILD_OPENER = "What are you doing...Oh, it's you...sorry...didn't realise...what can I do for you?";
const PRISM_SINGLE_LINE = "Yes, you've already showed me that";
const PAGE_SINGLE_LINE = "Hmm, this is a half torn spell page";
const SITHIK_VARIANT_BEFORE = "investigating-b-vahn-talking-to-sithik-ints-before-talking-to-zavistic-rarve";
const SITHIK_VARIANT_AFTER = "investigating-b-vahn-talking-to-sithik-ints";

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

/** A player holding `items`, at `stage` with search progress `progress`, plus helpers that drive the dialogue. */
function actor(items, { stage = 2, progress: seeded = 3 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...ZAVISTIC_TILE));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("zogre" + index);
  p.setAttribute("bot-skip-persistence", true);
  quest.setStage(p, stage);
  if (seeded) p.setAttribute(SEARCH, seeded);
  for (const id of items) p.getInventory().adds(id, 1);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const lines = [], messages = [];
  const sender = p.getPacketSender();
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendString", (t) => lines.push(String(t)));
  wrap("sendMessage", (t) => messages.push(String(t)));
  wrap("sendTypedMessage", (type, t) => messages.push(String(t)));
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const next = () => send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  /** Plays the open transcript; at an option prompt picks `choose` when it is offered, else the first option. */
  async function settle(choose = null) {
    let pending = choose;
    for (let n = 0; n < 300 && p.getDialogueManager().getCurrent(); n++) {
      const prompt = MultiChatboxPrompt.getPending(p);
      if (prompt) {
        const i = pending && prompt.options.includes(pending) ? prompt.options.indexOf(pending) : 0;
        pending = null;
        await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: i + 1 });
      } else await next();
    }
  }
  /** Use the held item with this id on a spawned Zavistic; returns whether the quest handled it. */
  async function useOn(itemId, choose = null) {
    const inventory = p.getInventory();
    const slot = inventory.getSlotForItemId(itemId);
    const item = inventory.get(slot);
    assert.ok(item, `item ${itemId} is held in the inventory`);
    const target = PM.spawnNpc({ id: core.NpcIdentifiers.ZAVISTIC_RARVE, x: ZAVISTIC_TILE[0], y: ZAVISTIC_TILE[1], z: 0,
      owner: p, ownerOnly: true }, "use-on-zavistic");
    assert.ok(target, "Zavistic spawned for the player");
    const event = { player: p, target, definition: target.getCurrentDefinition(p), npcId: target.getContentId(p),
      targetIndex: target.getIndex(), interfaceId: 149 << 16, item, itemId, slot, handled: false };
    PM.emitItemOnNpc(event);
    await settle(choose);
    return event.handled;
  }
  const progress = () => Number(p.getAttribute(SEARCH)) || 0;
  cleanups.push(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, lines, messages, useOn, progress };
}

test("BEFORE/AFTER: torn page used on Zavistic while holding both clues reaches progress 4 and Zavistic's Sithik lines", async () => {
  const a = actor([PRISM, PAGE], { progress: 3 });
  assert.equal(a.progress(), 3, "seeded: items recovered, not yet shown");
  const sithikVariant = () => PM.emitNpcDialogueVariant({ player: a.p, npcId: core.NpcIdentifiers.SITHIK_INTS });
  assert.equal(sithikVariant(), SITHIK_VARIANT_BEFORE, "Sithik's selector before the use-on (progress 3)");
  assert.equal(await a.useOn(PAGE, SICKS), true, "the page use-on is handled");
  assert.ok(a.messages.includes(PRISM_PAGE_SHOWN), `the prism and page are shown: ${JSON.stringify(a.messages)}`);
  assert.equal(a.progress(), 4, "both clues shown: progress 4, as Talk-to plays for the same pair");
  assert.equal(sithikVariant(), SITHIK_VARIANT_AFTER, "Sithik's selector after the use-on (progress 4)");
  assert.ok(a.lines.includes(SITHIK_SUGGESTION) || a.lines.some((l) => l.startsWith("Why not go and talk to him")),
    `Zavistic suggests Sithik: ${JSON.stringify(a.lines.slice(-4))}`);
  assert.equal(a.p.getInventory().getAmount(PRISM), 1, "the prism is shown, not consumed");
  assert.equal(a.p.getInventory().getAmount(PAGE), 1, "the page is shown, not consumed");
});

test("prism used on Zavistic while holding both clues: same progress 4 and Sithik lines (other order)", async () => {
  const a = actor([PRISM, PAGE], { progress: 3 });
  assert.equal(await a.useOn(PRISM, SICKS), true, "the prism use-on is handled");
  assert.equal(a.progress(), 4, "both clues shown: progress 4");
  assert.ok(a.lines.some((l) => l.startsWith("Why not go and talk to him")), `Zavistic suggests Sithik: ${JSON.stringify(a.lines.slice(-4))}`);
});

test("only the prism held: the single-item variant plays and progress stays 3", async () => {
  const a = actor([PRISM], { progress: 3 });
  assert.equal(await a.useOn(PRISM), true, "the prism use-on is handled by the single-item variant");
  assert.equal(a.progress(), 3, "one clue held: progress unchanged");
  assert.ok(!a.lines.some((l) => l.startsWith("Why not go and talk to him")), "no Sithik suggestion from the single-item variant");
});

test("progress already 4: the use-on keeps its existing variant (no guild conversation restart)", async () => {
  const a = actor([PRISM, PAGE], { progress: 4 });
  assert.equal(await a.useOn(PRISM), true, "handled by the existing single-item variant");
  assert.equal(a.progress(), 4, "progress stays 4");
  assert.ok(a.lines.includes(PRISM_SINGLE_LINE), `the existing prism line is spoken: ${JSON.stringify(a.lines.slice(0, 4))}`);
  assert.ok(!a.lines.includes(GUILD_OPENER), "the guild conversation does not restart");
  assert.ok(!a.lines.some((l) => l.startsWith("Why not go and talk to him")), "no Sithik suggestion");
});

test("stage 4 or later: the use-on keeps its existing variant", async () => {
  const a = actor([PRISM, PAGE], { stage: 4, progress: 3 });
  assert.equal(await a.useOn(PAGE), true, "handled by the existing single-item variant");
  assert.equal(a.progress(), 3, "progress unchanged at stage 4");
  assert.ok(a.lines.includes(PAGE_SINGLE_LINE), `the existing page line is spoken: ${JSON.stringify(a.lines.slice(0, 4))}`);
  assert.ok(!a.lines.includes(GUILD_OPENER), "the guild conversation does not restart");
  assert.ok(!a.lines.some((l) => l.startsWith("Why not go and talk to him")), "no Sithik suggestion");
});
