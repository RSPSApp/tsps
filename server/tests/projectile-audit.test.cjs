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
