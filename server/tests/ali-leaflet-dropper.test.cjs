// Run after `yarn build`: node --test tests/ali-leaflet-dropper.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const AliLeafletDropper = require("../plugins/npcs/AliLeafletDropper.plugin");
const dialogues = require("../data/definitions/npc-dialogues.json");

const ALI = 5956;
const FLYER = 7922;
const COINS = 995;
const PAGE = "Ali the Leaflet Dropper";
const pages = [{ page: PAGE }];

let core;
const npcOptions = new Map();
const itemOptions = new Map();
let condition;
let action;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  AliLeafletDropper.register(new Proxy({
    core,
    onNpcInteraction(name, handlers) { npcOptions.set(name, handlers); },
    onItemAction(name, handlers) { itemOptions.set(name, handlers); },
    onNpcDialogueCondition(handler) { condition = handler; },
    onCustomEvent(name, handler) { if (name === "npc-dialogue:action") action = handler; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function actor(t) {
  const player = new Player(null);
  const inventory = player.getInventory();
  const texts = [];
  const sender = new Proxy({
    sendString(text, uid) { texts.push([uid >> 16, uid & 0xffff, text]); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  const manager = {
    entries: null,
    startDialogues(builder) { manager.entries = [...builder.getDialogues().values()]; },
    isActive: () => manager.entries !== null,
  };
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "getDialogueManager", () => manager);
  t.mock.method(inventory, "refreshItems", () => inventory);
  return { player, inventory, manager, texts };
}

const npc = { getId: () => ALI };

function fill(inventory) {
  while (inventory.getFreeSlots() > 0) inventory.addItem(new core.Item(COINS + inventory.getFreeSlots(), 1));
}

test("the plugin's names and step ids are the cache's and the transcript's", () => {
  assert.equal(core.NpcDefinition.forId(ALI).getName(), PAGE);
  assert.equal(core.ItemDefinition.forId(FLYER).getName(), "Al kharid flyer");
  const text = JSON.stringify(dialogues[PAGE]);
  for (const t of ['"WQ9ux6"', "If the player does not have an Al kharid flyer:",
    "If the player already has an Al kharid flyer:", "If the player has a full inventory:"]) {
    assert.ok(text.includes(t), t);
  }
  assert.ok(text.includes(AliLeafletDropper._test.HAS_LINE));
  assert.ok(text.includes(AliLeafletDropper._test.FULL_LINE));
  assert.ok(npcOptions.get(PAGE)["Take-flyer"]);
  assert.ok(itemOptions.get("Al kharid flyer").Read);
});

test("Take-flyer gives one flyer with the two captured lines (rec 3172 tick 807)", (t) => {
  const f = actor(t);
  assert.equal(npcOptions.get(PAGE)["Take-flyer"]({ player: f.player, npc }), true);
  assert.equal(f.inventory.getAmount(FLYER), 1);
  assert.deepEqual(f.manager.entries.map((entry) => entry.getText()), AliLeafletDropper._test.TAKE_LINES.map(([text]) => text));
  assert.ok(f.manager.entries.every((entry) => entry.getNpcId() === ALI));
});

test("Take-flyer with a flyer held or a full backpack gives nothing", (t) => {
  const f = actor(t);
  f.inventory.addItem(new core.Item(FLYER, 1));
  npcOptions.get(PAGE)["Take-flyer"]({ player: f.player, npc });
  assert.equal(f.inventory.getAmount(FLYER), 1);
  assert.deepEqual(f.manager.entries.map((entry) => entry.getText()), [AliLeafletDropper._test.HAS_LINE]);

  const g = actor(t);
  fill(g.inventory);
  npcOptions.get(PAGE)["Take-flyer"]({ player: g.player, npc });
  assert.equal(g.inventory.getAmount(FLYER), 0);
  assert.deepEqual(g.manager.entries.map((entry) => entry.getText()), [AliLeafletDropper._test.FULL_LINE]);
});

test("Talk-to's flyer conditions pick exactly one branch, and receive hands the flyer over", (t) => {
  const ask = (player) => ["If the player does not have an Al kharid flyer:", "If the player already has an Al kharid flyer:",
    "If the player has a full inventory:"].map((text) => condition({ npcId: ALI, pages, text, player }));
  const f = actor(t);
  assert.deepEqual(ask(f.player), [true, false, false]);
  const event = { npcId: ALI, pages, action: "receive", stepId: "WQ9ux6", player: f.player };
  action(event);
  assert.equal(event.handled, true);
  assert.equal(f.inventory.getAmount(FLYER), 1);
  assert.deepEqual(ask(f.player), [false, true, false]);

  const g = actor(t);
  fill(g.inventory);
  assert.deepEqual(ask(g.player), [false, false, true]);
  assert.equal(condition({ npcId: 1, pages, text: "If the player has a full inventory:", player: g.player }), null);
  assert.equal(condition({ npcId: ALI, pages, text: "If the player has 5 coins:", player: g.player }), null);
});

test("receive with a flyer already held gives no second one", (t) => {
  const f = actor(t);
  f.inventory.addItem(new core.Item(FLYER, 1));
  const event = { npcId: ALI, pages, action: "receive", stepId: "WQ9ux6", player: f.player };
  action(event);
  assert.equal(f.inventory.getAmount(FLYER), 1);
  assert.deepEqual(event.steps, [{ npc: AliLeafletDropper._test.HAS_LINE }, { type: "end" }]);
  const other = { npcId: ALI, pages, action: "receive", stepId: "other", player: f.player };
  action(other);
  assert.equal(other.handled, undefined);
});

test("Read shows the flyer's object box, then the out-of-date message box (rec 3172 tick 1454)", (t) => {
  const f = actor(t);
  f.inventory.addItem(new core.Item(FLYER, 1));
  assert.equal(itemOptions.get("Al kharid flyer").Read({ player: f.player, itemId: FLYER }), true);
  const [box, message] = f.manager.entries;
  assert.equal(box.constructor.name, "ItemStatementDialogue");
  assert.equal(message.constructor.name, "StatementDialogue");
  box.send(f.player);
  assert.ok(f.texts.some(([group, , text]) => group === 193 && text === AliLeafletDropper._test.FLYER_TEXT));
  message.send(f.player);
  assert.ok(f.texts.some(([group, , text]) => group === 229 && text === "You notice that the money off voucher is out of date."));
  assert.equal(f.inventory.getAmount(FLYER), 1);
});
