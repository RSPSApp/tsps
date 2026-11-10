// Run after `yarn build`: node --test tests/ring-of-elements.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");
const Ring = require("../plugins/items/RingOfElements.plugin");

const core = PluginManager.getCoreApi();
const handlers = {};
const prompts = [];
const api = {
  core,
  persistAttribute() {},
  onServerStartup: (handler) => { handlers.startup = handler; },
  onPlayerLogin: (handler) => { handlers.login = handler; },
  onItemAction: (handler) => { handlers.action = handler; },
  onItemOnItem: (handler) => { handlers.itemOnItem = handler; },
  sendMultiChatboxPrompt: (...args) => prompts.push(args),
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Ring.register(api);
  handlers.startup();
});

const items = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"),
);
const byId = new Map(items.map((item) => [item.id, item]));

const RUNES = () => [
  ItemIdentifiers.AIR_RUNE, ItemIdentifiers.WATER_RUNE, ItemIdentifiers.EARTH_RUNE,
  ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.LAW_RUNE,
];

const ringItem = (id) => ({
  id,
  getId() { return this.id; },
  setId(value) { this.id = value; },
});

/** A player with a real-looking inventory (runes by count), equipment, dialogue and packet recorder. */
function createPlayer({ runes = 0, freeSlots = 28, restrictedRunes = [] } = {}) {
  const attributes = new Map();
  const counts = new Map(RUNES().map((id) => [id, runes]));
  const state = { messages: [], varbits: new Map(), dialogue: null, prompt: null, amountAction: null, deleted: [] };
  const inventory = new Array(28).fill(null);
  const equipment = new Array(14).fill(null);
  // Restricted (preset) rune stacks sit in their own slots after the 28 real ones.
  const restrictedStacks = restrictedRunes.map(([id, amount]) => ({ id, amount }));
  const slots = () => [
    ...inventory,
    ...[...counts].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount, isPresetItem: () => false })),
    ...restrictedStacks.map((stack) => ({ getId: () => stack.id, getAmount: () => stack.amount, isPresetItem: () => true })),
  ];
  const player = {
    state, inventory, equipment, counts,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    attributes,
    getLocation: () => ({ getX: () => 3200, getY: () => 3200, getZ: () => 0, getDistance: () => 99 }),
    getLocalNpcs: () => [],
    getInventory: () => ({
      getItems: slots,
      refreshItems() {},
      deleteAtSlot: (slot, amount) => {
        const id = slots()[slot].getId();
        state.deleted.push([id, amount]);
        counts.set(id, counts.get(id) - amount);
      },
      getAmount: (id) => (counts.get(id) ?? 0) + restrictedStacks.filter((s) => s.id === id).reduce((n, s) => n + s.amount, 0),
      deleteNumber: (id, amount) => { state.deleted.push([id, amount]); counts.set(id, counts.get(id) - amount); },
      getFreeSlots: () => freeSlots,
      getAddableAmount: () => Infinity,
      addItem: (item) => counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getDialogueManager: () => ({ startDialogues: (builder) => { state.dialogue = builder.getDialogues().get(0); } }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => state.varbits.set(id, value),
      sendEnterAmountPrompt: (title) => { state.prompt = title; },
      sendInterfaceRemoval() {},
    }),
    setEnteredAmountAction: (action) => { state.amountAction = action; },
    sendMessage: (message) => state.messages.push(message),
  };
  return player;
}

const CHARGES_VARBIT = () => CacheDefinitions.getVarbitId("ring_of_the_elements_charges");
const LAST_DESTINATION_VARBIT = () => CacheDefinitions.getVarbitId("ring_of_elements_last_destination");

/** Teleports wait for `land()`; `allowed` decides checkReqs. */
function stubTeleports(t, allowed = true) {
  const started = [];
  t.mock.method(TeleportHandler, "checkReqs", () => allowed);
  t.mock.method(TeleportHandler, "teleport", (player, target, type, warning, onArrival) => started.push({ target, type, onArrival }));
  return { started, land: () => started.shift().onArrival() };
}

test("the ring of the elements has both ids and they are rings", () => {
  const uncharged = byId.get(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  const charged = byId.get(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  assert.equal(uncharged?.equipmentType, "RING");
  assert.equal(charged?.equipmentType, "RING");
  assert.equal(uncharged?.tradeable, true, "uncharged rings are tradeable");
  assert.equal(charged?.tradeable, false, "charged rings are untradeable");
  assert.deepEqual(uncharged?.bonuses, new Array(14).fill(0));
});

test("teleports land where the live ring lands, with each altar's own casting graphic and last-destination value", () => {
  const byLabel = new Map(Ring._test.destinations().map((entry) => [
    entry.label,
    [entry.destination.getX(), entry.destination.getY(), entry.destination.getZ(), entry.lastDestination,
      entry.type.getStartGraphic().getId()],
  ]));
  const graphic = (name) => CacheDefinitions.getSpotanimId(name);
  // rsprox 364, 365: air (2980, 3278), earth (3286, 3467-3468), fire (3314, 3276), water (3165-3167, 3156-3160).
  assert.deepEqual(byLabel.get("Air Altar"), [2980, 3278, 0, 1, graphic("teleport_casting_air")]);
  assert.deepEqual(byLabel.get("Water Altar"), [3165, 3160, 0, 2, graphic("teleport_casting_water")]);
  assert.deepEqual(byLabel.get("Earth Altar"), [3286, 3468, 0, 3, graphic("teleport_casting_earth")]);
  assert.deepEqual(byLabel.get("Fire Altar"), [3314, 3276, 0, 4, graphic("teleport_casting_fire")]);
});

test("charges are per player, capped at 10,000, drive the ring's id and the charges varbit", () => {
  const player = createPlayer();
  assert.equal(Ring._test.getCharges(player), 0);
  Ring._test.setCharges(player, 5);
  assert.equal(Ring._test.getCharges(player), 5);
  assert.equal(player.state.varbits.get(CHARGES_VARBIT()), 5);
  Ring._test.setCharges(player, 99999);
  assert.equal(Ring._test.getCharges(player), Ring._test.MAX_CHARGES);
  const item = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  Ring._test.syncRing(player, item, 5);
  assert.equal(item.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  Ring._test.syncRing(player, item, 0);
  assert.equal(item.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS);
});

test("logging in sends the stored charges and last destination", () => {
  const player = createPlayer();
  Ring._test.setCharges(player, 12);
  player.setAttribute("ring-of-elements:last-destination", "Fire Altar");
  player.state.varbits.clear();
  handlers.login({ player });
  assert.equal(player.state.varbits.get(CHARGES_VARBIT()), 12);
  assert.equal(player.state.varbits.get(LAST_DESTINATION_VARBIT()), 4);
});

test("using a rune on the ring asks how many charges, up to the fewest rune stack", () => {
  const player = createPlayer({ runes: 600 });
  player.counts.set(ItemIdentifiers.LAW_RUNE, 563);
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  handlers.itemOnItem({
    player, usedItemId: ItemIdentifiers.LAW_RUNE, usedWithItemId: ring.id, usedWithItem: ring, usedItem: null,
  });
  assert.equal(player.state.prompt, "How many charges would you like to add? (0-563).");
  assert.deepEqual(player.state.deleted, [], "nothing is taken before the amount is entered");

  player.state.amountAction.execute(100);
  assert.equal(Ring._test.getCharges(player), 100);
  assert.equal(ring.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS_4, "the ring becomes charged");
  for (const runeId of RUNES()) assert.equal(player.counts.get(runeId), runeId === ItemIdentifiers.LAW_RUNE ? 463 : 500);

  handlers.itemOnItem({
    player, usedItemId: ItemIdentifiers.LAW_RUNE, usedWithItemId: ring.id, usedWithItem: ring, usedItem: null,
  });
  player.state.amountAction.execute(100000);
  assert.equal(Ring._test.getCharges(player), 100 + 463, "no more than the runes allow");
});

test("charging without all five runes shows the live message box and spends nothing", () => {
  const player = createPlayer({ runes: 5 });
  player.counts.set(ItemIdentifiers.FIRE_RUNE, 0);
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  handlers.itemOnItem({ player, usedItemId: ItemIdentifiers.AIR_RUNE, usedWithItemId: ring.id, usedWithItem: ring });
  assert.equal(player.state.prompt, null);
  assert.equal(player.state.dialogue.getText?.() ?? player.state.dialogue.text,
    "You require at least one air, water, earth, fire and law rune to charge your Ring of the Elements.");
  assert.equal(Ring._test.getCharges(player), 0);
});

test("rubbing an uncharged ring shows the no-charges item box instead of teleporting", (t) => {
  const player = createPlayer();
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  const { started } = stubTeleports(t);
  handlers.action({ player, itemId: ring.id, item: ring, option: "Rub" });
  assert.equal(started.length, 0);
  const dialogue = player.state.dialogue;
  assert.equal(dialogue.getItemId?.() ?? dialogue.itemId, ItemIdentifiers.RING_OF_THE_ELEMENTS);
  assert.equal(dialogue.getText?.() ?? dialogue.text, "Your ring of the elements has no charges remaining.");
});

test("a teleport spends its charge on arrival, and a refused one spends nothing", (t) => {
  const player = createPlayer();
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.inventory[0] = ring;
  Ring._test.setCharges(player, 20);
  const air = Ring._test.destinations()[0];

  const refused = stubTeleports(t, false);
  assert.equal(Ring._test.teleport(player, air), false);
  assert.equal(refused.started.length, 0);
  assert.equal(Ring._test.getCharges(player), 20);
  t.mock.restoreAll();

  const { started, land } = stubTeleports(t);
  Ring._test.teleport(player, air);
  assert.equal(started[0].type, air.type, "the altar's own casting graphic");
  assert.equal(Ring._test.getCharges(player), 20, "nothing is spent before arrival");

  // The ring is equipped mid-teleport as a different object.
  player.inventory[0] = null;
  const worn = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.equipment[12] = worn;
  land();
  assert.equal(Ring._test.getCharges(player), 19);
  assert.equal(player.state.varbits.get(CHARGES_VARBIT()), 19);
  assert.equal(player.state.varbits.get(LAST_DESTINATION_VARBIT()), 1);
  assert.deepEqual(player.state.messages, [], "no warning while plenty of charges remain (rsprox 364: 97-99)");
  assert.equal(player.attributes.get("ring-of-elements:last-destination"), "Air Altar");
});

test("each Rub submenu entry goes to its own altar (rsprox 364: subops 0-3 land at air, water, earth, fire)", (t) => {
  const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
  const { started } = stubTeleports(t);
  const player = createPlayer();
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.inventory[0] = ring;
  Ring._test.setCharges(player, 20);
  // A different last destination, so falling back to it would show.
  player.setAttribute("ring-of-elements:last-destination", "Fire Altar");
  // Live Rub is inventory widget op 4; the client sends the entry's 0-based index and the
  // server's subOpId is that plus one (ClientProtocol IF_BUTTON_SUB).
  const rub = ItemActionPacketListener.resolveInventoryWidgetAction(ring.id, 4);
  assert.equal(rub.option, "Rub");
  const tiles = [];
  for (const wireSubop of [0, 1, 2, 3]) {
    handlers.action({
      player, interfaceId: 9764864, item: ring, itemId: ring.id, slot: 0,
      clickType: rub.optionIndex, option: rub.option, subOpId: wireSubop + 1, handled: false,
    });
    const { target } = started.pop();
    tiles.push([target.getX(), target.getY()]);
  }
  assert.deepEqual(tiles, [[2980, 3278], [3165, 3160], [3286, 3468], [3314, 3276]]);
  assert.equal(prompts.length, 0, "a submenu entry never opens the destination prompt");
});

test("worn options go to Last Destination, then Air, Water, Earth and Fire in cache order", (t) => {
  const { started } = stubTeleports(t);
  const player = createPlayer();
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.equipment[12] = ring;
  Ring._test.setCharges(player, 20);
  player.setAttribute("ring-of-elements:last-destination", "Earth Altar");
  const tiles = [];
  for (const op of [2, 3, 4, 5, 6]) {
    handlers.action({ player, interfaceId: 1688, item: ring, itemId: ring.id, slot: 12, clickType: op, handled: false });
    const { target } = started.pop();
    tiles.push([target.getX(), target.getY()]);
  }
  assert.deepEqual(tiles, [[3286, 3468], [2980, 3278], [3165, 3160], [3286, 3468], [3314, 3276]]);
});

test("the last charges are announced on landing and the last one leaves the uncharged ring", (t) => {
  const player = createPlayer();
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.equipment[12] = ring;
  const water = Ring._test.destinations()[1];
  const { land } = stubTeleports(t);
  Ring._test.setCharges(player, 6);
  for (const remaining of [5, 4, 3, 2, 1, 0]) {
    Ring._test.teleport(player, water);
    land();
    assert.equal(Ring._test.getCharges(player), remaining);
  }
  assert.deepEqual(player.state.messages, [
    "<col=ef1c1c>Your ring of elements has 5 charges remaining.",
    "<col=ef1c1c>Your ring of elements has 4 charges remaining.",
    "<col=ef1c1c>Your ring of elements has 3 charges remaining.",
    "<col=ef1c1c>Your ring of elements has 2 charges remaining.",
    "<col=ef1c1c>Your ring of elements has 1 charge remaining.",
  ]);
  assert.equal(ring.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS);
});

test("destroying the charged ring keeps the player's charges for their next ring", (t) => {
  const player = createPlayer();
  Ring._test.setCharges(player, 20);
  player.inventory[0] = null;
  assert.equal(Ring._test.getCharges(player), 20);

  const replacement = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  player.inventory[3] = replacement;
  const { land } = stubTeleports(t);
  Ring._test.teleport(player, Ring._test.destinations()[2]);
  land();
  assert.equal(Ring._test.getCharges(player), 19);
  assert.equal(replacement.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS_4, "the new ring shows the stored charges");
});

test("two players' rings of the elements never share charges", (t) => {
  const alice = createPlayer();
  const bob = createPlayer();
  Ring._test.setCharges(alice, 30);
  Ring._test.setCharges(bob, 90);
  const { land } = stubTeleports(t);
  Ring._test.teleport(alice, Ring._test.destinations()[1]);
  Ring._test.teleport(bob, Ring._test.destinations()[3]);
  land();
  land();
  assert.equal(Ring._test.getCharges(alice), 29);
  assert.equal(Ring._test.getCharges(bob), 89);
  assert.equal(alice.attributes.get("ring-of-elements:last-destination"), "Water Altar");
  assert.equal(bob.attributes.get("ring-of-elements:last-destination"), "Fire Altar");
});

test("Uncharge away from a bank only tells the charges", () => {
  const player = createPlayer();
  Ring._test.setCharges(player, 96);
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  handlers.action({ player, itemId: ring.id, item: ring, option: "Uncharge" });
  const dialogue = player.state.dialogue;
  assert.equal(dialogue.getText?.() ?? dialogue.text, "The Ring of the Elements has 96 charges. You can uncharge it at a bank.");
  assert.equal(Ring._test.getCharges(player), 96);
  assert.equal(prompts.length, 0, "Uncharge never opens the teleport menu");
});

test("Uncharge at a bank asks, then returns one of each rune per charge", () => {
  const player = createPlayer({ runes: 10 });
  Ring._test.setCharges(player, 96);
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.inventory[0] = ring;
  const { MapObjects } = core;
  const hash = MapObjects.getHash(3200, 3201, 0);
  const booth = { getDefinition: () => ({ getActions: () => ["Bank", "Collect"] }) };
  MapObjects.mapObjects.set(hash, [booth]);
  try {
    handlers.action({ player, itemId: ring.id, item: ring, option: "Uncharge" });
  } finally {
    MapObjects.mapObjects.delete(hash);
  }
  const dialogue = player.state.dialogue;
  assert.equal(dialogue.getTitle?.() ?? dialogue.title, "Ring of the Elements charges: 96. Uncharge it?");

  dialogue.executeOption?.(2) ?? dialogue.actions?.executeOption(2);
  assert.equal(Ring._test.getCharges(player), 96, "No keeps the charges");

  Ring._test.refundRunes(player);
  for (const runeId of RUNES()) assert.equal(player.counts.get(runeId), 106);
  assert.equal(Ring._test.getCharges(player), 0);
  assert.equal(ring.getId(), ItemIdentifiers.RING_OF_THE_ELEMENTS);
  assert.equal(player.state.varbits.get(CHARGES_VARBIT()), 0);
});

test("Uncharge keeps the charges when the runes would not fit", () => {
  const player = createPlayer({ runes: 0, freeSlots: 2 });
  player.inventory.fill(null);
  Ring._test.setCharges(player, 50);
  player.counts.clear();
  Ring._test.refundRunes(player);
  assert.equal(Ring._test.getCharges(player), 50);
  assert.deepEqual(player.state.messages, ["You don't have enough inventory space to do that."]);
});

const bankBooth = () => ({ getDefinition: () => ({ getActions: () => ["Bank", "Collect"] }) });

test("restricted runes never pay for charges, so Uncharge cannot turn them into tradeable ones", () => {
  const player = createPlayer({ runes: 0, restrictedRunes: [[ItemIdentifiers.LAW_RUNE, 100]] });
  for (const runeId of RUNES()) if (runeId !== ItemIdentifiers.LAW_RUNE) player.counts.set(runeId, 100);
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  handlers.itemOnItem({
    player, usedItemId: ItemIdentifiers.LAW_RUNE, usedWithItemId: ring.id, usedWithItem: ring, usedItem: null,
  });
  assert.equal(player.state.prompt, null, "no amount is asked");
  assert.deepEqual(player.state.messages, ["Preset items cannot be used for this."]);
  assert.equal(Ring._test.addCharges(player, ring, 100), false);
  assert.equal(Ring._test.getCharges(player), 0);
  assert.deepEqual(player.state.deleted, []);
});

test("with some plain runes, only those pay and the restricted stack is left alone", () => {
  const player = createPlayer({ runes: 10, restrictedRunes: [[ItemIdentifiers.LAW_RUNE, 100]] });
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS);
  Ring._test.addCharges(player, ring, 50);
  assert.equal(Ring._test.getCharges(player), 10, "capped by the 10 plain runes of each kind");
  assert.equal(player.counts.get(ItemIdentifiers.LAW_RUNE), 0);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.LAW_RUNE), 100, "the restricted law runes stay");
});

test("Uncharge and its Yes are refused while a teleport is in progress, and Yes needs the bank still", () => {
  const { MapObjects } = core;
  const hash = MapObjects.getHash(3200, 3201, 0);
  const player = createPlayer({ runes: 10 });
  Ring._test.setCharges(player, 1);
  const ring = ringItem(ItemIdentifiers.RING_OF_THE_ELEMENTS_4);
  player.inventory[0] = ring;
  MapObjects.mapObjects.set(hash, [bankBooth()]);
  try {
    handlers.action({ player, itemId: ring.id, item: ring, option: "Uncharge" });
    const dialogue = player.state.dialogue;
    player.isTeleportingReturn = () => true;
    dialogue.executeOption?.(1) ?? dialogue.actions?.executeOption(1);
    assert.equal(Ring._test.getCharges(player), 1, "Yes while teleporting refunds nothing");
    assert.equal(player.counts.get(ItemIdentifiers.AIR_RUNE), 10);
    player.state.dialogue = null;
    handlers.action({ player, itemId: ring.id, item: ring, option: "Uncharge" });
    assert.equal(player.state.dialogue, null, "Uncharge itself is refused");
    player.isTeleportingReturn = () => false;
    handlers.action({ player, itemId: ring.id, item: ring, option: "Uncharge" });
    const again = player.state.dialogue;
    MapObjects.mapObjects.delete(hash);
    again.executeOption?.(1) ?? again.actions?.executeOption(1);
    assert.equal(Ring._test.getCharges(player), 1, "Yes after walking away from the bank refunds nothing");
  } finally {
    MapObjects.mapObjects.delete(hash);
  }
});
