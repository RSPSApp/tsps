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
