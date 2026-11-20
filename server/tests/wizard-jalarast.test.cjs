// Run after `yarn build`: node --test tests/wizard-jalarast.test.cjs
// Wizard Jalarast (NPC 3232) makes splitbark armour: Trade opens "How many do you wish to buy?"
// (rsprox.net recording 3202, tick 2370), and a pick takes the bark, fine cloth and coins that
// Wizard Jalarast's transcript names (npc-dialogues.json "Wizard Jalarast", shop-dialogue).
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const path = require("node:path");

process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const JALARAST = 3232;
const COINS = 995;
const MADE = "There you go, enjoy your new armour!";
const AT = [3226, 3218];

let native;
let ids;
let nextIndex = 2210;

before(async () => {
  await CachePipeline.initialize();
  native = PluginManager.getCoreApi();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  native.RegionManager.init();
  native.RegionManager.loadMapFiles(AT[0], AT[1]);
  PluginManager.emitServerStartup({});
  const obj = (name) => CacheDefinitions.getObjId(name);
  ids = {
    bark: obj("hollow_bark"), cloth: obj("fine_cloth"),
    helm: obj("splitbark_helm"), body: obj("splitbark_body"), legs: obj("splitbark_legs"),
    gauntlets: obj("splitbark_gauntlets"), boots: obj("splitbark_greaves"),
  };
});
after(() => PluginManager.emitServerShutdown({}));

function setUp(t, { bark = 0, cloth = 0, coins = 0 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername("jalarast" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new native.Location(AT[0], AT[1], 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  const npc = native.NPC.create(JALARAST, new native.Location(AT[0] + 1, AT[1], 0));
  assert.equal(native.World.getNpcs().add(npc), true);
  t.after(() => {
    player.closeInterruptibleInterfaces();
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    native.TaskManager.cancelTasks(player.getIndex());
    native.TaskManager.cancelTasks(player);
    native.World.getNpcs().remove(npc);
  });
  const inv = player.getInventory();
  if (bark) inv.add(new native.Item(ids.bark, bark), false);
  if (cloth) inv.add(new native.Item(ids.cloth, cloth), false);
  if (coins) inv.add(new native.Item(COINS, coins), false);
  const scripts = [];
  const sender = player.getPacketSender();
  const sendInterfaceScript = sender.sendInterfaceScript.bind(sender);
  t.mock.method(sender, "sendInterfaceScript", (id, args) => { scripts.push({ id, args }); return sendInterfaceScript(id, args); });
  const turn = () => {
    player.resetUpdating();
    native.World.processCycle = (native.World.processCycle + 1) & 0x7fffffff;
    native.TaskManager.process();
    connection.processTurnPackets();
    const queue = player.getMovementQueue();
    queue.beginCycle();
    queue.processEntityPursuit();
    if (queue.hasPendingWork()) queue.process();
    native.TaskManager.processWalkTo(player.getIndex());
  };
  const click = async (option) => {
    const op = npc.getCurrentDefinition(player).getActions().indexOf(option) + 1;
    assert.ok(op > 0, option);
    await connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: op }]);
    turn();
    for (let n = 0; n < 6 && !player.getDialogueManager().getCurrent() && !player.getCreationMenu?.(); n++) turn();
  };
  const menu = () => player.getCreationMenu?.() ?? null;
  const pick = (itemId) => {
    const current = menu();
    assert.ok(current, "the purchase menu is open");
    current.execute(itemId, 1);
    for (let n = 0; n < 3 && !player.getDialogueManager().getCurrent(); n++) turn();
    return player.getDialogueManager().getCurrent();
  };
  const group = () => player.getPacketSender().getChatboxGroupId();
  const send = async (packet) => { await connection.dispatch([packet]); for (let n = 0; n < 3; n++) turn(); };
  /** Continues lines until a dialogue menu shows; returns its options (null once the chatbox closed). */
  const options = async () => {
    for (let n = 0; n < 20; n++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === "function") return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      await send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return null;
  };
  const choose = async (option) => {
    const shown = await options();
    assert.ok(shown, "a dialogue menu opened");
    const at = shown.indexOf(option);
    assert.ok(at >= 0, `${option} in ${JSON.stringify(shown)}`);
    await send({ type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: at + 1 });
  };
  return { player, npc, inv, scripts, click, turn, menu, pick, options, choose };
}

function menuScript(scripts) {
  return scripts.filter((call) => call.id === 2046).at(-1);
}

test("Trade opens the captured purchase menu: verb 20, five pieces, amount 1", async (t) => {
  const { click, scripts, menu } = setUp(t);
  await click("Trade");
  assert.ok(menu(), "skillmulti opened");
  const script = menuScript(scripts);
  assert.ok(script, "skillmulti_setup sent");
  assert.equal(script.args[0], 20);
  assert.equal(script.args[1], "How many do you wish to buy?|Helm|Body|Legs|Gauntlets|Boots");
  assert.equal(script.args[2], 1);
  assert.deepEqual(script.args.slice(3, 8), [ids.helm, ids.body, ids.legs, ids.gauntlets, ids.boots]);
  assert.equal(script.args.at(-1), 1);
});

test("a helm takes 2 bark, 2 fine cloth and 6,000 coins", async (t) => {
  const { click, pick, inv } = setUp(t, { bark: 3, cloth: 2, coins: 7000 });
  await click("Trade");
  const line = pick(ids.helm);
  assert.equal(line?.getText?.(), MADE);
  assert.notEqual(line?.expression, native.CacheDefinitions.getSeqId("chatsad2"), "only the refusal is sad");
  assert.equal(inv.getAmount(ids.helm), 1);
  assert.equal(inv.getAmount(ids.bark), 1);
  assert.equal(inv.getAmount(ids.cloth), 0);
  assert.equal(inv.getAmount(COINS), 1000);
});

test("each piece costs what its transcript line says", async (t) => {
  const rows = [
    ["body", 4, 37000], ["legs", 3, 32000], ["gauntlets", 1, 1000], ["boots", 1, 1000],
  ];
  for (const [name, pieces, coins] of rows) {
    await t.test(name, async (st) => {
      const { click, pick, inv } = setUp(st, { bark: pieces, cloth: pieces, coins });
      await click("Trade");
      assert.equal(pick(ids[name])?.getText?.(), MADE);
      assert.equal(inv.getAmount(ids[name]), 1);
      assert.equal(inv.getAmount(ids.bark) + inv.getAmount(ids.cloth) + inv.getAmount(COINS), 0);
    });
  }
});

test("without the supplies the piece's line names them and nothing is taken", async (t) => {
  const { click, pick, inv } = setUp(t, { bark: 4, cloth: 4, coins: 36999 });
  await click("Trade");
  const line = pick(ids.body);
  assert.equal(line?.getText?.(), "You need 4 pieces of bark, 4 pieces of fine cloth and 37,000 coins for a splitbark body.");
  assert.equal(line?.expression, native.CacheDefinitions.getSeqId("chatsad2"), "the refusal's head is chatsad2, as recorded");
  assert.equal(inv.getAmount(ids.body), 0);
  assert.equal(inv.getAmount(ids.bark), 4);
  assert.equal(inv.getAmount(COINS), 36999);
});

test("noted bark does not count", async (t) => {
  const { click, pick, inv } = setUp(t, { cloth: 1, coins: 1000 });
  inv.add(new native.Item(ids.bark + 1, 1), false);
  await click("Trade");
  assert.equal(pick(ids.boots)?.getText?.(), "You need 1 piece of bark, 1 piece of fine cloth and 1,000 coins for splitbark boots.");
  assert.equal(inv.getAmount(ids.boots), 0);
});

test("the transcript's \"Continues with shop dialogue.\" action opens the purchase menu once the chatbox closes", (t) => {
  const { player, npc, turn, menu } = setUp(t);
  const event = { player, npc, npcId: JALARAST, text: "Continues with shop dialogue.", handled: false };
  PluginManager.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  assert.equal(menu(), null, "not before the conversation closes");
  turn();
  turn();
  assert.ok(menu(), "the purchase menu opened");
});

test("the transcript's non-members condition is answered false on a members world", () => {
  const answer = PluginManager.emitNpcDialogueCondition({ npcId: JALARAST, text: "If the player is on a non-members world:" });
  assert.equal(answer, false);
});

test("Talk-to's \"Can you make me some armour please?\" goes on into the purchase menu, with no condition shown as an option", async (t) => {
  const { player, click, choose, options, menu, turn, scripts } = setUp(t);
  await click("Talk-to");
  await choose("Can you make me some armour please?");
  assert.equal(await options(), null, "no menu after \"Certainly, what would you like me to make?\" (#6292)");
  for (let n = 0; n < 3 && !menu(); n++) turn();
  assert.ok(menu(), "the purchase menu opened");
  assert.equal(player.getDialogueManager().isActive(), false);
  assert.equal(menuScript(scripts)?.args?.[0], 20, "the captured verb argument, as from Trade");
});
