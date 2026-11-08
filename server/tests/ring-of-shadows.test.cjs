// Run after `yarn build`: node --test tests/ring-of-shadows.test.cjs
//
// The ring of shadows (Wiki: Ring of shadows; rsprox 1698, 2337, 3168): one soul, blood, death and
// law rune is a charge (up to 1,000, the item's own), a charged ring teleports for one charge, the
// Ancient Vault is open and the other four teleports are unlocked with a boss tablet. Everything goes
// through the real PluginManager hooks and the item's cache options; only the teleport is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Ring = require("../plugins/items/RingOfShadows.plugin");

const VAULT = 0;
const SCAR = 2;
const TELEPORT_CLICK = 2; // cache: Wear, Teleport, Check, Charge, Uncharge
const FIRST_WORN_CLICK = 2;
const WORN_CHECK_CLICK = 7;

let core;
let I;
let next = 4300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("shadows" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  const prompts = [];
  t.mock.method(player.getPacketSender(), "sendEnterAmountPrompt", (title) => {
    prompts.push(title);
    return player.getPacketSender();
  });
  const teleports = [];
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_player, target) => teleports.push([target.getX(), target.getY(), target.getZ()]));
  return { player, messages, prompts, teleports };
}

const real = (id, amount = 1) => new core.Item(id, amount);

function ring(charges) {
  const item = real(charges > 0 ? I.RING_OF_SHADOWS : I.RING_OF_SHADOWS_UNCHARGED_);
  if (charges > 0) item.setMetaValue(Ring.CHARGES_META_KEY, charges);
  return item;
}

function give(player, ...items) {
  const held = [];
  for (const item of items) {
    player.getInventory().add(item, false);
    held.push(player.getInventory().getItems().filter((slot) => slot?.getId() === item.getId()).at(-1));
  }
  return held;
}

const slotOf = (player, item) => player.getInventory().getItems().indexOf(item);
const amountOf = (player, id) => player.getInventory().getAmount(id);

function giveRunes(player, count) {
  give(player, real(I.SOUL_RUNE, count), real(I.BLOOD_RUNE, count), real(I.DEATH_RUNE, count), real(I.LAW_RUNE, count));
}

function useOn(player, used, target) {
  return PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: slotOf(player, used),
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: slotOf(player, target), handled: false,
  });
}

function inventoryOption(player, item, option, subOpId) {
  const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf(option);
  assert.ok(index >= 0, `the cache gives ${item.getId()} a ${option} option`);
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot: slotOf(player, item),
    clickType: index + 1, option, subOpId, handled: false,
  });
}

function wear(player, item) {
  player.getEquipment().getItems()[core.Equipment.RING_SLOT] = item;
  return item;
}

function wornClick(player, item, clickType) {
  return PluginManager.emitItemAction({
    player, interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, item, itemId: item.getId(),
    slot: core.Equipment.RING_SLOT, clickType, handled: false,
  });
}

/** Answers the armed amount prompt the way the client's number box does. */
function answer(player, amount) {
  player.getEnteredAmountAction().execute(amount);
}

test("the destinations follow the cache's Teleport submenu and worn option order", () => {
  const definition = core.CacheDefinitions.getItem(I.RING_OF_SHADOWS);
  assert.deepEqual(definition.subops[TELEPORT_CLICK - 1].filter(Boolean), Ring.DESTINATIONS.map(({ label }) => label));
  Ring.DESTINATIONS.forEach(({ worn }, index) => assert.equal(definition.params.get(451 + index), worn));
  assert.equal(definition.params.get(456), "Check");
});

test("a rune on the ring asks how many charges, then takes one of each rune per charge", (t) => {
  const { player, messages, prompts } = actor(t);
  const [item] = give(player, ring(0));
  giveRunes(player, 300);
  const soul = player.getInventory().getItems().find((held) => held?.getId() === I.SOUL_RUNE);
  assert.equal(useOn(player, soul, item), true);
  assert.match(prompts.at(-1), /How many charges do you wish to add\? \(0 - 1,000\)/);
  answer(player, 250);
  assert.equal(item.getId(), I.RING_OF_SHADOWS);
  assert.equal(Ring._test.charges(item), 250);
  assert.equal(amountOf(player, I.BLOOD_RUNE), 50);
  assert.equal(amountOf(player, I.SOUL_RUNE), 50);
  assert.equal(messages.at(-1), "You add 250 charges to the ring of shadows.");
});

test("the charges are capped by the rune stock and by 1,000", (t) => {
  const { player, messages } = actor(t);
  const [item] = give(player, ring(990));
  giveRunes(player, 400);
  Ring._test.addCharges(player, item, 1000);
  assert.equal(Ring._test.charges(item), 1000);
  assert.equal(amountOf(player, I.LAW_RUNE), 390);
  Ring._test.addCharges(player, item, 5);
  assert.equal(messages.at(-1), "Your ring of shadows cannot hold any more charges.");
  const [fresh] = give(player, ring(0));
  Ring._test.addCharges(player, fresh, 10000);
  assert.equal(Ring._test.charges(fresh), 390, "limited by the runes left");
});

test("without all four runes nothing is charged", (t) => {
  const { player, messages } = actor(t);
  const [item] = give(player, ring(0), real(I.BLOOD_RUNE, 20));
  Ring._test.addCharges(player, item, 20);
  assert.equal(item.getId(), I.RING_OF_SHADOWS_UNCHARGED_);
  assert.equal(amountOf(player, I.BLOOD_RUNE), 20);
  assert.match(messages.at(-1), /need soul, death, blood and law runes/);
});

test("Charge shows the instructions and Check reports the charges", (t) => {
  const { player, messages } = actor(t);
  const [uncharged, charged] = give(player, ring(0), ring(1000));
  inventoryOption(player, uncharged, "Charge");
  assert.match(messages.at(-1), /^To charge the ring of shadows, you will need soul runes, death runes, blood runes and law runes/);
  inventoryOption(player, charged, "Check");
  assert.equal(messages.at(-1), "Your ring of shadows has 1,000 charges remaining.");
  assert.equal(wornClick(player, wear(player, ring(7)), WORN_CHECK_CLICK), true);
  assert.equal(messages.at(-1), "Your ring of shadows has 7 charges remaining.");
});

test("Teleport > The Ancient Vault is open and costs one charge", (t) => {
  const { player, teleports } = actor(t);
  const [item] = give(player, ring(2));
  assert.equal(inventoryOption(player, item, "Teleport", VAULT + 1), true);
  assert.deepEqual(teleports, [Ring.DESTINATIONS[VAULT].tile]);
  assert.equal(Ring._test.charges(item), 1);
});

test("a locked teleport refuses and costs nothing; its tablet unlocks it for good", (t) => {
  const { player, messages, teleports } = actor(t);
  const [item, tablet] = give(player, ring(3), real(I.SCARRED_TABLET));
  inventoryOption(player, item, "Teleport", SCAR + 1);
  assert.equal(messages.at(-1), "You have not unlocked that teleport yet.");
  assert.deepEqual(teleports, []);
  assert.equal(Ring._test.charges(item), 3);

  assert.equal(useOn(player, tablet, item), true);
  assert.equal(amountOf(player, I.SCARRED_TABLET), 0);
  inventoryOption(player, item, "Teleport", SCAR + 1);
  assert.deepEqual(teleports, [Ring.DESTINATIONS[SCAR].tile]);
  assert.equal(Ring._test.charges(item), 2);
});

test("the last charge teleports and leaves the uncharged ring", (t) => {
  const { player, teleports, messages } = actor(t);
  const [item] = give(player, ring(1));
  inventoryOption(player, item, "Teleport", VAULT + 1);
  assert.equal(teleports.length, 1);
  assert.equal(item.getId(), I.RING_OF_SHADOWS_UNCHARGED_);
  assert.equal(messages.at(-1), "Your ring of shadows has run out of charges.");
});

test("every worn destination reaches its tile", (t) => {
  const { player, teleports } = actor(t);
  const worn = wear(player, ring(10));
  player.setAttribute(Ring.UNLOCKED_ATTRIBUTE, 0b11110);
  Ring.DESTINATIONS.forEach((_, index) => assert.equal(wornClick(player, worn, FIRST_WORN_CLICK + index), true));
  assert.deepEqual(teleports, Ring.DESTINATIONS.map(({ tile }) => tile));
  assert.equal(Ring._test.charges(worn), 5);
});

test("Uncharge refunds one of each rune per charge", (t) => {
  const { player } = actor(t);
  const [item] = give(player, ring(300));
  inventoryOption(player, item, "Uncharge");
  assert.equal(item.getId(), I.RING_OF_SHADOWS_UNCHARGED_);
  for (const id of [I.SOUL_RUNE, I.BLOOD_RUNE, I.DEATH_RUNE, I.LAW_RUNE]) assert.equal(amountOf(player, id), 300);
});

function fillInventory(player, freeSlots) {
  while (player.getInventory().getFreeSlots() > freeSlots) give(player, real(I.BONES, 1));
}

function trackDrops(t) {
  const drops = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (_player, item) => drops.push([item.getId(), item.getAmount()]));
  return drops;
}

test("Uncharge works with a single free slot: the first rune fits, the rest drop in order", (t) => {
  const { player, messages } = actor(t);
  const drops = trackDrops(t);
  const [item] = give(player, ring(500));
  fillInventory(player, 1);
  inventoryOption(player, item, "Uncharge");
  assert.equal(item.getId(), I.RING_OF_SHADOWS_UNCHARGED_);
  assert.equal(amountOf(player, I.SOUL_RUNE), 500, "soul takes the slot");
  assert.deepEqual(drops, [[I.BLOOD_RUNE, 500], [I.DEATH_RUNE, 500], [I.LAW_RUNE, 500]]);
  assert.match(messages.at(-1), /dropped on the floor/);
});

test("Uncharge with no free slot and runes missing is refused and keeps the charges", (t) => {
  const { player, messages } = actor(t);
  const drops = trackDrops(t);
  const [item] = give(player, ring(50), real(I.SOUL_RUNE, 1));
  fillInventory(player, 0);
  inventoryOption(player, item, "Uncharge");
  assert.equal(Ring._test.charges(item), 50);
  assert.deepEqual(drops, []);
  assert.equal(messages.at(-1), "You don't have enough inventory space to uncharge the ring.");
});

test("Uncharge with all four runes held and a full pack still refunds into the stacks", (t) => {
  const { player } = actor(t);
  const drops = trackDrops(t);
  const [item] = give(player, ring(100));
  giveRunes(player, 5);
  fillInventory(player, 0);
  inventoryOption(player, item, "Uncharge");
  for (const id of [I.SOUL_RUNE, I.BLOOD_RUNE, I.DEATH_RUNE, I.LAW_RUNE]) assert.equal(amountOf(player, id), 105);
  assert.deepEqual(drops, []);
});

test("Uncharge never destroys runes: what a stack cannot take is dropped", (t) => {
  const { player } = actor(t);
  const drops = trackDrops(t);
  const cap = 2147483647;
  const [item] = give(player, ring(1000), real(I.SOUL_RUNE, cap - 647));
  Ring._test.uncharge({ player, item });
  assert.equal(amountOf(player, I.SOUL_RUNE), cap);
  assert.deepEqual(drops, [[I.SOUL_RUNE, 353]]);
  assert.equal(amountOf(player, I.BLOOD_RUNE), 1000);
  assert.equal(item.getId(), I.RING_OF_SHADOWS_UNCHARGED_);
});
