// Run after `yarn build`: node --test tests/enlightened-journey-sapling.test.cjs
// Enlightened Journey's sapling (issue 6636: planted in Lumbridge's tree patch it vanished and nothing grew). Wiki
// (Auguste's sapling): it goes in a tree patch and grows into a willow tree. The Farming plugin plants it as one, with
// the transcript's "You have now planted Auguste's sapling. He will not give you any more." and "You plant the special
// willow sapling in the tree patch." in place of its own line ("Enlightened Journey" transcript). Every plugin loaded, a real
// Player and the native item-on-loc packet on Lumbridge's tree patch (8391, rsprox recording 127).
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
const STAGE_BASKET_BUILT = 90;
const BIT_SAPLING_GIVEN = 1 << 5;
const PATCH = { id: 8391, at: [3192, 3230, 0] };
const AUGUSTES_SAPLING = 9932;
const SPADE = 952;
const PLANT_POT = 5356;
let core, Farming, next = 9880;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(PATCH.at[0], PATCH.at[1]);
  PM.emitServerStartup({});
  Farming = require('../plugins/skills/farming/Patches.Farming');
});
after(() => PM.emitServerShutdown({}));

function actor(t, { stage = STAGE_GATHERING, items = [AUGUSTES_SAPLING, SPADE], record = null } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('sapling' + next);
  p.setRegistered(true); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(PATCH.at[0] + 3, PATCH.at[1] + 1, 0)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.FARMING, 30, false).setCurrentLevel(core.Skill.FARMING, 30, false);
  const c = new ClientConnection(channel); c.player = p;
  for (const id of items) p.getInventory().add(new core.Item(id, 1), true);
  p.setAttribute(STAGE_KEY, stage);
  p.setAttribute('quest.enlightened_journey.numbering', 2);
  p.setAttribute(FLAGS_KEY, BIT_SAPLING_GIVEN);
  if (record) p.setAttribute(SAPLING_KEY, record);
  const said = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (message, ...rest) => { said.push(String(message)); return send(message, ...rest); };
  const sender = p.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, message, ...rest) => { said.push(String(message)); return typed(type, message, ...rest); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, c, said };
}

function step(f, n = 1) {
  for (let i = 0; i < n; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process();
    Farming.tick(); f.c.processTurnPackets();
  }
}
const patchState = (f) => Farming.stateFor(f.p, Farming.findPatch(PATCH.id, { x: PATCH.at[0], y: PATCH.at[1], z: PATCH.at[2] }));

async function plant(f) {
  patchState(f).weeds = 0;
  await f.c.dispatch([{ type: 'item_on_object', widgetId: 149 << 16, objectId: PATCH.id, itemId: AUGUSTES_SAPLING,
    slot: f.p.getInventory().getSlotForItemId(AUGUSTES_SAPLING), x: PATCH.at[0], y: PATCH.at[1] }]);
  step(f, 6);
}

test("Auguste's sapling in Lumbridge's tree patch grows a willow there, with the transcript's lines", async (t) => {
  const f = actor(t);
  await plant(f);
  const state = patchState(f);
  assert.equal(state.crop, 'WILLOW', 'a willow is growing on the patch');
  assert.equal(state.status, 'growing');
  assert.equal(f.p.getInventory().getAmount(AUGUSTES_SAPLING), 0);
  assert.equal(f.p.getInventory().getAmount(PLANT_POT), 1);
  assert.deepEqual(f.said, ["You have now planted Auguste's sapling. He will not give you any more.",
    'You plant the special willow sapling in the tree patch.'], "the transcript's lines in its order, not Farming's own");
  const record = f.p.getAttribute(SAPLING_KEY);
  assert.deepEqual([record.x, record.y, record.z], PATCH.at);
  assert.equal(record.branchesAt, undefined, 'no private growth clock any more');
});

test('a tree patch already in use refuses the sapling and it stays in the inventory', async (t) => {
  const f = actor(t);
  Object.assign(patchState(f), { crop: 'OAK', stage: 1, status: 'growing', nextAt: Date.now() + 60_000 });
  await plant(f);
  assert.equal(patchState(f).crop, 'OAK');
  assert.equal(f.p.getInventory().getAmount(AUGUSTES_SAPLING), 1);
  assert.equal(f.p.getAttribute(SAPLING_KEY) ?? null, null, 'not planted');
});

test('a sapling "planted" by the old private clock comes back at login while the basket needs branches', (t) => {
  const old = { x: 3192, y: 3230, z: 0, plantedAt: 0, branchesAt: 0, nextBranchesAt: 0 };
  const f = actor(t, { items: [], record: old });
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getInventory().getAmount(AUGUSTES_SAPLING), 1);
  assert.equal(f.p.getAttribute(SAPLING_KEY) ?? null, null);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getInventory().getAmount(AUGUSTES_SAPLING), 1, 'once');
});

test('the old record is only dropped once the basket is built, and waits for a free slot', (t) => {
  const old = { x: 3192, y: 3230, z: 0, plantedAt: 0, branchesAt: 0, nextBranchesAt: 0 };
  const built = actor(t, { stage: STAGE_BASKET_BUILT, items: [], record: old });
  PM.emitPlayerLogin({ player: built.p, username: built.p.getUsername() });
  assert.equal(built.p.getInventory().getAmount(AUGUSTES_SAPLING), 0);
  assert.equal(built.p.getAttribute(SAPLING_KEY) ?? null, null);

  const full = actor(t, { items: [], record: old });
  for (let i = 0; i < 28; i++) full.p.getInventory().add(new core.Item(1511, 1), true);
  PM.emitPlayerLogin({ player: full.p, username: full.p.getUsername() });
  assert.equal(full.p.getInventory().getAmount(AUGUSTES_SAPLING), 0);
  assert.deepEqual(full.p.getAttribute(SAPLING_KEY), old, 'kept for a later login');
});

test('a planted sapling (the new record) is left alone at login', (t) => {
  const planted = { x: 3192, y: 3230, z: 0, plantedAt: 5 };
  const f = actor(t, { items: [], record: planted });
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getInventory().getAmount(AUGUSTES_SAPLING), 0);
  assert.deepEqual(f.p.getAttribute(SAPLING_KEY), planted);
});
