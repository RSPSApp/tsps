// Run after `yarn build`: node --test tests/patchy.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Patchy = require("../plugins/npcs/Patchy.plugin");

const COINS = 995;
const EYE_PATCH = 1025;
const PIRATE_HAT = 2651;
const BANDANA_BLUE = 7130;
const BANDANA_EYEPATCH_BLUE = 8926;
const IF1 = 261;
const PATCHY = 946;

let core;
let npcOptions;
let dialogueAction;
const buttons = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  npcOptions = new Map();
  Patchy.register(new Proxy({
    core,
    onNpcInteraction(name, handlers) { npcOptions.set(name, handlers); },
    onCustomEvent(name, handler) { if (name === "npc-dialogue:action") dialogueAction = handler; },
    onInterfaceActionButton(id, handler) { buttons.set(id, handler); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function component(name) {
  return core.CacheDefinitions.getComponentId(name);
}

function actor(t) {
  const player = new Player(null);
  const inventory = player.getInventory();
  const messages = [];
  const packets = [];
  const dialogues = [];
  const sender = new Proxy({
    sendConfig(id, value) { packets.push(["varp", id, value]); return sender; },
    sendClientScript(...args) { packets.push(["script", ...args]); return sender; },
    sendInterface(id) { player.setInterfaceId(id); packets.push(["open", id]); return sender; },
    sendInterfaceFlagsRange(...args) { packets.push(["flags", ...args]); return sender; },
    sendSound(...args) { packets.push(["sound", ...args]); return sender; },
    sendInterfaceRemoval() { player.setInterfaceId(-1); packets.push(["close"]); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  const manager = {
    entries: null,
    startDialogues(builder) { manager.entries = [...builder.getDialogues().values()]; dialogues.push(manager.entries[0]); },
    reset() { manager.entries = null; },
    isActive: () => manager.entries !== null,
  };
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "getDialogueManager", () => manager);
  t.mock.method(inventory, "refreshItems", () => inventory);
  return { player, inventory, messages, packets, dialogues, manager };
}

/** A script trigger's argument as the client packs it: a zigzag varint. */
function trigger(f, row) {
  const event = { player: f.player, action: 0, scriptTrigger: true, argsData: [((row << 1) ^ (row >> 31)) & 0x7f] };
  buttons.get(component("patchy:list"))(event);
  return event;
}

function confirm(f) {
  const event = { player: f.player, action: 1 };
  buttons.get(component("patchy:confirm"))(event);
  return event;
}

function open(f) {
  npcOptions.get("Patchy").Sew({ player: f.player });
  f.packets.length = 0;
}

test("Sew opens the patchy modal as captured: if1 -1, mainmodal script, then script-trigger events on the list", (t) => {
  const f = actor(t);
  assert.equal(npcOptions.get("Patchy").Sew({ player: f.player }), true);
  assert.deepEqual(f.packets, [
    ["varp", IF1, -1],
    ["script", 2524, -1, -1],
    ["open", PATCHY],
    ["flags", component("patchy:list"), -1, -1, 1 << 23],
  ]);
});

test("the cache's patchy_data rows are the recipes, keyed by their id column", () => {
  const recipes = Patchy._test.loadRecipes();
  assert.equal(recipes.size, 13);
  assert.deepEqual(recipes.get(1), { combined: 8928, ingredients: [EYE_PATCH, PIRATE_HAT] });
  assert.deepEqual(recipes.get(2), { combined: BANDANA_EYEPATCH_BLUE, ingredients: [EYE_PATCH, BANDANA_BLUE] });
});

test("a pick sets if1 to the row; -1 clears it", (t) => {
  const f = actor(t);
  open(f);
  assert.equal(trigger(f, 2).handled, true);
  assert.deepEqual(f.packets, [["varp", IF1, 2]]);
  trigger(f, -1);
  assert.deepEqual(f.packets.at(-1), ["varp", IF1, -1]);
});

test("Confirm without the ingredients names both of them and keeps the interface", (t) => {
  const f = actor(t);
  f.inventory.setItem(0, new core.Item(EYE_PATCH, 1));
  f.inventory.setItem(1, new core.Item(COINS, 10000));
  open(f);
  trigger(f, 1);
  confirm(f);
  assert.deepEqual(f.messages, ["Patchy needs the following items: <col=ef1020>Right eye patch</col> & <col=ef1020>Pirate's hat</col>"]);
  assert.equal(f.player.getInterfaceId(), PATCHY);
  assert.equal(f.inventory.getAmount(EYE_PATCH), 1);
  assert.equal(f.inventory.getAmount(COINS), 10000);
});

test("Confirm with the ingredients and coins sews the piece, plays the sounds and shows the objectbox; Continue reopens", (t) => {
  const f = actor(t);
  // The capture's layout: slots 0-3 taken, the bandana in 4, the eye patch in 8, coins in 27.
  for (let slot = 0; slot < 4; slot++) f.inventory.setItem(slot, new core.Item(PIRATE_HAT, 1));
  f.inventory.setItem(4, new core.Item(BANDANA_BLUE, 1));
  f.inventory.setItem(8, new core.Item(EYE_PATCH, 1));
  f.inventory.setItem(27, new core.Item(COINS, 3738747));
  open(f);
  trigger(f, 2);
  f.packets.length = 0;
  confirm(f);
  assert.equal(f.inventory.getAmount(BANDANA_BLUE), 0);
  assert.equal(f.inventory.getAmount(EYE_PATCH), 0);
  assert.equal(f.inventory.getAmount(COINS), 3738247);
  assert.equal(f.inventory.getItems()[4]?.getId(), BANDANA_EYEPATCH_BLUE);
  assert.equal(f.inventory.getItems()[8]?.getId() ?? -1, -1);
  assert.deepEqual(f.packets.filter((p) => p[0] === "sound"), [["sound", 2592, 1, 0], ["sound", 2114, 1, 10]]);
  assert.equal(f.player.getInterfaceId(), -1);
  const [statement, reopen] = f.manager.entries;
  assert.equal(statement.itemId ?? statement.getItemId?.(), BANDANA_EYEPATCH_BLUE);
  assert.equal(statement.text ?? statement.getText?.(), "Bandana eyepatch (blue):<br><br>Patchy takes 500 coins and sews your items together.");
  f.packets.length = 0;
  reopen.send(f.player);
  assert.equal(f.player.getInterfaceId(), PATCHY);
  assert.deepEqual(f.packets.filter((p) => p[0] === "varp"), [["varp", IF1, -1]]);
  // The reopened interface starts with nothing picked.
  confirm(f);
  assert.deepEqual(f.messages, []);
});

test("Confirm with the ingredients but under 500 coins sews nothing", (t) => {
  const f = actor(t);
  f.inventory.setItem(0, new core.Item(BANDANA_BLUE, 1));
  f.inventory.setItem(1, new core.Item(EYE_PATCH, 1));
  f.inventory.setItem(2, new core.Item(COINS, 499));
  open(f);
  trigger(f, 2);
  confirm(f);
  assert.equal(f.inventory.getAmount(BANDANA_EYEPATCH_BLUE), 0);
  assert.equal(f.inventory.getAmount(COINS), 499);
  assert.equal(f.messages.length, 1);
});

test("clicks on the interface do nothing once it is closed", (t) => {
  const f = actor(t);
  f.inventory.setItem(0, new core.Item(BANDANA_BLUE, 1));
  f.inventory.setItem(1, new core.Item(EYE_PATCH, 1));
  f.inventory.setItem(2, new core.Item(COINS, 1000));
  open(f);
  trigger(f, 2);
  f.player.setInterfaceId(-1);
  assert.notEqual(confirm(f).handled, true);
  assert.equal(f.inventory.getAmount(COINS), 1000);
});

test("Talk-to's open_interface Patchy opens the interface the tick after", (t) => {
  const f = actor(t);
  const submitted = [];
  t.mock.method(core.TaskManager, "submit", (task) => submitted.push(task));
  t.mock.method(f.player, "isRegistered", () => true);
  const event = { player: f.player, action: "open_interface", target: "Patchy" };
  dialogueAction(event);
  assert.equal(event.handled, true);
  assert.equal(submitted.length, 1);
  assert.equal(f.player.getInterfaceId(), -1);
  submitted[0].execute();
  assert.equal(f.player.getInterfaceId(), PATCHY);
  const other = { player: f.player, action: "open_interface", target: "Plank-making" };
  dialogueAction(other);
  assert.notEqual(other.handled, true);
});
