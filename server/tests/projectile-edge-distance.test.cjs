// Run after `yarn build`: node --test tests/projectile-edge-distance.test.cjs
//
// A player's ranged shot and spell projectile fly to the target's NEAREST tile (edge to edge, Wiki: Hit
// delay), not to its south-west corner or centre, so a large target no longer ends the projectile and
// lands the hit late. Rows are real casts (rsprox, ids only): the end cycle is the weapon's own formula
// on the nearest-tile distance, and every row below ends earlier than the south-west tile would give.
//
// The helpers are looked up with a fall-back to the pre-change behaviour (the south-west / centre
// measure the code used), so on the old code these fail on the values, not on a missing function.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Ammunition } = require("../dist/game/content/combat/ranged/RangedData");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { RangedCombatMethod } = require("../dist/game/content/combat/method/impl/RangedCombatMethod");
const { CombatPosition } = require("../dist/game/content/combat/CombatPosition");
const { Projectile } = require("../dist/game/model/Projectile");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Location } = require("../dist/game/model/Location");

const edgeDistance = (a, b) => (CombatPosition.edgeDistance ?? CombatPosition.distance).call(CombatPosition, a, b);
const landingDelays = (player, target) => RangedCombatMethod.landingDelays
  ? RangedCombatMethod.landingDelays(player, target)
  : WeaponProfiles.hitDelays(player, CombatPosition.distance(player, target));
const flightDistance = (start, end, victim) => Projectile.flightDistance
  ? Projectile.flightDistance(start, end, victim)
  : start.getDistance(end);

const mobile = (x, y, size = 1) => ({ getLocation: () => new Location(x, y, 0), getSize: () => size, getPrivateArea: () => null });

function bowman(x, y) {
  const ammo = Ammunition.RUNE_ARROW;
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => 859 }; // magic longbow, the default arrow profile
  items[Equipment.AMMUNITION_SLOT] = { getId: () => ammo.getItemId() };
  return {
    ...mobile(x, y),
    isPlayer: () => true, getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items }),
    getWeapon: () => WeaponInterfaces.LONGBOW,
    getCombat: () => ({ getAmmunition: () => ammo }),
  };
}

// Dragon arrows at Verzik phase 3 (size 7, south-west tile 3162,4309 / 3165,4309), rsprox 3299 (rev 234):
// projectile 1120 ends at 46 + 5 a tile of the nearest-tile distance.
const VERZIK = [
  // [shooter x, y, target SW x, y, nearest-tile distance, south-west distance, captured end cycle]
  [3163, 4318, 3162, 4309, 3, 9, 61],
  [3178, 4317, 3165, 4309, 7, 13, 81],
  [3170, 4316, 3165, 4309, 1, 7, 51],
];

test("a bow's projectile ends at a large target's nearest tile (rsprox 3299, Verzik size 7)", () => {
  for (const [x, y, tx, ty, near, sw, end] of VERZIK) {
    const player = bowman(x, y);
    const target = mobile(tx, ty, 7);
    const shot = WeaponProfiles.ranged(player).projectiles[0];
    assert.equal(CombatPosition.distance(player, target), sw, "the south-west tile is further");
    assert.equal(edgeDistance(player, target), near, `from ${x},${y}`);
    assert.equal(RangedCombatMethod.projectileEnd(shot, edgeDistance(player, target)), end, `end from ${x},${y}`);
  }
});

test("a bow's hit lands by the nearest tile too: 1 + (3 + d) / 6 ticks (Wiki: Hit delay)", () => {
  // From 3163,4318 the Verzik is 3 tiles away at its nearest edge (2 ticks) and 9 from its south-west tile (3).
  const player = bowman(3163, 4318);
  assert.deepEqual(landingDelays(player, mobile(3162, 4309, 7)), [2]);
  // 7 from its edge (2 ticks) where the south-west tile is 13 away (3); and 1 from the edge (1 tick), 7 away (2).
  assert.deepEqual(landingDelays(bowman(3178, 4317), mobile(3165, 4309, 7)), [2]);
  assert.deepEqual(landingDelays(bowman(3170, 4316), mobile(3165, 4309, 7)), [1]);
  // A one-tile target is unchanged.
  assert.deepEqual(landingDelays(bowman(3200, 3200), mobile(3206, 3200)), [1 + Math.floor((3 + 6) / 6)]);
});

test("a spell projectile ends at the target's nearest tile (rsprox 3275, rev 234: water strike 94)", () => {
  // Projectile 94 ends at 46 + 10 a tile. Gemstone crab (size 5, south-west 1351,3110, centre 1353,3112) from
  // 1352,3117 ends at 76 (3 tiles from its edge), where the south-west tile is 7 away and the centre 5.
  const crab = mobile(1353, 3112, 5);
  const from = new Location(1352, 3117, 0);
  assert.equal(46 + 10 * flightDistance(from, new Location(1353, 3112, 0), crab), 76);
  assert.equal(46 + 10 * flightDistance(new Location(1352, 3118, 0), new Location(1353, 3112, 0), crab), 86, "one tile further back");
  // Lesser demon (size 2, south-west 3107,3157, no centre offset) from 3108,3162: ends at 86.
  assert.equal(46 + 10 * flightDistance(new Location(3108, 3162, 0), new Location(3107, 3157, 0), mobile(3107, 3157, 2)), 86);
  // A one-tile target is just the distance.
  assert.equal(flightDistance(new Location(3200, 3200, 0), new Location(3205, 3200, 0), mobile(3205, 3200)), 5);
});
