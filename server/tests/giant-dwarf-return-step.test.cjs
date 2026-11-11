// Run after `yarn build`: node --test tests/giant-dwarf-return-step.test.cjs
// The Giant Dwarf: after Thurgo, "Return to Keldagrim immediately." fades to Blasidar's house. The plugin answered
// the step's old id (z3YxxS), which the regenerated npc-dialogues.json no longer has, so the player stayed put.
// The step is found here by its text in the current JSON and sent through the real dialogue action event.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const TEXT = 'The screen fades to black briefly, and the player arrives at Keldagrim, where Blasidar is.';
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function findStep(node) {
  if (Array.isArray(node)) { for (const v of node) { const r = findStep(v); if (r) return r; } return null; }
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'action' && node.text === TEXT) return node;
  for (const v of Object.values(node)) { const r = findStep(v); if (r) return r; }
  return null;
}

test("the return step in the current dialogue moves the player to Blasidar's house", (t) => {
  const dialogues = require('../data/definitions/npc-dialogues.json');
  const step = findStep(dialogues['The Giant Dwarf']);
  assert.ok(step?.id, 'the step is in the generated dialogue');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2700); p.setUsername('giantdwarftest');
  p.setRegistered(true); p.setLocation(new core.Location(3000, 3150, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const event = { player: p, step, text: step.text, stepId: step.id, handled: false };
  PM.emitCustomEvent('npc-dialogue:action', event);
  assert.equal(event.handled, true);
  const at = p.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [2907, 10206, 0]);
});
