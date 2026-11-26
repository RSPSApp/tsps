// Run after `yarn build`: node --test tests/enlightened-journey-willow-basket.test.cjs
// Enlightened Journey's basket (issue #4422). The Wiki's walkthrough lists the 12 willow branches as
// "buy from the Grand Exchange, or plant a willow sapling": once everything is handed to Auguste
// (zep_quest 80), 12 branches on the Entrana basket build it, wherever the branches came from: his
// "Great! Let me just put it all together..." and, two ticks after its continue, zep_quest 90 with
// the branches gone (rev 242 recording, ticks 1458-1463). Every plugin loaded, a real Player and
// native packets on the basket loc and the chatbox.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');

const STAGE_KEY = 'quest.enlightened_journey.stage';
const FLAGS_KEY = 'quest.enlightened_journey.flags';
const SAPLING_KEY = 'quest.enlightened_journey.sapling';
const STAGE_GATHERING = 70;
const STAGE_MATERIALS = 80;
const STAGE_BASKET_BUILT = 90;
// Red and yellow dye, sandbags, silk, bowl and the sapling handed over (the plugin's bits 0-5).
const ALL_HANDED = 0b111111;
const BASKET = { id: 19133, at: [2806, 3355, 0] };
let core, next = 9780;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(BASKET.at[0], BASKET.at[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { branches = 12, flags = ALL_HANDED, planted = false, stage = STAGE_MATERIALS } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('basket' + next);
  p.setRegistered(true); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(BASKET.at[0], BASKET.at[1] - 1, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  if (branches) p.getInventory().add(new core.Item(core.ItemIdentifiers.WILLOW_BRANCH, branches), true);
  p.setAttribute(STAGE_KEY, stage);
  p.setAttribute('quest.enlightened_journey.numbering', 2);
  p.setAttribute(FLAGS_KEY, flags);
  if (planted) p.setAttribute(SAPLING_KEY, { x: 3193, y: 3231, z: 0, plantedAt: 0 });
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (message, ...rest) => { messages.push(String(message)); return send(message, ...rest); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, c, messages };
}

function step(f, n = 1) {
  for (let i = 0; i < n; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); f.c.processTurnPackets();
  }
}
const text = (f) => f.p.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');

/** The branches on the basket; then Auguste's line continued and the scene's first beats. */
async function branchOnBasket(f) {
  await f.c.dispatch([{ type: 'item_on_object', widgetId: 149 << 16, objectId: BASKET.id, itemId: core.ItemIdentifiers.WILLOW_BRANCH,
    slot: f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.WILLOW_BRANCH), x: BASKET.at[0], y: BASKET.at[1] }]);
  step(f, 6);
  if (text(f) !== "Great! Let me just put it all together and we'll be ready for lift off! Speak to me again in a moment.") return;
  assert.equal(f.p.getAttribute(STAGE_KEY), STAGE_MATERIALS, 'nothing changes while the line shows');
  await f.c.dispatch([{ type: 'dialogue_continue', widgetId: (231 << 16) | 5, childIndex: -1 }]);
  f.c.processTurnPackets();
  step(f, 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.WILLOW_BRANCH), 12, 'not on the continue itself');
  step(f, 2);
}

test('12 bought willow branches build the basket without a planted sapling', async (t) => {
  const f = actor(t);
  await branchOnBasket(f);
  assert.equal(f.p.getAttribute(STAGE_KEY), STAGE_BASKET_BUILT, JSON.stringify(f.messages));
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.WILLOW_BRANCH), 0);
});

test('branches from the planted sapling still build it', async (t) => {
  const f = actor(t, { planted: true });
  await branchOnBasket(f);
  assert.equal(f.p.getAttribute(STAGE_KEY), STAGE_BASKET_BUILT);
});

test('before every material is handed to Auguste the branches do nothing', async (t) => {
  const f = actor(t, { flags: ALL_HANDED & ~0b100, stage: STAGE_GATHERING }); // the sandbags still owed
  await branchOnBasket(f);
  assert.equal(f.p.getAttribute(STAGE_KEY), STAGE_GATHERING);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.WILLOW_BRANCH), 12);
});
