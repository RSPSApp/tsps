// Run after `yarn build`: node --test tests/cooking-batch-relic-amount.test.cjs
// A batch relic (Production Prodigy: "skills:actions-per-cycle" answers 28 for cooking) cooks several food a cycle,
// but never more than the amount chosen: #1366's other batched loops (smithing, crafting, herblore, fletching,
// Recipes.Cooking) count each item against it. Cookers.cookStep took one off the amount per cycle and then cooked
// every raw food of that kind carried.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Cookers = require('../plugins/skills/cooking/Cookers.Cooking');
let core, batch = 1, next = 3480;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3211, 3215, 0]; // a plain Range (2859) placed beside the player

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  // What Production Prodigy answers (LeagueRelics: 28 for every production action).
  PM.createApi('BatchRelicStandIn').onCustomEvent('skills:actions-per-cycle', (request) => {
    if (request.kind === 'cook') request.actions = Math.max(request.actions, batch);
  });
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function cook(t, amount, actions) {
  batch = actions;
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('batchcook' + next); p.setRegistered(true); p.setLocation(new core.Location(...AT)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.COOKING, 99, true).setCurrentLevel(core.Skill.COOKING, 99, true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getInventory().add(new core.Item(core.ItemIdentifiers.RAW_SHRIMPS, 10), true);
  const range = new core.GameObject(core.ObjectIdentifiers.RANGE, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  const cookable = Cookers._test.cookableFor(core.ItemIdentifiers.RAW_SHRIMPS);
  core.ObjectManager.register(range, true);
  t.after(() => core.ObjectManager.deregister(range, true));
  assert.ok(Cookers._test.startCooking(p, range, cookable, undefined, amount), 'the cook starts');
  for (let i = 0; i < 40; i++) core.TaskManager.process();
  return p.getInventory();
}

test('a batch relic cooking 1 of 10 shrimps cooks 1', (t) => {
  const inv = cook(t, 1, 28);
  assert.equal(inv.getAmount(core.ItemIdentifiers.RAW_SHRIMPS), 9);
  assert.equal(inv.getAmount(core.ItemIdentifiers.SHRIMPS), 1);
});

test('a batch relic cooking 5 of 10 cooks 5, in whatever cycles', (t) => {
  const inv = cook(t, 5, 3);
  assert.equal(inv.getAmount(core.ItemIdentifiers.RAW_SHRIMPS), 5);
  assert.equal(inv.getAmount(core.ItemIdentifiers.SHRIMPS), 5);
});

test('without a relic, 1 of 10 cooks 1 (control)', (t) => {
  const inv = cook(t, 1, 1);
  assert.equal(inv.getAmount(core.ItemIdentifiers.RAW_SHRIMPS), 9);
});
