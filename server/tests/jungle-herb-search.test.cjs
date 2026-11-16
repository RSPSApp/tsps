// Run after `yarn build`: node --test tests/jungle-herb-search.test.cjs
// Jungle Potion herb searches (docs/quests/jungle-potion/README.md). rsprox captures (local JunglePotion rev 242, rsprox.net
// 1148/1875/3030): "You search the <loc>..." (spam), then "You find a herb." in an objectbox with the grimy herb,
// and the loc turns into its empty variant until it grows back 99 ticks later. The marshy jungle vine plays
// seq 2094 + sound 1957 and rolls 10 ticks later; a miss replays the sound and retries a tick after. The palm
// tree finds it at once. Before this the herb was handed over at once and the loc never emptied.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();

const ROOT = path.resolve(__dirname, '..');
const VINE = [2763, 3044, 0];
const PALM = [2870, 3115, 0];
let PluginManager, ObjectDefinition, MapObjects, Location, Player, core, quest;
let index = 3100;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  ({ ObjectDefinition } = require('../dist/game/definition/ObjectDefinition'));
  ({ MapObjects } = require('../dist/game/entity/impl/object/MapObjects'));
  ({ Location } = require('../dist/game/model/Location'));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, 'plugins'));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((q) => q.key === 'jungle_potion');
  core.RegionManager.loadMapFiles(VINE[0], VINE[1]);
  core.RegionManager.loadMapFiles(PALM[0], PALM[1]);
});

function searcher(t, stage, [x, y, z]) {
  const p = new Player(null);
  p.setIndex(index++);
  p.setUsername('herbs' + index);
  p.setRegistered(true);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setLocation(new Location(x + 1, y, z));
  quest.setStage(p, stage);
  const seen = { spam: [], plain: [], anims: [], sounds: [], boxes: [] };
  const sender = p.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(p, 'sendMessage', (m) => { seen.plain.push(m); });
  t.mock.method(sender, 'sendTypedMessage', (type, m, ...r) => { (type === core.ChatType.SPAM ? seen.spam : seen.plain).push(m); return typed(type, m, ...r); });
  t.mock.method(sender, 'sendSound', (id) => { seen.sounds.push(id); return sender; });
  t.mock.method(p, 'performAnimation', (a) => { seen.anims.push(a.getId()); });
  t.mock.method(p.getDialogueManager(), 'startDialogues', (chain) => { seen.boxes.push(chain); });
  t.after(() => {
    PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
  });
  return { p, seen };
}

function search(p, id, [x, y, z]) {
  const object = MapObjects.get(id, new Location(x, y, z), null);
  assert.ok(object, `loc ${id} at ${x},${y}`);
  const event = { player: p, object, objectId: id, definition: ObjectDefinition.forId(id), clickType: 2, location: { x, y, z }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}

// Only the Jungle Potion plugin's rolls are fixed: global tasks (CalcifiedWater's cycle and the like)
// also call Math.random while these tests tick, and must not use up the vine's queued rolls.
function mockVineRolls(t, rolls) {
  const real = Math.random;
  t.mock.method(Math, 'random', () => {
    if (!String(new Error().stack).includes('JunglePotion.Quest.js')) return real();
    return Array.isArray(rolls) ? (rolls.shift() ?? 0) : rolls;
  });
}

const tick = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const locAt = (id, [x, y, z]) => MapObjects.get(id, new Location(x, y, z), null);
const grimy = (p, id) => p.getInventory().getAmount(id);

test('vine: search line, seq 2094 + sound 1957, the herb 10 ticks later in an objectbox; the vine empties and grows back after 99 ticks', (t) => {
  mockVineRolls(t, 0);
  const { p, seen } = searcher(t, 1, VINE);
  assert.equal(search(p, 2575, VINE).handled, true);
  assert.deepEqual(seen.spam, ['You search the vine...']);
  assert.deepEqual(seen.anims, [2094]);
  assert.deepEqual(seen.sounds, [1957]);
  tick(9);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0, 'nothing before the roll');
  tick(1);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 1);
  assert.equal(quest.getStage(p), 2);
  assert.deepEqual(seen.sounds, [1957, 1957]);
  assert.equal(seen.boxes.length, 1, 'the objectbox');
  assert.ok(locAt(2576, VINE), 'snake_vine_empty in its place');
  assert.equal(locAt(2575, VINE) ?? null, null);
  tick(98);
  assert.ok(locAt(2576, VINE), 'still empty at 98 ticks');
  tick(1);
  assert.ok(locAt(2575, VINE), 'the full vine is back at 99 ticks');
  assert.equal(locAt(2576, VINE) ?? null, null);
});

test('vine: a missed roll replays the sound, retries a tick later and finds it at 21 ticks', (t) => {
  const rolls = [0.95, 0];
  mockVineRolls(t, rolls);
  const { p, seen } = searcher(t, 1, VINE);
  search(p, 2575, VINE);
  tick(10);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0);
  assert.deepEqual(seen.sounds, [1957, 1957]);
  assert.deepEqual(seen.anims, [2094]);
  tick(1);
  assert.deepEqual(seen.anims, [2094, 2094], 'the next attempt');
  tick(9);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0);
  tick(1);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 1);
  tick(99);
  assert.ok(locAt(2575, VINE), 'grown back');
});

test('vine: walking away ends the search; nothing is found and the vine stays full', (t) => {
  mockVineRolls(t, 0);
  const { p } = searcher(t, 1, VINE);
  search(p, 2575, VINE);
  tick(3);
  p.getMovementQueue().walkStep(1, 0);
  tick(10);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0);
  assert.ok(locAt(2575, VINE));
});

test('vine: teleporting away mid-search ends it; no herb, and the vine stays full', (t) => {
  mockVineRolls(t, 0);
  const { p, seen } = searcher(t, 1, VINE);
  search(p, 2575, VINE);
  tick(3);
  p.moveTo(new Location(3222, 3218, 0));
  tick(10);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0);
  assert.equal(quest.getStage(p), 1);
  assert.equal(seen.boxes.length, 0);
  assert.ok(locAt(2575, VINE));
});

test('vine: an item action or Attack click (interaction cleared) ends the search', (t) => {
  mockVineRolls(t, 0);
  for (const reason of ['item', 'attack']) {
    const { p } = searcher(t, 1, VINE);
    search(p, 2575, VINE);
    tick(3);
    p.interactionCleared(reason);
    tick(10);
    assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0, reason);
    assert.ok(locAt(2575, VINE), reason);
  }
});

test('palm tree: the search line and the herb at once, the palm empties for 99 ticks', (t) => {
  const { p, seen } = searcher(t, 3, PALM);
  search(p, 2577, PALM);
  assert.deepEqual(seen.spam, ['You search the palm...']);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_ARDRIGAL), 1);
  assert.equal(quest.getStage(p), 4);
  assert.equal(seen.boxes.length, 1);
  assert.deepEqual(seen.anims, [], 'no search animation was recorded at the palm');
  assert.ok(locAt(2578, PALM), 'ardrigal_palm_empty');
  tick(99);
  assert.ok(locAt(2577, PALM), 'grown back');
});

test('before Trufitus asks, the search finds nothing and the vine stays full', (t) => {
  const { p, seen } = searcher(t, 0, VINE);
  search(p, 2575, VINE);
  tick(12);
  assert.deepEqual(seen.plain, ['Unfortunately, you find nothing of interest.']);
  assert.equal(grimy(p, core.ItemIdentifiers.GRIMY_SNAKE_WEED), 0);
  assert.ok(locAt(2575, VINE));
});
