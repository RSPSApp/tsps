// node --test tests/scorching-bow-special.test.cjs
// Scorching shackles (OSRS Wiki Scorching_bow; rsprox recordings 572, 1756, 1762, 3315).
const assert = require("node:assert/strict");
const { test } = require("node:test");

function setup({ burnApplied = true } = {}) {
  const log = { drains: [], freezes: [], burns: [], projectiles: [], normalShots: 0, animations: [], graphics: [] };
  let registered = null;
  class RangedCombatMethod {
    start() { log.normalShots++; }
    hits() { return ["normal-hit"]; }
  }
  class PendingHit {
    constructor(attacker, target, method, opts) {
      this.opts = opts;
      this.damages = [{ splat: null, setSplatTypes(a, b) { this.splat = [a, b]; } }];
    }
    getHits() { return this.damages; }
  }
  const core = {
    Animation: class { constructor(id) { this.id = id; } },
    Graphic: class { constructor(id, delay = 0) { this.id = id; this.delay = delay; } },
    CombatFactory: { freeze: (target, seconds) => log.freezes.push(seconds) },
    CombatSpecial: { drain: (c, amount) => log.drains.push(amount) },
    ItemIdentifiers: { SCORCHING_BOW: 29591 },
    Misc: { getSeconds: (ticks) => ticks * 0.6 },
    PendingHit,
    Projectile: {
      arrivalCycles: () => 86,
      createProjectile(c, t, id, delay, end) {
        const p = { id, delay, end, sendProjectile: () => log.projectiles.push({ id, delay, end }) };
        p.withAngle = () => p;
        p.withProgress = () => p;
        return p;
      },
    },
    RangedCombatMethod,
    Sound: class { constructor(id) { this.id = id; } static SHOOT_ARROW = {} },
    Sounds: { sendSound() {} },
  };
  const api = {
    core,
    registerCombatSpecial: (d) => { registered = d; },
    emitCustomEvent: (name, payload) => {
      if (name === "combat:burn") { log.burns.push(payload); payload.applied = burnApplied; }
    },
  };
  require("../plugins/combat/specials/ScorchingBow.SpecialAttack")(api);
  const messages = [];
  const player = {
    sendMessage: (m) => messages.push(m),
    performAnimation: (a) => log.animations.push(a.id),
    performGraphic: (g) => log.graphics.push(g.id),
  };
  const npc = (demon) => ({
    isNpc: () => true,
    getAsNpc() { return { getCurrentDefinition: () => ({ hasAttribute: (a) => a === "demon" && demon }) }; },
    performGraphic: (g) => log.graphics.push(g.id),
  });
  return { registered, log, messages, player, npc, method: registered.combatMethod };
}

test("registers for the scorching bow at 25% energy", () => {
  const { registered } = setup();
  assert.deepEqual(registered.itemIds, [29591]);
  assert.equal(registered.drainAmount, 25);
});

test("against a demon: spends energy, binds 20 ticks, burns, fires no arrow and deals one burn damage", () => {
  const { log, messages, player, npc, method } = setup();
  const target = npc(true);
  method.start(player, target);
  assert.deepEqual(log.drains, [25]);
  assert.ok(Math.abs(log.freezes[0] - 12) < 1e-9, "20 ticks = 12 seconds");
  assert.equal(log.normalShots, 0);
  assert.equal(log.burns.length, 1);
  assert.equal(log.burns[0].damage, 4);
  assert.deepEqual(log.animations, [11133]);
  assert.deepEqual(log.projectiles, [{ id: 2807, delay: 46, end: 86 }]);
  assert.deepEqual(messages, []);
  const hits = method.hits(player, target);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].opts.damage, 1);
  assert.equal(hits[0].opts.rollAccuracy, false);
  assert.deepEqual(hits[0].getHits()[0].splat, [74, 74]);
});

test("a target immune to burns takes the bind but no damage", () => {
  const { log, player, npc, method } = setup({ burnApplied: false });
  const target = npc(true);
  method.start(player, target);
  assert.equal(log.freezes.length, 1);
  assert.deepEqual(method.hits(player, target), []);
});

test("against a non-demon: refused with the live message, no energy, an ordinary shot", () => {
  const { log, messages, player, npc, method } = setup();
  const target = npc(false);
  method.start(player, target);
  assert.deepEqual(messages, ["Scorching shackles won't work against a non-demon enemy."]);
  assert.deepEqual(log.drains, []);
  assert.deepEqual(log.freezes, []);
  assert.deepEqual(log.burns, []);
  assert.equal(log.normalShots, 1);
  assert.deepEqual(method.hits(player, target), ["normal-hit"]);
});

test("a player target is refused like any non-demon", () => {
  const { log, messages, player, method } = setup();
  const target = { isNpc: () => false };
  method.start(player, target);
  assert.equal(messages.length, 1);
  assert.deepEqual(log.drains, []);
});
