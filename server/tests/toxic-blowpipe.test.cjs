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
const ToxicBlowpipe = require("../plugins/items/ToxicBlowpipe.plugin");

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
  const hooks = { actions: null, confirm: null, buttonId: -1 };
  const api = new Proxy({}, {
    get: (_, name) => {
      if (name === "core") return require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
      if (name === "onItemAction") return (itemName, actions) => {
        hooks.itemName = itemName;
        hooks.actions = actions;
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
  const slots = items.slice();
  while (slots.length < 28) slots.push(null);
  const idOf = (entry) => (entry && (entry.getId ? entry.getId() : entry.id)) ?? -1;
  return {
    slots,
    getItems: () => slots,
    getFreeSlots: () => slots.filter((entry) => !entry).length,
    contains: (itemId) => slots.some((entry) => entry && idOf(entry) === itemId),
    add: (item, stack) => {
      const at = stack ? slots.findIndex((entry) => entry && idOf(entry) === item.getId()) : -1;
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
  assert.equal(hooks.buttonId, 584 << 16);
});
