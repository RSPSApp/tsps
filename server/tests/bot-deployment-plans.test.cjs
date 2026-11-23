const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { normalizePlan, normalizePlanOverrideFields, planMode, readPlans, savePlan, deployPlan, applyPlanOverrides } = require('../plugins/bots/runtime/DeploymentPlans.PlayerBots');
const { attachRoster } = require('../plugins/minigames/castlewars/Roster.CastleWars');

const plan = { id: 'cw-even', name: 'Balanced Castle Wars', rows: [
  { team: 'saradomin', routine: 'custom_attacker', count: 1 }, { team: 'saradomin', routine: 'custom_defender', count: 1 },
  { team: 'zamorak', routine: 'castle_wars_match', count: 1 }, { team: 'zamorak', routine: 'custom_runner', count: 1 },
] };

test('deployment plans store ordered rows, including different routines on the same side', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-plans-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'plans.json');
  assert.deepEqual(readPlans(file, []), []);
  assert.deepEqual(savePlan(plan, file, []), [plan]);
  assert.deepEqual(readPlans(file, []), [plan]);
  assert.throws(() => savePlan({ ...plan, rows: [{ ...plan.rows[0], team: 'pink' }] }, file, []), /team/);
  assert.deepEqual(readPlans(file, []), [plan]);
  assert.deepEqual(savePlan({ id: plan.id, remove: true }, file, []), []);
});

test('shipped minigame plans merge with older JSON and remain editable like user plans', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-shipped-plans-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'plans.json');
  fs.writeFileSync(file, JSON.stringify([{ ...plan, mode: 'castle-wars', rows: plan.rows.map(row => row.routine === 'castle_wars_match' ? { ...row, routine: 'mixed' } : row) }]));
  const loaded = readPlans(file);
  assert.deepEqual(loaded.map(item => item.id), ['castle-wars', 'soul-wars', 'pest-control', plan.id]);
  assert.deepEqual(loaded.map(planMode), ['castle-wars', 'soul-wars', 'pest-control', 'castle-wars']);
  assert.deepEqual(loaded.slice(0, 3).map(({ rows }) => [...new Set(rows.map(row => row.routine))]), [['castle_wars_match'], ['soul_wars_match'], ['pest_control_match']]);
  assert.deepEqual(loaded[3], plan);
  assert.throws(() => normalizePlan({ ...plan, rows: [{ team: 'saradomin', routine: 'soul_wars_match', count: 1 }] }), /routine for this team/);
  assert.ok(loaded.every(item => !Object.hasOwn(item, 'mode')));
  assert.throws(() => normalizePlan({ ...plan, rows: [...plan.rows, loaded[1].rows[0]] }), /same minigame/);
  const novice = loaded.find(item => item.id === 'pest-control');
  novice.rows[0].count = 6;
  savePlan(novice, file);
  assert.equal(readPlans(file).find(item => item.id === novice.id).rows[0].count, 6);
  savePlan({ id: novice.id, remove: true }, file);
  assert.equal(readPlans(file).some(item => item.id === novice.id), false);
});

test('panel deployment overrides are temporary, preserve teams and cannot change plan context', () => {
  const original = structuredClone(plan);
  const launch = applyPlanOverrides(plan, [{ count: 0 }, { count: 3 }, {}, {}]);
  assert.equal(launch.rows[1].count, 3);
  assert.equal(launch.rows[1].team, 'saradomin');
  assert.deepEqual(plan, original);
  assert.throws(() => applyPlanOverrides(plan, [{}]), /Plan changed/);
  assert.throws(() => applyPlanOverrides(plan, [{ team: 'blue' }, {}, {}, {}]), /override only/);
  const world = { id: 'world', name: 'World', rows: [{ routine: 'roam', count: 1 }] };
  assert.throws(() => applyPlanOverrides(world, [{ routine: 'pest-control-novice' }]), /not offered/);
  assert.throws(() => normalizePlanOverrideFields(world, [{ routines: ['pest-control-novice'] }], () => true), /not available/);
  const preset = { ...world, launchOverrides: normalizePlanOverrideFields(world, [{ routines: ['iron_rocks'] }], id => id === 'iron_rocks') };
  assert.equal(applyPlanOverrides(preset, [{ routine: 'iron_rocks' }]).rows[0].routine, 'iron_rocks');
  assert.throws(() => applyPlanOverrides(preset, [{ routine: 'normal_trees' }]), /not offered/);
  assert.throws(() => applyPlanOverrides(preset, [{ count: 2 }]), /fixed/);
});

test('deployment plans bound total bots, exclude internal routines, and reuse built-in catalog entries', () => {
  assert.equal(normalizePlan({ ...plan, rows: [{ ...plan.rows[0], count: 60 }] }).rows[0].count, 60);
  assert.throws(() => normalizePlan({ ...plan, rows: [{ ...plan.rows[0], count: 1.5 }] }), /whole number/);
  assert.throws(() => normalizePlan({ ...plan, mode: 'world', rows: [{ routine: 'pvp_engage', count: 1 }] }), /routine/);
  assert.deepEqual(normalizePlan({ ...plan, mode: 'world', rows: [{ routine: 'pvp', count: 1, team: 'blue' }] }).rows, [{ routine: 'pvp', count: 1 }]);
});

test('world plan validates every row before ever spawning a bot', () => {
  const runtime = { entriesByUsername: new Map(), spawnPvpBot() { assert.fail('preflight must not spawn'); } };
  const brainRegistry = { byId: new Map([['pvp', { id: 'pvp', mode: 'pvp' }]]) };
  const result = deployPlan({ api: { core: { Location: class {}, Skill: { values: () => [] } } }, runtime, brainRegistry }, {
    ...plan, mode: 'world', rows: [{ routine: 'pvp', count: 1 }, { routine: 'custom_missing', count: 1 }],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /custom_missing/);
});

test('Castle Wars consumes multiple same-side rows in order while admitting bots by team balance', () => {
  const events = new Map();
  const world = { getRemovePlayerQueue: () => [], getAddPlayerQueue: () => [] };
  const api = { getWorld: () => world, onCustomEvent: (name, callback) => events.set(name, callback) };
  const game = {
    data: { TEAM: { SA: 'saradomin', ZA: 'zamorak' }, LOBBY_TELEPORT: null },
    waitingAreas: { saradomin: { getPlayers: () => [{ isPlayerBot: () => false }] }, zamorak: { getPlayers: () => [] } },
    PHASE: { IDLE: 'idle', STARTING: 'starting' }, getPhase: () => 'idle', queueCounts: () => ({ saradomin: 1, zamorak: 0 }),
  };
  const order = [];
  const bot = name => ({ setAttribute() {}, getUsername: () => name });
  attachRoster(api, game, {
    chooseTeam: (counts, team) => counts[team] <= counts[team === 'zamorak' ? 'saradomin' : 'zamorak'] ? team : null,
    createBuiltin: () => bot('mixed'), loadoutRefusal: () => null,
    admit: (instance, team) => order.push([team, instance.getUsername()]),
  });
  const request = { teams: { saradomin: { count: 2 }, zamorak: { count: 2 } }, rows: plan.rows,
    prepare: () => ({ ok: true, spawn: row => ({ bot: bot(row.routine), start: () => true }), track() {} }) };
  events.get('bots:deploy-castle-wars-roster')(request);
  assert.equal(request.result.ok, true);
  assert.deepEqual(order, [['zamorak', 'mixed'], ['saradomin', 'custom_attacker'], ['zamorak', 'custom_runner'], ['saradomin', 'custom_defender']]);
});
