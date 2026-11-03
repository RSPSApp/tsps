// Run after `yarn build`: node --test tests/npc-projectile-hit-timing.test.cjs
// An NPC's magic and ranged hits land when its projectile does (#1862). A hit on a player
// queued N ticks out shows its splat 30 * N client cycles after the projectile was sent, and
// the projectile reaches the player at its end cycle + 1, so the splat must come no earlier than
// that and less than a tick after. NPC magic used a fixed 3 ticks (a tick early from 10 tiles,
// a tick late from 1) and NPC ranged a fixed 1 tick with a flat 40 -> 57 arrow (hit before the
// arrow left).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { MagicCombatMethod } = require("../dist/game/content/combat/method/impl/MagicCombatMethod");
const { RangedCombatMethod } = require("../dist/game/content/combat/method/impl/RangedCombatMethod");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");

const mobile = (index, isPlayer, x) => ({
  getIndex: () => index,
  isPlayer: () => isPlayer,
  isNpc: () => !isPlayer,
  getLocation: () => new Location(x, 3200, 0),
  getSize: () => 1,
  getPrivateArea: () => null,
});

const npc = (x) => ({
  ...mobile(300, false, x),
  getAttackAnim: () => -1,
  performAnimation() {},
  performGraphic() {},
  getCombat: () => ({ getSelectedSpell: () => null, getAmmunition: () => null, getRangedWeapon: () => null }),
  getAsNpc: () => ({ getCurrentDefinition: () => ({ getProjectileId: () => -1 }) }),
});

/** The [delay, end] each player in view is sent for what `fire` launches. */
function sentProjectiles(fire) {
  const calls = [];
  const recipient = {
    getPrivateArea: () => null,
    getLocation: () => new Location(3200, 3200, 0),
    getNpcViewDistance: () => 15,
    getPacketSender: () => ({ sendProjectile: (...args) => calls.push(args) }),
  };
  const original = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (visit) => visit(recipient);
  try {
    fire();
  } finally {
    World.forEachNetworkPlayer = original;
  }
  return calls.map((args) => ({ end: args[3], delay: args[8] }));
}

function assertLandsWithProjectile(hitTicks, end, label) {
  const landing = end + 1;
  assert.ok(hitTicks * 30 >= landing, `${label}: splat at ${hitTicks * 30} before the projectile lands at ${landing}`);
  assert.ok(hitTicks * 30 < landing + 30, `${label}: splat at ${hitTicks * 30}, over a tick after it lands at ${landing}`);
}

test("an NPC's spell hits the player when its projectile lands", () => {
  const player = mobile(7, true, 3200);
  for (let distance = 1; distance <= 10; distance++) {
    const caster = npc(3200 + distance);
    const [shot] = sentProjectiles(() => new MagicCombatMethod().start(caster, player));
    assert.equal(shot.delay, 51, "the legacy magic launch");
    assert.equal(shot.end, 46 + 10 * distance, `${distance} tiles`);
    assertLandsWithProjectile(MagicCombatMethod.hitDelay(caster, player), shot.end, `magic from ${distance} tiles`);
  }
});

test("an NPC's arrow flies with its distance and hits when it lands", () => {
  const player = mobile(7, true, 3200);
  const method = new RangedCombatMethod();
  for (let distance = 1; distance <= 10; distance++) {
    const archer = npc(3200 + distance);
    const [shot] = sentProjectiles(() => method.start(archer, player));
    assert.equal(shot.delay, 41, "a bow's launch");
    assert.equal(shot.end, 46 + 5 * distance, `${distance} tiles`);
    assertLandsWithProjectile(RangedCombatMethod.npcHitDelay(archer, player), shot.end, `ranged from ${distance} tiles`);
  }
});

test("a player's own spell keeps the Wiki's hit delay", () => {
  const caster = mobile(7, true, 3200);
  const target = { ...mobile(300, false, 3205), getSize: () => 1 };
  assert.equal(MagicCombatMethod.hitDelay(caster, target), 1 + Math.floor((1 + 5) / 3));
});
