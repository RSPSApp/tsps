// Run from server after build: node --test tests/dragon-thrownaxe-cooldown.test.cjs
// Momentum Throw's registered bypass trait through the real active-fight combat loop.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
let core;
const setupErrors = [], originalError = console.error;
before(async () => {
  console.error = (...args) => { setupErrors.push(args); originalError.apply(console, args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register(PM.createApi('ThrownaxeItemDefinitions'));
  new NpcDefinitionLoader().load();
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3220, 3220);
  require('../plugins/combat/specials/DragonThrownaxe.SpecialAttack')(PM.createApi('ThrownaxeCooldownTest'));
});
after(() => {
  console.error = originalError;
  assert.deepEqual(setupErrors, [], 'setup and engine errors must not be swallowed');
});

function scene(t, rapid = false) {
  const errors = [], error = console.error.bind(console);
  t.mock.method(console, 'error', (...args) => { errors.push(args); error(...args); });
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  let npc = null;
  const previousCycle = core.World.processCycle, tasks = [];
  const observer = 'ThrownaxeCooldownObserve';
  t.after(() => {
    const hooks = PM.customEventHooks.get('combat:attack-started') ?? [];
    PM.customEventHooks.set('combat:attack-started', hooks.filter(h => h.pluginName !== observer));
    for (const task of tasks) if (task.isRunning()) core.Task.prototype.stop.call(task);
    p.getCombat().reset(); p.getCombat().getHitQueue().clear(); p.getMovementQueue().reset();
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    if (npc) { npc.getCombat().reset(); npc.getCombat().getHitQueue().clear(); PM.removeNpc(npc); }
    core.World.unregisterPlayerPosition(p); p.setRegistered(false); core.World.processCycle = previousCycle;
  });
  t.after(() => assert.deepEqual(errors, [], 'engine and hook errors must not be swallowed'));
  p.setIndex(8861); p.setUsername('axe8861'); p.setRegistered(true); p.setNeedsPlacement(false);
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(3220, 3220, 0));
  for (const skill of core.Skill.values()) { p.getSkillManager().setMaxLevel(skill, 99); p.getSkillManager().setCurrentLevel(skill, 99); }
  p.setHitpoints(99); p.setSpecialPercentage(100);
  p.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_THROWNAXE, 50));
  core.WeaponInterfaceManager.assign(p);
  const styles = Object.values(p.getWeapon().getFightType());
  const style = styles.find(type => type.isRapid() === rapid);
  assert.ok(style, 'the axe has the requested style');
  p.setFightType(style);
  npc = PM.spawnNpc({ id: core.NpcIdentifiers.MUGGER_2, x: 3220, y: 3223, wanderRadius: 0 });
  assert.ok(npc && npc.isRegistered());
  npc.setNeedsPlacement(false); npc.setHitpoints(500); npc.getMovementQueue().setBlockMovement(true);
  let paying = false;
  const submit = core.TaskManager.submit, decrement = core.CombatFactory.decrementAmmo;
  t.mock.method(core.CombatFactory, 'decrementAmmo', function(...args) {
    paying = true;
    try { return decrement.apply(this, args); } finally { paying = false; }
  });
  t.mock.method(core.TaskManager, 'submit', function(task) { if (paying) tasks.push(task); return submit.call(this, task); });
  const attacks = [];
  PM.createApi(observer).onCustomEvent('combat:attack-started', event => {
    if (event.attacker === p) attacks.push({ cycle: core.World.getProcessCycle(), method: event.method });
  });
  const tick = () => {
    core.World.processCycle++; core.TaskManager.process();
    const m = p.getMovementQueue(); m.beginCycle(); p.getCombat().preMovementProcess();
    m.processEntityPursuit(); if (m.hasPendingWork()) m.process();
    p.getCombat().postMovementProcess(); core.TaskManager.processWalkTo(p.getIndex());
  };
  p.getCombat().attack(npc);
  tick();
  assert.ok(p.getCombat().getAttackDelay() > 1, 'ordinary first shot establishes a cooldown');
  assert.equal(attacks.length, 1, 'the real ordinary attack started');
  assert.equal(attacks[0].method, core.CombatFactory.RANGED_COMBAT);
  const deadline = core.World.getProcessCycle() + p.getCombat().getAttackDelay();
  assert.equal(p.getCombat().getTarget(), npc);
  assert.equal(p.getSpecialPercentage(), 100);
  assert.equal(p.getCombatSpecial()?.getId(), 'dragon_thrownaxe');
  return { p, npc, tick, attacks, deadline, tasks };
}

for (const [rapid, speed] of [[false, 5], [true, 4]]) {
  test(`Momentum Throw resets the ${rapid ? 'rapid' : 'accurate'} cooldown`, t => {
    const { p, tick, attacks, deadline } = scene(t, rapid);
    core.CombatSpecial.activate(p);
    assert.equal(p.isSpecialActivated(), true);
    tick();
    assert.equal(attacks.length, 2);
    assert.equal(attacks[1].method, p.getCombatSpecial().getCombatMethod());
    assert.ok(attacks[1].cycle < deadline, 'special started before the previous deadline');
    assert.equal(p.getSpecialPercentage(), 75, 'one special drains 25 energy');
    assert.equal(p.getCombat().getAttackDelay(), speed, 'special starts a full weapon cooldown');
    for (let i = 1; i < speed; i++) { tick(); assert.equal(attacks.length, 2, 'no early normal attack'); }
    tick();
    assert.equal(attacks.length, 3);
    assert.equal(attacks[2].cycle - attacks[1].cycle, speed);
    assert.equal(p.getSpecialPercentage(), 75, 'one activation drains once');
  });
}

test('two activations on successive ticks each launch once', t => {
  const { p, tick, attacks } = scene(t);
  core.CombatSpecial.activate(p); tick();
  core.CombatSpecial.activate(p); tick();
  assert.equal(attacks.length, 3);
  assert.equal(attacks[2].cycle - attacks[1].cycle, 1);
  assert.equal(p.getSpecialPercentage(), 50);
  assert.equal(p.getCombat().getAttackDelay(), 5);
});

test('a special on the old deadline starts a full new cooldown', t => {
  const { p, tick, attacks, deadline } = scene(t);
  while (core.World.getProcessCycle() < deadline - 1) tick();
  assert.equal(attacks.length, 1);
  core.CombatSpecial.activate(p);
  tick();
  assert.equal(attacks.length, 2);
  assert.equal(attacks[1].cycle, deadline);
  assert.equal(p.getCombat().getAttackDelay(), 5);
  for (let i = 1; i < 5; i++) { tick(); assert.equal(attacks.length, 2); }
  tick();
  assert.equal(attacks[2].cycle - attacks[1].cycle, 5);
});

test('without an armed special the ordinary cooldown still applies', t => {
  const { p, tick, attacks } = scene(t);
  const delay = p.getCombat().getAttackDelay();
  tick();
  assert.equal(p.getSpecialPercentage(), 100);
  assert.equal(attacks.length, 1, 'no normal attack before the deadline');
  assert.equal(p.getCombat().getAttackDelay(), delay - 1);
});

test('a target removed before the armed special is processed cannot be attacked', t => {
  const { p, npc, tick, attacks } = scene(t);
  core.CombatSpecial.activate(p);
  npc.setRegistered(false);
  assert.equal(core.CombatFactory.validTarget(p, npc), false);
  tick();
  assert.equal(p.getSpecialPercentage(), 100);
  assert.equal(p.getCombat().getTarget(), null);
  assert.equal(attacks.length, 1);
});

test('insufficient energy refuses the special without a launch', t => {
  const { p, tick, attacks } = scene(t);
  p.setSpecialPercentage(24);
  core.CombatSpecial.activate(p);
  tick();
  assert.equal(p.getSpecialPercentage(), 24);
  assert.equal(p.isSpecialActivated(), false);
  assert.equal(attacks.length, 1);
});

test('an explicit spell retains its normal cooldown while the special is armed', t => {
  const { p, tick, attacks, deadline } = scene(t);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.AIR_RUNE, 20), true);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.MIND_RUNE, 20), true);
  p.getCombat().setCastSpell(core.CombatSpells.WIND_STRIKE);
  core.CombatSpecial.activate(p);
  assert.equal(core.CombatFactory.getMethod(p), core.CombatFactory.MAGIC_COMBAT);
  tick();
  assert.equal(attacks.length, 1, 'arming the axe does not bypass the spell cooldown');
  assert.equal(p.getSpecialPercentage(), 100);
  for (let i = 0; i < 8 && attacks.length < 2; i++) tick();
  assert.equal(attacks.length, 2, 'the selected spell fires once the normal delay expires');
  assert.equal(attacks[1].method, core.CombatFactory.MAGIC_COMBAT);
  assert.equal(attacks[1].cycle, deadline);
  assert.ok(p.getCombat().getAttackDelay() > 0, 'the spell sets its normal cooldown');
});

test('both thrownaxes are paid when their shots land', t => {
  const random = core.Misc.getRandom, decrement = core.CombatFactory.decrementAmmo;
  let paying = false, draws = 0;
  t.mock.method(core.CombatFactory, 'decrementAmmo', function(...args) {
    paying = true;
    try { return decrement.apply(this, args); } finally { paying = false; }
  });
  t.mock.method(core.Misc, 'getRandom', max => {
    if (paying && max === 99) { draws++; return 0; }
    return random(max);
  });
  const { p, tick, attacks, tasks } = scene(t);
  core.CombatSpecial.activate(p);
  tick();
  assert.equal(attacks.length, 2, 'the special was launched');
  assert.equal(draws, 2, 'both real ammunition rolls took the break outcome');
  p.getCombat().reset();
  for (let i = 0; i < 6; i++) tick();
  assert.equal(tasks.length, 2, 'each shot submitted one payment task');
  assert.ok(tasks.every(task => !task.isRunning()), 'both delayed payments have settled');
  assert.equal(p.getEquipment().get(core.Equipment.WEAPON_SLOT).getAmount(), 48);
});
