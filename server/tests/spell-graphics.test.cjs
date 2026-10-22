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
