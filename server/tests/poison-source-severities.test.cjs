// Run after `yarn build`: node --test tests/poison-source-severities.test.cjs
// CombatFactory.poisonEntity takes severity (its first hit is floor((severity + 4) / 5)), not the first hit.
// Bryophyta: the poison varp goes 0 -> 40 (rsprox_transcripts/227/00569.txt:19727, 227/01858.txt:250797,
// 234/03275.txt:354628). Yama: 0 -> 100 (234/00788.txt:374372; Wiki "starting at 20").
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

test("Bryophyta's melee poison is severity 40, a first hit of 8", (t) => {
  let Method = null;
  const real = PluginManager.createApi("PoisonSeverityTest");
  const api = new Proxy({}, {
    get: (_t, name) => name === "registerNpcCombatMethodProvider" ? (_ids, method) => { Method = method; }
      : name === "core" ? core
      : typeof real[name] === "function" ? () => {} : real[name],
  });
  require("../plugins/bosses/giantlairs/Common.GiantLairs").init(api);
  require("../plugins/bosses/giantlairs/Bryophyta.GiantLairs")(api);
  assert.ok(Method, "the boss's combat method");
  const poisoned = [];
  t.mock.method(core.CombatFactory, "poisonEntity", (target, severity) => poisoned.push(severity));
  t.mock.method(Math, "random", () => 0);
  const method = new Method();
  method.stance = core.CombatType.MELEE;
  const target = { isPlayer: () => true };
  method.handleAfterHitEffects({ getTarget: () => target, getTotalDamage: () => 5 });
  assert.deepEqual(poisoned, [40]);
  assert.equal(core.CombatPoisonEffect.damageFromSeverity(40), 8);
});

test("Yama's poison is severity 100, a first hit of 20", (t) => {
  const Common = require("../plugins/bosses/yama/Common.Yama");
  const Hits = require("../plugins/bosses/yama/Hits.Yama");
  const poisoned = [];
  Common.init({ core: { ...core, CombatFactory: { poisonEntity: (_player, severity) => poisoned.push(severity) } } });
  Hits.poison({}, Common.data.attacks.poison.damage);
  assert.deepEqual(poisoned, [100]);
  assert.equal(core.CombatPoisonEffect.damageFromSeverity(100), 20);
});
