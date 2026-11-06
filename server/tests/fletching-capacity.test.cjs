// Run after `yarn build`: node --test tests/fletching-capacity.test.cjs
//
// Fletching and amethyst cutting consume only unrestricted copies, and refuse a whole batch when its
// product would not fit, rather than deleting the materials and the excess.
//
// Clicks go through ClientConnection.dispatch as decoded packets, into the real recipes, menu and
// task. Ticks run the task queue only. Preset copies come from applyPreset with a custom preset, as
// the save prompt builds one, though the prompt is not driven. Stacks near the limit are placed
// directly. No client ran. The refusal at the limit is ours, not from a capture.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const MAX = 2147483647;
const CREATION_GROUP = 270;
const CREATION_FIRST = 15;
const PRESET_TEXT = "Preset items cannot be used for this.";
const SPACE_TEXT = "You don't have enough inventory space.";

let core;
let I;
let next = 7100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("fletchqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const name of ["FLETCHING", "CRAFTING"]) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const original = p.sendMessage.bind(p);
  p.sendMessage = (message) => {
    messages.push(message);
    return original(message);
  };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

async function useOn(f, slot, targetSlot) {
  await send(f, {
    type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
    target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
  });
}

/** Picks `itemId` from the open creation menu, as the client's resume packet does. */
async function create(f, itemId, amount) {
  const index = f.p.getCreationMenu().getItems().indexOf(itemId);
  assert.ok(index >= 0, `the menu offers ${itemId}`);
  await send(f, { type: "dialogue_continue", widgetId: (CREATION_GROUP << 16) | (CREATION_FIRST + index), childIndex: amount });
}

const item = (id, amount = 1) => new core.Item(id, amount);

function put(f, value, slot) {
  f.inv.setItem(slot, value);
}

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(item(I.RAKE), false);
  f.inv.refreshItems();
}

const plainOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && !held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);
const presetOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);

function customPreset(f, inventory) {
  Presets.applyPreset(f.p, new Presetable("qa", inventory, [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false));
  for (const entry of inventory) assert.ok(presetOf(f, entry.getId()) > 0, `marked copies of ${entry.getId()}`);
}

// ------------------------------------------------------------------ arrows and darts near the limit

/** One recipe's materials (15 and 15, or 10 and 10), its product seeded at `held`. */
const CASES = () => [
  { name: "arrows", output: I.BRONZE_ARROW, first: I.HEADLESS_ARROW, second: I.BRONZE_ARROWTIPS, batch: 15, wait: 4 },
  { name: "darts", output: I.BRONZE_DART, first: I.BRONZE_DART_TIP, second: I.FEATHER, batch: 10, wait: 0 },
];

async function makeOne(t, c, held, firstAmount = c.batch, secondAmount = c.batch) {
  const f = actor(t);
  put(f, item(c.output, held), 0);
  put(f, item(c.first, firstAmount), 1);
  put(f, item(c.second, secondAmount), 2);
  await useOn(f, 2, 1);
  ticks(c.wait);
  return { f, result: [f.inv.getAmount(c.output), f.inv.getAmount(c.first), f.inv.getAmount(c.second)] };
}

test("arrows and darts: a batch that fits is made, one past the limit is refused whole", async (t) => {
  for (const c of CASES()) {
    assert.deepEqual((await makeOne(t, c, 50)).result, [50 + c.batch, 0, 0], `${c.name}: control, room`);
    assert.deepEqual((await makeOne(t, c, MAX - c.batch)).result, [MAX, 0, 0], `${c.name}: control, exact fit`);
    assert.deepEqual((await makeOne(t, c, 50, c.batch, c.batch - 1)).result, [50, c.batch, c.batch - 1], `${c.name}: control, short one input`);
    const { f, result } = await makeOne(t, c, MAX - 2);
    assert.deepEqual(result, [MAX - 2, c.batch, c.batch], `${c.name}: refused, nothing taken`);
    assert.ok(f.messages.includes(SPACE_TEXT), `${c.name}: says why`);
  }
});

test("arrows through the menu: make-all stops at the batch that no longer fits", async (t) => {
  const run = async (held) => {
    const f = actor(t);
    put(f, item(I.BRONZE_ARROW, held), 0);
    put(f, item(I.HEADLESS_ARROW, 30), 1);
    put(f, item(I.BRONZE_ARROWTIPS, 30), 2);
    await useOn(f, 2, 1);
    await create(f, I.BRONZE_ARROW, 2);
    ticks(10);
    return [f.inv.getAmount(I.BRONZE_ARROW), f.inv.getAmount(I.HEADLESS_ARROW), f.inv.getAmount(I.BRONZE_ARROWTIPS)];
  };
  assert.deepEqual(await run(50), [80, 0, 0], "control");
  assert.deepEqual(await run(MAX - 17), [MAX - 2, 15, 15]);
});

test("a rolled product must fit at its largest roll", async (t) => {
  const run = async (held) => {
    const f = actor(t);
    const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "big_chompy_bird_hunting");
    // The recipe asks for the quest started, which is stage 5 in BigChompyBirdHunting.Quest.js.
    quest.setStage(f.p, 5);
    assert.equal(quest.isStarted(f.p), true, "the recipe is unlocked");
    put(f, item(I.OGRE_ARROW_SHAFT, held), 0);
    put(f, item(I.ACHEY_TREE_LOGS), 1);
    put(f, item(I.KNIFE), 2);
    await useOn(f, 2, 1);
    ticks(4);
    return [f.inv.getAmount(I.OGRE_ARROW_SHAFT) - held, f.inv.getAmount(I.ACHEY_TREE_LOGS)];
  };
  const room = await run(MAX - 6);
  assert.ok(room[0] >= 2 && room[0] <= 6, `control: rolled ${room[0]}`);
  assert.equal(room[1], 0, "control: the log went");
  assert.deepEqual(await run(MAX - 5), [0, 1], "could roll past the limit: refused");
});

test("a full inventory: the materials can still make room, or nothing is taken", async (t) => {
  const run = async (tips) => {
    const f = actor(t);
    put(f, item(I.BRONZE_DART_TIP, tips), 0);
    put(f, item(I.FEATHER, 100), 1);
    fill(f);
    await useOn(f, 1, 0);
    return [f.inv.getAmount(I.BRONZE_DART), f.inv.getAmount(I.BRONZE_DART_TIP), f.inv.getAmount(I.FEATHER)];
  };
  assert.deepEqual(await run(10), [10, 0, 90], "the tips leave a slot for the darts");
  assert.deepEqual(await run(20), [0, 20, 100], "no slot: nothing taken");
});

test("a full inventory holding only a preset stack of the product takes nothing", async (t) => {
  const setup = async (preset) => {
    const f = actor(t);
    if (preset) customPreset(f, [item(I.RUNE_ARROW, 100)]);
    else put(f, item(I.RUNE_ARROW, 100), 0);
    const first = f.inv.getEmptySlot();
    put(f, item(I.HEADLESS_ARROW, 30), first);
    const second = f.inv.getEmptySlot();
    put(f, item(I.RUNE_ARROWTIPS, 30), second);
    fill(f);
    await useOn(f, second, first);
    await create(f, I.RUNE_ARROW, 1);
    ticks(4);
    return f;
  };
  const control = await setup(false);
  assert.equal(plainOf(control, I.RUNE_ARROW), 115, "control: joins the plain stack");
  assert.equal(control.inv.getAmount(I.HEADLESS_ARROW), 15, "control: one batch taken");

  const f = await setup(true);
  assert.deepEqual([plainOf(f, I.RUNE_ARROW), presetOf(f, I.RUNE_ARROW)], [0, 100]);
  assert.deepEqual([f.inv.getAmount(I.HEADLESS_ARROW), f.inv.getAmount(I.RUNE_ARROWTIPS)], [30, 30], "nothing taken");
  assert.ok(f.messages.includes(SPACE_TEXT), "says why");
});

test("a full inventory: the room check follows the feathers actually used", async (t) => {
  const run = async (ordinary, used) => {
    const f = actor(t);
    put(f, item(I.BRONZE_DART_TIP, 20), 0);
    put(f, item(I.FEATHER, ordinary), 1);
    put(f, item(I.YELLOW_FEATHER, 100), 2);
    fill(f);
    await useOn(f, used, used === 0 ? 1 : 0);
    return [f.inv.getAmount(I.BRONZE_DART), f.inv.getAmount(I.BRONZE_DART_TIP), f.inv.getAmount(I.FEATHER), f.inv.getAmount(I.YELLOW_FEATHER)];
  };
  assert.deepEqual(await run(10, 1), [10, 10, 0, 100], "ordinary feathers clicked: they run out, leaving the slot");
  assert.deepEqual(await run(5, 1), [10, 10, 0, 95], "the ordinary run out first, the yellow make up the rest");
  assert.deepEqual(await run(10, 0), [10, 10, 0, 100], "tips clicked: data order takes the ordinary first");
  assert.deepEqual(await run(10, 2), [0, 20, 10, 100], "yellow clicked: nothing runs out, so nothing is taken");
  assert.deepEqual(await run(20, 1), [0, 20, 20, 100], "more ordinary than the batch: nothing runs out");
});

test("a full inventory: a preset stack of a material does not count as making room", async (t) => {
  const run = async (plain) => {
    const f = actor(t);
    customPreset(f, [item(I.RUNITE_BOLTS, 10)]);
    assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the preset stack comes first");
    put(f, item(I.RUNITE_BOLTS, plain), 1);
    put(f, item(I.DRAGONSTONE_BOLT_TIPS, 30), 2);
    fill(f);
    await useOn(f, 2, 1);
    if (f.p.getCreationMenu()) await create(f, I.DRAGONSTONE_BOLTS, 1);
    ticks(5);
    return [plainOf(f, I.DRAGONSTONE_BOLTS), plainOf(f, I.RUNITE_BOLTS), presetOf(f, I.RUNITE_BOLTS), f.inv.getAmount(I.DRAGONSTONE_BOLT_TIPS)];
  };
  assert.deepEqual(await run(10), [10, 0, 10, 20], "the plain bolts run out, leaving the slot");
  assert.deepEqual(await run(20), [0, 20, 10, 30], "nothing plain runs out, so nothing is taken");
});

test("a full inventory: capacity preview consumes the plain stack, not a larger preset stack", async (t) => {
  const f = actor(t);
  customPreset(f, [item(I.RUNITE_BOLTS, 20)]);
  assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the preset stack comes first");
  put(f, item(I.RUNITE_BOLTS, 10), 1);
  put(f, item(I.DRAGONSTONE_BOLT_TIPS, 10), 2);
  fill(f);

  await useOn(f, 2, 1);
  if (f.p.getCreationMenu()) await create(f, I.DRAGONSTONE_BOLTS, 1);
  ticks(5);

  assert.deepEqual([plainOf(f, I.DRAGONSTONE_BOLTS), plainOf(f, I.RUNITE_BOLTS), presetOf(f, I.RUNITE_BOLTS)], [10, 0, 20]);
  assert.equal(f.inv.getAmount(I.DRAGONSTONE_BOLT_TIPS), 0);
  assert.equal(f.inv.getFreeSlots(), 1, "the consumed inputs free a slot for the product");
  assert.ok(!f.messages.includes(SPACE_TEXT), "the batch fits after the plain stack is consumed");
});

// ------------------------------------------------------------------ preset materials

test("preset bolts are not tipped into plain ones", async (t) => {
  const tip = async (setup) => {
    const f = actor(t);
    setup(f);
    const tips = f.inv.getEmptySlot();
    put(f, item(I.DRAGONSTONE_BOLT_TIPS, 10), tips);
    const bolts = f.inv.getItems().findIndex((held) => held.getId() === I.RUNITE_BOLTS);
    await useOn(f, tips, bolts);
    ticks(5);
    return f;
  };
  const control = await tip((f) => put(f, item(I.RUNITE_BOLTS, 10), 0));
  assert.equal(plainOf(control, I.DRAGONSTONE_BOLTS), 10, "control: tipped");
  assert.equal(control.inv.getAmount(I.DRAGONSTONE_BOLT_TIPS), 0, "control: the tips went");

  const f = await tip((g) => customPreset(g, [item(I.RUNITE_BOLTS, 10)]));
  assert.equal(f.inv.getAmount(I.DRAGONSTONE_BOLTS), 0, "no bolts made");
  assert.equal(presetOf(f, I.RUNITE_BOLTS), 10, "the preset bolts stay");
  assert.equal(f.inv.getAmount(I.DRAGONSTONE_BOLT_TIPS), 10, "the tips stay");
  assert.ok(f.messages.includes(PRESET_TEXT), "says why");
});

test("with preset and plain bolts, only the plain ones are used", async (t) => {
  const run = async (plain) => {
    const f = actor(t);
    customPreset(f, [item(I.RUNITE_BOLTS, 10)]);
    assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the preset stack comes first");
    put(f, item(I.RUNITE_BOLTS, plain), 5);
    put(f, item(I.DRAGONSTONE_BOLT_TIPS, 10), 6);
    await useOn(f, 6, 5);
    ticks(5);
    return f;
  };
  const enough = await run(10);
  assert.equal(plainOf(enough, I.DRAGONSTONE_BOLTS), 10, "made");
  assert.deepEqual([plainOf(enough, I.RUNITE_BOLTS), presetOf(enough, I.RUNITE_BOLTS)], [0, 10], "the plain bolts went");

  const short = await run(5);
  assert.equal(short.inv.getAmount(I.DRAGONSTONE_BOLTS), 0, "five plain bolts make no set");
  assert.deepEqual([plainOf(short, I.RUNITE_BOLTS), presetOf(short, I.RUNITE_BOLTS)], [5, 10], "nothing taken");
  assert.ok(short.messages.includes(PRESET_TEXT), "says why");
});

// ------------------------------------------------------------------ amethyst

test("cutting amethyst: tips that do not fit leave the amethyst uncut", async (t) => {
  const run = async (held, full = false) => {
    const f = actor(t);
    if (held) put(f, item(I.AMETHYST_BOLT_TIPS, held), 0);
    put(f, item(I.AMETHYST), 1);
    put(f, item(I.CHISEL), 2);
    if (full) fill(f);
    await useOn(f, 2, 1);
    await create(f, I.AMETHYST_BOLT_TIPS, 1);
    ticks(6);
    return { f, result: [f.inv.getAmount(I.AMETHYST_BOLT_TIPS), f.inv.getAmount(I.AMETHYST)] };
  };
  assert.deepEqual((await run(100)).result, [115, 0], "control: room");
  assert.deepEqual((await run(MAX - 15)).result, [MAX, 0], "control: exact fit");
  assert.deepEqual((await run(0, true)).result, [15, 0], "control: a full inventory, the amethyst leaves a slot");
  const { f, result } = await run(MAX - 14);
  assert.deepEqual(result, [MAX - 14, 1], "refused, nothing taken");
  assert.ok(f.messages.includes(SPACE_TEXT), "says why");
});

// This module-level setting is applied before the existing before hook loads plugins.
const previousBotsSetting = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = "1";
after(() => {
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

test("emptying a bow string spool as notes conserves strings at the stack limit", async t => {
  const Spool = require("../plugins/skills/fletching/Spool.Fletching");
  const spoolId = I.BOW_STRING_SPOOL, stringId = I.BOW_STRING;
  const noteId = core.ItemDefinition.forId(stringId).getNoteId();
  const capacity = Spool.CAPACITY_BY_SPARES[0];
  assert.equal(spoolId, 31052);
  assert.equal(stringId, 1777);
  assert.equal(capacity, 250);
  assert.equal(core.CacheDefinitions.getObjId("bowstring_spool"), spoolId);
  assert.equal(core.CacheDefinitions.getObjId("bow_string"), stringId);
  assert.equal(core.CacheDefinitions.getObjId("cert_bow_string"), noteId);
  assert.equal(core.ItemDefinition.forId(noteId).isNoted(), true);
  assert.equal(core.ItemDefinition.forId(noteId).isStackable(), true);
  assert.equal(core.ItemDefinition.forId(noteId).unNote(), stringId);
  assert.equal(core.ItemDefinition.forId(stringId).isNoted(), false);
  const chargesVarbit = core.CacheDefinitions.getVarbitId("bowstring_spool_charges");
  const sizeVarbit = core.CacheDefinitions.getVarbitId("bowstring_spool_size");
  assert.ok(Number.isInteger(chargesVarbit));
  assert.ok(Number.isInteger(sizeVarbit));
  const optionsWidget = core.CacheDefinitions.getComponentId("chatmenu:options");
  assert.equal(optionsWidget, core.OptionDialogue.OPTIONS_WIDGET_ID);
  const cases = [
    { name: "room for all notes", seed: 500, topUp: 0 },
    { name: "exact stack limit", seed: MAX, topUp: 0 },
    { name: "125 notes of headroom", seed: MAX, topUp: 125 },
    { name: "no note headroom", seed: MAX, topUp: capacity },
  ];
  for (const c of cases) {
    await t.test(c.name, async t => {
      const f = actor(t), p = f.p, inventory = f.inv;
      const sender = p.getPacketSender(), manager = p.getDialogueManager();
      put(f, item(spoolId), 0);
      put(f, item(noteId, c.seed), 1);
      inventory.refreshItems();
      const initialGround = new Set(core.World.getItems());
      t.after(() => {
        p.closeInterruptibleInterfaces();
        core.TaskManager.cancelTasks(p);
        for (const ground of [...core.World.getItems()]) {
          if (!initialGround.has(ground) && ground.getOwner() === p.getUsername()) {
            core.ItemOnGroundManager.deregister(ground);
            const index = core.World.getItems().indexOf(ground);
            if (index >= 0) core.World.getItems().splice(index, 1);
          }
        }
      });
      const actions = [], taken = [];
      const emitAction = PM.emitItemAction.bind(PM);
      t.mock.method(PM, "emitItemAction", event => {
        const result = emitAction(event);
        if (event.player === p && event.itemId === spoolId) {
          actions.push({ option: event.option, handled: event.handled, slot: event.slot });
        }
        return result;
      });
      const emit = PM.emitCustomEvent.bind(PM);
      t.mock.method(PM, "emitCustomEvent", (name, event) => {
        const result = emit(name, event);
        if (name === "ground-items:taken" && event.player === p) {
          taken.push({ source: event.source, itemId: event.itemId, amount: event.amount, discarded: event.discarded });
        }
        return result;
      });
      const itemAction = async option => {
        const definition = core.CacheDefinitions.getItem(spoolId);
        const slot = inventory.getItems().findIndex(held => held.getId() === spoolId);
        const index = definition.inventoryActions.indexOf(option);
        assert.ok(slot >= 0 && index >= 0, "cache-backed spool action " + option);
        await send(f, { type: "inventory_action", widgetId: core.Inventory.INTERFACE_ID,
          itemId: spoolId, slot, optionIndex: index + 1, option });
        assert.deepEqual(actions.at(-1), { option, handled: true, slot });
      };
      const held = (container, id) => container.getItems().reduce((sum, entry) => sum
        + (entry.getId() === id ? entry.getAmount() : 0), 0);
      const owned = id => held(inventory, id) + held(p.getEquipment(), id)
        + p.getBanks().reduce((sum, bank, tab) => sum
          + (bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? held(bank, id) : 0), 0)
        + core.World.getItems().filter(ground => !ground.isPendingRemoval()
          && ground.getOwner() === p.getUsername()).reduce((sum, ground) => sum
            + (ground.getItem().getId() === id ? ground.getItem().getAmount() : 0), 0);
      const stored = () => Number(p.getAttribute(Spool.CHARGES_ATTRIBUTE) ?? 0);
      const state = () => ({ notes: owned(noteId), strings: owned(stringId), stored: stored(),
        inventoryNotes: inventory.getAmount(noteId), freeSlots: inventory.getFreeSlots(),
        headroom: inventory.getAddableAmount(item(noteId, capacity)) });
      const total = value => value.notes + value.strings + value.stored;
      const xp = () => core.Skill.values().map(skill => p.getSkillManager().getExperience(skill));
      const initialXp = xp();
      assert.equal(inventory.getItems()[1].isPresetItem(), false);
      assert.equal(stored(), 0, "account starts without injected string credit");
      assert.equal(sender.getVarbit(sizeVarbit), 0, "default account capacity");
      assert.equal(total(state()), c.seed);
      await itemAction("Fill");
      assert.equal(stored(), capacity, "real Fill consumes 250 noted bow strings");
      assert.equal(sender.getVarbit(chargesVarbit), capacity);
      assert.equal(inventory.getAmount(noteId), c.seed - capacity);
      assert.equal(owned(stringId), 0);
      assert.equal(total(state()), c.seed);
      if (c.topUp > 0) {
        const ground = core.ItemOnGroundManager.registers(p, item(noteId, c.topUp));
        assert.equal(core.World.getItems().includes(ground), true);
        assert.equal(core.ItemOnGroundManager.canSee(p, ground), true);
        assert.equal(ground.getItem().getAmount(), c.topUp);
        assert.equal(ground.getPosition().equals(p.getLocation()), true);
        assert.equal(total(state()), c.seed + c.topUp, "seeded owned floor is included before Take");
        const takeIndex = core.CacheDefinitions.getItem(noteId).groundActions.indexOf("Take");
        assert.ok(takeIndex >= 0, "cache-backed noted bow string Take option");
        assert.equal(p.getLastItemPickup().elapsedTime(300), true);
        await send(f, { type: "ground_item_action", itemId: noteId, stackId: ground.getId(),
          x: p.getLocation().getX(), y: p.getLocation().getY(), option: "Take", optionIndex: takeIndex + 1 });
        assert.deepEqual(taken, [{ source: "pickup", itemId: noteId, amount: c.topUp, discarded: 0 }]);
        assert.equal(inventory.getAmount(noteId), c.seed - capacity + c.topUp);
        assert.equal(core.World.getItems().filter(entry => !entry.isPendingRemoval()
          && entry.getOwner() === p.getUsername() && entry.getItem().getId() === noteId)
          .reduce((sum, entry) => sum + entry.getItem().getAmount(), 0), 0, "native Take removed the seeded floor quantity");
      }
      const before = state();
      assert.equal(before.stored, capacity);
      assert.equal(before.freeSlots, inventory.capacity() - 2);
      assert.equal(before.headroom, Math.min(capacity, MAX - before.inventoryNotes));
      assert.equal(before.headroom, c.topUp ? capacity - c.topUp : capacity);
      assert.equal(total(before), c.seed + c.topUp);
      assert.deepEqual(xp(), initialXp, "Fill and Take award no XP");
      await itemAction("Empty");
      const prompt = manager.getCurrent();
      assert.ok(prompt instanceof core.OptionDialogue, "Empty's native OptionDialogue owns the selection");
      assert.equal(core.MultiChatboxPrompt.getPending(p), null);
      assert.equal(prompt.getTitle(), "Empty the spool?");
      assert.deepEqual(prompt.getOptions(), ["Take them as bow strings.", "Take them as notes.", "Cancel."]);
      assert.equal(sender.getChatboxGroupId(), optionsWidget >>> 16);
      assert.equal(manager.getOwner(), undefined);
      assert.equal(total(state()), total(before), "opening the real prompt transfers nothing");
      const choice = prompt.getOptions().indexOf("Take them as notes.") + 1;
      assert.equal(choice, 2);
      await send(f, { type: "dialogue_continue", widgetId: optionsWidget, childIndex: choice });
      const after = state();
      // A refusal, a partial withdrawal or a complete refund onto the floor can all conserve strings.
      assert.equal(total(after), total(before), "all owned strings plus account storage: "
        + JSON.stringify({ before, after }));
      assert.equal(manager.isActive(), false, "decoded selection consumed the actual native option prompt");
      assert.ok(Number.isInteger(after.stored) && after.stored >= 0 && after.stored <= capacity);
      if (c.topUp === 0) {
        assert.equal(after.stored, 0, "working withdrawal control empties the spool");
        assert.equal(after.inventoryNotes, c.seed);
      }
      assert.equal(sender.getVarbit(chargesVarbit), after.stored);
      assert.equal(owned(spoolId), 1);
      assert.deepEqual(xp(), initialXp, "Empty awards no XP");
    });
  }
});


test("emptying a spool as unnoted strings keeps the remainder stored", async t => {
  const Spool = require("../plugins/skills/fletching/Spool.Fletching");
  const f = actor(t), p = f.p, inventory = f.inv;
  const spoolId = I.BOW_STRING_SPOOL, stringId = I.BOW_STRING;
  const noteId = core.ItemDefinition.forId(stringId).getNoteId();
  const capacity = Spool.CAPACITY_BY_SPARES[0];
  put(f, item(spoolId), 0);
  put(f, item(noteId, capacity), 1);
  inventory.refreshItems();
  t.after(() => { p.closeInterruptibleInterfaces(); core.TaskManager.cancelTasks(p); });
  const action = async option => {
    const index = core.CacheDefinitions.getItem(spoolId).inventoryActions.indexOf(option);
    assert.ok(index >= 0);
    await send(f, { type: "inventory_action", widgetId: core.Inventory.INTERFACE_ID,
      itemId: spoolId, slot: 0, optionIndex: index + 1, option });
  };
  await action("Fill");
  assert.equal(p.getAttribute(Spool.CHARGES_ATTRIBUTE), capacity);
  assert.equal(inventory.getAmount(noteId), 0);
  const free = inventory.getFreeSlots();
  assert.equal(free, inventory.capacity() - 1);
  await action("Empty");
  const prompt = p.getDialogueManager().getCurrent();
  assert.ok(prompt instanceof core.OptionDialogue);
  assert.equal(prompt.getOptions()[0], "Take them as bow strings.");
  await send(f, { type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: 1 });
  assert.equal(p.getDialogueManager().isActive(), false);
  assert.equal(inventory.getAmount(stringId), free);
  assert.equal(p.getAttribute(Spool.CHARGES_ATTRIBUTE), capacity - free);
  assert.equal(inventory.getAmount(stringId) + p.getAttribute(Spool.CHARGES_ATTRIBUTE), capacity);
});
