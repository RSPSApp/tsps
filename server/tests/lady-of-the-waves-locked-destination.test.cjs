// Run after `yarn build`: node --test tests/lady-of-the-waves-locked-destination.test.cjs
// #3809 left the Lady of the Waves taking the ticket before asking whether the passenger may land: from Karamja she
// sails to Port Khazard (Kandarin) and Port Sarim (Asgarnia), so a league area still locked (Enforcement.LeagueAreaUnlocks:
// its onCanTeleport hook, "You haven't unlocked that area yet.") cost the ticket and sent them back. Stand-in: a hook
// refusing Port Sarim's landing with the league's line, as tests/ferries-locked-destination.test.cjs does.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Lady = require('../plugins/world/LadyOfTheWaves.plugin');
let core, refuse = false, next = 9960;
const bots = process.env.DISABLE_PLAYER_BOTS;
const SARIM = 'The ship arrives in busy Port Sarim.';
const [SARIM_X, SARIM_Y] = Lady._test.DESTINATIONS.get(SARIM).to;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  const standIn = PM.createApi('LadyLockedStandIn');
  standIn.onCustomEvent('quest:is-complete', (request) => { if (request.key === 'shilo_village') request.complete = true; });
  standIn.onCanTeleport((event) => {
    if (!refuse || event.destination?.getX?.() !== SARIM_X || event.destination?.getY?.() !== SARIM_Y) return;
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
  p.setIndex(next++); p.setUsername('lady' + next); p.setRegistered(true); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(2795, 2958, 0)); p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); refuse = false; });
  p.getInventory().add(new core.Item(Lady._test.SHIP_TICKET, 1), true);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.KARAMJAN_RUM, 1), true);
  return { p, messages };
}
const shanks = { getName: () => 'Captain Shanks' };

test('a locked port keeps the ticket and the rum, and the ship does not sail', (t) => {
  const f = passenger(t);
  refuse = true;
  Lady._test.sail({ player: f.p, definition: shanks, kind: 'message', text: SARIM });
  assert.equal(f.p.getInventory().getAmount(Lady._test.SHIP_TICKET), 1, 'ticket kept');
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.KARAMJAN_RUM), 1, 'rum kept');
  assert.equal(f.p.getLocation().getX(), 2795, 'still on Karamja');
  assert.ok(f.messages.includes("You haven't unlocked that area yet."), f.messages.join(' | '));
});

test('control: an open port takes the ticket and sails', (t) => {
  const f = passenger(t);
  Lady._test.sail({ player: f.p, definition: shanks, kind: 'message', text: SARIM });
  assert.equal(f.p.getInventory().getAmount(Lady._test.SHIP_TICKET), 0);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.KARAMJAN_RUM), 0, 'the dice game takes the rum');
  assert.equal(f.p.getLocation().getX(), SARIM_X);
});
