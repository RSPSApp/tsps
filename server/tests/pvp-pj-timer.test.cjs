const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Combat } = require("../dist/game/content/combat/Combat");
const { Location } = require("../dist/game/model/Location");
const { Boundary } = require("../dist/game/model/Boundary");
const { WORLD_ZONE_BOUNDARIES } = require("../dist/game/definition/WorldDefinition");
const { Wilderness } = require("../dist/game/content/wilderness/Wilderness");

function characterAt(x, y, z = 0) {
  return { getLocation: () => new Location(x, y, z) };
}

/** The boundaries a world.json `pvp` zone with no map bounds adds on a PvP world. */
function withGlobalPvp(fn) {
  const added = [];
  for (let z = 0; z < 4; z++) {
    const boundary = new Boundary(0, 0x3fff, 0, 0x3fff, z);
    WORLD_ZONE_BOUNDARIES.pvp.push(boundary);
    added.push(boundary);
  }
  try {
    fn();
  } finally {
    for (const boundary of added) {
      const index = WORLD_ZONE_BOUNDARIES.pvp.indexOf(boundary);
      if (index >= 0) WORLD_ZONE_BOUNDARIES.pvp.splice(index, 1);
    }
  }
}

test("Wilderness single-way PvP uses the 20-tick PJ timer", () => {
  assert.equal(Combat.pvpPjTimerMs(characterAt(3100, 3600), false), 20 * 600);
  // A PvP world must not shorten the Wilderness timer.
  assert.equal(Combat.pvpPjTimerMs(characterAt(3100, 3600), true), 20 * 600);
});

test("PvP worlds use the 16-tick PJ timer outside the Wilderness", () => {
  assert.equal(Combat.pvpPjTimerMs(characterAt(3222, 3218), true), 16 * 600);
  assert.equal(Combat.pvpPjTimerMs(characterAt(3222, 3218), false), 10 * 600);
});

test("multi-combat keeps the existing 10-tick retarget hold", () => {
  // Dark Warriors' Fortress first floor is a Wilderness multi-combat zone.
  assert.equal(Combat.pvpPjTimerMs(characterAt(3010, 3650, 1), false), 10 * 600);
  assert.equal(Combat.pvpPjTimerMs(characterAt(3010, 3650, 1), true), 10 * 600);
});

test("a PvP world's global pvp tag is not geographic Wilderness", () => {
  withGlobalPvp(() => {
    const outside = new Location(3222, 3218, 0);
    assert.equal(Wilderness.isInLocation(outside), true, "the global tag makes the tile attackable");
    assert.equal(Wilderness.isGeographicPvp(outside), false);

    // The old test only passed the PvP-world flag without the global zone; this fails on base
    // because the 20-tick Wilderness branch saw the global tag first.
    assert.equal(Combat.pvpPjTimerMs(characterAt(3222, 3218), true), 16 * 600);
    assert.equal(Combat.pvpPjTimerMs(characterAt(3100, 3600), true), 20 * 600);
    assert.equal(
      Combat.pvpPjTimerMs(characterAt(1750, 11550, 0), true),
      20 * 600,
      "Hunter's End is geographic Wilderness even though it sits outside the level boxes",
    );
  });
});
