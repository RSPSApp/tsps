// Run after `yarn build`: node --test tests/spell-graphics.test.cjs
// Stun's impact, Tele Block's projectiles and Magic Dart's cast graphic, as live (rsprox captures, Wiki).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { Projectile } = require("../dist/game/model/Projectile");
const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const spotanim = (name) => CacheDefinitions.getSpotanimId(name);

/** The spotanim a spell's projectile travels as. */
function projectileOf(spell) {
  const original = Projectile.createProjectile;
  Projectile.createProjectile = (_source, _victim, id) => ({ id });
  try {
    return spell.castProjectile({}, {}).id;
  } finally {
    Projectile.createProjectile = original;
  }
}

test("a Stun that lands shows stunned, not Weaken's impact", () => {
  assert.equal(CombatSpells.STUN.endGraphic().getId(), spotanim("stunned"));
  assert.equal(CombatSpells.WEAKEN.endGraphic().getId(), spotanim("weaken_impact"));
});

test("Tele Block sends teleport_reverse when it lands and its old travel when it fails, once rolled", () => {
  assert.equal(CombatSpells.TELEBLOCK.castProjectile({}, {}), null, "nothing goes out before the roll");
  const sent = [];
  const original = Projectile.createProjectile;
  Projectile.createProjectile = (_source, _victim, id) => ({ sendProjectile: () => sent.push(id) });
  try {
    for (const accurate of [true, false]) {
      CombatSpells.TELEBLOCK.onHitCalc({
        isAccurate: () => accurate,
        getAttacker: () => ({}),
        getTarget: () => ({}),
        getTotalDamage: () => 0,
      });
    }
  } finally {
    Projectile.createProjectile = original;
  }
  assert.deepEqual(sent, [spotanim("teleport_reverse"), spotanim("tele_block_travel_forfail")]);
  assert.notEqual(sent[0], spotanim("ballista_special"));
});

test("Magic Dart has no cast graphic", () => {
  assert.equal(CombatSpells.MAGIC_DART.startGraphic(), null);
  assert.equal(projectileOf(CombatSpells.MAGIC_DART), spotanim("slayer_magicdart_travel"));
});

// These legacy callers stored height100 in a packed high word; Graphic takes an unpacked height.
for (const [name, graphic] of Object.entries({
  CRUMBLE_UNDEAD: "crumbleundead_casting", IBAN_BLAST: "ibanblast_casting",
  VULNERABILITY: "vulnerability_casting", ENFEEBLE: "enfeeble_casting",
  STUN: "stun_casting", ICE_BLITZ: "ice_burst_travel",
})) test(`${name} starts its caster graphic at height100 with zero delay`, (t) => {
  const played = [];
  const caster = {
    isNpc: () => false, isPlayer: () => true,
    getAsPlayer: () => ({ getEquipment: () => ({ hasStaffEquipped: () => false }) }),
    performAnimation() {}, performGraphic: (graphic) => played.push(graphic),
  };
  const spell = CombatSpells[name];
  t.mock.method(spell, "castProjectile", () => null);
  spell.startCast(caster, {});
  assert.equal(played.length, 1);
  assert.equal(played[0].getId(), spotanim(graphic));
  assert.equal(played[0].getHeight(), 100);
  assert.equal(played[0].getDelay(), 0);
});

for (const [name, height] of Object.entries({
  WIND_WAVE: 100, WATER_WAVE: 100, EARTH_WAVE: 100, FIRE_WAVE: 100,
  WIND_SURGE: 92, WATER_SURGE: 92, EARTH_SURGE: 92, FIRE_SURGE: 92,
})) test(`${name} casts at the restored height`, () => {
  assert.equal(CombatSpells[name].startGraphic().getHeight(), height);
});

test("Tele Block declares no damage, so a player's cast cannot default to 1", () => {
  assert.equal(CombatSpells.TELEBLOCK.maximumHit(), 0);
  assert.deepEqual(DamageFormulas.getMagicHitBounds({}, CombatSpells.TELEBLOCK), { minimum: 0, maximum: 0 });
});

// rsprox revs 234-241: firewave_impact (157) lands at height 124 in 1,281 of 1,837 sends and failedspell_impact
// (85) in 20,968 of 21,082 (e.g. rsprox_transcripts/237/03994.txt tick 1629, 236/03935.txt tick 1766); the rest
// are per-target heights.
test("Fire Wave's impact and the splash land at the recorded height 124", () => {
  const { MagicCombatMethod } = require("../dist/game/content/combat/method/impl/MagicCombatMethod");
  assert.deepEqual([CombatSpells.FIRE_WAVE.endGraphic().getId(), CombatSpells.FIRE_WAVE.endGraphic().getHeight()], [spotanim("firewave_impact"), 124]);
  assert.deepEqual([MagicCombatMethod.SPLASH_GRAPHIC.getId(), MagicCombatMethod.SPLASH_GRAPHIC.getHeight(), MagicCombatMethod.SPLASH_GRAPHIC.getDelay()],
    [spotanim("failedspell_impact"), 124, 0]);
});
