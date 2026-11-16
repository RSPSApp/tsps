// Run after `yarn build`: node --test tests/skilling-stops-on-attack.test.cjs
//
// An attack replaces the player's interaction, whether clicked or auto-retaliate, so a repeating
// skill action ends even when the target is adjacent and no step is taken. Wiki: Auto Retaliate
// (on: the player "fights back"; off: "stands where they are and takes the hits"), the F2P Ironman
// guide ("Turn off Auto Retaliate or mining will be interrupted"), and osrs-docs Entity
// Interactions, Interruptions (launching another interaction cancels the current one).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 2300, initialCycle;
const previousBots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  initialCycle = undefined;
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); initialCycle = core.World.processCycle;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => {
  try { PM.emitServerShutdown({}); if (initialCycle !== undefined) core.World.processCycle = initialCycle; }
  finally { if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = previousBots; }
});

function actor(t, x) {
  const channel = {kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){}};
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('wcattack' + next); p.setRegistered(true);
  p.setLocation(new core.Location(x, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({player:p, username:p.getUsername()}); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.World.unregisterPlayerPosition(p); });
  return {p, c};
}

function turn(...actors) {
  for (const {p} of actors) p.resetUpdating();
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process();
  for (const {p,c} of actors) {
    c.processTurnPackets();
    const movement = p.getMovementQueue();
    movement.beginCycle(); movement.processEntityPursuit();
    if (movement.hasPendingWork()) movement.process();
    core.TaskManager.processWalkTo(p.getIndex());
  }
}

/** Collects a custom event's payloads for one player, removing the observer after the test. */
function observe(t, event, player) {
  const seen = [], observer = 'SkillingAttackObserve' + event + player.getIndex();
  PM.createApi(observer).onCustomEvent(event, e => { if (e.player === player) seen.push(e); });
  t.after(() => { const hooks = PM.customEventHooks.get(event) ?? []; PM.customEventHooks.set(event, hooks.filter(h => h.pluginName !== observer)); });
  return seen;
}

/** A player with a bronze axe beside a seeded normal tree, recording chop attempts, XP and logs. */
function scene(t, x) {
  const f = actor(t, x), ids = core.ItemIdentifiers, gains = [];
  const attempts = observe(t, 'woodcutting:attempt', f.p);
  const skills = f.p.getSkillManager(), add = skills.addExperiences.bind(skills);
  t.mock.method(skills, 'addExperiences', (skill, amount) => { if (skill === core.Skill.WOODCUTTING) gains.push(amount); return add(skill, amount); });
  f.p.getInventory().add(new core.Item(ids.BRONZE_AXE), true);
  const tree = new core.GameObject(core.ObjectIdentifiers.TREE, new core.Location(x + 1, 3218, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => {
    for (const task of [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks]) {
      if (task.originalTreeObject === tree) { task.stop(); core.ObjectManager.deregister(task.stumpObject, true); }
    }
    core.ObjectManager.deregister(tree, true);
  });
  const logs = () => f.p.getInventory().getAmount(ids.LOGS);
  return { ...f, x, tree, gains, logs, attempts };
}

async function clickTree(s) {
  await s.c.dispatch([{type:'object_option', id:s.tree.getId(), x:s.x+1, y:3218, action:'Chop down'}]);
}

/** Every chop roll succeeds and no bird nest falls, so a running chop shows within a few ticks. */
function certainCut(t) {
  const random = Math.random;
  t.mock.method(Math, 'random', () => {
    const stack = new Error().stack;
    if (stack.includes('maybeDropBirdNest')) return 0.99;
    if (stack.includes('rollLog')) return 0.01;
    return random();
  });
}

async function chopping(t) {
  certainCut(t);
  const a = scene(t, 3222), b = scene(t, 3226);
  await clickTree(a); await clickTree(b);
  for (let i = 0; i < 8 && (a.p.getAnimation()?.getId() !== 879 || b.p.getAnimation()?.getId() !== 879); i++) turn(a, b);
  assert.equal(a.p.getAnimation()?.getId(), 879); assert.equal(b.p.getAnimation()?.getId(), 879);
  assert.deepEqual(a.attempts, []); assert.deepEqual(b.attempts, []);
  return { a, b };
}

for (const autoRetaliation of [true, false]) {
  const kind = autoRetaliation ? 'auto-retaliating' : 'clicking Attack';
  test(`${kind} ends the attacker's chop with no step taken; the one attacked keeps chopping`, async t => {
    const { a, b } = await chopping(t);
    const cleared = observe(t, 'player:interaction-cleared', a.p);
    const clearedTarget = observe(t, 'player:interaction-cleared', b.p);
    const from = a.p.getLocation().clone();

    a.p.getCombat().attack(b.p, autoRetaliation);
    assert.deepEqual(cleared.map(e => e.reason), ['attack']);
    assert.deepEqual(clearedTarget, [], 'being attacked clears nothing');
    assert.equal(a.p.getCombat().getTarget(), b.p, 'the attack itself still starts');

    for (let i = 0; i < 8; i++) turn(a, b);
    assert.ok(a.p.getLocation().equals(from), 'no step was needed to stop it');
    assert.deepEqual(a.attempts, [], 'no chop roll after the attack');
    assert.deepEqual(a.gains, []); assert.equal(a.logs(), 0);
    assert.equal(b.attempts.length, 1, 'the player attacked keeps chopping');
    assert.deepEqual(b.gains, [25]); assert.equal(b.logs(), 1);
  });
}

test('an inventory item action still clears the interaction, reported as an item', async t => {
  const a = actor(t, 3222);
  const cleared = observe(t, 'player:interaction-cleared', a.p);
  a.p.clearPendingAction();
  assert.deepEqual(cleared.map(e => e.reason), ['item']);
});

test('repeating skill actions held outside the task keys stop on a cleared interaction', () => {
  const listeners = new Set((PM.customEventHooks.get('player:interaction-cleared') ?? []).map(h => h.pluginName));
  for (const plugin of ['Woodcutting', 'Firemaking', 'Mining', 'Fishing', 'Cooking', 'Smithing', 'Crafting',
    'CraftingSpells', 'ShootingStars', 'MotherlodeMine', 'Farming']) {
    assert.ok(listeners.has(plugin), `${plugin} listens to player:interaction-cleared`);
  }
});

/** Uses inventory slot `from` on slot `to` through the real use-on packet. */
async function useOn(s, from, to) {
  const items = s.p.getInventory().getItems();
  await s.c.dispatch([{type:'inventory_use_on', slot:from, itemId:items[from].getId(),
    target:{kind:'inventory', slot:to, itemId:items[to].getId()}}]);
}

// rsprox captures 83, 86, 89, 1098: a knife on logs mid-chop fletches and no log follows.
test('using one item on another mid-chop ends the chop; the fletching it starts runs', async t => {
  certainCut(t);
  const a = scene(t, 3222), ids = core.ItemIdentifiers, inventory = a.p.getInventory();
  inventory.add(new core.Item(ids.HEADLESS_ARROW, 15), true);
  inventory.add(new core.Item(ids.BRONZE_ARROWTIPS, 15), true);
  await clickTree(a);
  for (let i = 0; i < 8 && a.p.getAnimation()?.getId() !== 879; i++) turn(a);
  assert.equal(a.p.getAnimation()?.getId(), 879, 'chopping');
  const cleared = observe(t, 'player:interaction-cleared', a.p);

  await useOn(a, inventory.getSlotForItemId(ids.BRONZE_ARROWTIPS), inventory.getSlotForItemId(ids.HEADLESS_ARROW));
  turn(a);
  assert.deepEqual(cleared.map(e => e.reason), ['item']);
  for (let i = 0; i < 10; i++) turn(a);
  assert.deepEqual(a.attempts, [], 'no chop roll after the use');
  assert.deepEqual(a.gains, []); assert.equal(a.logs(), 0);
  assert.equal(inventory.getAmount(ids.BRONZE_ARROW), 15, 'the arrows were still made');
});

// Live drops a use of an item on its own slot: no message, and the chop goes on (local 1000464, tick 474).
test('an item used on its own slot leaves the chop running', async t => {
  certainCut(t);
  const a = scene(t, 3222), ids = core.ItemIdentifiers, inventory = a.p.getInventory();
  inventory.add(new core.Item(ids.LOGS), true);
  await clickTree(a);
  for (let i = 0; i < 8 && a.p.getAnimation()?.getId() !== 879; i++) turn(a);
  const cleared = observe(t, 'player:interaction-cleared', a.p);
  const slot = inventory.getSlotForItemId(ids.LOGS);
  await useOn(a, slot, slot);
  turn(a);
  assert.deepEqual(cleared, []);
  for (let i = 0; i < 8 && a.attempts.length === 0; i++) turn(a);
  assert.equal(a.attempts.length, 1, 'the chop keeps rolling');
});
