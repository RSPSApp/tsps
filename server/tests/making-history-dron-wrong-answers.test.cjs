// Run after `yarn build`: node --test tests/making-history-dron-wrong-answers.test.cjs
// Making History: every wrong answer to Dron is an action "A random incorrect dialogue from below is
// shown." that ends the talk (the player asks again). 13 of the 19 ids the plugin listed no longer exist
// in the regenerated npc-dialogues.json, so most wrong answers were not handled. Each such step in the
// current JSON is sent here through the real dialogue action event.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function steps(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) steps(v, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'action' && node.text === 'A random incorrect dialogue from below is shown.') out.push(node);
  for (const v of Object.values(node)) steps(v, out);
  return out;
}

test("every wrong answer to Dron in the current dialogue ends the talk", (t) => {
  const wrong = steps(require('../data/definitions/npc-dialogues.json')['Making History']
    .variants['talking-to-dron-talking-to-dron-again']);
  assert.equal(wrong.length, 19);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2730); p.setUsername('mhtest');
  p.setRegistered(true); p.setLocation(new core.Location(3492, 3473, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  for (const step of wrong) {
    const event = { player: p, npcId: core.NpcIdentifiers.DRON, step, text: step.text, stepId: step.id, handled: false };
    PM.emitCustomEvent('npc-dialogue:action', event);
    assert.equal(event.handled, true, step.id);
    assert.equal(event.end, true, step.id);
  }
});
