// Run after `yarn build`: node --test tests/blessed-axe-not-an-axe.test.cjs
// Wiki (Blessed axe): it "does not retain the functionality of the mithril axe used to create it" and can only chop
// undead trees. It sat in Woodcutting's axes as a mithril-tier axe from 21 Woodcutting.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, next = 9970;
const bots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function woodcutter(t, axe) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('blessed' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING, 30, false).setMaxLevels(core.Skill.WOODCUTTING, 30, false);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getInventory().adds(axe, 1);
  return p;
}
test('a blessed axe answers no axe request: it chops no ordinary tree', (t) => {
  const p = woodcutter(t, core.ItemIdentifiers.BLESSED_AXE);
  const request = { player: p, axe: undefined };
  PM.emitCustomEvent('woodcutting:axe', request);
  assert.equal(request.axe, null);
  const held = { player: p, itemId: core.ItemIdentifiers.BLESSED_AXE, axe: undefined };
  PM.emitCustomEvent('woodcutting:axe', held);
  assert.equal(held.axe ?? null, null);
});
test('control: the mithril axe it is made from still chops from 21', (t) => {
  const p = woodcutter(t, core.ItemIdentifiers.MITHRIL_AXE);
  const request = { player: p, axe: undefined };
  PM.emitCustomEvent('woodcutting:axe', request);
  assert.equal(request.axe?.id, core.ItemIdentifiers.MITHRIL_AXE);
});
