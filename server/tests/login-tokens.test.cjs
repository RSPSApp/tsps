// Run after `yarn build`: node --test tests/login-tokens.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { GameConstants } = require('../dist/game/GameConstants');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PasswordUtil } = require('../dist/util/PasswordUtil');
const net = require('../dist/net/NetworkBuilder');
const tokens = require('../dist/net/login/LoginTokens');

const REVISION = 435;
const DAY = 24 * 60 * 60 * 1000;

test('a token is valid once, and its replaced copy is caught', () => {
  const now = Date.now();
  const first = tokens.issueLoginToken([], now);
  assert.equal(first.entries.length, 1);
  assert.notEqual(first.entries[0].hash, first.token, 'only the hash is kept');
  assert.deepEqual(tokens.checkLoginToken(first.entries, first.token), { kind: 'valid', index: 0 });

  const second = tokens.issueLoginToken(first.entries, now, 0);
  assert.equal(second.entries.length, 1, 'a token login swaps the entry');
  assert.deepEqual(tokens.checkLoginToken(second.entries, second.token), { kind: 'valid', index: 0 });
  assert.deepEqual(tokens.checkLoginToken(second.entries, first.token), { kind: 'reused', index: 0 });
  assert.deepEqual(tokens.checkLoginToken(second.entries, 'made-up'), { kind: 'invalid' });
  assert.deepEqual(tokens.revokeLoginToken(second.entries, 0), []);
});

test('remembered logins expire after 30 days unused and keep the newest five', () => {
  const now = Date.now();
  const fresh = { hash: 'a'.repeat(64), lastUsed: now - 29 * DAY };
  const stale = { hash: 'b'.repeat(64), lastUsed: now - 31 * DAY };
  assert.deepEqual(tokens.readLoginTokens([fresh, stale, { hash: 'nope', lastUsed: now }, null], now), [fresh]);

  let entries = [];
  for (let i = 0; i < 7; i++) entries = tokens.issueLoginToken(entries, now + i).entries;
  assert.equal(entries.length, tokens.MAX_LOGIN_TOKENS);
  assert.equal(entries[0].lastUsed, now + 6, 'newest first');
  assert.equal(entries.at(-1).lastUsed, now + 2, 'the two oldest were dropped');
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

/** One account whose save the login path reads and updates in place. */
function accountStore(passwordHash, attributes = {}) {
  const save = { attributes, getPasswordHashWithSalt: () => passwordHash, applyToPlayer() {} };
  GameConstants.PLAYER_PERSISTENCE = {
    load: () => save,
    exists: () => true,
    save: () => {},
    flush: async () => {},
    checkPassword: (password, playerSave) => PasswordUtil.passwordsMatch(password, playerSave.getPasswordHashWithSalt()),
    encryptPassword: (password) => PasswordUtil.generatePasswordHashWithSalt(password),
    updateOffline: async (_username, update) => { update(save); return true; },
  };
  return save;
}

function readString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  return [buffer.toString('latin1', offset, end), end + 1];
}

/** Logs in on a fresh connection and returns the decoded LOGIN_RESPONSE. */
async function login(username, password, flags) {
  CachePipeline.getActive = () => ({ revision: REVISION });
  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  connection.inject([{ type: 'login', username, password, revision: REVISION, flags }]);
  await connection.idle();
  net.ClientConnection.pendingNames.clear();
  const packet = channel.sent.find((bytes) => bytes[0] === 3);
  assert.ok(packet, 'a login response was sent');
  const body = packet.subarray(2);
  let offset = 5;
  let error, displayName, token;
  [error, offset] = readString(body, offset);
  [displayName, offset] = readString(body, offset);
  [token, offset] = readString(body, offset);
  return { success: body[0] === 1, code: body.readInt32BE(1), error, displayName, token };
}

test('"Stay logged in" swaps the password for a rotating token', async () => {
  const hash = await PasswordUtil.generatePasswordHashWithSalt('hunter22');
  const save = accountStore(hash);

  const plain = await login('tokenuser', 'hunter22', 0);
  assert.equal(plain.success, true);
  assert.equal(plain.token, '', 'no token unless asked for');

  const remembered = await login('tokenuser', 'hunter22', tokens.LOGIN_FLAG_REMEMBER);
  assert.equal(remembered.success, true);
  assert.match(remembered.token, /^[A-Za-z0-9_-]{43}$/);
  const saved = save.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE];
  assert.equal(saved.length, 1, 'the token is saved before the response');
  assert.ok(!JSON.stringify(saved).includes(remembered.token), 'the save never holds the token itself');

  const resumed = await login('tokenuser', remembered.token, tokens.LOGIN_FLAG_TOKEN);
  assert.equal(resumed.success, true);
  assert.notEqual(resumed.token, remembered.token, 'a token login hands out a new token');

  const copied = await login('tokenuser', remembered.token, tokens.LOGIN_FLAG_TOKEN);
  assert.equal(copied.success, false, 'the swapped-out token is refused');
  assert.equal(copied.code, 3);
  assert.deepEqual(save.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE], [], 'and its browser is signed out');

  const afterRevoke = await login('tokenuser', resumed.token, tokens.LOGIN_FLAG_TOKEN);
  assert.equal(afterRevoke.success, false, 'the newer copy went with it');
});

test('a token never creates an account or stands in for the password', async () => {
  GameConstants.PLAYER_PERSISTENCE = { ...GameConstants.PLAYER_PERSISTENCE, load: () => null };
  const missing = await login('nobodyhere', 'x'.repeat(43), tokens.LOGIN_FLAG_TOKEN);
  assert.equal(missing.success, false);

  const hash = await PasswordUtil.generatePasswordHashWithSalt('hunter22');
  accountStore(hash);
  const asPassword = await login('tokenuser', 'x'.repeat(43), 0);
  assert.equal(asPassword.success, false);
});

test('only a save from before hashing matches the plain password', async () => {
  accountStore('ab:cd');
  assert.equal((await login('tokenuser', 'ab:cd', 0)).success, false, 'a hash is never the password');
  accountStore('oldpass');
  assert.equal((await login('tokenuser', 'oldpass', 0)).success, true);
});

test('the display name keeps its capitals, and an account keeps its saved name', async () => {
  GameConstants.PLAYER_PERSISTENCE = { ...GameConstants.PLAYER_PERSISTENCE, load: () => null };
  const created = await login('John UIM', 'hunter22', 0);
  assert.equal(created.success, true);
  assert.equal(created.displayName, 'John UIM', 'a new account takes the name as typed');
  assert.equal((await login('john_uim', 'hunter22', 0)).displayName, 'john uim', 'underscores show as spaces');
  assert.equal((await login('a b c', 'hunter22', 0)).success, true, 'every space counts, not just the first');

  const save = accountStore('oldpass');
  save.getDisplayName = () => 'John UIM';
  assert.equal((await login('john uim', 'oldpass', 0)).displayName, 'John UIM', 'the saved name wins over the typed one');
  delete save.getDisplayName;
  assert.equal((await login('john uim', 'oldpass', 0)).displayName, 'john uim', 'a save without one takes the typed name');
});

test('changing the password signs out every remembered login', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = Object.create(Player.prototype);
  const attributes = new Map();
  player.getAttribute = (key) => attributes.get(key);
  player.setAttribute = (key, value) => attributes.set(key, value);
  player.setPasswordHashWithSalt('first');
  player.setAttribute(tokens.LOGIN_TOKENS_ATTRIBUTE, [{ hash: 'a'.repeat(64), lastUsed: Date.now() }]);
  player.setPasswordHashWithSalt('first');
  assert.equal(player.getAttribute(tokens.LOGIN_TOKENS_ATTRIBUTE).length, 1, 'same hash keeps them');
  player.setPasswordHashWithSalt('second');
  assert.deepEqual(player.getAttribute(tokens.LOGIN_TOKENS_ATTRIBUTE), []);
});

test('"Log out" on the remembered-account screen drops only that token', async () => {
  const hash = await PasswordUtil.generatePasswordHashWithSalt('hunter22');
  const save = accountStore(hash);
  let writes = 0;
  const update = GameConstants.PLAYER_PERSISTENCE.updateOffline;
  GameConstants.PLAYER_PERSISTENCE.updateOffline = async (...args) => { writes++; return update(...args); };
  const kept = (await login('tokenuser', 'hunter22', tokens.LOGIN_FLAG_REMEMBER)).token;
  const forgotten = (await login('tokenuser', 'hunter22', tokens.LOGIN_FLAG_REMEMBER)).token;
  assert.equal(save.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE].length, 2);

  const forget = async (token) => {
    const connection = new net.ClientConnection(stubChannel());
    connection.inject([{ type: 'login_forget', username: 'tokenuser', token }]);
    await connection.idle();
  };
  writes = 0;
  await forget('made-up');
  assert.equal(writes, 0, 'an unknown token writes nothing');
  await forget(forgotten);
  assert.equal(writes, 1);
  assert.equal(save.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE].length, 1);
  assert.equal((await login('tokenuser', forgotten, tokens.LOGIN_FLAG_TOKEN)).success, false);
  assert.equal((await login('tokenuser', kept, tokens.LOGIN_FLAG_TOKEN)).success, true, 'other browsers stay');
});

test('the forget packet round-trips', () => {
  const { decodeClientPacket } = require('../dist/net/protocol/ClientProtocol');
  const body = Buffer.from('Zezima\0tok\0', 'latin1');
  assert.deepEqual(decodeClientPacket(Buffer.concat([Buffer.from([207, body.length]), body])), {
    type: 'login_forget', username: 'Zezima', token: 'tok',
  });
});
