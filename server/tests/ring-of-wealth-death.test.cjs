// Run after `yarn build`: node --test tests/ring-of-wealth-death.test.cjs
// Wiki (Ring of wealth (i); Items Kept on Death): a ring of wealth (i) always loses its imbue on death, kept or not,
// and the imbue becomes 50,000 coins. To a player killer they are the killer's (an Ironman killer's go on the floor for
// the victim); any other death puts them with what it loses, the grave (or the floor without one). A PvM death used
// to put them straight on the floor every time. Real engine: every plugin loaded, real Players and the real
// PlayerDeathTask.dropItems.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

let core, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9850;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("row" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

/**
 * The victim dies at `at` to `killer` (null: PvM); skulled unless `kept`, so the ring is lost, else carried alone so
 * it is kept. Returns the coins put on the floor directly, what the death passed on to the grave hooks, and what it kept.
 */
function die(t, victim, killer, at, { kept = false } = {}) {
  victim.setLocation(at);
  killer?.setLocation(at);
  if (!kept) core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const coins = [], drops = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    drops.push([owner, item.getId(), item.getAmount()]);
    if (item.getId() === I.COINS) coins.push([owner?.getUsername?.(), item.getAmount()]);
    return register.call(core.ItemOnGroundManager, owner, item, location, ...rest);
  });
  const lost = [];
  const emitDrops = PM.emitPlayerDeathDrops;
  t.mock.method(PM, "emitPlayerDeathDrops", (event) => {
    // Record both lists passed to the grave hooks, including untradeable imbued forms.
    lost.push(...[...event.items, ...event.untradeables].map((item) => [item.getId(), item.getAmount()]));
    return emitDrops.call(PM, event);
  });
  const keptItems = PlayerDeathTask.dropItems(victim, killer, at).map((item) => [item.getId(), item.getAmount()]);
  return { coins, drops, lost, kept: keptItems };
}

const WILDERNESS = () => new core.Location(3100, 3600, 0);

const LUMBRIDGE = () => new core.Location(3222, 3218, 0);
const RING_I = 20788, RING_3 = 11984; // ring of wealth (i) (3) and its unimbued ring of wealth (3)

test("a PvM death loses the ring's imbue: its 50,000 coins go with what the death loses, not straight on the floor", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(RING_I, 1));
  const { coins, lost } = die(t, victim, null, LUMBRIDGE());
  assert.ok(lost.some(([id]) => id === RING_3), `the ring is lost unimbued, to the grave: ${JSON.stringify(lost)}`);
  assert.ok(lost.some(([id, amount]) => id === I.COINS && amount === 50000), "and the coins go with it, to the grave");
  assert.ok(!coins.some(([owner, amount]) => amount === 50000 && owner === undefined), "no ownerless coins");
});

test("a kept ring still loses its imbue on a PvM death, and the coins go with what the death loses", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(RING_I, 1));
  const { lost, kept } = die(t, victim, null, LUMBRIDGE(), { kept: true });
  assert.deepEqual(kept, [[RING_3, 1]], "kept, but unimbued");
  assert.deepEqual(lost, [[I.COINS, 50000]], "the imbue's coins are lost with the death");
});

test("a kept ring still loses its imbue to a player killer, who gets the 50,000 coins", (t) => {
  const victim = actor(t), killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(RING_I, 1));
  const { kept } = die(t, victim, killer, WILDERNESS(), { kept: true });
  assert.deepEqual(kept, [[RING_3, 1]]);
  assert.equal(killer.getInventory().getAmount(I.COINS), 50000);
});

test("lost to a player killer, the ring reverts and the killer gets 50,000 coins", (t) => {
  const victim = actor(t), killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(20788, 1));
  die(t, victim, killer, WILDERNESS());
  assert.equal(killer.getInventory().getAmount(I.COINS), 50000);
});

test("an Ironman killer gets no coins; they go on the floor for the victim", (t) => {
  const victim = actor(t), killer = actor(t);
  killer.setAttribute("ironman:mode", "ironman");
  victim.getInventory().setItem(0, new core.Item(20788, 1));
  const { coins } = die(t, victim, killer, WILDERNESS());
  assert.equal(killer.getInventory().getAmount(I.COINS), 0);
  assert.deepEqual(coins, [[victim.getUsername(), 50000]]);
});

// The Wiki's exact (3) variant is player-tradeable, but is not on the Grand Exchange.
// Neither ordinary charge consumption nor imbuing creates untradeable item metadata.
for (const y of [3600, 3800]) {
  for (const id of [11984, 20788]) {
    test(`a lost ${id} ring at Wilderness y=${y} becomes killer-owned ring (3) loot`, (t) => {
      const victim = actor(t), killer = actor(t);
      victim.getInventory().addItem(new core.Item(id, 1));
      const { kept, drops } = die(t, victim, killer, new core.Location(3100, y, 0));
      assert.deepEqual(kept, [], "the victim does not retain the lost ring");
      assert.deepEqual(drops.filter(([, itemId]) => itemId === RING_3), [[killer, RING_3, 1]]);
      assert.equal(killer.getInventory().getAmount(I.COINS), id === 20788 ? 50000 : 0);
    });
  }
}

test("a protected ordinary partly charged ring remains with its victim", (t) => {
  const victim = actor(t), killer = actor(t);
  victim.getInventory().addItem(new core.Item(RING_3, 1));
  const { kept, drops } = die(t, victim, killer, WILDERNESS(), { kept: true });
  assert.deepEqual(kept, [[RING_3, 1]]);
  assert.ok(!drops.some(([, id]) => id === RING_3));
});

test("untradeable metadata still destroys a ring rather than giving it to the killer", (t) => {
  const victim = actor(t), killer = actor(t);
  victim.getInventory().addItem(new core.Item(RING_3, 1, { [core.Item.UNTRADEABLE_META]: true }));
  const { kept, drops } = die(t, victim, killer, WILDERNESS());
  assert.deepEqual(kept, []);
  assert.ok(!drops.some(([, id]) => id === RING_3));
});

test("an ordinary partly charged ring lost to an Ironman is floor loot for its victim", (t) => {
  const victim = actor(t), killer = actor(t);
  killer.setAttribute("ironman:mode", "ironman");
  victim.getInventory().addItem(new core.Item(RING_3, 1));
  const { kept, drops } = die(t, victim, killer, WILDERNESS());
  assert.deepEqual(kept, []);
  assert.deepEqual(drops.filter(([, id]) => id === RING_3), [[victim, RING_3, 1]]);
});

for (const id of [RING_3, 20788]) {
  test(`a lost ${id} ring goes into its eligible killer's loot key after its death conversion`, (t) => {
    const victim = actor(t), killer = actor(t);
    const keys = require("../plugins/items/LootKeys.plugin");
    keys.setLootKeysEnabled(killer, true);
    victim.getInventory().addItem(new core.Item(id, 1));
    const { kept, drops } = die(t, victim, killer, WILDERNESS());
    PM.emitPlayerDefeated(killer, victim);
    assert.deepEqual(kept, []);
    assert.ok(!drops.some(([, itemId]) => itemId === RING_3), "no duplicate floor ring");
    const key = killer.getInventory().getValidItems().find(keys.isLootKey);
    assert.ok(key, "a loot key is awarded");
    assert.deepEqual(keys.keyItems(key).map(({ id, amount }) => [id, amount]), [[RING_3, 1]]);
  });
}

test("the native death preview marks an ordinary ring (3) as lost in PvP", (t) => {
  const victim = actor(t);
  victim.getInventory().addItem(new core.Item(RING_3, 1));
  core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const sender = victim.getPacketSender(), inventories = [];
  const send = sender.sendInterfaceScript;
  t.mock.method(sender, "sendInterfaceScript", function (...args) {
    if (args[0] === 972) inventories.push(args[4]);
    return send.apply(this, args);
  });
  assert.equal(PM.emitInterfaceActionClick({ player: victim, buttonId: (387 << 16) | 5, action: 0 }), true);
  assert.equal(PM.emitInterfaceActionClick({ player: victim, buttonId: (4 << 16) | 12, action: 2 }), true);
  const state = inventories.at(-1);
  assert.deepEqual(state[584].slots.map(({ itemId }) => itemId), [RING_3]);
  assert.deepEqual(state[468].slots.map(({ itemId }) => itemId), [1991], "the client renders the lost-item state");
});

for (const mode of ["kept", "metadata", "ironman"]) {
  test(`imbue removal with loot keys preserves the ${mode} ownership guard`, (t) => {
    const victim = actor(t), killer = actor(t);
    const keys = require("../plugins/items/LootKeys.plugin");
    keys.setLootKeysEnabled(killer, true);
    if (mode === "ironman") killer.setAttribute("ironman:mode", "ironman");
    const meta = mode === "metadata" ? { [core.Item.UNTRADEABLE_META]: true } : null;
    victim.getInventory().addItem(new core.Item(20788, 1, meta));
    const { kept, drops } = die(t, victim, killer, WILDERNESS(), { kept: mode === "kept" });
    PM.emitPlayerDefeated(killer, victim);
    assert.equal(killer.getInventory().getValidItems().filter(keys.isLootKey).length, 0);
    assert.deepEqual(kept, mode === "kept" ? [[RING_3, 1]] : []);
    assert.deepEqual(drops.filter(([, id]) => id === RING_3), mode === "ironman" ? [[victim, RING_3, 1]] : []);
  });
}

function preview(t, player, { pvp = false, wilderness = false } = {}) {
  const sender = player.getPacketSender(), snapshots = [];
  const send = sender.sendInterfaceScript;
  t.mock.method(sender, "sendInterfaceScript", function (...args) {
    if (args[0] === 972) snapshots.push({ args: args[1], inventories: args[4] });
    return send.apply(this, args);
  });
  assert.equal(PM.emitInterfaceActionClick({ player, buttonId: (387 << 16) | 5, action: 0 }), true);
  for (const action of [...(pvp ? [2] : []), ...(wilderness ? [3] : [])]) {
    assert.equal(PM.emitInterfaceActionClick({ player, buttonId: (4 << 16) | 12, action }), true);
  }
  return snapshots.at(-1);
}

for (const wilderness of [false, true]) {
  test(`an unprotected imbued ring is lost in the PvP preview at level ${wilderness ? 21 : 0}`, (t) => {
    const player = actor(t);
    player.setSkullTimer(1000);
    player.getInventory().addItem(new core.Item(20788, 1));
    const { inventories } = preview(t, player, { pvp: true, wilderness });
    assert.deepEqual(inventories[584].slots.map(({ itemId }) => itemId), [20788]);
    assert.deepEqual(inventories[468].slots.map(({ itemId }) => itemId), [1991]);
  });
}

test("an imbued ring's preview keeps the PvM grave and ranked protection controls", (t) => {
  const player = actor(t);
  player.getInventory().addItem(new core.Item(20788, 1));
  const protectedPreview = preview(t, player, { pvp: true, wilderness: true });
  assert.deepEqual(protectedPreview.inventories[584].slots, []);
  assert.ok(protectedPreview.args.includes(20788), "the protected ring is in the kept list");
  const skulled = actor(t);
  skulled.setSkullTimer(1000);
  skulled.getInventory().addItem(new core.Item(20788, 1));
  assert.deepEqual(preview(t, skulled).inventories[468].slots.map(({ itemId }) => itemId), [367]);
});

test("the imbued-ring preview query leaves normal and metadata-restricted copies alone", () => {
  for (const item of [new core.Item(RING_3, 1), new core.Item(20788, 1, { [core.Item.UNTRADEABLE_META]: true })]) {
    const before = [item.getId(), item.getMeta()];
    const query = { item, wildernessLevel: 21, lost: false };
    PM.emitCustomEvent("items:lost-to-pvp-killer", query);
    assert.equal(query.lost, false);
    assert.deepEqual([item.getId(), item.getMeta()], before, "the preview does not mutate the item");
  }
});
