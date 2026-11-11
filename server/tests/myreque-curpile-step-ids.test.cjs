// Run after `yarn build`: node --test tests/myreque-curpile-step-ids.test.cjs
// In Search of the Myreque: Curpile Fyod's quiz. The plugin answered the quiz-pass condition and the
// three knock-out messages by ids the regenerated npc-dialogues.json no longer has, so passing the
// quiz never moved the quest on and failing it never sent the player back to Mort'ton. The steps are
// found here by their text in the current JSON and sent through the real dialogue events.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.in_search_of_the_myreque.stage';
const QUESTIONED = 52, ANSWERED = 55;
let core, next = 2720;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function steps(node, pred, out = []) {
  if (Array.isArray(node)) { for (const v of node) steps(v, pred, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const v of Object.values(node)) steps(v, pred, out);
  return out;
}
const conversation = () => require('../data/definitions/npc-dialogues.json')['In Search of the Myreque']
  .variants['convincing-curpile-fyod-talking-to-curpile-fyod'];

function actor(t, stage) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('myrequetest' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3507, 3439, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const npcId = () => core.NpcIdentifiers.CURPILE_FYOD;

test('three out of three answers moves the quest on', (t) => {
  const [pass] = steps(conversation(), (n) => n.type === 'condition' && n.text === 'If the player answered three out of three questions correctly:');
  assert.ok(pass?.id);
  const p = actor(t, QUESTIONED);
  PM.emitCustomEvent('npc-dialogue:condition', { player: p, npcId: npcId(), text: pass.text, stepId: pass.id });
  assert.equal(p.getAttribute(STAGE), ANSWERED);
});

test("each knock-out sends the player back to Mort'ton", (t) => {
  const knockouts = steps(conversation(), (n) => n.type === 'message' && n.text === "Curpile knocks you out and takes you back to Mort'ton.");
  assert.equal(knockouts.length, 3);
  for (const step of knockouts) {
    const p = actor(t, QUESTIONED);
    PM.emitCustomEvent('npc-dialogue:action', { player: p, npcId: npcId(), step, text: step.text, stepId: step.id, handled: false });
    const at = p.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [3522, 3285, 0], step.id);
  }
});
