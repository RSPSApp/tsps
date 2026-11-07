const assert = require("node:assert/strict");
const { test } = require("node:test");
const Rules = require("../plugins/minigames/clanwars/Rules.ClanWars");

test("revision 241 cap indices include 1v1, 50v50 and 100v100 with an absolute 100 maximum", () => {
  const expected = [100, 1, 5, 10, 15, 20, 50, 100];
  for (let index = 0; index < expected.length; index++) {
    const rules = Rules.create(index);
    assert.equal(Rules.validate(rules), true);
    assert.equal(Rules.teamCap(rules), expected[index]);
  }
  for (const invalid of [-1, 8, 30, 1.5, "1", null, NaN, Infinity]) {
    assert.equal(Rules.create(invalid), null, `cap index ${String(invalid)}`);
  }
});

test("unsupported modes, arenas and combat restrictions cannot be accepted as the offered rules", () => {
  const changes = {
    wincondition: 16, arena: 0, melee: 1, ranged: 0, magic: 0, prayer: 2,
    food: 1, drinks: 1, specialattacks: 2, stragglers: 1, freezing: 1,
    pjtimer: 1, tots: 1, singlespells: 1, leavingcc: 1, rejoiningdelay: 1, vls: 1,
  };
  for (const [key, value] of Object.entries(changes)) {
    const rules = { ...Rules.create(), [key]: value };
    assert.equal(Rules.validate(rules), false, key);
    assert.equal(Rules.teamCap(rules), null, key);
    assert.equal(Rules.summary(rules), null, key);
  }
});

test("incomplete and extended configurations are refused instead of silently changing agreed rules", () => {
  for (const value of [null, undefined, 0, "", [], {}]) assert.equal(Rules.validate(value), false);
  for (const key of Object.keys(Rules.OFFERED_RULES)) {
    const missing = Rules.create();
    delete missing[key];
    assert.equal(Rules.validate(missing), false, key);
    assert.equal(Rules.validate({ ...Rules.create(), [key]: "0" }), false, key);
  }
  assert.equal(Rules.validate({ ...Rules.create(), dangerous: 1 }), false);
  assert.equal(Rules.validate({ ...Rules.create(), [Symbol("hidden-rule")]: 1 }), false);
  assert.equal(Rules.validate(Object.create(Rules.OFFERED_RULES)), false);
  const accessor = Rules.create();
  Object.defineProperty(accessor, "arena", { get() { throw new Error("must not execute rule accessors"); } });
  assert.equal(Rules.validate(accessor), false);
});

test("confirmation describes safe last-standing entry cutoff and supplies without promising inventory restoration", () => {
  const summary = Rules.summary(Rules.create(2));
  assert.match(summary, /Last team standing on Plateau/);
  assert.match(summary, /5 v 5/);
  assert.match(summary, /Safe deaths: you keep your items/);
  assert.match(summary, /No joining or rejoining after/);
  assert.match(summary, /Food and drinks are consumed normally/);
  assert.match(summary, /Melee combat only/);
  assert.match(summary, /Powered staves and Vesta's blighted longsword are not enabled/);
  assert.match(Rules.summary(Rules.create()), /maximum 100 fighters per team/);
});
