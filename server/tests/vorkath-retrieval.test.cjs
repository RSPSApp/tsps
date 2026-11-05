// Run with: node --test server/tests/vorkath-retrieval.test.cjs
// Torfinn's item retrieval (Retrieval.Vorkath) against a stub api: no server boot needed.
const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const Retrieval = require("../plugins/bosses/vorkath/Retrieval.Vorkath");
const Storage = require("../plugins/items/storage/Common.StorageItems");

const COMPONENTS = {
  "gravestone_retrieval:items": (602 << 16) | 3,
  "gravestone_retrieval:button": (602 << 16) | 6,
  "gravestone_retrieval:discard": (602 << 16) | 10,
  "toplevel_osrs_stretch:mainmodal": (161 << 16) | 16,
};
const VARPS = { if1: 261, if2: 262 };
const PRICES = { 4151: 1500000, 385: 300, 11212: 2000, 21907: 0 };

class Item {
  constructor(id, amount = 1, meta = null) { this.id = id; this.amount = amount; this.meta = meta; }
  getId() { return this.id; }
  getAmount() { return this.amount; }
  getMeta() { return this.meta; }
}

const STACKABLE = new Set([11212, 995]);
const hooks = {};
let fees;

const core = {
  Item,
  ItemDefinition: { forId: (id) => ({ getGrandExchangeValue: () => PRICES[id] ?? 0, getExamine: () => `Examine ${id}.` }) },
  CacheDefinitions: {
    getComponentId: (name) => COMPONENTS[name],
    getVarpId: (name) => VARPS[name],
    getItem: (id) => ({ name: id === 3159 ? "Fish barrel" : `item ${id}` }),
  },
  DialogueChainBuilder: class { add(...entries) { this.entries = entries; return this; } },
  NpcDialogue: class { constructor(index, npcId, text) { this.npcId = npcId; this.text = text; } },
};

const api = {
  core,
  persistAttribute() {},
  onPlayerDeathDrops: (fn) => { hooks.drops = fn; },
  onPlayerDeath: (fn) => { hooks.death = fn; },
  onNpcInteraction: (name, ops) => { hooks.npc = { name, ops }; },
  onInterfaceActionButton: (component, fn) => { (hooks.buttons ??= {})[component] = fn; },
  onCustomEvent: (name, fn) => { (hooks.events ??= {})[name] = fn; },
  emitCustomEvent(name, request) {
    if (name !== "gravestones:pay-fee") return;
    fees.push(request.amount);
    if (request.player.coins >= request.amount) {
      request.player.coins -= request.amount;
      request.source = "bank";
      request.message = "Payment has been taken from your bank: 100,000 x Coins";
    }
  },
};
Retrieval.attach(api);
Storage.init(api);
Storage.register({ key: "test-fish-barrel", names: ["Fish barrel"], followsOnDeath: true });

function inventory(capacity = 28) {
  const slots = [];
  const used = () => slots.length;
  return {
    slots,
    getAddableAmount(item) {
      if (STACKABLE.has(item.getId())) return slots.some((s) => s.id === item.getId()) || used() < capacity ? item.getAmount() : 0;
      return Math.min(item.getAmount(), capacity - used());
    },
    add(item) {
      if (STACKABLE.has(item.getId())) {
        const slot = slots.find((s) => s.id === item.getId());
        if (slot) slot.amount += item.getAmount();
        else slots.push({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() });
      } else {
        for (let i = 0; i < item.getAmount(); i++) slots.push({ id: item.getId(), amount: 1, meta: item.getMeta() });
      }
    },
    refreshItems() {},
  };
}

function fakePlayer({ coins = 0, capacity = 28 } = {}) {
  const attributes = new Map();
  const player = {
    coins,
    messages: [],
    varps: new Map(),
    strings: [],
    scripts: [],
    invs: [],
    open: false,
    dialogue: null,
    inv: inventory(capacity),
    getUsername: () => "Z-Kris",
    getDisplayName: () => "Z-Kris",
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => player.messages.push(text),
    getInventory: () => player.inv,
    getDialogueManager: () => ({ startDialogues: (chain) => { player.dialogue = chain.entries[0]; } }),
    getPacketSender: () => sender,
  };
  const sender = {
    sendInterfaceRemoval() { player.open = false; return sender; },
    sendConfig(varp, value) { player.varps.set(varp, value); return sender; },
    sendInventory(id, size, items) { player.invs.push({ id, size, items: items.map((i) => ({ ...i })) }); return sender; },
    sendInterfaceScript(id, args) { player.scripts.push([id, args]); return sender; },
    sendSubInterface(component, id) { player.open = id === 602; return sender; },
    sendInterfaceFlagsRange(component, from, to, flags) { player.flags = [component, from, to, flags]; return sender; },
    sendString(text, component) { player.strings.push([component, text]); return sender; },
    isSubInterfaceOpen: (id) => id === 602 && player.open,
  };
  return player;
}

const at = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
const CRATER = at(2272, 4060);
const RELLEKKA = at(2640, 3697);

function die(player, location, items = [], untradeables = [], killer = null) {
  const event = { player, killer, location, items: [...items], untradeables: [...untradeables], layout: {} };
  hooks.drops(event);
  hooks.death({ player });
  return event;
}

const lastString = (player) => player.strings.at(-1)[1];
const button = (player) => hooks.buttons[COMPONENTS["gravestone_retrieval:button"]]({ player });
const collect = (player) => hooks.npc.ops.Collect({ player, definition: { getId: () => 10405 } });

beforeEach(() => { fees = []; });

test("a death in the crater leaves everything lost with Torfinn, untradeables and meta included", () => {
  const player = fakePlayer();
  const event = die(player, CRATER,
    [new Item(4151), new Item(385), new Item(385), new Item(11212, 194)],
    [new Item(21907), new Item(4151, 1, { charges: 3 })]);
  assert.equal(event.items.length, 0, "nothing for the floor or a grave");
  assert.equal(event.untradeables.length, 0);
  assert.deepEqual(Retrieval.held(player).items, [
    { id: 4151, amount: 1 }, { id: 385, amount: 2 }, { id: 11212, amount: 194 },
    { id: 21907, amount: 1 }, { id: 4151, amount: 1, meta: { charges: 3 } },
  ]);
  assert.deepEqual(player.messages, ["Torfinn has retrieved some of your items. You can collect them from him in Rellekka."]);
});

test("a death elsewhere loses what he held and leaves the grave its items; a PvP kill too", () => {
  const player = fakePlayer();
  die(player, CRATER, [new Item(4151)]);
  const elsewhere = die(player, RELLEKKA, [new Item(385)]);
  assert.equal(Retrieval.held(player), null);
  assert.equal(elsewhere.items.length, 1, "the grave's");
  assert.equal(player.messages.length, 1, "no second notice");

  die(player, CRATER, [new Item(4151)]);
  const pvp = die(player, CRATER, [new Item(385)], [], fakePlayer());
  assert.equal(Retrieval.held(player), null);
  assert.equal(pvp.items.length, 1);
});

test("a second crater death replaces the older lot", () => {
  const player = fakePlayer();
  die(player, CRATER, [new Item(4151)]);
  die(player, CRATER, [new Item(385)]);
  assert.deepEqual(Retrieval.held(player).items, [{ id: 385, amount: 1 }]);
  die(player, CRATER, []);
  assert.equal(Retrieval.held(player), null, "a death with nothing lost still loses the lot");
});

test("Collect with nothing held: his transcript line", () => {
  const player = fakePlayer();
  assert.equal(collect(player), true);
  assert.equal(player.dialogue.npcId, 10405);
  assert.equal(player.dialogue.text, "I'm afraid I don't have anything for you Z-Kris. If I did have any of your items, but you died before collecting them, they'll now be lost.");
  assert.equal(player.open, false);
});

test("Collect opens gravestone_retrieval as recorded", () => {
  const player = fakePlayer();
  die(player, CRATER, [new Item(4151), new Item(11212, 194)]);
  collect(player);
  assert.equal(player.open, true);
  assert.equal(player.varps.get(VARPS.if1), 5);
  assert.equal(player.varps.get(VARPS.if2), 0);
  assert.deepEqual(player.invs.at(-1), { id: 525, size: 120, items: [{ id: 4151, amount: 1 }, { id: 11212, amount: 194 }] });
  assert.deepEqual(player.scripts[0], [2524, [-1, -1]]);
  assert.deepEqual(player.flags, [COMPONENTS["gravestone_retrieval:items"], 0, 119, (1 << 2) | (1 << 9) | (1 << 10)]);
  assert.equal(lastString(player), "Stack count: <col=ffffff>2</col><br>Guide value: <col=ffffff>1,888,000</col> (approximately)");
});

test("the button pays 100,000 first, then takes what fits; the rest waits, free", () => {
  const player = fakePlayer({ coins: 250000, capacity: 3 });
  die(player, CRATER, [new Item(4151), new Item(385), new Item(385), new Item(385), new Item(11212, 194)]);
  collect(player);
  button(player);
  assert.deepEqual(fees, [100000]);
  assert.equal(player.coins, 150000);
  assert.ok(player.messages.includes("Payment has been taken from your bank: 100,000 x Coins"));
  assert.equal(player.varps.get(VARPS.if1), 6);
  assert.deepEqual(player.scripts.at(-1), [3478, [100000, 0]]);
  assert.equal(player.inv.slots.length, 0, "paying takes nothing yet");

  button(player);
  assert.deepEqual(player.inv.slots.map((s) => s.id), [4151, 385, 385]);
  assert.deepEqual(Retrieval.held(player).items, [{ id: 385, amount: 1 }, { id: 11212, amount: 194 }]);
  assert.equal(lastString(player), "Stack count: <col=ffffff>2</col><br>Guide value: <col=ffffff>388,300</col> (approximately)");

  player.inv = inventory(28);
  player.open = false;
  collect(player);
  assert.equal(player.varps.get(VARPS.if1), 6, "still paid");
  button(player);
  assert.deepEqual(fees, [100000], "no second fee");
  assert.equal(Retrieval.held(player), null);
  assert.equal(player.varps.get(VARPS.if1), -1);
  assert.equal(lastString(player), "Stack count: <col=ffffff>0</col><br>Guide value: <col=ffffff>0</col>");
});

test("without the fee nothing moves; meta comes back on the items", () => {
  const player = fakePlayer({ coins: 99999 });
  die(player, CRATER, [new Item(4151, 1, { charges: 9 })]);
  collect(player);
  button(player);
  assert.ok(player.messages.includes("You don't have enough coins with you or in your bank to pay the fee."));
  assert.equal(Retrieval.held(player).paid, false);
  assert.equal(player.inv.slots.length, 0);
  player.coins = 100000;
  button(player);
  button(player);
  assert.deepEqual(player.inv.slots, [{ id: 4151, amount: 1, meta: { charges: 9 } }]);
});

test("item ops: Take one stack once paid, Examine; nothing while the interface is shut", () => {
  const player = fakePlayer({ coins: 100000 });
  die(player, CRATER, [new Item(4151), new Item(11212, 50)]);
  const click = (slot, opId) => hooks.buttons[COMPONENTS["gravestone_retrieval:items"]]({ player, slot, opId });
  click(0, 2);
  assert.equal(fees.length, 0, "shut: ignored");
  collect(player);
  click(1, 10);
  assert.equal(player.messages.at(-1), "Examine 11212.");
  click(1, 2);
  assert.equal(Retrieval.held(player).paid, true, "Take before paying pays first");
  click(1, 2);
  assert.deepEqual(player.inv.slots, [{ id: 11212, amount: 50, meta: null }]);
  assert.deepEqual(Retrieval.held(player).items, [{ id: 4151, amount: 1 }]);
});

test("the item-retrieval query lists what he holds", () => {
  const player = fakePlayer();
  die(player, CRATER, [new Item(11212, 7)]);
  const request = { player, items: [] };
  hooks.events["item-retrieval:items"](request);
  assert.deepEqual(request.items, [{ itemId: 11212, amount: 7 }]);
});

test("a fish barrel's fish go to Torfinn with it, not left in an empty barrel", () => {
  const player = fakePlayer();
  player.setAttribute("storage-items:test-fish-barrel", [[383, 12]]);
  die(player, CRATER, [new Item(3159), new Item(4151)]);
  assert.deepEqual(Retrieval.held(player).items, [{ id: 3159, amount: 1 }, { id: 4151, amount: 1 }, { id: 383, amount: 12 }]);
  assert.equal(player.getAttribute("storage-items:test-fish-barrel"), null);
});

test("merged stacks stop at 2^31-1; the rest is a stack of its own", () => {
  const player = fakePlayer();
  die(player, CRATER, [new Item(11212, 2147483000), new Item(11212, 1000)]);
  assert.deepEqual(Retrieval.held(player).items, [{ id: 11212, amount: 2147483647 }, { id: 11212, amount: 353 }]);
});

test("a death another plugin handles doesn't leave a stale notice for the next one", () => {
  const player = fakePlayer();
  hooks.drops({ player, killer: null, location: CRATER, items: [new Item(4151)], untradeables: [], layout: {} });
  die(player, RELLEKKA, []);
  assert.deepEqual(player.messages, []);
});
