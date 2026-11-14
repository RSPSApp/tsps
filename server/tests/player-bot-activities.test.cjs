// Run after `yarn build`: node --test tests/player-bot-activities.test.cjs
// world.json pluginConfig "PlayerBots:allowedActivities": unset, every bot spawns as before; a
// list lets only the bots of those activities spawn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { botActivityAllowed, createBotPlayer } = require('../plugins/bots/behaviours/spawn/PlayerFactory.PlayerBots');
const { startBotSites } = require('../plugins/bots/brain/SiteSpawner.PlayerBots');

function allowed(t, value) {
  const original = PluginManager.getPluginConfig.bind(PluginManager);
  t.mock.method(PluginManager, 'getPluginConfig',
    (key, fallback) => (key === 'PlayerBots:allowedActivities' ? value : original(key, fallback)));
}

/** Options whose api fails the test if the factory gets past the activity check. */
const refusedOptions = (activity) => ({
  activity,
  api: new Proxy({}, { get() { assert.fail('a refused bot must not touch the world or a save'); } }),
});

test('unset, every activity may spawn, a spawn naming none included', () => {
  for (const activity of [undefined, 'world', 'ai', 'bounty-hunter', 'castle-wars', 'developer']) {
    assert.equal(botActivityAllowed(activity), true, String(activity));
  }
});

test('a list lets only its activities spawn, and refuses a spawn that names none', (t) => {
  allowed(t, ['bounty-hunter', 'last-man-standing']);
  assert.equal(botActivityAllowed('bounty-hunter'), true);
  assert.equal(botActivityAllowed('last-man-standing'), true);
  for (const activity of [undefined, 'world', 'ai', 'castle-wars', 'soul-wars', 'pest-control', 'developer']) {
    assert.equal(botActivityAllowed(activity), false, String(activity));
    assert.equal(createBotPlayer('Refused', null, refusedOptions(activity)), null);
  }
});

test('an empty list refuses every bot; a value that is not a list is ignored', (t) => {
  allowed(t, []);
  assert.equal(botActivityAllowed('bounty-hunter'), false);
  t.mock.restoreAll();
  allowed(t, 'bounty-hunter');
  t.mock.method(console, 'warn', () => {});
  assert.equal(botActivityAllowed('world'), true);
});

test('without "world" in the list the bot sites are not started', (t) => {
  allowed(t, ['bounty-hunter']);
  assert.equal(startBotSites({ get runtime() { assert.fail('the sites must not be set up'); } }), null);
});

test('every bot spawn names one of the documented activities', () => {
  const plugins = path.join(__dirname, '..', 'plugins');
  const declared = require('../plugins/bots/PlayerBots.plugin').config['PlayerBots:allowedActivities'].help;
  const files = [
    'bots/runtime/Registry.PlayerBots.js', 'bots/brain/SiteSpawner.PlayerBots.js', 'bots/ai/RegisterAiBots.PlayerBots.js',
    'bots/runtime/RegisterBotCommands.PlayerBots.js', 'bots/runtime/Benchmark.PlayerBots.js', 'bots/StressTestBots.plugin.js',
    'minigames/bountyhunter/Bots.BountyHunter.js', 'minigames/lms/Bots.LastManStanding.js', 'minigames/castlewars/Lobby.CastleWars.js',
    'minigames/soulwars/Bots.SoulWars.js', 'minigames/PestControl.plugin.js',
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(plugins, file), 'utf8');
    const named = [...text.matchAll(/activity: (?:plan\.activity \?\? )?"([a-z-]+)"/g)].map((m) => m[1]);
    assert.ok(named.length > 0, `${file} names an activity`);
    for (const activity of named) assert.ok(declared.includes(activity), `${file}: ${activity} is documented`);
  }
});
