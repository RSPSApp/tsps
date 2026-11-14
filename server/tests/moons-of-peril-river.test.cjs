// Run after `yarn build`: node --test tests/moons-of-peril-river.test.cjs
//
// Neypotzli's bream spots (Moons of Peril river fishing) as they behave on main: pinned so that generalising the river
// unit for Vampyrium's leechfin changes nothing here. It passes on main and on the leechfin branch.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const SPOT = 62193;
const ZONE = 62191;
const FISHING_VARBIT = 15454;
const DIR_VARBIT = 15453;
const SPOT_1 = [1501, 9698];
const SPOT_2 = [1521, 9689];

let core;
let next = 9700;
/** Every task the plugins queue, for the whole file: the river unit keeps its one task between tests. */
const queue = [];
let riverTask = null;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  const { mock } = require('node:test');
  mock.method(core.TaskManager, 'submit', (task) => { queue.push(task); });
});

/** One tick of the river unit's newest task. */
const runTick = () => riverTask?.execute();

/** Ends everyone's fishing and lets the unit's task wind up. */
function done(...players) {
  for (const player of players) PluginManager.emitWalkRoute({ player, destination: { x: 1, y: 1, z: 0 }, handled: false });
  runTick();
}

function seeded(t, seed = 99) {
  let state = seed;
  t.mock.method(Math, 'random', () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x80000000; });
}

function makePlayer(t, { level = 20, gathered = true, at = [1501, 9699] } = {}) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null, new core.Location(at[0], at[1], 0));
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  player.setIndex(next++);
  player.setRegistered?.(true);
  player.getSkillManager().setCurrentLevel(core.Skill.FISHING, level, false).setMaxLevels(core.Skill.FISHING, level, false);
  const moons = runtime.questNamed('Perilous Moons');
  moons.setStage(player, gathered ? moons.completionValue : 0);
  player.getInventory().adds(core.ItemIdentifiers.BIG_FISHING_NET, 1);
  const messages = [];
  t.mock.method(player, 'sendMessage', (text) => { messages.push(text); });
  player.messages = messages;
  return player;
}

function click(player, id, [x, y]) {
  const object = new core.GameObject(id, new core.Location(x, y, 0), 10, 0, null);
  const queued = queue.length;
  const handled = clickObject(player, id, object, x, y);
  // starting the fishing queues the unit's one repeating task, the first thing queued
  if (queue.length > queued) riverTask = queue[queued];
  return handled;
}

function clickObject(player, id, object, x, y) {
  return PluginManager.emitObjectInteraction({ player, object, objectId: id, clickType: 1, location: { x, y, z: 0 }, handled: false });
}

const varbit = (player, id) => player.getPacketSender().getVarbit(id);

test('Neypotzli bream: gated by the gathering, 20 Fishing and a big fishing net', (t) => {
  const early = makePlayer(t, { gathered: false });
  click(early, SPOT, SPOT_1);
  assert.equal(varbit(early, FISHING_VARBIT), 0);
  const low = makePlayer(t, { level: 19 });
  click(low, SPOT, SPOT_1);
  assert.equal(varbit(low, FISHING_VARBIT), 0);
  assert.ok(low.messages.includes('You need a Fishing level of at least 20 to fish here.'));
  const bare = makePlayer(t);
  bare.getInventory().delete(core.ItemIdentifiers.BIG_FISHING_NET, 1);
  click(bare, SPOT, SPOT_1);
  assert.ok(bare.messages.includes('You need a big fishing net to fish here.'));
  const player = makePlayer(t);
  assert.equal(click(player, SPOT, SPOT_1), true);
  assert.equal(varbit(player, FISHING_VARBIT), 1);
  assert.equal(varbit(player, DIR_VARBIT), 1);
  // not fishing: the stream says so
  const idle = makePlayer(t);
  assert.equal(click(idle, ZONE, [1500, 9696]), true);
  done(player, idle);
});

test('Neypotzli bream: both spots catch raw bream for 3 XP a fish (plus the occasional extra), the lane being the aligned column or row', (t) => {
  seeded(t);
  for (const [spot, stand] of [[SPOT_1, [1501, 9699]], [SPOT_2, [1520, 9689]]]) {
    const player = makePlayer(t, { level: 60, at: stand });
    click(player, SPOT, spot);
    const before = player.getSkillManager().getExperience(core.Skill.FISHING);
    for (let i = 0; i < 300; i++) {
      // the stream tile in the spot's own lane keeps the 30 seconds from running out
      if (i % 20 === 0) click(player, ZONE, spot === SPOT_1 ? [1501, 9696] : [1523, 9689]);
      runTick();
    }
    const bream = player.getInventory().getAmount(core.ItemIdentifiers.RAW_BREAM);
    assert.ok(bream >= 10, `bream at ${spot}: ${bream}`);
    const gained = player.getSkillManager().getExperience(core.Skill.FISHING) - before;
    assert.ok(gained >= bream * 3 - 0.01 && gained < bream * 3 + 40 * bream, `xp ${gained} for ${bream}`);
    assert.equal(player.messages.filter((m) => m === 'The fish slips past your net!').length, 0, 'bream never slips');
    done(player);
  }
});

test('Neypotzli bream: a walk ends the fishing', (t) => {
  const player = makePlayer(t);
  click(player, SPOT, SPOT_1);
  PluginManager.emitWalkRoute({ player, destination: { x: 1, y: 1, z: 0 }, handled: false });
  assert.equal(varbit(player, FISHING_VARBIT), 0);
  done();
});
