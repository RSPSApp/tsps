// Run after `yarn build`: node --test tests/sailors-amulet.test.cjs
// Sailors' amulet charging and Check, from the Wiki and rsprox.net index recording 3837 (rev 235).
// A real Player, cache and plugin hooks, driven through the use-item and item-action packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const SailorsAmulet = require("../plugins/items/SailorsAmulet.plugin");

let core;
let I;
const INVENTORY = 149;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  SailorsAmulet.register(PluginManager.createApi("SailorsAmuletTest"));
});

/** A player carrying the amulet in slot 0 and the given runes after it. */
function fixture({ charges = 0, laws = 0, waters = 0 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const sent = { strings: [], items: [], messages: [], prompts: [], sounds: [] };
  const sender = player.getPacketSender();
  const wrap = (name, fn) => { const real = sender[name].bind(sender); sender[name] = (...args) => { fn(...args); return real(...args); }; };
  wrap("sendString", (text, uid) => sent.strings.push([uid, text]));
  wrap("sendItemOnInterfaces", (uid, item) => sent.items.push(item));
  wrap("sendMessage", (text) => sent.messages.push(text));
  wrap("sendEnterAmountPrompt", (title) => sent.prompts.push(title));
  wrap("sendSound", (id) => sent.sounds.push(id));
  const inventory = player.getInventory();
  const amulet = new core.Item(charges ? I.SAILORS_AMULET : I.SAILORS_AMULET_INERT_, 1);
  if (charges) amulet.setMetaValue(SailorsAmulet.CHARGES_META_KEY, charges);
  inventory.setItem(0, amulet);
  if (laws) inventory.setItem(1, new core.Item(I.LAW_RUNE, laws));
  if (waters) inventory.setItem(2, new core.Item(I.WATER_RUNE, waters));
  return { player, sent, inventory };
}

const amuletIn = (inventory) => inventory.getItems()[0];
const chargesOf = (item) => SailorsAmulet._test.charges(item);
/** Uses the item in `fromSlot` on the one in `toSlot`, as the client's use-item packet does. */
const use = (player, fromSlot, toSlot) => UseItemPacketListener.itemOnItem(player, fromSlot, toSlot);
const answer = (player, amount) => player.getEnteredAmountAction().execute(amount);
const boxText = (sent) => sent.strings.at(-1)?.[1];
// Only the 10,000 line is recorded; others are checked without the break the font decides.
const boxLine = (sent) => boxText(sent)?.replace("<br>", " ");

test("a law rune on the inert amulet asks how many charges, and the most the runes allow is 10,000 (rec 3837)", () => {
  const { player, sent, inventory } = fixture({ laws: 1000, waters: 10000 });
  use(player, 1, 0);
  assert.deepEqual(sent.prompts, ["How many charges would you like to add? (10 - 10,000)"]);
  // Live's player typed 100,000: the amulet took the 10,000 that fit.
  answer(player, 100000);
  const amulet = amuletIn(inventory);
  assert.equal(amulet.getId(), I.SAILORS_AMULET);
  assert.equal(chargesOf(amulet), 10000);
  assert.equal(inventory.getAmount(I.LAW_RUNE), 0);
  assert.equal(inventory.getAmount(I.WATER_RUNE), 0);
  assert.equal(boxText(sent), "You add 10,000 charges to your amulet. It now has<br>10,000 charges.");
  assert.equal(sent.items.at(-1), I.SAILORS_AMULET, "the object box shows the charged amulet");
  assert.deepEqual(sent.sounds, [30]);
});

test("ten charges cost one law rune and ten water runes; the amulet used on a water rune works too (Wiki)", () => {
  const { player, sent, inventory } = fixture({ laws: 5, waters: 35 });
  use(player, 0, 2);
  assert.deepEqual(sent.prompts, ["How many charges would you like to add? (10 - 30)"]);
  answer(player, 10);
  assert.equal(chargesOf(amuletIn(inventory)), 10);
  assert.deepEqual([inventory.getAmount(I.LAW_RUNE), inventory.getAmount(I.WATER_RUNE)], [4, 25]);
  assert.equal(boxLine(sent), "You add 10 charges to your amulet. It now has 10 charges.");
});

test("a charged amulet takes more charges up to 10,000, in tens", () => {
  const { player, sent, inventory } = fixture({ charges: 9950, laws: 100, waters: 1000 });
  use(player, 1, 0);
  assert.deepEqual(sent.prompts, ["How many charges would you like to add? (10 - 50)"]);
  answer(player, 25);
  assert.equal(chargesOf(amuletIn(inventory)), 9970);
  assert.deepEqual([inventory.getAmount(I.LAW_RUNE), inventory.getAmount(I.WATER_RUNE)], [98, 980]);
  assert.equal(boxLine(sent), "You add 20 charges to your amulet. It now has 9,970 charges.");
});

test("both rune types are needed: one kind alone charges nothing (Wiki)", () => {
  for (const runes of [{ laws: 50 }, { waters: 500 }, { laws: 3, waters: 9 }]) {
    const { player, sent, inventory } = fixture(runes);
    use(player, 1 + (runes.laws ? 0 : 1), 0);
    assert.deepEqual(sent.prompts, []);
    assert.equal(amuletIn(inventory).getId(), I.SAILORS_AMULET_INERT_);
    assert.deepEqual(sent.messages, ["You need at least 1 law rune and 10 water runes to charge the amulet."]);
  }
});

test("an answer of nothing, or under ten, leaves the amulet and runes alone", () => {
  for (const amount of [0, 9]) {
    const { player, inventory } = fixture({ laws: 5, waters: 50 });
    use(player, 1, 0);
    answer(player, amount);
    assert.equal(amuletIn(inventory).getId(), I.SAILORS_AMULET_INERT_);
    assert.deepEqual([inventory.getAmount(I.LAW_RUNE), inventory.getAmount(I.WATER_RUNE)], [5, 50]);
  }
});

test("a full amulet asks nothing", () => {
  const { player, sent, inventory } = fixture({ charges: 10000, laws: 5, waters: 50 });
  use(player, 1, 0);
  assert.deepEqual(sent.prompts, []);
  assert.deepEqual(sent.messages, ["Your amulet can't hold any more charges."]);
  assert.equal(inventory.getAmount(I.LAW_RUNE), 5);
});

test("an amulet moved out of the inventory before the answer is not charged", () => {
  const { player, inventory } = fixture({ laws: 5, waters: 50 });
  use(player, 1, 0);
  inventory.setItem(0, new core.Item(-1, 0));
  answer(player, 10);
  assert.deepEqual([inventory.getAmount(I.LAW_RUNE), inventory.getAmount(I.WATER_RUNE)], [5, 50]);
});

test("Check gives the charges in the chat (rec 3837)", () => {
  const { player, sent } = fixture({ charges: 10000 });
  ItemActionPacketListener.handleAction(player, INVENTORY, I.SAILORS_AMULET, 0, 4, "Check");
  assert.deepEqual(sent.messages, ["The amulet has 10,000 charges."]);
});

test("charges are saved on the item and survive a copy (bank, equip)", () => {
  const { player, inventory } = fixture({ laws: 1, waters: 10 });
  use(player, 1, 0);
  answer(player, 10);
  const copy = amuletIn(inventory).clone();
  assert.equal(chargesOf(copy), 10);
});

test("Check on the worn amulet gives the charges too", () => {
  const { player, sent } = fixture();
  const worn = new core.Item(I.SAILORS_AMULET, 1);
  worn.setMetaValue(SailorsAmulet.CHARGES_META_KEY, 40);
  player.getEquipment().setItem(core.Equipment.AMULET_SLOT, worn);
  // The worn menu's Check is the item's sixth equipment option (cache param 456), sent as op 7.
  PluginManager.emitItemAction({ player, interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, item: worn, itemId: I.SAILORS_AMULET, slot: core.Equipment.AMULET_SLOT, clickType: 7, handled: false });
  assert.deepEqual(sent.messages, ["The amulet has 40 charges."]);
});
