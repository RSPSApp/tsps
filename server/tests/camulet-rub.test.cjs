// Run after `yarn build`: node --test tests/camulet-rub.test.cjs
// The Camulet's Rub, against rsprox: a Rub submenu entry (cache isubop4 "Enakhra's Temple",
// "Enakhra's Temple Entrance") teleports straight there (232/03160.txt tick 194). With the hard
// Desert diary a bare Rub asks where, and only the choice finds an empty Camulet (231/03021.txt
// ticks 5162-5260). The out-of-charges line is an item box (objectbox 193) with the Camulet (ticks
// 4321, 5260). Real plugins and a real Player; the click is PluginManager.emitItemAction with the
// native inventory resolver's Rub option and a 1-based subOpId, as the packet delivers it.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');

let core, next = 2800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { charges, hardDiary }) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('camulet' + p.getIndex());
  p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.setAttribute('camulet:charges', charges);
  const teleports = [];
  t.mock.method(core.TeleportHandler, 'teleport', (player, target) => { if (player === p) teleports.push([target.getX(), target.getY()]); });
  t.mock.method(core.TeleportHandler, 'checkReqs', () => true);
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => {
    if (name === 'diary:is-complete' && event?.player === p && event.diary === 'desert' && event.tier === 'hard') { event.complete = hardDiary; return; }
    return emit(name, event);
  });
  return { p, teleports };
}

function rub(p, subOpId) {
  const item = new core.Item(core.ItemIdentifiers.CAMULET, 1);
  p.getInventory().setItem(0, item);
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(item.getId(), op))
    .find((candidate) => candidate?.option?.toLowerCase() === 'rub');
  assert.ok(action, 'the native resolver exposes Rub');
  const event = { player: p, item, itemId: item.getId(), slot: 0, interfaceId: (149 << 16), clickType: action.optionIndex,
    option: action.option, subOpId, handled: false };
  assert.equal(PM.emitItemAction(event), true);
}

test("a Rub submenu entry teleports straight there, even with the hard diary's menu", (t) => {
  const { p, teleports } = actor(t, { charges: 5, hardDiary: true });
  rub(p, 2); // Enakhra's Temple Entrance
  assert.equal(teleports.length, 1, 'no menu first');
  rub(p, 1); // Enakhra's Temple
  assert.equal(teleports.length, 2);
  assert.notDeepEqual(teleports[0], teleports[1], 'the two entries go to their own places');
});

test('an empty Camulet: a submenu entry shows the item box at once; a bare Rub asks where first', (t) => {
  const { p, teleports } = actor(t, { charges: 0, hardDiary: true });
  rub(p, 1);
  assert.ok(p.getDialogueManager().getCurrent() instanceof core.ItemStatementDialogue, 'the out-of-charges item box');
  assert.equal(teleports.length, 0);
  p.getDialogueManager().reset?.();
  rub(p, undefined);
  assert.ok(!(p.getDialogueManager().getCurrent() instanceof core.ItemStatementDialogue), 'the destination menu comes first');
  assert.equal(teleports.length, 0);
});
