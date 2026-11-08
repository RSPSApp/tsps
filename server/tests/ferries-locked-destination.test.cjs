// Run after `yarn build`: node --test tests/ferries-locked-destination.test.cjs
// #1352 review: paid transports took the fare before asking whether the passenger may go where they land, so a
// league area still locked (Enforcement.LeagueAreaUnlocks: its onCanTeleport hook, "You haven't unlocked that area
// yet.") kept the coins and sent them back on landing. The ferries now ask TeleportHandler.checkReqs on the route's
// landing before the fare and before departing, as BarnabyFerry and the charter ships do. Stand-in: a hook refusing
// one landing tile with the league's line.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Routes = require('../plugins/world/ferries/Routes.Ferries');
const Common = require('../plugins/world/ferries/Common.Ferries');
let core, refused = null, next = 9930;
const bots = process.env.DISABLE_PLAYER_BOTS;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  PM.createApi('FerryLockedStandIn').onCanTeleport((event) => {
    const to = refused && Common.route(refused);
    if (!to || event.destination?.getX?.() !== to.to[0] || event.destination?.getY?.() !== to.to[1]) return;
    event.player.sendMessage("You haven't unlocked that area yet.");
    event.allow = false;
  });
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function passenger(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('ferry' + next); p.setRegistered(true); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(2620, 3686, 0)); p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); refused = null; });
  p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 5000), true);
  return { p, messages };
}
// ferries.json steps: uqNLqh is Jarvald's trip to Waterbirth Island for 1,000 coins.
const STEP = 'uqNLqh';

test('a paid ferry to a landing the passenger may not go to keeps the fare and does not sail', (t) => {
  const f = passenger(t);
  refused = 'waterbirth';
  const event = { player: f.p, stepId: STEP, handled: false };
  Routes.transcriptStep(event);
  assert.equal(event.handled, true);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 5000, 'no fare taken');
  assert.equal(Common.travelling(f.p), false, 'no trip started');
  assert.ok(f.messages.includes("You haven't unlocked that area yet."), f.messages.join(' | '));
});

test('control: an open landing takes the fare and sails', (t) => {
  const f = passenger(t);
  Routes.transcriptStep({ player: f.p, stepId: STEP, handled: false });
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 4000);
  assert.equal(Common.travelling(f.p), true);
});
