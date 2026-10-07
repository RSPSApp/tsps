// Run after `yarn build`: node --test tests/toxic-blowpipe.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Location } = require("../dist/game/model/Location");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const ToxicBlowpipe = require("../plugins/items/ToxicBlowpipe.plugin");

const TOXIC_BLOWPIPE_ID = 12926;

/** The plugin's combat method for a player holding the blowpipe, from its resolver. */
function blowpipeMethod(player) {
  let resolver = null;
  const api = new Proxy({}, {
    get: (_, name) => {
      if (name === "registerCombatMethodResolver") return (entry) => { resolver = entry; };
      if (name === "getBonusManager" || name === "getCombatFactory") return () => ({});
      return () => {};
    },
  });
  ToxicBlowpipe.register(api);
  return resolver.resolve(player);
}

function holding(x, y) {
  const weapon = { getId: () => TOXIC_BLOWPIPE_ID };
  const items = [];
  items[Equipment.WEAPON_SLOT] = weapon;
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    isSpecialActivated: () => false,
    getLocation: () => new Location(x, y, 0),
    getWeapon: () => WeaponInterfaces.BLOWPIPE,
    getEquipment: () => ({ get: (slot) => items[slot] ?? null, getItems: () => items }),
  };
  return player;
}

test("blowpipe hits land 1 + distance / 6 ticks after the attack (Wiki: Hit delay)", (t) => {
  // Only the delay is under test: no damage roll, which needs a whole player and target.
  t.mock.method(PendingHit.prototype, "prepareHits", () => []);
  for (const [distance, ticks] of [[1, 1], [5, 1], [6, 2], [7, 2]]) {
    const player = holding(3200, 3200);
    const target = { getLocation: () => new Location(3200 + distance, 3200, 0) };
    const hits = blowpipeMethod(player).hits(player, target);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].getDelay(), ticks, `distance ${distance}`);
  }
});
