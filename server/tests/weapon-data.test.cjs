// Run after `yarn build`: node --test tests/weapon-data.test.cjs
// Every weapon in the cache has a weapon type (scripts/sync-weapon-types.ts), attack speed comes
// from the cache, and a weapon's own attack animation (attackAnim) beats its type's.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

const DEFINITIONS = path.resolve(__dirname, "../data/definitions");
const rows = JSON.parse(fs.readFileSync(path.join(DEFINITIONS, "item-gameplay.json"), "utf8"));
const styles = JSON.parse(fs.readFileSync(path.join(DEFINITIONS, "item-combat-styles.json"), "utf8"));
const WEAPON_SLOT = 3;

/** Weapons left without a type on purpose (docs/weapon-data.md). */
const UNTYPED = new Map([
  [30390, "Nature's reprisal: multi-style, attacks change method with the style"],
  [30392, "Nature's reprisal (uncharged)"],
  [494, "Broken axe"], [496, "Broken axe"], [498, "Broken axe"], [500, "Broken axe"],
  [502, "Broken axe"], [504, "Broken axe"], [506, "Broken axe"], [6741, "Broken axe"],
  [10029, "Teasing stick: no Wiki combat style"],
  [30320, "Arrav's axe: quest item, no Wiki combat style"],
]);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

function cacheWeapons() {
  const weapons = [];
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
    const item = CacheDefinitions.getItem(id);
    if (!item?.name || item.name.toLowerCase() === "null" || item.wearPos !== WEAPON_SLOT) continue;
    if (item.noteTemplate !== -1 || item.placeholderTemplate !== -1) continue;
    if (item.params?.get(ItemDefinition.ATTACK_SPEED_PARAM) === undefined) continue;
    weapons.push(item);
  }
  return weapons;
}

function wielding(itemId, weaponInterface, fightType = null) {
  const items = [];
  items[Equipment.WEAPON_SLOT] = { getId: () => itemId, getDefinition: () => ItemDefinition.forId(itemId) };
  return { getEquipment: () => ({ getItems: () => items }), getWeapon: () => weaponInterface, getFightType: () => fightType };
}

test("every weapon in the cache has a weapon type, on a row the loader reads", () => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = [];
  for (const item of cacheWeapons()) {
    if (UNTYPED.has(item.id)) continue;
    const row = byId.get(item.id);
    if (!row || row.name !== item.name || !styles.weaponInterfaces[row.weaponInterface]) missing.push(`${item.name} (${item.id})`);
  }
  assert.deepEqual(missing, [], "run yarn sync:weapon-types");
});

test("every weapon type is a cache weapon category with its styles", () => {
  for (const [name, weapon] of Object.entries(styles.weaponInterfaces)) {
    assert.ok(weapon.fightTypes.length > 0, name);
    for (const key of weapon.fightTypes) assert.ok(styles.fightTypes[key], `${name}: ${key}`);
  }
  assert.equal(styles.weaponInterfaces.ELDER_MAUL.category, styles.weaponInterfaces.WARHAMMER.category, "the Elder maul is blunt");
});

test("a copy of a weapon has its original's type and stance", () => {
  // Granite maul 24225 (a copy) was a warhammer on the human stance, like no Granite maul.
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of [24225, 24227, 20557]) {
    assert.equal(byId.get(id).weaponInterface, "GRANITE_MAUL", `${id}`);
    assert.equal(byId.get(id).standAnim, byId.get(4153).standAnim, `${id} stance`);
  }
});

test("attack speed is the cache's for the item, ahead of its weapon type's", () => {
  // Scythe of Vitur: 5 (cache and Wiki), not the scythe type's 4; the plain Scythe: 7.
  assert.equal(WeaponProfiles.attackSpeed(wielding(22325, WeaponInterfaces.SCYTHE), 4), 5);
  assert.equal(WeaponProfiles.attackSpeed(wielding(1419, WeaponInterfaces.SCYTHE), 4), 7);
  assert.equal(WeaponProfiles.attackSpeed(wielding(-1, WeaponInterfaces.UNARMED), 4), 4, "unarmed keeps the fallback");
});

test("a weapon's own attack animation beats its type's", () => {
  const scythe = rows.find((row) => row.id === 22325);
  assert.equal(scythe.attackAnim, 8056, "scythe_of_vitur_attack");
  assert.equal(WeaponProfiles.attackAnimation(wielding(22325, WeaponInterfaces.SCYTHE), 414), 8056);
  assert.equal(WeaponProfiles.attackAnimation(wielding(1419, WeaponInterfaces.SCYTHE), 414), 414, "no attackAnim: the style's");
  // Soulreaper axe: ancient_axe_slash for slash styles, ancient_axe_crush for crush.
  const { FightType } = require("../dist/game/content/combat/FightType");
  assert.equal(WeaponProfiles.attackAnimation(wielding(28338, WeaponInterfaces.BATTLEAXE, FightType.BATTLEAXE_HACK), 395), 10171);
  assert.equal(WeaponProfiles.attackAnimation(wielding(28338, WeaponInterfaces.BATTLEAXE, FightType.BATTLEAXE_SMASH), 401), 10172);
});

test("crossbows, ballistas and chinchompas use the cache's separate animation against NPCs", () => {
  const { FightType } = require("../dist/game/content/combat/FightType");
  const rune = wielding(9185, WeaponInterfaces.CROSSBOW, FightType.CROSSBOW_RAPID);
  assert.equal(WeaponProfiles.attackAnimation(rune, 4230, false), 4230, "xbows_human_fire_and_reload on players");
  assert.equal(WeaponProfiles.attackAnimation(rune, 4230, true), 7552, "..._pvn on NPCs");
  assert.equal(FightType.BALLISTA_RAPID.getAnimationAgainst(true), 7555);
  assert.equal(FightType.CHINCHOMPA_SHORT_FUSE.getAnimationAgainst(false), 2779);
  assert.equal(FightType.CHINCHOMPA_SHORT_FUSE.getAnimationAgainst(true), 7618);
  assert.equal(FightType.DAGGER_STAB.getAnimation(), 386, "human_sword_stab, not a mace's spike");
});

test("one arrow drawn on a bow, two on the dark bow (the cache's launch graphics)", () => {
  const { Ammunition } = require("../dist/game/content/combat/ranged/RangedData");
  // dragon_arrow_launch, as live OSRS sends with the twisted bow; double_dragon_arrow_launch.
  assert.equal(Ammunition.DRAGON_ARROW.getStartGraphic().getId(), 1116);
  assert.equal(Ammunition.DRAGON_ARROW.getDoubleStartGraphic().getId(), 1111);
  assert.equal(Ammunition.RUNE_ARROW.getDoubleStartGraphic().getId(), 1109, "double_rune_arrow_launch");
  assert.equal(WeaponProfiles.get(wielding(11235, WeaponInterfaces.DARK_BOW)).doubleStartGraphic, true);
  assert.notEqual(WeaponProfiles.get(wielding(20997, WeaponInterfaces.SHORTBOW))?.doubleStartGraphic, true, "the twisted bow");
});

test("issue #461: scimitars stab on Lunge, and the Colossal blade has the giant weapon stance", () => {
  // Seen in game: Lunge is human_sword_stab (386), as the swords' stab, not the slash.
  assert.equal(styles.fightTypes.SCIMITAR_LUNGE.animation, 386);
  assert.equal(styles.fightTypes.SCIMITAR_LUNGE.attackType, "STAB");
  const blade = rows.find((row) => row.id === 27021);
  // human_weapon_giant01_ready / _walk / _run, released with the blade (Giants' Foundry).
  assert.deepEqual([blade.standAnim, blade.walkAnim, blade.runAnim], [9460, 9461, 9459]);
});

test("Tumeken's shadow is held two-handed, all four variants", () => {
  // The wiki's equipped image holds the staff in both hands; the cache's TOA_SOT_READY
  // sits with its cast anims (TOA_SOT_CAST_A/B). The cache has no TOA_SOT gait, so it
  // moves with the staff's own walk/run (the same pair the staff uses one-handed).
  for (const id of [27275, 27277, 28547, 28549]) {
    const shadow = rows.find((row) => row.id === id);
    assert.equal(shadow.standAnim, 9494, `${id} toa_sot_ready`);
    assert.equal(shadow.walkAnim, 1146, `${id} staff walk`);
    assert.equal(shadow.runAnim, 1210, `${id} staff run`);
    assert.equal(shadow.doubleHanded, true, `${id} two-handed`);
  }
});
