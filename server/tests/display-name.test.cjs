// Run after `yarn build`: node --test tests/display-name.test.cjs
// ::displayname and the DisplayNames registry: what other players see, apart from the login name.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { DisplayNames } = require('../dist/game/entity/impl/player/DisplayNames');
const { GameConstants } = require('../dist/game/GameConstants');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { World } = require('../dist/game/World');
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
  DisplayName.register({
    getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
    registerCommand: (name, handler) => { assert.equal(name, 'displayname'); command = handler; },
    emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
    sendMultiChatboxPrompt: (who, title, yes, onYes, no, onNo) => {
      prompts.push({ title, answer: (option) => (option === yes ? onYes : onNo)(who) });
      return true;
    },
  });
});

afterEach(() => {
  GameConstants.PLAYER_PERSISTENCE = originalPersistence;
  World.getPlayerByName = originalGetPlayerByName;
  delete process.env[DisplayNames.FILE_ENV];
  DisplayNames.reset();
  fs.rmSync(dir, { recursive: true, force: true });
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
  assert.deepEqual(events, [{ name: 'display-names:changed', player: alice, previous: 'Alice', name: 'Queen of Art' }]);
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
