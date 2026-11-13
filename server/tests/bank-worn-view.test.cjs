// Run after `yarn build`: node --test tests/bank-worn-view.test.cjs
// The bank's "Show worn items" side view (bankside:wornops, 15:4) lists the backpack (inv 93): the cache's
// bankside_build draws it from the inventory and bankside_worn_drawitem gives each item its Wear/Wield as op 1,
// Deposit as op 9 and Examine as op 10, so gear goes on without closing the bank (Wiki: Bank). Op 1 banked the matching
// *worn* item instead, and ops 9 and 10 did nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function banker(t) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("wornview");
  p.setRegistered(true);
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.setStatus(PlayerStatus.BANKING);
  p.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  const messages = [];
  t.mock.method(p, "sendMessage", (text) => messages.push(text));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, messages };
}

const click = (p, buttonNum, slot, itemId) => Bank.handleWidgetAction(p, {
  groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_WORN_CHILD, buttonNum, slot, itemId,
});

test("op 1 wields the backpack item and keeps the worn one out of the bank", (t) => {
  const { p } = banker(t);
  const I = core.ItemIdentifiers, E = core.Equipment;
  p.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(I.RUNE_SCIMITAR, 1));
  p.getInventory().setItem(0, new core.Item(I.ADAMANT_SCIMITAR, 1));
  assert.equal(click(p, 1, 0, I.ADAMANT_SCIMITAR), true);
  assert.equal(p.getEquipment().getItems()[E.WEAPON_SLOT].getId(), I.ADAMANT_SCIMITAR, "wielded from the backpack");
  assert.equal(p.getInventory().getItems()[0].getId(), I.RUNE_SCIMITAR, "the old weapon swaps into its slot");
  assert.equal(p.getBank().getAmount(I.RUNE_SCIMITAR), 0, "nothing worn is banked");
  assert.equal(p.getInterfaceId(), Bank.MAIN_INTERFACE_ID, "the bank stays open");
});

test("op 9 deposits that backpack slot; op 10 examines; a stale item id is ignored", (t) => {
  const { p, messages } = banker(t);
  const I = core.ItemIdentifiers, E = core.Equipment;
  p.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(I.RUNE_SCIMITAR, 1));
  p.getInventory().setItem(0, new core.Item(I.RUNE_SCIMITAR, 1));
  click(p, 10, 0, I.RUNE_SCIMITAR);
  assert.ok(messages.length === 1 && messages[0].length > 0, "examine text");
  click(p, 9, 0, I.LOBSTER);
  assert.equal(p.getInventory().getItems()[0].getId(), I.RUNE_SCIMITAR, "the click named another item");
  click(p, 9, 0, I.RUNE_SCIMITAR);
  assert.equal(p.getInventory().getAmount(I.RUNE_SCIMITAR), 0);
  assert.equal(p.getBank().getAmount(I.RUNE_SCIMITAR), 1, "the backpack one is banked");
  assert.equal(p.getEquipment().getItems()[E.WEAPON_SLOT].getId(), I.RUNE_SCIMITAR, "the worn one stays on");
});

test("the bank's worn weapon Remove action moves it to the backpack and keeps the bank open", async (t) => {
  const { p } = banker(t);
  const { Equipment, Item, ItemIdentifiers } = core;
  const weapon = ItemIdentifiers.RUNE_SCIMITAR;
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(weapon));
  const channel = { isOpen: () => true, send: () => true, onData() {}, onError() {}, onClose() {}, close() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  const remove = async () => {
    await connection.dispatch([{
      type: "widget_action", widgetId: (12 << 16) | 71, groupId: 12, childId: 71,
      buttonNum: 1, slot: -1, itemId: -1,
    }]);
    connection.processTurnPackets();
  };

  p.setInterfaceId(-1);
  await remove();
  assert.equal(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId(), weapon, "the bank must be open");
  p.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  for (let slot = 0; slot < p.getInventory().capacity(); slot++) {
    p.getInventory().setItem(slot, new Item(ItemIdentifiers.LOBSTER));
  }
  await remove();
  assert.equal(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId(), weapon, "a full backpack cannot receive it");
  p.getInventory().deleteAtSlot(0, 1, false);
  await remove();
  assert.equal(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId(), -1);
  assert.equal(p.getInventory().getAmount(weapon), 1);
  assert.equal(p.getInterfaceId(), Bank.MAIN_INTERFACE_ID);
});

test("the worn panel's op 2 banks just that worn item and op 10 examines it (bankmain 12:68-78)", async (t) => {
  const { p, messages } = banker(t);
  const { Equipment, Item, ItemIdentifiers: I } = core;
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(I.RUNE_SCIMITAR));
  p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new Item(I.ADAMANT_ARROW, 50));
  p.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(I.RUNE_FULL_HELM));
  const channel = { isOpen: () => true, send: () => true, onData() {}, onError() {}, onClose() {}, close() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  const op = async (childId, buttonNum) => {
    await connection.dispatch([{
      type: "widget_action", widgetId: (12 << 16) | childId, groupId: 12, childId, buttonNum, slot: -1, itemId: -1,
    }]);
    connection.processTurnPackets();
  };

  await op(71, 10); // wornslot3: the weapon
  assert.equal(messages.length, 1, "one examine line");
  assert.ok(messages[0].length > 0);
  assert.equal(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId(), I.RUNE_SCIMITAR, "examining moves nothing");

  await op(71, 2);
  assert.equal(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId(), -1, "the weapon is banked");
  assert.equal(p.getBank().getAmount(I.RUNE_SCIMITAR), 1);
  assert.equal(p.getInventory().getAmount(I.RUNE_SCIMITAR), 0, "straight to the bank, not the backpack");
  assert.equal(p.getEquipment().getItems()[Equipment.HEAD_SLOT].getId(), I.RUNE_FULL_HELM, "the other slots stay worn");
  assert.equal(p.getEquipment().getItems()[Equipment.AMMUNITION_SLOT].getAmount(), 50);

  await op(78, 2); // wornslot13: the ammunition, the whole stack
  assert.equal(p.getEquipment().getItems()[Equipment.AMMUNITION_SLOT].getId(), -1);
  assert.equal(p.getBank().getAmount(I.ADAMANT_ARROW), 50);

  await op(71, 2); // an empty slot
  await op(71, 10);
  assert.equal(messages.length, 1, "nothing to examine in an empty slot");
  assert.equal(p.getBank().getAmount(I.RUNE_SCIMITAR), 1);

  p.setInterfaceId(-1);
  await op(68, 2); // the bank must be open
  assert.equal(p.getEquipment().getItems()[Equipment.HEAD_SLOT].getId(), I.RUNE_FULL_HELM);
  assert.equal(p.getInterfaceId(), -1);
});

/** The text the server last sent to each bankmain (12) component. */
function bankTexts(t, p) {
  const texts = new Map();
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, uid) => {
    if (uid >>> 16 === Bank.MAIN_INTERFACE_ID) texts.set(uid & 0xffff, text);
    return original(text, uid);
  });
  return texts;
}

test("the worn-items view's stat lines (bankmain 12:82-117) are filled on opening and on Wear", (t) => {
  const { p } = banker(t);
  const I = core.ItemIdentifiers, E = core.Equipment;
  p.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(I.RUNE_SCIMITAR, 1));
  const texts = bankTexts(t, p);
  PM.emitCustomEvent("bank:opened", { player: p });
  assert.equal(texts.get(82), "Stab: +7");
  assert.equal(texts.get(83), "Slash: +45");
  assert.equal(texts.get(88), "Stab: +0");
  assert.equal(texts.get(94), "Melee STR: +44");
  assert.equal(texts.get(96), "Magic DMG: +0.0%");
  assert.equal(texts.get(97), "Prayer: +0");
  assert.match(texts.get(99), /^Undead: /);
  assert.match(texts.get(100), /^Slayer: /);
  assert.equal(texts.get(116), "Base: 2.4s");
  assert.match(texts.get(117), /^Actual: \d\.\ds$/);
  for (const label of [81, 87, 93, 98, 101]) assert.equal(texts.has(label), false, `heading 12:${label} keeps its cache text`);

  p.getInventory().setItem(0, new core.Item(I.RUNE_FULL_HELM, 1));
  click(p, 1, 0, I.RUNE_FULL_HELM);
  assert.equal(p.getEquipment().getItems()[E.HEAD_SLOT].getId(), I.RUNE_FULL_HELM);
  assert.equal(texts.get(88), "Stab: +30", "wearing from the bank refreshes the lines");
});
