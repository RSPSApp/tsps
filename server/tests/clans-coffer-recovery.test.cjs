// Run after `yarn build`: node --test tests/clans-coffer-recovery.test.cjs
// The coffer and a player's coins live in two stores that commit separately. Each case stops at a
// point a crash could: real plugins, Player, Inventory and PlayerSave, with clans.json reloaded from
// disk. A snapshot taken earlier stands for the last player save to reach the database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');
const savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clans-saves-'));
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(savesDir, 'players.sqlite');
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Core = require('../plugins/interface/clans/Core.Clans');
const Hall = require('../plugins/interface/clans/Hall.Clans');
const Store = require('../plugins/interface/clans/Store.Clans');

const { DatabaseSync } = require('node:sqlite');

const COINS = 995;
const COFFER_SIDE = 697;
const COFFER = 696;
const DEPOSIT_ALL = 10;
const WITHDRAW_ALL = 12;

let core;
let PlayerSave;
let dir;
let next = 1900;
let serial = 0;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clans-coffer-'));
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
  // The backend keeps its database open until exit, and Windows won't delete it before then.
  process.once('exit', () => {
    try {
      fs.rmSync(savesDir, { recursive: true, force: true });
    } catch {
      // Left in the temp directory.
    }
  });
});

function newPlayer(name) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(name);
  player.setRegistered(true);
  player.setLocation(new core.Location(1749, 5470, 0));
  player.needsPlacement = false;
  return player;
}

/** An owner in their hall with the coffer open, holding these coins. */
function atCoffer(coins) {
  serial += 1;
  const name = `cofferer${serial}`;
  const player = newPlayer(name);
  if (coins) player.getInventory().adds(COINS, coins);
  Core.createClan(`Coffer ${serial}`, [player]);
  Hall.enterOwn({ player });
  Hall.useCoffer({ player });
  return { player, name, clanName: `Coffer ${serial}` };
}

const click = (player, groupId, childId) => Hall.clickCoffer({ player, groupId, childId });

/** What's durable right now, as a crash would leave it. */
function crash(playerSave, name, clanName) {
  Store.reset();
  const restarted = newPlayer(name);
  playerSave.applyToPlayer(restarted);
  Hall.recoverCoffer(restarted);
  return { restarted, clan: Store.byName(clanName) };
}

const coinsOf = (player) => player.getInventory().getAmount(COINS);
const onDisk = (clanName) => JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8')).clans.find((clan) => clan.name === clanName);
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** What the row in SQLite holds, ignoring anything still waiting for the writer. */
function freshBackend() {
  const { SqlitePlayerPersistence } = require('../plugins/persistence/SqlitePlayerPersistence.plugin');
  return new SqlitePlayerPersistence();
}

/** Holds SQLite's write lock, so the writer can't commit until release. */
function holdWrites() {
  const lock = new DatabaseSync(process.env.PLAYER_SAVE_DATABASE_PATH);
  lock.exec('BEGIN IMMEDIATE');
  return () => {
    lock.exec('ROLLBACK');
    lock.close();
  };
}

test('a deposit lost from the player save comes back out of the coffer, so nothing is duplicated', () => {
  const { player, name, clanName } = atCoffer(1000000);
  const lastSave = PlayerSave.fromPlayer(player);
  click(player, COFFER_SIDE, DEPOSIT_ALL);
  assert.equal(coinsOf(player), 0);
  const { restarted, clan } = crash(lastSave, name, clanName);
  assert.equal(coinsOf(restarted), 1000000);
  assert.equal(clan.coffer, 0);
  assert.deepEqual(clan.cofferJournal, []);
});

test('a deposit the player save has stays deposited, so nothing is destroyed', async () => {
  const { player, name, clanName } = atCoffer(1000000);
  click(player, COFFER_SIDE, DEPOSIT_ALL);
  const { restarted, clan } = crash(PlayerSave.fromPlayer(player), name, clanName);
  assert.equal(coinsOf(restarted), 0);
  assert.equal(clan.coffer, 1000000);
  await core.GameConstants.PLAYER_PERSISTENCE.flush();
  await settled();
  assert.deepEqual(clan.cofferJournal, [], 'settled');
});

test('a logout save still waiting for SQLite keeps its entry, so a crash then still reconciles', async () => {
  const backend = core.GameConstants.PLAYER_PERSISTENCE;
  const { player, name, clanName } = atCoffer(1000000);
  backend.save(player, 'start');
  await backend.flush();
  const release = holdWrites();
  try {
    click(player, COFFER_SIDE, DEPOSIT_ALL);
    await settled();
    backend.save(player, 'logout');
    const relogged = newPlayer(name);
    backend.load(name).applyToPlayer(relogged);
    assert.equal(coinsOf(relogged), 0, 'the load sees the unwritten save');
    Hall.recoverCoffer(relogged);
    await settled();
    assert.equal(onDisk(clanName).cofferJournal.length, 1, 'so the entry stays');
    assert.equal(onDisk(clanName).coffer, 1000000);

    // The crash: only the row and the clan file are left.
    const durable = freshBackend();
    Store.reset();
    const restarted = newPlayer(name);
    durable.load(name).applyToPlayer(restarted);
    assert.equal(coinsOf(restarted), 1000000, 'the row never got the deposit');
    Hall.recoverCoffer(restarted);
    assert.equal(coinsOf(restarted), 1000000);
    assert.equal(onDisk(clanName).coffer, 0, 'one million in total, not two');
    assert.deepEqual(onDisk(clanName).cofferJournal, []);
    durable.database.close();
  } finally {
    release();
  }
  await backend.flush();
});

test('once the writer commits the save, the entry goes', async () => {
  const backend = core.GameConstants.PLAYER_PERSISTENCE;
  const { player, name, clanName } = atCoffer(1000000);
  backend.save(player, 'start');
  await backend.flush();
  const release = holdWrites();
  click(player, COFFER_SIDE, DEPOSIT_ALL);
  await settled();
  backend.save(player, 'logout');
  const relogged = newPlayer(name);
  backend.load(name).applyToPlayer(relogged);
  Hall.recoverCoffer(relogged);
  await settled();
  assert.equal(onDisk(clanName).cofferJournal.length, 1);
  release();
  await backend.flush();
  await settled();
  assert.deepEqual(onDisk(clanName).cofferJournal, []);
  assert.equal(onDisk(clanName).coffer, 1000000);
});

test('another character of the same name leaves the entry alone', async () => {
  const backend = core.GameConstants.PLAYER_PERSISTENCE;
  const { player, name, clanName } = atCoffer(1000000);
  click(player, COFFER_SIDE, DEPOSIT_ALL);
  backend.save(player, 'logout');
  await backend.flush();
  await settled();

  const league = newPlayer(name);
  league.setProfile('league');
  Hall.recoverCoffer(league);
  await backend.flush();
  await settled();
  assert.equal(onDisk(clanName).coffer, 1000000, 'the main character\'s deposit stands');
  assert.equal(onDisk(clanName).cofferJournal.length, 1);
  assert.equal(onDisk(clanName).cofferJournal[0].profile, 'main');

  const main = newPlayer(name);
  backend.load(name).applyToPlayer(main);
  Hall.recoverCoffer(main);
  await backend.flush();
  await settled();
  assert.equal(onDisk(clanName).coffer, 1000000);
  assert.deepEqual(onDisk(clanName).cofferJournal, [], 'its own login settles it');
});

test('a league character\'s lost transfer undoes only that character\'s', async () => {
  const backend = core.GameConstants.PLAYER_PERSISTENCE;
  const { player: league, name, clanName } = atCoffer(1000);
  league.setProfile('league');
  const lastSave = PlayerSave.fromPlayer(league);
  click(league, COFFER_SIDE, DEPOSIT_ALL);
  await settled();
  const main = newPlayer(name);
  Hall.recoverCoffer(main);
  assert.equal(onDisk(clanName).coffer, 1000, 'the main character\'s login changes nothing');
  Store.reset();
  const restarted = newPlayer(name);
  restarted.setProfile('league');
  lastSave.applyToPlayer(restarted);
  Hall.recoverCoffer(restarted);
  assert.equal(coinsOf(restarted), 1000);
  assert.equal(onDisk(clanName).coffer, 0);
  await backend.flush();
});

test('a withdrawal lost from the player save goes back into the coffer, and one saved stays out', () => {
  const lost = atCoffer(0);
  Store.byName(lost.clanName).coffer = 1000;
  Store.save();
  const lastSave = PlayerSave.fromPlayer(lost.player);
  click(lost.player, COFFER, WITHDRAW_ALL);
  assert.equal(coinsOf(lost.player), 1000);
  const undone = crash(lastSave, lost.name, lost.clanName);
  assert.equal(coinsOf(undone.restarted), 0);
  assert.equal(undone.clan.coffer, 1000);

  const kept = atCoffer(0);
  Store.byName(kept.clanName).coffer = 1000;
  Store.save();
  click(kept.player, COFFER, WITHDRAW_ALL);
  const stayed = crash(PlayerSave.fromPlayer(kept.player), kept.name, kept.clanName);
  assert.equal(coinsOf(stayed.restarted), 1000);
  assert.equal(stayed.clan.coffer, 0);
});

test('only what came after the last save is undone, and numbers can be used again', () => {
  const { player, name, clanName } = atCoffer(3000000);
  const deposit = () => click(player, COFFER_SIDE, 7); // 1,000,000
  deposit();
  const lastSave = PlayerSave.fromPlayer(player);
  deposit();
  deposit();
  const { restarted, clan } = crash(lastSave, name, clanName);
  assert.equal(coinsOf(restarted), 2000000);
  assert.equal(clan.coffer, 1000000);
  Hall.enterOwn({ player: restarted });
  Hall.useCoffer({ player: restarted });
  click(restarted, COFFER_SIDE, 7);
  assert.equal(clan.coffer, 2000000);
  const again = crash(PlayerSave.fromPlayer(restarted), name, clanName);
  assert.equal(coinsOf(again.restarted), 1000000);
  assert.equal(again.clan.coffer, 2000000);
});

test('a deposit others have already spent is made up from the depositor', () => {
  const { player, name, clanName } = atCoffer(1000000);
  const lastSave = PlayerSave.fromPlayer(player);
  click(player, COFFER_SIDE, DEPOSIT_ALL);
  const clan = Store.byName(clanName);
  clan.coffer = 400000; // another member took 600,000, which their own save has
  Store.save();
  const { restarted, clan: reloaded } = crash(lastSave, name, clanName);
  assert.equal(reloaded.coffer, 0);
  assert.equal(coinsOf(restarted), 400000, '1,000,000 in total was only ever deposited once');
});

test('a clans file that can\'t be written moves nothing', () => {
  const { player, clanName } = atCoffer(1000);
  const clan = Store.byName(clanName);
  const blocked = process.env.TSPS_CLANS_FILE;
  process.env.TSPS_CLANS_FILE = path.join(blocked, 'not-a-directory', 'clans.json');
  try {
    click(player, COFFER_SIDE, DEPOSIT_ALL);
  } finally {
    process.env.TSPS_CLANS_FILE = blocked;
  }
  assert.equal(coinsOf(player), 1000);
  assert.equal(clan.coffer ?? 0, 0);
  assert.deepEqual(clan.cofferJournal ?? [], []);
  assert.equal(player.getAttribute('clans:coffer-sequence') ?? 0, 0, 'and the number stays');
});
