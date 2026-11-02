// Run after `yarn build`: node --test tests/kraken.test.cjs
// Kraken Cove: the task gate on the area's attacks, including the tentacles that
// belong to the Kraken fight but carry no Slayer task of their own.
const assert = require("node:assert/strict");
const { test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { Projectile } = require("../dist/game/model/Projectile");
const { Location } = require("../dist/game/model/Location");
const Shared = require("../plugins/bosses/kraken/Shared.Kraken");
const { areaClass } = require("../plugins/bosses/kraken/Area.Kraken");
const Fight = require("../plugins/bosses/kraken/Fight.Kraken");

class Area {}
class Boundary {}

const requests = [];
let onTaskAnswer = () => false;

Shared.bind({
  core: {
    Area,
    Boundary,
    Projectile,
    CombatMethod: class {},
    CombatType: { MAGIC: "magic" },
    PendingHit: class {
      constructor(attacker, target, method, delay) { this.delay = delay; }
      getDelay() { return this.delay; }
    },
    NpcIdentifiers: {
      WHIRLPOOL: 493,
      CAVE_KRAKEN: 492,
      WHIRLPOOL_2: 496,
      KRAKEN: 494,
      WHIRLPOOL_3: 5534,
      ENORMOUS_TENTACLE: 5535,
    },
  },
  emitCustomEvent: (name, request) => {
    assert.equal(name, "slayer:on-task");
    requests.push(request);
    request.onTask = onTaskAnswer(request);
  },
});

const area = new (areaClass())();
const player = { isPlayer: () => true, getAsPlayer: () => player };
const npc = (id) => ({ isNpc: () => true, getId: () => id });

test("the cove refuses attacks off a Kraken or cave kraken task", () => {
  onTaskAnswer = () => false;
  for (const id of [Shared.ids().CAVE_KRAKEN, Shared.ids().BOSS, Shared.ids().TENTACLE]) {
    assert.equal(area.canAttack(player, npc(id)), false);
  }
  assert.equal(area.canAttack({ isPlayer: () => false }, npc(Shared.ids().BOSS)), null);
  assert.equal(area.canAttack(player, { isNpc: () => false }), null);
});

test("the cove allows attacks covered by the player's task", () => {
  onTaskAnswer = () => true;
  for (const id of [Shared.ids().CAVE_KRAKEN, Shared.ids().BOSS, Shared.ids().TENTACLE]) {
    assert.equal(area.canAttack(player, npc(id)), null);
  }
});

test("a tentacle is asked about as the Kraken, which carries the task", () => {
  const tentacle = npc(Shared.ids().TENTACLE);
  onTaskAnswer = (request) => request.npc === tentacle && request.npcId === Shared.ids().BOSS;
  assert.equal(Shared.onTask(player, tentacle), true);
  assert.equal(requests.at(-1).npcId, Shared.ids().BOSS);
});

test("the Kraken's hit lands with its legacy-shape projectile at any range (#1862)", (t) => {
  const sent = [];
  t.mock.method(Projectile.prototype, "sendProjectile", function () { sent.push(this); });
  const mobile = (x, y, size) => ({ getLocation: () => new Location(x, y, 0), getSize: () => size, getPrivateArea: () => null, getIndex: () => 1, isPlayer: () => false, getAttackAnim: () => -1, getId: () => 494 });
  const kraken = mobile(2278, 10034, 5);
  for (const tiles of [1, 10]) {
    const player = mobile(2280 + tiles, 10036, 1);
    const method = new (Fight.methodClass())();
    method.start(kraken, player);
    const shot = sent.at(-1);
    // The legacy shape (0/20, 43/31) is sent as 51 -> 46 + 10 a tile.
    assert.deepEqual([shot.delay, shot.speed, shot.startHeight, shot.endHeight], [0, 20, 43, 31]);
    const end = 46 + 10 * shot.start.getDistance(shot.end);
    assert.equal(method.hits(kraken, player)[0].getDelay(), Math.ceil(end / 30), `${tiles} tiles`);
  }
});
