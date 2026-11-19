const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeRoster } = require('../plugins/bots/runtime/Roster.PlayerBots');
const { managedBotCount, trackNativeDeployment } = require('../plugins/bots/runtime/Deploy.PlayerBots');
const { attachRoster, planRosterOrder } = require('../plugins/minigames/castlewars/Roster.CastleWars');
const { canBalance } = require('../plugins/minigames/soulwars/Roster.SoulWars');

const teams = (blue, red) => ({ blue: { routine: 'mixed', count: blue }, red: { routine: 'custom_example', count: red } });

test('team roster accepts two independent routines and disallows unknown modes and invalid counts', () => {
  assert.deepEqual(normalizeRoster('soul-wars', teams(1, 3)), { ...teams(1, 3), blue: { routine: 'soul_wars_match', count: 1 } });
  assert.throws(() => normalizeRoster('pest-control', teams(1, 3)), /team minigame/);
  assert.throws(() => normalizeRoster('soul-wars', teams(0, 0)), /at least one/);
  assert.throws(() => normalizeRoster('soul-wars', teams(-1, 0)), /nonnegative whole/);
  assert.throws(() => normalizeRoster('soul-wars', { ...teams(1, 3), blue: { routine: 'pvp', count: 1 } }), /saved routine/);
});

test('Castle Wars roster only admits teams that a normal portal would accept', () => {
  const counts = { saradomin: 1, zamorak: 0 };
  const choose = (pending, team) => pending[team] <= pending[team === 'saradomin' ? 'zamorak' : 'saradomin'] ? team : null;
  const order = (a, b) => planRosterOrder(counts, { saradomin: { count: a }, zamorak: { count: b } }, choose);
  assert.deepEqual(order(2, 2), ['zamorak', 'saradomin', 'zamorak', 'saradomin']);
  assert.equal(order(1, 0), null);
  assert.deepEqual(counts, { saradomin: 1, zamorak: 0 });
});

test('Castle Wars mix uses the native factory and starts custom routines only when the match starts', () => {
  const calls = [];
  const events = {};
  const world = { getAddPlayerQueue: () => [], getRemovePlayerQueue: () => [] };
  const api = { getWorld: () => world, onCustomEvent: (name, fn) => { events[name] = fn; } };
  const human = { isPlayerBot: () => false };
  const startRoom = { x: 1, y: 2, z: 3 };
  const game = {
    data: { TEAM: { SARADOMIN: 'saradomin', ZAMORAK: 'zamorak' }, LOBBY_TELEPORT: {} },
    waitingAreas: { saradomin: { getPlayers: () => [human] }, zamorak: { getPlayers: () => [] } },
    PHASE: { IDLE: 'idle', STARTING: 'starting' }, getPhase: () => 'idle', BOT_KEY: 'bot',
    queueCounts: () => ({ saradomin: 1, zamorak: 0 }), getTeamId: player => player.team,
    getTeamData: () => ({ startRoom }),
  };
  const make = name => ({ getUsername: () => name, setAttribute: (key, value) => calls.push([name, key, value]) });
  const original = make('Original'), custom = make('Custom');
  attachRoster(api, game, {
    chooseTeam: (counts, side) => counts[side] <= counts[side === 'saradomin' ? 'zamorak' : 'saradomin'] ? side : null,
    createBuiltin: () => original,
    loadoutRefusal: () => null,
    admit: (bot, team) => { bot.team = team; calls.push([bot.getUsername(), 'admit', team]); },
  });
  const request = {
    teams: { saradomin: { routine: 'custom_example', count: 1 }, zamorak: { routine: 'mixed', count: 1 } },
    prepare: () => ({ ok: true, spawn: () => ({ bot: custom, start: home => (calls.push(['start', home]), true) }), track: bot => calls.push(['track', bot.getUsername()]) }),
  };
  events['bots:deploy-castle-wars-roster'](request);
  assert.deepEqual(request.result, { ok: true, spawned: { saradomin: ['Custom'], zamorak: ['Original'] } });
  assert.deepEqual(calls, [['track', 'Original'], ['Original', 'admit', 'zamorak'], ['Custom', 'bot', true], ['Custom', 'admit', 'saradomin']]);
  assert.equal(game.hasRosterRoutine(original), false);
  assert.equal(game.hasRosterRoutine(custom), true);
  events['castlewars:started-player']({ player: original });
  events['castlewars:started-player']({ player: custom });
  events['castlewars:started-player']({ player: custom });
  assert.deepEqual(calls.slice(4), [['start', startRoom]]);
});

test('Soul Wars requires enough unassigned players to balance a fixed roster', () => {
  assert.equal(canBalance({ blue: 3, red: 1 }, 1), true);
  assert.equal(canBalance({ blue: 3, red: 1 }, 0), false);
  assert.equal(canBalance({ blue: 0, red: 1 }, 0), true);
});

test('native roster bots consume the same deploy budget before and after registration', () => {
  let registered = false;
  const bot = { isRegistered: () => registered };
  const pending = [bot];
  const runtime = { entriesByUsername: new Map([['one', { adminDeployedActivityId: 'custom_foo' }]]) };
  trackNativeDeployment(runtime, bot, { getAddPlayerQueue: () => pending });
  assert.equal(managedBotCount(runtime), 2);
  pending.length = 0;
  registered = true;
  assert.equal(managedBotCount(runtime), 2);
  registered = false;
  assert.equal(managedBotCount(runtime), 1);
});
