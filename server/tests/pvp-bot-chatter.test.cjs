const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { Skill } = require('../dist/game/model/Skill');
const { Task } = require('../dist/game/task/Task');
const { TaskManager } = require('../dist/game/task/TaskManager');
const Chatter = require('../plugins/bots/behaviours/pvp/PvpChatter.PlayerBots');

function harness(t) {
  const players = [];
  const events = new Map();
  const tasks = [];
  let startup;
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  Chatter.registerPvpChatter({
    core: { PrayerHandler, Skill, Task,
      TaskManager: { submit(task) { tasks.push(task); TaskManager.submit(task); } },
      World: { getNearbyPlayersForUpdate: () => players } },
    onCustomEvent: (name, handler) => events.set(name, handler),
    onPlayerProcess: () => assert.fail('the world skips player-process hooks for bots'),
    onServerStartup: handler => { startup = handler; },
  });
  startup();
  t.after(() => {
    for (const player of players) player.registered = false;
    TaskManager.process();
    for (const task of tasks) task.stop();
    TaskManager.process();
  });
  function player(bot = true) {
    const actor = {
      hp: 100, maxHp: 100, prayers: [], messages: [], target: null, attacker: null,
      dying: false, teleporting: false, registered: true,
      isPlayer: () => true,
      isPlayerBot: () => bot,
      isRegistered: () => actor.registered,
      isDyingReturn: () => actor.dying,
      isTeleportingReturn: () => actor.teleporting,
      getHitpoints: () => actor.hp,
      getSkillManager: () => ({ getMaxLevel: () => actor.maxHp }),
      getPrayerActive: () => actor.prayers,
      getCombat: () => ({ getTarget: () => actor.target, getAttacker: () => actor.attacker }),
      forceChat: line => actor.messages.push(line),
    };
    players.push(actor);
    return actor;
  }
  const emit = (name, event) => events.get(name)(event);
  function attack(attacker, target) {
    attacker.target = target;
    target.attacker = attacker;
    emit('combat:attack-started', { attacker, target });
  }
  return { player, emit, attack, process: () => TaskManager.process(), advance: ms => { now += ms; } };
}

test('fight openers roll 50% once per fight, for initiating and defending bots', t => {
  const h = harness(t);
  let value = 0;
  t.mock.method(Math, 'random', () => value);
  for (const roll of [0, 0.499999, 0.5, 0.999999]) {
    value = roll;
    const bot = h.player();
    const human = h.player(false);
    h.attack(human, bot);
    assert.equal(bot.messages.length, roll < 0.5 ? 1 : 0);
    if (bot.messages.length) assert.ok(Chatter.START_LINES.includes(bot.messages[0]));
    h.attack(bot, human);
    h.attack(human, bot);
    assert.equal(bot.messages.length, roll < 0.5 ? 1 : 0, 'reissuing attacks never rerolls the opener');
    assert.deepEqual(human.messages, []);
  }
});

test('random chatter waits 9 to 24 seconds and stops when combat ends', t => {
  const h = harness(t);
  let value = 0;
  t.mock.method(Math, 'random', () => value);
  const bot = h.player(), human = h.player(false);
  h.attack(bot, human);
  bot.messages.length = 0;
  h.advance(8999);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
  h.advance(1);
  value = 0.999999;
  h.process(bot);
  assert.deepEqual(bot.messages, [Chatter.CHATTER_LINES.at(-1)]);
  h.advance(23999);
  h.process(bot);
  assert.equal(bot.messages.length, 1);
  h.advance(1);
  h.process(bot);
  assert.equal(bot.messages.length, 2);
  bot.target = bot.attacker = null;
  h.advance(24000);
  h.process(bot);
  assert.equal(bot.messages.length, 2, 'no chatter after disengaging');
  value = 0;
  h.attack(bot, human);
  assert.equal(bot.messages.at(-1), Chatter.START_LINES[0], 'the next fight gets a fresh opener');
});

test('an opener and an opening protection-prayer reaction are both visible', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), human = h.player(false);
  human.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  h.attack(human, bot);
  assert.deepEqual(bot.messages, [Chatter.START_LINES[0]]);
  h.advance(1799);
  h.process(bot);
  assert.equal(bot.messages.length, 1);
  h.advance(1);
  h.process(bot);
  assert.deepEqual(bot.messages, [Chatter.START_LINES[0], Chatter.PRAYER_LINES[0]]);
  h.attack(bot, human);
  assert.equal(bot.messages.length, 2, 'ongoing protection prayer does not reroll on every attack');
});

test('the scheduled timer chats for both fighting bots and leaves idle bots quiet', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const first = h.player(), second = h.player(), idle = h.player();
  h.attack(first, second);
  first.messages.length = second.messages.length = 0;
  h.advance(8999);
  h.process();
  assert.deepEqual(first.messages, []);
  assert.deepEqual(second.messages, []);
  h.advance(1);
  h.process();
  assert.deepEqual(first.messages, [Chatter.CHATTER_LINES[0]]);
  assert.deepEqual(second.messages, [Chatter.CHATTER_LINES[0]]);
  assert.deepEqual(idle.messages, []);
});

test('the scheduled timer clears a departed bot before it starts another fight', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), human = h.player(false);
  h.attack(bot, human);
  bot.messages.length = 0;
  bot.registered = false;
  h.advance(9000);
  h.process();
  assert.deepEqual(bot.messages, []);
  bot.registered = true;
  h.attack(bot, human);
  assert.deepEqual(bot.messages, [Chatter.START_LINES[0]], 'a returning bot starts a fresh fight');
  h.advance(8999);
  h.process();
  assert.equal(bot.messages.length, 1, 'the new fight gets its own timer');
});

test('prayer reactions roll 50% only for an opponent activating a protection prayer', t => {
  const h = harness(t);
  let value = 0.5;
  t.mock.method(Math, 'random', () => value);
  const bot = h.player(), opponent = h.player(), bystander = h.player(false);
  h.attack(bot, opponent);
  value = 0;
  for (const prayerId of [PrayerHandler.PIETY, PrayerHandler.PROTECT_ITEM, PrayerHandler.SMITE,
    PrayerHandler.RETRIBUTION, PrayerHandler.REDEMPTION]) {
    opponent.prayers[prayerId] = true;
    h.emit('prayer:activated', { player: opponent, prayerId });
    opponent.prayers[prayerId] = false;
  }
  h.emit('prayer:activated', { player: opponent, prayerId: PrayerHandler.PROTECT_FROM_MAGIC });
  bystander.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  h.emit('prayer:activated', { player: bystander, prayerId: PrayerHandler.PROTECT_FROM_MAGIC });
  assert.deepEqual(bot.messages, []);
  for (const prayerId of PrayerHandler.PROTECTION_PRAYERS) {
    opponent.prayers[prayerId] = true;
    h.emit('prayer:activated', { player: opponent, prayerId });
    opponent.prayers[prayerId] = false;
  }
  assert.deepEqual(bot.messages, Array(3).fill(Chatter.PRAYER_LINES[0]));
  assert.deepEqual(opponent.messages, [], 'a bot never reacts to its own prayer');
  value = 0.5;
  opponent.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  h.emit('prayer:activated', { player: opponent, prayerId: PrayerHandler.PROTECT_FROM_MAGIC });
  assert.equal(bot.messages.length, 3);
});

test('starting a fight against Smite or other non-protection prayers never queues a prayer reaction', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  for (const prayerId of [PrayerHandler.SMITE, PrayerHandler.RETRIBUTION, PrayerHandler.REDEMPTION,
    PrayerHandler.PIETY, PrayerHandler.PROTECT_ITEM]) {
    const bot = h.player(), human = h.player(false);
    human.prayers[prayerId] = true;
    h.attack(bot, human);
    h.advance(1800);
    h.process();
    assert.deepEqual(bot.messages, [Chatter.START_LINES[0]], String(prayerId));
  }
});

test('opening prayer and greeting chances are independent', t => {
  const h = harness(t);
  let rolls = [];
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0.5);
  const first = h.player(), firstHuman = h.player(false);
  firstHuman.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  rolls = [0, 0.5, 0, 0]; // timer, failed greeting, successful prayer, phrase
  h.attack(first, firstHuman);
  assert.deepEqual(first.messages, [Chatter.PRAYER_LINES[0]]);
  const second = h.player(), secondHuman = h.player(false);
  secondHuman.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  rolls = [0, 0, 0, 0.5]; // timer, successful greeting, phrase, failed prayer
  h.attack(second, secondHuman);
  h.advance(1800);
  h.process(second);
  assert.deepEqual(second.messages, [Chatter.START_LINES[0]]);
});

test('opening prayer reaction is cancelled if the opponent switches from protection to Smite', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), human = h.player(false);
  human.prayers[PrayerHandler.PROTECT_FROM_MELEE] = true;
  h.attack(bot, human);
  human.prayers[PrayerHandler.PROTECT_FROM_MELEE] = false;
  human.prayers[PrayerHandler.SMITE] = true;
  h.advance(1800);
  h.process(bot);
  assert.deepEqual(bot.messages, [Chatter.START_LINES[0]]);
});

test('safing reactions use pre-eat HP, include exactly 75%, and roll 50%', t => {
  const h = harness(t);
  let value = 0.5;
  t.mock.method(Math, 'random', () => value);
  const bot = h.player(), opponent = h.player();
  h.attack(bot, opponent);
  value = 0;
  for (const hitpointsBefore of [0, 74, undefined, NaN]) {
    h.emit('food:eaten', { player: opponent, hitpointsBefore });
  }
  assert.deepEqual(bot.messages, [], 'healing above 75% does not count as eating above 75%');
  for (const hitpointsBefore of [75, 99, 100]) {
    h.emit('food:eaten', { player: opponent, hitpointsBefore });
  }
  assert.deepEqual(bot.messages, Array(3).fill(Chatter.SAFING_LINES[0]));
  value = 0.5;
  h.emit('food:eaten', { player: opponent, hitpointsBefore: 100 });
  assert.equal(bot.messages.length, 3);
  assert.deepEqual(opponent.messages, []);
});

test('every bot fighting the eater can react; nearby bystanders cannot', t => {
  const h = harness(t);
  let value = 0.5;
  t.mock.method(Math, 'random', () => value);
  const first = h.player(), second = h.player(), bystander = h.player(), human = h.player(false);
  h.attack(first, human);
  h.attack(second, human);
  value = 0;
  h.emit('food:eaten', { player: human, hitpointsBefore: 75 });
  assert.deepEqual(first.messages, [Chatter.SAFING_LINES[0]]);
  assert.deepEqual(second.messages, [Chatter.SAFING_LINES[0]]);
  assert.deepEqual(bystander.messages, []);
});

test('death and kill lines roll independently, including bot-versus-bot deaths', t => {
  const h = harness(t);
  let rolls = [];
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0.99);
  for (const [values, deathCount, killCount] of [
    [[0, 0, 0.5], 1, 0], [[0.5, 0, 0], 0, 1], [[0, 0, 0, 0], 1, 1], [[0.5, 0.5], 0, 0],
  ]) {
    const victim = h.player(), killer = h.player();
    h.attack(killer, victim);
    victim.hp = 0;
    victim.dying = true;
    rolls = [...values];
    h.emit('player:dying', { player: victim, killer });
    assert.equal(victim.messages.length, deathCount);
    assert.equal(killer.messages.length, killCount);
    if (deathCount) assert.ok(Chatter.DEATH_LINES.includes(victim.messages[0]));
    if (killCount) assert.ok(Chatter.KILL_LINES.includes(killer.messages[0]));
    h.advance(24000);
    h.process(victim);
    h.process(killer);
    assert.equal(victim.messages.length, deathCount, 'death lines are not overwritten by random chatter');
    assert.equal(killer.messages.length, killCount);
    victim.hp = 100;
    victim.dying = false;
    rolls = Array(6).fill(0);
    h.attack(killer, victim);
    assert.equal(victim.messages.at(-1), Chatter.START_LINES[0], 'the respawned bot starts fresh');
    assert.equal(killer.messages.at(-1), Chatter.START_LINES[0], 'the survivor starts fresh too');
  }
  const human = h.player(false), bot = h.player();
  human.hp = 0;
  rolls = [0, 0];
  h.emit('player:dying', { player: human, killer: bot });
  assert.deepEqual(human.messages, []);
  assert.deepEqual(bot.messages, [Chatter.KILL_LINES[0]], 'a bot also celebrates a player kill');
});

test('multiple opponents do not keep rerolling greetings or resetting the random timer', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), first = h.player(false), second = h.player(false);
  h.attack(bot, first);
  h.attack(second, bot);
  assert.deepEqual(bot.messages, Array(2).fill(Chatter.START_LINES[0]));
  for (let i = 0; i < 10; i++) {
    h.attack(bot, first);
    h.attack(second, bot);
  }
  assert.equal(bot.messages.length, 2);
  h.emit('food:eaten', { player: first, hitpointsBefore: 75 });
  h.emit('food:eaten', { player: second, hitpointsBefore: 75 });
  assert.deepEqual(bot.messages.slice(2), Array(2).fill(Chatter.SAFING_LINES[0]));
  h.advance(9000);
  h.process(bot);
  assert.equal(bot.messages.at(-1), Chatter.CHATTER_LINES[0]);
});

test('NPC fights, dead bots, and teleporting bots do not produce PvP chatter', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), human = h.player(false);
  const npc = { ...h.player(false), isPlayer: () => false };
  h.attack(bot, npc);
  h.advance(24000);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
  h.attack(bot, human);
  bot.messages.length = 0;
  bot.teleporting = true;
  h.advance(24000);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
  bot.teleporting = false;
  bot.hp = 0;
  h.attack(human, bot);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
});
