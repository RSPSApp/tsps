// Run after `yarn build`: node --test tests/myreque-curpile-punch.test.cjs
// "I don't have to answer to you!" (Curpile Fyod): the transcript's action step "Curpile hits the player for 3 damage."
// (void CurpileFyod.kt sendPunch). The real dialogue action event goes through the real PluginManager; the damage is read from
// the player's hit queue. The SCOPE lines print what was observed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

let core, next = 5600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('punch' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3507, 3439, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const dialogue = () => require('../data/definitions/npc-dialogues.json')['In Search of the Myreque'].variants['convincing-curpile-fyod-talking-to-curpile-fyod'];
function find(node, pred, out = []) {
  if (Array.isArray(node)) { for (const v of node) find(v, pred, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const v of Object.values(node)) find(v, pred, out);
  return out;
}
const punchStep = () => find(dialogue(), (n) => n.type === 'action' && /hits the player for 3 damage/.test(n.text ?? ''))[0];
const pending = (p) => p.getHitpoints() - p.getHitpointsAfterPendingDamage();

test('the refusal option carries the punch step in the record', () => {
  assert.ok(punchStep(), 'an action step "Curpile hits the player for 3 damage." exists');
});

test("Curpile's punch queues 3 damage on the player (the step's own id and text, as the runtime sends them)", (t) => {
  const p = actor(t);
  const step = punchStep();
  const before = pending(p);
  PM.emitCustomEvent('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.CURPILE_FYOD, text: step.text, stepId: step.id, step, handled: false });
  console.log(`PUNCH-OBSERVED pending before=${before} after=${pending(p)} stepId=${step.id}`);
  assert.equal(pending(p) - before, 3);
});

test("the same text from another NPC's action does not hurt the player", (t) => {
  const p = actor(t);
  const before = pending(p);
  PM.emitCustomEvent('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.SANI_PILIU, text: 'Curpile hits the player for 3 damage.', stepId: 'x', handled: false });
  assert.equal(pending(p), before);
});
