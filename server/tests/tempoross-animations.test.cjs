// Run directly: node --test tests/tempoross-animations.test.cjs
const assert = require("node:assert/strict");
const { test, after } = require("node:test");

const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const { Fight } = require("../plugins/minigames/tempoross/Fight.Tempoross");

const realAnimate = Shared.animate;
const realLater = Shared.later;
let animations = [];
let scheduled = [];

after(() => {
  Shared.animate = realAnimate;
  Shared.later = realLater;
});

function fakeFight({ first = false, submerges = 1, enraged = false } = {}) {
  const fight = Object.create(Fight.prototype);
  fight.boss = {
    setNpcTransformationId(id) {
      fight.bossId = id;
    },
  };
  fight.bossId = null;
  fight.cove = { message() {}, forEachPlayer() {}, players: new Set() };
  fight.spots = { onSurface() {} };
  fight.attacks = { onSurface() {} };
  fight.hosts = [];
  fight.phase = "submerged";
  fight.ticks = 10;
  fight.submerges = submerges;
  fight.enraged = enraged;
  fight.stopped = false;
  fight.maxEnergy = 2683;
  fight.storm = 50;
  fight.firstSurfaceTick = -1;
  animations = [];
  scheduled = [];
  Shared.animate = (_entity, id) => animations.push(id);
  Shared.later = (_key, _ticks, action) => {
    scheduled.push(action);
    return { stop() {} };
  };
  return fight;
}

test("the first rise plays fsb_spawn (8897)", () => {
  const fight = fakeFight();
  fight.surface(true);
  assert.equal(fight.bossId, 10572);
  assert.deepEqual(animations, [Shared.ANIM.BOSS_SPAWN]);
});

test("rising after a submerge plays fsb_whirl_to_ready (8901)", () => {
  const fight = fakeFight({ submerges: 1 });
  fight.surface(false);
  assert.equal(fight.bossId, 10572);
  assert.deepEqual(animations, [8901]);
});

test("the first enrage plays 8906, then 10575 with 8908 five ticks later", () => {
  const fight = fakeFight({ submerges: 3 });
  fight.surface(false);
  assert.equal(fight.bossId, 10572);
  assert.deepEqual(animations, [8906]);
  assert.equal(scheduled.length, 1);

  scheduled[0]();
  assert.equal(fight.bossId, 10575);
  assert.deepEqual(animations, [8906, 8908]);
});

test("later enraged surfacings are 10575 with 8908 directly", () => {
  const fight = fakeFight({ submerges: 4 });
  fight.surface(false);
  assert.equal(fight.bossId, 10575);
  assert.deepEqual(animations, [8908]);
  assert.equal(scheduled.length, 0);
});
