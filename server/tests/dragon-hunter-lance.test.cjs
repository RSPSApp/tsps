// Run after `yarn build`: node --test tests/dragon-hunter-lance.test.cjs
//
// Dragon hunter lance creation as rsprox capture 1532 (rev 224, ticks 94-103) shows it: the claw
// on the hasta opens objectbox_double (hasta, claw) with the warning, then the "Proceed with the
// alchemical combination. / Cancel." menu; one tick after Proceed the lance takes the claw's slot,
// the hasta's slot empties, sequence 4462 + spotanim 759 + sound 140 play and the success box
// shows the lance.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");

const Lance = require("../plugins/items/DragonHunterLance.plugin");

let prompt = null;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  const api = PluginManager.createApi("DragonHunterLanceTest");
  api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
    prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), callbacks: pairs.filter((_, i) => i % 2 === 1) };
    return true;
  };
  Lance.register(api);
});

function fixture(t, slots) {
  const player = new Player(null);
  const inventory = player.getInventory();
  slots.forEach((id, slot) => { if (id != null) inventory.setItem(slot, new Item(id, 1)); });
  const chains = [];
  const sounds = [];
  const tasks = [];
  const sender = new Proxy({}, {
    get: (_, name) => (name === "sendSound" ? (...args) => { sounds.push(args); return sender; } : () => sender),
  });
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player.getDialogueManager(), "startDialogues", (chain) => chains.push([...chain.getDialogues().values()]));
  const animations = [];
  const graphics = [];
  t.mock.method(player, "performAnimation", (a) => animations.push(a.getId()));
  t.mock.method(player, "performGraphic", (g) => graphics.push(g.getId()));
  t.mock.method(TaskManager, "submit", (task) => tasks.push(task));
  prompt = null;
  const use = (usedSlot, withSlot) => {
    const items = inventory.getItems();
    const event = {
      player, usedItem: items[usedSlot], usedItemId: items[usedSlot].getId(), usedItemSlot: usedSlot,
      usedWithItem: items[withSlot], usedWithItemId: items[withSlot].getId(), usedWithItemSlot: withSlot,
    };
    return PluginManager.emitItemOnItem(event);
  };
  const runTasks = () => { while (tasks.length) tasks.shift().execute(); };
  const ids = () => inventory.getItems().map((item) => (item && item.getId() >= 0 ? item.getId() : null));
  return { player, inventory, chains, sounds, tasks, animations, graphics, use, runTasks, ids };
}

function openMenu(f, usedSlot, withSlot) {
  assert.equal(f.use(usedSlot, withSlot), true);
  assert.equal(f.chains.length, 1);
  const [box, action] = f.chains[0];
  assert.ok(box instanceof DoubleItemStatementDialogue);
  assert.ok(action instanceof ActionDialogue);
  action.send(f.player);
  assert.ok(prompt, "the Proceed / Cancel menu follows the box");
  return box;
}

test("the claw on the hasta warns with both items and the captured menu, consuming nothing", (t) => {
  const f = fixture(t, [null, null, I.HYDRAS_CLAW, I.ZAMORAKIAN_HASTA]);
  const box = openMenu(f, 2, 3);
  assert.deepEqual(box.getItemIds(), [I.ZAMORAKIAN_HASTA, I.HYDRAS_CLAW]);
  assert.equal(box.getText(), "Are you sure you wish to combine the Hydra claw and the Zamorakian hasta to create the Dragon hunter lance? This cannot be reversed.");
  assert.equal(prompt.title, "Select an option");
  assert.deepEqual(prompt.options, ["Proceed with the alchemical combination.", "Cancel."]);
  assert.deepEqual(f.ids().slice(0, 4), [null, null, I.HYDRAS_CLAW, I.ZAMORAKIAN_HASTA]);
  assert.equal(f.tasks.length, 0);
});

test("Proceed combines one tick later: lance in the claw's slot, hasta gone, captured effects", (t) => {
  const f = fixture(t, [I.ZAMORAKIAN_HASTA, null, null, null, I.HYDRAS_CLAW]);
  openMenu(f, 4, 0);
  prompt.callbacks[0]();
  assert.equal(f.ids()[4], I.HYDRAS_CLAW, "nothing changes before the next tick");
  assert.equal(f.tasks.length, 1);
  assert.equal(f.tasks[0].getDelay?.() ?? f.tasks[0].delay, 1);
  f.runTasks();
  assert.equal(f.ids()[0], null);
  assert.equal(f.ids()[4], I.DRAGON_HUNTER_LANCE);
  assert.equal(f.inventory.getAmount(I.DRAGON_HUNTER_LANCE), 1);
  assert.deepEqual(f.animations, [4462]);
  assert.deepEqual(f.graphics, [759]);
  assert.deepEqual(f.sounds, [[140, 1, 0]]);
  const [result] = f.chains[1];
  assert.ok(result instanceof ItemStatementDialogue);
  assert.equal(result.getItemId?.() ?? result.itemId, I.DRAGON_HUNTER_LANCE);
  assert.equal(result.getText?.() ?? result.text,
    "You successfully combine the Hydra claw and the Zamorakian hasta to create the Dragon hunter lance.");
});

test("the hasta used on the claw opens the same warning", (t) => {
  const f = fixture(t, [I.HYDRAS_CLAW, I.ZAMORAKIAN_HASTA]);
  const box = openMenu(f, 1, 0);
  assert.deepEqual(box.getItemIds(), [I.ZAMORAKIAN_HASTA, I.HYDRAS_CLAW]);
});

test("Cancel keeps both items", (t) => {
  const f = fixture(t, [I.HYDRAS_CLAW, I.ZAMORAKIAN_HASTA]);
  openMenu(f, 0, 1);
  prompt.callbacks[1]();
  f.runTasks();
  assert.deepEqual(f.ids().slice(0, 2), [I.HYDRAS_CLAW, I.ZAMORAKIAN_HASTA]);
  assert.deepEqual(f.animations, []);
});

test("if the hasta leaves the inventory before the tick, nothing is consumed", (t) => {
  const f = fixture(t, [I.HYDRAS_CLAW, I.ZAMORAKIAN_HASTA]);
  openMenu(f, 0, 1);
  prompt.callbacks[0]();
  f.inventory.setItem(1, new Item(-1, 0));
  f.runTasks();
  assert.deepEqual(f.ids().slice(0, 2), [I.HYDRAS_CLAW, null]);
  assert.deepEqual(f.animations, []);
});

test("the claw on another spear is not handled (live: Nothing interesting happens.)", (t) => {
  const f = fixture(t, [I.HYDRAS_CLAW, I.ZAMORAKIAN_SPEAR]);
  assert.equal(f.use(0, 1), false);
  assert.equal(f.chains.length, 0);
});
