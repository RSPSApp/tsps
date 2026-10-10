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
  expectInterface([6760, 6762, 6764, 7804, 9044, 9050, 13074, 13078, 12439, 20251, 20254, 13141, 13144], "POLESTAFF");
  // Wiki (Skull sceptre): "changed from a polestaff to a staff".
  expectInterface([9013, 21276], "STAFF");
  expectInterface([4037, 4039, 8650, 8680, 11891, 11892], "BANNER");
  expectInterface([25979, 25981, 27287, 27288, 27291, 27292], "PARTISAN");
  expectInterface([12375, 12377, 12379], "MACE");
  // Wiki: the Dragon cane is a polestaff; the other canes are spiked.
  expectInterface([12373], "POLESTAFF");
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

test("chinchompas throw and block with their own animations", async () => {
  // attackAnimation reads the items cache, so the pipeline has to be up first.
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const { Item } = require("../dist/game/model/Item");
  const wielded = (weaponId) => {
    const items = Array.from({ length: 14 }, () => new Item(-1, 0));
    items[Equipment.WEAPON_SLOT] = new Item(weaponId, 1);
    return {
      getEquipment: () => ({ getItems: () => items }),
      getWeapon: () => WeaponInterfaces.CHINCHOMPA,
      // WeaponProfiles.attackAnimation resolves the fight type to pick the items per-attack-type anim.
      getFightType: () => FightType.CHINCHOMPA_MEDIUM_FUSE,
    };
  };

  // seq 2779 human_chinchompa_attack, the same throw for every fuse length
  for (const style of ["CHINCHOMPA_SHORT_FUSE", "CHINCHOMPA_MEDIUM_FUSE", "CHINCHOMPA_LONG_FUSE"]) {
    assert.equal(FightType[style].getAnimation(), 2779, `${style} throws human_chinchompa_attack`);
  }
  // ...except the black chinchompa, which has its own seq 7618 human_chinchompa_attack_pvn
  assert.equal(WeaponProfiles.attackAnimation(wielded(ItemIdentifiers.BLACK_CHINCHOMPA), 2779), 7618);
  for (const id of [ItemIdentifiers.CHINCHOMPA_2, ItemIdentifiers.RED_CHINCHOMPA_2]) {
    assert.equal(WeaponProfiles.attackAnimation(wielded(id), 2779), 2779, `item ${id} throws the style animation`);
  }
  // seq 3176 human_chinchompa_defend, the block anim Player.getBlockAnim reads off the weapon
  for (const id of [ItemIdentifiers.CHINCHOMPA_2, ItemIdentifiers.RED_CHINCHOMPA_2, ItemIdentifiers.BLACK_CHINCHOMPA]) {
    assert.equal(byId.get(id).blockAnim, 3176, `item ${id} blocks with human_chinchompa_defend`);
  }
});
