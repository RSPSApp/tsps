// Run after `yarn build`: node --test tests/thieving-ham-hideout.test.cjs
// The H.A.M. Hideout's concussions and jail door (plugins/skills/thieving/HamHideout.Thieving.js), through the real
// pickpocket's failure and the door hooks. Expected lines and ticks: rsprox 227/01723.txt (Leagues V) and the Wiki
// pages H.A.M. Member and Door (H.A.M. Hideout Jail).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, beforeEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Sounds } = require('../dist/game/Sounds');
const Thieving = require('../plugins/skills/Thieving.plugin');
const HamHideout = require('../plugins/skills/thieving/HamHideout.Thieving');

const core = PluginManager.getCoreApi();
const tasks = [];
const handlers = new Map();
const objectHooks = new Map();
Thieving.register({
  core: {
    ...core,
    CombatFactory: { inCombat: () => false, stunTicks: () => {} },
    TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
  },
  onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  emitCustomEvent: (name, request) => (handlers.get(name) ?? []).forEach((handler) => handler(request)),
  onObjectInteraction: (name, actions) => objectHooks.set(name, [...(objectHooks.get(name) ?? []), actions]),
  persistAttribute() {}, onPlayerLogin() {}, onPlayerLogout() {}, onServerStartup() {},
  onNpcDialogueVariant() {}, onNpcDialogueCondition() {}, onItemOnNpc() {},
  onNpcsInteraction() {}, onNpcInteraction() {}, onBeforeObjectInteraction() {}, onItemAction() {},
  log: () => {},
});
Sounds.sendSound = () => {};

/** What each tick sent the player, from the click (tick 0) on. */
let ticks = [];
const say = (line) => ticks[ticks.length - 1].push(line);
/** `count` ticks; `click` runs at the start of the first, as a click handled that tick. */
function tick(count = 1, click = () => {}) {
  for (let i = 0; i < count; i++) {
    ticks.push([]);
    if (i === 0) click();
    for (const task of [...tasks]) if (task.isRunning()) task.execute();
  }
}

/** A real player in the hideout, its packets and varbits recorded. */
function hamPlayer(t, at = [3165, 9634, 0], { thieving = 50, agility = 1 } = {}) {
  const player = new Player(null);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(player, 'isRegistered', () => true);
  player.setLocation(new core.Location(...at));
  const skills = player.getSkillManager();
  skills.setCurrentLevels(core.Skill.THIEVING, thieving, false);
  skills.setCurrentLevels(core.Skill.AGILITY, agility, false);
  const varbits = new Map();
  const sender = player.getPacketSender();
  t.mock.method(sender, 'getVarbit', (id) => varbits.get(id) ?? 0);
  t.mock.method(sender, 'sendVarbit', (id, value) => { varbits.set(id, value); say(`varbit ${id}=${value}`); return sender; });
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { say(`${type === core.ChatType.SPAM ? 'spam' : type}: ${text}`); return sender; });
  t.mock.method(sender, 'sendSound', (id) => { say(`sound ${id}`); return sender; });
  t.mock.method(sender, 'sendSubInterface', (_uid, id, _type, { postScripts }) => { say(`overlay ${id} ${postScripts[0].args.join(',')}`); return sender; });
  t.mock.method(sender, 'closeSubInterface', () => { say('close overlay'); return sender; });
  t.mock.method(player, 'sendMessage', (text) => say(`game: ${text}`));
  t.mock.method(player, 'performAnimation', (animation) => say(`anim ${animation.getId()}`));
  t.mock.method(player.getDialogueManager(), 'startDialogues', (chain) => say(`mesbox: ${chain.dialogues.get(0).getText()}`));
  t.mock.method(player, 'moveTo', (location) => { say(`move ${location.getX()},${location.getY()},${location.getZ()}`); player.setLocation(location); return player; });
  return { player, varbits };
}

function hamMember(at = [3166, 9634, 0]) {
  return {
    getId: () => core.NpcIdentifiers.H_A_M_MEMBER,
    getTimers: () => ({ registers: () => {} }),
    isRegistered: () => true,
    getLocation: () => new core.Location(...at),
    setPositionToFace: () => {},
    forceChat: () => {},
    performAnimation: () => {},
    getAttackAnim: () => 422,
  };
}

/** One failed pickpocket of a H.A.M. Member, through Pickpocket's own task, then `count` more ticks. */
function failPickpocket(player, count) {
  // `repeat`: a follow-up attempt, past the click's cooldown, as a fresh player's first click is.
  const event = { player, npc: hamMember(), npcId: core.NpcIdentifiers.H_A_M_MEMBER, definition: { getName: () => 'H.A.M. Member' }, repeat: true };
  Thieving._test.pickpocket(event);
  ticks = [[]];
  tick(count);
}

const failedAt = () => ticks.findIndex((lines) => lines.some((line) => line.includes("You fail to pick the man's pocket.")));

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

beforeEach(() => {
  tasks.length = 0;
  ticks = [[]];
});

test('the Wiki charts: the Agility avoid and the jail lock, try by try, with and without a lockpick', () => {
  const { chartChance, LOCK_CHARTS } = HamHideout._test;
  const percent = (level, chart) => +(chartChance(level, chart) * 100).toFixed(6);
  // H.A.M. Member: "Avoiding concussions using Agility" 0/254, about 0.39% at level 1 and 99.6% at 99.
  assert.equal(percent(1, [0, 254]), 0.390625);
  assert.equal(percent(99, [0, 254]), 99.609375);
  // Door (H.A.M. Hideout Jail): 4.296875% to 27.734375% at level 1 bare-handed, 23.828125% to 47.265625% with a lockpick.
  assert.deepEqual(LOCK_CHARTS.bare.map((chart) => percent(1, chart)), [4.296875, 12.109375, 19.921875, 27.734375]);
  assert.deepEqual(LOCK_CHARTS.lockpick.map((chart) => percent(1, chart)), [23.828125, 31.640625, 39.453125, 47.265625]);
  assert.equal(percent(99, LOCK_CHARTS.bare[0]), 98.828125);
  // The 2nd to 4th bare tries reach certainty at 92, 84 and 75 (the page's chart).
  assert.deepEqual([[92, 1], [84, 2], [75, 3]].map(([level, at]) => chartChance(level, LOCK_CHARTS.bare[at])), [1, 1, 1]);
  assert.ok(chartChance(91, LOCK_CHARTS.bare[1]) < 1);
});

test("a H.A.M. Member's blow concusses a tick after the failure, counting up ham_thief", (t) => {
  t.mock.method(Math, 'random', () => 0.999999); // the pick fails
  HamHideout._test.setRandom(() => 0.999999); // no Agility avoid
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  failPickpocket(player, 4);
  const failed = failedAt();
  assert.ok(failed >= 0, `the pick failed: ${JSON.stringify(ticks)}`);
  // rsprox 227/01723.txt tick 8655-8657: the failure, the concussion a tick later, "You've been stunned!" after it.
  assert.deepEqual(ticks[failed + 1].filter((line) => !line.startsWith('anim')), ['varbit 235=1', 'spam: You feel slightly concussed from the blow.']);
  assert.ok(ticks[failed + 2].includes("spam: You've been stunned!"));
  assert.equal(varbits.get(235), 1);
});

test('Agility partly avoids the blow: no concussion counted (Wiki: H.A.M. Member)', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  HamHideout._test.setRandom(() => 0);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  failPickpocket(player, 3);
  assert.ok(ticks[failedAt() + 1].includes('spam: Your agility helps you partially avoid the blow.'));
  assert.equal(varbits.get(235), undefined, 'the count is untouched');
});

test('outside the hideout a H.A.M. Member\'s blow is only the stun', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  HamHideout._test.setRandom(() => 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t, [3166, 3250, 0]);
  failPickpocket(player, 3);
  assert.ok(ticks.flat().every((line) => !line.includes('concussed') && !line.includes('avoid the blow')));
  assert.equal(varbits.get(235), undefined);
});

test('the third concussion bundles the player out: the line, the fall and fade, the jail and the wake-up, as recorded', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  let rolls = [0.999999, 0]; // no Agility avoid, then the jail
  HamHideout._test.setRandom(() => rolls.shift() ?? 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  varbits.set(235, 2);
  failPickpocket(player, 14);
  const f = failedAt();
  const without = (lines, prefix) => lines.filter((line) => !line.startsWith(prefix));
  // rsprox 227/01723.txt ticks 8696-8705: failure (F), concussion 2->3 (F+1), the stun's line then the bundling (F+2),
  // the backwards fall and fade out (F+4), the move to the cell (F+8), ham_thief 3->0, the fall's animation reset, fade
  // in and the message box (F+9; the reset on all four wake-ups, ticks 8705, 8858, 8945 and 9032).
  assert.deepEqual(without(ticks[f + 1], 'anim'), ['varbit 235=3', 'spam: You feel slightly concussed from the blow.']);
  assert.deepEqual(ticks[f + 2].filter((line) => line.startsWith('spam')), ["spam: You've been stunned!", "spam: You're beaten unconscious and bundled out of the HAM Camp."]);
  assert.deepEqual(ticks[f + 4], [`anim ${core.CacheDefinitions.getSeqId('human_death_backwards')}`, 'overlay 174 0,255,0,0,50']);
  assert.deepEqual(ticks[f + 8], ['move 3185,9609,0']);
  assert.deepEqual(ticks[f + 9], ['varbit 235=0', 'anim -1', 'overlay 174 0,0,0,255,50', 'mesbox: You slowly wake up in an unknown place.']);
  assert.deepEqual(ticks[f + 11], ['close overlay']);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false, 'free to move once awake');
  assert.ok(tasks.every((task) => typeof task.tick === 'function'), "no task's own fields shadow Task.tick()");
});

test('bundled out the other way, the player wakes outside the hideout', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  HamHideout._test.setRandom(() => 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  varbits.set(235, 2);
  failPickpocket(player, 12);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3186, 3211, 0]);
});

const jailDoor = () => ({ getId: () => core.ObjectIdentifiers.DOOR_148, getLocation: () => new core.Location(3183, 9611, 0) });
const doorEvent = (player, option) => ({
  player, object: jailDoor(), clickType: option === 'Open' ? 1 : 5, handled: false,
  definition: { getInteractions: () => ['Open', null, null, null, 'Pick-lock'] },
});

test('the jail door never opens: Open says it is very secure, from either side', (t) => {
  for (const at of [[3183, 9610, 0], [3182, 9611, 0]]) {
    const { player } = hamPlayer(t, at);
    const event = doorEvent(player, 'Open');
    for (const handler of handlers.get('door:toggle')) handler(event);
    assert.equal(event.handled, true);
    assert.deepEqual(ticks[0], ['game: This door seems very secure.']);
    ticks = [[]];
  }
  // Pick-lock is left to its own hook.
  const { player } = hamPlayer(t, [3183, 9611, 0]);
  const pick = doorEvent(player, 'Pick-lock');
  for (const handler of handlers.get('door:toggle')) handler(pick);
  assert.equal(pick.handled, false);
});

test('Pick-lock from outside the cell does nothing but say how secure the door is (Wiki: not from outside)', (t) => {
  const { player } = hamPlayer(t, [3182, 9611, 0]);
  assert.equal(HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock')), true);
  assert.deepEqual(ticks[0], ['game: This door seems very secure.']);
  assert.equal(tasks.length, 0);
});

test('the jail lock: seven-tick tries, each failure numbing the fingers and raising the chart, then out through the door', (t) => {
  const rolls = [0.999999, 0.999999, 0.999999, 0.999999, 0]; // four failures, then the lock gives
  HamHideout._test.setRandom(() => rolls.shift());
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t, [3183, 9611, 0], { thieving: 18 });
  const pick = core.CacheDefinitions.getSeqId('human_lockedchest');
  assert.equal(HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock')), true);
  // rsprox 227/01723.txt ticks 8862-8878: the attempt line, the pick animation and its sound at once.
  // rsprox 227/01723.txt ticks 8721, 8864, 9074: the attempt line, the pick animation and 2402 twice at once.
  assert.deepEqual(ticks[0], ['spam: You attempt to pick the lock on the door.', `anim ${pick}`, 'sound 2402', 'sound 2402']);
  tick(6);
  // Six ticks on (ticks 8727, 8870): the animation reset, the failure's sound, ham_thief 0->1, the next try's line
  // and the numb fingers; the animation again a tick later. Later tries are seven ticks apart.
  assert.deepEqual(ticks[6].slice(0, 5), ['spam: You attempt to pick the lock on the door.', 'anim -1', 'sound 2581', 'varbit 235=1',
    'spam: You fail to pick the lock - your fingers get numb from fumbling with the lock.']);
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.THIEVING), 17);
  tick(1);
  assert.deepEqual(ticks[7], [`anim ${pick}`, 'sound 2402']);
  tick(6);
  assert.equal(varbits.get(235), 2, 'the second try seven ticks after the first');
  tick(14);
  assert.equal(varbits.get(235), 3, 'the fourth chart is the last');
  tick(7);
  const success = ticks.length - 1;
  assert.deepEqual(ticks[success], ['spam: You attempt to pick the lock on the door.', 'sound 2402', 'spam: You pick the lock on the prison door.', 'anim -1']);
  tick(1);
  assert.deepEqual(ticks[success + 1].filter((line) => !line.startsWith('spam')), ['varbit 235=0', 'sound 52', 'sound 71']);
  const step = tasks.find((task) => task instanceof core.ForceMovementTask);
  assert.ok(step, 'stepped through the door');
  // rsprox 227/01723.txt tick 8878: one walked step west, 3183,9611 to 3182,9611, through the door's wall.
  assert.deepEqual([step.forceMovement.getEnd().getX(), step.forceMovement.getEnd().getY()], [-1, 0]);
  assert.ok(player.getSkillManager().getExperience(core.Skill.THIEVING) >= 3, 'the unlock\'s 3.8 XP');
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, 'held until the step is made');
  tick(1);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.ok(tasks.every((task) => typeof task.tick === 'function'), "no task's own fields shadow Task.tick()");
});

const leaveLock = (player, to) => {
  for (const handler of handlers.get('player:world-input')) handler({ player });
  player.setLocation(new core.Location(...to));
};

test('a walk click on the success tick is held, and a player moved off the spot is not stepped through the wall', (t) => {
  HamHideout._test.setRandom(() => 0);
  t.after(() => HamHideout._test.setRandom());
  const { player } = hamPlayer(t, [3183, 9611, 0]);
  HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock'));
  tick(6);
  assert.ok(ticks[6].includes('spam: You pick the lock on the prison door.'));
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, 'held from the success');
  player.setLocation(new core.Location(3183, 9610, 0)); // moved some other way, west wall behind
  tick(1);
  assert.ok(!tasks.some((task) => task instanceof core.ForceMovementTask), 'no step from another tile');
  tick(1);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
});

test('stepping off the lock and picking it again keeps its chart and its seven-tick timing', (t) => {
  HamHideout._test.setRandom(() => 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t, [3183, 9611, 0]);
  HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock'));
  tick(6);
  assert.equal(varbits.get(235), 1, 'the first try failed');
  const failure = ticks.length - 1;
  // Local 1000359 (rev 227) ticks 25929-25936: the failure, a walk click and a step to (3183, 9612), Open, Pick-lock,
  // its line with one 2402 and no animation, and the outcome seven ticks after the failure, ham_thief 1 -> 2.
  tick(1);
  tick(1, () => leaveLock(player, [3183, 9612, 0])); // F+2
  tick(2);
  tick(1, () => HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock'))); // F+5
  assert.deepEqual(ticks[failure + 5], ['spam: You attempt to pick the lock on the door.', 'sound 2402']);
  tick(1);
  assert.equal(varbits.get(235), 1);
  tick(1); // F+7
  assert.ok(ticks[failure + 7].includes('varbit 235=2'), 'the next outcome seven ticks after the failure, on the next chart');
  assert.equal(tasks.filter((task) => task.isRunning()).length, 1, 'one attempt');
});

test('away from the lock past the try, the next Pick-lock starts a new try from the chart reached', (t) => {
  HamHideout._test.setRandom(() => 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t, [3183, 9611, 0]);
  HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock'));
  tick(6);
  leaveLock(player, [3184, 9611, 0]);
  tick(7);
  assert.equal(varbits.get(235), 1, 'no outcome while away');
  assert.equal(tasks.filter((task) => task.isRunning()).length, 0, 'the try lapsed');
  ticks = [[]];
  HamHideout._test.pickJailLock(doorEvent(player, 'Pick-lock'));
  assert.deepEqual(ticks[0], ['spam: You attempt to pick the lock on the door.', `anim ${core.CacheDefinitions.getSeqId('human_lockedchest')}`, 'sound 2402', 'sound 2402']);
  tick(6);
  assert.equal(varbits.get(235), 2);
});

test("climbing the hideout's ladder out clears the concussions, so the trapdoor isn't left open", (t) => {
  // rsprox 227/01723.txt tick 9203: the ladder's Climb-up, ham_thief 1 -> 0 (at 1 the trapdoor's multiloc shows it open).
  const { player, varbits } = hamPlayer(t, [3149, 9652, 0]);
  varbits.set(235, 1);
  const arrived = { player, objectId: core.ObjectIdentifiers.LADDER_58, location: { x: 3149, y: 9653, z: 0 } };
  for (const handler of handlers.get('loc-teleports:arrived') ?? []) handler(arrived);
  assert.equal(varbits.get(235), 0);
});

test('a bundle-out stops if the player is moved away before it moves them, and frees their movement', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  const rolls = [0.999999, 0];
  HamHideout._test.setRandom(() => rolls.shift() ?? 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  varbits.set(235, 2);
  failPickpocket(player, 4);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, 'held while bundled out');
  player.setLocation(new core.Location(3222, 3218, 0)); // teleported away meanwhile
  tick(10);
  assert.ok(ticks.flat().every((line) => !line.startsWith('move') && !line.includes('wake up')), 'no move, no wake-up');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(varbits.get(235), 0, 'the count cleared');
});

test('dying during a bundle-out frees the movement it held', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  HamHideout._test.setRandom(() => 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  varbits.set(235, 2);
  failPickpocket(player, 4);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  t.mock.method(player, 'getHitpoints', () => 0);
  tick(1);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
});

test('dying after the fade-out brings the screen back and clears the count', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  HamHideout._test.setRandom(() => 0.999999);
  t.after(() => HamHideout._test.setRandom());
  const { player, varbits } = hamPlayer(t);
  varbits.set(235, 2);
  failPickpocket(player, 3);
  tick(failedAt() + 6 - (ticks.length - 1)); // to F+6: faded out, not yet moved
  assert.ok(ticks.flat().includes('overlay 174 0,255,0,0,50'), 'faded out');
  t.mock.method(player, 'getHitpoints', () => 0); // poison, or another attacker
  tick(1);
  assert.deepEqual(ticks[ticks.length - 1], ['varbit 235=0', 'overlay 174 0,0,0,255,50', 'close overlay']);
  tick(6);
  assert.ok(ticks.slice(-6).flat().length === 0, 'nothing after it ended');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
});
