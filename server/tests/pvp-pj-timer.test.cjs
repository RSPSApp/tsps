const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Combat } = require("../dist/game/content/combat/Combat");
const { Location } = require("../dist/game/model/Location");

function characterAt(x, y, z = 0) {
  return { getLocation: () => new Location(x, y, z) };
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
