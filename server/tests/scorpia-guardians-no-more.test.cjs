// Run after `yarn build`: node --test tests/scorpia-guardians-no-more.test.cjs
// Wiki (Guardians No More): "Kill Scorpia without killing her guardians." Scorpia's fight marks her when
// a guardian she called is killed; the Scorpia kill rule completes the task only when none was.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Scorpia = require('../plugins/bosses/wildernessbosses/Scorpia.WildernessBosses');

const SCORPIA = 6615;
const GUARDIAN = 6617;
let core, rule;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  Scorpia.attach(new Proxy({ core, getPrayerHandler: () => ({}) }, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  const api = new Proxy({ core }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  Data(api);
  assert.equal(Data.taskNamed('Guardians No More')?.description, 'Kill Scorpia without killing her guardians.');
  const captured = {};
  require('../plugins/achievements/combatachievements/tasks/Scorpia.CombatAchievements')(
    {}, { onKill: (name, tests) => { captured[name] = tests; } },
  );
  rule = captured.Scorpia?.['Guardians No More'];
  assert.equal(typeof rule, 'function');
});

/** A real Scorpia whose first hit has started a fight that called her two guardians. */
function scorpiaWithGuardians(t) {
  const scorpia = core.NPC.create(SCORPIA, new core.Location(3232, 10340, 0));
  const fight = Scorpia._test.fightOf(scorpia);
  Scorpia._test.callGuardians(scorpia, fight);
  const guardians = fight.guardians.map(({ npc }) => npc);
  t.after(() => {
    for (const npc of guardians) {
      const queue = core.World.getAddNPCQueue(); const i = queue.indexOf(npc); if (i >= 0) queue.splice(i, 1);
    }
    core.TaskManager.cancelTasks(scorpia);
  });
  assert.equal(guardians.length, 2);
  assert.ok(guardians.every((npc) => npc.getId() === GUARDIAN));
  return { scorpia, guardians };
}

const killed = (npc) => Scorpia._test.died({ npc, preventDeath: false });

test('killing Scorpia while her guardians live completes Guardians No More', (t) => {
  const { scorpia } = scorpiaWithGuardians(t);
  killed(scorpia);
  assert.equal(rule({}, { npc: scorpia }), true);
});

test('killing one of her guardians first fails it', (t) => {
  const { scorpia, guardians } = scorpiaWithGuardians(t);
  killed(guardians[0]);
  killed(scorpia);
  assert.equal(rule({}, { npc: scorpia }), false);
});

test("a respawned Scorpia's next fight does not inherit an earlier guardian kill", (t) => {
  const { scorpia, guardians } = scorpiaWithGuardians(t);
  killed(guardians[1]);
  killed(scorpia); // the fight is forgotten on her death
  Scorpia._test.fightOf(scorpia); // her next fight's first hit
  assert.equal(rule({}, { npc: scorpia }), true);
});
