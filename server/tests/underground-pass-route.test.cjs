// From server/: node --test tests/underground-pass-route.test.cjs (after yarn build).
// Underground Pass travel: the obstacles that used to advance the quest without moving the
// player now follow plugins/quests/quests/data/underground-pass-route.json (the live Shortest
// Path transport table). Handlers are dispatched through a stub plugin API.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const ROUTE = require('../plugins/quests/quests/data/underground-pass-route.json').links;

let core, quest, objectHook, itemOnObjectHook, actionHooks = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    emitCustomEvent() {},
    onObjectInteraction(fn) { if (typeof fn === 'function') objectHook = fn; },
    onItemOnObject(fn) { itemOnObjectHook = fn; },
    onCustomEvent(name, fn) { if (name === 'npc-dialogue:action') actionHooks.push(fn); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require('../plugins/quests/quests/UndergroundPass.Quest')(api);
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((entry) => entry.key === 'underground_pass');
});

function at(stage, x, y, z = 0) {
  const player = new Player(null);
  // A test player has no network session: give it one that swallows the packets (config writes etc.).
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  player.setRegistered(true);
  player.sendMessage = () => {};
  player.setLocation(new core.Location(x, y, z));
  quest.setStage(player, stage);
  return player;
}
const where = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const click = (player, objectId) => { const event = { player, objectId, handled: false }; objectHook(event); return event; };

test('every route link stays inside the pass and keeps its plane or crosses between the two levels', () => {
  assert.ok(ROUTE.length > 90);
  for (const link of ROUTE) {
    assert.equal(link.from.length, 3);
    assert.equal(link.to.length, 3);
  }
});

test('the cell gates, the unicorn-room tunnel and pipe, and the rockpile move the player', () => {
  const gate = at(3, 2393, 9656);
  click(gate, 3266);
  assert.deepEqual(where(gate), [2393, 9654, 0]);
  const tunnel = at(4, 2375, 9610);
  click(tunnel, 3219);
  assert.deepEqual(where(tunnel), [2370, 9666, 0]);
  const pipe = at(3, 2419, 9605);
  click(pipe, 3237);
  assert.deepEqual(where(pipe), [2412, 9605, 0]);
  const rocks = at(3, 2423, 9660);
  click(rocks, 3307);
  assert.deepEqual(where(rocks), [2420, 9667, 0]);
});

test('the maze shortcut gate needs 50 Thieving', () => {
  const player = at(3, 2379, 9619);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 49, false);
  click(player, 3268);
  assert.deepEqual(where(player), [2379, 9619, 0]);
  player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 50, false);
  click(player, 3268);
  assert.deepEqual(where(player), [2381, 9619, 0]);
});

test('the loose mud is dug through with a spade, and the rope swing needs a rope going east', (t) => {
  t.mock.method(Math, 'random', () => 0); // the swing's success roll
  const mud = at(3, 2394, 9650);
  itemOnObjectHook({ player: mud, objectId: 3216, itemId: core.ItemIdentifiers.SPADE, handled: false });
  assert.deepEqual(where(mud), [2392, 9646, 0]);
  const swing = at(2, 2460, 9697);
  click(swing, 23123);
  assert.deepEqual(where(swing), [2460, 9697, 0], 'no rope, no swing');
  swing.getInventory().add(new core.Item(core.ItemIdentifiers.ROPE, 1), false);
  click(swing, 23123);
  assert.deepEqual(where(swing), [2466, 9697, 0]);
  assert.equal(swing.getInventory().getAmount(core.ItemIdentifiers.ROPE), 0, 'the tied rope stays on the rock');
  click(swing, 23123);
  assert.deepEqual(where(swing), [2460, 9697, 0], 'swinging back needs no rope');
});

test('a rope used on the cache rock above the pit (loc 23125, "Rock") swings the player across (#5733)', (t) => {
  t.mock.method(Math, 'random', () => 0); // the swing's success roll
  // Cache: loc 23125 is the placed rock at 2460,9699 (no ops, no
  // transform); the "Rope swing" 23123 (op Swing-on) is the loc the route link is keyed
  // on. Using a rope on the rock must start the same swing as that link.
  const ROCK = 23125;
  const noRope = at(2, 2460, 9697);
  const miss = { player: noRope, objectId: ROCK, itemId: core.ItemIdentifiers.ROPE, handled: false };
  itemOnObjectHook(miss);
  assert.equal(miss.handled, true, 'the rock is handled (the swing refuses without a rope)');
  assert.deepEqual(where(noRope), [2460, 9697, 0], 'no rope in the inventory: no swing');
  const swing = at(2, 2460, 9697);
  swing.getInventory().add(new core.Item(core.ItemIdentifiers.ROPE, 1), false);
  const event = { player: swing, objectId: ROCK, itemId: core.ItemIdentifiers.ROPE, handled: false };
  itemOnObjectHook(event);
  assert.equal(event.handled, true);
  assert.deepEqual(where(swing), [2466, 9697, 0]);
});

// Wiki, Rope swing (Underground Pass, north): about 39% at Agility 1 and 100% from 78 (skilling
// chart low 100 / high 300); a failure drops the player into the subcavern's north-east corner
// (2485,9649) for up to 14 damage, and the rope is lost either way. The Pile of rocks (3265) at
// 2443,9651 at the end of that cavern's path climbs back to the start of the pass.
test('a failed rope swing loses the rope and drops the player into the subcavern below', (t) => {
  const roll = { value: 0 };
  t.mock.method(Math, 'random', () => roll.value);
  const swing = at(2, 2460, 9697);
  swing.getInventory().add(new core.Item(core.ItemIdentifiers.ROPE, 2), false);
  const messages = [];
  swing.sendMessage = (m) => messages.push(m);
  roll.value = 101 / 256; // Agility 1: 101 successes in 256, so this roll just fails
  click(swing, 23123);
  assert.deepEqual(where(swing), [2485, 9649, 0], 'into the pit');
  assert.equal(swing.getInventory().getAmount(core.ItemIdentifiers.ROPE), 1, 'one rope lost');
  assert.deepEqual(messages, ['You tie the rope to the rock...']);
  const pending = swing.getCombat().getHitQueue().pendingDamage;
  assert.equal(pending.length, 1);
  assert.ok(pending[0].getDamage() >= 1 && pending[0].getDamage() <= 14, String(pending[0].getDamage()));
  core.RegionManager.loadMapFiles(2485, 9649);
  assert.equal(core.RegionManager.blocked(new core.Location(2485, 9649, 0), null), false, 'a walkable landing');

  const again = at(2, 2460, 9697);
  again.getInventory().add(new core.Item(core.ItemIdentifiers.ROPE, 1), false);
  roll.value = 100.99 / 256; // the last roll that still succeeds at Agility 1
  click(again, 23123);
  assert.deepEqual(where(again), [2466, 9697, 0]);
  const expert = at(2, 2460, 9697);
  expert.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 78, false);
  expert.getInventory().add(new core.Item(core.ItemIdentifiers.ROPE, 1), false);
  roll.value = 0.9999;
  click(expert, 23123);
  assert.deepEqual(where(expert), [2466, 9697, 0], 'Agility 78 never fails');
});

test("the subcavern's pile of rocks climbs back to the start of the pass", () => {
  const climber = at(2, 2444, 9651);
  const event = { player: climber, objectId: 3265, location: { x: 2443, y: 9651, z: 0 }, handled: false };
  objectHook(event);
  assert.equal(event.handled, true);
  assert.deepEqual(where(climber), [2494, 9716, 0]);
  const other = at(2, 2471, 9620);
  const unreachable = { player: other, objectId: 3265, location: { x: 2470, y: 9620, z: 0 }, handled: false };
  objectHook(unreachable);
  assert.equal(unreachable.handled, false, 'the other cache pile is left alone');
});

test("the grilled pipe's crawl message and the portcullis action move the player", () => {
  const pipe = at(2, 2451, 9688);
  for (const fn of actionHooks) fn({ player: pipe, stepId: '2FlXvw' });
  assert.deepEqual(where(pipe), [2451, 9694, 0]);
  const lever = at(2, 2466, 9674);
  for (const fn of actionHooks) fn({ player: lever, stepId: 'bqNjX5' });
  assert.deepEqual(where(lever), [2464, 9674, 0]);
});
