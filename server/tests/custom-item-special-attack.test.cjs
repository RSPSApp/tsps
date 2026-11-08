// Run after `yarn build`: node --test tests/custom-item-special-attack.test.cjs
// custom-items.json `specialAttack` { from?, energy? }: a custom weapon gets a special attack bar.
// With `from` it uses that item's special attack; without it, the special a plugin registers for
// the weapon itself. `energy` is its cost in percent, else what its special costs.
const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { validateSpecialAttack } = require("../plugins/items/ItemDefinitionLoader.plugin")._test;

const SOURCE = 999901, SOURCE_VARIANT = 999902, OTHER = 999903;
const special = (id, itemIds, drainAmount, extra = {}) => CombatSpecial.register({
  id, itemIds, drainAmount, strengthMultiplier: 1, accuracyMultiplier: 1, combatMethod: { type() {} }, ...extra,
});
const borrowed = special("custom-item-special-test", [SOURCE, SOURCE_VARIANT], 50, { drainAmountByItemId: { [SOURCE_VARIANT]: 25 } });

test("a custom weapon uses the special of the item it names", () => {
  CombatSpecial.setItemSpecial(59001, { from: SOURCE });
  assert.equal(CombatSpecial.getForWeaponId(59001), borrowed);
  assert.equal(CombatSpecial.getForWeaponId(OTHER), null, "anything else has none");
});

test("its cost is its own energy, else what the special costs for that item", () => {
  CombatSpecial.setItemSpecial(59002, { from: SOURCE });
  CombatSpecial.setItemSpecial(59003, { from: SOURCE_VARIANT });
  CombatSpecial.setItemSpecial(59004, { from: SOURCE, drainAmount: 35 });
  assert.equal(borrowed.getDrainAmountForWeaponId(59002), 50);
  assert.equal(borrowed.getDrainAmountForWeaponId(59003), 25, "the named item's own cost");
  assert.equal(borrowed.getDrainAmountForWeaponId(59004), 35);
  assert.equal(borrowed.getDrainAmountForWeaponId(SOURCE), 50, "the special's own items keep theirs");
});

test("a borrow made before the special is registered still resolves", () => {
  CombatSpecial.setItemSpecial(59005, { from: OTHER });
  assert.equal(CombatSpecial.getForWeaponId(59005), null);
  const later = special("custom-item-special-later", [OTHER], 100);
  assert.equal(CombatSpecial.getForWeaponId(59005), later);
});

// The Sanguine atlatl case: its own bar at 50% and its own special from a plugin, not the Eclipse
// atlatl's. Registered after the settings, as plugins/combat/specials loads after the items.
test("a bar-only weapon uses the special a plugin registers for it, at its energy", () => {
  CombatSpecial.setItemSpecial(59006, { drainAmount: 50 });
  assert.equal(CombatSpecial.getForWeaponId(59006), null, "no special until a plugin registers one");
  const own = special("custom-item-own-special", [59006], 30);
  assert.equal(CombatSpecial.getForWeaponId(59006), own);
  assert.equal(own.getDrainAmountForWeaponId(59006), 50, "custom-items.json energy is the cost");

  CombatSpecial.setItemSpecial(59007, { from: SOURCE });
  const ownFirst = special("custom-item-own-first", [59007], 40);
  assert.equal(CombatSpecial.getForWeaponId(59007), ownFirst, "a special of its own comes before `from`");
  assert.equal(ownFirst.getDrainAmountForWeaponId(59007), 40, "and costs its own drain");
});

test("custom-items.json rejects a malformed specialAttack", () => {
  const ok = (specialAttack) => validateSpecialAttack({ id: 50002, specialAttack });
  ok({ from: 29000 });
  ok({ from: 29000, energy: 50 });
  ok({ energy: 50 });
  for (const bad of [29000, [29000], {}, { from: "29000" }, { from: 50002 }, { from: 29000, energy: 0 },
    { energy: 101 }, { energy: 12.5 }, { from: 29000, cost: 50 }]) {
    assert.throws(() => ok(bad), /invalid specialAttack for item 50002/, JSON.stringify(bad));
  }
});

test("the stored custom item keeps specialAttack, for the loader and the client", async () => {
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  CacheDefinitions.registerCustomItems([
    { id: 59100, baseItemId: 29000, objType: { name: "Test atlatl" }, specialAttack: { from: 29000, energy: 40 } },
    { id: 59101, objType: { name: "Own special" }, specialAttack: { energy: 50 } },
    { id: 59102, objType: { name: "Plain" } },
  ]);
  const rows = new Map(CacheDefinitions.getCustomItems().map((row) => [row.id, row]));
  assert.deepEqual(rows.get(59100).specialAttack, { from: 29000, energy: 40 });
  assert.deepEqual(rows.get(59101).specialAttack, { energy: 50 });
  assert.equal(rows.get(59102).specialAttack, undefined);
});

test("real specials spend the custom cost, retaining modifiers, inherited variants and direct drains", async t => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  await core.CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const api = { core, registerCombatSpecial: CombatSpecial.register, emitCustomEvent() {} };
  require("../plugins/combat/specials/DragonDagger.SpecialAttack")(api);
  require("../plugins/combat/specials/DragonAxe.SpecialAttack")(api);
  require("../plugins/combat/specials/EclipseAtlatl.SpecialAttack")(api);
  t.mock.method(CombatSpecial, "updateBar", () => {});
  t.mock.method(core.Sounds, "sendSound", () => {});
  t.mock.method(core.Sounds, "playAreaSound", () => {});
  const phases = [];
  let halfCost = false;
  let equipmentDiscount = 0;
  require("../dist/game/content/combat/EquipmentEffects").registerSpecialEnergyCostModifier((_entity, cost) => cost - equipmentDiscount);
  t.after(() => { equipmentDiscount = 0; });
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (name === "combat-special:cost") { phases.push([event.phase, event.cost]); if (halfCost) event.cost /= 2; }
  });
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true }));
  player.setRecoveringSpecialAttack(true);
  const wield = (id) => {
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id));
    player.setCombatSpecial(CombatSpecial.getForWeaponId(id));
    player.setSpecialPercentage(100);
    return player.getCombatSpecial();
  };
  for (const [id, from, energy] of [[59200, core.ItemIdentifiers.DRAGON_DAGGER, 40], [59201, core.ItemIdentifiers.DRAGON_AXE, 35], [59202, core.ItemIdentifiers.ECLIPSE_ATLATL, 30]]) {
    CombatSpecial.setItemSpecial(id, { from, drainAmount: energy });
    const special = wield(id);
    assert.equal(CombatSpecial.energyCost(player, special), energy);
    special.getCombatMethod().start(player, player);
    assert.equal(player.getSpecialPercentage(), 100 - energy, `the actual special spends ${energy}%`);
  }
  const dagger = wield(59200);
  halfCost = true;
  assert.equal(CombatSpecial.energyCost(player, dagger), 20);
  dagger.getCombatMethod().start(player, player);
  assert.equal(player.getSpecialPercentage(), 80, "content modifiers apply to the configured cost once");
  assert.ok(phases.some(([phase, cost]) => phase === "drain" && cost === 40));
  equipmentDiscount = 10;
  wield(59200);
  assert.equal(CombatSpecial.energyCost(player, dagger), 15);
  dagger.getCombatMethod().start(player, player);
  assert.equal(player.getSpecialPercentage(), 85, "equipment and content modifiers compose once on the custom cost");
  CombatSpecial.drain(player, 7, false);
  assert.equal(player.getSpecialPercentage(), 78, "non-cost drains bypass both custom cost and modifiers");
  halfCost = false;
  equipmentDiscount = 0;
  const native = wield(core.ItemIdentifiers.DRAGON_DAGGER);
  native.getCombatMethod().start(player, player);
  assert.equal(player.getSpecialPercentage(), 75, "native costs stay unchanged");
  CombatSpecial.setItemSpecial(59203, { drainAmount: 45 });
  const own = special("custom-item-drain-own", [59203], 25);
  wield(59203);
  CombatSpecial.drain(player, own.getDrainAmount());
  assert.equal(player.getSpecialPercentage(), 55, "own registered specials also use their configured cost");
  CombatSpecial.setItemSpecial(59204, { from: SOURCE_VARIANT });
  wield(59204);
  CombatSpecial.drain(player, borrowed.getDrainAmount());
  assert.equal(player.getSpecialPercentage(), 75, "a copied variant inherits its variant cost without an override");
});
