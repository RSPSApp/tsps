// Run after `yarn build`: node --test tests/weapon-styles.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { FightType } = require("../dist/game/content/combat/FightType");
const { FightStyle } = require("../dist/game/content/combat/FightStyle");
const { loadCombatStyleDefinitions } = require("../dist/game/content/combat/CombatStyleDefinitions");
const { RangedWeapon, Ammunition, RangedWeaponType } = require("../dist/game/content/combat/ranged/RangedData");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const items = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"),
);
const byId = new Map(items.map((item) => [item.id, item]));

const expectInterface = (ids, weaponInterface) => {
  for (const id of ids) {
    assert.equal(byId.get(id)?.weaponInterface, weaponInterface, `item ${id} (${byId.get(id)?.name})`);
  }
};

test("data-only weapon families carry a real weapon interface instead of unarmed", () => {
  expectInterface([975, 6313, 6315, 6317], "SCIMITAR");
  expectInterface([7140, 7141], "SCIMITAR");
  expectInterface([2961, 2963, 3899], "SCIMITAR");
  expectInterface([10440, 10442, 10444, 12199, 12200, 12263, 12264, 12275, 12276, 9084], "STAFF");
  expectInterface([6760, 6762, 6764, 7804, 9013, 9044, 9050, 13074, 13078, 12439, 20251, 20254, 13141, 13144], "POLESTAFF");
  expectInterface([4037, 4039, 8650, 8680, 11891, 11892], "BANNER");
  expectInterface([25979, 25981, 27287, 27288, 27291, 27292], "PARTISAN");
  expectInterface([12373, 12375, 12377, 12379], "MACE");
  expectInterface([4827, 10280, 10282, 10284], "SHORTBOW");
  expectInterface([10033, 10034, 11959], "CHINCHOMPA");
  expectInterface([10146, 10147, 10148, 10149], "SALAMANDER");
});

test("the new weapon interfaces exist and take their styles from their cache category", () => {
  const definitions = loadCombatStyleDefinitions();
  const expected = {
    PARTISAN: { category: 30, styles: ["PARTISAN_STAB", "PARTISAN_LUNGE", "PARTISAN_POUND", "PARTISAN_BLOCK"] },
    BANNER: { category: 25, styles: ["BANNER_STAB", "BANNER_LUNGE", "BANNER_POUND", "BANNER_BLOCK"] },
    POLESTAFF: { category: 13, styles: ["POLESTAFF_BASH", "POLESTAFF_POUND", "POLESTAFF_BLOCK"] },
    SALAMANDER: { category: 6, styles: ["SALAMANDER_SCORCH", "SALAMANDER_FLARE", "SALAMANDER_BLAZE"] },
    CHINCHOMPA: { category: 7, styles: ["CHINCHOMPA_SHORT_FUSE", "CHINCHOMPA_MEDIUM_FUSE", "CHINCHOMPA_LONG_FUSE"] },
  };
  for (const [name, spec] of Object.entries(expected)) {
    const definition = definitions.weaponInterfaces[name];
    assert.ok(definition, `${name} interface`);
    assert.equal(definition.category, spec.category, `${name} cache category`);
    assert.deepEqual(definition.fightTypes, spec.styles, `${name} fight types`);
    for (const style of spec.styles) {
      assert.ok(definitions.fightTypes[style], `${style} definition`);
    }
    assert.ok(WeaponInterfaces[name], `${name} registry entry`);
  }
  assert.equal(WeaponInterfaces.POLESTAFF.getSpeed(), 6);
  assert.equal(WeaponInterfaces.BANNER.getSpeed(), 5);
  assert.equal(WeaponInterfaces.PARTISAN.getSpeed(), 4);
});

test("salander flare and chinchompa medium fuse are the rapid styles", () => {
  assert.equal(FightType.SALAMANDER_FLARE.isRapid(), true);
  assert.equal(FightType.CHINCHOMPA_MEDIUM_FUSE.isRapid(), true);
  assert.equal(FightType.SALAMANDER_SCORCH.isRapid(), false);
  assert.equal(FightType.CHINCHOMPA_SHORT_FUSE.isRapid(), false);
  assert.equal(FightType.SALAMANDER_BLAZE.getStyle(), FightStyle.DEFENSIVE);
});

test("all thrownaxe tiers and composite bows resolve a ranged weapon type", () => {
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.BRONZE_THROWNAXE), Ammunition.BRONZE_THROWNAXE);
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.ADAMANT_THROWNAXE), Ammunition.ADAMANT_THROWNAXE);
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.RUNE_THROWNAXE), Ammunition.RUNE_THROWNAXE);
  assert.equal(Ammunition.BRONZE_THROWNAXE.getStrength(), 5);
  assert.equal(Ammunition.RUNE_THROWNAXE.getStrength(), 36);
  assert.equal(Ammunition.DRAGON_THROWNAXE.getStrength(), 47);
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.CHINCHOMPA_2), Ammunition.CHINCHOMPA);
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.BLACK_CHINCHOMPA), Ammunition.BLACK_CHINCHOMPA);
  assert.equal(RangedWeaponType.CHINCHOMPA.getDefaultDistance(), 9);
  assert.equal(RangedWeaponType.SALAMANDER.getDefaultDistance(), 1);
});
