// From server/: node --test tests/fishing-trawler.test.cjs (after yarn build).
//
// Fishing Trawler against the OSRS Wiki (Fishing_Trawler, /Strategies): the contribution points,
// leaks and water, the net and the Kraken, sinking and returning, each player's share of the
// catch (trawler_overlay's x1 at 100 to x1.5 at 255), the reward rules and the lobby.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Shared, Voyage, Rewards, Lobby, Sea;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Shared = require('../plugins/minigames/fishingtrawler/Shared.FishingTrawler');
  Shared.bind({ core });
  ({ Voyage } = require('../plugins/minigames/fishingtrawler/Voyage.FishingTrawler'));
  Rewards = require('../plugins/minigames/fishingtrawler/Rewards.FishingTrawler');
  Lobby = require('../plugins/minigames/fishingtrawler/Lobby.FishingTrawler');
  Sea = require('../plugins/minigames/fishingtrawler/Sea.FishingTrawler');
});

function fakePlayer({ fishing = 99, registered = true, hitpoints = 10, location = [2665, 3170, 1], privateArea = null, dying = false } = {}) {
  const attributes = new Map();
  const player = {
    messages: [],
    sendMessage: (text) => player.messages.push(text),
    isRegistered: () => registered,
    getHitpoints: () => hitpoints,
    isDyingReturn: () => dying,
    getPrivateArea: () => privateArea,
    getLocation: () => ({ getX: () => location[0], getY: () => location[1], getZ: () => location[2] }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({ getMaxLevel: () => fishing, getCurrentLevel: () => fishing }),
    getInventory: () => ({ contains: () => false, getAmount: () => 0 }),
    getEquipment: () => ({ contains: () => false, getAmount: () => 0 }),
    getBank: () => ({ contains: () => false, getAmount: () => 0, getFreeSlots: () => 800 }),
    getCurrentBankTab: () => 0,
  };
  return player;
}

/** A random source that plays back `values`, then `fallback`. */
function sequence(values, fallback = 0.99) {
  let i = 0;
  return () => (i < values.length ? values[i++] : fallback);
}

test('every id resolves from the cache', () => {
  const ids = Shared.ids();
  assert.equal(ids.interfaces.overlay, 366);
  assert.equal(ids.varbits.hull.length, 16);
  assert.deepEqual([ids.items.bucket, ids.items.bucketFull, ids.items.swampPaste], [583, 585, 1941]);
  assert.equal(ids.fish.length, 10);
  assert.equal(ids.junk.length, 8);
});

test('the Wiki contribution points, capped at 255', () => {
  const player = fakePlayer();
  const voyage = new Voyage([player], () => 0.99);
  voyage.leaks[3] = 2;
  assert.equal(voyage.patch(player, 3), true);
  assert.equal(voyage.contribution.get(player), 5);
  assert.equal(voyage.patch(player, 3), false, 'a patched leak is not patched again');
  voyage.water = 10;
  voyage.bail(player);
  assert.equal(voyage.contribution.get(player), 7);
  voyage.netRipped = true;
  voyage.mendNet(player);
  assert.equal(voyage.contribution.get(player), 14);
  voyage.rails.port = 2;
  voyage.fixRail(player, 'port');
  assert.equal(voyage.contribution.get(player), 24);
  for (let i = 0; i < 50; i++) voyage.addPoints(player, 10);
  assert.equal(voyage.contribution.get(player), 255);
});

test('open leaks let water in, bailing takes it out, a full hull sinks the trawler', () => {
  const player = fakePlayer();
  const voyage = new Voyage([player], () => 0.99);
  voyage.leaks.fill(2, 0, 4);
  voyage.tick();
  assert.ok(Math.abs(voyage.water - 4 * Shared.DATA.timing.waterPerLeakTick) < 1e-9);
  voyage.water = 5;
  voyage.bail(player);
  assert.equal(voyage.water, 2);
  voyage.water = 99.99;
  voyage.tick();
  assert.equal(voyage.ended, true);
  assert.equal(voyage.result, 'sunk');
});

test('every 5 ticks the hull is back to 6-11 leaking spots at once, with no message', () => {
  const player = fakePlayer();
  const voyage = new Voyage([player], () => 0);
  voyage.leaks[0] = Shared.DATA.values.hull.patched;
  for (let i = 0; i < 4; i++) voyage.tick();
  assert.equal(voyage.openLeaks(), 0);
  voyage.tick();
  assert.equal(voyage.openLeaks(), 6, 'the smallest batch, patched spots included');
  assert.ok(!player.messages.some((m) => /leak/i.test(m)), 'no leak message');
  const most = new Voyage([fakePlayer()], () => 0.999);
  for (let i = 0; i < 5; i++) most.tick();
  assert.equal(most.openLeaks(), 11);
});

test('a torn net catches nothing; an attacking tentacle halves the catch', () => {
  const player = fakePlayer();
  const voyage = new Voyage([player], () => 0.99);
  voyage.tickCatch();
  const whole = voyage.catch;
  assert.ok(whole > 0);
  voyage.netRipped = true;
  voyage.tickCatch();
  assert.equal(voyage.catch, whole);
  voyage.netRipped = false;
  voyage.tentacles.port.state = Shared.DATA.values.tentacle.attacking;
  voyage.tickCatch();
  assert.ok(Math.abs(voyage.catch - whole * 1.5) < 1e-9);
});

test('the captured tentacle cycle: 2, then 3 with the Kraken ripping the net, then 2; its rail 1 then 2', () => {
  const player = fakePlayer();
  const { timing, values } = Shared.DATA;
  const voyage = new Voyage([player], () => 0.999);
  const at = (tick) => { voyage.tickCount = tick; voyage.tickTentacles(); };
  at(timing.tentacleEvery);
  assert.equal(voyage.tentacles.port.state, values.tentacle.attacking, '0 -> 2 as it appears');
  assert.equal(player.messages.at(-1), Shared.message('kraken'));
  at(timing.tentacleEvery + timing.railDamagedAt);
  assert.equal(voyage.rails.port, values.rail.damaged, 'the rail 1 three ticks in');
  at(timing.tentacleEvery + timing.tentacleRipAt);
  assert.equal(voyage.tentacles.port.state, values.tentacle.sweeping);
  assert.equal(voyage.netRipped, true);
  assert.equal(player.messages.at(-1), Shared.message('krakenRipped'));
  assert.equal(voyage.chop(player, 'port'), null, 'not choppable while it sweeps');
  at(timing.tentacleEvery + timing.tentacleRipAt + timing.tentacleSweepTicks);
  assert.equal(voyage.tentacles.port.state, values.tentacle.attacking);
  at(timing.tentacleEvery + voyage.tentacles.port.breaksIn);
  assert.equal(voyage.rails.port, values.rail.broken, 'broken 12-17 ticks after that');
  at(timing.tentacleEvery + timing.tentacleLifetime);
  assert.equal(voyage.tentacles.port.state, values.tentacle.none);
  assert.equal(voyage.rails.port, values.rail.broken, 'a broken rail stays broken until fixed');

  voyage.tentacles.starboard = { state: values.tentacle.attacking, since: voyage.tickCount, chops: 0, breaksIn: 99 };
  voyage.rails.starboard = values.rail.damaged;
  assert.equal(voyage.chop(player, 'starboard'), 'hit');
  assert.equal(voyage.chop(player, 'starboard'), 'hit');
  assert.equal(voyage.chop(player, 'starboard'), 'drove');
  assert.equal(voyage.tentacles.starboard.state, values.tentacle.none);
  assert.equal(voyage.rails.starboard, values.rail.intact, 'driven off before it broke, the rail is whole again');
});

test('trawler_timeinfo: 5 at the start, 4 from 27 ticks in, then one less every 100', () => {
  const voyage = new Voyage([fakePlayer()], () => 0.999);
  const minutes = (tick) => { voyage.tickCount = tick; return voyage.minutesLeft(); };
  assert.deepEqual([0, 26, 27, 126, 127, 427, 499].map(minutes), [5, 5, 4, 4, 3, 0, 0]);
});

test('crossing 50 says the share is earned; the end lists what the player did', () => {
  const player = fakePlayer();
  const voyage = new Voyage([player], () => 0.999);
  for (let i = 0; i < 10; i++) voyage.addPoints(player, 5, 'leaks');
  assert.equal(player.messages.filter((m) => m === Shared.message('earned')).length, 1);
  voyage.addPoints(player, 7, 'nets');
  const [contributed, summary] = voyage.summaryFor(player);
  assert.equal(contributed, 'You have contributed enough to earn rewards! Contribution:57/255');
  assert.equal(summary, 'Nets fixed:<col=ff0000>1</col> Leaks patched:<col=ff0000>10</col> Water bailed:<col=ff0000>0</col> Tentacles hacked and railings fixed:<col=ff0000>0</col>.');
});

test('the trip comes back after five minutes, and the share follows the HUD meter', () => {
  const player = fakePlayer();
  const voyage = new Voyage([player], () => 0.99);
  for (let i = 0; i < Shared.DATA.timing.trawlTicks; i++) {
    voyage.leaks.fill(0);
    voyage.tick();
  }
  assert.equal(voyage.result, 'returned');
  voyage.catch = 20;
  voyage.contribution.set(player, 80);
  assert.equal(voyage.shareFor(player), 20);
  voyage.contribution.set(player, 255);
  assert.equal(voyage.shareFor(player), 30);
  voyage.contribution.set(player, 178);
  assert.equal(voyage.shareFor(player), 25);
});

test('a bigger crew catches less each, down to the floor', () => {
  const solo = new Voyage([fakePlayer()], () => 0.99);
  const crew = new Voyage(Array.from({ length: 10 }, () => fakePlayer()), () => 0.99);
  const big = new Voyage(Array.from({ length: 30 }, () => fakePlayer()), () => 0.99);
  solo.tickCatch();
  crew.tickCatch();
  big.tickCatch();
  assert.ok(crew.catch < solo.catch);
  assert.ok(Math.abs(big.catch - solo.catch * Shared.DATA.catch.crewFloor) < 1e-9);
});

test('the catch only holds fish the player can catch, up to two junk, and one angler roll a catch', () => {
  const ids = Shared.ids();
  const reward = Rewards.rollCatch(40, 40, sequence([], 0.5));
  const levels = new Map(ids.fish.map((fish) => [fish.id, fish.level]));
  const fishCount = reward.items.filter(([id]) => levels.has(id)).reduce((sum, [, n]) => sum + n, 0);
  assert.equal(fishCount, 40);
  for (const [id] of reward.items) if (levels.has(id)) assert.ok(levels.get(id) <= 40);
  const junk = reward.items.filter(([id]) => ids.junk.includes(id)).reduce((sum, [, n]) => sum + n, 0);
  assert.ok(junk <= 2);
  // A roll of 0 wins the one angler roll: a single piece, never the owned hat.
  const lucky = Rewards.rollCatch(1, 99, () => 0, (id) => id === ids.items.anglerHat);
  assert.equal(lucky.angler.length, 1);
  assert.notEqual(lucky.angler[0], ids.items.anglerHat);
});

test("higher tiers take over with level: about 0.67 lobster at 40, about 0.21 at 50 (the Wiki's chart)", () => {
  const ids = Shared.ids();
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const lobster = ids.fish.find((fish) => fish.level === 40).id;
  const share = (level) => {
    const eligible = ids.fish.filter((fish) => fish.level <= level);
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (Rewards.rollFish(eligible, random).id === lobster) hits++;
    return hits / 4000;
  };
  assert.ok(Math.abs(share(40) - 0.67) < 0.05);
  assert.ok(Math.abs(share(50) - 0.21) < 0.05);
});

test('a share needs 50 contribution and 15 Fishing', () => {
  const low = fakePlayer({ fishing: 10 });
  const idle = fakePlayer();
  const busy = fakePlayer();
  const voyage = new Voyage([low, idle, busy], () => 0.99);
  voyage.catch = 10;
  voyage.contribution.set(low, 200);
  voyage.contribution.set(idle, 49);
  voyage.contribution.set(busy, 50);
  assert.equal(Rewards.award(low, voyage, () => 0.5), null);
  assert.equal(low.messages.at(-1), Shared.message('lowLevel'));
  assert.equal(Rewards.award(idle, voyage, () => 0.5), null);
  assert.equal(idle.messages.at(-1), Shared.message('tooLittle'));
  assert.ok(Rewards.award(busy, voyage, () => 0.5));
  assert.ok(busy.getAttribute(Shared.REWARD_ATTRIBUTE).items.length > 0);
});

test('sailing again throws back a catch left in the net', () => {
  const player = fakePlayer();
  player.setAttribute(Shared.REWARD_ATTRIBUTE, { items: [[317, 3]], xp: 2 });
  const launch = Sea.launch;
  let launched = null;
  require('../plugins/minigames/fishingtrawler/Sea.FishingTrawler').launch = (players) => { launched = players; };
  try {
    // Lobby.depart calls Sea.launch through the module it imported.
    Lobby.depart([player]);
  } finally {
    require('../plugins/minigames/fishingtrawler/Sea.FishingTrawler').launch = launch;
  }
  assert.equal(player.getAttribute(Shared.REWARD_ATTRIBUTE), null);
  assert.equal(player.messages.at(-1), Shared.message('destroyedReward'));
  assert.deepEqual(launched, [player]);
});

test('the Ardougne easy task completes when the lobby launches a voyage', () => {
  const api = Shared.api();
  const emitCustomEvent = api.emitCustomEvent;
  const launch = Sea.launch;
  const { area, departAt, task } = Lobby.lobby;
  const { voyage } = Sea.sea;
  const events = [];
  const first = fakePlayer();
  const second = fakePlayer();
  const outside = fakePlayer({ location: [2674, 3170, 1] });
  const privatePlayer = fakePlayer({ privateArea: {} });
  const dead = fakePlayer({ hitpoints: 0 });
  const dying = fakePlayer({ dying: true });
  const unregistered = fakePlayer({ registered: false });
  Shared.bind({ ...api, emitCustomEvent: (name, event) => events.push([name, event]) });
  Lobby.lobby.area = { getPlayers: () => [first, second, first, outside, privatePlayer, dead, dying, unregistered] };
  Sea.launch = (players) => {
    const launched = { players };
    Sea.sea.voyage = launched;
    return launched;
  };

  try {
    Lobby.lobby.departAt = 0;
    Lobby.tickLobby();
    assert.deepEqual(Sea.sea.voyage.players, [first, second]);
    assert.deepEqual(events, [first, second].map((player) => ["diary:task", {
      player,
      diary: "ardougne",
      task: "go-out-fishing-on-the-fishing-trawler",
    }]));

    Lobby.tickLobby();
    assert.equal(events.length, 2, 'the queued tick does not credit the same departure again');
  } finally {
    Shared.bind(api);
    Sea.launch = launch;
    Sea.sea.voyage = voyage;
    Lobby.lobby.area = area;
    Lobby.lobby.departAt = departAt;
    Lobby.lobby.task = task;
  }
  assert.equal(Shared.api().emitCustomEvent, emitCustomEvent);
});

test('the Ardougne easy task does not complete while queued or when launch fails', () => {
  const api = Shared.api();
  const launch = Sea.launch;
  const { area, departAt, task } = Lobby.lobby;
  const { voyage } = Sea.sea;
  const events = [];
  const player = fakePlayer();
  Shared.bind({ ...api, emitCustomEvent: (name, event) => events.push([name, event]) });
  Lobby.lobby.area = { getPlayers: () => [player] };

  try {
    Sea.sea.voyage = {};
    Lobby.lobby.departAt = 0;
    Lobby.tickLobby();
    assert.deepEqual(events, [], 'waiting for the trawler at sea does not count');

    Sea.sea.voyage = null;
    Lobby.lobby.departAt = 0;
    Sea.launch = () => null;
    Lobby.tickLobby();
    assert.deepEqual(events, [], 'a failed launch does not count');
  } finally {
    Shared.bind(api);
    Sea.launch = launch;
    Sea.sea.voyage = voyage;
    Lobby.lobby.area = area;
    Lobby.lobby.departAt = departAt;
    Lobby.lobby.task = task;
  }
});

test("the crates only answer for the trawler's own: other Hammers crates fall through", () => {
  const Actions = require('../plugins/minigames/fishingtrawler/Actions.FishingTrawler');
  const ids = Shared.ids();
  const added = [];
  const player = { getInventory: () => ({ getFreeSlots: () => 28, addItem: (item) => added.push(item.getId()) }) };
  const take = Actions._crates;
  assert.equal(take.takeHammer({ player, objectId: 45497 }), false);
  assert.deepEqual(added, []);
  assert.equal(take.takeHammer({ player, objectId: ids.locs.crateHammers }), true);
  assert.deepEqual(added, [ids.items.hammer]);
});

test('a full bank keeps the rest of the catch in the net', () => {
  const player = fakePlayer();
  const banked = [];
  player.getBank = () => ({ contains: () => false, getAmount: () => 0,
    getFreeSlots: () => banked.length === 0 ? 1 : 0,
    getAddableAmount: (item) => banked.length === 0 ? item.getAmount() : 0,
    add: (item) => banked.push(item.getId()) });
  player.getSkillManager = () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences: () => {} });
  player.setAttribute(Shared.REWARD_ATTRIBUTE, { items: [[317, 3], [321, 2]], xp: 10 });
  Rewards.inspectNet({ player });
  assert.deepEqual(banked, [317]);
  assert.deepEqual(player.getAttribute(Shared.REWARD_ATTRIBUTE).items, [[321, 2]]);
  assert.equal(player.messages.at(-1), Shared.message('bankFull'));
});

test('real capped stacks retain the catch and only delivered fish earn XP', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null), xp = [];
  t.mock.method(p, 'sendMessage', () => {});
  t.mock.method(p.getSkillManager(), 'addExperiences', (_skill, amount) => xp.push(amount));
  const fish = Shared.ids().fish.find(fish => fish.id === 317), bank = p.getBank(0);
  bank.add(new core.Item(fish.id, 2147483647), false);
  p.setAttribute(Shared.REWARD_ATTRIBUTE, { items: [[fish.id, 3]], xp: 3 * fish.xp });
  Rewards.inspectNet({ player: p });
  assert.deepEqual(xp, []);
  assert.equal(bank.getAmount(fish.id), 2147483647);
  assert.deepEqual(p.getAttribute(Shared.REWARD_ATTRIBUTE).items, [[fish.id, 3]]);
  bank.deleted(fish.id, 1, false);
  Rewards.inspectNet({ player: p });
  assert.equal(bank.getAmount(fish.id), 2147483647);
  assert.deepEqual(xp, [fish.xp]);
  assert.deepEqual(p.getAttribute(Shared.REWARD_ATTRIBUTE).items, [[fish.id, 2]]);
  bank.deleted(fish.id, 2, false);
  Rewards.inspectNet({ player: p });
  assert.equal(p.getAttribute(Shared.REWARD_ATTRIBUTE), null);
  assert.equal(xp.reduce((sum, amount) => sum + amount, 0), 3 * fish.xp);
  Rewards.inspectNet({ player: p });
  assert.equal(xp.length, 2, 'collected XP cannot be earned twice');
});

test('the catch is banked while the bank has space, however full its tab', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null), bank = p.getBank(0);
  t.mock.method(p, 'sendMessage', () => {});
  t.mock.method(p.getSkillManager(), 'addExperiences', () => {});
  bank.setItems(Array.from({ length: bank.capacity() }, (_, i) => new core.Item(10000 + i, 1)));
  p.setAttribute(Shared.REWARD_ATTRIBUTE, { items: [[317, 3]], xp: 10 });
  Rewards.inspectNet({ player: p });
  assert.equal(bank.getAmount(317), 3);
  assert.equal(p.getAttribute(Shared.REWARD_ATTRIBUTE), null);
});

test('angler rolls finish each of two sets before repeating any piece', () => {
  const ids = Rewards.ANGLER_PIECES.map(piece => Shared.ids().items[piece]);
  const amounts = new Map(ids.map(id => [id, 1]));
  for (let i = 0; i < 4; i++) {
    const result = Rewards.rollCatch(1, 99, () => 0, id => amounts.get(id));
    assert.equal(result.angler.length, 1);
    const id = result.angler[0];
    assert.equal(amounts.get(id), 1, 'no repeated piece while the second set is incomplete');
    amounts.set(id, 2);
  }
  assert.deepEqual(Rewards.rollCatch(1, 99, () => 0, id => amounts.get(id)).angler, []);
});

test('balance: an idle crew sinks before the end, a steady patcher lasts the whole trip', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const idle = new Voyage([fakePlayer()], random);
  for (let i = 0; i < Shared.DATA.timing.trawlTicks && !idle.ended; i++) idle.tick();
  assert.equal(idle.result, 'sunk');

  const player = fakePlayer();
  const busy = new Voyage([player], random);
  for (let i = 0; i < Shared.DATA.timing.trawlTicks && !busy.ended; i++) {
    busy.tick();
    // About one patch every 2 ticks, as a player does walking between leaks.
    if (i % 2 === 0) {
      const spot = busy.leaks.indexOf(Shared.DATA.values.hull.leak);
      if (spot >= 0) busy.patch(player, spot);
    }
  }
  assert.equal(busy.result, 'returned');
  assert.equal(busy.contribution.get(player), Shared.DATA.points.max);
});
