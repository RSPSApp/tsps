// Run after `yarn build`: node --test tests/projectile-audit.test.cjs
// Projectile audit regression: player ammunition must use the cache's travel spotanim, and a
// projectile must always be in flight after it launches. The reported bug (#1808) was the
// ballista special firing the dragon javelin's model (1301) with an end before its start, so it
// appeared on the player for one client cycle and vanished.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Ammunition, RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { RangedCombatMethod } = require("../dist/game/content/combat/method/impl/RangedCombatMethod");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { CombatPoisonData } = require("../dist/game/task/impl/CombatPoisonEffect");

function playerWith(weaponId, weaponInterface, ammo) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => weaponId };
  items[Equipment.AMMUNITION_SLOT] = { getId: () => ammo.getItemId() };
  return {
    getEquipment: () => ({ getItems: () => items }),
    getWeapon: () => weaponInterface,
    getCombat: () => ({ getAmmunition: () => ammo }),
  };
}

test("ammunition uses the cache travel spotanim", () => {
  assert.equal(Ammunition.BROAD_ARROW.getProjectileId(), 326, "slayer_broad_arrow_travel");
  assert.equal(Ammunition.BROAD_ARROW.getStartGraphic().getId(), 325, "slayer_broad_arrow_launch");
  assert.equal(Ammunition.RUNE_JAVELIN.getProjectileId(), 205, "rune_javelin_travel");
  assert.equal(Ammunition.AMETHYST_JAVELIN.getProjectileId(), 1386, "amethyst_javelin_travel");
  assert.equal(Ammunition.AMETHYST_JAVELIN.getStrength(), 135, "Wiki: +135 ranged strength");
  assert.equal(Ammunition.MORRIGANS_JAVELIN.getProjectileId(), 1620, "morrigans_javelin_travel");
  assert.equal(Ammunition.SILVTHRILL_JAVELIN.getProjectileId(), 3806, "silvthrill_javelin_travel");
  assert.ok(RangedWeapon.BALLISTA.getAmmunitionData().includes(Ammunition.AMETHYST_JAVELIN));
  assert.equal(Ammunition.getForItem(836), Ammunition.RUNE_JAVELINS[1], "rune javelin(p)");
  assert.equal(Ammunition.getForItem(21324), Ammunition.AMETHYST_JAVELINS[3], "amethyst javelin(p++)");
  assert.equal(RangedWeapon.BALLISTA.getAmmunitionData().length, 32, "8 javelins x 4 poison states");
});

test("crossbow bolts have no launch graphic (live OSRS sends only the travel spotanim)", () => {
  for (const ammo of [
    Ammunition.BRONZE_BOLT,
    Ammunition.RUNITE_BOLT,
    Ammunition.DIAMOND_BOLT,
    Ammunition.DRAGON_BOLT,
    Ammunition.ONYX_BOLT,
    Ammunition.BONE_BOLT,
  ]) {
    assert.equal(ammo.getStartGraphic(), null, `${ammo.getItemId()} launch`);
  }
});

test("poisoned and lit ammunition fires as its plain ammunition", () => {
  const variants = [
    [Ammunition.RUNITE_BOLT, [9291, 9298, 9305]],
    [Ammunition.BRONZE_BOLT, [878, 6061, 6062]],
    [Ammunition.SILVER_BOLT, [9292, 9299, 9306]],
    [Ammunition.DRAGON_BOLTS, [21924, 21926, 21928]],
    [Ammunition.RUNE_ARROW, [893, 5621, 5627, 2541]],
    [Ammunition.DRAGON_ARROW, [11227, 11228, 11229, 11222]],
    [Ammunition.AMETHYST_ARROW, [21332, 21334, 21336, 21330]],
    [Ammunition.BROAD_BOLT, [ItemIdentifiers.BROAD_BOLTS, ItemIdentifiers.AMETHYST_BROAD_BOLTS]],
  ];
  for (const [ammunition, itemIds] of variants) {
    for (const itemId of itemIds) assert.equal(Ammunition.getForItem(itemId), ammunition, `item ${itemId}`);
  }
  assert.equal(Ammunition.getForItem(ItemIdentifiers.MAX_CAPE), undefined, "broad bolts were on the Max cape's id");
});

test("every poisoned bolt, arrow and dart carries a poison type", () => {
  CombatPoisonData.init();
  const poisoned = [
    878, 6061, 6062, 9286, 9293, 9300, 9287, 9294, 9301, 9292, 9299, 9306, 9288, 9295, 9302, 9289, 9296, 9303,
    9290, 9297, 9304, 9291, 9298, 9305, 21924, 21926, 21928,
    883, 5616, 5622, 885, 5617, 5623, 887, 5618, 5624, 889, 5619, 5625, 891, 5620, 5626, 893, 5621, 5627,
    21332, 21334, 21336, 11227, 11228, 11229,
    812, 5628, 5635, 813, 5629, 5636, 814, 5630, 5637, 3094, 5631, 5638, 815, 5632, 5639, 816, 5633, 5640,
    817, 5634, 5641, 11231, 11233, 11234, 25851, 25855, 25857,
  ];
  for (const itemId of poisoned) {
    assert.ok(CombatPoisonData.getPoisonType({ getId: () => itemId, getAmount: () => 1 }) != null, `item ${itemId}`);
  }
});

test("poisoned darts and the missing crossbows are ranged weapons", () => {
  const weaponFor = (weaponId) => {
    const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
    items[Equipment.WEAPON_SLOT] = { getId: () => weaponId };
    return RangedWeapon.getFor({ getEquipment: () => ({ getItems: () => items }) });
  };
  assert.equal(weaponFor(817), RangedWeapon.RUNE_DART, "rune dart(p)");
  assert.equal(RangedWeapon.getSelfAmmo(5641), Ammunition.RUNE_DART, "rune dart(p++) is its own ammunition");
  assert.equal(weaponFor(11234), RangedWeapon.DRAGON_DART, "dragon dart(p++)");
  assert.equal(weaponFor(25857), RangedWeapon.AMETHYST_DART, "amethyst dart(p++)");
  assert.equal(weaponFor(4935), RangedWeapon.KARILS_CROSSBOW, "Karil's crossbow 75");
  assert.equal(weaponFor(ItemIdentifiers.RUNE_CROSSBOW_OR_), RangedWeapon.RUNE_CROSSBOW);
  assert.equal(weaponFor(28053), RangedWeapon.DRAGON_CROSSBOW, "dragon crossbow (cr)");

  const fires = (weapon, ammunition) => weapon.getAmmunitionData().includes(ammunition);
  assert.ok(fires(RangedWeapon.CROSSBOW, Ammunition.BRONZE_BOLT));
  assert.ok(!fires(RangedWeapon.CROSSBOW, Ammunition.IRON_BOLT), "Wiki: bronze bolts only");
  assert.ok(fires(RangedWeapon.BLURITE_CROSSBOW, Ammunition.BLURITE_BOLT));
  assert.ok(!fires(RangedWeapon.BRONZE_CROSSBOW, Ammunition.BLURITE_BOLT));
  assert.ok(fires(RangedWeapon.IRON_CROSSBOW, Ammunition.SILVER_BOLT), "Wiki: iron crossbow or better");
  assert.ok(fires(RangedWeapon.RUNE_CROSSBOW, Ammunition.BROAD_BOLT));
  assert.ok(!fires(RangedWeapon.ADAMANT_CROSSBOW, Ammunition.BROAD_BOLT), "Wiki: rune crossbow or better");
  assert.ok(!fires(RangedWeapon.DORGESHUUN_CROSSBOW, Ammunition.SILVER_BOLT), "Wiki: except silver bolts");
  assert.ok(fires(RangedWeapon.HUNTERS_CROSSBOW, Ammunition.LONG_KEBBIT_BOLT));
  assert.ok(!fires(RangedWeapon.HUNTERS_SUNLIGHT_CROSSBOW, Ammunition.KEBBIT_BOLT), "Wiki: antler bolts only");
  assert.ok(fires(RangedWeapon.OGRE_BOW, Ammunition.MITHRIL_BRUTAL));
  assert.ok(!fires(RangedWeapon.OGRE_BOW, Ammunition.ADAMANT_BRUTAL), "Wiki: up to mithril");
  assert.ok(fires(RangedWeapon.COMP_OGRE_BOW, Ammunition.RUNE_BRUTAL));
});

test("a bogus end is never sent as a one-cycle flash", () => {
  const sent = [];
  const player = {
    getPrivateArea: () => null,
    getSession: () => ({ sendClientPacket: (packet) => { sent.push(packet); return true; } }),
  };
  const sender = new PacketSender(player);
  sender.sendProjectile(new Location(3200, 3200, 0), new Location(3209, 3200, 0), 0, 30, 1301, 43, 31, null, 70);
  assert.equal(sent.length, 1);
  const endCycleOffset = sent[0].subarray(sent[0].length - 29).readUInt16BE(21);
  assert.ok(endCycleOffset > 71, `got ${endCycleOffset}`);
  assert.equal(endCycleOffset, 70 + 5 + 9 * 5);
});

test("the ballista trajectory is the captured one and every shot gets a lifetime", () => {
  const player = playerWith(19481, WeaponInterfaces.BALLISTA, Ammunition.RUNE_JAVELIN);
  const profile = WeaponProfiles.ranged(player);
  const shot = profile.projectiles[0];
  assert.deepEqual(
    { delay: shot.delay, length: shot.lengthAdjustment, perTile: shot.stepMultiplier, angle: shot.angle, progress: shot.progress },
    { delay: 42, length: 2, perTile: 3, angle: 14, progress: 120 },
  );
  assert.deepEqual([shot.startHeight * 4, shot.endHeight * 4], [155, 177], "RSProx 4288");
  for (let distance = 1; distance <= 10; distance++) {
    assert.equal(RangedCombatMethod.projectileEnd(shot, distance), 44 + 3 * distance);
    assert.ok(RangedCombatMethod.projectileEnd(shot, distance) > shot.delay, `distance ${distance}`);
  }
});

test("bow, crossbow and dart heights match the captured packet values", () => {
  const height = (weapon, weaponInterface, ammo) => {
    const shot = WeaponProfiles.ranged(playerWith(weapon, weaponInterface, ammo)).projectiles[0];
    return [shot.startHeight * 4, shot.endHeight * 4];
  };
  assert.deepEqual(height(859, WeaponInterfaces.LONGBOW, Ammunition.RUNE_ARROW), [163, 146], "arrow_travel");
  assert.deepEqual(height(9185, WeaponInterfaces.CROSSBOW, Ammunition.RUNITE_BOLT), [155, 146], "crossbowbolt_travel");
  assert.deepEqual(height(12926, WeaponInterfaces.BLOWPIPE, Ammunition.RUNE_DART), [142, 146], "rune_dart_travel");
});

test("every crossbow fires bolts on the captured arc", () => {
  const crossbows = [
    ["rune crossbow", 9185, WeaponInterfaces.CROSSBOW, Ammunition.RUNITE_BOLT],
    ["Armadyl crossbow", 11785, WeaponInterfaces.CROSSBOW, Ammunition.DRAGON_BOLT],
    ["Karil's crossbow", 4734, WeaponInterfaces.KARILS_CROSSBOW, Ammunition.BOLT_RACK],
    ["dragon crossbow", 21902, WeaponInterfaces.CROSSBOW, Ammunition.DRAGON_BOLT],
    ["Ascension crossbows", ItemIdentifiers.ASCENSION_CROSSBOWS, WeaponInterfaces.CROSSBOW, Ammunition.ASCENSION_BOLT],
  ];
  for (const [name, weaponId, weaponInterface, ammo] of crossbows) {
    const shot = WeaponProfiles.ranged(playerWith(weaponId, weaponInterface, ammo)).projectiles[0];
    assert.deepEqual(
      { start: shot.delay, end: RangedCombatMethod.projectileEnd(shot, 7), angle: shot.angle, progress: shot.progress, heights: [shot.startHeight * 4, shot.endHeight * 4] },
      { start: 41, end: 81, angle: 5, progress: 11, heights: [155, 146] },
      name,
    );
  }
});

test("Armadyl Eye keeps the captured flat 41 -> 75", () => {
  const launched = [];
  class FakeProjectile {
    static createProjectile(...args) { launched.push(args); return new FakeProjectile(); }
    withAngle() { return this; }
    withProgress() { return this; }
    sendProjectile() { return this; }
  }
  let registered;
  const api = {
    core: {
      Animation: class {},
      CombatFactory: { checkAmmo: () => true, decrementAmmo: () => {} },
      CombatSpecial: { drain: () => {} },
      ItemIdentifiers: { ARMADYL_CROSSBOW: 1 },
      PendingHit: class {},
      Projectile: FakeProjectile,
      RangedCombatMethod,
      RangedWeapon: { ARMADYL_CROSSBOW: {} },
      Sound: { ARMADYL_CROSSBOW_SPECIAL: { id: 3892 } },
      Sounds: { playAreaSoundAt: () => {} },
    },
    registerCombatSpecial: (spec) => { registered = spec; },
  };
  require("../plugins/combat/specials/ArmadylCrossbow.SpecialAttack")(api);
  const player = { performAnimation: () => {} };
  const character = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    performAnimation: () => {},
    getLocation: () => ({ getDistance: () => 8 }),
  };
  const target = { getLocation: () => ({ getX: () => 0 }) };
  registered.combatMethod.start(character, target);
  assert.deepEqual(launched[0].slice(2), [301, 41, 75, 38.75, 36.5], "RSProx 3277 at 7 and 8 tiles");
});

test("Concentrated Shot fires the equipped javelin, and its burst lands with it", () => {
  const launched = [];
  const graphics = [];
  const sounds = [];
  class FakeProjectile {
    static createProjectile(...args) {
      launched.push(args);
      return new FakeProjectile();
    }
    withAngle() { return this; }
    withProgress() { return this; }
    sendProjectile() { return this; }
  }
  let registered;
  const api = {
    core: {
      Animation: class {},
      CombatFactory: { checkAmmo: () => true, decrementAmmo: () => {} },
      CombatSpecial: { drain: () => {} },
      Graphic: class { constructor(id, delay, height) { this.id = id; this.delay = delay; this.height = height; } },
      ItemIdentifiers: { LIGHT_BALLISTA: 19478, HEAVY_BALLISTA: 19481, LIGHT_BALLISTA_4: 19480, HEAVY_BALLISTA_OR_: 19482 },
      PendingHit: class {},
      Projectile: FakeProjectile,
      RangedCombatMethod,
      RangedWeapon: { BALLISTA: {} },
      Sound: { MAGIC_LONGBOW_SPECIAL: { id: 2536 }, SHOOT_CROSSBOW: { id: 2695 } },
      Sounds: { sendSound: (_character, sound) => sounds.push(sound) },
      WeaponProfiles,
    },
    registerCombatSpecial: (spec) => { registered = spec; },
  };
  require("../plugins/combat/specials/Ballista.SpecialAttack")(api);

  const distance = 9;
  const player = playerWith(19481, WeaponInterfaces.BALLISTA, Ammunition.RUNE_JAVELIN);
  const character = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    performAnimation: () => {},
    getLocation: () => ({ getX: () => 0, getY: () => 0, getDistance: () => distance }),
  };
  const target = {
    getLocation: () => ({ getX: () => distance, getY: () => 0 }),
    performGraphic: (graphic) => graphics.push(graphic),
  };

  registered.combatMethod.start(character, target);

  assert.equal(launched.length, 1);
  const [, , projectileId, delay, end] = launched[0];
  assert.equal(projectileId, 205, "the equipped rune javelin, not the dragon javelin");
  assert.equal(delay, 42);
  assert.equal(end, 71, "44 + 3 * 9");
  assert.ok(end > delay);
  assert.deepEqual([graphics[0].id, graphics[0].delay, graphics[0].height], [344, end, 177]);
  assert.equal(sounds[0].id, 2536, "Powershot");
});
