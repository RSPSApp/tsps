// Run after `yarn build`: node --test tests/custom-item-special-attack.test.cjs
// custom-items.json `specialAttack` { from, energy? }: a custom weapon uses item `from`'s special
// attack, at its own `energy` percent or else at what that special costs for `from`.
const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { validateSpecialAttack } = require("../plugins/items/ItemDefinitionLoader.plugin")._test;

const SOURCE = 999901, SOURCE_VARIANT = 999902, OTHER = 999903;
const special = CombatSpecial.register({
  id: "custom-item-special-test",
  itemIds: [SOURCE, SOURCE_VARIANT],
  drainAmount: 50,
  drainAmountByItemId: { [SOURCE_VARIANT]: 25 },
  strengthMultiplier: 1,
  accuracyMultiplier: 1,
  combatMethod: { type() {} },
});

test("a custom weapon uses the special of the item it names", () => {
  CombatSpecial.borrow(59001, SOURCE);
  assert.equal(CombatSpecial.getForWeaponId(59001), special);
  assert.equal(CombatSpecial.getForWeaponId(OTHER), null, "anything else has none");
});

test("its cost is its own energy, else what the special costs for that item", () => {
  CombatSpecial.borrow(59002, SOURCE);
  CombatSpecial.borrow(59003, SOURCE_VARIANT);
  CombatSpecial.borrow(59004, SOURCE, 35);
  assert.equal(special.getDrainAmountForWeaponId(59002), 50);
  assert.equal(special.getDrainAmountForWeaponId(59003), 25, "the named item's own cost");
  assert.equal(special.getDrainAmountForWeaponId(59004), 35);
  assert.equal(special.getDrainAmountForWeaponId(SOURCE), 50, "the special's own items keep theirs");
});

test("a borrow made before the special is registered still resolves", () => {
  CombatSpecial.borrow(59005, OTHER);
  assert.equal(CombatSpecial.getForWeaponId(59005), null);
  const later = CombatSpecial.register({
    id: "custom-item-special-later", itemIds: [OTHER], drainAmount: 100, strengthMultiplier: 1, accuracyMultiplier: 1,
    combatMethod: { type() {} },
  });
  assert.equal(CombatSpecial.getForWeaponId(59005), later);
});

test("custom-items.json rejects a malformed specialAttack", () => {
  const ok = (specialAttack) => validateSpecialAttack({ id: 50002, specialAttack });
  ok({ from: 29000 });
  ok({ from: 29000, energy: 50 });
  for (const bad of [29000, [29000], {}, { from: "29000" }, { from: 50002 }, { from: 29000, energy: 0 },
    { from: 29000, energy: 101 }, { from: 29000, energy: 12.5 }, { from: 29000, cost: 50 }]) {
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
    { id: 59101, objType: { name: "Plain" } },
  ]);
  const rows = new Map(CacheDefinitions.getCustomItems().map((row) => [row.id, row]));
  assert.deepEqual(rows.get(59100).specialAttack, { from: 29000, energy: 40 });
  assert.equal(rows.get(59101).specialAttack, undefined);
});
