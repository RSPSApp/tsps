// Run after `yarn build`: node --test tests/toxic-blowpipe.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Item } = require("../dist/game/model/Item");
const ToxicBlowpipe = require("../plugins/items/ToxicBlowpipe.plugin");
const DestroyItem = require("../plugins/interface/DestroyItem.plugin");
const { PacketSender } = require("../dist/net/packet/PacketSender");

const TOXIC_BLOWPIPE_ID = 12926;
const TOXIC_BLOWPIPE_EMPTY_ID = 12924;
const IRON_DART = ItemIdentifiers.IRON_DART;
const DRAGON_DART = ItemIdentifiers.DRAGON_DART;
const ZULRAHS_SCALES = ItemIdentifiers.ZULRAHS_SCALES;

before(async () => CachePipeline.initialize(path.resolve(__dirname, "..")));

/** The plugin's combat method for a player holding the blowpipe, from its resolver. */
function blowpipeMethod(player) {
  let resolver = null;
  const api = new Proxy({}, {
    get: (_, name) => {
      if (name === "core") return require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
      if (name === "registerCombatMethodResolver") return (entry) => { resolver = entry; };
      if (name === "getBonusManager" || name === "getCombatFactory") return () => ({});
      return () => {};
    },
  });
  ToxicBlowpipe.register(api);
  return resolver.resolve(player);
}

function holding(x, y) {
  const weapon = { getId: () => TOXIC_BLOWPIPE_ID };
  const items = [];
  items[Equipment.WEAPON_SLOT] = weapon;
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    isSpecialActivated: () => false,
    getLocation: () => new Location(x, y, 0),
    getWeapon: () => WeaponInterfaces.BLOWPIPE,
    getEquipment: () => ({ get: (slot) => items[slot] ?? null, getItems: () => items }),
  };
  return player;
}

test("blowpipe hits land 1 + distance / 6 ticks after the attack (Wiki: Hit delay)", (t) => {
  // Only the delay is under test: no damage roll, which needs a whole player and target.
  t.mock.method(PendingHit.prototype, "prepareHits", () => []);
  for (const [distance, ticks] of [[1, 1], [5, 1], [6, 2], [7, 2]]) {
    const player = holding(3200, 3200);
    const target = { getLocation: () => new Location(3200 + distance, 3200, 0) };
    const hits = blowpipeMethod(player).hits(player, target);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].getDelay(), ticks, `distance ${distance}`);
  }
});

// Captured blowpipe casts at Vorkath (size 7, south-west tile 2269,4062), rsprox 3279 (rev 234): the Drygore blowpipe's
// ordinary attack, steel_dart_travel (228) at starttime 32, ending 32 + 5 a tile of the distance to the NEAREST tile.
// The shooter at 2278,4064 is 3 tiles from Vorkath's edge and 9 from its south-west tile (end 47, not 77); at
// 2280,4066 it is 5 and 11 (57); at 2276,4068 it is 1 and 7 (37). The Drygore blowpipe is the Leagues variant, not
// the Toxic blowpipe; the projectile ids, profile and formulas are the same ones (rsprox has no Toxic blowpipe cast).
const VORKATH = { x: 2269, y: 4062, size: 7 };
const vorkath = () => ({ getLocation: () => new Location(VORKATH.x, VORKATH.y, 0), getSize: () => VORKATH.size });

test("blowpipe hits land by the target's nearest tile: 1 + distance / 6 ticks (Wiki: Hit delay; rsprox 3279)", (t) => {
  t.mock.method(PendingHit.prototype, "prepareHits", () => []);
  // From 2278,4064 the edge is 3 tiles away (1 tick); the south-west tile, 9 away, would give 2.
  const near = holding(2278, 4064);
  assert.equal(blowpipeMethod(near).hits(near, vorkath())[0].getDelay(), 1);
  // 5 from the edge (1 tick), 11 from the south-west tile (2).
  const mid = holding(2280, 4066);
  assert.equal(blowpipeMethod(mid).hits(mid, vorkath())[0].getDelay(), 1);
  // A one-tile target is unchanged: 7 tiles is 2 ticks.
  const small = holding(3200, 3200);
  assert.equal(blowpipeMethod(small).hits(small, { getLocation: () => new Location(3207, 3200, 0) })[0].getDelay(), 2);
});

test("blowpipe darts fly 32 + 5 a tile of the nearest-tile distance, ending with the hit (rsprox 3279)", () => {
  const { dartShot } = ToxicBlowpipe._test;
  for (const [x, y, end] of [[2278, 4064, 47], [2280, 4066, 57], [2276, 4068, 37]]) {
    const player = holding(x, y);
    const shot = dartShot(player, vorkath(), 228);
    assert.equal(shot.end, end, `from ${x},${y}`);
    assert.deepEqual([shot.id, shot.delay, shot.startHeight, shot.endHeight], [228, 32, 35.5, 36.5], "the captured delay and heights (142 and 146 sent)");
  }
  const small = holding(3200, 3200);
  assert.equal(dartShot(small, { getLocation: () => new Location(3205, 3200, 0) }, 228).end, 32 + 5 * 5, "a one-tile target is unchanged");
});

test("blowpipe attack speed applies the Rapid style reduction in PvM and PvP", () => {
  for (const [againstPlayer, rapid, expected] of [
    [false, false, 3],
    [false, true, 2],
    [true, false, 4],
    [true, true, 3],
  ]) {
    const player = holding(3200, 3200);
    const target = { isPlayer: () => againstPlayer };
    player.getCombat = () => ({ getTarget: () => target });
    player.getFightType = () => ({ isRapid: () => rapid });
    assert.equal(blowpipeMethod(player).attackSpeed(player), expected,
      `${againstPlayer ? "PvP" : "PvM"} ${rapid ? "Rapid" : "non-Rapid"}`);
  }
});

/** The plugin's name-keyed item actions and the confirmdestroy button, as registered. */
function registeredHooks() {
  const hooks = { actions: null, actionsByItem: new Map(), confirm: null, buttonId: -1 };
  const api = new Proxy({}, {
    get: (_, name) => {
      if (name === "core") return require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
      if (name === "onItemAction") return (itemName, actions) => {
        hooks.actionsByItem.set(itemName, actions);
        if (itemName === "Toxic blowpipe") {
          hooks.itemName = itemName;
          hooks.actions = actions;
        }
      };
      if (name === "onInterfaceActionButton") return (buttonId, handler) => {
        hooks.buttonId = buttonId;
        hooks.confirm = handler;
      };
      return () => {};
    },
  });
  ToxicBlowpipe.register(api);
  return hooks;
}

function loadedPipe(scales, dartId, dartAmount) {
  const meta = new Map([["toxic-blowpipe", { scales, dartId, dartAmount }]]);
  let id = TOXIC_BLOWPIPE_ID;
  return {
    getId: () => id,
    setId: (next) => { id = next; },
    getAmount: () => 1,
    getMetaValue: (key) => meta.get(key),
    setMetaValue: (key, value) => (value === undefined ? meta.delete(key) : meta.set(key, value)),
    state: () => ({ ...meta.get("toxic-blowpipe") }),
  };
}

function fakeInventory(items) {
  // Real Items, so metadata matching matches ItemContainer.add.
  const slots = items.map((entry) =>
    entry && typeof entry.getId === "function" ? entry : entry ? new Item(entry.id, entry.amount ?? 1, entry.meta ?? null) : null,
  );
  while (slots.length < 28) slots.push(null);
  const removed = [];
  const idOf = (entry) => (entry && (entry.getId ? entry.getId() : entry.id)) ?? -1;
  const metaOf = (entry) => JSON.stringify((entry && entry.getMeta ? entry.getMeta() : entry?.meta) ?? null);
  return {
    slots,
    removed,
    getItems: () => slots,
    getFreeSlots: () => slots.filter((entry) => !entry).length,
    contains: (itemId) => slots.some((entry) => entry && idOf(entry) === itemId),
    getAddableAmount: (item) => {
      if (slots.some((entry) => entry && idOf(entry) === item.getId() && metaOf(entry) === metaOf(item))) return item.getAmount();
      return slots.some((entry) => !entry) ? item.getAmount() : 0;
    },
    deleteAtSlot: (slot, amount) => {
      removed.push({ slot, itemId: idOf(slots[slot]), amount });
      slots[slot] = null;
    },
    add: (item, stack) => {
      const at = stack ? slots.findIndex((entry) => entry && idOf(entry) === item.getId() && metaOf(entry) === metaOf(item)) : -1;
      if (at >= 0) {
        slots[at] = { id: item.getId(), amount: (slots[at].amount ?? 1) + item.getAmount() };
        return;
      }
      slots[slots.findIndex((entry) => !entry)] = { id: item.getId(), amount: item.getAmount() };
    },
    refreshItems: () => {},
  };
}

function pipePlayer(pipe, extra = []) {
  const messages = [];
  const scripts = [];
  const inventory = fakeInventory([pipe, ...extra]);
  const packetSender = {
    sendChatboxInterface: () => packetSender,
    sendClientScript: (...args) => { scripts.push(args); return packetSender; },
    isChatboxInterface: () => true,
    sendInterfaceRemoval: () => {},
  };
  return {
    messages,
    scripts,
    inventory,
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getWeapon: () => -1,
    getUpdateFlag: () => ({ flag: () => {} }),
    getBonusManager: () => ({ attackBonus: [], defenceBonus: [], otherBonus: [] }),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => packetSender,
  };
}

test("Check prints live's darts and scales line (rsprox 1637)", () => {
  const hooks = registeredHooks();
  const pipe = loadedPipe(794, IRON_DART, 1687);
  const player = pipePlayer(pipe);
  assert.equal(hooks.actions.Check({ player, item: pipe, slot: 0 }), true);
  assert.deepEqual(player.messages, [
    "Darts: <col=007f00>Iron dart x 1,687</col>. Scales: <col=007f00>794 (4.8%)</col>.",
  ]);
});

test("Unload returns every dart and keeps the loaded scales", () => {
  const hooks = registeredHooks();
  const pipe = loadedPipe(5000, DRAGON_DART, 120);
  const player = pipePlayer(pipe);
  assert.equal(hooks.actions.Unload({ player, item: pipe, slot: 0 }), true);
  // rsprox 1862: the native "Are you sure you want to uncharge it?" prompt comes first.
  assert.equal(player.scripts[0][0], 814);
  assert.equal(player.scripts[0][3], "Are you sure you want to uncharge it?");
  assert.equal(hooks.confirm({ player, action: 1 }), true);
  assert.equal(pipe.getId(), TOXIC_BLOWPIPE_ID);
  assert.deepEqual(pipe.state(), { scales: 5000, dartId: -1, dartAmount: 0 });
  assert.equal(player.inventory.contains(DRAGON_DART), true);
  assert.equal(player.inventory.contains(ZULRAHS_SCALES), false);
});

test("Uncharge returns the scales and darts and empties the pipe", () => {
  const hooks = registeredHooks();
  const pipe = loadedPipe(5000, DRAGON_DART, 120);
  const player = pipePlayer(pipe);
  assert.equal(hooks.actions.Uncharge({ player, item: pipe, slot: 0 }), true);
  assert.equal(hooks.confirm({ player, action: 1 }), true);
  assert.equal(pipe.getId(), TOXIC_BLOWPIPE_EMPTY_ID);
  assert.equal(player.inventory.contains(DRAGON_DART), true);
  assert.equal(player.inventory.contains(ZULRAHS_SCALES), true);
});

test("Unload refuses before the prompt when the darts need a slot", () => {
  const hooks = registeredHooks();
  const pipe = loadedPipe(100, DRAGON_DART, 120);
  const filler = Array.from({ length: 27 }, () => ({ id: 1, amount: 1 }));
  const player = pipePlayer(pipe, filler);
  assert.equal(player.inventory.getFreeSlots(), 0);
  assert.equal(hooks.actions.Unload({ player, item: pipe, slot: 0 }), true);
  assert.deepEqual(player.messages, ["You don't have enough free inventory space to do that."]);
  assert.equal(player.scripts.length, 0);
});

test("only the pipe's cache options are hooked, so right-click Wield cannot unload it", () => {
  const hooks = registeredHooks();
  assert.equal(hooks.itemName, "Toxic blowpipe");
  assert.deepEqual(Object.keys(hooks.actions).sort(), ["Check", "Uncharge", "Unload"]);
  assert.deepEqual([...hooks.actionsByItem.keys()].sort(), [
    "Blazing blowpipe",
    "Blazing blowpipe (empty)",
    "Toxic blowpipe",
    "Toxic blowpipe (empty)",
  ]);
  for (const actions of hooks.actionsByItem.values()) {
    assert.deepEqual(Object.keys(actions).sort(), ["Check", "Uncharge", "Unload"]);
  }
  assert.equal(hooks.buttonId, 584 << 16);
});

/**
 * DestroyItem and ToxicBlowpipe, registered in PluginManager's order (DestroyItem first), with
 * the manager's stop-at-first-handler dispatch for the shared confirmdestroy button.
 */
function confirmPlugins() {
  const buttons = [];
  const customEvents = new Map();
  const dropPolicies = [];
  let actions = null;
  const api = new Proxy({}, {
    get: (_, name) => {
      if (name === "core") return require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
      if (name === "onItemAction") return (_, registered) => { actions = registered; };
      if (name === "onInterfaceActionButton") return (buttonId, handler) => buttons.push({ buttonId, handler });
      if (name === "onCustomEvent") return (event, handler) => {
        customEvents.set(event, [...(customEvents.get(event) ?? []), handler]);
      };
      if (name === "emitCustomEvent") return (event, payload) => {
        for (const handler of customEvents.get(event) ?? []) handler(payload);
      };
      if (name === "onItemDropPolicy") return (handler) => dropPolicies.push(handler);
      return () => {};
    },
  });
  DestroyItem.register(api);
  ToxicBlowpipe.register(api);
  return {
    actions: () => actions,
    drop: (event) => {
      for (const policy of dropPolicies) {
        policy(event);
        if (event.handled) break;
      }
      return event;
    },
    pressConfirm: (player, action) => {
      const event = { player, action, buttonId: 584 << 16, handled: false };
      for (const hook of buttons) {
        if (event.handled || hook.buttonId !== event.buttonId) continue;
        if (hook.handler(event) !== false) event.handled = true;
      }
      return event.handled;
    },
  };
}

/** A player whose PacketSender is real, so sendInterfaceRemoval resets DestroyItem's own state. */
function confirmPlayer(pipe, extra = []) {
  const attributes = new Map();
  const messages = [];
  const inventory = fakeInventory([pipe, ...extra]);
  const player = {
    inventory,
    messages,
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getWeapon: () => -1,
    getUpdateFlag: () => ({ flag: () => {} }),
    getBonusManager: () => ({ attackBonus: [], defenceBonus: [], otherBonus: [] }),
    sendMessage: (message) => messages.push(message),
    getAttribute: (key) => attributes.get(key) ?? -1,
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => -1,
    setInterfaceId: () => {},
    setStatus: () => {},
    getEnteredAmountAction: () => null,
    setEnteredAmountAction: () => {},
    setEnteredSyntaxAction: () => {},
    getDialogueManager: () => ({ reset: () => {} }),
    setCreationMenu: () => {},
    setSearchingBank: () => {},
    setTeleportInterfaceOpen: () => {},
    getAppearance: () => ({ setCanChangeAppearance: () => {} }),
    getFrameUpdater: () => ({ clearGroup: () => {} }),
    getSession: () => ({ sendClientPacket: () => true }),
  };
  const sender = new PacketSender(player);
  player.getPacketSender = () => sender;
  return player;
}

for (const action of ["Unload", "Uncharge"]) {
  test(`${action} answers its own prompt after Destroy, so Yes cannot destroy the item Destroy named`, () => {
    const hooks = confirmPlugins();
    const pipe = loadedPipe(5000, DRAGON_DART, 120);
    const mineral = { id: 21341, amount: 1, getId: () => 21341, getAmount: () => 1, isDropable: () => false };
    mineral.clone = () => mineral;
    const player = confirmPlayer(pipe, [mineral]);

    // Open Destroy on the unrelated untradeable, then choose the pipe's option without answering it.
    hooks.drop({ player, item: mineral, itemId: 21341, slot: 1, dropToGround: false, handled: false });
    assert.equal(player.getAttribute("destroy-item:pending"), 21341, "Destroy owns the prompt");
    assert.equal(hooks.actions()[action]({ player, item: pipe, slot: 0 }), true);

    // Yes goes to DestroyItem first, as registered; it must no longer have a pending item.
    assert.equal(hooks.pressConfirm(player, 1), true);
    assert.deepEqual(player.inventory.removed, [], "the mineral is not destroyed");
    assert.equal(player.inventory.contains(21341), true);
    assert.equal(player.inventory.contains(DRAGON_DART), true, "the pipe's darts are returned");
    assert.equal(pipe.getId(), action === "Unload" ? TOXIC_BLOWPIPE_ID : TOXIC_BLOWPIPE_EMPTY_ID);
    assert.equal(pipe.state().scales ?? 0, action === "Unload" ? 5000 : 0);
  });
}

for (const action of ["Unload", "Uncharge"]) {
  test(`${action} re-checks space at Yes, so gear unequipped into the last slot keeps the pipe loaded`, () => {
    const hooks = confirmPlugins();
    const pipe = loadedPipe(100, DRAGON_DART, 120);
    // Unload returns the darts; Uncharge returns the scales too, so it needs one more slot.
    const slotsNeeded = action === "Unload" ? 1 : 2;
    const filler = Array.from({ length: 27 - slotsNeeded }, (_, index) => ({ id: 1000 + index, amount: 1 }));
    const player = confirmPlayer(pipe, filler);
    assert.equal(player.inventory.getFreeSlots(), slotsNeeded);

    assert.equal(hooks.actions()[action]({ player, item: pipe, slot: 0 }), true);
    // Unequipping into the last free slot is a widget action, which leaves the prompt open.
    for (let i = 0; i < slotsNeeded; i++) {
      const free = player.inventory.getItems().findIndex((entry) => !entry);
      player.inventory.getItems()[free] = new Item(21018 + i, 1);
    }
    assert.equal(player.inventory.getFreeSlots(), 0);

    assert.equal(hooks.pressConfirm(player, 1), true);
    assert.deepEqual(player.messages, ["You don't have enough free inventory space to do that."]);
    assert.deepEqual(pipe.state(), { scales: 100, dartId: DRAGON_DART, dartAmount: 120 }, "nothing leaves the pipe");
    assert.equal(pipe.getId(), TOXIC_BLOWPIPE_ID);
    assert.equal(player.inventory.contains(DRAGON_DART), false);
    assert.equal(player.inventory.contains(ZULRAHS_SCALES), false);
  });
}

/** A custom-preset stack: the same dart id, but its metadata stops ItemContainer.add merging. */
function presetDarts(amount) {
  return new Item(DRAGON_DART, amount, { untradeable: true, unbankable: true, preset: true });
}

test("Uncharge refuses with preset darts and one free slot, because the two returns cannot merge", () => {
  const hooks = confirmPlugins();
  const pipe = loadedPipe(5000, DRAGON_DART, 120);
  // pipe + 75 preset darts + 25 fillers = 27 slots, one free. contains(DRAGON_DART) is true,
  // but the returned ordinary darts need their own slot beside the preset stack.
  const filler = Array.from({ length: 25 }, (_, index) => new Item(1000 + index, 1));
  const player = confirmPlayer(pipe, [presetDarts(75), ...filler]);
  assert.equal(player.inventory.getFreeSlots(), 1);

  assert.equal(hooks.actions().Uncharge({ player, item: pipe, slot: 0 }), true);
  assert.deepEqual(player.messages, ["You don't have enough free inventory space to do that."]);
  // No prompt was opened, so Yes answers nothing.
  assert.equal(hooks.pressConfirm(player, 1), false);
  assert.deepEqual(pipe.state(), { scales: 5000, dartId: DRAGON_DART, dartAmount: 120 }, "nothing leaves the pipe");
  assert.equal(pipe.getId(), TOXIC_BLOWPIPE_ID);
  assert.equal(player.inventory.getItems()[1].getAmount(), 75, "the preset stack is untouched");
  assert.equal(player.inventory.contains(ZULRAHS_SCALES), false);
});

test("Uncharge re-checks metadata at Yes, so preset darts arriving in the last slot keep the pipe loaded", () => {
  const hooks = confirmPlugins();
  const pipe = loadedPipe(5000, DRAGON_DART, 120);
  // Two free slots for the scales and the darts at open time.
  const filler = Array.from({ length: 25 }, (_, index) => new Item(1000 + index, 1));
  const player = confirmPlayer(pipe, filler);
  assert.equal(player.inventory.getFreeSlots(), 2);

  assert.equal(hooks.actions().Uncharge({ player, item: pipe, slot: 0 }), true);
  // A preset dart stack lands in one free slot while the prompt is open: the id matches the
  // darts to return, the metadata does not, so both stacks still need their own slot.
  const free = player.inventory.getItems().findIndex((entry) => !entry);
  player.inventory.getItems()[free] = presetDarts(75);
  assert.equal(player.inventory.getFreeSlots(), 1);

  assert.equal(hooks.pressConfirm(player, 1), true);
  assert.deepEqual(player.messages, ["You don't have enough free inventory space to do that."]);
  assert.deepEqual(pipe.state(), { scales: 5000, dartId: DRAGON_DART, dartAmount: 120 }, "nothing leaves the pipe");
  assert.equal(pipe.getId(), TOXIC_BLOWPIPE_ID);
  assert.equal(player.inventory.getItems()[free].getAmount(), 75, "the preset stack is untouched");
  assert.equal(player.inventory.contains(ZULRAHS_SCALES), false);
});

// Exercise selected-instance confirmation with real inventory and the native drag listener.
test("blowpipe confirmation never redirects to another same-id pipe after inventory drag", async (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { HeadlessBinaryChannel } = require("../dist/net/BinaryChannel");
  const { Inventory } = require("../dist/game/model/container/impl/Inventory");
  const { SwitchItemSlotPacketListener } = require("../dist/net/packet/impl/SwitchItemSlotPacketListener");
  const { TaskManager } = require("../dist/game/task/TaskManager");
  const core = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
  const actions = new Map();
  let confirm, charge;
  const api = new Proxy({}, { get: (_, name) => {
    if (name === "core") return core;
    if (name === "onItemAction") return (name, registered) => { actions.set(name, registered); };
    if (name === "onInterfaceActionButton") return (_id, handler) => { confirm = handler; };
    if (name === "onItemOnItem") return handler => { charge = handler; };
    return () => {};
  } });
  ToxicBlowpipe.register(api);
  const state = pipe => ToxicBlowpipe._test.BlowpipeState.read(pipe);
  function actor() {
    const channel = new HeadlessBinaryChannel();
    const session = new PlayerSession(channel);
    const p = new Player(session, new Location(3222, 3218, 0));
    session.setPlayer(p);
    t.after(() => { TaskManager.cancelTasks(p); TaskManager.cancelTasks(p.getIndex()); });
    assert.ok(p.getHitpoints() > 0, "ordinary live actor required by native drag");
    return p;
  }
  function produce(p, slot, scales, darts, variant) {
    const inv = p.getInventory();
    inv.setItem(slot, new Item(variant.emptyId));
    const pipe = inv.getItems()[slot];
    for (const [id, amount] of [[ZULRAHS_SCALES, scales], [DRAGON_DART, darts]]) {
      inv.setItem(26, new Item(id, amount));
      const event = { player:p, usedItemId:pipe.getId(), usedItemSlot:slot, usedItem:pipe,
        usedWithItemId:id, usedWithItemSlot:26, usedWithItem:inv.getItems()[26], handled:false };
      charge(event);
      assert.equal(event.handled, true, "native registered charge producer accepted");
      assert.equal(inv.getAmount(id), 0, "charge materials debited");
    }
    assert.deepEqual(state(pipe), {scales, dartId:DRAGON_DART, dartAmount:darts});
    assert.equal(pipe.getId(), variant.chargedId, "charging retains the selected variant");
    return pipe;
  }
  const variants = [
    { name: "Toxic blowpipe", emptyId: TOXIC_BLOWPIPE_EMPTY_ID, chargedId: TOXIC_BLOWPIPE_ID },
    { name: "Blazing blowpipe", emptyId: core.ItemIdentifiers.BLAZING_BLOWPIPE_EMPTY_, chargedId: core.ItemIdentifiers.BLAZING_BLOWPIPE },
  ];
  for (const variant of variants) {
    for (const action of ["Unload", "Uncharge"]) {
      for (const mode of ["stationary", "full", "swap"]) {
        await t.test(`${variant.name}: ${action}: ${mode}`, () => {
          const p = actor(), inv = p.getInventory();
          const selected = produce(p, 0, 100, 120, variant), other = produce(p, 1, 200, 240, variant);
          const beforeSelected = state(selected), beforeOther = state(other);
          const xp = p.getSkillManager().getExperience(core.Skill.RANGED);
          if (mode === "full") for (let slot=2;slot<28;slot++) inv.setItem(slot,new Item(995+slot,1));
          assert.equal(actions.get(variant.name)[action]({player:p,item:selected,slot:0}), true);
          if (mode === "full") {
            assert.equal(p.getPacketSender().isChatboxInterface(ToxicBlowpipe._test.CONFIRM_GROUP_ID), false, "full refund refuses before prompt");
          } else {
            assert.equal(p.getPacketSender().isChatboxInterface(ToxicBlowpipe._test.CONFIRM_GROUP_ID), true, "selected pipe opened actual chatbox");
            if (mode === "swap") {
              SwitchItemSlotPacketListener.move(p, Inventory.INTERFACE_ID, 0, 1);
              assert.equal(inv.getItems()[0], other, "different lawful same-id instance occupies selected slot");
              assert.equal(inv.getItems()[1], selected);
              assert.equal(p.getPacketSender().isChatboxInterface(ToxicBlowpipe._test.CONFIRM_GROUP_ID), true, "ordinary native drag retains chatbox");
            }
            assert.equal(confirm({player:p,action:1}), true);
          }
          // Assert accounting before the selected-instance target, so a valid target fail has totals evidence.
          assert.equal(inv.getAmount(DRAGON_DART)+state(selected).dartAmount+state(other).dartAmount,360);
          assert.equal(inv.getAmount(ZULRAHS_SCALES)+state(selected).scales+state(other).scales,300);
          assert.equal(p.getSkillManager().getExperience(core.Skill.RANGED),xp);
          assert.deepEqual(state(other),beforeOther,"unselected instance must stay unchanged");
          if (mode !== "stationary") {
            assert.deepEqual(state(selected),beforeSelected,"full refusal or stale selection preserves original");
            assert.equal(inv.getAmount(DRAGON_DART),0);
            assert.equal(inv.getAmount(ZULRAHS_SCALES),0);
          } else {
            assert.equal(inv.getAmount(DRAGON_DART),120,"normal selected pipe refunds darts");
            assert.equal(state(selected).dartAmount,0);
            assert.equal(inv.getAmount(ZULRAHS_SCALES),action === "Uncharge" ? 100 : 0);
            assert.equal(state(selected).scales,action === "Uncharge" ? 0 : 100);
          }
        });
      }
    }
  }
});
