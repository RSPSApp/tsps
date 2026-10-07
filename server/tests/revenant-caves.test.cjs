// Run after `yarn build`: node --test tests/revenant-caves.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { Location } = require("../dist/game/model/Location");
const { TaskManager } = require("../dist/game/task/TaskManager");
const RevenantCaves = require("../plugins/areas/RevenantCaves.plugin");

const T = RevenantCaves._test;
const COINS = 995;
const SCROLL = 21802;
const teleports = [];
const groundItems = [];
let prompt = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  T.attach({
    core: {
      ...core,
      Bank: { getTabForItem: () => 0 },
      TeleportHandler: {
        checkReqs: () => true,
        teleport: (player, to, type) => teleports.push({ to: [to.getX(), to.getY()], delay: type.getStartTick?.() }),
      },
      ItemOnGroundManager: {
        registerLocation: (owner, item, at) => groundItems.push({ owner, id: item.getId(), amount: item.getAmount(), at: [at.getX(), at.getY()] }),
      },
      TaskManager: core.TaskManager,
      Task: core.Task,
    },
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      const options = pairs.filter((entry) => typeof entry === "string");
      const actions = pairs.filter((entry) => typeof entry === "function");
      prompt = { title, options, choose: (text) => actions[options.indexOf(text)](player) };
      return true;
    },
  });
});

/** A player recording, per tick, what the server sends. */
function player({ at = new Location(3074, 3654, 0), coins = 0, banked = 0, inventory = [] } = {}) {
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const attributes = new Map();
  const varbits = new Map();
  let location = at;
  let carried = coins;
  let bank = banked;
  const slots = inventory.map((id) => (id ? { getId: () => id } : null));
  let dialogue = null;
  const sender = {
    sendVarbit: (id, value) => (varbits.set(id, value), log(`varbit ${id}=${value}`), sender),
    sendInterface: (id) => (log(`open ${id}`), sender),
    sendInterfaceRemoval: () => (log("close"), sender),
    sendClientScript: (id, ...args) => (log(`script ${id} [${args}]`), sender),
    sendGlobalGraphic: (graphic, tile) => (log(`map graphic ${graphic.getId()} ${tile.getX()},${tile.getY()}`), sender),
  };
  const p = {
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log(message),
    getLocation: () => location,
    moveTo: (to) => { location = to; log(`teleport ${to.getX()},${to.getY()}`); },
    isRegistered: () => true,
    isPlayer: () => true,
    getAsPlayer: () => p,
    getInventory: () => ({
      getAmount: (id) => (id === COINS ? carried : 0),
      delete: (id, amount) => { carried -= amount; },
      getItems: () => slots,
      deleteAtSlot: (slot) => { log(`scroll used (slot ${slot})`); slots[slot] = null; },
    }),
    getBank: () => ({ getAmount: (id) => (id === COINS ? bank : 0), delete: (id, amount) => { bank -= amount; } }),
    getDialogueManager: () => ({
      startDialogues: (chain) => {
        const entries = [...chain.getDialogues().values()];
        dialogue = entries;
        log(`item box ${entries[0].getItemId()}: ${entries[0].getText()}`);
      },
    }),
  };
  return {
    p, ticks, varbits, attributes,
    coins: () => carried,
    banked: () => bank,
    continueDialogue: () => dialogue[1].send(p),
    nextTick: () => ticks.push([]),
  };
}

function runTicks(rec, count) {
  for (let i = 0; i < count; i++) {
    TaskManager.process();
    rec.nextTick();
  }
  return rec.ticks;
}

const objectAt = (x, y) => ({ x, y, z: 0 });

test("every link's object is where the captures put it, in this cache's map", () => {
  RegionManager.init();
  const expected = [[31555, 3073, 3654], [31556, 3124, 3831], [40386, 3067, 3740], [31558, 3218, 10058], [43868, 3244, 10215]];
  for (const [id, x, y] of expected) {
    RegionManager.loadMapFiles(x, y);
    const objects = MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? [];
    assert.ok(objects.some((o) => o.getId() === id), `${id} at ${x},${y}`);
  }
  assert.equal(CacheDefinitions.getState().items.load(SCROLL).name, "Revenant cave teleport");
});

test("already paid: the message on arrival, and in a tick later (level 40 cavern)", () => {
  const rec = player({ at: new Location(3126, 3832, 0) });
  rec.p.setAttribute(T.FEE_PAID_ATTRIBUTE, true);
  assert.equal(T.enter({ player: rec.p, location: objectAt(3124, 3831) }), true);
  assert.deepEqual(rec.ticks[0], ["You've already paid the Revenant Entry Fee."]);
  rec.nextTick();
  assert.deepEqual(runTicks(rec, 1)[1], ["varbit 12393=0", "You enter the cave and scramble over the rubble.", "teleport 3241,10233"]);
});

test("unpaid: the fee box, the menu, paid from the bank, and in at once (level 17 cavern)", () => {
  const rec = player({ banked: 150_000 });
  T.enter({ player: rec.p, location: objectAt(3073, 3654) });
  assert.deepEqual(rec.ticks[0], [
    "varbit 12393=1",
    "item box 1004: You need to pay a 100,000 coins fee to enter the<br>Revenant Cave.<br>This can be taken from your inventory, bank or both.",
  ]);
  rec.continueDialogue();
  assert.equal(prompt.title, "Pay 100,000 coins Entry Fee?");
  assert.deepEqual(prompt.options, ["Yes.", "Yes, don't ask again.", "No."]);
  prompt.choose("Yes.");
  assert.deepEqual(rec.ticks[0].slice(2), [
    "The entry fee was taken from your bank.",
    "varbit 12393=0",
    "You enter the cave and scramble over the rubble.",
    "teleport 3197,10056",
  ]);
  assert.equal(rec.banked(), 50_000);
  assert.equal(rec.p.getAttribute(T.FEE_PAID_ATTRIBUTE), true);
});

test("the fee comes from the inventory first; 'don't ask again' pays without asking next time", () => {
  const rec = player({ coins: 60_000, banked: 200_000 });
  T.enter({ player: rec.p, location: objectAt(3073, 3654) });
  rec.continueDialogue();
  prompt.choose("Yes, don't ask again.");
  assert.equal(rec.coins(), 0);
  assert.equal(rec.banked(), 160_000);
  rec.p.setAttribute(T.FEE_PAID_ATTRIBUTE, false);
  rec.ticks.length = 0;
  rec.nextTick();
  T.enter({ player: rec.p, location: objectAt(3073, 3654) });
  assert.ok(!rec.ticks[0].some((e) => e.startsWith("item box")), "no prompt");
  assert.equal(rec.ticks[0].at(-1), "teleport 3197,10056");
  assert.equal(rec.banked(), 60_000);
});

test("No, or too few coins, stays outside", () => {
  const rec = player({ banked: 10 });
  T.enter({ player: rec.p, location: objectAt(3073, 3654) });
  rec.continueDialogue();
  prompt.choose("Yes.");
  assert.ok(!rec.ticks.flat().some((e) => e.startsWith("teleport")));
  assert.equal(rec.varbits.get(12393), 0);
});

test("the crevice warns until 'Jump!' (varbit 6506), then the fee", () => {
  const rec = player({ at: new Location(3069, 3740, 0) });
  rec.p.setAttribute(T.FEE_PAID_ATTRIBUTE, true);
  T.enter({ player: rec.p, location: objectAt(3067, 3740) });
  assert.deepEqual(rec.ticks[0], ["script 2524 [-1,-1]", "open 720", "varbit 12393=1"]);
  T.creviceWarning({ player: rec.p, groupId: 720, childId: 17 });
  assert.equal(rec.varbits.get(6506), 1);
  rec.nextTick();
  assert.ok(runTicks(rec, 1).flat().includes("teleport 3187,10127"));
  assert.ok(rec.ticks.flat().includes("You jump down into the cavern."));

  rec.ticks.length = 0;
  rec.nextTick();
  T.enter({ player: rec.p, location: objectAt(3067, 3740) });
  assert.ok(!rec.ticks[0].includes("open 720"), "not warned again");
});

test("the exit stairs: a tick later, the message and the trapdoor's side", () => {
  for (const [stairs, out] of [[[3218, 10058], [3102, 3655]], [[3244, 10215], [3124, 3806]]]) {
    const rec = player({ at: new Location(stairs[0] - 1, stairs[1], 0) });
    assert.equal(T.exit({ player: rec.p, location: objectAt(...stairs) }), true);
    assert.deepEqual(rec.ticks[0], []);
    rec.nextTick();
    assert.deepEqual(runTicks(rec, 1)[1], ["You climb the stairs and exit the cave.", `teleport ${out[0]},${out[1]}`]);
  }
});

test("any other Cavern, Crevice or Stairs falls through", () => {
  const rec = player();
  assert.equal(T.enter({ player: rec.p, location: objectAt(3000, 3000) }), false);
  assert.equal(T.exit({ player: rec.p, location: objectAt(3205, 3209) }), false);
});

test("scroll Config: the menu, varbit 20096 and the item box; a left-click follows it", () => {
  const rec = player({ at: new Location(3164, 3487, 0), inventory: [SCROLL] });
  T.configOption({ player: rec.p });
  assert.equal(prompt.title, "Select a teleport location");
  assert.deepEqual(prompt.options, ["Northern entrance.", "Middle entrance.", "Southern entrance."]);
  prompt.choose("Southern entrance.");
  assert.equal(rec.varbits.get(20096), 2);
  assert.ok(rec.ticks[0].includes("item box 21802: Revenant cave teleports will now teleport you to the<br>southern entrance."));

  teleports.length = 0;
  T.teleportOption({ player: rec.p, slot: 0 });
  assert.equal(prompt.title, "Teleport to the Wilderness?");
  assert.deepEqual(prompt.options, ["Yes, teleport me now.", "No, I want to stay here."]);
  prompt.choose("Yes, teleport me now.");
  assert.deepEqual(teleports, [{ to: [3080, 3655], delay: 3 }]);
  assert.ok(rec.ticks[0].includes("scroll used (slot 0)"));
  assert.ok(rec.ticks[0].includes("map graphic 1039 3164,3487"));
});

test("scroll sub-options pick the entrance, whatever Config says", () => {
  const rec = player({ at: new Location(3164, 3487, 0), inventory: [SCROLL] });
  rec.p.setAttribute(T.SCROLL_LOCATION_ATTRIBUTE, 2);
  teleports.length = 0;
  T.teleportOption({ player: rec.p, slot: 0, subOpId: 1 });
  assert.equal(prompt.title, "Teleport to deep Wilderness?");
  prompt.choose("Yes, teleport me now.");
  assert.deepEqual(teleports.map((t) => t.to), [[3128, 3832]]);
  T.teleportOption({ player: rec.p, slot: 0, subOpId: 2 });
  assert.equal(prompt.title, "Teleport to deep Wilderness?", "middle is deep Wilderness too");
});

test("the scroll is blocked above level 20 Wilderness, after the question", () => {
  const rec = player({ at: new Location(3129, 3755, 0), inventory: [SCROLL] });
  teleports.length = 0;
  T.teleportOption({ player: rec.p, slot: 0, subOpId: 2 });
  prompt.choose("Yes, teleport me now.");
  assert.equal(teleports.length, 0);
  assert.deepEqual(rec.ticks[0].slice(-3), [
    "A mysterious force blocks your teleport spell!",
    "You can't use this teleport after level 20 wilderness.",
    "varbit 12393=0",
  ]);
});

test("deaths: the fee is lost in the caves or to a player in the Wilderness; the killer gets it", () => {
  const killer = { isPlayer: () => true, getAsPlayer() { return this; } };
  const npc = { isPlayer: () => false };

  const pvp = player({ at: new Location(3200, 10100, 0) });
  pvp.p.setAttribute(T.FEE_PAID_ATTRIBUTE, true);
  groundItems.length = 0;
  T.onDeath({ player: pvp.p, killer });
  assert.equal(pvp.p.getAttribute(T.FEE_PAID_ATTRIBUTE), false);
  assert.deepEqual(pvp.ticks[0], ["You died to another player in the Revenant Cave, you've lost your entry fee."]);
  assert.deepEqual(groundItems, [{ owner: killer, id: COINS, amount: 100_000, at: [3200, 10100] }]);

  const toNpc = player({ at: new Location(3200, 10100, 0) });
  toNpc.p.setAttribute(T.FEE_PAID_ATTRIBUTE, true);
  T.onDeath({ player: toNpc.p, killer: npc });
  assert.equal(toNpc.p.getAttribute(T.FEE_PAID_ATTRIBUTE), false, "any death in the caves");
  assert.deepEqual(toNpc.ticks[0], []);

  const surface = player({ at: new Location(3100, 3700, 0) });
  surface.p.setAttribute(T.FEE_PAID_ATTRIBUTE, true);
  T.onDeath({ player: surface.p, killer: npc });
  assert.equal(surface.p.getAttribute(T.FEE_PAID_ATTRIBUTE), true, "an NPC on the surface keeps it");
  T.onDeath({ player: surface.p, killer });
  assert.equal(surface.p.getAttribute(T.FEE_PAID_ATTRIBUTE), false, "a player in the Wilderness takes it");

  const lumbridge = player({ at: new Location(3222, 3218, 0) });
  lumbridge.p.setAttribute(T.FEE_PAID_ATTRIBUTE, true);
  T.onDeath({ player: lumbridge.p, killer });
  assert.equal(lumbridge.p.getAttribute(T.FEE_PAID_ATTRIBUTE), true, "outside the Wilderness it stays");
});

test("the scroll's Config is found by name (rev 241: fourth slot, then Drop); the fifth slot drops only by name", () => {
  const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
  assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(SCROLL, 6), { optionIndex: 4, option: "Config" });
  assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(SCROLL, 7), { optionIndex: 5, option: "Drop" });
  assert.equal(ItemActionPacketListener.isDropOption("config", 5), false);
  assert.equal(ItemActionPacketListener.isDropOption("drop", 5), true);
  assert.equal(ItemActionPacketListener.isDropOption("destroy", 5), true);
  assert.equal(ItemActionPacketListener.isDropOption("", 5), true, "no option text: the drop slot");
  assert.equal(ItemActionPacketListener.isDropOption("uncharge", 5), false, "charged items' Uncharge reaches plugins");
  assert.equal(ItemActionPacketListener.isDropOption("discard", 5), true);
});
