// Run after `yarn build`: node --test tests/cooking-death-busy.test.cjs
// Starting to cook sets the busy varbit until the first food is cooked. Every way of stopping clears it; the cook loop
// used to drop a dead player's session without doing so, leaving busy at 1 inside the first-food window.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Cookers = require('../plugins/skills/cooking/Cookers.Cooking');
let core, next = 3560;
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
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

test('dying before the first food clears busy and ends the cook', (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('deadcook' + next); p.setRegistered(true); p.setLocation(new core.Location(...AT)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.COOKING, 99, true).setCurrentLevel(core.Skill.COOKING, 99, true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getInventory().add(new core.Item(core.ItemIdentifiers.RAW_SHRIMPS, 5), true);
  const range = new core.GameObject(core.ObjectIdentifiers.RANGE, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  core.ObjectManager.register(range, true);
  t.after(() => core.ObjectManager.deregister(range, true));
  const busy = core.CacheDefinitions.getVarbitId('busy');
  assert.ok(Cookers._test.startCooking(p, range, Cookers._test.cookableFor(core.ItemIdentifiers.RAW_SHRIMPS)), 'the cook starts');
  assert.equal(p.getPacketSender().getVarbit(busy), 1, 'busy until the first food');
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 0, true);
  assert.equal(p.getHitpoints(), 0);
  core.TaskManager.process();
  assert.equal(Cookers.isCookingActive(p), false);
  assert.equal(p.getPacketSender().getVarbit(busy), 0, 'death clears busy');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.RAW_SHRIMPS), 5, 'nothing was cooked');
});
