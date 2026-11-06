// Run after `yarn build`: node --test tests/gem-bag-pickup.test.cjs
//
// An open gem bag's ground pickup, by Take packet. Pickup hooks stop at the first handled one. Run
// opus-test-20261105T171928Z-23932 printed the order: StorageItems 2, Ironman 6, LootingBag 40. So the
// gem bag runs before the Ironman rule, and the looting bag after it and after the gem bag.
// Ironman's refusal line is captured (tests/ironman.test.cjs). No capture shows a bag at either.
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
const { State } = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const Storage = require("../plugins/items/storage/Common.StorageItems");

const HOME = [3222, 3218];
/** Level 1-ish Wilderness, north of the ditch, in the open. */
const WILDERNESS = [3100, 3540];
const OPEN_LOOTING_BAG = 22586;
const REFUSED = "You're an Ironman, so you can't take items that other players have dropped.";
const STRAIGHT_IN = "You put it straight into your open gem bag.";

let core;
let I;
let family;
let OPEN_GEM_BAG;
let next = 9800;
const pickupPolicies = new WeakMap();
const pickupEvents = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  family = Storage.FAMILIES.get("gem-bag");
  OPEN_GEM_BAG = core.CacheDefinitions.getObjId("gem_bag_open");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  core.RegionManager.loadMapFiles(...WILDERNESS);
  PM.emitServerStartup({});
  PM.createApi("GemPickupPolicyTest").onCustomEvent("ground-items:take", (event) => pickupPolicies.get(event.player)?.(event));
  PM.createApi("GemPickupEventTest").onCustomEvent("ground-items:taken", (event) => pickupEvents.get(event.player)?.push({ amount: event.amount, discarded: event.discarded, source: event.source }));

});
after(() => PM.emitServerShutdown({}));

function actor(t, at = HOME, gemBag = true) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pickqa" + p.getIndex());
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
  if (gemBag) p.getInventory().add(new core.Item(OPEN_GEM_BAG), true);
  return { p, c, inv: p.getInventory(), messages };
}

/** A gem on the player's own tile; `owner` null means theirs, else another player's gone public. */
function gemHere(t, f, owner = null) {
  const pile = core.ItemOnGroundManager.registers(f.p, new core.Item(I.UNCUT_RUBY, 1));
  if (owner) {
    pile.owner = owner;
    pile.setState(State.SEEN_BY_EVERYONE);
  }
  t.after(() => {
    if (!pile.isPendingRemoval()) core.ItemOnGroundManager.deregister(pile);
  });
  return pile;
}

async function take(f) {
  const at = f.p.getLocation();
  await f.c.dispatch([{ type: "ground_item_action", itemId: I.UNCUT_RUBY, x: at.getX(), y: at.getY(), option: "Take" }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 4; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const stored = (f) => Storage.amountOf(f.p, family, I.UNCUT_RUBY);
const setIron = (f) => f.p.setAttribute("ironman:mode", "ironman");

function watchPickupSounds(t, f) {
  const sounds = [];
  const sendSound = core.Sounds.sendSound.bind(core.Sounds);
  t.mock.method(core.Sounds, "sendSound", (player, sound) => {
    if (player === f.p) sounds.push(sound.getId());
    return sendSound(player, sound);
  });
  return sounds;
}

for (const kind of ["bag", "sack"]) {
  test(`a successful ${kind} pickup plays the normal pickup sound once`, async (t) => {
    const f = actor(t, HOME, kind === "bag");
    if (kind === "sack") f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
    const pile = gemHere(t, f), events = [], sounds = watchPickupSounds(t, f);
    pickupEvents.set(f.p, events);
    await take(f);
    const target = Storage.FAMILIES.get(`gem-${kind}`);
    assert.equal(Storage.amountOf(f.p, target, I.UNCUT_RUBY), 1);
    assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
    assert.equal(pile.isPendingRemoval(), true);
    assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
    assert.deepEqual(sounds, [core.Sound.PICK_UP_ITEM.getId()]);
  });
}

test("an open bag takes the player's own gem (control)", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  await take(f);
  assert.equal(stored(f), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), true);
  assert.ok(f.messages.includes(STRAIGHT_IN), JSON.stringify(f.messages));
});

test("a denied ground take cannot put a gem in the bag", async (t) => {
  const f = actor(t);
  const sounds = watchPickupSounds(t, f);
  const pile = gemHere(t, f);
  const events = [];
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => { event.allow = false; });
  await take(f);
  assert.equal(stored(f), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(sounds, []);
});

test("a failed gem store leaves the ground item and plays no pickup sound", async (t) => {
  const f = actor(t), pile = gemHere(t, f), sounds = watchPickupSounds(t, f), events = [];
  pickupEvents.set(f.p, events);
  const store = Storage.store.bind(Storage);
  let attempts = 0;
  t.mock.method(Storage, "store", (player, ...args) => {
    if (player === f.p) { attempts++; return 0; }
    return store(player, ...args);
  });
  await take(f);
  assert.equal(attempts, 1, "the native pickup reached the injected failed store");
  assert.equal(stored(f), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(sounds, []);
});

test("an allowed bag pickup emits the credited ground-item event once", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  const events = [];
  pickupEvents.set(f.p, events);
  await take(f);
  assert.equal(stored(f), 1);
  assert.equal(pile.isPendingRemoval(), true);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("a gem with metadata follows ordinary pickup and keeps that metadata", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  pile.getItem().setMetaValue("gem-test:marker", 17);
  await take(f);
  assert.equal(stored(f), 0);
  const held = f.inv.getValidItems().find((entry) => entry.getId() === I.UNCUT_RUBY);
  assert.equal(held?.getMetaValue("gem-test:marker"), 17);
  assert.equal(pile.isPendingRemoval(), true);
});

test("a nested pickup during the take policy cannot duplicate the gem", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  const events = [];
  pickupEvents.set(f.p, events);
  let calls = 0;
  pickupPolicies.set(f.p, () => {
    calls++;
    if (calls === 1) core.ItemOnGroundManager.pickup(f.p, pile);
  });
  await take(f);
  assert.equal(calls, 1);
  assert.equal(stored(f), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("an open sack stores the player's own gem once", async (t) => {
  const f = actor(t, HOME, false);
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
  const pile = gemHere(t, f);
  await take(f);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_RUBY), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), true);
  assert.ok(f.messages.includes("You put it straight into your open gem sack."), JSON.stringify(f.messages));
  assert.equal(f.messages.includes(STRAIGHT_IN), false);
});

test("an Ironman's open sack cannot take another player's gem", async (t) => {
  const f = actor(t, HOME, false);
  const sounds = watchPickupSounds(t, f);
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
  setIron(f);
  const pile = gemHere(t, f, "OtherPlayer");
  await take(f);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_RUBY), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
  assert.deepEqual(sounds, []);
});

function sackActor(t) {
  const f = actor(t, HOME, false);
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
  return f;
}

test("ground take policy can refuse a gem for an open sack", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f), events = [];
  const sounds = watchPickupSounds(t, f);
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => { event.allow = false; });
  await take(f);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(sounds, []);
});

test("sack pickup emits the credited ground-item event once", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f), events = [];
  pickupEvents.set(f.p, events);
  await take(f);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 1);
  assert.equal(pile.isPendingRemoval(), true);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("metadata gem bypasses sack storage and keeps metadata", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f);
  pile.getItem().setMetaValue("gem-test:marker", 17);
  await take(f);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 0);
  const held = f.inv.getValidItems().find((entry) => entry.getId() === I.UNCUT_RUBY);
  assert.equal(held?.getMetaValue("gem-test:marker"), 17);
});

test("nested sack pickup cannot duplicate a gem", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f), events = [];
  pickupEvents.set(f.p, events);
  let calls = 0;
  pickupPolicies.set(f.p, () => { calls++; if (calls === 1) core.ItemOnGroundManager.pickup(f.p, pile); });
  await take(f);
  assert.equal(calls, 1);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("an Ironman's open bag doesn't take another player's gem, and it stays on the ground", async (t) => {
  const f = actor(t);
  const sounds = watchPickupSounds(t, f);
  setIron(f);
  const pile = gemHere(t, f, "OtherPlayer");
  await take(f);
  assert.equal(stored(f), 0, "not in the bag");
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0, "not in the pack");
  assert.equal(pile.isPendingRemoval(), false, "still on the ground");
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
  assert.deepEqual(sounds, []);
});

test("an Ironman's open bag still takes their own gem (control)", async (t) => {
  const f = actor(t);
  setIron(f);
  gemHere(t, f);
  await take(f);
  assert.equal(stored(f), 1);
  assert.equal(f.messages.includes(REFUSED), false, JSON.stringify(f.messages));
});

test("a normal player's open bag takes another player's public gem (control)", async (t) => {
  const f = actor(t);
  gemHere(t, f, "OtherPlayer");
  await take(f);
  assert.equal(stored(f), 1);
});

test("an open looting bag and an open gem bag: the gem goes into one, once (control)", async (t) => {
  const f = actor(t, WILDERNESS);
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), true);
  const pile = gemHere(t, f);
  await take(f);
  // The gem bag's hook comes first. Which should win on live isn't known; here only once matters.
  assert.equal(stored(f), 1);
  assert.equal(f.messages.some((text) => /in your Looting bag/i.test(text)), false, JSON.stringify(f.messages));
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), true);
});

test("an Ironman's open looting bag doesn't take another player's gem: the rule runs first (control)", async (t) => {
  const f = actor(t, WILDERNESS, false);
  f.p.setAttribute("ironman:mode", "ironman");
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), true);
  const pile = gemHere(t, f, "OtherPlayer");
  await take(f);
  assert.equal(f.messages.some((text) => /in your Looting bag/i.test(text)), false, JSON.stringify(f.messages));
  assert.equal(pile.isPendingRemoval(), false, "still on the ground");
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
});

test("an Ironman's open looting bag still takes their own gem (control)", async (t) => {
  const f = actor(t, WILDERNESS, false);
  f.p.setAttribute("ironman:mode", "ironman");
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), true);
  const pile = gemHere(t, f);
  await take(f);
  assert.ok(f.messages.some((text) => /in your Looting bag/i.test(text)), JSON.stringify(f.messages));
  assert.equal(pile.isPendingRemoval(), true);
});


test("emptying a gem bag into the bank preserves gems at stack limits", async (t) => {
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const Bank = core.Bank;
  for (const mode of ["room", "exact", "near", "full"]) {
    await t.test(mode, async (t) => {
      const f = actor(t);
      const ruby = I.UNCUT_RUBY;
      const bank = f.p.getBank(0);
      const headroom = mode === "exact" ? 2 : mode === "near" ? 1 : 0;
      const initialBank = mode === "room" ? 100 : MAX_STACK_AMOUNT - headroom - 1;
      const bag = f.inv.getItems()[f.inv.getSlotForItemId(OPEN_GEM_BAG)];
      assert.equal(core.CacheDefinitions.getObjId("gem_bag_open"), OPEN_GEM_BAG);
      assert.equal(core.CacheDefinitions.getItem(OPEN_GEM_BAG).params?.get(595), "Empty");
      assert.equal(core.CacheDefinitions.getItem(OPEN_GEM_BAG).inventoryActions[0], "Fill");
      assert.equal(core.ItemDefinition.forId(ruby).isStackable(), false);
      assert.equal(bank.stackType(), require("../dist/game/model/container/StackType").StackType.STACKS);
      t.after(() => f.p.closeInterruptibleInterfaces());
      const send = async (packet) => {
        await f.c.dispatch([packet]);
        f.c.processTurnPackets();
      };
      const xp = () => core.Skill.values().map((skill) => f.p.getSkillManager().getExperience(skill));
      const initialXp = xp(), gains = [];
      const addExperience = f.p.getSkillManager().addExperience.bind(f.p.getSkillManager());
      t.mock.method(f.p.getSkillManager(), "addExperience", (...args) => {
        gains.push([String(args[0]), args[1]]);
        return addExperience(...args);
      });
      f.inv.add(new core.Item(ruby), false).add(new core.Item(ruby), true);
      assert.equal(f.inv.getAmount(ruby), 2);
      assert.equal(Storage.amountOf(f.p, family, ruby), 0);
      await send({ type: "inventory_action", widgetId: (149 << 16),
        slot: f.inv.getItems().indexOf(bag), itemId: OPEN_GEM_BAG, option: "Fill" });
      assert.equal(Storage.amountOf(f.p, family, ruby), 2, "real Fill stores both ordinary gems");
      assert.equal(f.inv.getAmount(ruby), 0);
      bank.add(new core.Item(ruby, initialBank), false);
      assert.equal(bank.getAmount(ruby), initialBank);
      f.inv.add(new core.Item(ruby), true);
      bank.open();
      assert.equal(Bank.isOpen(f.p), true, "normal live bank admission permits this player");
      assert.equal(f.p.getPacketSender().getSubInterfaceAt((161 << 16) | 74)?.groupId, Bank.SIDE_INTERFACE_ID);
      const rubySlot = f.inv.getSlotForItemId(ruby);
      await send({ type: "widget_action", widgetId: (Bank.SIDE_INTERFACE_ID << 16) | 3,
        groupId: Bank.SIDE_INTERFACE_ID, childId: 3, buttonNum: 2,
        slot: rubySlot, itemId: ruby, option: "Deposit-1" });
      assert.equal(bank.getAmount(ruby), initialBank + 1, "native deposit establishes the final bank stack");
      assert.equal(f.inv.getAmount(ruby), 0);
      assert.equal(Storage.amountOf(f.p, family, ruby), 2);
      assert.equal(bank.getAddableAmount(new core.Item(ruby, 2)), mode === "room" ? 2 : headroom);
      assert.equal(Bank.isOpen(f.p), true);
      assert.equal(f.inv.getItems().includes(bag), true);
      const floor = () => core.World.getItems().filter((ground) => !ground.isPendingRemoval()
        && ground.getOwner() === f.p.getUsername() && ground.getPrivateArea() === f.p.getPrivateArea()
        && ground.getItem().getId() === ruby).reduce((sum, ground) => sum + ground.getItem().getAmount(), 0);
      const state = () => ({
        inventory: f.inv.getAmount(ruby), equipment: f.p.getEquipment().getAmount(ruby),
        banks: f.p.getBanks().reduce((sum, tab, index) => sum + (tab && index !== Bank.BANK_SEARCH_TAB_INDEX ? tab.getAmount(ruby) : 0), 0),
        stored: [...Storage.FAMILIES.values()].reduce((sum, target) => sum + Storage.amountOf(f.p, target, ruby), 0),
        floor: floor(), bags: f.inv.getAmount(OPEN_GEM_BAG),
      });
      const total = (value) => value.inventory + value.equipment + value.banks + value.stored + value.floor;
      const before = state(), ops = [];
      assert.equal(before.stored, 2);
      assert.equal(before.floor, 0);
      assert.deepEqual(gains, []);
      assert.deepEqual(xp(), initialXp);
      const emit = PM.emitCustomEvent.bind(PM);
      t.mock.method(PM, "emitCustomEvent", (name, event) => {
        const result = emit(name, event);
        if (name === Bank.INVENTORY_OP_EVENT && event.player === f.p && event.op === 9) {
          ops.push({ item: event.item === bag, slot: event.slot, handled: event.handled });
        }
        return result;
      });
      const bagSlot = f.inv.getItems().indexOf(bag);
      await send({ type: "widget_action", widgetId: (Bank.SIDE_INTERFACE_ID << 16) | 3,
        groupId: Bank.SIDE_INTERFACE_ID, childId: 3, buttonNum: 9,
        slot: bagSlot, itemId: OPEN_GEM_BAG, option: "Empty" });
      assert.deepEqual(ops, [{ item: true, slot: bagSlot, handled: true }], "real bank op reaches the container handler once");
      const after = state(), details = JSON.stringify({ mode, before, after, headroom });
      assert.equal(total(after), total(before), "all bank, container and owned gems remain conserved: " + details);
      assert.equal(after.bags, 1, details);
      assert.deepEqual(gains, [], details);
      assert.deepEqual(xp(), initialXp, details);
      if (mode === "room" || mode === "exact") {
        assert.equal(after.stored, 0, details);
        assert.equal(after.banks, before.banks + 2, details);
      } else {
        assert.equal(after.stored, 2 - headroom, details);
        assert.equal(after.banks, before.banks + headroom, details);
      }
    });
  }
});

test("log basket bank-empty feedback matches what moved", async (t) => {
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const Bank = core.Bank, basketId = core.CacheDefinitions.getObjId("log_basket_open");
  const basketFamily = Storage.FAMILIES.get("log-basket");
  assert.equal(core.CacheDefinitions.getItem(basketId).params?.get(595), "Empty");
  assert.equal(core.CacheDefinitions.getItem(basketId).inventoryActions[0], "Fill");
  for (const mode of ["empty", "room", "exact", "near", "full", "near-bark", "full-bark"]) {
    await t.test(mode, async (t) => {
      const f = actor(t, HOME, false), bank = f.p.getBank(0);
      const logs = mode.endsWith("-bark") ? I.BARK : I.LOGS;
      if (mode.endsWith("-bark")) assert.equal(core.CacheDefinitions.getItem(logs).name, "Bark");
      f.inv.add(new core.Item(basketId), true);
      const basket = f.inv.getItems()[f.inv.getSlotForItemId(basketId)];
      t.after(() => f.p.closeInterruptibleInterfaces());
      const send = async (packet) => { await f.c.dispatch([packet]); f.c.processTurnPackets(); };
      if (mode !== "empty") {
        f.inv.add(new core.Item(logs), false).add(new core.Item(logs), true);
        await send({ type: "inventory_action", widgetId: (149 << 16),
          slot: f.inv.getItems().indexOf(basket), itemId: basketId, option: "Fill" });
        assert.equal(Storage.amountOf(f.p, basketFamily, logs), 2, "native Fill stored both logs");
        assert.equal(f.inv.getAmount(logs), 0);
        const headroom = mode === "exact" ? 2 : mode.startsWith("near") ? 1 : 0;
        const initialBank = mode === "room" ? 100 : MAX_STACK_AMOUNT - headroom - 1;
        bank.add(new core.Item(logs, initialBank), false);
        f.inv.add(new core.Item(logs), true);
        bank.open();
        assert.equal(Bank.isOpen(f.p), true);
        await send({ type: "widget_action", widgetId: (Bank.SIDE_INTERFACE_ID << 16) | 3,
          groupId: Bank.SIDE_INTERFACE_ID, childId: 3, buttonNum: 2,
          slot: f.inv.getSlotForItemId(logs), itemId: logs, option: "Deposit-1" });
        assert.equal(bank.getAmount(logs), initialBank + 1);
        assert.equal(bank.getAddableAmount(new core.Item(logs, 2)), mode === "room" ? 2 : headroom);
      } else {
        bank.open();
        assert.equal(Bank.isOpen(f.p), true);
      }
      const beforeBank = bank.getAmount(logs), beforeStored = Storage.amountOf(f.p, basketFamily, logs);
      const ops = [], emit = PM.emitCustomEvent.bind(PM);
      t.mock.method(PM, "emitCustomEvent", (name, event) => {
        const result = emit(name, event);
        if (name === Bank.INVENTORY_OP_EVENT && event.player === f.p && event.op === 9) {
          ops.push({ item: event.item === basket, handled: event.handled });
        }
        return result;
      });
      const beforeMessages = f.messages.length;
      await send({ type: "widget_action", widgetId: (Bank.SIDE_INTERFACE_ID << 16) | 3,
        groupId: Bank.SIDE_INTERFACE_ID, childId: 3, buttonNum: 9,
        slot: f.inv.getItems().indexOf(basket), itemId: basketId, option: "Empty" });
      assert.deepEqual(ops, [{ item: true, handled: true }]);
      const afterBank = bank.getAmount(logs), afterStored = Storage.amountOf(f.p, basketFamily, logs);
      assert.equal(afterBank + afterStored + f.inv.getAmount(logs), beforeBank + beforeStored);
      const moved = mode === "empty" || mode.startsWith("full") ? 0 : mode.startsWith("near") ? 1 : 2;
      assert.equal(afterBank - beforeBank, moved);
      assert.equal(afterStored, beforeStored - moved);
      assert.equal(f.inv.getAmount(basketId), 1);
      const expected = mode === "empty" ? "Your basket is empty."
        : mode.startsWith("near") ? "You empty some of your basket's contents into the bank."
        : mode.startsWith("full") ? "Your bank cannot hold the remaining contents of your basket."
        : "You empty your basket into the bank.";
      assert.deepEqual(f.messages.slice(beforeMessages), [expected]);
    });
  }
});

test("tackle box inventory withdrawals conserve bait at stack limits", async (t) => {
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const TackleBox = require("../plugins/items/storage/TackleBox.StorageItems");
  const tackle = Storage.FAMILIES.get("tackle-box");
  const boxId = core.CacheDefinitions.getObjId("tackle_box"), feather = I.FEATHER;
  const mainId = core.CacheDefinitions.getInterfaceId("tackle_box_main");
  const sideId = core.CacheDefinitions.getInterfaceId("tackle_box_side");
  const inventoryWidget = core.CacheDefinitions.getComponentId("inventory:items");
  const grid = core.CacheDefinitions.getComponentId("tackle_box_main:items");
  const allButton = core.CacheDefinitions.getComponentId("tackle_box_main:all");
  const quantityVarbit = core.CacheDefinitions.getVarbitId("ii_elnock_storage_selectedquantity");
  const containerId = core.CacheDefinitions.getInventoryId("tackle_box");
  assert.equal(containerId, 651);
  assert.equal(boxId, I.TACKLE_BOX);
  assert.equal(core.CacheDefinitions.getItem(boxId).name, TackleBox.NAME);
  assert.equal(core.CacheDefinitions.getObjId("feather"), feather);
  assert.equal(core.ItemDefinition.forId(feather).isStackable(), true);
  assert.equal(core.ItemDefinition.forId(feather).isNoted(), false);
  assert.ok(tackle && tackle.accepts(feather) && TackleBox.baitIds().has(feather));
  assert.equal(mainId, 683); assert.equal(sideId, 684);
  assert.equal(grid, (mainId << 16) | 11); assert.equal(allButton, (mainId << 16) | 7);
  assert.equal(quantityVarbit, 11795);
  for (const route of ["selected All", "inventory Empty"]) {
    for (const mode of ["room", "exact", "near", "full"]) {
      await t.test(`${route} with ${mode} headroom`, async (t) => {
        const f = actor(t, HOME, false), p = f.p, sender = p.getPacketSender();
        assert.ok(p.getUsername().length <= 12);
        p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
        assert.notEqual(p.getLongUsername(), 0n);
        assert.equal(p.isRegistered(), true);
        assert.equal(p.isNeedsPlacement(), false);
        assert.equal(p.getLocation().getZ(), 0);
        assert.equal(p.getPrivateArea(), null);
        const send = async (packet) => { await f.c.dispatch([packet]); f.c.processTurnPackets(); };
        const initialGround = new Set(core.World.getItems());
        t.after(() => {
          p.closeInterruptibleInterfaces();
          for (const ground of [...core.World.getItems()]) {
            if (!initialGround.has(ground) && ground.getOwner() === p.getUsername()) {
              core.ItemOnGroundManager.deregister(ground);
              const index = core.World.getItems().indexOf(ground);
              if (index >= 0) core.World.getItems().splice(index, 1);
            }
          }
        });
        f.inv.add(new core.Item(boxId), false).add(new core.Item(feather, 2), true);
        const box = f.inv.getItems()[f.inv.getSlotForItemId(boxId)];
        assert.equal(Storage.familyOf(box), tackle);
        assert.equal(Storage.amountOf(p, tackle, feather), 0);
        assert.equal(core.Bank.isOpen(p), false);
        const actions = [], clicks = [], emptied = [];
        const emitItem = PM.emitItemAction.bind(PM);
        t.mock.method(PM, "emitItemAction", (event) => {
          const result = emitItem(event);
          if (event.player === p && event.itemId === boxId)
            actions.push({ option: event.option, item: event.item === box, handled: event.handled });
          return result;
        });
        const emitClick = PM.emitInterfaceActionClick.bind(PM);
        t.mock.method(PM, "emitInterfaceActionClick", (event) => {
          const result = emitClick(event);
          if (event.player === p && event.groupId === mainId)
            clicks.push({ child: event.childId, slot: event.slot, action: event.action, handled: event.handled });
          return result;
        });
        const empty = Storage.emptyToInventory.bind(Storage);
        t.mock.method(Storage, "emptyToInventory", (player, family) => {
          if (player === p) emptied.push(
            family.key === tackle.key
            && Storage.attributeOf(family) === Storage.attributeOf(tackle)
            && Storage.FAMILIES.get(family.key) === tackle);
          return empty(player, family);
        });
        const gridFlags = [];
        const sendFlags = sender.sendInterfaceFlagsRange.bind(sender);
        t.mock.method(sender, "sendInterfaceFlagsRange", (...args) => {
          if (args[0] === grid) gridFlags.push(args);
          return sendFlags(...args);
        });
        let currentContainer;
        const sendScript = sender.sendInterfaceScript.bind(sender);
        t.mock.method(sender, "sendInterfaceScript", (...args) => {
          const result = sendScript(...args);
          if (args[4]?.[containerId]) currentContainer = args[4][containerId];
          return result;
        });
        const itemAction = async (option) => {
          const index = core.CacheDefinitions.getItem(boxId).inventoryActions.indexOf(option);
          assert.ok(index >= 0, "actual cache inventory action " + option);
          await send({ type: "inventory_action", widgetId: inventoryWidget,
            itemId: boxId, slot: f.inv.getItems().indexOf(box), option, optionIndex: index + 1 });
          assert.deepEqual(actions.at(-1), { option, item: true, handled: true });
        };
        await itemAction("Fill");
        assert.deepEqual(Storage.contents(p, tackle), [{ id: feather, amount: 2 }]);
        assert.deepEqual(p.getAttribute(Storage.attributeOf(tackle)), [[feather, 2]]);
        assert.equal(f.inv.getAmount(feather), 0, "real Fill moved both ordinary feathers into storage");
        const initial = mode === "room" ? 99 : MAX_STACK_AMOUNT - (mode === "exact" ? 3 : mode === "near" ? 2 : 1);
        f.inv.add(new core.Item(feather, initial), true);
        const featherStack = f.inv.getItems()[f.inv.getSlotForItemId(feather)];
        assert.equal(featherStack.isPresetItem(), false);
        assert.equal(featherStack.getMeta() ?? null, null);
        const ownedFloor = () => core.World.getItems().filter((ground) => !ground.isPendingRemoval()
          && ground.getOwner() === p.getUsername());
        const owned = (id) => f.inv.getAmount(id) + p.getEquipment().getAmount(id)
          + p.getBanks().reduce((sum, bank, tab) => sum
            + (bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0)
          + ownedFloor().reduce((sum, ground) => sum + (ground.getItem().getId() === id ? ground.getItem().getAmount() : 0), 0);
        const state = () => ({ owned: owned(feather), stored: [...Storage.FAMILIES.values()]
          .reduce((sum, target) => sum + Storage.amountOf(p, target, feather), 0), tackle: Storage.amountOf(p, tackle, feather),
          inventory: f.inv.getAmount(feather), floor: ownedFloor().filter((ground) => ground.getItem().getId() === feather)
            .reduce((sum, ground) => sum + ground.getItem().getAmount(), 0),
          headroom: f.inv.getAddableAmount(new core.Item(feather, 2)), freeSlots: f.inv.getFreeSlots() });
        const total = (value) => value.owned + value.stored;
        const pile = core.ItemOnGroundManager.registers(p, new core.Item(feather));
        assert.equal(pile.getPosition().equals(p.getLocation()), true);
        assert.equal(core.ItemOnGroundManager.canSee(p, pile), true);
        assert.equal(state().floor, 1);
        const beforeTake = state(), events = [];
        pickupEvents.set(p, events);
        assert.equal(p.getLastItemPickup().elapsedTime(300), true);
        await send({ type: "ground_item_action", itemId: feather, stackId: pile.getId(),
          x: p.getLocation().getX(), y: p.getLocation().getY(), option: "Take" });
        assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
        assert.equal(pile.isPendingRemoval(), true);
        assert.equal(state().floor, 0);
        assert.equal(total(state()), total(beforeTake));
        assert.equal(f.inv.getAmount(feather), initial + 1);
        assert.equal(featherStack.getMeta() ?? null, null);
        assert.equal(f.inv.getItems().includes(box), true);
        assert.equal(Storage.amountOf(p, tackle, feather), 2);
        const xp = () => core.Skill.values().map((skill) => p.getSkillManager().getExperience(skill));
        const items = (container) => container.getValidItems().filter((entry) => entry.getId() !== feather)
          .map((entry) => [entry.getId(), entry.getAmount(), JSON.stringify(entry.getMeta() ?? null)]);
        const other = () => ({ inventory: items(f.inv), equipment: items(p.getEquipment()),
          banks: p.getBanks().map((bank, tab) => bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? items(bank) : null),
          floor: ownedFloor().filter((ground) => ground.getItem().getId() !== feather)
            .map((ground) => [ground.getItem().getId(), ground.getItem().getAmount()]),
          stored: [...Storage.FAMILIES.values()].map((target) => [target.key,
            Storage.contents(p, target).filter((entry) => entry.id !== feather)]) });
        const before = state(), beforeOther = other(), beforeXp = xp();
        assert.equal(before.stored, 2); assert.equal(before.tackle, 2);
        assert.equal(before.freeSlots, 26);
        assert.equal(before.headroom, mode === "near" ? 1 : mode === "full" ? 0 : 2);
        assert.equal(core.Bank.isOpen(p), false);
        if (route === "selected All") {
          await itemAction("View");
          assert.equal(p.getInterfaceId(), mainId);
          const main = sender.subInterfaceTargets.get(mainId), side = sender.subInterfaceTargets.get(sideId);
          assert.ok(main && side && Object.isFrozen(main) && Object.isFrozen(side));
          assert.equal(main.type, 0); assert.equal(side.type, 3);
          assert.equal(sender.getSubInterfaceAt(main.targetUid), main);
          assert.equal(sender.getSubInterfaceAt(side.targetUid), side);
          assert.ok(currentContainer && currentContainer.capacity === TackleBox.CAPACITY);
          assert.equal(gridFlags.length, 1);
          assert.deepEqual(gridFlags[0].slice(0, 3), [grid, 0, TackleBox.CAPACITY - 1]);
          assert.equal((gridFlags[0][3] & (1 << 1)) !== 0, true, "current main grid enables op1");
          const rendered = currentContainer;
          assert.deepEqual(rendered.slots[0], { slot: 0, itemId: feather, quantity: 2 });
          assert.equal(rendered.slots.slice(1).every((slot) => slot.itemId === -1 && slot.quantity === 0), true);
          const selected = Storage.contents(p, tackle)[0];
          assert.deepEqual(selected, { id: feather, amount: 2 });
          await send({ type: "widget_action", widgetId: allButton, groupId: mainId,
            childId: allButton & 0xffff, buttonNum: 1 });
          assert.equal(sender.getVarbit(quantityVarbit), 2);
          assert.equal(p.getAttribute("storage-items:tackle-box-quantity"), 2);
          assert.equal(currentContainer, rendered);
          assert.equal(sender.getSubInterfaceAt(main.targetUid), main);
          assert.deepEqual(Storage.contents(p, tackle)[0], selected);
          const start = clicks.length;
          await send({ type: "widget_action", widgetId: grid, groupId: mainId,
            childId: grid & 0xffff, buttonNum: 1, slot: 0, itemId: feather });
          assert.deepEqual(clicks.slice(start), [{ child: 11, slot: 0, action: 1, handled: true }]);
          assert.deepEqual(emptied, []);
        } else {
          const start = actions.length;
          await itemAction("Empty");
          assert.deepEqual(actions.slice(start), [{ option: "Empty", item: true, handled: true }]);
          assert.deepEqual(emptied, [true], "ordinary Empty reached the real inventory consumer once");
        }
        const after = state();
        assert.equal(total(after), total(before), "stored and all owned feathers remain conserved: "
          + JSON.stringify({ route, mode, before, after }));
        assert.ok(after.tackle >= 0 && after.tackle <= 2);
        assert.equal(after.owned - before.owned, before.stored - after.stored);
        if (mode === "room" || mode === "exact") {
          assert.equal(after.tackle, 0);
          assert.equal(after.inventory, before.inventory + 2);
        }
        assert.equal(owned(boxId), 1);
        assert.equal(f.inv.getItems().includes(box), true);
        assert.deepEqual(other(), beforeOther);
        assert.deepEqual(xp(), beforeXp);
      });
    }
  }
});


test("inventory withdrawal capacity respects preset metadata", async (t) => {
  const { Presetable } = require("../dist/game/content/presets/Presetable");
  const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
  if (!Presets.isEnabled()) {
    t.skip("preset items are unavailable when PvP mode is disabled");
    return;
  }
  for (const freeSlots of [0, 1]) {
    await t.test(`${freeSlots} free slots with a marked same-id stack`, (t) => {
      const f = actor(t, HOME, false);
      const rune = I.FIRE_RUNE;
      assert.equal(core.ItemDefinition.forId(rune).isStackable(), true);
      assert.equal(core.ItemDefinition.forId(I.RAKE).isStackable(), false);
      assert.equal(Presets.isEnabled(), true);
      const preset = new Presetable("room", [new core.Item(rune, 10)], [],
        [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
      assert.equal(Presets.applyPreset(f.p, preset), true);
      const tagged = f.inv.getValidItems().find((held) => held.getId() === rune);
      assert.ok(tagged);
      assert.equal(tagged.getAmount(), 10);
      assert.equal(tagged.getMetaValue(core.Item.PRESET_META), true);
      assert.equal(tagged.getMetaValue(core.Item.UNTRADEABLE_META), true);
      assert.equal(tagged.getMetaValue(core.Item.UNBANKABLE_META), true);
      const markedMeta = JSON.stringify(tagged.getMeta());
      const fill = f.inv.getFreeSlots() - freeSlots;
      for (let i = 0; i < fill; i++) f.inv.add(new core.Item(I.RAKE), false);
      assert.equal(f.inv.getFreeSlots(), freeSlots);
      const room = Storage.inventoryRoom(f.p, rune);
      assert.equal(room, freeSlots ? MAX_STACK_AMOUNT : 0);
      if (freeSlots) {
        f.inv.add(new core.Item(rune, 2), false);
        const plain = f.inv.getValidItems().find((held) => held.getId() === rune && held.getMeta() === null);
        assert.ok(plain);
        assert.equal(plain.getAmount(), 2);
      }
      assert.equal(tagged.getAmount(), 10);
      assert.equal(JSON.stringify(tagged.getMeta()), markedMeta);
    });
  }
});
