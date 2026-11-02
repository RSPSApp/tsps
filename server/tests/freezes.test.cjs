const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();

const FROZEN = "<col=ef1020>You have been frozen!</col>";
const THAW = "<col=ef1020>The freeze cast upon you is beginning to thaw.</col>";
const FADE = "<col=ef1020>The holding effect is beginning to fade.</col>";

before(async () => {
  await CachePipeline.initialize(process.cwd());
  require("../plugins/combat/StandardBindings.plugin").register(PluginManager.createApi("FreezesBindingTest"));
  require("../plugins/combat/Freezes.plugin").register(PluginManager.createApi("FreezesTest"));
  require("../dist/game/definition/ObjectDefinition").ObjectDefinition.init();
});

/** A registered player at (x, y) whose chat lines land in `messages`, typed lines as [type, text]. */
function player(t, x, y, z = 0) {
  const p = new Player(null), messages = [];
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true }));
  t.mock.method(p, "sendMessage", (m) => messages.push(m));
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, m) => { messages.push([type, m]); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendEffectTimer", () => p.getPacketSender());
  p.setLocation(new core.Location(x, y, z));
  p.setRegistered(true);
  return { p, messages };
}

/**
 * Captures the watch tasks the plugin submits. `tick()` runs one game tick in World order:
 * tasks first, then each player's turn (timers). `rest()` finishes the cast tick for players
 * who take their turn after the caster.
 */
function world(t, ...players) {
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  const turns = () => { for (const { p } of players) p.getTimers().process(); };
  return {
    tasks,
    rest: turns,
    tick() {
      for (const task of tasks) if (task.isRunning()) task.execute();
      turns();
    },
  };
}

function iceHit(cast, target) {
  return { isAccurate: () => true, getAttacker: () => cast, getTarget: () => target, getTotalDamage: () => 0 };
}

test("ice spells say 'You have been frozen!' in red as a spam message, and warn 29-30 ticks later", (t) => {
  // Live: the thaw warning follows "You have been frozen!" by 29 ticks (rsprox 604, 623, 624, 2238) or 30 (451, 612, 629, 2236).
  for (const [targetAfterCaster, warnedAt] of [[true, 29], [false, 30]]) {
    const caster = player(t, 3240, 3560), target = player(t, 3240, 3561), w = world(t, caster, target);
    core.CombatSpells.ICE_BARRAGE.onHitCalc(iceHit(caster.p, target.p));
    assert.deepEqual(target.messages, [[core.ChatType.SPAM, FROZEN]]);
    assert.equal(target.p.getTimers().getTicks(core.TimerKey.FREEZE), 32);
    if (targetAfterCaster) w.rest();
    for (let tick = 1; tick <= 35; tick++) {
      w.tick();
      assert.equal(target.messages.includes(THAW), tick >= warnedAt, `tick ${tick}`);
    }
    assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), false);
    assert.equal(target.messages.filter((m) => m === THAW).length, 1);
  }
});

test("bind-type spells land silently and warn that the holding effect is beginning to fade", (t) => {
  const caster = player(t, 3240, 3560), target = player(t, 3240, 3561), w = world(t, caster, target);
  core.CombatFactory.freezeTicks(target.p, 8, null, caster.p, "bind");
  assert.deepEqual(target.messages, []);
  for (let tick = 1; tick <= 8; tick++) w.tick();
  assert.deepEqual(target.messages, [FADE]);
  assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), false);
});

test("a freeze from another player breaks once they are more than 10 tiles apart on X or Y", (t) => {
  for (const [dx, dy, held] of [[10, 0, true], [0, 10, true], [10, 10, true], [11, 0, false], [0, -11, false], [7, 11, false]]) {
    const caster = player(t, 3240, 3560), target = player(t, 3240, 3561), w = world(t, caster, target);
    core.CombatSpells.ICE_BARRAGE.onHitCalc(iceHit(caster.p, target.p));
    caster.p.setLocation(new core.Location(3240 + dx, 3561 + dy, 0));
    w.tick();
    assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), held, `${dx},${dy}`);
    assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE_IMMUNITY), true, "immunity keeps running");
  }
});

test("the 10-tile check ignores the plane, so a caster who climbs a ladder keeps the freeze", (t) => {
  const caster = player(t, 3240, 3560), target = player(t, 3240, 3561), w = world(t, caster, target);
  core.CombatSpells.ICE_BARRAGE.onHitCalc(iceHit(caster.p, target.p));
  caster.p.setLocation(new core.Location(3240, 3561, 1));
  for (let tick = 0; tick < 10; tick++) w.tick();
  assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), true);
});

test("binds, the Binding Tentacle and the Zamorak godsword hold players only within 10 tiles too", (t) => {
  for (const freeze of [
    (caster, target) => core.CombatFactory.freezeTicks(target, 8, null, caster, "bind"),
    (caster, target) => core.CombatFactory.freeze(target, core.Misc.getSeconds(8), undefined, caster),
  ]) {
    const caster = player(t, 3240, 3560), target = player(t, 3240, 3561), w = world(t, caster, target);
    freeze(caster.p, target.p);
    w.tick();
    assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), true);
    caster.p.setLocation(new core.Location(3252, 3561, 0));
    w.tick();
    assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), false);
  }
});

test("freezes with no player behind them, or on NPCs, are left alone", (t) => {
  const target = player(t, 3240, 3561), w = world(t, target);
  core.CombatFactory.freeze(target.p, 6);
  assert.deepEqual(target.messages, ["You have been frozen!"]);
  assert.equal(w.tasks.length, 0);
  const npc = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3200, 3200));
  const caster = player(t, 3240, 3560);
  core.CombatSpells.ICE_BARRAGE.onHitCalc(iceHit(caster.p, npc));
  assert.equal(npc.getTimers().getTicks(core.TimerKey.FREEZE), 32);
  assert.equal(w.tasks.length, 0);
});

test("a replaced or cleared freeze stops its watch, and a caster who logs out no longer breaks it", (t) => {
  const caster = player(t, 3240, 3560), target = player(t, 3240, 3561), w = world(t, caster, target);
  core.CombatSpells.ICE_BARRAGE.onHitCalc(iceHit(caster.p, target.p));
  caster.p.setRegistered(false);
  caster.p.setLocation(new core.Location(3300, 3561, 0));
  w.tick();
  assert.equal(target.p.getTimers().has(core.TimerKey.FREEZE), true);
  target.p.getTimers().cancel(core.TimerKey.FREEZE);
  w.tick();
  assert.equal(w.tasks[0].isRunning(), false);
});

test("a frozen player's walk click gets no message", (t) => {
  const target = player(t, 3240, 3561);
  target.p.getTimers().registers(core.TimerKey.FREEZE, 5);
  target.p.getMovementQueue().requestWalk(new core.Location(3236, 3561, 0));
  assert.deepEqual(target.messages, []);
  assert.deepEqual([target.p.getLocation().getX(), target.p.getLocation().getY()], [3240, 3561]);
});

test("binding a target still immune after a freeze says 'Your target is currently immune to that spell.'", (t) => {
  const caster = player(t, 3240, 3560), target = player(t, 3240, 3561);
  t.mock.method(caster.p.getCombat(), "getTarget", () => target.p);
  target.p.getTimers().registers(core.TimerKey.FREEZE_IMMUNITY, 5);
  const spell = core.CombatSpells.BIND;
  assert.equal(PluginManager.emitSpellDisabled(caster.p, core.MagicSpellbook.NORMAL, spell.spellId(), spell), true);
  assert.ok(caster.messages.includes("Your target is currently immune to that spell."), JSON.stringify(caster.messages));
});

test("a frozen player still interacts with an NPC in reach, and cannot reach one further away", (t) => {
  const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
  const { RsmodRouteFinding } = require("../dist/game/model/movement/path/RsmodRouteFinding");
  const previous = PathFinder.rsmodRouteFinding;
  PathFinder.rsmodRouteFinding = new RsmodRouteFinding(() => 0);
  t.after(() => { PathFinder.rsmodRouteFinding = previous; });
  const frozen = player(t, 3240, 3561);
  const queue = frozen.p.getMovementQueue();
  t.mock.method(queue, "checkDestination", () => true);
  t.mock.method(queue, "isInteractionTargetValid", () => true);
  frozen.p.getTimers().registers(core.TimerKey.FREEZE, 10);
  for (const [y, interacts] of [[3562, true], [3565, false]]) {
    const npc = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3240, y));
    let talked = 0;
    frozen.messages.length = 0;
    queue.walkToEntity(npc, () => talked++);
    assert.equal(talked, interacts ? 1 : 0, `npc at y=${y}`);
    assert.deepEqual(frozen.messages, interacts ? [] : ["I can't reach that!"]);
    assert.equal(queue.points.length, 0);
  }

  // A stun on top of the freeze (a Shove keeps the freeze) still stops Talk-to in reach.
  frozen.p.getTimers().registers(core.TimerKey.STUN, 5);
  const npc = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3240, 3562));
  let talked = 0;
  frozen.messages.length = 0;
  queue.walkToEntity(npc, () => talked++);
  assert.equal(talked, 0, "a stunned frozen player does not interact");
  assert.deepEqual(frozen.messages, ["You're stunned!"]);
});

/** The 0..2047 angle the client is sent for `player`'s face target. */
function faceAngle(p) {
  const { PlayerSession } = require("../dist/net/PlayerSession");
  return PlayerSession.prototype.faceDirection.call(null, p.getLocation(), p.getPositionToFace());
}

/** Runs the one-tick tasks submitted while `fn` runs, after it returns. */
function nextTick(t, fn) {
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  fn();
  return () => { for (const task of tasks) if (task.isRunning()) task.tick(); };
}

test("a frozen player who clicks a loc out of reach turns to its centre, every click (#1944)", (t) => {
  // rsprox 2238: frozen at 3325,4763, each Exit click on the 4x2 portal 26646 at 3326,4749
  // answers "I can't reach that!" with FaceAngle 1989; walk clicks while frozen send none.
  const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
  const frozen = player(t, 3325, 4763);
  frozen.p.getTimers().registers(core.TimerKey.FREEZE, 10);
  const portal = new GameObject(26646, new core.Location(3326, 4749, 0), 10, 0, null);
  const queue = frozen.p.getMovementQueue();
  let used = 0;
  for (let click = 0; click < 2; click++) {
    frozen.messages.length = 0;
    frozen.p.getUpdateFlag().reset();
    queue.walkToObject(portal, { execute: () => used++ }, 1);
    assert.deepEqual(frozen.messages, ["I can't reach that!"]);
    assert.equal(frozen.p.getUpdateFlag().flagged(core.Flag.FACE_POSITION), true, `click ${click}`);
    assert.equal(faceAngle(frozen.p), 1989);
  }
  assert.equal(used, 0);
  assert.equal(queue.points.length, 0);
});

test("a frozen player who clicks a loc out of reach mid-fight drops the fight to face it", (t) => {
  const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
  const frozen = player(t, 3325, 4763), opponent = player(t, 3325, 4764);
  frozen.p.getTimers().registers(core.TimerKey.FREEZE, 10);
  frozen.p.getCombat().setTarget(opponent.p);
  frozen.p.setMobileInteraction(opponent.p);
  frozen.p.getMovementQueue().walkToObject(new GameObject(26646, new core.Location(3326, 4749, 0), 10, 0, null), { execute() {} }, 1);
  assert.equal(frozen.p.getCombat().getTarget(), null);
  assert.equal(frozen.p.getInteractingMobile(), null);
  assert.equal(faceAngle(frozen.p), 1989);
});

test("a frozen player who clicks an NPC out of reach faces it for that tick only", (t) => {
  // rsprox 2238 (OpPlayer) and 3391 (OpNpc): FacePathingEntity on the click tick, cleared the next.
  const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
  const { RsmodRouteFinding } = require("../dist/game/model/movement/path/RsmodRouteFinding");
  const previous = PathFinder.rsmodRouteFinding;
  PathFinder.rsmodRouteFinding = new RsmodRouteFinding(() => 0);
  t.after(() => { PathFinder.rsmodRouteFinding = previous; });
  const frozen = player(t, 3240, 3561);
  const queue = frozen.p.getMovementQueue();
  t.mock.method(queue, "checkDestination", () => true);
  t.mock.method(queue, "isInteractionTargetValid", () => true);
  frozen.p.getTimers().registers(core.TimerKey.FREEZE, 10);
  const npc = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3240, 3565));
  const tick = nextTick(t, () => queue.walkToEntity(npc, () => {}));
  assert.deepEqual(frozen.messages, ["I can't reach that!"]);
  assert.equal(frozen.p.getInteractingMobile(), npc);
  tick();
  assert.equal(frozen.p.getInteractingMobile(), null);

  // A new interaction before the next tick is left alone.
  const other = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3240, 3562));
  const later = nextTick(t, () => queue.walkToEntity(npc, () => {}));
  frozen.p.setMobileInteraction(other);
  later();
  assert.equal(frozen.p.getInteractingMobile(), other);
});

test("a frozen player's attack on a player out of reach answers 'I can't reach that!' and stops", (t) => {
  // rsprox 2238: each Attack click on a player four tiles away while frozen gets that reply.
  let cycle = 500;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  t.mock.method(core.CombatFactory, "validTarget", () => true);
  const { CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
  t.mock.method(core.CombatFactory, "canAttackPermission", () => CanAttackResponse.CAN_ATTACK);
  for (const [frozenTicks, y, expected] of [[10, 3565, ["I can't reach that!"]], [0, 3565, []], [10, 3562, []]]) {
    const attacker = player(t, 3240, 3561), target = player(t, 3240, y);
    if (frozenTicks) attacker.p.getTimers().registers(core.TimerKey.FREEZE, frozenTicks);
    attacker.p.getCombat().setTarget(target.p);
    const tick = nextTick(t, () => attacker.p.getCombat().preMovementProcess());
    cycle++;
    assert.deepEqual(attacker.messages.filter((m) => /reach/.test(m)), expected, `frozen=${frozenTicks} y=${y}`);
    assert.equal(attacker.p.getCombat().getTarget() === target.p, expected.length === 0, "the attack ends only when unreachable");
    // Live still turns the attacker to the target on that tick (FacePathingEntity), then lets go.
    assert.equal(attacker.p.getInteractingMobile(), target.p, `faces the target, frozen=${frozenTicks} y=${y}`);
    tick();
    assert.equal(attacker.p.getInteractingMobile() === target.p, expected.length === 0, "lets go only once it gave up");
  }
});
