// Run after `yarn build`: node --test tests/icthlarin-step-ids.test.cjs
// Icthlarin's Little Helper: the plugin answered five steps by ids the regenerated npc-dialogues.json no longer
// has, so handing the Sphinx's token to the High Priest never took it or moved the quest on, and a wrong riddle
// answer never cost the cat. The steps are found here by their text in the current JSON and sent through the
// real dialogue action event.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.ictlharins_little_helper.stage';
const BITS = 'quest.ictlharins_little_helper.bits';
const CAT_LOST = 1 << 5;
const TOKEN = 4691, CAT = 1561;
const TALK_SPHINX = 5, TALK_HIGH_PRIEST = 6, FLASHBACK_2 = 7;
let core, next = 2900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const page = () => require('../data/definitions/npc-dialogues.json')["Icthlarin's Little Helper"];
function steps(node, pred, out = []) {
  if (Array.isArray(node)) { for (const v of node) steps(v, pred, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const v of Object.values(node)) steps(v, pred, out);
  return out;
}

function actor(t, stage, items) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('icsxtest' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3290, 2780, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  for (const [id, n] of items) p.getInventory().add(new core.Item(id, n), true);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const act = (p, step) => { const e = { player: p, step, text: step.text, stepId: step.id, handled: false }; PM.emitCustomEvent('npc-dialogue:action', e); return e; };

test('handing the token to the High Priest takes it and moves the quest to the second flashback', (t) => {
  const [step] = steps(page(), (n) => n.text === 'You hand the token to the High Priest.');
  assert.ok(step?.id);
  const p = actor(t, TALK_HIGH_PRIEST, [[TOKEN, 1]]);
  act(p, step);
  assert.equal(p.getInventory().getAmount(TOKEN), 0);
  assert.equal(p.getAttribute(STAGE), FLASHBACK_2);
});

test("a wrong riddle answer (12 or 14) and the cat running away each lose the cat", (t) => {
  const wrong = steps(page(), (n) => n.type === 'action' && n.text === 'Same as answering 7 (incorrect answer)');
  const [runs] = steps(page(), (n) => n.type === 'action' && n.text === "The player's cat runs away.");
  assert.equal(wrong.length, 2);
  for (const step of [...wrong, runs]) {
    const p = actor(t, TALK_SPHINX, [[CAT, 1]]);
    assert.equal(act(p, step).handled, true, step.id);
    assert.equal(p.getInventory().getAmount(CAT), 0, step.id);
    assert.ok((p.getAttribute(BITS) & CAT_LOST) !== 0, step.id);
  }
});
