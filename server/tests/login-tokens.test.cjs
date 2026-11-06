// Run after `yarn build`: node --test tests/login-tokens.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

// Accounts writes its file to this path; keep it off the real data/saves, before `dist` is required.
process.env.TSPS_ACCOUNTS_FILE = require('node:path').join(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'accounts-')), 'accounts.json');
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

/** An account with a main save and a league save; the login path picks by profile. */
function profileStore(passwordHash) {
  const saves = {
    main: { attributes: {}, getPasswordHashWithSalt: () => passwordHash, applyToPlayer() {} },
    league: { attributes: {}, getPasswordHashWithSalt: () => passwordHash, applyToPlayer() {} },
  };
  const calls = [];
  GameConstants.PLAYER_PERSISTENCE = {
    load: (_username, profile = 'main') => { calls.push(['load', profile]); return saves[profile]; },
    exists: () => true,
    save: () => {},
    flush: async () => {},
    checkPassword: (password, playerSave) => PasswordUtil.passwordsMatch(password, playerSave.getPasswordHashWithSalt()),
    encryptPassword: (password) => PasswordUtil.generatePasswordHashWithSalt(password),
    updateOffline: async (_username, update, _reason, profile = 'main') => { calls.push(['update', profile]); update(saves[profile]); return true; },
  };
  return { saves, calls };
}

/** Both characters of one account, with the hash each save holds and the real persistence base class's account methods. */
function accountWithBothCharacters(hash) {
  const { PlayerPersistence } = require('../dist/game/entity/impl/player/persistence/PlayerPersistence');
  const hashes = { main: hash, league: hash };
  const save = (profile) => ({
    attributes: {},
    getPasswordHashWithSalt: () => hashes[profile],
    setPasswordHashWithSalt(value) { hashes[profile] = value; },
    getDisplayName: () => 'tokenuser',
    applyToPlayer() {},
  });
  const saves = { main: save('main'), league: save('league') };
  const store = Object.assign(Object.create(PlayerPersistence.prototype), {
    load: (_username, profile = 'main') => saves[profile],
    exists: (_username, profile = 'main') => saves[profile] != null,
    save: () => {},
    saveOffline: () => {},
    flush: async () => {},
    checkPassword: (password, playerSave) => PasswordUtil.passwordsMatch(password, playerSave.getPasswordHashWithSalt()),
    encryptPassword: (password) => PasswordUtil.generatePasswordHashWithSalt(password),
  });
  GameConstants.PLAYER_PERSISTENCE = store;
  return { saves, hashes, store };
}

test('changing the password reaches both characters, and signs out every remembered login on both', async () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { World } = require('../dist/game/World');
  const hashA = await PasswordUtil.generatePasswordHashWithSalt('passwordA');
  const { saves, hashes, store } = accountWithBothCharacters(hashA);
  saves.main.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE] = [{ hash: 'a'.repeat(64), lastUsed: Date.now() }];
  saves.league.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE] = [{ hash: 'b'.repeat(64), lastUsed: Date.now() }];
  GameConstants.setWorldProfile('league');
  try {
    assert.equal((await login('tokenuser', 'passwordA', 0)).success, true, 'the league character opens with A');
    // The main character is online on a plain world and changes the password.
    const online = new Player(null);
    online.setUsername('tokenuser');
    online.setProfile('main');
    online.setPasswordHashWithSalt(hashA);
    online.setAttribute(tokens.LOGIN_TOKENS_ATTRIBUTE, saves.main.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE]);
    const byName = World.getPlayerByName;
    World.getPlayerByName = (name) => (name === 'tokenuser' ? online : undefined);
    let saved = 0;
    store.requestSave = () => { saved++; };
    const messages = [];
    online.sendMessage = (text) => messages.push(text);
    try {
      // Through the registered command, as a player would.
      const commands = {};
      const { PluginManager } = require('../dist/plugins/PluginManager');
      const api = new Proxy({ core: PluginManager.getCoreApi(), registerCommand: (name, handler) => (commands[name] = handler) },
        { get: (target, key) => (key in target ? target[key] : () => {}) });
      require('../plugins/commands/PlayerCommands.plugin').register(api);
      await commands.changepassword({ player: online, raw: 'changepassword passwordB', parts: ['changepassword', 'passwordB'] });
    } finally {
      World.getPlayerByName = byName;
    }
    assert.ok(messages.some((text) => /password/i.test(text)), `the command answered: ${messages.join(' | ')}`);
    assert.equal(saved, 1, 'the live character is saved');
    assert.deepEqual(online.getAttribute(tokens.LOGIN_TOKENS_ATTRIBUTE), [], 'its remembered logins are gone');
    assert.deepEqual(saves.league.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE], [], 'and the league character\'s too');
    assert.ok(await PasswordUtil.passwordsMatch('passwordB', hashes.league), 'the league save holds the new hash');
    // The main save's hash is what its logout save would write; here the stub keeps the old one, so point it at the live player's.
    hashes.main = online.getPasswordHashWithSalt();
    assert.equal((await login('tokenuser', 'passwordA', 0)).success, false, 'the old password opens neither character');
    assert.equal((await login('tokenuser', 'passwordB', 0)).success, true, 'the new one opens the league character');
    GameConstants.setWorldProfile('main');
    assert.equal((await login('tokenuser', 'passwordA', 0)).success, false);
    assert.equal((await login('tokenuser', 'passwordB', 0)).success, true);
  } finally {
    GameConstants.setWorldProfile('main');
  }
});

test('the main character\'s credential rules once both exist', async () => {
  const hashA = await PasswordUtil.generatePasswordHashWithSalt('passwordA');
  const { hashes } = accountWithBothCharacters(hashA);
  hashes.league = await PasswordUtil.generatePasswordHashWithSalt('stale');
  GameConstants.setWorldProfile('league');
  try {
    assert.equal((await login('tokenuser', 'stale', 0)).success, false, 'a hash left in the league save is not a credential');
    assert.equal((await login('tokenuser', 'passwordA', 0)).success, true, 'the main character\'s password is');
  } finally {
    GameConstants.setWorldProfile('main');
  }
});

test("on a league world a character not made yet needs the main character's password, and takes its hash", async () => {
  const hash = await PasswordUtil.generatePasswordHashWithSalt('hunter22');
  const { saves, calls } = profileStore(hash);
  GameConstants.setWorldProfile('league');
  try {
    saves.league = null;
    const stolen = await login('tokenuser', 'letmein', 0);
    assert.equal(stolen.success, false, 'the name has a main character: its password is required');
    assert.equal(stolen.code, 3);
    assert.ok(calls.some(([kind, profile]) => kind === 'load' && profile === 'main'), 'the main save was consulted');
    const owner = await login('tokenuser', 'hunter22', 0);
    assert.equal(owner.success, true, 'the owner may start the league character');
    assert.equal(owner.displayName, 'tokenuser');

    saves.league = null;
    saves.main = null;
    assert.equal((await login('newname', 'anything', 0)).success, true, 'a name nobody has can start as a league character');
  } finally {
    GameConstants.setWorldProfile('main');
  }
});

test("on a plain world a name made first on a league world needs that character's password", async () => {
  const hash = await PasswordUtil.generatePasswordHashWithSalt('hunter22');
  const { saves, calls } = profileStore(hash);
  saves.main = null;
  const stolen = await login('tokenuser', 'letmein', 0);
  assert.equal(stolen.success, false, 'the name has a league character: its password is required');
  assert.equal(stolen.code, 3);
  assert.ok(calls.some(([kind, profile]) => kind === 'load' && profile === 'league'), 'the league save was consulted');
  const owner = await login('tokenuser', 'hunter22', 0);
  assert.equal(owner.success, true, 'the owner may start the main character');
  assert.equal(owner.displayName, 'tokenuser');
});

test('a league world logs the league character in, and its tokens stay in the league save', async () => {
  const hash = await PasswordUtil.generatePasswordHashWithSalt('hunter22');
  const { saves, calls } = profileStore(hash);

  const main = await login('tokenuser', 'hunter22', 0);
  assert.equal(main.success, true, 'a plain world: the main character');
  assert.deepEqual(calls.at(-1), ['load', 'main']);

  GameConstants.setWorldProfile('league');
  try {
    const league = await login('tokenuser', 'hunter22', tokens.LOGIN_FLAG_REMEMBER);
    assert.equal(league.success, true);
    assert.ok(calls.some(([kind, profile]) => kind === 'load' && profile === 'league'), 'the league save is read');
    assert.equal(saves.league.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE].length, 1, 'the token lives in the league save');
    assert.equal(saves.main.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE], undefined, 'and not in the main one');
    assert.ok(calls.some(([kind, profile]) => kind === 'update' && profile === 'league'), 'written through the league profile');

    const resumed = await login('tokenuser', league.token, tokens.LOGIN_FLAG_TOKEN);
    assert.equal(resumed.success, true, 'the token resumes the league character on the league world');

    GameConstants.setWorldProfile('main');
    const elsewhere = await login('tokenuser', resumed.token, tokens.LOGIN_FLAG_TOKEN);
    assert.equal(elsewhere.success, false, 'a league token is no good for the main character on a plain world');
    GameConstants.setWorldProfile('league');

    calls.length = 0;
    const connection = new net.ClientConnection(stubChannel());
    connection.inject([{ type: 'login_forget', username: 'tokenuser', token: resumed.token }]);
    await connection.idle();
    assert.deepEqual(calls.filter(([kind]) => kind === 'update'), [['update', 'league']], 'forgetting goes to the league save');
    assert.deepEqual(saves.league.attributes[tokens.LOGIN_TOKENS_ATTRIBUTE], []);
  } finally {
    GameConstants.setWorldProfile('main');
  }
});
