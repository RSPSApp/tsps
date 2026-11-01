// Run after `yarn build`: node --test tests/ornament-kits.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIds } = require("../dist/util/IdEnums");
const { Barrows } = require("../dist/game/content/combat/Barrows");

const OrnamentKits = require("../plugins/items/OrnamentKits.plugin");
const GracefulOutfit = require("../plugins/items/GracefulOutfit.plugin");
const MakeOverMage = require("../plugins/npcs/MakeOverMage.plugin");

let itemOnItem = null;
let itemAction = null;
OrnamentKits.register({
  core: {
    GameConstants: { DEFINITIONS_DIRECTORY: path.join(__dirname, "..", "data", "definitions") },
    ItemIdentifiers: ItemIds,
    Barrows,
  },
  onItemOnItem: (handler) => { itemOnItem = handler; },
  onItemAction: (handler) => { itemAction = handler; },
  log() {},
});

function item(id, meta = null) {
  return {
    id,
    meta,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMeta() { return this.meta; },
    setMeta(next) { this.meta = next; return this; },
  };
}

function createPlayer(items) {
  const messages = [];
  let equipmentRefreshes = 0;
  let inventoryRefreshes = 0;
  return {
    messages,
    getEquipment: () => ({ refreshItems: () => { equipmentRefreshes++; } }),
    getEquipmentRefreshes: () => equipmentRefreshes,
    getInventoryRefreshes: () => inventoryRefreshes,
    getInventory: () => ({
      deleteNumber: (id, amount) => {
        const index = items.findIndex((entry) => entry.getId() === id);
        if (index >= 0) items.splice(index, 1);
        void amount;
      },
      refreshItems: () => { inventoryRefreshes++; },
    }),
    sendMessage: (message) => messages.push(message),
  };
}

test("the ornament table maps every cosmetic variant to its base", () => {
  const kits = OrnamentKits._test.loadKits();
  assert.equal(kits.length, 101);
  const runeDefender = kits.find((entry) => entry.name === "Rune defender ornament kit");
  assert.deepEqual([runeDefender.kit, runeDefender.base, runeDefender.result], [23227, 8850, 23230]);
  const dragonHelm = kits.find((entry) => entry.name === "Dragon full helm ornament kit");
  assert.deepEqual([dragonHelm.kit, dragonHelm.base, dragonHelm.result], [12538, 11335, 12417]);
  const voidTop = kits.find((entry) => entry.name === "Shattered relics void ornament kit" && entry.base === 8839);
  assert.deepEqual([voidTop.kit, voidTop.result], [26479, 26463]);
  const trailblazer = kits.find((entry) => entry.name === "Trailblazer graceful hood");
  assert.deepEqual([trailblazer.kit, trailblazer.base, trailblazer.result, trailblazer.worn], [25099, 11850, 25069, 25071]);
});

test("cosmetic variants exist and carry their base item's bonuses and requirements", () => {
  const rows = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8")).map((row) => [row.id, row]));
  for (const entry of OrnamentKits._test.loadKits()) {
    const base = rows.get(entry.base);
    assert.ok(base, `base ${entry.base} for ${entry.name}`);
    for (const id of [entry.result, entry.worn].filter(Boolean)) {
      const variant = rows.get(id);
      assert.ok(variant, `variant ${id} for ${entry.name}`);
      // Echo/other cache-backed variants carry no fallback row; the cache supplies their stats.
      if (variant.bonuses == null || variant.requirements == null) continue;
      assert.deepEqual(variant.bonuses, base.bonuses, `${entry.name} bonuses`);
      assert.deepEqual(variant.requirements, base.requirements, `${entry.name} requirements`);
    }
  }
});

test("using a kit consumes it, transforms the base item and refreshes containers", () => {
  const kit = item(23227);
  const defender = item(8850, { barrows: { remaining: 500 } });
  const items = [kit, defender];
  const player = createPlayer(items);
  const event = { player, usedItem: kit, usedWithItem: defender, usedItemId: 23227, usedWithItemId: 8850, handled: false };
  itemOnItem(event);
  assert.equal(event.handled, true);
  assert.equal(defender.getId(), 23230);
  assert.deepEqual(defender.getMeta(), { barrows: { remaining: 500 } }, "degradation meta survives");
  assert.equal(items.length, 1, "the kit is consumed");
  assert.match(player.messages[0], /apply the rune defender ornament kit/);
  assert.ok(player.getInventoryRefreshes() > 0);
  assert.ok(player.getEquipmentRefreshes() > 0);
});

test("reverting swaps the id back without refunding the kit", () => {
  const ornamented = item(23230, { barrows: { remaining: 500 } });
  const items = [ornamented];
  const player = createPlayer(items);
  const event = { player, item: ornamented, itemId: 23230, option: "Revert", handled: false };
  itemAction(event);
  assert.equal(event.handled, true);
  assert.equal(ornamented.getId(), 8850);
  assert.deepEqual(ornamented.getMeta(), { barrows: { remaining: 500 } });
  assert.equal(items.length, 1, "the kit is not returned");
  assert.match(player.messages[0], /revert the rune defender ornament kit/);
});

test("a kit applies to a degraded Barrows piece, and Echo Ahrim's reverts to its stage", () => {
  const kit = item(30451);
  const degraded = item(4857, { barrows: { remaining: 750 } });
  const player = createPlayer([kit, degraded]);
  const apply = { player, usedItem: kit, usedWithItem: degraded, usedItemId: 30451, usedWithItemId: 4857, handled: false };
  itemOnItem(apply);
  assert.equal(apply.handled, true);
  assert.equal(degraded.getId(), 30525, "Echo ahrim's hood 75 keeps the stage");
  assert.deepEqual(degraded.getMeta(), { barrows: { remaining: 750 } });

  const revert = { player, item: degraded, itemId: 30525, option: "Revert", handled: false };
  itemAction(revert);
  assert.equal(revert.handled, true);
  assert.equal(degraded.getId(), Barrows.stageItemId(4708, 1), "plain Ahrim's hood 75");
  assert.deepEqual(degraded.getMeta(), { barrows: { remaining: 750 } });
});

test("plain Ahrim's robetop degrades as plain while Echo Ahrim's keeps its cosmetic stage", () => {
  assert.equal(
    Barrows.stageItemIdFor(ItemIds.AHRIMS_ROBETOP, 1),
    Barrows.stageItemId(ItemIds.AHRIMS_ROBETOP, 1),
  );
  assert.equal(
    Barrows.stageItemIdFor(ItemIds.ECHO_AHRIMS_ROBETOP, 1),
    ItemIds.ECHO_AHRIMS_ROBETOP_75,
  );
});

test("a kit does not work on the wrong item, and noted kits are filtered", () => {
  const kit = item(12538);
  const dragonScimitar = item(4587);
  const player = createPlayer([kit, dragonScimitar]);
  const event = { player, usedItem: kit, usedWithItem: dragonScimitar, usedItemId: 12538, usedWithItemId: 4587, handled: false };
  itemOnItem(event);
  assert.equal(event.handled, false);
  assert.equal(dragonScimitar.getId(), 4587);
});

test("graceful recolours still count for the graceful set effect", () => {
  const rows = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8")).map((row) => [row.id, row]));
  const varlamore = new Map(
    OrnamentKits._test.loadKits()
      .filter((entry) => entry.name.startsWith("Varlamore graceful "))
      .map((entry) => [entry.base, entry.result]),
  );
  const nameBySlot = {
    0: rows.get(varlamore.get(11850)).name,
    1: rows.get(varlamore.get(11852)).name,
    4: rows.get(varlamore.get(11854)).name,
    7: rows.get(varlamore.get(11856)).name,
    9: rows.get(varlamore.get(11858)).name,
    10: rows.get(varlamore.get(11860)).name,
  };
  assert.ok(Math.abs(GracefulOutfit._test.gracefulRestoreBonusFromSlots(nameBySlot, () => false) - 0.30) < 1e-9);
});

test("the makeover editor refuses to open while busy, in combat or in a dialogue", () => {
  const player = {
    busy: () => false,
    getDialogueManager: () => ({ isActive: () => false }),
    getPacketSender: () => ({ hasInterruptibleInterface: () => false }),
  };
  const combat = { inCombat: () => false };
  assert.equal(MakeOverMage._test.canOpenMakeover(player, combat), true);
  assert.equal(MakeOverMage._test.canOpenMakeover({ ...player, busy: () => true }, combat), false);
  assert.equal(MakeOverMage._test.canOpenMakeover(player, { inCombat: () => true }), false);
  assert.equal(MakeOverMage._test.canOpenMakeover({ ...player, getDialogueManager: () => ({ isActive: () => true }) }, combat), false);
  assert.equal(MakeOverMage._test.canOpenMakeover({ ...player, getPacketSender: () => ({ hasInterruptibleInterface: () => true }) }, combat), false);
});

test("the makeover interface previews styles and colours, keeps them on Confirm and restores them on close", () => {
  const Makeover = require("../plugins/npcs/Makeover.plugin");
  const { Appearance } = require("../dist/game/model/Appearance");
  const ids = { makeover: 516, "makeover:item_area": (516 << 16) | 7, "makeover:colours": (516 << 16) | 24,
    "makeover:select": (516 << 16) | 27, "makeover:select_and_close": (516 << 16) | 28,
    "makeover:burger_menu_frame": (516 << 16) | 31 };
  // Torso styles 0-2 as dbrows 100-102 (type a kits 18, 24, 105), 29 torso colours.
  const rows = new Map([[100, 18], [101, 24], [102, 105]]);
  const enums = new Map([[5495, new Map([[0, 100], [1, 101], [2, 102]])], [789, new Map(Array.from({ length: 29 }, (_, i) => [i, i]))]]);
  const CacheDefinitions = {
    getInterfaceId: (name) => ids[name], getComponentId: (name) => ids[name],
    getVarbitId: () => 4130, getVarpId: (name) => (name === "makeover_colour" ? 3789 : 3788), getSpotanimId: () => 2372,
    getEnumValues: (id) => enums.get(id) ?? new Map(),
    getDbRow: (id) => ({ tableId: 65, int: () => rows.get(id) }),
    getDbColumn: (table, column) => (column === "player_kit_id_type_a" ? 1 : 2),
  };
  const buttons = new Map();
  let closed = null;
  const tasks = [];
  Makeover.register({
    core: { CacheDefinitions, Appearance, Equipment: { HEAD_SLOT: 0 }, Graphic: class {},
      Task: class { constructor() {} stop() { this.stopped = true; } }, TaskManager: { submit: (task) => tasks.push(task) } },
    onNpcInteraction() {},
    onInterfaceActionButton: (uid, handler) => buttons.set(uid, handler),
    onCustomEvent: (name, handler) => { if (name === "interface:closed") closed = handler; },
  });
  const sent = [];
  const messages = [];
  const look = [0, 3, 18, 26, 34, 38, 42, 14, 2, 14, 5, 4, 0];
  const player = {
    getAppearance: () => ({ isMale: () => true, getLook: () => look, setLook: (slot, value) => { look[slot] = value; },
      setLookArray: (values) => values.forEach((value, slot) => { look[slot] = value; }) }),
    getEquipment: () => ({ getItems: () => [] }),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({
      sendConfig: (id, value) => sent.push(["varp", id, value]),
      sendVarbit: (id, value) => sent.push(["varbit", id, value]),
      sendInterface: (id) => sent.push(["open", id]),
      sendInterfaceFlagsRange: (uid, from, to) => sent.push(["events", uid & 0xffff, from, to]),
      sendInterfaceRemoval: () => closed({ player, interfaceId: 516 }),
    }),
  };

  assert.equal(Makeover.openMakeover(player, Makeover.TYPES.TOP), true);
  assert.deepEqual(sent.slice(0, 4), [["varp", 3789, 14], ["varbit", 4130, 3], ["varp", 3788, 0], ["open", 516]]);
  assert.deepEqual(sent.find((row) => row[0] === "events" && row[1] === 7), ["events", 7, 0, 15]);
  assert.deepEqual(sent.find((row) => row[0] === "events" && row[1] === 24), ["events", 24, 0, 58]);

  buttons.get(ids["makeover:item_area"])({ player, slot: 10 });
  buttons.get(ids["makeover:colours"])({ player, slot: 6 });
  assert.equal(look[Appearance.CHEST], 105);
  assert.equal(look[Appearance.TORSO_COLOUR], 3);
  player.getPacketSender().sendInterfaceRemoval();
  assert.equal(look[Appearance.CHEST], 18, "closing without Confirm puts the old top back");
  assert.equal(look[Appearance.TORSO_COLOUR], 14);
  assert.equal(tasks[0].stopped, true);

  Makeover.openMakeover(player, Makeover.TYPES.TOP);
  buttons.get(ids["makeover:item_area"])({ player, slot: 5 });
  buttons.get(ids["makeover:select_and_close"])({ player, slot: 9 });
  assert.equal(look[Appearance.CHEST], 24, "Confirm keeps the new top");
  assert.deepEqual(messages, []);
});
