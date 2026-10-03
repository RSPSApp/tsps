import * as assert from "node:assert/strict";
import { Location } from "../src/main/typescript/elvarg/game/model/Location";
import { Projectile } from "../src/main/typescript/elvarg/game/model/Projectile";

const mobile = (x: number, y: number, size: number): any => ({
    getLocation: () => new Location(x, y, 0),
    getSize: () => size,
});

// 1x1 mobiles (players, small npcs) keep firing from their own tile.
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 1)), new Location(3200, 3200, 0));

// KBD is 5x5: its Location is the south-west corner, the body sits two tiles in.
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 5)), new Location(3202, 3202, 0));

// Even sizes land on the south-west of the two centre tiles (tile grid has no halves).
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 4)), new Location(3201, 3201, 0));

// Nonsense sizes must not drag the origin off the mobile.
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 0)), new Location(3200, 3200, 0));

// Projectiles have to cross the gap, not teleport across it: a flat lifetime spent the
// same time on 8 tiles as on 1.
const kbd = mobile(3000, 3000, 5);
const player = mobile(3010, 3002, 1);

// The KBD's centre tile is (3002, 3002), so the flight is measured from its body.
assert.equal(Projectile.arrivalCycles(kbd, player), 40 + 8 * 10);
assert.equal(Projectile.arrivalTicks(kbd, player), 4);

// Closer target, shorter flight - the whole point of the change.
assert.ok(Projectile.arrivalCycles(kbd, mobile(3005, 3002, 1)) < Projectile.arrivalCycles(kbd, player));

// Vet'ion throws at bare tiles, so raw Locations have to work as endpoints too.
assert.equal(Projectile.arrivalCycles(kbd, new Location(3010, 3002, 0)), 120);
assert.equal(Projectile.arrivalCycles(new Location(3002, 3002, 0), new Location(3005, 3002, 0)), 70);

console.info("projectile origin smoke passed");

// --- God Wars Dungeon access rules and drop fixtures ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gwdRules = require("../plugins/bosses/godwars/GodWarsRules");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dropDefinitions = require("../data/definitions/npc-drops.json");

// Troll Stronghold partial completion (Dad defeated) and the 60 Strength/Agility
// boulder. A regression to any of these must fail the offline test.
assert.equal(gwdRules.canMoveBoulder(10, 99, 99).ok, false);
assert.equal(gwdRules.canMoveBoulder(20, 59, 59).ok, false);
assert.equal(gwdRules.canMoveBoulder(20, 60, 1).ok, true);
assert.equal(gwdRules.canMoveBoulder(20, 1, 60).ok, true);

// First entry needs a rope; once tied the hole stays open.
assert.equal(gwdRules.canClimbEntrance(20, false, false).ok, false);
assert.equal(gwdRules.canClimbEntrance(20, true, false).tiesRope, true);
assert.equal(gwdRules.canClimbEntrance(20, false, true).ok, true);

// God item, then 40 essence; an ecumenical key skips the essence only.
assert.equal(
  gwdRules.canOpenBossDoor({ hasGodItem: false, killCount: 40, hasKey: false }).ok,
  false
);
assert.equal(
  gwdRules.canOpenBossDoor({ hasGodItem: true, killCount: 39, hasKey: false }).ok,
  false
);
assert.equal(
  gwdRules.canOpenBossDoor({ hasGodItem: true, killCount: 40, hasKey: false }).ok,
  true
);
assert.deepEqual(gwdRules.canOpenBossDoor({ hasGodItem: true, killCount: 0, hasKey: true }), {
  ok: true,
  consumesKey: true,
});

// Each general's drops table exists with an always drop and a unique fixture.
const generalFixtures: Array<[string, string]> = [
  ["general_graardor", "Bandos chestplate"],
  ["kreearra", "Armadyl helmet"],
  ["commander_zilyana", "Saradomin sword"],
  ["kril_tsutsaroth", "Staff of the Dead"],
];
for (const [tableId, unique] of generalFixtures) {
  const table = dropDefinitions.tables[tableId];
  assert.ok(table, `missing drops table ${tableId}`);
  assert.ok(
    table.entries.some((entry: any) => entry.always === true),
    `${tableId} has no always drop`
  );
  assert.ok(
    table.entries.some((entry: any) => entry.name === unique),
    `${tableId} is missing unique ${unique}`
  );
}
for (const npcId of ["2215", "3162", "2205", "3129", "2216", "3163", "2206", "3130"]) {
  assert.ok(dropDefinitions.npcs[npcId]?.tables?.length > 0, `npc ${npcId} has no drops`);
}

console.info("gwd access and drops smoke passed");
