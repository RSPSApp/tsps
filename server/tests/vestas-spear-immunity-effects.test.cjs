// Run after `yarn build`: node --test tests/vestas-spear-immunity-effects.test.cjs
// Spear Wall (Wiki, Vesta's spear: "immune to melee and ranged attacks" for 8 ticks) blocks a hit's effects as well
// as its damage: inside the window the attacker's after-hit effects (a special's drain or freeze) don't run. Real
// engine: every plugin loaded, two real Players, a real PendingHit through the real CombatFactory.executeHit.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let index = 14100;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function fighter(t, x) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername("spearwall" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, 3200, 0));
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

/** A melee or ranged hit of 12 from `attacker` whose combat method records its after-hit effects. */
function landHit(t, attacker, target, type) {
  const ran = [];
  const Base = type === core.CombatType.MELEE ? core.MeleeCombatMethod : core.RangedCombatMethod;
  const method = new (class extends Base {
    handleAfterHitEffects(hit) { ran.push(hit.getTotalDamage()); }
  })();
  t.mock.method(core.AccuracyFormulasDpsCalc, "rollAccuracy", () => true);
  t.mock.method(core.CombatFactory, "getHitDamage", () => new core.HitDamage(12, core.HitMask.RED));
  const hit = new core.PendingHit(attacker, target, method, 0);
  t.mock.restoreAll();
  assert.ok(hit.getTotalDamage() > 0, "the hit rolled damage before it lands");
  core.CombatFactory.executeHit(hit);
  return { ran, hit };
}

test("inside Spear Wall's 8 ticks a melee or ranged hit lands no damage and no after-hit effects", (t) => {
  const wielder = fighter(t, 3200);
  const attacker = fighter(t, 3201);
  wielder.setAttribute("vestas-spear:immune-until", core.World.getProcessCycle() + 8);
  for (const type of [core.CombatType.MELEE, core.CombatType.RANGED]) {
    const { ran, hit } = landHit(t, attacker, wielder, type);
    assert.equal(hit.getTotalDamage(), 0, `${type}: no damage`);
    assert.equal(hit.getHandleAfterHitEffects(), false, `${type}: effects off`);
    assert.deepEqual(ran, [], `${type}: the attacker's after-hit effects did not run`);
  }
});

test("outside the window the same hit lands and its after-hit effects run", (t) => {
  const wielder = fighter(t, 3210);
  const attacker = fighter(t, 3211);
  wielder.setAttribute("vestas-spear:immune-until", core.World.getProcessCycle() - 1);
  const { ran, hit } = landHit(t, attacker, wielder, core.CombatType.MELEE);
  assert.ok(hit.getTotalDamage() > 0);
  assert.equal(ran.length, 1);
});
