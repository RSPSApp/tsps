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

test("a weapon with no same-name relative still gets a two-handed gait", () => {
  // Reported in game: wielding a Gilded 2h sword or a Hill giant club left the player idling,
  // walking and running bare-handed. The server sends these into the appearance packet
  // (net/PlayerSession.ts), so a bare-hand row is what the client shows with a two-hander worn.
  const gait = (row) => ["blockAnim", "standAnim", "walkAnim", "runAnim"].map((field) => row[field]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  // A reskin: the cache gives it the rune 2h sword's own model, so it moves like it.
  assert.deepEqual(gait(ItemDefinition.forId(20155)), gait(byId.get(1319)), "Gilded 2h sword, like the Rune 2h sword");
  // The club has no relative to copy: the blunt two-handers (Granite maul, Tzhaar-ket-om) share
  // the maul gait, and the warhammer family, which wears in one hand, keeps the bare-handed one.
  assert.deepEqual(gait(ItemDefinition.forId(20756)), gait(byId.get(4153)), "Hill giant club, like the Granite maul");
  assert.notDeepEqual(gait(ItemDefinition.forId(20756)), gait(byId.get(1347)), "... not like a warhammer");
  assert.deepEqual(gait(byId.get(1347)), [424, 808, 819, 824], "a one-handed warhammer keeps the bare-hand gait");
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
    assert.equal(ItemDefinition.forId(id).isDoubleHanded(), true, `${id} two-handed`);
  }
});

test("a weapon is two-handed when the cache also wears it in the shield slot", () => {
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
    const cached = CacheDefinitions.getItem(id);
    if (cached.wearPos !== WEAPON_SLOT) continue;
    assert.equal(ItemDefinition.forId(id).isDoubleHanded(), cached.wearPos2 === Equipment.SHIELD_SLOT, `${id} ${cached.name}`);
  }
  // Reported in-game: the Soulreaper axe and a Noxious halberd were worn with an Avernic defender.
  for (const id of [25484, 28338, 33335, 29796, 33178]) {
    assert.equal(ItemDefinition.forId(id).isDoubleHanded(), true, `${id} ${ItemDefinition.forId(id).getName()}`);
  }
  // The Keris partisans are one-handed (Wiki), though the old export had them two-handed.
  for (const id of [27287, 27291, 22322]) {
    assert.equal(ItemDefinition.forId(id).isDoubleHanded(), false, `${id} ${ItemDefinition.forId(id).getName()}`);
  }
});

// The combat tab draws each style's icon from cache dbtable 78's fourth column. Those ids are
// sprites, not animations, but the partisan, banner and polestaff rows had them copied into
// `animation`: a Keris partisan attacked with rat_attack (240), a mjolnir with
// skeleton_trans_block (266). See docs/audits/weapons.md.
const COMBAT_STYLE_ICON_IDS = new Set([128, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246,
  247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270,
  271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291]);

test("no weapon type attacks with a combat-tab icon id", () => {
  for (const [name, weapon] of Object.entries(styles.weaponInterfaces)) {
    for (const key of weapon.fightTypes) {
      const animation = styles.fightTypes[key].animation;
      assert.ok(!COMBAT_STYLE_ICON_IDS.has(animation),
        `${name}.${key}: ${animation} is a style icon, not an animation`);
    }
  }
});

test("the audited weapon families animate with their own family", () => {
  // The spear's animations: the Keris partisan is a spear (docs/audits/weapons.md).
  assert.deepEqual(styles.weaponInterfaces.PARTISAN.fightTypes.map((key) => styles.fightTypes[key].animation),
    [2080, 2080, 2082, 2080], "barrows_war_spear_stab/_crush");
  // The banners' own animations, human_banner_spike 1428 and human_banner_block 1429.
  assert.deepEqual(styles.weaponInterfaces.BANNER.fightTypes.map((key) => styles.fightTypes[key].animation),
    [1428, 1428, 1428, 1429]);
  // The abyssal bludgeon's abyssal_bludgeon_crush, not the godsword's smash.
  assert.deepEqual(styles.weaponInterfaces.ABYSSAL_BLUDGEON.fightTypes.map((key) => styles.fightTypes[key].animation),
    [3298, 3298, 3298]);
  // The claws' dclaws_human_attack, not the axe's chop.
  assert.deepEqual(styles.weaponInterfaces.CLAWS.fightTypes.map((key) => styles.fightTypes[key].animation),
    [7527, 7527, 7527, 7527]);
  // The plain scythe (the Scythe of Vitur carries its own 8056): human_scythe_sweep.
  assert.deepEqual(styles.weaponInterfaces.SCYTHE.fightTypes.map((key) => styles.fightTypes[key].animation),
    [440, 440, 440, 440]);
  // The polestaff family has no animation of its own: the blunt pound, as the mace and warhammer.
  assert.deepEqual(styles.weaponInterfaces.POLESTAFF.fightTypes.map((key) => styles.fightTypes[key].animation),
    [401, 401, 401]);
});

test("gem machetes swing at the cache's 4 ticks, and the twisted bow at its 6", () => {
  // The machete/sickle/cane override put the gem machetes a tick slow (5) against the cache and
  // the Wiki (both 4); the twisted bow's override was 5 against the cache and the Wiki (both 6).
  for (const id of [6313, 6315, 6317]) {
    assert.equal(WeaponProfiles.attackSpeed(wielding(id, WeaponInterfaces.SCIMITAR), 4), 4, `${id}`);
  }
  assert.equal(WeaponProfiles.attackSpeed(wielding(20997, WeaponInterfaces.SHORTBOW), 4), 6);
});
