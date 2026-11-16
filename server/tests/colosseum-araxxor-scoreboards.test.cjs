// Run after `yarn build`: node --test tests/colosseum-araxxor-scoreboards.test.cjs
//
// The Colosseum scoreboard (50747, interface 867) against rsprox 237/04109, and the Araxxor
// scoreboard (54270, interface 591) against rsprox 237/01075-01076: what each option opens and
// the text the server writes into it, on a real Player.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, beforeEach, after } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

const Shared = require('../plugins/minigames/colosseum/Shared.Colosseum');
const Sol = require('../plugins/minigames/colosseum/SolHeredit.Colosseum');
const Colosseum = require('../plugins/minigames/colosseum/Scoreboard.Colosseum');
const Rewards = require('../plugins/minigames/colosseum/Rewards.Colosseum');
const AraxxorShared = require('../plugins/bosses/araxxor/Shared.Araxxor');
const Araxxor = require('../plugins/bosses/araxxor/Scoreboard.Araxxor');

const ARAXXOR_BOARD = 54270; // araxxor_scoreboard_multi, as the recordings click it
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scoreboards-'));
const hooks = { objects: {}, deaths: [] };

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    onCustomEvent() {}, // the boards' busy reset on close: scoreboard-busy.test.cjs
  };
  Colosseum(api);
  Araxxor.attach(api);
});

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  Colosseum._useFile(path.join(scratch, `colosseum-${Math.random()}.json`));
  Araxxor._useFile(path.join(scratch, `araxxor-${Math.random()}.json`));
});

/** A real Player with only the network stubbed; the packets it would send are recorded. */
function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = { interfaces: [], texts: new Map(), hidden: new Map() };
  const original = { sendInterface: sender.sendInterface, sendString: sender.sendString, sendInterfaceDisplayState: sender.sendInterfaceDisplayState };
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.interfaces.push(id); return original.sendInterface.apply(this, arguments); });
  t.mock.method(sender, 'sendString', function (text, uid) { p.sent.texts.set(uid, text); return original.sendString.apply(this, arguments); });
  t.mock.method(sender, 'sendInterfaceDisplayState', function (uid, hidden) { p.sent.hidden.set(uid, hidden); return original.sendInterfaceDisplayState.apply(this, arguments); });
  return p;
}

/** Fires an option the way ObjectActionPacketListener does: every handler for the name until one claims it. */
function click(player, name, option, objectId) {
  for (const actions of hooks.objects[name] ?? []) {
    if (actions[option]?.({ player, objectId, option: option.toLowerCase(), clickType: 1, handled: false }) === true) return true;
  }
  return false;
}

const text = (p, iface, component) => p.sent.texts.get((iface << 16) | component);
const colosseumText = (p, component) => text(p, 867, component);
const run = (player, extra = {}) => ({ player, totalTicks: 0, glory: 0, ...extra });

test('View-stats: the stats panel with "-" for no best time, as rsprox 237/04109 for a new player', (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, 'Colosseum scoreboard', 'View-stats', 50747), true);
  assert.deepEqual(p.sent.interfaces, [867]);
  assert.equal(p.sent.hidden.get((867 << 16) | 4), true, 'glory panel hidden');
  assert.equal(p.sent.hidden.get((867 << 16) | 5), false, 'stats panel shown');
  assert.equal(colosseumText(p, 7), 'Colosseum Statistics');
  for (const component of [10, 12, 14]) assert.equal(colosseumText(p, component), '0');
  assert.equal(colosseumText(p, 16), '-');
  assert.equal(colosseumText(p, 24), '-');
});

test('waves, Sol Heredit kills, deaths and the best run time fill both the personal and world rows', (t) => {
  const p = realPlayer(t);
  for (let wave = 0; wave < 12; wave++) Colosseum.waveCompleted(run(p));
  p.setAttribute(Sol.ATTR.KILLS, 1); // SolHeredit.Colosseum.js counts his kill before the scoreboard hears
  Colosseum.solDefeated(run(p, { totalTicks: 1392 }));
  Colosseum.solDefeated(run(p, { totalTicks: 1500 })); // a slower run keeps the best
  Colosseum.died(run(p));
  click(p, 'Colosseum scoreboard', 'View', 50747);
  assert.equal(colosseumText(p, 10), '12');
  assert.equal(colosseumText(p, 12), '1');
  assert.equal(colosseumText(p, 14), '1');
  assert.equal(colosseumText(p, 16), '13:55.20', '1,392 ticks, the recording\'s format');
  assert.equal(colosseumText(p, 18), '12');
  assert.equal(colosseumText(p, 20), '2');
  assert.equal(colosseumText(p, 22), '1');
  assert.equal(colosseumText(p, 24), '13:55.20');
});

test('the world records are saved and read back after a restart', (t) => {
  const file = path.join(scratch, 'restart.json');
  Colosseum._useFile(file);
  const p = realPlayer(t);
  Colosseum.waveCompleted(run(p));
  Colosseum.died(run(p));
  Colosseum._useFile(file);
  const q = realPlayer(t);
  click(q, 'Colosseum scoreboard', 'View-stats', 50747);
  assert.equal(colosseumText(q, 18), '1');
  assert.equal(colosseumText(q, 22), '1');
  assert.equal(colosseumText(q, 10), '0', 'personal counts are the player\'s own');
});

test('View-glory: Rookie, every perk greyed, the world best, as rsprox 237/04109', (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, 'Colosseum scoreboard', 'View-glory', 50747), true);
  assert.equal(p.sent.hidden.get((867 << 16) | 4), false);
  assert.equal(p.sent.hidden.get((867 << 16) | 5), true);
  assert.equal(colosseumText(p, 36), 'Rookie');
  assert.equal(colosseumText(p, 38), '0');
  assert.equal(colosseumText(p, 44), '0');
  assert.equal(colosseumText(p, 40), '<col=999999>- Bank access at the Colosseum.<br></col><col=999999>- Fortis respawn point.<br></col><col=999999>- Improved price for stolen goods.<br></col><col=999999>- Colosseum Ring of Dueling teleport.</col>');
  assert.equal(colosseumText(p, 41), '<col=999999>- Fortis herb patch protection.<br></col><col=999999>- Fortis Salute emote.</col>');
});

test('Glory kept through Rewards raises the title, unlocks perks up to exactly the threshold and the world best', (t) => {
  const p = realPlayer(t);
  Rewards.keepGlory(run(p, { glory: 5000 })); // exactly Challenger
  const other = realPlayer(t);
  Rewards.keepGlory(run(other, { glory: 3000 })); // a lower run never lowers the world best
  click(p, 'Colosseum scoreboard', 'View-glory', 50747);
  assert.equal(Shared.gloryOf(p), 5000);
  assert.equal(colosseumText(p, 36), 'Challenger');
  assert.equal(colosseumText(p, 38), '5,000');
  assert.equal(colosseumText(p, 44), '5,000');
  assert.equal(colosseumText(p, 40), '- Bank access at the Colosseum.<br>- Fortis respawn point.<br><col=999999>- Improved price for stolen goods.<br></col><col=999999>- Colosseum Ring of Dueling teleport.</col>');
});

test('clicking twice sends the same board twice, with nothing counted', (t) => {
  const p = realPlayer(t);
  click(p, 'Colosseum scoreboard', 'View-stats', 50747);
  click(p, 'Colosseum scoreboard', 'View-stats', 50747);
  assert.deepEqual(p.sent.interfaces, [867, 867]);
  assert.equal(colosseumText(p, 18), '0');
});

// ------------------------------------------------------------------ Araxxor

const araxxorText = (p, component) => text(p, 591, component);

test('Araxxor Read: the statistics from rsprox 237/01076 (3 kills, no deaths, 2:12.60)', (t) => {
  const p = realPlayer(t);
  p.setAttribute(AraxxorShared.ATTR_KILLS, 3);
  p.setAttribute(AraxxorShared.ATTR_BEST_TICKS, 221);
  Araxxor.won(221);
  Araxxor.won(300);
  assert.equal(click(p, 'Scoreboard', 'Read', ARAXXOR_BOARD), true);
  assert.deepEqual(p.sent.interfaces, [591]);
  assert.equal(araxxorText(p, 6), 'Araxxor Statistics');
  assert.equal(araxxorText(p, 9), '3');
  assert.equal(araxxorText(p, 11), '0');
  assert.equal(araxxorText(p, 13), '2:12.60');
  assert.equal(araxxorText(p, 15), '2');
  assert.equal(araxxorText(p, 17), '0');
  assert.equal(araxxorText(p, 19), '2:12.60');
});

test('a death counts only inside the lair', (t) => {
  const p = realPlayer(t);
  p.setLocation(new Location(3630, 9815, 0));
  for (const handler of hooks.deaths) handler({ player: p, killer: null, handled: false });
  p.setLocation(new Location(3658, 9814, 0)); // by the scoreboard, outside
  for (const handler of hooks.deaths) handler({ player: p, killer: null, handled: false });
  click(p, 'Scoreboard', 'Read', ARAXXOR_BOARD);
  assert.equal(araxxorText(p, 11), '1');
  assert.equal(araxxorText(p, 17), '1');
  assert.equal(araxxorText(p, 13), '-', 'no kill, no best time');
});

test("another boss's Scoreboard is left to its own handler", (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, 'Scoreboard', 'Read', 12345), false);
  assert.deepEqual(p.sent.interfaces, []);
});

test('a click on the Araxxor scoreboard finds its shape-10 copy, not the straight wall decoration under it', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  RegionManager.init();
  const board = MapObjects.get(ARAXXOR_BOARD, new Location(3658, 9813, 0), null);
  assert.ok(board, 'the cache places it here twice (shapes 10 and 4)');
  assert.equal(board.getType(), 10);
});
