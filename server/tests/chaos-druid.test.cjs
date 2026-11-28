// Chaos druids: the punch and the Bind-and-Confuse cast (docs/chaos-druids.md; rsprox capture rev 243,
// Edgeville Dungeon). Run after `yarn build`: node --test tests/chaos-druid.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const core = PluginManager.getCoreApi();
let druid;

const CHAOS_DRUID = 520;
/** Open floor in the Edgeville Dungeon druid area. */
const AT = { x: 3110, y: 9936 };

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  require('../plugins/combat/StandardCurses.plugin').register(PluginManager.createApi('StandardCurses'));
  require('../plugins/combat/StandardBindings.plugin').register(PluginManager.createApi('Standard Bindings'));
  druid = require('../plugins/npcs/ChaosDruid.plugin');
  druid.register(PluginManager.createApi('ChaosDruid'));
});

function player(t, attack = 81) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  p.messages = [];
  t.mock.method(p, 'sendMessage', (text) => p.messages.push(text));
  p.getSkillManager().setMaxLevel(core.Skill.ATTACK, 81);
  p.getSkillManager().setCurrentLevel(core.Skill.ATTACK, attack, false);
  p.setLocation(new core.Location(AT.x, AT.y, 0));
  return p;
}

function fight(t, { dx = 0, dy = 1, attack } = {}) {
  const p = player(t, attack);
  const npc = new NPC(CHAOS_DRUID, new core.Location(AT.x + dx, AT.y + dy, 0));
  npc.getCombat().setTarget(p);
  return { p, npc };
}

/** One attack, its pick forced to the cast (bind = true) or the punch, and its roll forced. */
function attack(t, npc, p, { bind = true, accurate = true } = {}) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  const method = CombatFactory.getMethod(npc);
  method.bind = bind;
  const mock = t.mock.method(PendingHit.prototype, 'isAccurate', () => accurate);
  method.start(npc, p);
  const hits = method.hits(npc, p);
  method.finished(npc, p);
  mock.mock.restore();
  /** Advances the game a tick: the scheduled tasks, then the player's timers. */
  const tick = () => {
    cycle++;
    for (const task of [...tasks]) {
      if (task.isRunning() && task.tick() === false) tasks.splice(tasks.indexOf(task), 1);
    }
    p.getTimers().process();
  };
  return { method, hits, tick };
}

const attackLevel = (p) => p.getSkillManager().getCurrentLevel(core.Skill.ATTACK);
/** Held in place this cycle: the druid's step hold, or a freeze. */
const frozen = (p) => p.getMovementQueue().isStepHeld() || p.getTimers().has(core.TimerKey.FREEZE);

test('the punch is human_unarmedpunch, not the cast, and the druid blocks and dies as a human', () => {
  const definition = core.NpcDefinition.forId(CHAOS_DRUID);
  assert.equal(definition.getAttackAnim(), 422, 'human_unarmedpunch (the observed list also has human_castentangle)');
  assert.equal(definition.getDefenceAnim(), 425, 'human_unarmed_def');
  assert.equal(definition.getDeathAnim(), 836, 'human_death');
});

test('a landed cast lowers Attack 81 -> 76 on its tick, holds the player as it lands, then warns', (t) => {
  const { p, npc } = fight(t);
  const { hits, tick } = attack(t, npc, p);
  assert.equal(npc.getAnimation().getId(), 710, 'human_castentangle');
  assert.equal(npc.getGraphic().getId(), 177, 'entangle_casting');
  assert.equal(npc.getGraphic().getHeight(), 92);
  const impact = p.getSlotGraphics().get(2);
  assert.equal(impact.getId(), 181, 'bind_impact, in slot 2');
  assert.equal(impact.getDelay(), 56, 'delayed to the endtime from the next tile');
  assert.equal(impact.getHeight(), 124);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].getDelay(), 0);
  assert.equal(hits[0].getTotalDamage(), 0);
  assert.equal(attackLevel(p), 76, 'floor(5%) + 1 of 81 on the cast tick (recorded 81 -> 76)');
  assert.deepEqual(p.messages, ['You feel weakened.']);
  assert.equal(frozen(p), false, 'not held on the cast tick');

  tick();
  assert.equal(frozen(p), true, 'held the tick the projectile lands (endtime 56: recorded 263)');
  tick();
  assert.equal(frozen(p), false, 'and free the tick after (recorded 264)');
  for (let i = 0; i < 3; i++) tick();
  assert.deepEqual(p.messages, ['You feel weakened.']);
  tick();
  assert.deepEqual(p.messages, ['You feel weakened.', druid._test.FADE_MESSAGE], 'the fade line 6 ticks after the cast');
});

test('from three tiles the hold lands two ticks after the cast', (t) => {
  const { p, npc } = fight(t, { dy: 3 });
  const { tick } = attack(t, npc, p);
  tick();
  assert.equal(frozen(p), false, 'still free the tick after the cast');
  tick();
  assert.equal(frozen(p), true, 'held as the projectile lands (endtime 76)');
});

test('a landed cast on a lowered Attack drains nothing and says nothing, but still holds', (t) => {
  const { p, npc } = fight(t, { attack: 76 });
  const { tick } = attack(t, npc, p);
  assert.equal(attackLevel(p), 76, 'recorded: the second landed cast with Attack still at 76');
  assert.deepEqual(p.messages, []);
  tick();
  assert.ok(frozen(p), 'the hold still lands');
});

test('a splash shows failedspell_impact and neither holds, drains nor warns', (t) => {
  const { p, npc } = fight(t);
  const { tick } = attack(t, npc, p, { accurate: false });
  const splash = p.getSlotGraphics().get(2);
  assert.equal(splash.getId(), 85, 'failedspell_impact');
  assert.equal(splash.getDelay(), 56);
  for (let i = 0; i < 7; i++) {
    tick();
    assert.equal(frozen(p), false);
  }
  assert.equal(attackLevel(p), 81);
  assert.deepEqual(p.messages, []);
});

test('the projectile ends 46 + 10 cycles a tile (recorded 56, 66 and 76)', (t) => {
  for (const [dy, end] of [[1, 56], [2, 66], [3, 76]]) {
    const { p, npc } = fight(t, { dy });
    assert.equal(druid._test.bindEndCycles(npc, p), end);
  }
});

test('the punch uses the melee method', (t) => {
  const { p, npc } = fight(t);
  const { hits } = attack(t, npc, p, { bind: false });
  assert.equal(npc.getAnimation().getId(), 422);
  assert.equal(frozen(p), false);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].getCombatType(), core.CombatType.MELEE);
});

test('it casts or punches at even odds; out of a fight it has melee reach, so it hunts as a melee monster', (t) => {
  let casts = 0;
  for (let i = 0; i < 400; i++) if (druid._test.picksBind()) casts++;
  assert.ok(casts > 150 && casts < 250, `about half are casts (${casts}/400)`);

  const idle = new NPC(CHAOS_DRUID, new core.Location(AT.x, AT.y + 1, 0));
  assert.equal(CombatFactory.getMethod(idle).attackDistance(idle), 1);
  const engaged = fight(t, { dy: 3 });
  const method = CombatFactory.getMethod(engaged.npc);
  method.bind = true;
  assert.equal(method.attackDistance(engaged.npc), 10, 'a picked cast reaches from range');
  method.bind = false;
  assert.equal(method.attackDistance(engaged.npc), 1, 'a picked punch walks in');
});

test('the picked attack holds between lookups and is picked again after the attack', (t) => {
  const { p, npc } = fight(t);
  const first = CombatFactory.getMethod(npc);
  first.bind = true;
  assert.equal(CombatFactory.getMethod(npc), first, 'the same method object for this druid');
  assert.equal(CombatFactory.getMethod(npc).type(npc), core.CombatType.MAGIC);
  first.finished(npc, p);
  assert.equal(first.bind, null);
});

// The engine asks the method's type() with no argument; a cast must still be magic, so the
// player doesn't block it (live: no player animation on a cast) and it rolls magic accuracy.
test('through the real attack, a cast is magic: no block animation from the player', (t) => {
  t.mock.method(core.TaskManager, 'submit', () => {});
  const { p, npc } = fight(t);
  t.mock.method(p, 'isRegistered', () => true);
  const method = CombatFactory.getMethod(npc);
  method.bind = true;
  assert.equal(method.type(), core.CombatType.MAGIC, 'type() with no argument');
  assert.equal(new PendingHit(npc, p, method, 0).getCombatType(), core.CombatType.MAGIC);
  const mock = t.mock.method(PendingHit.prototype, 'isAccurate', () => false);
  npc.getCombat().executeAttack(method, p, true, npc.getCombat().generation ?? 0, false);
  mock.mock.restore();
  assert.equal(npc.getAnimation().getId(), 710);
  assert.notEqual(p.getAnimation()?.getId(), 424, 'the player does not block a cast');
});

// Live: the player's walk click on the held tick (263) didn't move them that tick, and did on 264.
test('a walk click on the held tick is kept and walked the tick after', (t) => {
  const { p, npc } = fight(t, { dx: 1, dy: 0 });
  const { tick } = attack(t, npc, p);
  tick();
  assert.ok(p.getMovementQueue().isStepHeld(), 'held');
  t.mock.method(core.PathFinder, 'calculateWalkRoute', (player, x, y) => {
    player.getMovementQueue().addSteps(new core.Location(x, y, 0));
  });
  p.getMovementQueue().requestWalk(new core.Location(AT.x - 1, AT.y, 0));
  assert.ok(p.getMovementQueue().getDestination(), 'the click is taken while held');
  p.getMovementQueue().process();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [AT.x, AT.y], 'no step on the held tick');
  assert.equal(p.getTimers().has(core.TimerKey.FREEZE), false, 'not a freeze: no timer or immunity');
  tick();
  p.getMovementQueue().process();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [AT.x - 1, AT.y], 'walked the tick after');
});

test('a picked punch the druid cannot walk in for becomes a cast', (t) => {
  let cycle = 2000;
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  const { p, npc } = fight(t, { dy: 3 });
  const method = CombatFactory.getMethod(npc);
  method.bind = null;
  t.mock.method(druid._test, 'picksBind', () => false);
  t.mock.method(core.Misc, 'randomInclusive', () => 1); // the roll: a punch
  assert.equal(method.pick(npc, p), false, 'a punch was picked');
  for (let i = 0; i < 3; i++) {
    cycle++;
    method.pick(npc, p);
  }
  assert.equal(method.pick(npc, p), true, 'stuck three tiles away, it casts instead');
  assert.equal(method.attackDistance(npc), 10);
});
