const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const Pickpocket = require('../plugins/skills/thieving/Pickpocket.Thieving');
const attach = require('../plugins/skills/thieving/Blackjacking.Thieving');
const base = PluginManager.getCoreApi();
const tasks = [], log = [], listeners = new Map();
const seqs = { human_blunt_pound: 401, human_unconscious: 838, human_ready: 808 };
const core = { ...base, CacheDefinitions: { ...base.CacheDefinitions, getSeqId: (name) => seqs[name] }, World: { getNpcs: () => [] }, CombatFactory: { inCombat: () => false }, TaskManager: { submit: (task) => tasks.push(task) }, ItemDefinition: { forId: () => ({ getName: () => 'Maple blackjack(o)' }) } };
const api = { core, onNpcsInteraction() {}, onNpcInteraction() {}, onCustomEvent: (name, handler) => listeners.set(name, handler), emitCustomEvent: (name, event) => {
  if (name === 'quest:get-stage') event.stage = event.player.questStage;
  else listeners.get(name)?.(event);
} };
Pickpocket.register(api); attach(api);
const B = attach._test;
function event({ level = 65, stage = 9, id = core.NpcIdentifiers.MENAPHITE_THUG } = {}) {
  const player = {
    questStage: stage, getEquipment: () => ({ get: () => ({ getId: () => core.ItemIdentifiers.MAPLE_BLACKJACK_O_ }) }),
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }), getSkillManager: () => ({ getCurrentLevel: () => level, addExperiences: (_skill, amount) => log.push(['xp', amount]) }),
    getInventory: () => ({ isFull: () => true, getAmount: () => 100 }),
    performAnimation: (animation) => log.push(['player anim', animation.getId()]), sendMessage: (message) => log.push(message), isRegistered: () => true,
    getPacketSender: () => ({ sendTypedMessage: (_type, message) => log.push(`spam: ${message}`), sendSound: (id) => log.push(['sound', id]) }),
  };
  const npc = { isRegistered: () => true, getCombat: () => ({ reset() {}, getTarget: () => null, attack: () => log.push('attack') }), getMovementQueue: () => ({ reset() {} }), getTimers: () => ({ registers() {} }), forceChat: (message) => log.push(message), setFollowing(target) { this.following = target; }, getFollowing() { return this.following; }, performAnimation: (animation) => log.push(['npc anim', animation.getId()]) };
  return { player, npc, npcId: id, definition: { getName: () => id === core.NpcIdentifiers.MENAPHITE_THUG ? 'Menaphite Thug' : 'Bandit' } };
}
function withRandom(value, run) { const original = Math.random; Math.random = () => value; try { run(); } finally { Math.random = original; } }
function clear() { tasks.length = 0; log.length = 0; }
test("knockout chance uses each target's own chart; the blackjack's wood makes no difference", () => {
  const N = core.NpcIdentifiers;
  assert.deepEqual(B.knockoutChart(N.BANDIT_7), [80, 240], 'Bandit (Pollnivneach), measured over 31 million');
  assert.deepEqual(B.knockoutChart(N.BANDIT_10), [80, 240], 'the bearded bandit shares it');
  assert.deepEqual(B.knockoutChart(N.MENAPHITE_THUG), [78, 240], "Menaphite Thug, as its own page charts it");
  assert.deepEqual(B.knockoutChart(N.MENAPHITE_THUG_2), [78, 240]);
  // Mod Ash: "31% at level 1 ... 94% at level 99" is 79/256 and 241/256, so the thug's low is 78
  // (80 would be 81/256, 31.6%).
  assert.equal(B.successChance(78, 240, 1), 79 / 256);
  assert.equal(B.successChance(78, 240, 99), 241 / 256);
  assert.equal(B.successChance(78, 240, 45), 152 / 256);
  assert.equal(B.successChance(80, 240, 45), 153 / 256, 'a bandit is a little likelier at the same level');
});

test('a knockout rolls the target chart: at level 70 the thug fails where the bandit succeeds', () => {
  const between = 0.755; // between the thug's 193/256 and the bandit's 194/256
  clear(); const thug = event({ level: 70 }); withRandom(between, () => B.knockOut(thug));
  assert.equal(B.unconscious.has(thug.npc), false, 'thug 193/256: 0.755 misses');
  assert.ok(log.some((line) => String(line).includes('glances off')));
  clear(); const bandit = event({ level: 70, id: core.NpcIdentifiers.BANDIT_9 }); withRandom(between, () => B.knockOut(bandit));
  assert.equal(B.unconscious.has(bandit.npc), true, 'bandit 194/256: the same roll lands');
});
test('quest training, target family and target-specific levels gate the action', () => {
  clear(); assert.equal(B.ready(event({ stage: 0 })), false); assert.equal(B.ready(event({ level: 64 })), false);
  assert.equal(B.ready(event({ level: 45, id: core.NpcIdentifiers.BANDIT_9 })), true);
  assert.equal(B.ready(event({ level: 54, id: core.NpcIdentifiers.BANDIT_7 })), false); assert.equal(B.ready(event({ id: core.NpcIdentifiers.BANDIT })), false);
});
test('knockout grants 10 XP and exactly two guaranteed coin pickpockets before wakeup', () => {
  clear(); const e = event(); withRandom(0, () => B.knockOut(e));
  assert.ok(log.some((line) => Array.isArray(line) && line[0] === 'xp' && line[1] === 10));
  for (let index = 0; index < 2; index++) {
    const request = { ...e, target: B.targetFor(e.npcId), unconscious: false };
    B.pickpocketTarget(request); assert.equal(request.unconscious, true); assert.equal(request.target.pickpocketAnimation, 827); request.onAttempt();
  }
  const third = { ...e, target: B.targetFor(e.npcId), unconscious: false }; B.pickpocketTarget(third); assert.equal(third.unconscious, false);
  tasks.at(-1).execute(); assert.equal(B.unconscious.has(e.npc), false);
});
test('failed knockout starts combat unless a quick pickpocket or knockout interrupts it', () => {
  clear(); const e = event(); withRandom(1, () => B.knockOut(e)); tasks.at(-1).execute(); assert.ok(log.includes('attack'));
  clear(); const again = event(); withRandom(1, () => B.knockOut(again)); B.pickpocketTarget({ ...again, target: B.targetFor(again.npcId) }); tasks.at(-1).execute(); assert.ok(!log.includes('attack'));
  clear(); const retry = event(); withRandom(1, () => B.knockOut(retry)); const aggression = tasks.at(-1); withRandom(0, () => B.knockOut(retry)); aggression.execute(); assert.ok(!log.includes('attack'));
});
test('lure follows the player and stops after the lure window', () => {
  clear(); const e = event(); B.lure(e); assert.equal(e.npc.following, e.player); tasks.at(-1).execute(); assert.equal(e.npc.following, null);
});

test('cache bandit transforms keep Lure and Knock-Out after The Feud and use the right rewards', async (t) => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  const Runtime = require('../plugins/quests/QuestRuntime');
  t.mock.method(Runtime, 'refreshQuestList', () => {});
  let login;
  const questApi = new Proxy({ core: base, onPlayerLogin: (handler) => { login = handler; } }, { get: (object, name) => object[name] ?? (() => {}) });
  require('../plugins/quests/quests/TheFeud.Quest')(questApi);
  const values = new Map();
  let stage = 28;
  const player = { getAttribute: (key) => key === 'quest.the_feud.stage' ? stage : 0,
    getPacketSender: () => ({ sendVarbit: (id, value) => values.set(id, value) }),
  };
  login({ player });
  const vars = { getVarbit: (id) => values.get(id) ?? 0, getVarp: () => 0 };
  for (const [parent, level, xp] of [['feud_arabian_guard_multi', 55, 84.3], ['feud_arabian_guard2_multi', 45, 65]]) {
    const definition = CacheDefinitions.resolveNpc(CacheDefinitions.getNpcId(parent), vars);
    assert.ok(definition.actions.includes('Lure') && definition.actions.includes('Knock-Out'));
    const target = B.targetFor(definition.id);
    assert.deepEqual([target.level, target.xp], [level, xp]);
  }
  stage = 0;
  login({ player });
  assert.equal(values.get(340), 0, 'untrained players retain the ordinary NPC options');
});

test('as captured: the swing and its sound, then the smack and the snore a tick later; a glance and the strike a tick later', () => {
  clear(); const e = event(); withRandom(0, () => B.knockOut(e));
  assert.deepEqual(log.filter((line) => Array.isArray(line) && line[0] !== 'xp'), [['player anim', 401], ['sound', 1842]]);
  log.length = 0; tasks[0].execute();
  assert.deepEqual(log, ['spam: You smack the bandit over the head and render them unconscious.', 'Zzzzzz', ['npc anim', 838]]);
  log.length = 0; withRandom(0, () => B.knockOut(e));
  assert.deepEqual(log, ["I can't do that. They're unconscious."]);
  log.length = 0; tasks[1].execute();
  assert.deepEqual(log, ['Arghh my head.', ['npc anim', 808]], 'it wakes');
  clear(); const missed = event(); withRandom(1, () => B.knockOut(missed));
  assert.deepEqual(log.slice(-2), ["spam: Your blow only glances off the bandit's head.", "I'll kill you for that!"]);
  assert.equal(tasks.length, 1); tasks[0].execute(); assert.ok(log.includes('attack'), 'the strike comes a tick later');
});
