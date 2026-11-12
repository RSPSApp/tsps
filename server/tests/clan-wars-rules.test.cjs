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
    wincondition: 15, arena: 0, melee: 1, ranged: 0, magic: 0, prayer: 3,
    food: 2, drinks: 2, specialattacks: 1, stragglers: 1, freezing: 1,
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


test("revision 242 kill targets preserve fixed melee terms and reject deferred native modes", () => {
  const targets = [25,50,100,200,500,1000,5000,10000];
  for (let mode=1; mode<=8; mode++) {
    const rules=Rules.create(3,mode);
    assert.equal(Rules.validate(rules),true);
    assert.equal(Rules.killTarget(rules),targets[mode-1]);
    assert.equal(Rules.teamCap(rules),10);
    assert.equal(rules.ranged,1); assert.equal(rules.magic,4);
    assert.match(Rules.summary(rules),/First to .* kills on Plateau/);
    assert.match(Rules.summary(rules),/Joining and rejoining remain open/);
    assert.match(Rules.summary(rules),/Food and drinks are consumed normally/);
  }
  for (const mode of [-1,9,15,21,23,24,1.5,"1",null,NaN]) assert.equal(Rules.create(0,mode),null);
});


test("revision 242 timed modes use sourced durations with fixed melee and respawning terms", () => {
  const minutes = [5, 10, 20, 60, 120];
  const ticks = [500, 1000, 2000, 6000, 12000];
  for (let i = 0; i < minutes.length; i++) {
    const rules = Rules.create(2, 16 + i);
    assert.equal(Rules.validate(rules), true);
    assert.equal(Rules.timeLimitTicks(rules), ticks[i]);
    assert.equal(Rules.killTarget(rules), 0);
    assert.equal(Rules.respawns(rules), true);
    assert.equal(Rules.teamCap(rules), 5);
    assert.equal(rules.ranged, 1); assert.equal(rules.magic, 4);
    assert.match(Rules.summary(rules), new RegExp(`Most kills in ${minutes[i]} minutes on Plateau`));
    assert.match(Rules.summary(rules), /Equal scores end without a winner/);
    assert.match(Rules.summary(rules), /Joining and rejoining remain open/);
  }
  assert.equal(Rules.timeLimitTicks(Rules.create()), 0);
  assert.equal(Rules.respawns(Rules.create()), false);
  assert.equal(Rules.timeLimitTicks(Rules.create(0, 1)), 0);
  assert.equal(Rules.respawns(Rules.create(0, 1)), true);
  assert.equal(Rules.timeLimitTicks(null), null);
});


test("revision 242 restriction enums compose with each supported battle family without changing melee terms", () => {
  for (const mode of [0,1,16,20]) for (const food of [0,1]) for (const drinks of [0,1])
    for (const prayer of [0,1,2]) for (const specialattacks of [0,2]) {
      const base=Rules.create(2,mode), rules={...base,food,drinks,prayer,specialattacks};
      assert.equal(Rules.validate(rules),true);
      assert.equal(Rules.teamCap(rules),Rules.teamCap(base));
      assert.equal(Rules.killTarget(rules),Rules.killTarget(base));
      assert.equal(Rules.timeLimitTicks(rules),Rules.timeLimitTicks(base));
      assert.equal(rules.ranged,1); assert.equal(rules.magic,4); assert.equal(rules.melee,0);
      const text=Rules.summary(rules);
      assert.match(text,new RegExp(`Food: ${food?'disabled':'allowed'}`));
      assert.match(text,new RegExp(`Drinks: ${drinks?'disabled':'allowed'}`));
      assert.match(text,new RegExp(`Melee special attacks: ${specialattacks===2?'disabled':'allowed'}`));
      assert.match(text,/Safe deaths: you keep your items/);
      if (prayer===1) assert.match(text,/overhead icons are disabled; other prayers are allowed/);
      else assert.match(text,prayer===2?/Prayers are disabled/:/All prayers are allowed/);
    }
});

test("unsupported or malformed restriction choices cannot enter an otherwise valid negotiated offer", () => {
  for (const key of ['food','drinks','prayer','specialattacks']) {
    const values=key==='prayer'?[-1,3,4]:key==='specialattacks'?[-1,1,3]:[-1,2,3];
    for (const value of [...values,0.5,'1',null,NaN,Infinity]) {
      assert.equal(Rules.validate({...Rules.create(2,16),[key]:value}),false,`${key}:${String(value)}`);
    }
  }
});
