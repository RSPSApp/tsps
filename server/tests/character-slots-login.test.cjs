// Run after `yarn build`: node --test tests/character-slots-login.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { test, before, beforeEach } = require('node:test');

// Accounts writes its file to this path; keep it off the real data/saves, before `dist` is required.
process.env.TSPS_ACCOUNTS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-')), 'accounts.json');
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
const { SkillManager, Skills } = require('../dist/game/content/skill/SkillManager');
const { MAIN_PROFILE, profileStorageKey } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
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

beforeEach(() => {
  saves.clear();
  Accounts.reset();
  fs.rmSync(process.env.TSPS_ACCOUNTS_FILE, { force: true });
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

test('a first login creates the account and sends no list without the flag', async () => {
  const { channel, response } = await connect('Zezima', 'pw', 0);
  assert.equal(response.success, true);
  assert.equal(response.displayName, 'Zezima');
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima']);
  assert.equal(packetsOf(channel, CHARACTER_LIST).length, 0);
  assert.equal(packetsOf(channel, CHARACTER_RESULT).length, 0);
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

test('handshake without a select enters the default character', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.touchLastPlayed('zezima', 'Alt', 3);
  const { channel, connection } = await connect('Zezima', 'pw', 0);
  assert.equal(net.ClientConnection.isLoginPending('Zezima'), true, 'the account is reserved');
  const before = Date.now();
  const logins = await handshake(t, connection, 'Zezima');
  const player = connection.getPlayer();
  assert.ok(player, 'entered the world');
  assert.equal(player.getUsername(), 'Alt');
  assert.equal(logins.length, 1);
  assert.equal(logins[0].isNewAccount, true, 'no save existed for this character');
  assert.ok(Accounts.charactersOf('zezima')[1].lastPlayedAt >= before, 'last played is updated');
  assert.equal(net.ClientConnection.pendingNames.size, 0, 'every reservation is released');
  assert.equal(packetsOf(channel, CHARACTER_LIST).length + packetsOf(channel, CHARACTER_RESULT).length, 0,
    'a flagless login (the gateway) sees no character packets');
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

test('a banned default character is refused at handshake', async (t) => {
  seedSave('Zezima', { passwordHash: hashOf('pw') });
  Accounts.ensure('Zezima', 1);
  Accounts.addCharacter('zezima', 'Alt', 2);
  Accounts.touchLastPlayed('zezima', 'Alt', 3);
  const { channel, connection } = await connect('Zezima', 'pw', 0);
  t.mock.method(PlayerPunishment, 'banned', (name) => name.toLowerCase() === 'alt');
  await handshake(t, connection, 'Zezima');
  assert.ok(connection.getPlayer() === undefined, 'no player for a banned character');
  const responses = packetsOf(channel, LOGIN_RESPONSE).map(decodeResponse);
  assert.equal(responses.at(-1).code, 4);
  assert.equal(net.ClientConnection.pendingNames.size, 0);
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

test('the default is the typed non-primary, else the last played, else the first', () => {
  const characters = [
    { name: 'Zezima', createdAt: 1, lastPlayedAt: 0 },
    { name: 'Alt', createdAt: 2, lastPlayedAt: 0 },
    { name: 'Third Guy', createdAt: 3, lastPlayedAt: 0 },
  ];
  assert.equal(defaultCharacterIndex(characters, 'zezima'), 0);
  characters[2].lastPlayedAt = 9;
  assert.equal(defaultCharacterIndex(characters, 'zezima'), 2);
  assert.equal(defaultCharacterIndex(characters, 'alt'), 1);
  assert.equal(defaultCharacterIndex(characters, 'third guy'), 2);
});

test('the character cap reads its plugin config, clamped, and is one in the browser host', (t) => {
  const config = t.mock.method(PluginManager, 'getPluginConfig', (_key, fallback) => fallback);
  assert.equal(maxCharactersPerAccount(), 3);
  config.mock.mockImplementation(() => 50);
  assert.equal(maxCharactersPerAccount(), 20);
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
