'use strict';
// Nearly every quest refreshes the quest list from its login hook, so one login rebuilt and
// sent the whole list about 140 times. During login the list is sent once, after the login
// bootstrap; outside login a refresh still sends at once.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const hooks = { login: [], custom: new Map(), logout: [] };
const api = new Proxy({
  core: { CacheDefinitions: {
    getDbColumns: () => ['id', 'displayname'],
    getDbColumn: (_table, name) => name,
    getDbTableRows: () => [[16, 'Test Quest One'], [55, 'Test Quest Two']].map(([id, name], i) =>
      ({id: 3000+i, column: key => key === 'id' ? [id] : key === 'displayname' ? [name] : []})),
  } },
  persistAttribute() {},
  onPlayerLogin: (handler) => hooks.login.push(handler),
  onPlayerLogout: (handler) => hooks.logout.push(handler),
  onCustomEvent: (name, handler) => {
    if (!hooks.custom.has(name)) hooks.custom.set(name, []);
    hooks.custom.get(name).push(handler);
  },
  emitCustomEvent(name, event) { for (const handler of hooks.custom.get(name) ?? []) handler(event); },
}, { get: (target, key) => target[key] ?? (() => {}) });

const runtime = require('../plugins/quests/QuestRuntime');
runtime.registerQuest(api, { key: 'test_quest_one', name: 'Test Quest One', varpId: 29, questPoints: 1 });
runtime.registerQuest(api, { key: 'test_quest_two', name: 'Test Quest Two', varpId: 30, questPoints: 1 });

function fakePlayer() {
  const attributes = new Map();
  const sent = { lists: 0, events: [] };
  const sender = new Proxy({
    sendConfig: (id) => { if (id === 101) sent.lists++; return sender; },
    sendInterfaceFlagsRange: (...args) => { sent.events.push(args); return sender; },
    getVarbit: () => 0,
    getVarp: () => 0,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  return {
    sent,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getSkillManager: () => ({ getMaxLevel: () => 1, getMaxLevels: () => 1, getCombatLevel: () => 3 }),
    isPlayerBot: () => false,
  };
}

function login(player, refreshesDuringLogin) {
  for (const handler of hooks.login) handler({ player });
  player.sent.lists = 0; // Ignore the independent character-summary header send.
  for (let i = 0; i < refreshesDuringLogin; i++) runtime.refreshQuestList(player);
}

test('a login sends the quest list once, after the bootstrap, however many quests refresh it', () => {
  const player = fakePlayer();
  login(player, 3);
  assert.equal(player.sent.lists, 0, 'no list is sent while the login hooks run');
  api.emitCustomEvent('player:bootstrap-complete', { player });
  assert.equal(player.sent.lists, 1, 'one list after the login bootstrap');
});

test('outside login a refresh sends the list at once', () => {
  const player = fakePlayer();
  login(player, 1);
  api.emitCustomEvent('player:bootstrap-complete', { player });
  runtime.refreshQuestList(player);
  assert.equal(player.sent.lists, 2, 'the later refresh is not held');
});

test('a login with no refreshes sends no extra list', () => {
  const player = fakePlayer();
  login(player, 0);
  api.emitCustomEvent('player:bootstrap-complete', { player });
  assert.equal(player.sent.lists, 0);
});


test('native row events coalesce once at login and reapply only when the tab remounts', () => {
  const player = fakePlayer();
  login(player, 20);
  assert.equal(player.sent.events.length, 0);
  api.emitCustomEvent('player:bootstrap-complete', { player });
  const events = player.sent.events.slice();
  assert.equal(events.length, 1, 'one captured native range enables OP1–5');
  runtime.refreshQuestList(player);
  runtime.refreshQuestList(player);
  assert.deepEqual(player.sent.events, events, 'stage/stat updates do not repeat stable events');
  api.emitCustomEvent('quest:list-refresh', { player });
  assert.equal(player.sent.events.length, 2, 'a remount reapplies the native events');
});
