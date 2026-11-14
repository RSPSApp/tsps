// Run after `yarn build`: node --test tests/reagent-pouch.test.cjs
//
// The Mastering Mixology reagent pouch (docs/storage-items.md, "Reagent pouch"): lines and order
// from rsprox.net recordings 4218, 4220, 4226 and 4227, capacity and storable list from the Wiki.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Storage = require("../plugins/items/storage/Common.StorageItems");
const ReagentPouch = require("../plugins/items/storage/ReagentPouch.StorageItems");

/** Lumbridge castle courtyard: no bank within reach. */
const AWAY = [3222, 3218];
/** Draynor Village bank, beside the booths. */
const BANK = [3092, 3243];
/** Beside the Castle Wars bank chest (loc 4483, whose options are Use and Collect). */
const CHEST = [2443, 3083];
const M = ReagentPouch.MESSAGE;

let core;
let I;
let family;
let POUCH;
let OPEN_POUCH;
let next = 9300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  family = Storage.FAMILIES.get("reagent-pouch");
  POUCH = core.CacheDefinitions.getObjId("mm_secondary_pouch");
  OPEN_POUCH = core.CacheDefinitions.getObjId("mm_secondary_pouch_open");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...AWAY);
  core.RegionManager.loadMapFiles(...BANK);
  core.RegionManager.loadMapFiles(...CHEST);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at = BANK, pouchId = POUCH) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("reagent" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  const inv = p.getInventory();
  inv.add(new core.Item(pouchId), true);
  return { p, c, inv, messages, pouch: () => inv.getValidItems().find((item) => ReagentPouch.NAMES.includes(Storage.nameOf(item))) };
}

function op(f, name) {
  const item = f.pouch();
  const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf(name);
  assert.ok(index >= 0, `${name} is a cache op`);
  return PM.emitItemAction({
    player: f.p, interfaceId: 149 << 16, item, itemId: item.getId(), slot: f.inv.getItems().indexOf(item),
    clickType: index + 1, option: name, handled: false,
  });
}

function use(f, id) {
  const used = f.inv.getValidItems().find((item) => item.getId() === id);
  const pouch = f.pouch();
  return PM.emitItemOnItem({
    player: f.p, usedItem: used, usedItemId: id, usedItemSlot: f.inv.getItems().indexOf(used),
    usedWithItem: pouch, usedWithItemId: pouch.getId(), usedWithItemSlot: f.inv.getItems().indexOf(pouch), handled: false,
  });
}

const held = (f, id) => Storage.amountOf(f.p, family, id);
const add = (f, id, amount) => { for (let i = 0; i < amount; i++) f.inv.add(new core.Item(id, 1), true); };
const choose = (f, option) => {
  const current = f.p.getDialogueManager().getCurrent();
  assert.ok(current instanceof core.OptionDialogue, "the chatmenu is open");
  assert.equal(current.getTitle(), M.CHOICE);
  assert.deepEqual(current.getOptions(), ["One.", "All of this type."]);
  assert.equal(f.p.getDialogueManager().handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, option), true);
};

test("the Wiki's storable secondaries resolve to cache items; herbs, uncrushed horns and noted copies don't go in", () => {
  const ids = ReagentPouch.storableIds();
  for (const name of ReagentPouch.STORABLE) {
    assert.ok([...ids].some((id) => Storage.itemName(id).toLowerCase() === name.toLowerCase()), `${name} has an item`);
  }
  assert.ok(family.accepts(I.EYE_OF_NEWT));
  assert.ok(family.accepts(I.WINE_OF_ZAMORAK));
  assert.ok(!family.accepts(I.EYE_OF_NEWT + 1), "noted eye of newt");
  assert.ok(!family.accepts(I.UNICORN_HORN));
  assert.ok(!family.accepts(I.TORSTOL));
  assert.ok(!family.accepts(I.UNCUT_SAPPHIRE));
});

test("Fill takes every storable secondary, 26 of each, and says so", (t) => {
  const f = actor(t);
  add(f, I.EYE_OF_NEWT, 20);
  add(f, I.WINE_OF_ZAMORAK, 3);
  op(f, "Fill");
  assert.equal(held(f, I.EYE_OF_NEWT), 20);
  assert.equal(held(f, I.WINE_OF_ZAMORAK), 3);
  assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 0);
  assert.deepEqual(f.messages, [M.SEARCH, M.ADDED]);

  add(f, I.EYE_OF_NEWT, 10);
  f.messages.length = 0;
  op(f, "Fill");
  assert.equal(held(f, I.EYE_OF_NEWT), 26);
  assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 4);
  assert.deepEqual(f.messages, [M.SEARCH, M.ADDED]);

  f.messages.length = 0;
  op(f, "Fill");
  assert.deepEqual(f.messages, [M.SEARCH, M.NO_ROOM]);
});

test("Fill with nothing storable", (t) => {
  const f = actor(t);
  add(f, I.UNICORN_HORN, 1);
  op(f, "Fill");
  assert.deepEqual(f.messages, [M.NO_ITEMS]);
  assert.equal(Storage.total(f.p, family), 0);
});

test("a single secondary used on the pouch goes straight in; more asks one or all", (t) => {
  const f = actor(t);
  add(f, I.EYE_OF_NEWT, 1);
  assert.equal(use(f, I.EYE_OF_NEWT), true);
  assert.equal(held(f, I.EYE_OF_NEWT), 1);
  assert.deepEqual(f.messages, ["You add the Eye of newt to your sack."]);

  add(f, I.EYE_OF_NEWT, 5);
  f.messages.length = 0;
  use(f, I.EYE_OF_NEWT);
  choose(f, 1);
  assert.equal(held(f, I.EYE_OF_NEWT), 2);
  assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 4);
  use(f, I.EYE_OF_NEWT);
  choose(f, 2);
  assert.equal(held(f, I.EYE_OF_NEWT), 6);
  assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 0);
  assert.deepEqual(f.messages, ["You add the Eye of newt to your sack.", "You add the Eye of newt to your sack."]);
});

test("a full kind, and anything that isn't storable, are refused", (t) => {
  const f = actor(t);
  Storage.store(f.p, family, I.EYE_OF_NEWT, 26);
  add(f, I.EYE_OF_NEWT, 2);
  use(f, I.EYE_OF_NEWT);
  assert.equal(f.p.getDialogueManager().getCurrent(), undefined);
  add(f, I.UNCUT_SAPPHIRE, 1);
  f.inv.add(new core.Item(I.EYE_OF_NEWT + 1, 3), true);
  use(f, I.UNCUT_SAPPHIRE);
  use(f, I.EYE_OF_NEWT + 1);
  assert.deepEqual(f.messages, ["You don't have enough space for the Eye of newt.", M.SPOIL, M.SPOIL]);
  assert.equal(f.inv.getAmount(I.UNCUT_SAPPHIRE), 1);
});

test("Check lists each kind in the order it went in", (t) => {
  const f = actor(t);
  op(f, "Check");
  Storage.store(f.p, family, I.EYE_OF_NEWT, 22);
  Storage.store(f.p, family, I.WINE_OF_ZAMORAK, 10);
  op(f, "Check");
  // The cache names it "Wine of Zamorak"; rev 238 (4220 t1044) printed "Wine of zamorak".
  assert.deepEqual(f.messages, [M.EMPTY, M.CHECK, "22 x Eye of newt", "10 x Wine of Zamorak"]);
});

test("Empty needs a bank nearby and room in the inventory", (t) => {
  const away = actor(t, AWAY);
  assert.equal(ReagentPouch.nearBank(away.p), false);
  Storage.store(away.p, family, I.EYE_OF_NEWT, 5);
  op(away, "Empty");
  assert.deepEqual(away.messages, [M.NOT_HERE]);
  assert.equal(held(away, I.EYE_OF_NEWT), 5);

  const f = actor(t, BANK);
  assert.equal(ReagentPouch.nearBank(f.p), true);
  op(f, "Empty");
  Storage.store(f.p, family, I.EYE_OF_NEWT, 26);
  Storage.store(f.p, family, I.WINE_OF_ZAMORAK, 10);
  add(f, I.TORSTOL, 2);
  op(f, "Empty");
  // 25 free slots: every eye of newt but one (rsprox 4220 t977 took 25 of 26).
  assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 25);
  assert.equal(held(f, I.EYE_OF_NEWT), 1);
  assert.equal(held(f, I.WINE_OF_ZAMORAK), 10);
  op(f, "Empty");
  assert.deepEqual(f.messages, [M.EMPTY, M.RUMMAGE, M.NO_SPACE]);
});

test("Empty works beside a bank chest", (t) => {
  const f = actor(t, CHEST);
  assert.equal(ReagentPouch.nearBank(f.p), true);
  Storage.store(f.p, family, I.EYE_OF_NEWT, 2);
  op(f, "Empty");
  assert.deepEqual(f.messages, [M.RUMMAGE]);
  assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 2);
});

test("Open and Close swap the item in place; the store is shared", (t) => {
  const f = actor(t);
  Storage.store(f.p, family, I.SNAPE_GRASS, 4);
  op(f, "Open");
  assert.equal(f.pouch().getId(), OPEN_POUCH);
  op(f, "Check");
  op(f, "Close");
  assert.equal(f.pouch().getId(), POUCH);
  assert.deepEqual(f.messages, [M.OPENED, M.CHECK, "4 x Snape grass", M.CLOSED]);
});

test("the bank panel's op fills while a secondary is carried, otherwise empties into the bank", (t) => {
  const f = actor(t, BANK, OPEN_POUCH);
  const bankOp = () => PM.emitCustomEvent(core.Bank.INVENTORY_OP_EVENT, { player: f.p, item: f.pouch(), slot: 0, op: 9, handled: false });
  add(f, I.EYE_OF_NEWT, 10);
  bankOp();
  assert.equal(held(f, I.EYE_OF_NEWT), 10);
  bankOp();
  assert.equal(Storage.total(f.p, family), 0);
  assert.equal(f.p.getBank(core.Bank.getTabForItem(f.p, I.EYE_OF_NEWT)).getAmount(I.EYE_OF_NEWT), 10);
  bankOp();
  assert.deepEqual(f.messages, [M.SEARCH, M.ADDED, M.TO_BANK, M.EMPTY]);
});

test("the bank panel's op says nothing when the bank has no room for any of the contents", (t) => {
  const f = actor(t, BANK, OPEN_POUCH);
  add(f, I.EYE_OF_NEWT, 10);
  PM.emitCustomEvent(core.Bank.INVENTORY_OP_EVENT, { player: f.p, item: f.pouch(), slot: 0, op: 9, handled: false });
  assert.equal(Storage.total(f.p, family), 10);
  const tab = f.p.getBank(core.Bank.getTabForItem(f.p, I.EYE_OF_NEWT));
  t.mock.method(tab, "getAddableAmount", () => 0);
  f.messages.length = 0;
  PM.emitCustomEvent(core.Bank.INVENTORY_OP_EVENT, { player: f.p, item: f.pouch(), slot: 0, op: 9, handled: false });
  assert.equal(Storage.total(f.p, family), 10);
  assert.deepEqual(f.messages, []);
});

test("an open pouch takes a picked-up secondary with the pickup sound; a closed one doesn't", async (t) => {
  for (const [pouchId, stored] of [[OPEN_POUCH, 1], [POUCH, 0]]) {
    const f = actor(t, AWAY, pouchId);
    const pile = core.ItemOnGroundManager.registers(f.p, new core.Item(I.EYE_OF_NEWT, 1));
    t.after(() => { if (!pile.isPendingRemoval()) core.ItemOnGroundManager.deregister(pile); });
    const sounds = [];
    const sendSound = core.Sounds.sendSound.bind(core.Sounds);
    const mock = t.mock.method(core.Sounds, "sendSound", (player, sound) => {
      if (player === f.p) sounds.push(sound.getId());
      return sendSound(player, sound);
    });
    const at = f.p.getLocation();
    await f.c.dispatch([{ type: "ground_item_action", itemId: I.EYE_OF_NEWT, x: at.getX(), y: at.getY(), option: "Take" }]);
    f.c.processTurnPackets();
    for (let i = 0; i < 4; i++) {
      f.p.needsPlacement = false;
      core.TaskManager.processWalkTo(f.p.getIndex());
      f.p.getMovementQueue().process();
      core.TaskManager.process();
    }
    mock.mock.restore();
    assert.equal(held(f, I.EYE_OF_NEWT), stored);
    assert.equal(f.inv.getAmount(I.EYE_OF_NEWT), 1 - stored);
    if (stored) {
      assert.ok(f.messages.includes("You put the Eye of newt into your Reagent pouch."), JSON.stringify(f.messages));
      assert.deepEqual(sounds, [core.Sound.PICK_UP_ITEM.getId()]);
    }
  }
});
