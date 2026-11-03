const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { Skill } = require('../dist/game/model/Skill');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { Task } = require('../dist/game/task/Task');
const { TaskManager } = require('../dist/game/task/TaskManager');
const Chatter = require('../plugins/bots/behaviours/pvp/PvpChatter.PlayerBots');

test('getRandomLine selects from the requested category, including every RNG fallback', t => {
  let roll = 0;
  t.mock.method(Math, 'random', () => roll);
  for (const [category, lines] of Object.entries({
    chatter: Chatter.CHATTER_LINES, start: Chatter.START_LINES, prayer: Chatter.PRAYER_LINES,
    safing: Chatter.SAFING_LINES, kill: Chatter.KILL_LINES, death: Chatter.DEATH_LINES, rng: Chatter.RNG_LINES,
  })) {
    for (let index = 0; index < lines.length; index++) {
      roll = (index + 0.5) / lines.length;
      assert.equal(Chatter.getRandomLine(category), lines[index], category);
    }
  }
});

test('RNG flags choose splash or zero-hit lines without rolling, with splash taking priority', t => {
  t.mock.method(Math, 'random', () => assert.fail('flagged RNG lines must be deterministic'));
  assert.equal(Chatter.getRandomLine('rng', { isSplash: true }), 'Nice splash');
  assert.equal(Chatter.getRandomLine('rng', { isZero: true }), '0-0-0-0 nice RNG');
  assert.equal(Chatter.getRandomLine('rng', { isSplash: true, isZero: true }), 'Nice splash');
});

test('unmatched RNG data uses the random pool, while unknown categories return null', t => {
  t.mock.method(Math, 'random', () => 0.999999);
  for (const data of [undefined, null, {}, { isSplash: false, isZero: false }]) {
    assert.equal(Chatter.getRandomLine('rng', data), 'Tick ate that');
  }
  for (const category of ['unknown', 'constructor', 'toString']) {
    assert.equal(Chatter.getRandomLine(category), null);
  }
  assert.equal(Chatter.getRandomLine('start', { isSplash: true }), Chatter.START_LINES.at(-1));
});

function harness(t) {
  const players = [];
  const events = new Map();
  const tasks = [];
  let startup;
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  Chatter.registerPvpChatter({
    core: { PrayerHandler, Skill, Task, CombatType,
      CombatFactory: { getMethod: player => ({ type: () => player.combatType }) },
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
      hp: 100, maxHp: 100, prayers: [], messages: [], messageTimes: [], target: null, attacker: null,
      dying: false, teleporting: false, registered: true, combatType: CombatType.MELEE,
      isPlayer: () => true,
      isPlayerBot: () => bot,
      isRegistered: () => actor.registered,
      isDyingReturn: () => actor.dying,
      isTeleportingReturn: () => actor.teleporting,
      getHitpoints: () => actor.hp,
      getSkillManager: () => ({ getMaxLevel: () => actor.maxHp }),
      getPrayerActive: () => actor.prayers,
      getCombat: () => ({ getTarget: () => actor.target, getAttacker: () => actor.attacker }),
      forceChat: line => { actor.messages.push(line); actor.messageTimes.push(now); },
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

test('random chatter waits 15 to 30 seconds and stops when combat ends', t => {
  const h = harness(t);
  let value = 0;
  t.mock.method(Math, 'random', () => value);
  const bot = h.player(), human = h.player(false);
  h.attack(bot, human);
  bot.messages.length = 0;
  h.advance(14999);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
  h.advance(1);
  value = 0.999999;
  h.process(bot);
  assert.deepEqual(bot.messages, [Chatter.CHATTER_LINES.at(-1)]);
  h.advance(29999);
  h.process(bot);
  assert.equal(bot.messages.length, 1);
  h.advance(1);
  h.process(bot);
  assert.equal(bot.messages.length, 2);
  bot.target = bot.attacker = null;
  h.advance(30000);
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

test('Strength and Range questions stay in the roll but only match the opponent combat style', t => {
  const h = harness(t);
  let roll = 0.5;
  t.mock.method(Math, 'random', () => roll);
  const strength = ['Str lvl?', 'Strength level?'];
  const range = ['Range lvl?', 'Range level?'];
  const generic = Chatter.CHATTER_LINES.filter(line => !strength.includes(line) && !range.includes(line));
  for (const combatType of [CombatType.MELEE, CombatType.RANGED, CombatType.MAGIC, null]) {
    roll = 0.5;
    const bot = h.player(), opponent = h.player(false);
    opponent.combatType = combatType;
    h.attack(bot, opponent);
    for (let index = 0; index < Chatter.CHATTER_LINES.length; index++) {
      roll = (index + 0.5) / Chatter.CHATTER_LINES.length;
      h.advance(30000);
      h.process();
    }
    const seen = new Set(bot.messages);
    for (const line of strength) assert.equal(seen.has(line), combatType === CombatType.MELEE, line);
    for (const line of range) assert.equal(seen.has(line), combatType === CombatType.RANGED, line);
    for (const line of generic) assert.equal(seen.has(line), true, line);
    bot.registered = false;
    h.process();
  }
});

test('a queued question follows an opponent weapon switch during the message offset', t => {
  const h = harness(t);
  const rolls = [0, 0.5, 0, 0.5];
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
  const first = h.player(), second = h.player();
  h.attack(first, second);
  h.advance(15000);
  h.process();
  assert.deepEqual(first.messages, ['Str lvl?']);
  assert.deepEqual(second.messages, []);
  first.combatType = CombatType.RANGED;
  h.advance(1000);
  h.process();
  assert.deepEqual(second.messages, ['Range lvl?']);
  assert.equal(second.messageTimes[0] - first.messageTimes[0], 1000);
});

test('questions follow the current target when multiple opponents use different styles', t => {
  const h = harness(t);
  let roll = 0.5;
  t.mock.method(Math, 'random', () => roll);
  const bot = h.player(), melee = h.player(false), ranged = h.player(false);
  ranged.combatType = CombatType.RANGED;
  h.attack(bot, melee);
  h.attack(ranged, bot);
  roll = 0;
  h.advance(30000);
  h.process();
  assert.deepEqual(bot.messages, ['Str lvl?']);
  bot.target = ranged;
  h.advance(30000);
  h.process();
  assert.deepEqual(bot.messages, ['Str lvl?', 'Range lvl?']);
});

test('simultaneous random messages are one second apart and keep their combat cooldowns', t => {
  const h = harness(t);
  const rolls = [0, 0.5, 0, 0.5]; // Both timers use fifteen seconds; neither bot greets.
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
  const first = h.player(), second = h.player(), idle = h.player();
  h.attack(first, second);
  first.messages.length = second.messages.length = 0;
  h.advance(14999);
  h.process();
  assert.deepEqual(first.messages, []);
  assert.deepEqual(second.messages, []);
  h.advance(1);
  h.process();
  assert.deepEqual(first.messages, [Chatter.CHATTER_LINES[0]]);
  assert.deepEqual(second.messages, []);
  h.advance(999);
  h.process();
  assert.deepEqual(second.messages, []);
  h.advance(1);
  h.process();
  assert.deepEqual(second.messages, [Chatter.CHATTER_LINES[0]]);
  assert.equal(second.messageTimes[0] - first.messageTimes[0], 1000);
  h.advance(14000);
  h.process();
  assert.equal(first.messages.length, 2);
  assert.equal(second.messages.length, 1);
  h.advance(1000);
  h.process();
  assert.equal(second.messages.length, 2);
  assert.equal(second.messageTimes[1] - second.messageTimes[0], 15000);
  assert.deepEqual(idle.messages, []);
});

test('fight greetings are staggered only between bots sharing the fight', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const first = h.player(), second = h.player();
  h.attack(first, second);
  assert.deepEqual(first.messages, [Chatter.START_LINES[0]]);
  assert.deepEqual(second.messages, []);
  const other = h.player(), human = h.player(false);
  h.attack(other, human);
  assert.deepEqual(other.messages, [Chatter.START_LINES[0]], 'an unrelated fight is not delayed');
  h.advance(999);
  h.process();
  assert.deepEqual(second.messages, []);
  h.advance(1);
  h.process();
  assert.deepEqual(second.messages, [Chatter.START_LINES[0]]);
  assert.equal(second.messageTimes[0] - first.messageTimes[0], 1000);
});

test('server tick rounding keeps at least one second between alternating speakers', t => {
  const h = harness(t);
  const rolls = [0, 0.5, 0, 0.5];
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
  const first = h.player(), second = h.player();
  h.attack(first, second);
  h.advance(15000);
  h.process();
  h.advance(1200);
  h.process();
  h.emit('food:eaten', { player: second, hitpointsBefore: 75 });
  h.advance(600);
  h.process();
  assert.equal(first.messages.length, 1);
  h.advance(600);
  h.process();
  assert.equal(first.messages.at(-1), Chatter.SAFING_LINES[0]);
  assert.equal(first.messageTimes.at(-1) - second.messageTimes.at(-1), 1200);
});

test('queued messages are discarded when the speaker disconnects or switches to Smite', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const first = h.player(), second = h.player();
  first.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  h.attack(first, second);
  first.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = false;
  first.prayers[PrayerHandler.SMITE] = true;
  h.advance(1000);
  h.process();
  assert.deepEqual(second.messages, [Chatter.START_LINES[0]]);
  h.advance(1800);
  h.process();
  assert.deepEqual(second.messages, [Chatter.START_LINES[0]], 'no delayed complaint about Smite');

  const third = h.player(), fourth = h.player();
  h.attack(third, fourth);
  fourth.registered = false;
  h.advance(1000);
  h.process();
  assert.deepEqual(fourth.messages, [], 'no queued greeting after disconnect');
});

test('a delayed greeting remains visible before its queued protection-prayer reaction', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const first = h.player(), second = h.player();
  first.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  h.attack(first, second);
  h.advance(1000);
  h.process();
  assert.deepEqual(second.messages, [Chatter.START_LINES[0]]);
  h.advance(1799);
  h.process();
  assert.equal(second.messages.length, 1);
  h.advance(1);
  h.process();
  assert.deepEqual(second.messages, [Chatter.START_LINES[0], Chatter.PRAYER_LINES[0]]);
});

test('a protection-prayer reaction waiting on the offset is dropped if the opponent switches to Smite', t => {
  const h = harness(t);
  let roll = 0.5;
  t.mock.method(Math, 'random', () => roll);
  const first = h.player(), second = h.player();
  h.attack(first, second);
  roll = 0;
  first.prayers[PrayerHandler.PROTECT_FROM_MAGIC] = true;
  h.emit('prayer:activated', { player: first, prayerId: PrayerHandler.PROTECT_FROM_MAGIC });
  second.prayers[PrayerHandler.PROTECT_FROM_MELEE] = true;
  h.emit('prayer:activated', { player: second, prayerId: PrayerHandler.PROTECT_FROM_MELEE });
  assert.deepEqual(second.messages, [Chatter.PRAYER_LINES[0]]);
  assert.deepEqual(first.messages, []);
  second.prayers[PrayerHandler.PROTECT_FROM_MELEE] = false;
  second.prayers[PrayerHandler.SMITE] = true;
  h.advance(1000);
  h.process();
  assert.deepEqual(first.messages, []);
});

test('a dying bot speaks before the survivor even when another reaction just fired', t => {
  const h = harness(t);
  let roll = 0.5;
  t.mock.method(Math, 'random', () => roll);
  const victim = h.player(), killer = h.player();
  h.attack(killer, victim);
  roll = 0;
  h.emit('food:eaten', { player: victim, hitpointsBefore: 75 });
  victim.hp = 0;
  victim.dying = true;
  h.emit('player:dying', { player: victim, killer });
  assert.deepEqual(victim.messages, []);
  assert.deepEqual(killer.messages, [Chatter.SAFING_LINES[0]]);
  h.advance(1000);
  h.process();
  assert.deepEqual(victim.messages, [Chatter.DEATH_LINES[0]]);
  assert.equal(killer.messages.length, 1);
  h.advance(1000);
  h.process();
  assert.deepEqual(killer.messages, [Chatter.SAFING_LINES[0], Chatter.KILL_LINES[0]]);
  assert.equal(killer.messageTimes.at(-1) - victim.messageTimes[0], 1000);
});

test('the scheduled timer clears a departed bot before it starts another fight', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), human = h.player(false);
  h.attack(bot, human);
  bot.messages.length = 0;
  bot.registered = false;
  h.advance(15000);
  h.process();
  assert.deepEqual(bot.messages, []);
  bot.registered = true;
  h.attack(bot, human);
  assert.deepEqual(bot.messages, [Chatter.START_LINES[0]], 'a returning bot starts a fresh fight');
  h.advance(14999);
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
  assert.deepEqual(second.messages, []);
  h.advance(1000);
  h.process();
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
    h.advance(1000);
    h.process();
    assert.equal(victim.messages.length, deathCount);
    assert.equal(killer.messages.length, killCount);
    if (deathCount) assert.ok(Chatter.DEATH_LINES.includes(victim.messages[0]));
    if (killCount) assert.ok(Chatter.KILL_LINES.includes(killer.messages[0]));
    h.advance(30000);
    h.process(victim);
    h.process(killer);
    assert.equal(victim.messages.length, deathCount, 'death lines are not overwritten by random chatter');
    assert.equal(killer.messages.length, killCount);
    victim.hp = 100;
    victim.dying = false;
    rolls = Array(6).fill(0);
    h.attack(killer, victim);
    h.advance(1000);
    h.process();
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
  h.advance(15000);
  h.process(bot);
  assert.equal(bot.messages.at(-1), Chatter.CHATTER_LINES[0]);
});

test('NPC fights, dead bots, and teleporting bots do not produce PvP chatter', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const bot = h.player(), human = h.player(false);
  const npc = { ...h.player(false), isPlayer: () => false };
  h.attack(bot, npc);
  h.advance(30000);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
  h.attack(bot, human);
  bot.messages.length = 0;
  bot.teleporting = true;
  h.advance(30000);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
  bot.teleporting = false;
  bot.hp = 0;
  h.attack(human, bot);
  h.process(bot);
  assert.deepEqual(bot.messages, []);
});

for (const [name, botDamage, humanDamage, otherDamage, canEngage, taunts] of [
  ['bot keeps highest-damage credit', 80, 20, 0, true, []],
  ['human earns highest-damage credit', 20, 80, 0, true, ['You stole my kill!']],
  ['equal damage keeps the original bot credit', 20, 20, 0, true, []],
  ['a different human receives credit', 10, 20, 80, true, []],
  ['credited human cannot be engaged', 20, 80, 0, false, []],
]) {
  test(`stolen-kill reaction: ${name}`, t => {
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { Location } = require('../dist/game/model/Location');
    const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
    const { AvengeOpponentPolicy } = require('../plugins/bots/behaviours/policies/AvengeOpponentPolicy.PlayerBots');
    const player = (username, bot = false, x = 3200) => {
      const who = new Player(null, new Location(x, 3600, 0));
      who.setUsername(username); who.setPlayerBot(bot); who.setRegistered(true);
      return who;
    };
    const bot = player('bot', true), human = player('human'), victim = player('victim', true);
    const other = player('other-human', false, 3220);
    assert.equal(Wilderness.isIn(victim), true);
    const combat = victim.getCombat();
    combat.addDamage(bot, botDamage); combat.addDamage(human, humanDamage);
    if (otherDamage) combat.addDamage(other, otherDamage);
    // PlayerDeathTask snapshots contributions before clearing this victim's map.
    victim.__recentDeathDamagerEntries = combat.getRecentDamagerEntries();
    const killer = combat.getKiller(true);
    assert.equal(killer, otherDamage ? other : botDamage >= humanDamage ? bot : human);
    assert.deepEqual(combat.getRecentDamagerEntries(), []);
    const state = { pvp: {}, autonomy: { allowedAutonomousModes: ['pvp'] } };
    const policy = new AvengeOpponentPolicy({
      botStatesByName: new Map([[bot.getUsername(), state]]),
      api: { getAreaManager: () => ({}), getCombatFactory: () => ({}) },
    });
    const engage = t.mock.method(policy, 'engageImmediately', () => canEngage);
    const lines = [];
    t.mock.method(bot, 'forceChat', line => lines.push(line));
    policy.handle({ killer, victim, nowMs: 1000 });
    assert.equal(engage.mock.callCount(), 1, 'the same human contribution still triggers the reaction');
    assert.deepEqual(engage.mock.calls[0].arguments, [bot, state, human, 1000]);
    assert.deepEqual(lines, taunts);
  });
}
