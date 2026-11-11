// Run with: node --test server/tests/skeletal-wyvern.test.cjs
// The skeletal wyvern's icy breath table and attack choice (Wiki Skeletal_Wyvern).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { _test } = require("../plugins/bosses/SkeletalWyvern.plugin");

const { iceBreathMax, chooseAttack, Attack, BREATH_SHIELDS } = _test;

test("icy breath maxima: 50 bare, 20 with Protect from Magic, 10 with a shield", () => {
  assert.equal(iceBreathMax({ shield: false, prayer: false }), 50);
  assert.equal(iceBreathMax({ shield: false, prayer: true }), 20);
  assert.equal(iceBreathMax({ shield: true, prayer: false }), 10);
  assert.equal(iceBreathMax({ shield: true, prayer: true }), 10);
});

test("the anti-dragon shield does not cut the breath", () => {
  assert.ok(!BREATH_SHIELDS.has("Anti-dragon shield"));
  for (const name of ["Elemental shield", "Mind shield", "Dragonfire shield", "Dragonfire ward", "Ancient wyvern shield"]) {
    assert.ok(BREATH_SHIELDS.has(name), name);
  }
});

test("only the ranged attacks are used beyond melee reach, and the breath only within 5 tiles", () => {
  for (const roll of [0, 0.3, 0.6, 0.99]) {
    assert.notEqual(chooseAttack(3, roll), Attack.MELEE);
    assert.equal(chooseAttack(6, roll), Attack.ICEBALL);
  }
  assert.equal(chooseAttack(1, 0.1), Attack.MELEE);
});
