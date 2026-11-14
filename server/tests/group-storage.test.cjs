// Run after `yarn build`: node --test tests/group-storage.test.cjs
// GroupStorage.plugin.js behind Grouping's chests: the cache interface it opens, changes on copies
// kept only by Save, one member at a time, deposit-only leavers, free-to-play worlds, what may be
// stored, a group that can't end while it holds items, and the file across a restart.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Misc } = require("../dist/util/Misc");
const { DisplayNames } = require("../dist/game/entity/impl/player/DisplayNames");
const Grouping = require("../plugins/interface/Grouping.plugin");
const GroupStorage = require("../plugins/interface/GroupStorage.plugin");

const { Access, Buttons, Items, Session, Store, View } = GroupStorage._test;
const Groups = Grouping._test.Store;
const { Leaving } = Grouping._test;

const COINS = 995;
const WHIP = 4151; // members, unstackable, notes to 4152
const BRONZE_DAGGER = 1205; // free-to-play, unstackable, notes to 1206
const FIRE_CAPE = 6570; // untradeable

let core;
let dir;
let online;
let members;
let handlers;
let hooks;
let saves;

const encoded = (name) => Misc.stringToLongBigInt(name);
const uid = (name) => core.CacheDefinitions.getComponentId(name);
const varp = (name) => core.CacheDefinitions.getVarpId(name);
const varbit = (name) => core.CacheDefinitions.getVarbitId(name);
const invId = (name) => core.CacheDefinitions.getInventoryId(name);

function emit(name, payload) {
  for (const handler of handlers.get(name) ?? []) handler(payload);
  return payload;
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PluginManager.getCoreApi();
  const World = {
    getPlayers: () => ({
      search: (filter) => online.find(filter) ?? null,
      forEach: (action) => online.forEach(action),
    }),
  };
  core = { ...real, World, WorldDefinition: { isMembersWorld: () => members } };
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-storage-"));
  process.env[Groups.FILE_ENV] = path.join(dir, "groups.json");
  process.env[Store.FILE_ENV] = path.join(dir, "group-storage.json");
  process.env[DisplayNames.FILE_ENV] = path.join(dir, "display-names.json");
  DisplayNames.reset();
  Groups.reset();
  Store.reset();
  online = [];
  members = true;
  saves = [];
  handlers = new Map();
  hooks = new Map();
  const add = (key, handler) => hooks.set(key, [...(hooks.get(key) ?? []), handler]);
  const api = new Proxy({
    core,
    persistAttribute() {},
    registerCustomInterface() {},
    registerCommand: (name, handler) => add(`command:${name}`, handler),
    onObjectInteraction: (name, actions) => add(`object:${name}`, actions),
    onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => emit(name, payload),
  }, { get: (target, key) => (key in target ? target[key] : (...args) => add(String(key), args.at(-1))) });
  Grouping.register(api);
  GroupStorage.register(api);
  // The Ironman plugin's answer, from the attribute it keeps.
  handlers.set("ironman:mode", [(query) => {
    query.mode = query.player?.getAttribute?.("ironman:mode") ?? "none";
  }]);
  handlers.set("persistence:save", [(request) => saves.push(request.reason)]);
});

afterEach(() => {
  DisplayNames.reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A real player whose packets are recorded: messages, vars, inventories, opened interfaces. */
function account(name, { mode = "group" } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  if (mode) player.setAttribute("ironman:mode", mode);
  const log = { messages: [], configs: new Map(), varbits: new Map(), invs: new Map(), subs: [], flags: [], prompts: [] };
  const known = {
    sendMessage(text) { log.messages.push(text); return sender; },
    sendConfig(id, value) { log.configs.set(id, value); return sender; },
    sendVarbit(id, value) { log.varbits.set(id, value); return sender; },
    getVarbit(id) { return log.varbits.get(id) ?? 0; },
    sendInventory(id, capacity, items) {
      log.invs.set(id, Array.from({ length: capacity }, (_, slot) => (items[slot] ? [items[slot].id, items[slot].amount] : null)));
      return sender;
    },
    sendSubInterface(target, group, type) { log.subs.push([target, group, type]); return sender; },
    sendInterfaceFlagsRange(component, from, to, flags) { log.flags.push([component, from, to, flags]); return sender; },
    sendEnterAmountPrompt(text) { log.prompts.push(text); return sender; },
    isSubInterfaceOpen: () => player.getInterfaceId() === View.MAIN(),
    sendInterfaceRemoval() {
      const interfaceId = player.getInterfaceId();
      player.setInterfaceId(-1);
      emit("interface:closed", { player, interfaceId });
      return sender;
    },
  };
  const sender = new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => log.messages.push(text);
  online.push(player);
  return Object.assign(player, { log });
}

/** A Group Ironman group, as Grouping would have formed it; the first player leads. */
function groupOf(...players) {
  const group = Groups.create("main", encoded(players[0].getUsername()), 1, true);
  for (const player of players.slice(1)) Groups.addMember(group, encoded(player.getUsername()), 2);
  for (const player of players) Groups.setPresent("main", encoded(player.getUsername()), true);
  return group;
}

const said = (player) => player.log.messages.at(-1);
const openChest = (player) => {
  for (const actions of hooks.get("object:Group storage")) actions.Open({ player });
};
const click = (player, name, action = 1, slot = -1) =>
  Buttons.click({ player, buttonId: uid(name), action, slot, handled: false });
const storageView = (player) => player.log.invs.get(invId("inv_group_temp"));
const sideView = (player) => player.log.invs.get(invId("inv_player_temp"));
const held = (player, id) => player.getInventory().getItems().reduce((sum, item) => sum + (item?.getId() === id ? item.getAmount() : 0), 0);
const stored = (groupId, id) => Store.slotsOf(groupId).reduce((sum, item) => sum + (item?.id === id ? item.amount : 0), 0);
const slotOf = (player, id) => player.getInventory().getItems().findIndex((item) => item?.getId() === id);
const groupCommand = (player, ...words) => {
  for (const handler of hooks.get("command:group")) handler({ player, parts: ["group", ...words] });
};
const hasEdited = (player) => player.log.varbits.get(varbit("gim_shared_bank_hasedited"));

// --- Opening -----------------------------------------------------------------------------------

test("a Group Ironman member opens the chest: the cache's shared_bank with copies of storage and backpack", () => {
  const alice = account("alice");
  const bob = account("bob");
  const group = groupOf(alice, bob);
  alice.getInventory().adds(COINS, 1000);
  openChest(alice);

  assert.equal(alice.getInterfaceId(), View.MAIN());
  assert.deepEqual(alice.log.subs.map(([target, opened, type]) => [target, opened, type]), [
    [uid("toplevel_osrs_stretch:mainmodal"), core.CacheDefinitions.getInterfaceId("shared_bank"), 0],
    [uid("toplevel_osrs_stretch:sidemodal"), core.CacheDefinitions.getInterfaceId("shared_bank_side"), 3],
  ]);
  assert.deepEqual(["if1", "if2", "if3", "if4"].map((name) => alice.log.configs.get(varp(name))), [-1, 2, 80, 0]);
  assert.equal(storageView(alice).length, 80);
  assert.ok(storageView(alice).every((slot) => slot === null));
  assert.deepEqual(sideView(alice)[0], [COINS, 1000]);
  assert.deepEqual(alice.log.flags[0], [uid("shared_bank:items"), 0, 79, View.STORAGE_SLOT_FLAGS]);
  assert.equal(hasEdited(alice), 0);
  assert.equal(Session.holder(group.id).player, alice);
});

test("only Group Ironmen in a Group Ironman group get in", () => {
  const carl = account("carl", { mode: null });
  const dana = account("dana", { mode: null });
  const plain = Groups.create("main", encoded("carl"), 1, false);
  Groups.addMember(plain, encoded("dana"), 2);
  openChest(carl);
  assert.equal(said(carl), Access.MESSAGE.NOT_IRONMAN);
  assert.notEqual(carl.getInterfaceId(), View.MAIN());
  assert.ok(dana);
});

// --- Copies and Save ---------------------------------------------------------------------------

test("deposits and withdrawals change only the copies until Save; the next member sees what was saved", () => {
  const alice = account("alice");
  const bob = account("bob");
  const group = groupOf(alice, bob);
  alice.getInventory().adds(COINS, 1000);
  openChest(alice);

  click(alice, "shared_bank_side:items", 7, slotOf(alice, COINS)); // Deposit-All
  assert.deepEqual(storageView(alice)[0], [COINS, 1000]);
  assert.equal(sideView(alice)[0], null);
  assert.equal(held(alice, COINS), 1000, "the real backpack is untouched");
  assert.equal(stored(group.id, COINS), 0, "and so is the saved storage");
  assert.equal(hasEdited(alice), 1, "Close becomes Save and Close");

  click(alice, "shared_bank:save_button");
  assert.equal(stored(group.id, COINS), 1000);
  assert.equal(held(alice, COINS), 0);
  assert.equal(hasEdited(alice), 0);
  assert.deepEqual(saves, ["group-storage"]);

  alice.getPacketSender().sendInterfaceRemoval();
  assert.equal(Session.holder(group.id), null, "closing lets the next member in");
  openChest(bob);
  assert.deepEqual(storageView(bob)[0], [COINS, 1000]);
  click(bob, "shared_bank:items", 4, 0); // Withdraw-10
  click(bob, "shared_bank:close"); // Save and Close
  assert.equal(stored(group.id, COINS), 990);
  assert.equal(held(bob, COINS), 10);
  assert.notEqual(bob.getInterfaceId(), View.MAIN());
});

test("closing without saving, or logging out, drops the changes; nothing moved", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  alice.getInventory().adds(WHIP, 1);
  openChest(alice);
  click(alice, "shared_bank_side:items", 1, slotOf(alice, WHIP));
  alice.getPacketSender().sendInterfaceRemoval();
  assert.equal(stored(group.id, WHIP), 0);
  assert.equal(held(alice, WHIP), 1);

  openChest(alice);
  assert.ok(storageView(alice).every((slot) => slot === null), "the dropped deposit isn't there");
  click(alice, "shared_bank_side:items", 1, slotOf(alice, WHIP));
  for (const handler of hooks.get("onPlayerLogout")) handler({ player: alice });
  assert.equal(Session.current(alice), null);
  assert.equal(stored(group.id, WHIP), 0);
  assert.equal(held(alice, WHIP), 1);
});

test("Save refuses when the backpack changed behind the copies, and starts over from what is there", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  alice.getInventory().adds(COINS, 100);
  openChest(alice);
  click(alice, "shared_bank_side:items", 7, slotOf(alice, COINS));
  alice.getInventory().adds(COINS, 5);
  click(alice, "shared_bank:save_button");
  assert.equal(said(alice), Access.MESSAGE.CHANGED);
  assert.equal(stored(group.id, COINS), 0);
  assert.equal(held(alice, COINS), 105);
  assert.deepEqual(sideView(alice)[slotOf(alice, COINS)], [COINS, 105], "the copies are the real ones again");
  assert.equal(hasEdited(alice), 0);
});

// --- One at a time, leavers ------------------------------------------------------------------

test("one member at a time", () => {
  const alice = account("alice");
  const bob = account("bob");
  const group = groupOf(alice, bob);
  openChest(alice);
  openChest(bob);
  assert.equal(said(bob), Access.MESSAGE.IN_USE("Alice"), "named as the group shows them");
  assert.notEqual(bob.getInterfaceId(), View.MAIN());
  online = online.filter((player) => player !== alice);
  openChest(bob);
  assert.equal(bob.getInterfaceId(), View.MAIN(), "a holder who left the world doesn't keep the lock");
  assert.equal(Session.holder(group.id).player, bob);
});

test("a member in their leaving period can deposit but not take out", () => {
  const alice = account("alice");
  const bob = account("bob");
  // Carl stays: with everyone leaving the storage takes nothing at all (the test below).
  const group = groupOf(alice, bob, account("carl"));
  Store.commit(group.id, [{ id: COINS, amount: 50 }]);
  Groups.setLeaving(group, encoded("bob"), Date.now() + Leaving.LEAVING_MS, false);
  bob.getInventory().adds(BRONZE_DAGGER, 1);
  openChest(bob);
  assert.equal(bob.log.configs.get(varp("if2")), 1, "Deposit only");
  click(bob, "shared_bank:items", 7, 0);
  assert.equal(said(bob), Access.MESSAGE.DEPOSIT_ONLY);
  click(bob, "shared_bank_side:items", 1, slotOf(bob, BRONZE_DAGGER));
  click(bob, "shared_bank:save_button");
  assert.equal(stored(group.id, BRONZE_DAGGER), 1);
  assert.equal(stored(group.id, COINS), 50);
  bob.getPacketSender().sendInterfaceRemoval();

  // Alice takes coins out, then starts leaving before she saves.
  openChest(alice);
  click(alice, "shared_bank:items", 7, 0);
  Groups.setLeaving(group, encoded("alice"), Date.now() + Leaving.LEAVING_MS, false);
  click(alice, "shared_bank:save_button");
  assert.equal(said(alice), Access.MESSAGE.DEPOSIT_ONLY);
  assert.equal(alice.log.configs.get(varp("if2")), 1);
  assert.equal(stored(group.id, COINS), 50);
  assert.equal(held(alice, COINS), 0);
});

test("a member whose leaving period ends is shut out, and an ended group's storage closes", () => {
  const alice = account("alice");
  const bob = account("bob");
  const group = groupOf(alice, bob);
  openChest(bob);
  Groups.setLeaving(group, encoded("bob"), Date.now() - 1, true);
  Leaving.settle(Date.now());
  assert.equal(said(bob), Access.MESSAGE.NO_ACCESS);
  assert.notEqual(bob.getInterfaceId(), View.MAIN());
  assert.equal(Session.holder(group.id), null);

  openChest(alice);
  groupCommand(alice, "leave");
  assert.notEqual(alice.getInterfaceId(), View.MAIN(), "the last member leaving: nobody stays, so the storage closes");
  Leaving.settle(Date.now() + Leaving.LEAVING_MS + 1000);
  assert.equal(Groups.byId(group.id), undefined, "the last member's seven days are over: the group ends");
  assert.notEqual(alice.getInterfaceId(), View.MAIN());
});

// --- What may be stored ----------------------------------------------------------------------

test("on a free-to-play world members' items stay where they are", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  Store.commit(group.id, [{ id: WHIP, amount: 1 }]);
  members = false;
  alice.getInventory().adds(WHIP, 1);
  alice.getInventory().adds(BRONZE_DAGGER, 1);
  openChest(alice);
  click(alice, "shared_bank_side:items", 1, slotOf(alice, WHIP));
  assert.equal(said(alice), Items.MESSAGE.MEMBERS);
  click(alice, "shared_bank:items", 1, 0);
  assert.equal(said(alice), Items.MESSAGE.MEMBERS);
  click(alice, "shared_bank_side:items", 1, slotOf(alice, BRONZE_DAGGER));
  click(alice, "shared_bank:close");
  assert.deepEqual([stored(group.id, WHIP), stored(group.id, BRONZE_DAGGER), held(alice, WHIP)], [1, 1, 1]);
});

test("tradeable items only; noted items are stored unnoted and come out noted only in note mode", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  alice.getInventory().adds(FIRE_CAPE, 1);
  alice.getInventory().adds(BRONZE_DAGGER + 1, 3);
  alice.getInventory().adds(BRONZE_DAGGER, 2);
  openChest(alice);
  click(alice, "shared_bank_side:items", 1, slotOf(alice, FIRE_CAPE));
  assert.equal(said(alice), Items.MESSAGE.NOT_STORABLE);
  click(alice, "shared_bank_side:items", 7, slotOf(alice, BRONZE_DAGGER + 1));
  click(alice, "shared_bank_side:items", 7, slotOf(alice, BRONZE_DAGGER));
  assert.deepEqual(storageView(alice)[0], [BRONZE_DAGGER, 5], "noted and unnoted share one stack");

  click(alice, "shared_bank:items", 3, 0); // Withdraw-5, unnoted: as many as there is room for
  const daggers = sideView(alice).filter((slot) => slot?.[0] === BRONZE_DAGGER);
  assert.equal(daggers.length, 5);
  click(alice, "shared_bank_side:items", 7, sideView(alice).findIndex((slot) => slot?.[0] === BRONZE_DAGGER));
  click(alice, "shared_bank:note");
  click(alice, "shared_bank:items", 7, 0);
  assert.ok(sideView(alice).some((slot) => slot?.[0] === BRONZE_DAGGER + 1 && slot[1] === 5));
  click(alice, "shared_bank:save_button");
  assert.equal(held(alice, BRONZE_DAGGER + 1), 5);
  assert.equal(stored(group.id, BRONZE_DAGGER), 0);
});

test("80 spaces; a withdrawn slot stays empty until Shuffle items up; dragging swaps or inserts", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  const ids = [];
  for (let id = 1; ids.length < 80; id++) {
    const definition = core.ItemDefinition.forId(id);
    if (definition.isTradeable() && !definition.isNoted() && core.CacheDefinitions.getItem(id).isMembers !== true
      && definition.getName() && definition.getName() !== "null") ids.push(id);
  }
  Store.commit(group.id, ids.map((id) => ({ id, amount: 1 })));
  alice.getInventory().adds(COINS, 5);
  openChest(alice);
  click(alice, "shared_bank_side:items", 1, slotOf(alice, COINS));
  assert.equal(said(alice), Items.MESSAGE.FULL);

  click(alice, "shared_bank:items", 1, 1);
  assert.equal(storageView(alice)[1], null, "the slot stays empty");
  click(alice, "shared_bank:compress");
  assert.deepEqual(storageView(alice).slice(0, 3).map((slot) => slot[0]), [ids[0], ids[2], ids[3]]);
  assert.equal(storageView(alice)[79], null);

  const drag = (from, to) => Buttons.drag({ player: alice, handled: false, packet: {
    type: "widget_drag", sourceWidgetId: uid("shared_bank:items"), targetWidgetId: uid("shared_bank:items"), sourceSlot: from, targetSlot: to,
  } });
  drag(0, 2);
  assert.deepEqual(storageView(alice).slice(0, 3).map((slot) => slot[0]), [ids[3], ids[2], ids[0]], "swap");
  click(alice, "shared_bank:swap_insert");
  drag(0, 2);
  assert.deepEqual(storageView(alice).slice(0, 3).map((slot) => slot[0]), [ids[2], ids[0], ids[3]], "insert");
});

// --- Ending, restarts ------------------------------------------------------------------------

test("when every member is leaving the storage takes nothing, so no deposit outlives the group", () => {
  const alice = account("alice");
  const bob = account("bob");
  const group = groupOf(alice, bob);
  alice.getInventory().adds(COINS, 5000);
  Groups.setLeaving(group, encoded("bob"), Date.now() + Leaving.LEAVING_MS, false);

  // Alice, still staying, opens it and puts coins in; she starts leaving before she saves.
  openChest(alice);
  click(alice, "shared_bank_side:items", 1, slotOf(alice, COINS));
  Groups.setLeaving(group, encoded("alice"), Date.now() + Leaving.LEAVING_MS, false);
  click(alice, "shared_bank:save_button");
  assert.equal(stored(group.id, COINS), 0, "Save refused: nobody stays");
  alice.getPacketSender().sendInterfaceRemoval();
  assert.equal(held(alice, COINS), 5000);

  openChest(alice);
  assert.equal(said(alice), Access.MESSAGE.ALL_LEAVING, "it doesn't open for a deposit either");
  Leaving.settle(Date.now() + Leaving.LEAVING_MS + 1000);
  assert.equal(Groups.byId(group.id), undefined, "the group ends");
  assert.deepEqual([held(alice, COINS), stored(group.id, COINS)], [5000, 0], "and nothing was lost with it");
});

test("a group can't end while its storage holds items, and the storage outlives a restart", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  Store.commit(group.id, [{ id: COINS, amount: 7 }]);
  Groups.setLeaving(group, encoded("bob"), Date.now() + Leaving.LEAVING_MS, false);
  groupCommand(alice, "leave");
  assert.equal(said(alice), Access.MESSAGE.NOT_EMPTY, "the last member who isn't leaving can't leave a non-empty storage");
  assert.equal(Groups.byId(group.id).leaving.has(encoded("alice")), false);

  Store.reset();
  assert.equal(stored(group.id, COINS), 7);
  Store.commit(group.id, []);
  assert.equal(emit("grouping:can-end", { groupId: group.id, allowed: true }).allowed, true);
  groupCommand(alice, "leave");
  Leaving.settle(Date.now() + Leaving.LEAVING_MS + 1000);
  assert.equal(Groups.byId(group.id), undefined);
});

test("an ended group with items left keeps its record, marked ended", () => {
  Store.commit(42, [{ id: COINS, amount: 3 }]);
  Store.end(42, 1234);
  Store.reset();
  assert.deepEqual([Store.endedAt(42), stored(42, COINS)], [1234, 3]);
  Store.commit(43, []);
  Store.end(43);
  assert.equal(Store.endedAt(43), 0);
});

test("the bank's Group Storage button opens the storage with Back to bank, which saves and goes back", () => {
  const alice = account("alice");
  const group = groupOf(alice, account("bob"));
  alice.getInventory().adds(COINS, 30);
  let bankOpened = 0;
  alice.getBank = () => ({ open: () => bankOpened++ });
  const press = (player, name, buttonNum) => {
    const event = { player, handled: false, packet: { type: "widget_action", widgetId: uid(name), buttonNum } };
    Buttons.drag(event);
    return event.handled;
  };

  assert.equal(press(alice, "bankmain:gim_storage", 1), true);
  assert.equal(alice.getInterfaceId(), View.MAIN());
  assert.equal(alice.log.configs.get(varp("if4")), 1, "main_bank gets its Back to bank op");
  click(alice, "shared_bank_side:items", 7, slotOf(alice, COINS));
  click(alice, "shared_bank:main_bank");
  assert.equal(stored(group.id, COINS), 30, "Back to bank keeps what was done");
  assert.equal(bankOpened, 1);
  assert.notEqual(alice.getInterfaceId(), View.MAIN());

  openChest(alice);
  assert.equal(alice.log.configs.get(varp("if4")), 0, "the chests have no way back");
  click(alice, "shared_bank:main_bank");
  assert.equal(bankOpened, 1);

  const carl = account("carl", { mode: null });
  assert.equal(press(carl, "bankmain:gim_storage", 1), false, "anyone else's click is the bank's");
  const dana = account("dana");
  press(dana, "bankmain:gim_storage", 1);
  assert.equal(said(dana), Access.MESSAGE.NOT_MEMBER);
});
