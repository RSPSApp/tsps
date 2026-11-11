// Run after `yarn build`: node --test tests/zogre-sithik-step-ids.test.cjs
// Zogre Flesh Eaters: Sithik's answers to "How do I get rid of the undead ogres?" and "How do I get rid of the
// disease?" set the brutal-arrow and cure flags. The plugin answered the steps' old ids, which the regenerated
// npc-dialogues.json no longer has, so neither flag was ever set. The steps are found here by their option and
// condition text in the current JSON and sent through the real dialogue events.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const BRUTAL = 'quest.zogre_flesh_eaters.make_brutal';
const CURE = 'quest.zogre_flesh_eaters.make_cure';
const TRANSFORMED = 'quest.zogre_flesh_eaters.transformed';
let core, next = 2800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function conditions(optionText) {
  const menu = require('../data/definitions/npc-dialogues.json')['Zogre Flesh Eaters']
    .variants['investigating-b-vahn-talking-to-sithik-ints-in-ogre-form'].find((n) => n.options?.some((o) => o.text === optionText));
  const out = {};
  const walk = (steps) => { for (const s of steps ?? []) { if (s.type === 'condition') out[s.text] = s.id; walk(s.steps); } };
  walk(menu.options.find((o) => o.text === optionText).steps);
  return out;
}

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('zogretest' + next);
  p.setRegistered(true); p.setLocation(new core.Location(2591, 3103, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const npcId = () => core.NpcIdentifiers.SITHIK_INTS;
const answer = (p, stepId, text) => PM.emitNpcDialogueCondition({ player: p, npcId: npcId(), text, stepId });
const taken = (p, stepId, text) => PM.emitCustomEvent('npc-dialogue:condition', { player: p, npcId: npcId(), text, stepId });

test('the undead ogres answer: first time, then again, and the brutal flag is set', (t) => {
  const ids = conditions('How do I get rid of the undead ogres?'), p = actor(t);
  assert.equal(answer(p, ids['Asking for the first time:'], 'Asking for the first time:'), true);
  assert.equal(answer(p, ids['Asking him again:'], 'Asking him again:'), false);
  taken(p, ids['Asking for the first time:'], 'Asking for the first time:');
  assert.equal(p.getAttribute(BRUTAL), true);
  assert.equal(answer(p, ids['Asking him again:'], 'Asking him again:'), true);
});

test('the disease answer: first time, then again as an ogre or a human, and the cure flag is set', (t) => {
  const ids = conditions('How do I get rid of the disease?'), p = actor(t);
  assert.equal(answer(p, ids['Asking for the first time:'], 'Asking for the first time:'), true);
  taken(p, ids['Asking for the first time:'], 'Asking for the first time:');
  assert.equal(p.getAttribute(CURE), true);
  assert.equal(answer(p, ids['Asking him again as a human:'], 'Asking him again as a human:'), true);
  assert.equal(answer(p, ids['Asking him again as an ogre:'], 'Asking him again as an ogre:'), false);
  p.setAttribute(TRANSFORMED, true);
  assert.equal(answer(p, ids['Asking him again as an ogre:'], 'Asking him again as an ogre:'), true);
});
