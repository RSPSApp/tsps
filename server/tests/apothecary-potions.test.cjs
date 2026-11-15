// Run after `yarn build`: node --test tests/apothecary-potions.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Apothecary = require("../plugins/npcs/Apothecary.plugin");

const COINS = 995;
const LIMPWURT_ROOT = 225;
const RED_SPIDERS_EGGS = 223;
const CHOCOLATE_DUST = 1975;
const CADAVA_BERRIES = 753;
const STRENGTH_POTION_4 = 113;
const ENERGY_POTION_4 = 3008;
const ANTIPOISON_4 = 2446;
const APOTHECARY_POTIONS = 556;
const MISSING = "You haven't got the required items.";

let core;
let npcOptions;
let dialogueAction;
const buttons = new Map();
const emitted = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  npcOptions = new Map();
  Apothecary.register(new Proxy({
    core,
    onNpcInteraction(name, handlers) { npcOptions.set(name, handlers); },
    onCustomEvent(name, handler) { if (name === "npc-dialogue:action") dialogueAction = handler; },
    onInterfaceActionButton(id, handler) { buttons.set(id, handler); },
    emitCustomEvent(name, event) { emitted.push([name, event]); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function uid(name) {
  return core.CacheDefinitions.getComponentId(`apothecary_potions:${name}`);
}

function actor(t, items = {}) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  const inventory = player.getInventory();
  for (const [id, amount] of Object.entries(items)) inventory.adds(Number(id), amount);
  const messages = [];
  const packets = [];
  let amountAction = null;
  const sender = new Proxy({
    sendClientScript(...args) { packets.push(["script", ...args]); return sender; },
    sendInterface(id) { player.setInterfaceId(id); packets.push(["open", id]); return sender; },
    sendString(text, id) { packets.push(["text", id, text]); return sender; },
    sendItemOnInterface(id, item, slot, count) { packets.push(["object", id, item, count]); return sender; },
    sendEnterAmountPrompt(title) { packets.push(["prompt", title]); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "getEnteredAmountAction", () => amountAction);
  t.mock.method(player, "setEnteredAmountAction", (action) => { amountAction = action; });
  t.mock.method(inventory, "refreshItems", () => inventory);
  emitted.length = 0;
  return { player, inventory, messages, packets, enter: (n) => { const a = amountAction; amountAction = null; a.execute(n); } };
}

function click(f, potion, opId) {
  const event = { player: f.player, action: 0, opId };
  buttons.get(uid(potion))(event);
  return event;
}

function open(f) {
  assert.equal(npcOptions.get("Apothecary").Potions({ player: f.player }), true);
}

function texts(f, name) {
  return f.packets.filter((p) => p[0] === "text" && p[1] === uid(name)).map((p) => p[2]);
}

test("Potions opens 556 as captured: inventory tab, mainmodal script, then titles, contents and models", (t) => {
  const f = actor(t, { [COINS]: 100, [CADAVA_BERRIES]: 1 });
  open(f);
  assert.deepEqual(f.packets, [
    ["script", 915, 3],
    ["script", 2524, -1, -1],
    ["open", APOTHECARY_POTIONS],
    ["text", uid("strength_title"), "Strength potion"],
    ["text", uid("strength_contents"), "<str>Red spiders' eggs</str><br><str>Limpwurt root</str><br>5 coins"],
    ["object", uid("strength_pic"), STRENGTH_POTION_4, 380],
    ["text", uid("energy_title"), "Energy potion"],
    ["text", uid("energy_contents"), "<str>Chocolate dust</str><br><str>2 limpwurt roots</str>"],
    ["object", uid("energy_pic"), ENERGY_POTION_4, 380],
    ["text", uid("antipoison_title"), "Antipoison potion"],
    ["text", uid("antipoison_contents"), "Cadava berry<br><str>Limpwurt root</str><br>5 coins"],
    ["object", uid("antipoison_pic"), ANTIPOISON_4, 380],
  ]);
});

test("every Buy option without the ingredients refuses with the captured message and takes nothing", (t) => {
  const f = actor(t, { [COINS]: 100 });
  open(f);
  for (const op of [1, 2, 3, 4]) assert.equal(click(f, "strength", op).handled, true);
  click(f, "energy", 1);
  click(f, "antipoison", 1);
  assert.deepEqual(f.messages, Array(6).fill(MISSING));
  assert.equal(f.packets.some((p) => p[0] === "prompt"), false, "Buy-X refuses before asking for an amount");
  assert.equal(f.inventory.getAmount(COINS), 100);
});

test("Buy-1 strength takes an egg, a root and 5 coins, gives a strength potion(4) and feeds the diary", (t) => {
  const f = actor(t, { [COINS]: 7, [RED_SPIDERS_EGGS]: 2, [LIMPWURT_ROOT]: 2 });
  open(f);
  click(f, "strength", 1);
  assert.equal(f.inventory.getAmount(STRENGTH_POTION_4), 1);
  assert.equal(f.inventory.getAmount(COINS), 2);
  assert.equal(f.inventory.getAmount(RED_SPIDERS_EGGS), 1);
  assert.equal(f.inventory.getAmount(LIMPWURT_ROOT), 1);
  assert.deepEqual(emitted.map(([name, e]) => [name, e.player === f.player, e.amount]),
    [["apothecary:strength-potion-made", true, 1]]);
  // The purchase opens the interface again (rec 3219 tick 7171); the 2 coins left are struck through.
  const after = f.packets.slice(12);
  assert.deepEqual(after.slice(0, 3), [["script", 915, 3], ["script", 2524, -1, -1], ["open", APOTHECARY_POTIONS]]);
  assert.equal(texts(f, "strength_contents").at(-1), "Red spiders' eggs<br>Limpwurt root<br><str>5 coins</str>");
  click(f, "strength", 1);
  assert.deepEqual(f.messages, [MISSING]);
});

test("Buy-5 and Buy-All make as many as the ingredients pay for; energy takes 2 roots and no coins", (t) => {
  const f = actor(t, { [COINS]: 1000, [CHOCOLATE_DUST]: 10, [LIMPWURT_ROOT]: 7 });
  open(f);
  click(f, "energy", 2);
  assert.equal(f.inventory.getAmount(ENERGY_POTION_4), 3, "seven roots pay for three");
  assert.equal(f.inventory.getAmount(LIMPWURT_ROOT), 1);
  assert.equal(f.inventory.getAmount(CHOCOLATE_DUST), 7);
  assert.equal(f.inventory.getAmount(COINS), 1000);
  f.inventory.adds(LIMPWURT_ROOT, 3);
  click(f, "energy", 4);
  assert.equal(f.inventory.getAmount(ENERGY_POTION_4), 5);
  assert.equal(f.inventory.getAmount(LIMPWURT_ROOT), 0);
  assert.deepEqual(f.messages, []);
  assert.deepEqual(emitted, [], "only strength potions feed the diary");
});

test("Buy-X asks for an amount and makes up to it; antipoison takes a berry, a root and 5 coins", (t) => {
  const f = actor(t, { [COINS]: 12, [CADAVA_BERRIES]: 5, [LIMPWURT_ROOT]: 5 });
  open(f);
  click(f, "antipoison", 3);
  assert.deepEqual(f.packets.filter((p) => p[0] === "prompt"), [["prompt", "Enter amount:"]]);
  f.enter(4);
  assert.equal(f.inventory.getAmount(ANTIPOISON_4), 2, "12 coins pay for two");
  assert.equal(f.inventory.getAmount(COINS), 2);
  assert.equal(f.inventory.getAmount(CADAVA_BERRIES), 3);
  assert.equal(f.inventory.getAmount(LIMPWURT_ROOT), 3);
});

test("a second Buy-X before answering re-arms the prompt for the potion clicked last", (t) => {
  const f = actor(t, { [COINS]: 100, [CADAVA_BERRIES]: 5, [LIMPWURT_ROOT]: 5, [RED_SPIDERS_EGGS]: 5 });
  open(f);
  click(f, "strength", 3);
  click(f, "antipoison", 3);
  assert.equal(f.packets.filter((p) => p[0] === "prompt").length, 2);
  f.enter(2);
  assert.equal(f.inventory.getAmount(ANTIPOISON_4), 2);
  assert.equal(f.inventory.getAmount(STRENGTH_POTION_4), 0);
});

test("clicks with the interface closed do nothing", (t) => {
  const f = actor(t, { [COINS]: 5, [RED_SPIDERS_EGGS]: 1, [LIMPWURT_ROOT]: 1 });
  const event = click(f, "strength", 1);
  assert.notEqual(event.handled, true);
  assert.equal(f.inventory.getAmount(STRENGTH_POTION_4), 0);
  assert.deepEqual(f.messages, []);
});

test("the conversations' open_shop \"Apothecary's Potions\" ends the chat and opens 556, not the shop", (t) => {
  const f = actor(t);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  t.mock.method(f.player, "isRegistered", () => true);
  t.mock.method(f.player, "getDialogueManager", () => ({ isActive: () => false }));
  const other = { player: f.player, action: "open_shop", target: "Aubury's Rune Shop.", handled: false };
  dialogueAction(other);
  assert.equal(other.handled, false);
  const event = { player: f.player, action: "open_shop", target: "Apothecary's Potions", handled: false };
  dialogueAction(event);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  assert.equal(f.player.getInterfaceId(), -1, "the chatbox closes first");
  assert.equal(tasks.length, 1);
  tasks[0].execute();
  assert.equal(f.player.getInterfaceId(), APOTHECARY_POTIONS);
});
