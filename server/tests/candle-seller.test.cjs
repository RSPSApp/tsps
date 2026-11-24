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
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin.js");
let core, codec, nextIndex = 9700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => PM.emitServerShutdown({}));

function fixture(t) {
  const packets = [];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`candle${nextIndex}`); player.setRegistered(true);
  player.needsPlacement = false;
  player.setLocation(new core.Location(3170, 3176));
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, connection, packets };
}

async function resume(f, choice) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]);
  f.connection.processTurnPackets();
}

function options(f) {
  return core.MultiChatboxPrompt.getPending(f.player)?.options ?? [];
}

async function choose(f, text) {
  const index = options(f).indexOf(text);
  assert.ok(index >= 0, `menu offers "${text}" (got ${JSON.stringify(options(f))})`);
  await resume(f, index + 1);
}

/** Continues until the next menu or the end, returning the lines shown. */
async function readLines(f) {
  const lines = [];
  for (let i = 0; i < 15 && f.player.getDialogueManager().getCurrent() && !options(f).length; i++) {
    lines.push(f.player.getDialogueManager().getCurrent().getText?.());
    await resume(f);
  }
  return lines;
}

async function talk(f) {
  const npcId = core.NpcIdentifiers.CANDLE_SELLER;
  const npc = core.NPC.create(npcId, new core.Location(3170, 3176));
  PM.emitNpcInteraction({ player: f.player, npc, npcId, action: "Talk-to", clickType: 1, handled: false });
  return readLines(f);
}

const BOUGHT = "Here you go then.", REFUSED = "But I don't have that kind of money on me.";

for (const [coins, full, bought] of [[1411, false, true], [1000, false, true], [999, false, false], [0, false, false], [1000, true, true], [1411, true, false]]) {
  test(`Yes please: ${coins} coins, full=${full}`, async t => {
    const f = fixture(t), inventory = f.player.getInventory(), I = core.ItemIdentifiers;
    if (coins) inventory.setItem(0, new core.Item(I.COINS, coins));
    if (full) for (let slot = 1; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.COWHIDE, 1));
    await talk(f);
    await choose(f, "Yes please.");
    const lines = await readLines(f);
    assert.equal(inventory.getAmount(I.COINS), coins - (bought ? 1000 : 0));
    assert.equal(inventory.getAmount(I.LIT_CANDLE), bought ? 1 : 0);
    if (coins >= 1000) {
      assert.ok(lines.includes(BOUGHT), `seller hands over: ${JSON.stringify(lines)}`);
      assert.ok(!lines.includes(REFUSED));
    } else {
      assert.ok(lines.includes(REFUSED), `player has no money: ${JSON.stringify(lines)}`);
      assert.ok(lines.includes("Well then, no candle for you!"));
      assert.ok(!lines.includes(BOUGHT));
    }
    assert.ok(f.packets.length > 0, "real PacketSender output");
  });
}

test("the haggling menu's buy option sells one candle, and a stale choice does not sell another", async t => {
  const f = fixture(t), inventory = f.player.getInventory(), I = core.ItemIdentifiers;
  inventory.setItem(0, new core.Item(I.COINS, 5000));
  await talk(f);
  await choose(f, "One thousand gold?!");
  await readLines(f);
  await choose(f, "All right, you win, I'll buy a candle.");
  const lines = await readLines(f);
  assert.ok(lines.includes(BOUGHT), JSON.stringify(lines));
  assert.equal(inventory.getAmount(I.COINS), 4000);
  assert.equal(inventory.getAmount(I.LIT_CANDLE), 1);
  await choose(f, "Thanks, bye.");
  await readLines(f);
  await resume(f, 1);
  assert.equal(inventory.getAmount(I.COINS), 4000, "stale choice cannot buy again");
  assert.equal(inventory.getAmount(I.LIT_CANDLE), 1);
});

test("Death to the Dorgeshuun's tour stop sells through the same coin check on both routes", async t => {
  for (const route of [["Yes please."], ["One thousand gold?!", "All right, you win, I'll buy a candle."]]) {
    const f = fixture(t), inventory = f.player.getInventory(), I = core.ItemIdentifiers;
    inventory.setItem(0, new core.Item(I.COINS, 1411));
    const npcId = core.NpcIdentifiers.CANDLE_SELLER;
    const npc = core.NPC.create(npcId, new core.Location(3170, 3176));
    const request = { player: f.player, npc, npcId, exact: true, handled: false,
      variant: { page: "Death to the Dorgeshuun", variant: "a-tour-of-lumbridge-candle-seller" } };
    PM.emitCustomEvent("npc-dialogue:start", request);
    assert.equal(request.handled, true);
    let lines = await readLines(f);
    assert.ok(lines.some(line => /So do you want to buy another one\?$/.test(line)), JSON.stringify(lines));
    for (const answer of route) {
      await choose(f, answer);
      lines = await readLines(f);
    }
    assert.ok(lines.includes(BOUGHT), `${route[0]}: ${JSON.stringify(lines)}`);
    assert.ok(!lines.includes("Yes please.") || route[0] === "Yes please.", "the haggled purchase does not say Yes please.");
    assert.equal(inventory.getAmount(I.COINS), 411);
    assert.equal(inventory.getAmount(I.LIT_CANDLE), 1);
  }
});

function conversationVarbit(f) {
  return f.player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("swamp_candle_guy_conversation"));
}

test("the naked-flame warning sets swamp_candle_guy_conversation, and the next talk opens the learnt menu", async t => {
  const f = fixture(t), inventory = f.player.getInventory(), I = core.ItemIdentifiers;
  const completed = [];
  const listener = event => { if (event.player === f.player) completed.push(event.id); };
  PM.createApi("CandleSellerTest").onCustomEvent("league:complete-task", listener);
  inventory.setItem(0, new core.Item(I.COINS, 2000));
  await talk(f);
  assert.equal(conversationVarbit(f), 0);
  await choose(f, "Yes please.");
  // "Yes please." is showing; its continue makes the sale and shows "Here you go then.".
  await resume(f);
  assert.equal(f.player.getDialogueManager().getCurrent().getText(), BOUGHT);
  assert.equal(inventory.getAmount(I.LIT_CANDLE), 1, "sold with the hand-over line");
  assert.deepEqual(completed, ["buy-a-candle-in-lumbridge"]);
  assert.equal(conversationVarbit(f), 0, "not before the warning line");
  await resume(f);
  assert.match(f.player.getDialogueManager().getCurrent().getText(), /^I should warn you, though/);
  assert.equal(conversationVarbit(f), 1);
  f.player.closeInterruptibleInterfaces();

  await talk(f);
  assert.deepEqual(options(f), ["Yes please.", "One thousand gold?!", "No thanks, I'd rather curse the darkness.", "How do you make lanterns?"]);
  await choose(f, "Yes please.");
  const lines = await readLines(f);
  assert.deepEqual(lines.slice(0, 2), ["Yes please.", BOUGHT]);
  assert.equal(inventory.getAmount(I.COINS), 0);
  assert.equal(inventory.getAmount(I.LIT_CANDLE), 2);
});

test("the haggling menu sets the varbit without a sale; a refused sale does not", async t => {
  const poor = fixture(t);
  await talk(poor);
  await choose(poor, "Yes please.");
  await readLines(poor);
  assert.equal(conversationVarbit(poor), 0);
  assert.equal(poor.player.getAttribute(plugin()._test.CONVERSATION_ATTRIBUTE) === true, false);

  const f = fixture(t);
  await talk(f);
  await choose(f, "One thousand gold?!");
  await readLines(f);
  assert.ok(options(f).includes("No way."));
  assert.equal(conversationVarbit(f), 1);
  assert.equal(f.player.getAttribute(plugin()._test.CONVERSATION_ATTRIBUTE), true);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.LIT_CANDLE), 0);
});

function plugin() {
  return require("../plugins/npcs/CandleSeller.plugin.js");
}

test("the conversation flag survives a save and reload, and login resends the varbit", async t => {
  const f = fixture(t);
  await talk(f);
  await choose(f, "One thousand gold?!");
  await readLines(f);
  f.player.closeInterruptibleInterfaces();
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = fixture(t);
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  g.player.setRegistered(true);
  g.player.setLocation(new core.Location(3170, 3176));
  assert.equal(conversationVarbit(g), 0, "a fresh session has not been told yet");
  PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  assert.equal(conversationVarbit(g), 1);
  await talk(g);
  assert.equal(options(g).length, 4);

  const fresh = fixture(t);
  assert.equal(JSON.stringify(PlayerSave.fromPlayer(fresh.player)).includes(plugin()._test.CONVERSATION_ATTRIBUTE), false,
    "the starting value is not saved");
});
