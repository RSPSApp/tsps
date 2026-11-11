// Run after `yarn build`: node --test tests/enlightened-journey-second-experiment.test.cjs
// Enlightened Journey's second experiment (issue #4308), played from the generated transcript with
// native dialogue input: Auguste takes the two papyrus and the sack of potatoes and the quest moves
// on, so he does not ask for them again.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

const STAGE_KEY = 'quest.enlightened_journey.stage';
const FIRST_EXPERIMENT_DONE = 2;
const SECOND_EXPERIMENT_DONE = 3;
let core, next = 2600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, items) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('augustetest' + next);
  p.setRegistered(true); p.setLocation(new core.Location(2809, 3354, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  for (const [id, amount] of items) p.getInventory().add(new core.Item(id, amount), true);
  p.setAttribute(STAGE_KEY, FIRST_EXPERIMENT_DONE);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, c };
}
async function input(f, message) { await f.c.dispatch([message]); f.c.processTurnPackets(); core.TaskManager.process(); }
const text = (f) => f.p.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');

/** Answers "Yes, I have them here." and continues until the conversation closes. */
async function handOver(f) {
  PM.emitCustomEvent('npc-dialogue:start', { player: f.p, npcId: core.NpcIdentifiers.AUGUSTE });
  assert.equal(text(f), 'Do you have the other two sheets of papyrus and a full sack of potatoes?');
  await input(f, { type: 'dialogue_continue', widgetId: (231 << 16) | 5, childIndex: -1 });
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p)?.options, ["Yes, I have them here.", "Oh, I've misplaced them."]);
  await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 1 });
  const seen = [];
  for (let i = 0; i < 10 && f.p.getDialogueManager().isActive(); i++) {
    seen.push(text(f));
    await input(f, { type: 'dialogue_continue', widgetId: (231 << 16) | 5, childIndex: -1 });
    if (f.p.getDialogueManager().isActive()) await input(f, { type: 'dialogue_continue', widgetId: (217 << 16) | 5, childIndex: -1 });
  }
  return seen;
}

test('handing over two papyrus and a sack of potatoes takes them and completes the second experiment', async (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t, [[I.PAPYRUS, 1], [I.PAPYRUS, 1], [I.POTATOES_10_, 1]]);
  const seen = await handOver(f);
  assert.ok(seen.includes('Commendable. If I may have those, I will construct this experiment.'), seen.join(' | '));
  assert.equal(f.p.getInventory().getAmount(I.PAPYRUS), 0);
  assert.equal(f.p.getInventory().getAmount(I.POTATOES_10_), 0);
  assert.equal(f.p.getAttribute(STAGE_KEY), SECOND_EXPERIMENT_DONE);
});

test('without the potatoes Auguste keeps the papyrus and the experiment waits', async (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t, [[I.PAPYRUS, 1], [I.PAPYRUS, 1]]);
  const seen = await handOver(f);
  assert.equal(seen.includes('Commendable. If I may have those, I will construct this experiment.'), false, seen.join(' | '));
  assert.equal(f.p.getInventory().getAmount(I.PAPYRUS), 2);
  assert.equal(f.p.getAttribute(STAGE_KEY), FIRST_EXPERIMENT_DONE);
});
