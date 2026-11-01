// Run after `yarn build`: node --test tests/clans-chest-restart.test.cjs
// A party chest offer through real plugins, Player, Inventory and PlayerSave: a graceful shutdown
// saves players without their logout hooks, and only the save can hold what was offered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Core = require('../plugins/interface/clans/Core.Clans');
const Contents = require('../plugins/interface/clans/Contents.Clans');
const Hall = require('../plugins/interface/clans/Hall.Clans');

const CHEST = 46248;
const OFFER_ATTRIBUTE = 'clans:chest-offer';
const OP_ALL = 5;
const COINS = 995;

let core;
let PlayerSave;
let dir;
let next = 1800;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clans-restart-'));
  process.env.TSPS_CLANS_FILE = path.join(dir, 'clans.json');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  ({ PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave'));
});

after(() => {
  PM.emitServerShutdown({});
  delete process.env.TSPS_CLANS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

function newPlayer(name) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(name);
  player.setRegistered(true);
  player.setLocation(new core.Location(1759, 5486, 0));
  player.needsPlacement = false;
  return player;
}

function offering(name, coins) {
  const player = newPlayer(name);
  player.getInventory().adds(COINS, coins);
  Core.createClan(`${name} clan`, [player]);
  Hall.enterOwn({ player });
  assert.equal(Contents.openChest({ player, objectId: CHEST }), true);
  Contents.clickChest({ player, groupId: 266, childId: 0, slot: player.getInventory().getSlotForItemId(COINS), action: OP_ALL });
  assert.equal(player.getInventory().getAmount(COINS), 0, 'offered, so out of the inventory');
  return player;
}

test('a save taken with an offer open keeps it, and the next login gives it back once', () => {
  const player = offering('restart', 100);
  const saved = PlayerSave.fromPlayer(player);
  assert.deepEqual(saved.attributes[OFFER_ATTRIBUTE], [{ id: COINS, amount: 100 }]);

  const restarted = newPlayer('restart');
  saved.applyToPlayer(restarted);
  assert.equal(restarted.getInventory().getAmount(COINS), 0);
  Contents.restoreOffer(restarted);
  assert.equal(restarted.getInventory().getAmount(COINS), 100);
  assert.equal(PlayerSave.fromPlayer(restarted).attributes[OFFER_ATTRIBUTE], undefined, 'the default, so not saved');

  Contents.restoreOffer(restarted);
  assert.equal(restarted.getInventory().getAmount(COINS), 100, 'a later login adds nothing');
  Contents.playerGone(player);
});

test('nothing is saved twice: a closed offer and a confirmed one leave no escrow behind', () => {
  const closed = offering('closer', 100);
  Contents.playerGone(closed);
  assert.equal(closed.getInventory().getAmount(COINS), 100);
  assert.equal(PlayerSave.fromPlayer(closed).attributes[OFFER_ATTRIBUTE], undefined);

  const confirmed = offering('confirmer', 100);
  Contents.clickChest({ player: confirmed, groupId: 783, childId: 17 });
  assert.equal(confirmed.getInventory().getAmount(COINS), 0);
  assert.equal(PlayerSave.fromPlayer(confirmed).attributes[OFFER_ATTRIBUTE], undefined);
  Contents.playerGone(confirmed);
});

test('part of an offer taken back leaves only the rest in the save', () => {
  const player = offering('taker', 100);
  Contents.clickChest({ player, groupId: 783, childId: 16, slot: 0, action: 2 });
  assert.equal(player.getInventory().getAmount(COINS), 1);
  assert.deepEqual(PlayerSave.fromPlayer(player).attributes[OFFER_ATTRIBUTE], [{ id: COINS, amount: 99 }]);
  Contents.playerGone(player);
  assert.equal(player.getInventory().getAmount(COINS), 100);
});
