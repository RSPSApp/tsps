// Run after `yarn build`: node --test tests/defender-of-varrock-cutscene-step.test.cjs
// Defender of Varrock: talking to Dimintheis again before completing the cutscene reaches a
// "(Cutscene begins.)" action whose id is 8eNIJz; the plugin listened for "8eNIjz" (lower-case j),
// so the cutscene never started from that conversation. The step is found here by its variant and
// text in the current npc-dialogues.json and sent through the real dialogue action event.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.defender_of_varrock.stage';
const STAGE_LIST = 44, STAGE_CUTSCENE = 50;
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
  if (node.type === 'action' && node.text === '(Cutscene begins.)') return node;
  for (const v of Object.values(node)) { const r = findStep(v); if (r) return r; }
  return null;
}

test('the cutscene step of the second Dimintheis conversation moves the quest to the cutscene', (t) => {
  const variant = require('../data/definitions/npc-dialogues.json')['Defender of Varrock']
    .variants['the-true-descendant-talking-to-dimintheis-before-completing-the-cutscene'];
  const step = findStep(variant);
  assert.ok(step?.id, 'the step is in the generated dialogue');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2710); p.setUsername('dovtest');
  p.setRegistered(true); p.setLocation(new core.Location(3212, 3474, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, STAGE_LIST);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  PM.emitCustomEvent('npc-dialogue:action', { player: p, step, text: step.text, stepId: step.id, handled: false });
  assert.equal(p.getAttribute(STAGE), STAGE_CUTSCENE);
});
