// Run after `yarn build`: node --test tests/pendant-of-ates.test.cjs
//
// The Pendant of Ates (Wiki: Pendant of Ates, Frozen tear, Statue (Ates)): a frozen tear is a charge
// (up to 1,000, the item's own), a charged pendant teleports to the statues its owner has activated,
// Uncharge returns the tears and an inert pendant is dismantled into 100 of them. Everything goes
// through the real PluginManager hooks and the item's cache options (the Rub submenu and worn
// options 451-457); only the teleport itself is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Pendant = require("../plugins/items/PendantOfAtes.plugin");

const DARKFROST = 0;
const TWILIGHT = 1;
const ALDARIN = 3;
const KASTORI = 4;
const NEMUS = 5;
// Cache: the Rub option is op3 of the charged pendant (inventory index 2), its sub-operations number from 1.
const RUB_CLICK = 3;
// Worn options: op1 Remove, then params 451-456 (the destinations) and 457 Check.
const FIRST_WORN_CLICK = 2;
const WORN_CHECK_CLICK = 8;
const ATES_STATUE_PARENT_IDS = [54545, 54548, 54551, 54554, 56919, 56922];

let core;
let I;
let next = 4100;

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
  player.setUsername("ates" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  const teleports = [];
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_player, target) => teleports.push([target.getX(), target.getY(), target.getZ()]));
  return { player, messages, teleports };
}

const real = (id, amount = 1) => new core.Item(id, amount);

function pendant(charges) {
  const item = real(charges > 0 ? I.PENDANT_OF_ATES : I.PENDANT_OF_ATES_INERT_);
  if (charges > 0) item.setMetaValue(Pendant.CHARGES_META_KEY, charges);
  return item;
}

/** Puts items in the inventory and returns the ones the container holds (it keeps its own copies). */
function give(player, ...items) {
  const held = [];
  for (const item of items) {
    player.getInventory().add(item, false);
    held.push(player.getInventory().getItems().filter((slot) => slot?.getId() === item.getId()).at(-1));
  }
  return held;
}

function wear(player, item) {
  player.getEquipment().getItems()[core.Equipment.AMULET_SLOT] = item;
  return item;
}

const tearCount = (player) => player.getInventory().getAmount(I.FROZEN_TEAR);
const slotOf = (player, item) => player.getInventory().getItems().indexOf(item);

function useTears(player, item) {
  const tears = player.getInventory().getItems().find((held) => held?.getId() === I.FROZEN_TEAR);
  return PluginManager.emitItemOnItem({
    player, usedItem: tears, usedItemId: tears.getId(), usedItemSlot: slotOf(player, tears),
    usedWithItem: item, usedWithItemId: item.getId(), usedWithItemSlot: slotOf(player, item), handled: false,
  });
}

/** An inventory option by its cache name, as the client reports the click. */
function inventoryOption(player, item, option, subOpId) {
  const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf(option);
  assert.ok(index >= 0, `the cache gives ${item.getId()} a ${option} option`);
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot: slotOf(player, item),
    clickType: index + 1, option, subOpId, handled: false,
  });
}

function wornClick(player, item, clickType) {
  return PluginManager.emitItemAction({
    player, interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, item, itemId: item.getId(),
    slot: core.Equipment.AMULET_SLOT, clickType, handled: false,
  });
}

function activate(player, parentId) {
  const definition = core.ObjectDefinition.forPlayer(parentId, player);
  const object = { getDefinition: () => definition };
  return PluginManager.emitObjectInteraction({
    player, object, definition, objectId: parentId, clickType: 1, location: { x: 0, y: 0, z: 0 }, handled: false,
  });
}

test("the destinations follow the cache's Rub submenu and worn option order", () => {
  const definition = core.CacheDefinitions.getItem(I.PENDANT_OF_ATES);
  assert.deepEqual(definition.subops[RUB_CLICK - 1].filter(Boolean), Pendant.DESTINATIONS.map(({ label }) => label));
  Pendant.DESTINATIONS.forEach(({ label }, index) => {
    assert.equal(definition.params.get(451 + index), label, `worn option ${index}`);
  });
  assert.equal(definition.params.get(457), "Check");
});

test("a frozen tear is a charge: the inert pendant turns charged and keeps the leftover tears", (t) => {
  const { player, messages } = actor(t);
  const [item] = give(player, pendant(0), real(I.FROZEN_TEAR, 40));
  assert.equal(useTears(player, item), true);
  assert.equal(item.getId(), I.PENDANT_OF_ATES);
  assert.equal(Pendant._test.charges(item), 40);
  assert.equal(tearCount(player), 0);
  assert.match(messages.at(-1), /40 frozen tears.*40 charges/);
});

test("a pendant holds 1,000 charges and the tears over the cap stay in the inventory", (t) => {
  const { player, messages } = actor(t);
  const [item] = give(player, pendant(990), real(I.FROZEN_TEAR, 25));
  useTears(player, item);
  assert.equal(Pendant._test.charges(item), 1000);
  assert.equal(tearCount(player), 15);
  useTears(player, item);
  assert.equal(Pendant._test.charges(item), 1000);
  assert.equal(tearCount(player), 15, "a full pendant takes nothing");
  assert.equal(messages.at(-1), "Your Pendant of Ates cannot hold any more charges.");
});

test("the charges are the item's own: a second pendant does not share them", (t) => {
  const { player } = actor(t);
  const [first, second] = give(player, pendant(10), pendant(0), real(I.FROZEN_TEAR, 5));
  useTears(player, second);
  assert.equal(Pendant._test.charges(first), 10);
  assert.equal(Pendant._test.charges(second), 5);
  assert.equal(second.getId(), I.PENDANT_OF_ATES);
});

test("Check says how many charges are left, inert or charged, in the pack or worn", (t) => {
  const { player, messages } = actor(t);
  const [charged, inert] = give(player, pendant(1), pendant(0));
  inventoryOption(player, charged, "Check");
  assert.equal(messages.at(-1), "Your Pendant of Ates has 1 charge left.");
  inventoryOption(player, inert, "Check");
  assert.equal(messages.at(-1), "Your Pendant of Ates has no charges.");
  assert.equal(wornClick(player, wear(player, pendant(250)), WORN_CHECK_CLICK), true);
  assert.equal(messages.at(-1), "Your Pendant of Ates has 250 charges left.");
});

test("Uncharge returns the tears and leaves the inert pendant; it needs room for them", (t) => {
  const { player, messages } = actor(t);
  const [item] = give(player, pendant(300));
  inventoryOption(player, item, "Uncharge");
  assert.equal(item.getId(), I.PENDANT_OF_ATES_INERT_);
  assert.equal(Pendant._test.charges(item), 0);
  assert.equal(tearCount(player), 300);
  assert.match(messages.at(-1), /get back 300 frozen tears/);

  const { player: full, messages: fullMessages } = actor(t);
  const [stuffed] = give(full, pendant(7));
  while (full.getInventory().getFreeSlots() > 0) give(full, real(I.BONES, 1));
  inventoryOption(full, stuffed, "Uncharge");
  assert.equal(Pendant._test.charges(stuffed), 7, "no room, no uncharge");
  assert.equal(fullMessages.at(-1), "You don't have enough inventory space to uncharge the pendant.");
});

test("Dismantle turns an inert pendant into 100 frozen tears", (t) => {
  const { player } = actor(t);
  const [item] = give(player, pendant(0), real(I.FROZEN_TEAR, 3));
  inventoryOption(player, item, "Dismantle");
  const ids = player.getInventory().getItems().filter(Boolean).map((held) => held.getId());
  assert.ok(!ids.includes(I.PENDANT_OF_ATES_INERT_), "the pendant is gone");
  assert.equal(tearCount(player), 103);
});

test("a statue activates once, sends its varbit and is remembered across a relog", (t) => {
  const { player } = actor(t);
  const darkfrost = Pendant.DESTINATIONS[DARKFROST];
  assert.equal(player.getPacketSender().getVarbit(darkfrost.varbit), 0);
  assert.equal(activate(player, ATES_STATUE_PARENT_IDS[DARKFROST]), true);
  assert.equal(player.getPacketSender().getVarbit(darkfrost.varbit), 1);
  assert.equal(player.getPacketSender().getVarbit(Pendant.DESTINATIONS[TWILIGHT].varbit), 0, "only that statue");

  const relog = actor(t).player;
  relog.setAttribute("pendant-of-ates:statues", player.getAttribute("pendant-of-ates:statues"));
  PluginManager.emitPlayerLogin({ player: relog, username: relog.getUsername() });
  assert.equal(relog.getPacketSender().getVarbit(darkfrost.varbit), 1);
  assert.equal(relog.getPacketSender().getVarbit(Pendant.DESTINATIONS[KASTORI].varbit), 0);
});

test("the Aldarin statue is left to Death on the Isle", (t) => {
  const { player } = actor(t);
  activate(player, ATES_STATUE_PARENT_IDS[ALDARIN]);
  assert.equal(player.getAttribute("pendant-of-ates:statues") ?? 0, 0);
  assert.equal(player.getPacketSender().getVarbit(Pendant.DESTINATIONS[ALDARIN].varbit), 0);
});

test("Rub > destination teleports to an activated statue for one charge", (t) => {
  const { player, teleports } = actor(t);
  const [item] = give(player, pendant(2));
  activate(player, ATES_STATUE_PARENT_IDS[DARKFROST]);
  assert.equal(inventoryOption(player, item, "Rub", DARKFROST + 1), true);
  assert.deepEqual(teleports, [Pendant.DESTINATIONS[DARKFROST].tile]);
  assert.equal(Pendant._test.charges(item), 1);
});

test("a statue that is not activated refuses, and costs nothing", (t) => {
  const { player, messages, teleports } = actor(t);
  const [item] = give(player, pendant(2));
  inventoryOption(player, item, "Rub", TWILIGHT + 1);
  assert.equal(messages.at(-1), "You have not activated the statue at Twilight Temple yet.");
  assert.deepEqual(teleports, []);
  assert.equal(Pendant._test.charges(item), 2);
});

test("the last charge teleports and leaves the pendant inert", (t) => {
  const { player, teleports, messages } = actor(t);
  const [item] = give(player, pendant(1));
  activate(player, ATES_STATUE_PARENT_IDS[DARKFROST]);
  inventoryOption(player, item, "Rub", DARKFROST + 1);
  assert.equal(teleports.length, 1);
  assert.equal(item.getId(), I.PENDANT_OF_ATES_INERT_);
  assert.equal(messages.at(-1), "Your Pendant of Ates has run out of charges.");
  inventoryOption(player, item, "Check");
  assert.equal(messages.at(-1), "Your Pendant of Ates has no charges.");
});

test("every worn destination works, including the Kastori and Nemus Retreat options past the fifth", (t) => {
  const { player, teleports } = actor(t);
  const worn = wear(player, pendant(10));
  for (const statue of ATES_STATUE_PARENT_IDS) activate(player, statue);
  // Aldarin is Death on the Isle's statue: its varbit is the quest's to send.
  player.getPacketSender().sendVarbit(Pendant.DESTINATIONS[ALDARIN].varbit, 1);
  Pendant.DESTINATIONS.forEach((_, index) => {
    assert.equal(wornClick(player, worn, FIRST_WORN_CLICK + index), true, `worn option ${index}`);
  });
  assert.deepEqual(teleports, Pendant.DESTINATIONS.map(({ tile }) => tile));
  assert.equal(Pendant._test.charges(worn), 4);
  assert.deepEqual(Pendant.DESTINATIONS[NEMUS].tile, [1364, 3277, 0]);
});
