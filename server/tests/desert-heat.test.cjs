// Run after `yarn build`: node --test tests/desert-heat.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const DesertHeat = require("../plugins/areas/DesertHeat.plugin");
const Waterskins = require("../plugins/items/Waterskins.plugin");

let core;

before(async () => {
  await CachePipeline.initialize();
  core = { ...PluginManager.getCoreApi(), TaskManager: { submit() {} } };
  const startup = [];
  DesertHeat.register({
    core,
    onServerStartup: (handler) => startup.push(handler),
    onPlayerLogin() {},
    onPlayerMapSquareChange() {},
    onPlayerLogout() {},
    onCustomEvent() {},
  });
  for (const handler of startup) {
    if (handler.name === "defineData") handler();
  }
  Waterskins.register({ core, onObjectInteraction() {}, onItemOnItem() {}, emitCustomEvent() {} });
});

const id = (name) => core.ItemIdentifiers[name];
const at = (x, y, z = 0) => new Location(x, y, z);

function wearing(...names) {
  const worn = Array.from({ length: 14 }, () => null);
  for (const name of names) {
    const item = new core.Item(id(name), 1);
    worn[core.CacheDefinitions.getItem(item.getId()).wearPos] = item;
  }
  return { getEquipment: () => ({ getItems: () => worn }) };
}

test("the heat reaches every tile a captured strike landed on", () => {
  const { inHeat } = DesertHeat._test;
  for (const [x, y, z] of [
    [3304, 3115, 0], // just south of the Shantay Pass gate
    [3214, 3132, 0], // past the Lumbridge desert shortcut
    [3369, 3116, 0], [3470, 3113, 0],
    [3416, 2848, 0], // south of Nardah
    [3325, 2761, 0], // outside Sophanem's walls
    [3196, 2842, 0], // east of the Ruins of Unkah
    [3306, 2730, 0], // the Necropolis
    [3359, 2832, 1], [3364, 2849, 2], [3048, 4694, 2], // the Agility Pyramid
  ]) {
    assert.equal(inHeat(at(x, y, z)), true, `${x},${y},${z}`);
  }
});

test("towns, the Shantay Pass and the world outside the desert stay cool", () => {
  const { inHeat } = DesertHeat._test;
  for (const [x, y, z] of [
    [3427, 2891, 0], [3426, 2906, 0], // Nardah, where captured players stood for minutes
    [3300, 2770, 0], // Sophanem
    [3220, 2760, 0], // Menaphos
    [3170, 2841, 0], // the Ruins of Unkah
    [3169, 3045, 0], // the Bedabin Camp
    [3304, 3117, 0], [3303, 3126, 0], // the Shantay Pass, north of its gate
    [3222, 3218, 0], // Lumbridge
    [3234, 9316, 0], // a dungeon under the desert
  ]) {
    assert.equal(inHeat(at(x, y, z)), false, `${x},${y},${z}`);
  }
});

test("armour shortens the timer by slot and clothing lengthens it, as captured", () => {
  const { heatInterval } = DesertHeat._test;
  // Captured: helmet -10, platebody -40, platelegs -30, shield -10; magic robes and their boots count for nothing.
  assert.equal(heatInterval(wearing()), 150);
  assert.equal(heatInterval(wearing("RUNE_FULL_HELM", "MYSTIC_ROBE_TOP", "RUNE_PLATELEGS")), 110);
  assert.equal(heatInterval(wearing("MYSTIC_HAT", "MYSTIC_ROBE_TOP", "MYSTIC_ROBE_BOTTOM")), 150);
  assert.equal(heatInterval(wearing("ETERNAL_BOOTS", "ARCANE_SPIRIT_SHIELD")), 140);
  assert.equal(heatInterval(wearing("ELIDINIS_WARD")), 140);
  assert.equal(heatInterval(wearing("RUNE_FULL_HELM", "RUNE_PLATEBODY", "RUNE_PLATELEGS", "RUNE_KITESHIELD",
    "FEROCIOUS_GLOVES", "PEGASIAN_BOOTS")), 40);
  assert.equal(heatInterval(wearing("FIGHTING_BOOTS")), 140);
  assert.equal(heatInterval(wearing("CIRCLET_OF_WATER")), 170);
  assert.equal(heatInterval(wearing("DESERT_SHIRT", "DESERT_ROBE", "DESERT_BOOTS")), 200);
  // Wiki: the prospector helmet adds 6 seconds although it is a helmet.
  assert.equal(heatInterval(wearing("PROSPECTOR_HELMET")), 160);
});

test("cactus cutting succeeds from about 12% at level 1 to 99% at 99", () => {
  const { cutChance } = Waterskins._test;
  assert.equal(cutChance(1), 0.12);
  assert.ok(Math.abs(cutChance(99) - 0.99) < 1e-9);
  assert.ok(cutChance(50) > cutChance(49));
});

test("the cactus tops up the emptiest skin that isn't full", () => {
  const { emptiestSkinSlot } = Waterskins._test;
  const slots = [id("WATERSKIN_4_"), id("WATERSKIN_2_"), id("WATERSKIN_1_")];
  const inventory = { getSlotForItemId: (itemId) => slots.indexOf(itemId) };
  assert.equal(emptiestSkinSlot(inventory), 2);
  assert.equal(emptiestSkinSlot({ getSlotForItemId: (itemId) => (itemId === id("WATERSKIN_4_") ? 0 : -1) }), -1);
});

test("sipping, pouring into and cactus-filling a waterskin keep each item's own meta", (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const player = new Player(new PlayerSession({ kind: "test", isOpen: () => true, send: () => true }))
    .setUsername("waterskinmeta").setIndex(3901);
  const preset = (name) => {
    const item = new core.Item(id(name), 1);
    for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) item.setMetaValue(meta, true);
    return item;
  };
  const isPreset = (slot) => player.getInventory().getItems()[slot]?.getMetaValue(core.Item.PRESET_META) === true;
  const inventory = player.getInventory();

  inventory.setItem(0, preset("WATERSKIN_4_"));
  assert.equal(DesertHeat._test.drinkWaterskin(player), true);
  assert.equal(inventory.getItems()[0].getId(), id("WATERSKIN_3_"), "sipped");
  assert.ok(isPreset(0), "the sipped skin is still preset");

  inventory.setItem(0, preset("WATERSKIN_0_"));
  inventory.setItem(1, preset("JUG_OF_WATER"));
  const event = { player, usedItemId: id("JUG_OF_WATER"), usedItemSlot: 1, usedWithItemId: id("WATERSKIN_0_"), usedWithItemSlot: 0, handled: false };
  Waterskins._test.pourIntoSkin(event);
  assert.equal(event.handled, true);
  assert.equal(inventory.getItems()[0].getId(), id("WATERSKIN_2_"), "two doses poured in");
  assert.equal(inventory.getItems()[1].getId(), id("JUG"));
  assert.ok(isPreset(0) && isPreset(1), "both the skin and the emptied jug keep their meta");

  inventory.setItem(0, preset("WATERSKIN_1_"));
  inventory.deleteAtSlot(1, 1);
  t.mock.method(Math, "random", () => 0);
  t.mock.method(core.ObjectManager, "register", () => {});
  t.mock.method(core.ObjectManager, "deregister", () => {});
  const cactus = new core.GameObject(2670, at(3300, 3000), 10, 0);
  Waterskins._test.finishCut(player, cactus, 2671, 911);
  assert.equal(inventory.getItems()[0].getId(), id("WATERSKIN_2_"), "topped up from the cactus");
  assert.ok(isPreset(0), "the topped-up skin is still preset");
});
