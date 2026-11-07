// Run after `yarn build`: node --test tests/character-slots-login.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { test, before, beforeEach } = require('node:test');

// Accounts writes its file to this path; keep it off the real data/saves, before `dist` is required.
process.env.TSPS_ACCOUNTS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-')), 'accounts.json');
process.env.TSPS_DISPLAY_NAMES_FILE = path.join(path.dirname(process.env.TSPS_ACCOUNTS_FILE), 'display-names.json');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { GameConstants } = require('../dist/game/GameConstants');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PasswordUtil } = require('../dist/util/PasswordUtil');
const { PlayerPunishment } = require('../dist/util/PlayerPunishment');
const { World } = require('../dist/game/World');
const { Sailing } = require('../dist/game/content/sailing/Sailing');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Accounts } = require('../dist/game/entity/impl/player/Accounts');
const { DisplayNames } = require('../dist/game/entity/impl/player/DisplayNames');
const { SkillManager, Skills } = require('../dist/game/content/skill/SkillManager');
const { MAIN_PROFILE, LEAGUE_PROFILE, profileStorageKey } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const net = require('../dist/net/NetworkBuilder');
const { LOGIN_FLAG_CHARACTER_SELECT } = require('../dist/net/login/LoginTokens');
const { defaultCharacterIndex, maxCharactersPerAccount } = require('../dist/net/login/CharacterSlots');

const LOGIN_RESPONSE = 3;
const CHARACTER_LIST = 7;
const CHARACTER_RESULT = 8;
let REVISION;
let PW_HASH;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  REVISION = CachePipeline.getActive().revision;
  PW_HASH = await PasswordUtil.generatePasswordHashWithSalt('pw');
});

/** Saves by profileStorageKey(name, profile), read and written by the login path. */
const saves = new Map();
const saveKey = (name, profile = MAIN_PROFILE) => profileStorageKey(Accounts.key(name), profile);
/** The stored hash of 'pw', the only password the seeded accounts use. */
const hashOf = (password) => {
  assert.equal(password, 'pw');
  return PW_HASH;
};

function seedSave(name, { passwordHash = '', maxLevel, profile = MAIN_PROFILE } = {}) {
  const skills = new Skills();
  if (maxLevel) skills.maxLevel = maxLevel;
  const save = {
    attributes: {},
    getPasswordHashWithSalt: () => passwordHash,
    getDisplayName: () => name,
    getSkills: () => skills,
    applyToPlayer() {},
  };
  saves.set(saveKey(name, profile), save);
  return save;
}

const persistence = {
  load: (name, profile = MAIN_PROFILE) => saves.get(saveKey(name, profile)) ?? null,
  exists: (name, profile = MAIN_PROFILE) => saves.has(saveKey(name, profile)),
  delete: async (name, profile = MAIN_PROFILE) => { persistence.deleted.push([Accounts.key(name), profile]); if (persistence.failDelete) throw persistence.failDelete; saves.delete(saveKey(name, profile)); },
  deleted: [],
  failDelete: null,
  save: () => {},
  saveOffline: () => {},
  updateOffline: async (name, update, _reason, profile = MAIN_PROFILE) => {
    const save = saves.get(saveKey(name, profile));
    if (!save) return false;
    update(save);
    return true;
  },
  flush: async () => {},
  checkPassword: (password, save) => PasswordUtil.passwordsMatch(password, save.getPasswordHashWithSalt()),
  encryptPassword: (password) => PasswordUtil.generatePasswordHashWithSalt(password),
};

beforeEach((t) => {
  t.mock.method(PluginManager, 'getPluginConfig', (key, fallback) => key === 'characters:maxPerAccount' ? 3 : fallback);
  saves.clear();
  persistence.deleted.length = 0;
  persistence.failDelete = null;
  Accounts.reset();
  fs.rmSync(process.env.TSPS_ACCOUNTS_FILE, { force: true });
  DisplayNames.reset();
  fs.rmSync(process.env.TSPS_DISPLAY_NAMES_FILE, { force: true });
  net.ClientConnection.pendingNames.clear();
  GameConstants.PLAYER_PERSISTENCE = persistence;
});

function stubChannel() {
  const sent = [];
  return {
    sent,
    kind: 'test',
    remoteAddress: '127.0.0.1',
    isOpen: () => true,
    send(packet) { sent.push(Buffer.from(packet)); return true; },
    close() {},
    onData() {},
    onError() {},
    onClose() {},
  };
}

function readString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  return [buffer.toString('latin1', offset, end), end + 1];
}

/** Bodies of the packets with this opcode (variable-short packets carry a two-byte size). */
function packetsOf(channel, opcode) {
  return channel.sent.filter((bytes) => bytes[0] === opcode)
    .map((bytes) => bytes.subarray(opcode === CHARACTER_LIST ? 3 : 2));
}

function decodeResponse(body) {
  let offset = 5;
  let error, displayName, token;
  [error, offset] = readString(body, offset);
  [displayName, offset] = readString(body, offset);
  [token, offset] = readString(body, offset);
  return { success: body[0] === 1, code: body.readInt32BE(1), error, displayName, token };
}

function decodeList(body) {
  const list = { max: body[0], defaultIndex: body[1], entries: [] };
  let offset = 3;
  for (let i = 0; i < body[2]; i++) {
    let name;
    [name, offset] = readString(body, offset);
    const flags = body[offset + 11];
    list.entries.push({
      name,
      combatLevel: body[offset],
      totalLevel: body.readUInt16BE(offset + 1),
      lastPlayedAt: Number(body.readBigInt64BE(offset + 3)),
      primary: (flags & 1) !== 0,
      hasSave: (flags & 2) !== 0,
    });
    offset += 12;
  }
  return list;
}

function decodeResult(body) {
  return { ok: body[0] === 1, code: body[1], message: readString(body, 2)[0] };
}

/** Logs in on a fresh connection, keeping the login pending. */
async function connect(username, password, flags = 0) {
  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  connection.inject([{ type: 'login', username, password, revision: REVISION, flags }]);
  await connection.idle();
  const [response] = packetsOf(channel, LOGIN_RESPONSE);
  assert.ok(response, 'a login response was sent');
  return { channel, connection, response: decodeResponse(response) };
}

async function login(username, password, flags = 0) {
  const { response } = await connect(username, password, flags);
  net.ClientConnection.pendingNames.clear();
  return response;
}

async function loginWithList(username, password) {
  const result = await connect(username, password, LOGIN_FLAG_CHARACTER_SELECT);
  const lists = packetsOf(result.channel, CHARACTER_LIST);
  assert.equal(lists.length, 1, 'one list follows the response');
  assert.ok(result.channel.sent.findIndex((b) => b[0] === LOGIN_RESPONSE) < result.channel.sent.findIndex((b) => b[0] === CHARACTER_LIST));
  return { ...result, list: decodeList(lists[0]) };
}

async function select(connection, name) {
  connection.inject([{ type: 'character_select', name }]);
  await connection.idle();
}

function lastResult(channel) {
  const results = packetsOf(channel, CHARACTER_RESULT);
  assert.ok(results.length > 0, 'a character result was sent');
  return decodeResult(results.at(-1));
}

/** Enters the world without a world: the player list, regions, sailing and plugins are stubbed. */
async function handshake(t, connection, name) {
  const logins = [];
  t.mock.method(World.getPlayers(), 'add', (p) => { p.setIndex(1); return true; });
  t.mock.method(World, 'refreshActiveRegions', () => {});
  t.mock.method(Sailing, 'onLogin', () => {});
  t.mock.method(PluginManager, 'emitPlayerLogin', (event) => logins.push(event));
  t.mock.method(PluginManager, 'emitCustomEvent', () => {});
  connection.inject([{ type: 'handshake', name, clientType: 0, capabilities: 0 }]);
  await connection.idle();
  return logins;
}

const ninetyNines = () => new Array(SkillManager.AMOUNT_OF_SKILLS).fill(99);

test('a first login writes no account until the handshake, and sends no list without the flag', async (t) => {
  const { channel, connection, response } = await connect('Zezima', 'pw', 0);
  assert.equal(response.success, true);
  assert.equal(response.displayName, 'Zezima');
  assert.equal(Accounts.entryOf('zezima'), undefined, 'a login alone records no account');
  assert.equal(fs.existsSync(process.env.TSPS_ACCOUNTS_FILE), false, 'and writes nothing');
  assert.equal(packetsOf(channel, CHARACTER_LIST).length, 0);
  assert.equal(packetsOf(channel, CHARACTER_RESULT).length, 0);
  await handshake(t, connection, 'Zezima');
  assert.equal(connection.getPlayer().getUsername(), 'Zezima');
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima'], 'entering records it');
  assert.ok(Accounts.charactersOf('zezima')[0].lastPlayedAt > 0);
  Accounts.reset();
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima'], 'on disk');
});

test('a brand-new name lists itself in memory and a closed connection leaves no account', async () => {
  const { connection, list } = await loginWithList('Newbie', 'pw');
  assert.deepEqual(list.entries.map((e) => [e.name, e.primary, e.hasSave]), [['Newbie', true, false]]);
  connection.cleanup('socket_close');
  assert.equal(Accounts.entryOf('newbie'), undefined);
  assert.equal(net.ClientConnection.pendingNames.size, 0);
});

test('a login left on the picker is closed after the pending-login timeout, releasing its names', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  const { channel, connection } = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await select(connection, 'Alt');
  let closed = null;
  channel.close = (code, reason) => { closed = [code, reason]; };
  assert.equal(net.ClientConnection.isLoginPending('Zezima'), true);
  assert.equal(net.ClientConnection.isLoginPending('Alt'), true);
  t.mock.timers.tick(net.ClientConnection.PENDING_LOGIN_TIMEOUT_MS - 1);
  assert.equal(closed, null, 'not before the timeout');
  t.mock.timers.tick(1);
  assert.deepEqual(closed, [1001, 'login timeout']);
  assert.equal(net.ClientConnection.pendingNames.size, 0, 'the account and character are released');
  assert.equal((await login('Zezima', 'pw', 0)).success, true, 'the account can log in again');
});

test('the handshake cancels the pending-login timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  const { channel, connection } = await connect('Zezima', 'pw', 0);
  let closed = false;
  channel.close = () => { closed = true; };
  await handshake(t, connection, 'Zezima');
  t.mock.timers.tick(net.ClientConnection.PENDING_LOGIN_TIMEOUT_MS * 2);
  assert.equal(closed, false);
  assert.ok(connection.getPlayer());
});

test('with the flag the list follows the response and marks the default', async () => {
  seedSave('Zezima', { passwordHash: hashOf('pw'), maxLevel: ninetyNines() });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.touchLastPlayed('zezima', 'Alt', 3);
  const { response, list } = await loginWithList('Zezima', 'pw');
  assert.equal(response.success, true);
  assert.equal(list.defaultIndex, 1, 'last played wins');
  assert.deepEqual(list.entries.map((e) => [e.name, e.primary, e.hasSave]), [['Zezima', true, true], ['Alt', false, false]]);
  assert.equal(list.entries[0].totalLevel, SkillManager.AMOUNT_OF_SKILLS * 99);
  assert.equal(list.entries[0].combatLevel, 126);
  assert.equal(list.entries[1].lastPlayedAt, 3);
  const fresh = new Skills();
  assert.equal(list.entries[1].totalLevel, fresh.maxLevel.reduce((sum, level) => sum + level, 0), 'no save: a fresh character');
  assert.equal(list.entries[1].combatLevel, SkillManager.calculateCombatLevel(fresh.maxLevel));
  assert.equal(list.max, 3);
});

test('typing a non-primary name logs into its account and preselects it', async () => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.touchLastPlayed('zezima', 'Zezima', 5);
  const { response, list } = await loginWithList('Alt', 'pw');
  assert.equal(response.success, true);
  assert.equal(response.displayName, 'Zezima', 'the response names the account');
  assert.equal(list.defaultIndex, 1, 'the typed character beats the last played');
  net.ClientConnection.pendingNames.clear();
  const wrong = await login('Alt', 'nope', 0);
  assert.equal(wrong.code, 3, 'the password is the account\'s');
});

test('a login without the picker enters the typed character, primary included', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.touchLastPlayed('zezima', 'Alt', 3);
  const { channel, connection } = await connect('Zezima', 'pw', 0);
  assert.equal(net.ClientConnection.isLoginPending('Zezima'), true, 'the account is reserved');
  const logins = await handshake(t, connection, 'Zezima');
  const player = connection.getPlayer();
  assert.ok(player, 'entered the world');
  assert.equal(player.getUsername(), 'Zezima', 'the typed primary, not the last played alt');
  assert.equal(logins.length, 1);
  assert.equal(logins[0].isNewAccount, false);
  assert.equal(net.ClientConnection.pendingNames.size, 0, 'every reservation is released');
  assert.equal(packetsOf(channel, CHARACTER_LIST).length + packetsOf(channel, CHARACTER_RESULT).length, 0,
    'a flagless login (the gateway) sees no character packets');

  const before = Date.now();
  const alt = await connect('Alt', 'pw', 0);
  const altLogins = await handshake(t, alt.connection, 'Zezima');
  assert.equal(alt.connection.getPlayer().getUsername(), 'Alt', 'a typed alt enters the alt');
  assert.equal(altLogins.at(-1).isNewAccount, true, 'no save existed for this character');
  assert.ok(Accounts.charactersOf('zezima')[1].lastPlayedAt >= before, 'last played is updated');
});

test('select swaps the character, is refused after handshake, and refuses a banned one', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.addCharacter('zezima', 'Third', 3);

  const early = new net.ClientConnection(stubChannel());
  await select(early, 'Alt');
  assert.equal(lastResult(early.channel).code, 4, 'no select before login');

  const { channel, connection, response } = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  assert.equal(response.success, true);
  await select(connection, 'Nobody');
  assert.deepEqual(lastResult(channel), { ok: false, code: 4, message: lastResult(channel).message });

  const banned = t.mock.method(PlayerPunishment, 'banned', (name) => name.toLowerCase() === 'third');
  await select(connection, 'third');
  assert.equal(lastResult(channel).code, 10);
  banned.mock.restore();

  await select(connection, 'alt');
  assert.deepEqual(lastResult(channel), { ok: true, code: 0, message: '' });
  assert.equal(net.ClientConnection.isLoginPending('Alt'), true, 'the chosen character is reserved');

  await handshake(t, connection, 'Zezima');
  assert.equal(connection.getPlayer().getUsername(), 'Alt');
  await select(connection, 'Zezima');
  assert.equal(lastResult(channel).code, 4, 'no select after handshake');
  assert.equal(connection.getPlayer().getUsername(), 'Alt');
});

test('a default character banned after login is refused at handshake', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.touchLastPlayed('zezima', 'Alt', 3);
  const { channel, connection, list } = await loginWithList('Zezima', 'pw');
  assert.equal(list.defaultIndex, 1);
  t.mock.method(PlayerPunishment, 'banned', (name) => name.toLowerCase() === 'alt');
  await handshake(t, connection, 'Zezima');
  assert.ok(connection.getPlayer() === undefined, 'no player for a banned character');
  const responses = packetsOf(channel, LOGIN_RESPONSE).map(decodeResponse);
  assert.equal(responses.at(-1).code, 4);
  assert.equal(net.ClientConnection.pendingNames.size, 0);
});

test('the default skips banned characters; a banned typed name is refused', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.addCharacter('zezima', 'Third', 3);
  Accounts.touchLastPlayed('zezima', 'Alt', 9);
  Accounts.touchLastPlayed('zezima', 'Third', 5);
  t.mock.method(PlayerPunishment, 'banned', (name) => name.toLowerCase() === 'alt');

  // With the picker: the last played that isn't banned.
  const picked = await loginWithList('Zezima', 'pw');
  assert.equal(picked.list.defaultIndex, 2, 'Alt is banned: Third, the next last played');
  await handshake(t, picked.connection, 'Zezima');
  assert.equal(picked.connection.getPlayer().getUsername(), 'Third');
  net.ClientConnection.pendingNames.clear();

  // Without it: the typed name, never the banned last played.
  const plain = await connect('Zezima', 'pw', 0);
  assert.equal(plain.response.success, true);
  await handshake(t, plain.connection, 'Zezima');
  assert.equal(plain.connection.getPlayer().getUsername(), 'Zezima');
  net.ClientConnection.pendingNames.clear();

  for (const flags of [0, LOGIN_FLAG_CHARACTER_SELECT]) {
    assert.equal((await login('Alt', 'pw', flags)).code, 4, 'the typed character is banned');
  }
});

test('an account whose every character is banned is refused', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  t.mock.method(PlayerPunishment, 'banned', () => true);
  for (const flags of [0, LOGIN_FLAG_CHARACTER_SELECT]) {
    const { response, channel } = await connect('Zezima', 'pw', flags);
    net.ClientConnection.pendingNames.clear();
    assert.deepEqual([response.success, response.code], [false, 4]);
    assert.equal(packetsOf(channel, CHARACTER_LIST).length, 0);
  }
  assert.equal(net.ClientConnection.pendingNames.size, 0);
});

test('a banned primary bans the whole account: alt logins and creation are refused', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  seedSave('Alt');
  // Banned after this login reached the picker: creating is refused too.
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  const banned = t.mock.method(PlayerPunishment, 'banned', (name) => name.toLowerCase() === 'zezima');
  await create(c, 'New Alt');
  assert.deepEqual(lastResult(c.channel), { ok: false, code: 10, message: 'Your account has been disabled.' });
  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima', 'Alt']);
  c.connection.cleanup('socket_close');
  net.ClientConnection.pendingNames.clear();

  for (const flags of [0, LOGIN_FLAG_CHARACTER_SELECT]) {
    const { response, channel } = await connect('Alt', 'pw', flags);
    net.ClientConnection.pendingNames.clear();
    assert.deepEqual([response.success, response.code, response.error], [false, 4, 'Your account has been disabled.']);
    assert.equal(packetsOf(channel, CHARACTER_LIST).length, 0);
  }
  banned.mock.restore();
  assert.equal((await login('Alt', 'pw', 0)).success, true, 'lifting the ban lets the account back in');
});

test('a primary banned while on the picker refuses selecting an alt and entering the world', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  seedSave('Alt');
  const { channel, connection } = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await select(connection, 'Alt');
  assert.deepEqual(lastResult(channel), { ok: true, code: 0, message: '' }, 'Alt is chosen before the ban');

  t.mock.method(PlayerPunishment, 'banned', (name) => name.toLowerCase() === 'zezima');
  await select(connection, 'Alt');
  assert.deepEqual(lastResult(channel), { ok: false, code: 10, message: 'Your account has been disabled.' });

  // The handshake would enter Alt, chosen before the ban: the account-wide ban refuses it.
  const logins = await handshake(t, connection, 'Zezima');
  assert.ok(connection.getPlayer() === undefined, 'nothing entered the world');
  assert.equal(logins.length, 0, 'no login event');
  assert.deepEqual(packetsOf(channel, LOGIN_RESPONSE).map(decodeResponse).at(-1).code, 4);
  assert.equal(net.ClientConnection.pendingNames.size, 0, 'the names are released');
});

test('one account online at a time, whichever character', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  const online = t.mock.method(World, 'getPlayerByName', (name) => (name.toLowerCase() === 'alt' ? {} : undefined));
  assert.equal((await login('Zezima', 'pw', 0)).code, 5);
  assert.equal((await login('Alt', 'pw', 0)).code, 5);
  online.mock.restore();

  const first = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  assert.equal(first.response.success, true);
  const second = await connect('Alt', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  assert.equal(second.response.code, 5, 'a pending account refuses a second login by any of its names');

  t.mock.method(World, 'getPlayerByName', (name) => (name.toLowerCase() === 'alt' ? {} : undefined));
  await select(first.connection, 'Alt');
  assert.equal(lastResult(first.channel).code, 7, 'an online character cannot be selected');
});

test('a character reserved by another connection cannot be selected', async () => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  const { channel, connection } = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  net.ClientConnection.pendingNames.add('alt');
  await select(connection, 'Alt');
  assert.equal(lastResult(channel).code, 7);
});

test('the default: the typed character (primary only without the picker), else the last played unbanned, else the first', () => {
  const characters = [
    { name: 'Zezima', createdAt: 1, lastPlayedAt: 0 },
    { name: 'Alt', createdAt: 2, lastPlayedAt: 0 },
    { name: 'Third Guy', createdAt: 3, lastPlayedAt: 0 },
  ];
  assert.equal(defaultCharacterIndex(characters, 'zezima'), 0);
  characters[2].lastPlayedAt = 9;
  assert.equal(defaultCharacterIndex(characters, 'zezima'), 2, 'the picker preselects the last played over a typed primary');
  assert.equal(defaultCharacterIndex(characters, 'zezima', { enterTyped: true }), 0, 'without the picker the typed primary enters');
  assert.equal(defaultCharacterIndex(characters, 'alt'), 1);
  assert.equal(defaultCharacterIndex(characters, 'alt', { enterTyped: true }), 1);
  assert.equal(defaultCharacterIndex(characters, 'third guy'), 2);
  const banned = (name) => name === 'Third Guy';
  assert.equal(defaultCharacterIndex(characters, 'zezima', { banned }), 0, 'a banned last played is skipped');
  characters[1].lastPlayedAt = 5;
  assert.equal(defaultCharacterIndex(characters, 'zezima', { banned }), 1);
  assert.equal(defaultCharacterIndex(characters, 'zezima', { banned: () => true }), -1, 'every character banned');
});

test('the character cap reads its plugin config, clamped, and is one in the browser host', (t) => {
  const config = t.mock.method(PluginManager, 'getPluginConfig', (_key, fallback) => fallback);
  assert.equal(maxCharactersPerAccount(), 1);
  config.mock.mockImplementation(() => 50);
  assert.equal(maxCharactersPerAccount(), 6, 'the picker draws at most six rows');
  config.mock.mockImplementation(() => 6.9);
  assert.equal(maxCharactersPerAccount(), 6);
  config.mock.mockImplementation(() => 2.9);
  assert.equal(maxCharactersPerAccount(), 2, 'rounded down');
  config.mock.mockImplementation(() => 'lots');
  assert.equal(maxCharactersPerAccount(), 1, 'a non-numeric value falls back to the default');
  config.mock.mockImplementation(() => 0);
  assert.equal(maxCharactersPerAccount(), 1);
  config.mock.mockImplementation(() => 5);
  const host = process.env.BROWSER_HOST;
  process.env.BROWSER_HOST = '1';
  try {
    assert.equal(maxCharactersPerAccount(), 1);
  } finally {
    if (host === undefined) delete process.env.BROWSER_HOST;
    else process.env.BROWSER_HOST = host;
  }
});

async function send(connection, packet) {
  connection.inject([packet]);
  await connection.idle();
}
const create = (c, name) => send(c.connection, { type: 'character_create', name });
const remove = (c, name, confirmName = name) => send(c.connection, { type: 'character_delete', name, confirmName });

test('creating a character: precondition, name rules, cap, success', async (t) => {
  t.mock.method(PluginManager, 'getPluginConfig', (key, fallback) => (key === 'characters:maxPerAccount' ? 3 : fallback));
  const early = new net.ClientConnection(stubChannel());
  await send(early, { type: 'character_create', name: 'Alt' });
  assert.equal(lastResult(early.channel).code, 4, 'no create before login');

  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await create(c, 'Alt');
  assert.equal(lastResult(c.channel).code, 9, 'the primary has not entered the world yet');
  // As if it entered (and logged out) in the meantime: its account record and save exist.
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  await create(c, 'bad!name');
  assert.equal(lastResult(c.channel).code, 2);
  await create(c, 'ThirteenChars1');
  assert.equal(lastResult(c.channel).code, 2);
  await create(c, 'Zezima');
  assert.equal(lastResult(c.channel).code, 1);
  seedSave('Taken', { passwordHash: hashOf('pw') });
  await create(c, 'taken');
  assert.equal(lastResult(c.channel).code, 1);

  const before = packetsOf(c.channel, CHARACTER_LIST).length;
  await create(c, 'Alt');
  assert.deepEqual(lastResult(c.channel), { ok: true, code: 0, message: '' });
  const lists = packetsOf(c.channel, CHARACTER_LIST);
  assert.equal(lists.length, before + 1);
  const entry = decodeList(lists.at(-1)).entries.find((e) => e.name === 'Alt');
  assert.ok(entry && entry.hasSave === false && entry.primary === false);
  assert.equal(saves.size, 2, 'creating writes no save');

  await create(c, 'Third');
  assert.equal(lastResult(c.channel).code, 0);
  await create(c, 'Fourth');
  assert.equal(lastResult(c.channel).code, 3);
  assert.equal(Accounts.charactersOf('zezima').length, 3);
});

test('a league-only primary save also allows creating', async () => {
  seedSave('Zezima', { passwordHash: hashOf('pw'), profile: LEAGUE_PROFILE });
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await create(c, 'Alt');
  assert.equal(lastResult(c.channel).code, 0);
});

test('a new character enters as a new player; the primary re-enters as an old one', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await create(c, 'Alt');
  await select(c.connection, 'Alt');
  assert.equal(lastResult(c.channel).code, 0);
  const logins = await handshake(t, c.connection, 'Zezima');
  assert.equal(logins.length, 1);
  assert.equal(logins[0].isNewAccount, true);
  assert.equal(logins[0].username, 'Alt');

  net.ClientConnection.pendingNames.clear();
  const d = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await select(d.connection, 'Zezima'); // the last played (Alt) is the default otherwise
  const again = await handshake(t, d.connection, 'Zezima');
  assert.equal(again.at(-1).isNewAccount, false);
});

test('deleting: primary, online, confirmation, success, and persistence failure', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.addCharacter('zezima', 'Other', 3);
  seedSave('Alt');
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);

  await remove(c, 'Nobody');
  assert.equal(lastResult(c.channel).code, 4);
  await remove(c, 'zezima');
  assert.equal(lastResult(c.channel).code, 5);
  const online = t.mock.method(World, 'getPlayerByName', (name) => (name.toLowerCase() === 'alt' ? {} : undefined));
  await remove(c, 'Alt');
  assert.equal(lastResult(c.channel).code, 7);
  online.mock.restore();
  net.ClientConnection.pendingNames.add('other');
  await remove(c, 'Other');
  assert.equal(lastResult(c.channel).code, 7, 'reserved by another connection');
  net.ClientConnection.pendingNames.delete('other');
  await remove(c, 'Alt', 'Other');
  assert.equal(lastResult(c.channel).code, 6);
  assert.equal(Accounts.charactersOf('zezima').length, 3);
  assert.equal(persistence.deleted.length, 0);

  persistence.failDelete = new Error('disk');
  const errors = t.mock.method(console, 'error', () => {});
  await remove(c, 'Alt', 'alt');
  assert.equal(lastResult(c.channel).code, 8);
  assert.equal(Accounts.charactersOf('zezima').length, 3, 'a failed delete leaves the account alone');
  errors.mock.restore();
  persistence.failDelete = new Error('This persistence backend does not support deleting saves');
  persistence.deleted.length = 0;

  // The pending character itself is deleted: the default falls back and is reserved.
  await select(c.connection, 'Alt');
  assert.equal(net.ClientConnection.isLoginPending('Alt'), true);
  const lists = packetsOf(c.channel, CHARACTER_LIST).length;
  await remove(c, 'ALT', 'alt');
  assert.deepEqual(lastResult(c.channel), { ok: true, code: 0, message: '' });
  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima', 'Other']);
  assert.deepEqual(persistence.deleted.map((d) => d[1]).sort(), [LEAGUE_PROFILE, MAIN_PROFILE].sort());
  assert.equal(packetsOf(c.channel, CHARACTER_LIST).length, lists + 1);
  assert.equal(net.ClientConnection.isLoginPending('Alt'), false, 'the deleted character is released');
  const logins = await handshake(t, c.connection, 'Zezima');
  assert.notEqual(logins[0].username.toLowerCase(), 'alt');
});

test('later failures keep delete and create consistent', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  seedSave('Alt');
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await select(c.connection, 'Alt');

  // The fallback's save cannot be read: nothing changes and no save is deleted.
  const realLoad = persistence.load;
  persistence.load = (name, profile) => { if (Accounts.key(name) === 'zezima') throw new Error('read'); return realLoad(name, profile); };
  const errors = t.mock.method(console, 'error', () => {});
  await remove(c, 'Alt');
  assert.equal(lastResult(c.channel).code, 8);
  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima', 'Alt']);
  assert.equal(persistence.deleted.length, 0);
  assert.equal(net.ClientConnection.isLoginPending('Alt'), true, 'still reserved');
  persistence.load = realLoad;

  // A throwing list refresh still replies ok for a created character, stored formatted.
  const before = Accounts.charactersOf('zezima').length;
  persistence.load = () => { throw new Error('list'); };
  await create(c, 'New_guy');
  persistence.load = realLoad;
  errors.mock.restore();
  assert.deepEqual(lastResult(c.channel), { ok: true, code: 0, message: '' });
  assert.equal(Accounts.charactersOf('zezima').length, before + 1);
  assert.equal(Accounts.charactersOf('zezima').at(-1).name, 'New guy');
});

test('every taken name refuses a create with code 1', async (t) => {
  t.mock.method(PluginManager, 'getPluginConfig', (key, fallback) => (key === 'characters:maxPerAccount' ? 6 : fallback));
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  seedSave('Owner', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.ensure('Owner', 1);
  Accounts.addCharacter('owner', 'Owned Alt', 2);
  const now = Date.now();
  // Owner shows "Shown Name"; the earlier "Old Name" stays held for it.
  DisplayNames.set('Owner', 'Old Name', now - 2, 60_000);
  DisplayNames.set('Owner', 'Shown Name', now - 1, 60_000);
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);

  const refused = async (name, why) => {
    await create(c, name);
    const result = lastResult(c.channel);
    assert.deepEqual([result.ok, result.code], [false, 1], why);
  };
  await refused('Zezima', "the account's own primary");
  seedSave('Saved Guy');
  await refused('saved guy', 'a save on the main profile');
  seedSave('League Guy', { profile: LEAGUE_PROFILE });
  await refused('League Guy', 'a save on the league profile');
  await refused('Owned_Alt', "another account's character, never entered");
  await refused('shown name', 'a display name another account shows');
  await refused('Old Name', 'a display name another account holds');
  const online = t.mock.method(World, 'getPlayerByName', (name) => (name.toLowerCase() === 'online guy' ? {} : undefined));
  await refused('Online Guy', 'online');
  online.mock.restore();
  const other = await connect('Pending Guy', 'pw', 0);
  assert.equal(other.response.success, true);
  await refused('Pending Guy', 'a pending login on another connection');

  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima'], 'nothing was created');
  await create(c, 'Free Name');
  assert.equal(lastResult(c.channel).code, 0, 'a free name is accepted');
});

test('a display name whose hold ran out no longer blocks a create', async () => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  seedSave('Owner', { passwordHash: hashOf('pw') });
  DisplayNames.set('Owner', 'Gone Name', 1, 0);
  DisplayNames.set('Owner', 'Shown Name', 2, 1);
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await create(c, 'Gone Name');
  assert.equal(lastResult(c.channel).code, 0);
});

test("an unreadable alt's save still lets the account log in and lists the alt", async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw'), maxLevel: ninetyNines() });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.addCharacter('zezima', 'Broken', 3);
  seedSave('Alt', { maxLevel: ninetyNines() });
  seedSave('Broken', { maxLevel: ninetyNines() });
  Accounts.touchLastPlayed('zezima', 'Alt', 9);
  const realLoad = persistence.load;
  t.after(() => { persistence.load = realLoad; });
  persistence.load = (name, profile) => { if (Accounts.key(name) === 'broken') throw new Error('corrupt'); return realLoad(name, profile); };
  const errors = t.mock.method(console, 'error', () => {});
  const { response, list, connection, channel } = await loginWithList('Zezima', 'pw');
  assert.equal(response.success, true);
  assert.equal(list.defaultIndex, 1, 'the last played (readable) alt is still the default');
  assert.deepEqual(list.entries.map((e) => [e.name, e.hasSave]), [['Zezima', true], ['Alt', true], ['Broken', false]]);
  const fresh = new Skills();
  assert.equal(list.entries[2].totalLevel, fresh.maxLevel.reduce((sum, level) => sum + level, 0), 'listed with fresh levels');
  assert.ok(errors.mock.callCount() > 0, 'the failure is logged');
  await select(connection, 'Broken');
  assert.equal(lastResult(channel).code, 8, 'selecting it is refused');
});

test('an unreadable default character falls back to the primary; an unreadable primary still fails', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Broken', 2);
  seedSave('Broken');
  Accounts.touchLastPlayed('zezima', 'Broken', 9);
  const realLoad = persistence.load;
  t.after(() => { persistence.load = realLoad; });
  persistence.load = (name, profile) => { if (Accounts.key(name) === 'broken') throw new Error('corrupt'); return realLoad(name, profile); };
  t.mock.method(console, 'error', () => {});
  const { response, list, connection } = await loginWithList('Broken', 'pw');
  assert.equal(response.success, true);
  assert.equal(list.defaultIndex, 0, 'the primary is the default instead');
  assert.equal(net.ClientConnection.isLoginPending('Broken'), false, 'the unreadable character is not reserved');
  await handshake(t, connection, 'Zezima');
  assert.equal(connection.getPlayer().getUsername(), 'Zezima');

  net.ClientConnection.pendingNames.clear();
  persistence.load = (name, profile) => { if (Accounts.key(name) === 'zezima') throw new Error('corrupt'); return realLoad(name, profile); };
  assert.equal((await login('Zezima', 'pw', 0)).code, 8);
});

test('a delete whose login vanished during the awaited deletes still removes the character', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  seedSave('Alt');
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  const realDelete = persistence.delete;
  t.after(() => { persistence.delete = realDelete; });
  persistence.delete = async (name, profile) => {
    await realDelete(name, profile);
    c.connection.cleanup('socket_close');
  };
  await remove(c, 'Alt');
  assert.equal(lastResult(c.channel).code, 4);
  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima'], 'the account no longer lists it');
  assert.equal(saves.has(saveKey('Alt')), false);
});

test('a deleted name is never claimable again: create, login and display names', async (t) => {
  t.mock.method(PluginManager, 'getPluginConfig', (key, fallback) => (key === 'characters:maxPerAccount' ? 6 : fallback));
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  seedSave('Owner', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.ensure('Owner', 1);
  Accounts.addCharacter('zezima', 'Altguy', 2);
  seedSave('Altguy');
  // The alt showed a display name: it stays behind, keyed by the deleted name.
  DisplayNames.set('Altguy', 'Shinyname', Date.now() - 1, 60_000);
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await remove(c, 'Altguy');
  assert.deepEqual(lastResult(c.channel), { ok: true, code: 0, message: '' });
  assert.equal(saves.has(saveKey('Altguy')), false);
  assert.equal(Accounts.isDeleted('altguy'), true);

  // Another account can't create it.
  const o = await connect('Owner', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await create(o, 'AltGuy');
  assert.deepEqual(lastResult(o.channel), { ok: false, code: 1, message: "That name belonged to a deleted character and can't be used again." });
  assert.deepEqual(Accounts.charactersOf('owner').map((e) => e.name), ['Owner']);

  // A fresh login with the name (a new primary) is refused, with or without the picker, and claims nothing.
  net.ClientConnection.pendingNames.clear();
  for (const flags of [0, LOGIN_FLAG_CHARACTER_SELECT]) {
    const fresh = await connect('Altguy', 'new password', flags);
    assert.deepEqual([fresh.response.success, fresh.response.code, fresh.response.error],
      [false, 3, "That name belonged to a deleted character and can't be used again."]);
    assert.equal(packetsOf(fresh.channel, CHARACTER_LIST).length, 0);
  }
  assert.equal(net.ClientConnection.isLoginPending('Altguy'), false);
  assert.equal(Accounts.entryOf('altguy'), undefined);
  assert.equal(DisplayNames.nameOf('Altguy'), 'Shinyname', 'left in place, unreachable');

  // Nobody can take it as a display name either; the deleted character's display name stays reserved.
  assert.equal(DisplayNames.refusal('Owner', 'Altguy'), 'That name is not available.');
  assert.equal(DisplayNames.refusal('Owner', 'Shinyname'), 'That name is not available.');

  // The tombstone survives a restart.
  Accounts.reset();
  net.ClientConnection.pendingNames.clear();
  assert.equal((await login('ALTGUY', 'pw')).code, 3);
  assert.equal(DisplayNames.refusal('Owner', 'altguy'), 'That name is not available.');

  // The account that deleted it may take it back (a mistaken delete), freeing its tombstone.
  const back = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await create(back, 'AltGuy');
  assert.deepEqual(lastResult(back.channel), { ok: true, code: 0, message: '' });
  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima', 'AltGuy']);
  assert.equal(Accounts.isDeleted('altguy'), false);
});

test('a delete beyond the tombstone limit is refused before anything is deleted', async (t) => {
  t.mock.method(PluginManager, 'getPluginConfig', (key, fallback) => (key === 'characters:maxPerAccount' ? 6 : fallback));
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  for (let i = 0; i < Accounts.MAX_TOMBSTONES_PER_ACCOUNT; i++) {
    Accounts.addCharacter('zezima', 'Burner ' + i, 2);
    Accounts.removeCharacter('zezima', 'Burner ' + i, 3);
  }
  Accounts.addCharacter('zezima', 'Alt', 4);
  seedSave('Alt');
  const c = await connect('Zezima', 'pw', LOGIN_FLAG_CHARACTER_SELECT);
  await remove(c, 'Alt');
  assert.deepEqual(lastResult(c.channel), { ok: false, code: 11, message: 'You have deleted too many characters. Ask a member of staff to free a name.' });
  assert.equal(persistence.deleted.length, 0, 'no save was deleted');
  assert.equal(saves.has(saveKey('Alt')), true);
  assert.deepEqual(Accounts.charactersOf('zezima').map((e) => e.name), ['Zezima', 'Alt']);

  // Staff free one: the account can delete again.
  Accounts.releaseDeleted('Burner 0');
  await remove(c, 'Alt');
  assert.equal(lastResult(c.channel).code, 0);
});
