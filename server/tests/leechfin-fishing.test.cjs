// Run after `yarn build`: node --test tests/leechfin-fishing.test.cjs
//
// Leechfin fishing (Vampyrium, The Blood Moon Rises, 30 Jun 2026): the two river spots south of the Ruined Village,
// the net alignment, the catch and the slip, cutting for blood sacs and squeezing sacs into a vial of blood. The
// whole plugin set is loaded, the clicks go through the real dispatchers and the ticks are run by hand.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const runtime = require('../plugins/quests/QuestRuntime');
const River = require('../plugins/bosses/moonsofperil/River.MoonsOfPeril');
const moons = require('../plugins/bosses/data/moons-of-peril.json');

const SPOT = 62193;
const ZONE = 62191;
const FISHING_VARBIT = 15454;
const DIR_VARBIT = 15453;
const SPOT_1 = [2710, 7819];
const SPOT_2 = [2721, 7825];
const STAND_1 = [2710, 7818];

let api;
let core;
let ids;
let next = 9500;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  api = { core: PluginManager.getCoreApi() };
  core = api.core;
  core.RegionManager.init();
  ObjectDefinition.init();
  const C = CacheDefinitions;
  ids = {
    leechfin: C.getObjId('leechfin'), sac: C.getObjId('blood_sac'), vial: C.getObjId('vial_empty'), blood: C.getObjId('vial_blood'),
    knife: C.getObjId('knife'), fletching: C.getObjId('fletching_knife'), net: core.ItemIdentifiers.BIG_FISHING_NET,
  };
});

/** A deterministic Math.random: a fixed sequence with a seed; `forced` overrides it while set. */
function seeded(t, seed = 12345) {
  let state = seed;
  const control = { forced: null };
  t.mock.method(Math, 'random', () => {
    if (control.forced !== null) return control.forced;
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x80000000;
  });
  return control;
}

function makePlayer(t, { level = 78, complete = true, at = STAND_1, net = true } = {}) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null, new core.Location(at[0], at[1], 0));
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  player.setIndex(next++);
  player.setRegistered?.(true);
  const skills = player.getSkillManager();
  skills.setCurrentLevel(core.Skill.FISHING, level, false).setMaxLevels(core.Skill.FISHING, level, false);
  const quest = runtime.questNamed('The Blood Moon Rises');
  quest.setStage(player, complete ? quest.completionValue : 0);
  if (net) player.getInventory().adds(ids.net, 1);
  const messages = [];
  t.mock.method(player, 'sendMessage', (text) => { messages.push(text); });
  player.messages = messages;
  return player;
}

/** The tasks the plugins queue; the test runs them by hand. The river unit starts from nothing. */
function tasks(t) {
  River._test.reset();
  const queued = [];
  t.mock.method(core.TaskManager, 'submit', (task) => { queued.push(task); });
  return queued;
}

const varbit = (player, id) => player.getPacketSender().getVarbit(id);

function click(player, id, [x, y], option = 1) {
  const object = new core.GameObject(id, new core.Location(x, y, 0), 10, 0, null);
  return PluginManager.emitObjectInteraction({ player, object, objectId: id, clickType: option, location: { x, y, z: 0 }, handled: false });
}

/** Runs the river task `n` ticks, the player clicking the stream now and then so the 30 seconds do not run out. */
function tick(queued, n = 1, player = null) {
  for (let i = 0; i < n; i++) {
    if (player && i % 20 === 0 && varbit(player, FISHING_VARBIT) === 1) click(player, ZONE, [2710, 7820]);
    queued[0]?.execute();
  }
}

const count = (player, id) => player.getInventory().getAmount(id);
const experience = (player, skill) => player.getSkillManager().getExperience(skill);

test('the cache: the river locs are multilocs on varbit 15454, the spots resolve to Fish and Align-net, the items are named and actioned', (t) => {
  const names = CacheDefinitions.getLocNames();
  assert.equal(names.get(62191), 'river_fishing_clickzone');
  assert.equal(names.get(62192), 'river_fishing_clickzone_active');
  assert.equal(names.get(62193), 'river_fishing_spot');
  assert.equal(names.get(62194), 'river_fishing_spot_enter');
  assert.equal(names.get(62195), 'river_fishing_spot_exit');
  assert.equal(CacheDefinitions.getVarbitId('river_fishing_is_fishing'), FISHING_VARBIT);
  assert.equal(CacheDefinitions.getVarbitId('river_fishing_dir'), DIR_VARBIT);
  const player = makePlayer(t);
  const spot = () => ObjectDefinition.forPlayer(SPOT, player);
  const zone = () => ObjectDefinition.forPlayer(ZONE, player);
  assert.equal(spot().id, 62194, 'idle: the spot is the "Fish" form');
  assert.equal(spot().getInteractions()[0], 'Fish');
  assert.equal(zone()?.id ?? -1, -1, 'idle: the stream tiles are nothing');
  player.getPacketSender().sendVarbit(FISHING_VARBIT, 1);
  assert.equal(spot().id, 62192, 'fishing: the spot is the "Stream" form');
  assert.equal(spot().getInteractions()[0], 'Align-net');
  assert.equal(zone().id, 62192);
  assert.equal(CacheDefinitions.getItem(ids.blood).name, 'Vial of blood');
  assert.equal(CacheDefinitions.getItem(ids.leechfin).name, 'Leechfin');
  const def = CacheDefinitions.getItem(ids.sac);
  const actions = def.inventoryActions ?? def.options ?? def.actions;
  assert.equal(actions[0], 'Squeeze');
  assert.equal(actions[4], 'Drop');
});

test("the data's two Vampyrium spots are the cache's: the spot loc on the tile, a click zone on every other tile of the box", () => {
  const spots = moons.river.spots.filter((spot) => spot.method === 'leechfin');
  assert.deepEqual(spots.map((spot) => spot.tile), [SPOT_1, SPOT_2]);
  for (const spot of moons.river.spots) {
    for (let x = spot.tile[0] - 12; x <= spot.tile[0] + 12; x += 8) for (let y = spot.tile[1] - 12; y <= spot.tile[1] + 12; y += 8) core.RegionManager.loadMapFiles(x, y, false);
    const at = (x, y) => MapObjects.getObjectsAt(new core.Location(x, y, 0), null).map((object) => object.getId());
    for (let x = spot.zones.x[0]; x <= spot.zones.x[1]; x++) for (let y = spot.zones.y[0]; y <= spot.zones.y[1]; y++) {
      const here = at(x, y);
      if (x === spot.tile[0] && y === spot.tile[1]) assert.ok(here.includes(SPOT), `spot loc at ${x},${y}`);
      else assert.ok(here.includes(ZONE), `click zone at ${x},${y}`);
    }
  }
});

test('the quest gate: before The Blood Moon Rises the spot does nothing; after it, Fish starts the fishing', (t) => {
  tasks(t);
  const early = makePlayer(t, { complete: false });
  click(early, SPOT, SPOT_1);
  assert.equal(varbit(early, FISHING_VARBIT), 0);
  const player = makePlayer(t);
  assert.equal(click(player, SPOT, SPOT_1), true);
  assert.equal(varbit(player, FISHING_VARBIT), 1);
  assert.equal(varbit(player, DIR_VARBIT), 1, 'the net starts in the middle lane');
});

test('start needs 78 Fishing, a big fishing net and a free slot; a boost is only checked at the start', (t) => {
  const queued = tasks(t);
  seeded(t);
  const low = makePlayer(t, { level: 77 });
  assert.equal(click(low, SPOT, SPOT_1), true);
  assert.equal(varbit(low, FISHING_VARBIT), 0);
  assert.ok(low.messages.includes('You need a Fishing level of at least 78 to fish here.'), JSON.stringify(low.messages));
  const bare = makePlayer(t, { net: false });
  click(bare, SPOT, SPOT_1);
  assert.equal(varbit(bare, FISHING_VARBIT), 0);
  assert.ok(bare.messages.includes('You need a big fishing net to fish here.'));
  const full = makePlayer(t);
  for (let i = 0; i < 27; i++) full.getInventory().adds(ids.knife, 1);
  click(full, SPOT, SPOT_1);
  assert.equal(varbit(full, FISHING_VARBIT), 0);
  assert.ok(full.messages.includes("You don't have enough inventory space to do that."));
  // boosted to 78, then the boost ends: the fishing carries on
  const boosted = makePlayer(t);
  click(boosted, SPOT, SPOT_1);
  boosted.getSkillManager().setCurrentLevel(core.Skill.FISHING, 70, false);
  tick(queued, 3, boosted);
  assert.equal(varbit(boosted, FISHING_VARBIT), 1, 'still fishing');
});

test('aligning the net in a stream tile sets the lane; the lane is the zone\'s column', (t) => {
  tasks(t);
  const player = makePlayer(t);
  click(player, SPOT, SPOT_1);
  assert.equal(click(player, ZONE, [2709, 7820]), true);
  assert.equal(varbit(player, DIR_VARBIT), 0);
  click(player, ZONE, [2711, 7821]);
  assert.equal(varbit(player, DIR_VARBIT), 2);
  click(player, SPOT, SPOT_1);
  assert.equal(varbit(player, DIR_VARBIT), 1);
  // the route does not walk the player into the stream
  const event = { player, object: new core.GameObject(ZONE, new core.Location(2709, 7820, 0), 10, 0, null), objectId: ZONE };
  PluginManager.emitObjectRoute(event);
  assert.deepEqual(event.destination, { x: STAND_1[0], y: STAND_1[1], z: 0 });
});

test('fish arrive in the aligned lane: a catch is a leechfin and 33.2 XP, a slip is 3 XP and the message', (t) => {
  const queued = tasks(t);
  const random = seeded(t);
  const player = makePlayer(t);
  click(player, SPOT, SPOT_1);
  const before = experience(player, core.Skill.FISHING);
  tick(queued, 400, player);
  const caught = count(player, ids.leechfin);
  const slipped = player.messages.filter((m) => m === 'The fish slips past your net!').length;
  assert.ok(caught > 5, `leechfin caught: ${caught}`);
  assert.ok(slipped > 0, 'some got away');
  assert.ok(Math.abs(experience(player, core.Skill.FISHING) - before - (caught * 33.2 + slipped * 3)) <= 1, `${experience(player, core.Skill.FISHING) - before} vs ${caught * 33.2 + slipped * 3}`);
  void random;
});

test('a forced roll: the success chart is 30 to 220 out of 256, so level 78 catches about 70 in 100', (t) => {
  seeded(t);
  // chance at 78: floor(30*21/98 + 220*77/98 + 0.5) = floor(6.43 + 172.86 + 0.5) = 179; (1 + 179) / 256
  const queued = tasks(t);
  const player = makePlayer(t);
  click(player, SPOT, SPOT_1);
  tick(queued, 600, player);
  const caught = count(player, ids.leechfin);
  const slipped = player.messages.filter((m) => m === 'The fish slips past your net!').length;
  const rate = caught / (caught + slipped);
  assert.ok(rate > 0.6 && rate < 0.8, `catch rate ${rate.toFixed(2)} (${caught}/${caught + slipped}), expected about 0.70`);
});

test('the fish come in 22-fish cycles of the Wiki pattern, then pause', () => {
  const sums = [];
  for (let seed = 1; seed <= 300; seed++) {
    let state = seed * 7919;
    const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x80000000; };
    const lanes = River.patternLanes(moons.river.methods.leechfin.pattern, 3, random);
    assert.equal(lanes.length, 22);
    const group = (from, to) => lanes.slice(from, to);
    const differs = (list, before) => list.every((lane, index) => lane !== (index === 0 ? before : list[index - 1]));
    assert.ok(differs(group(0, 7), undefined), `7 different: ${lanes}`);
    assert.equal(new Set(group(7, 9)).size, 1, '2 the same');
    assert.equal(new Set(group(9, 14)).size, 1, '5 the same');
    assert.ok(differs(group(14, 18), lanes[13]), '4 different');
    assert.equal(new Set(group(18, 20)).size, 1, '2 the same');
    assert.ok(differs(group(20, 22), lanes[19]), 'the last 2 different');
    sums.push(...lanes);
  }
  for (const lane of [0, 1, 2]) assert.ok(sums.filter((x) => x === lane).length > 1500, `lane ${lane} is used`);
});

test('the pause: 22 fish a tick for 22 ticks, then none for the lull', (t) => {
  const queued = tasks(t);
  seeded(t);
  const player = makePlayer(t);
  click(player, SPOT, SPOT_1);
  const perTick = [];
  for (let i = 0; i < 90; i++) {
    if (i % 20 === 0) click(player, ZONE, [2710, 7820]);
    const before = queued.length;
    queued[0].execute();
    perTick.push((queued.length - before) / 2); // a release queues two projectile legs
  }
  const releases = perTick.map((x) => (x > 0 ? 1 : 0));
  // one full cycle: a run of 22 releases between runs of 7 quiet ticks
  const text = releases.join('');
  assert.match(text, /0{7}1{22}0{7}1{22}/, text);
});

test('the fishing stops on a walk, on 30 seconds without a click, on a full inventory, and on logout; a new session starts clean', (t) => {
  const queued = tasks(t);
  seeded(t);
  const walker = makePlayer(t);
  click(walker, SPOT, SPOT_1);
  PluginManager.emitWalkRoute({ player: walker, destination: { x: 1, y: 1, z: 0 }, handled: false });
  assert.equal(varbit(walker, FISHING_VARBIT), 0);
  River._test.reset();
  queued.length = 0;
  const idle = makePlayer(t);
  click(idle, SPOT, SPOT_1);
  tick(queued, 60);
  assert.equal(varbit(idle, FISHING_VARBIT), 0, "timed out after the data's 50 ticks");
  River._test.reset();
  queued.length = 0;
  const filling = makePlayer(t);
  click(filling, SPOT, SPOT_1);
  for (let i = 0; i < 26; i++) filling.getInventory().adds(ids.knife, 1);
  tick(queued, 400, filling);
  assert.equal(varbit(filling, FISHING_VARBIT), 0, 'full inventory ends it');
  assert.ok(filling.messages.includes("You don't have enough inventory space to do that."));
  River._test.reset();
  queued.length = 0;
  const leaver = makePlayer(t);
  click(leaver, SPOT, SPOT_1);
  PluginManager.emitPlayerLogout({ player: leaver, username: 'leech_tester' });
  tick(queued, 3);
  const again = makePlayer(t);
  assert.equal(varbit(again, FISHING_VARBIT), 0, 'a new session is not fishing');
  assert.equal(click(again, SPOT, SPOT_1), true);
});

test('cutting: a knife or a fletching knife on leechfin, 20 Cooking XP each, a third of them a blood sac, one a tick, and it ends the fishing', (t) => {
  const queued = tasks(t);
  seeded(t, 777);
  const player = makePlayer(t);
  click(player, SPOT, SPOT_1);
  assert.equal(varbit(player, FISHING_VARBIT), 1);
  player.getInventory().adds(ids.leechfin, 12);
  player.getInventory().adds(ids.knife, 1);
  const cooking = experience(player, core.Skill.COOKING);
  const on = (tool) => PluginManager.emitItemOnItem({ player, usedItem: new core.Item(tool, 1), usedItemId: tool, usedItemSlot: 1, usedWithItem: new core.Item(ids.leechfin, 1), usedWithItemId: ids.leechfin, usedWithItemSlot: 0, handled: false });
  assert.equal(on(ids.knife), true);
  assert.equal(varbit(player, FISHING_VARBIT), 0, 'cutting ends the fishing');
  assert.equal(count(player, ids.leechfin), 11, 'the first is cut at once');
  const cutter = queued.at(-1);
  for (let i = 0; i < 11; i++) cutter.execute();
  assert.equal(count(player, ids.leechfin), 0, 'one a tick until none is left');
  assert.equal(experience(player, core.Skill.COOKING) - cooking, 12 * 20);
  const sacs = count(player, ids.sac);
  assert.ok(sacs >= 1 && sacs <= 12, `blood sacs ${sacs}`);
  // the fletching knife does the same
  player.getInventory().adds(ids.fletching, 1);
  player.getInventory().adds(ids.leechfin, 1);
  assert.equal(on(ids.fletching), true);
  assert.equal(count(player, ids.leechfin), 0);
});

test('cutting stops when the player walks away, and with a third of the cuts yielding sacs on average', (t) => {
  const queued = tasks(t);
  const random = seeded(t, 4242);
  const player = makePlayer(t);
  player.getInventory().adds(ids.leechfin, 20);
  player.getInventory().adds(ids.knife, 1);
  const on = () => PluginManager.emitItemOnItem({ player, usedItem: new core.Item(ids.knife, 1), usedItemId: ids.knife, usedItemSlot: 1, usedWithItem: new core.Item(ids.leechfin, 1), usedWithItemId: ids.leechfin, usedWithItemSlot: 0, handled: false });
  on();
  const cutter = queued.at(-1);
  cutter.execute();
  PluginManager.emitWalkRoute({ player, destination: { x: 1, y: 1, z: 0 }, handled: false });
  const left = count(player, ids.leechfin);
  cutter.execute();
  assert.equal(count(player, ids.leechfin), left, 'no more cuts after a walk');
  // the chance: 1 in 3 over many cuts
  random.forced = 0.3;
  player.getInventory().adds(ids.leechfin, 1);
  const sacs = count(player, ids.sac);
  on();
  assert.equal(count(player, ids.sac), sacs + 1, 'a roll under 1/3 gives a sac');
  random.forced = 0.4;
  const sacs2 = count(player, ids.sac);
  player.getInventory().adds(ids.leechfin, 1);
  on();
  assert.equal(count(player, ids.sac), sacs2, 'a roll over 1/3 gives none');
});

const squeeze = (player) => PluginManager.emitItemAction({ player, interfaceId: 3214, item: new core.Item(ids.sac, 1), itemId: ids.sac, slot: 0, clickType: 1, option: 'Squeeze', handled: false });

test('squeezing: 50 sacs and an empty vial make a vial of blood', (t) => {
  tasks(t);
  const player = makePlayer(t);
  player.getInventory().adds(ids.sac, 120);
  player.getInventory().adds(ids.vial, 1);
  assert.equal(squeeze(player), true);
  assert.equal(count(player, ids.sac), 70);
  assert.equal(count(player, ids.vial), 0);
  assert.equal(count(player, ids.blood), 1);
});

test('squeezing without a vial: the warning, then "You squeeze a sac. It empties onto the floor."; No keeps the sac', (t) => {
  tasks(t);
  const player = makePlayer(t);
  player.getInventory().adds(ids.sac, 5);
  assert.equal(squeeze(player), true);
  const pending = MultiChatboxPrompt.getPending(player);
  assert.ok(pending, 'a warning is given');
  assert.deepEqual(pending.options, ['Yes.', 'No.']);
  MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 2 });
  assert.equal(count(player, ids.sac), 5);
  squeeze(player);
  MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1 });
  assert.equal(count(player, ids.sac), 4);
  assert.ok(player.messages.includes('You squeeze a sac. It empties onto the floor.'));
});

test('squeezing with a vial but fewer than 50 sacs changes nothing and says so (ours: the Wiki is silent)', (t) => {
  tasks(t);
  const player = makePlayer(t);
  player.getInventory().adds(ids.sac, 49);
  player.getInventory().adds(ids.vial, 1);
  squeeze(player);
  assert.equal(count(player, ids.sac), 49);
  assert.equal(count(player, ids.vial), 1);
  assert.ok(player.messages.includes('You need 50 blood sacs to fill a vial.'));
});
