// Run after `yarn build`: node --test tests/display-name.test.cjs
// ::displayname and the DisplayNames registry: what other players see, apart from the login name.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, beforeEach, afterEach } = require('node:test');
// Accounts writes its file to this path; set it before `dist` is required.
process.env.TSPS_ACCOUNTS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-')), 'accounts.json');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { DisplayNames } = require('../dist/game/entity/impl/player/DisplayNames');
const { GameConstants } = require('../dist/game/GameConstants');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { World } = require('../dist/game/World');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const DisplayName = require('../plugins/commands/DisplayName.plugin');

const DAY = 24 * 60 * 60 * 1000;
const HOLD = 35 * DAY;

let dir;
let saved;
let originalPersistence;
let originalGetPlayerByName;
let online;
let command;
let config;
let prompts;
let events;
let interfaceHookCount;
let customHookCounts = [];

before(() => CachePipeline.initialize(path.resolve(__dirname, '..')));

/** Accounts with a save; the keys are what the login screen makes of a name. */
function persistence(...names) {
  saved = new Set(names.map((name) => DisplayNames.key(name)));
  GameConstants.PLAYER_PERSISTENCE = { exists: (name) => saved.has(DisplayNames.key(name)) };
}

function player(username, { staff = false } = {}) {
  const self = {
    messages: [],
    displayName: '',
    getUsername: () => username,
    getDisplayName: () => self.displayName || username,
    setDisplayName: (name) => { self.displayName = name; return self; },
    isStaff: () => staff,
    sendMessage: (text) => self.messages.push(text),
    last: () => self.messages[self.messages.length - 1],
  };
  self.displayName = DisplayNames.nameOf(username);
  return self;
}

function run(who, text) {
  command({ player: who, raw: text, base: 'displayname', parts: text.split(/\s+/) });
}

/** Runs the command and answers its prompt. */
function change(who, name, answer = 'Yes') {
  run(who, `displayname ${name}`);
  const prompt = prompts.pop();
  assert.ok(prompt, `no prompt for "${name}": ${who.last()}`);
  prompt.answer(answer);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'display-names-'));
  process.env[DisplayNames.FILE_ENV] = path.join(dir, 'display-names.json');
  DisplayNames.reset();
  originalPersistence = GameConstants.PLAYER_PERSISTENCE;
  originalGetPlayerByName = World.getPlayerByName;
  online = new Set();
  World.getPlayerByName = (name) => (online.has(DisplayNames.key(name)) ? {} : undefined);
  persistence('Alice', 'Bob', 'Carol', 'Mod Dave');
  config = {};
  prompts = [];
  events = [];
  interfaceHookCount = PluginManager.interfaceActionClickHooks.length;
  customHookCounts = ['network:plugin-message', 'interface:closed'].map(key => [key, PluginManager.customEventHooks.get(key)?.length ?? 0]);
  const api = PluginManager.createApi('DisplayNameTest');
  DisplayName.register({
    ...api,
    getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
    registerCommand: (name, handler) => { assert.equal(name, 'displayname'); command = handler; },
    emitCustomEvent: (type, payload) => events.push({ type, ...payload }),
    sendMultiChatboxPrompt: (who, title, yes, onYes, no, onNo) => {
      if (who instanceof Player) return api.sendMultiChatboxPrompt(who, title, yes, onYes, no, onNo);
      prompts.push({ title, answer: (option) => (option === yes ? onYes : onNo)(who) });
      return true;
    },
  });
});

afterEach(() => {
  PluginManager.interfaceActionClickHooks.splice(interfaceHookCount);
  for (const [key, count] of customHookCounts) PluginManager.customEventHooks.get(key)?.splice(count);
  GameConstants.PLAYER_PERSISTENCE = originalPersistence;
  World.getPlayerByName = originalGetPlayerByName;
  delete process.env[DisplayNames.FILE_ENV];
  DisplayNames.reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

function nativePlayer(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const who = new Player(new PlayerSession(channel)).setUsername('Alice').setIndex(201);
  const connection = new ClientConnection(channel);
  connection.player = who;
  const scripts = [], messages = [], sender = who.getPacketSender();
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { scripts.push([id, ...args]); return sender; });
  t.mock.method(sender, 'sendMessage', text => { messages.push(text); return sender; });
  return { who, scripts, messages, async input(packet) {
    await connection.dispatch([packet]);
    connection.processTurnPackets();
  } };
}

const openNameChanger = f => f.input({ type: 'widget_action', widgetId: (109 << 16) | 51,
  groupId: 109, childId: 51, buttonNum: 1, opId: 1, itemId: -1, slot: -1 });

/**
 * The cache's display name screen (displayname_menu, 980): the client's displaynames_* ops arrive
 * as "display-names" plugin messages and each reply is that op's *_result values (script10213,
 * script10202, script10234).
 */
function nameScreen(t, f) {
  const replies = [], interfaces = [], strings = new Map();
  const sender = f.who.getPacketSender();
  t.mock.method(sender, 'sendInterface', id => { interfaces.push(id); return sender; });
  t.mock.method(sender, 'sendString', (text, uid) => { strings.set(uid, text); return sender; });
  t.mock.method(f.who.getSession(), 'sendClientPacket', frame => {
    const text = Buffer.from(frame).toString('utf8');
    const at = text.indexOf('{"channel":"display-names"');
    if (at >= 0) replies.push(JSON.parse(text.slice(at)).data);
    return true;
  });
  const ask = (op, name) => f.input({ type: 'plugin_message', channel: 'display-names', data: name === undefined ? { op } : { op, name } });
  const last = op => replies.filter(reply => reply.op === op).at(-1)?.result;
  return { replies, interfaces, strings, ask, last };
}

test('the Account Name Changer opens the cache display name screen with its info rows', async t => {
  const f = nativePlayer(t);
  const screen = nameScreen(t, f);
  await openNameChanger(f);
  assert.deepEqual(screen.interfaces, [980], 'displayname_menu');
  assert.equal(screen.strings.get((980 << 16) | 7), 'Now', 'next free change');
  assert.equal(screen.strings.get((980 << 16) | 9), '0', 'extra changes');
  assert.deepEqual(screen.last('status'), [0, 0, '', false, 0, 0], 'a reopened screen starts at its first panel');
  assert.equal(f.who.getEnteredSyntaxAction() ?? null, null, 'no chatbox text prompt any more');
});

test('Look up names, a check and Change name go through the rules, the save and the social event', async t => {
  const f = nativePlayer(t);
  const screen = nameScreen(t, f);
  await openNameChanger(f);
  await screen.ask('status');
  const [state, , , , checks, seconds] = screen.last('status');
  assert.deepEqual([state, checks, seconds], [200, 250, 600], 'a session: 250 checks, 10 minutes');
  for (const [name, code] of [['Bob!', 2], ['Carol', 1], ['Moderator', 3], ['Queen of Art', 0]]) {
    await screen.ask('check', name);
    const result = screen.last('check');
    assert.equal(result[0], 200, name);
    assert.equal(result[3], code, `${name}: availability code`);
    assert.equal(result[4], code === 0, `${name}: available`);
  }
  assert.deepEqual(screen.last('check').slice(5), [4, 250], 'four checks used of 250');
  await screen.ask('claim', 'Queen of Art');
  assert.deepEqual(screen.last('claim'), [200, 0, '', 0], 'claim_result success');
  assert.equal(f.who.getDisplayName(), 'Queen of Art');
  assert.equal(f.who.getUsername(), 'Alice', 'the login account is unchanged');
  assert.deepEqual(events.map(event => event.type), ['display-names:changed']);
  DisplayNames.reset();
  assert.equal(DisplayNames.nameOf('Alice'), 'Queen of Art', 'the registry reloads the new name');

  await screen.ask('check', 'Second');
  assert.deepEqual(screen.last('check').slice(0, 5),
    [403, 7, 'You can change your display name again in 28 days.', 0, true], 'available, but not eligible now');
  await screen.ask('claim', 'Second');
  assert.deepEqual(screen.last('claim').slice(0, 2), [403, 7]);
  assert.equal(f.who.getDisplayName(), 'Queen of Art');
});

test('End session, closing the screen and the session running out all end it', async t => {
  const f = nativePlayer(t);
  const screen = nameScreen(t, f);
  await openNameChanger(f);
  await screen.ask('status');
  await screen.ask('cancel');
  assert.deepEqual(screen.replies.slice(-3).map(reply => [reply.op, reply.result[0]]),
    [['cancel', 1], ['status', 0], ['cancel', 0]], 'disconnecting, then back to the first panel');
  await screen.ask('check', 'Wonderland');
  assert.equal(screen.last('check')[0], 429, 'no session, no checks');

  await screen.ask('status');
  PluginManager.emitCustomEvent('interface:closed', { player: f.who, interfaceId: 980 });
  await screen.ask('claim', 'Wonderland');
  assert.equal(screen.last('claim')[0], 429, 'closing the screen ends the session');

  config['DisplayName:sessionMinutes'] = 1;
  await screen.ask('status');
  const realNow = Date.now;
  t.mock.method(Date, 'now', () => realNow() + 61_000);
  await screen.ask('check', 'Wonderland');
  assert.equal(screen.last('check')[0], 429, 'the session ran out');
  assert.equal(f.who.getDisplayName(), 'Alice');
  assert.equal(events.length, 0);
});

test('an account shows its login name until it picks another', () => {
  assert.equal(DisplayNames.nameOf('Alice'), 'Alice');
  assert.equal(DisplayNames.nameOf('big_bob'), 'big bob');
  assert.equal(DisplayNames.resolve('Alice'), 'alice');
  assert.equal(DisplayNames.previousNameOf('Alice'), '');
});

test('a change is shown, survives a restart, and keeps the old name for its owner', () => {
  const now = Date.now();
  DisplayNames.set('Bob', 'Zed', now, HOLD);
  assert.equal(DisplayNames.nameOf('bob'), 'Zed');
  assert.equal(DisplayNames.previousNameOf('bob', now + 1), 'Bob', 'the login name, for friends lists');
  DisplayNames.set('Bob', 'Zed Two', now + 1, HOLD);
  DisplayNames.reset(); // a restart reads the file again
  assert.equal(DisplayNames.nameOf('BOB'), 'Zed Two');
  assert.equal(DisplayNames.previousNameOf('bob', now + 2), 'Zed');
  assert.equal(DisplayNames.ownerOf('zed', now + 2), 'bob');
  // Typed by a friend: the new name, and the names it gave up while they are held.
  assert.equal(DisplayNames.resolve('zed_two', now + 2), 'bob');
  assert.equal(DisplayNames.resolve('ZED', now + 2), 'bob');
  assert.equal(DisplayNames.resolve('bob', now + 2), 'bob');
  // The holds run out: the login name no longer finds an account showing another name.
  assert.equal(DisplayNames.resolve('bob', now + HOLD + 2), undefined);
  assert.equal(DisplayNames.resolve('zed_two', now + HOLD + 2), 'bob');
  assert.equal(DisplayNames.ownerOf('zed', now + HOLD + 2), undefined);
  assert.equal(DisplayNames.previousNameOf('bob', now + HOLD + 1), '');
  assert.equal(DisplayNames.refusal('Alice', 'Zed', now + HOLD + 1), null);
});

test('names are the same name whatever their case, underscores or spaces', () => {
  const now = Date.now();
  DisplayNames.set('Bob', 'Big Zed', now, HOLD);
  for (const name of ['big zed', 'BIG_ZED', '  Big   Zed ', 'big_ zed']) {
    assert.equal(DisplayNames.refusal('Alice', name, now), 'That name is not available.', name);
  }
});

test("nobody takes another account's login name, display name or held name, online or not", () => {
  const now = Date.now();
  DisplayNames.set('Bob', 'Zed', now, HOLD);
  DisplayNames.set('Bob', 'Zed Two', now, HOLD);
  const taken = 'That name is not available.';
  assert.equal(DisplayNames.refusal('Alice', 'Carol', now), taken, 'an offline login name');
  assert.equal(DisplayNames.refusal('Alice', 'bob', now), taken, "a renamed account's login name");
  assert.equal(DisplayNames.refusal('Alice', 'Zed Two', now), taken, 'a display name');
  assert.equal(DisplayNames.refusal('Alice', 'Zed', now), taken, 'a held name');
  online.add('newbie');
  assert.equal(DisplayNames.refusal('Alice', 'Newbie', now), taken, 'a new account online, not saved yet');
  assert.equal(DisplayNames.refusal('Alice', 'Free Name', now), null);
});

test("a name a live bot shows can't be taken by ::displayname or a new account, though it is never saved", (t) => {
  const now = Date.now();
  // A bot online, and one still in the add queue, each showing a generated name for its own login name.
  const bot = player('PvpBot1'); bot.displayName = 'Gilded Owl';
  const queued = player('PvpBot2'); queued.displayName = 'Quiet Fern';
  t.mock.method(World, 'getPlayers', () => [bot]);
  t.mock.method(World, 'getAddPlayerQueue', () => [queued]);
  const taken = 'That name is not available.';
  assert.equal(DisplayNames.refusal('Alice', 'Gilded Owl', now), taken, 'the online bot shows it');
  assert.equal(DisplayNames.refusal('Alice', 'quiet_fern', now), taken, 'the queued bot shows it');
  assert.equal(DisplayNames.refusal('PvpBot1', 'Gilded Owl', now), null, 'the bot itself keeps it');
  assert.equal(DisplayNames.shownByAnother('Gilded Owl', 'NewAccount'), true, 'a new account is refused the same way');
  const alice = player('Alice');
  run(alice, 'displayname Gilded Owl');
  assert.equal(alice.last(), taken, '::displayname refuses it');
  assert.equal(prompts.length, 0, 'no confirmation is offered');
});

test('an account may go back to its login name or take back a held name', () => {
  const now = Date.now();
  DisplayNames.set('Bob', 'Zed', now, HOLD);
  DisplayNames.set('Bob', 'Zed Two', now, HOLD);
  assert.equal(DisplayNames.refusal('Bob', 'BOB', now), null);
  assert.equal(DisplayNames.refusal('Bob', 'zed', now), null);
  DisplayNames.set('Bob', 'Zed', now, HOLD);
  assert.equal(DisplayNames.nameOf('Bob'), 'Zed');
  // Taking it back ends that hold; the name just left is held instead.
  assert.deepEqual(DisplayNames.entryOf('Bob').held.map((held) => held.name), ['Bob', 'Zed Two']);
  // So does going back to the login name.
  DisplayNames.set('Bob', 'Bob', now, HOLD);
  assert.deepEqual(DisplayNames.entryOf('Bob').held.map((held) => held.name), ['Zed Two', 'Zed']);
  assert.equal(DisplayNames.resolve('bob', now), 'bob');
});

test('a name logging in right now is taken', () => {
  ClientConnection.pendingNames.add('new_guy');
  try {
    assert.equal(DisplayNames.refusal('Alice', 'New Guy'), 'That name is not available.');
  } finally {
    ClientConnection.pendingNames.delete('new_guy');
  }
});

test('a hold that ran out loses to the account showing that name now', () => {
  const now = Date.now();
  DisplayNames.set('Bob', 'Zed', now, HOLD);
  DisplayNames.set('Bob', 'Zed Two', now, HOLD);
  DisplayNames.set('Alice', 'Zed', now + HOLD + 1, HOLD);
  DisplayNames.reset();
  assert.equal(DisplayNames.ownerOf('Zed', now + HOLD + 2), 'alice');
  assert.equal(DisplayNames.resolve('Zed', now + HOLD + 2), 'alice');
});

test('a write that fails changes nothing', () => {
  const now = Date.now();
  DisplayNames.set('Bob', 'Zed', now, HOLD);
  fs.mkdirSync(path.join(dir, 'display-names.json.tmp')); // the temporary file can't be written
  assert.throws(() => DisplayNames.set('Bob', 'Other', now + 1, HOLD));
  assert.equal(DisplayNames.nameOf('Bob'), 'Zed');
  assert.equal(DisplayNames.ownerOf('Other', now + 1), undefined);
  assert.equal(DisplayNames.ownerOf('Zed', now + 1), 'bob');
});

test('::displayname with no name shows the current one', () => {
  const alice = player('Alice');
  run(alice, 'displayname');
  assert.deepEqual(alice.messages, ['Your display name is Alice.', 'Change it with ::displayname <new name>.']);
  assert.equal(prompts.length, 0);
});

test('::displayname asks first, then changes the name and tells the social plugins', () => {
  const alice = player('Alice');
  run(alice, '::displayname   Queen_of   Art ');
  assert.equal(alice.last(), "You won't be able to change it again for 28 days.");
  assert.equal(prompts[0].title, 'Change your display name to Queen of Art?');
  assert.equal(alice.getDisplayName(), 'Alice', 'nothing changes before the answer');
  prompts.pop().answer('Yes');
  assert.equal(alice.getDisplayName(), 'Queen of Art');
  assert.equal(DisplayNames.nameOf('alice'), 'Queen of Art');
  assert.equal(alice.last(), 'Your display name is now Queen of Art.');
  assert.deepEqual(events, [{ type: 'display-names:changed', player: alice, previous: 'Alice', name: 'Queen of Art' }]);
});

test('answering No changes nothing', () => {
  const alice = player('Alice');
  change(alice, 'Wonderland', 'No');
  assert.equal(alice.getDisplayName(), 'Alice');
  assert.equal(DisplayNames.entryOf('Alice'), undefined);
  assert.equal(events.length, 0);
});

test('names that break the rules are refused before any prompt', () => {
  const alice = player('Alice');
  const cases = [
    ['Thirteen Char', 'Display names can be at most 12 characters long.'],
    ['Bob!', 'Display names can only use letters, numbers and spaces.'],
    ['Ali-ce', 'Display names can only use letters, numbers and spaces.'],
    ['<img=1>', 'Display names can only use letters, numbers and spaces.'],
    ['Modern Art', 'Display names can\'t contain "mod".'],
    ['Big M od', 'Display names can\'t contain "mod".'],
    ['Alice', 'That is already your display name.'],
    ['Carol', 'That name is not available.'],
  ];
  for (const [name, message] of cases) {
    run(alice, `displayname ${name}`);
    assert.equal(alice.last(), message, name);
  }
  assert.equal(prompts.length, 0);
  // Twelve characters, digits, and a change of capitals on one's own name are all fine.
  change(alice, 'Twelve Chars');
  change(player('Bob'), '123');
  change(player('Carol'), 'cAROL');
  assert.equal(DisplayNames.nameOf('Carol'), 'cAROL');
});

test('staff may use "mod"', () => {
  const dave = player('Mod Dave', { staff: true });
  change(dave, 'Mod Davey');
  assert.equal(dave.getDisplayName(), 'Mod Davey');
});

test('a second change waits out the cooldown, which the world can set', () => {
  const alice = player('Alice');
  change(alice, 'First');
  run(alice, 'displayname Second');
  assert.equal(alice.last(), 'You can change your display name again in 28 days.');
  run(alice, 'displayname');
  assert.equal(alice.last(), 'You can change it again in 28 days.');
  // Even going back to the name just left.
  run(alice, 'displayname Alice');
  assert.equal(alice.last(), 'You can change your display name again in 28 days.');
  const entry = DisplayNames.entryOf('Alice');
  entry.changedAt -= 27 * DAY + 1;
  run(alice, 'displayname Second');
  assert.equal(alice.last(), 'You can change your display name again in 1 day.');
  config['DisplayName:cooldownDays'] = 0;
  change(alice, 'Second');
  assert.equal(alice.getDisplayName(), 'Second');
});

test('a name taken while the prompt was open is refused at Yes', () => {
  const alice = player('Alice');
  const bob = player('Bob');
  run(alice, 'displayname Contested');
  run(bob, 'displayname Contested');
  const [alicePrompt, bobPrompt] = prompts.splice(0);
  bobPrompt.answer('Yes');
  assert.equal(bob.getDisplayName(), 'Contested');
  alicePrompt.answer('Yes');
  assert.equal(alice.last(), 'That name is not available.');
  assert.equal(alice.getDisplayName(), 'Alice');
  assert.equal(DisplayNames.ownerOf('Contested'), 'bob');
});

test('answering Yes twice changes the name once', () => {
  const alice = player('Alice');
  run(alice, 'displayname Once');
  const prompt = prompts.pop();
  prompt.answer('Yes');
  prompt.answer('Yes');
  assert.equal(alice.last(), 'That is already your display name.');
  assert.equal(events.length, 1);
});

test('the held name stays with its owner and the others are told no', () => {
  const alice = player('Alice');
  const bob = player('Bob');
  config['DisplayName:cooldownDays'] = 0;
  change(bob, 'Zed');
  change(bob, 'Zed Two');
  run(alice, 'displayname Zed');
  assert.equal(alice.last(), 'That name is not available.');
  change(bob, 'Zed');
  assert.equal(bob.getDisplayName(), 'Zed');
});

test('a write that fails leaves the old name and says so', () => {
  const alice = player('Alice');
  fs.mkdirSync(path.join(dir, 'display-names.json.tmp'));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    change(alice, 'Unsaved');
  } finally {
    console.error = original;
  }
  assert.equal(alice.last(), 'Your display name could not be changed. Please try again later.');
  assert.equal(alice.getDisplayName(), 'Alice');
  assert.equal(events.length, 0);
  assert.equal(errors.length, 1);
});

test('a name belonging to an account character is in use even without a save', () => {
  const { Accounts } = require('../dist/game/entity/impl/player/Accounts');
  Accounts.reset(); Accounts.ensure('Owner', 1); Accounts.addCharacter('owner', 'Unentered', 2);
  GameConstants.PLAYER_PERSISTENCE = { ...GameConstants.PLAYER_PERSISTENCE, exists: () => false };
  assert.equal(DisplayNames.loginNameInUse('unentered'), true);
  assert.equal(DisplayNames.refusal('someone', 'Unentered'), 'That name is not available.');
  assert.equal(DisplayNames.loginNameInUse('nobody'), false);
});
