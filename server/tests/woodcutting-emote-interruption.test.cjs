const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 2100, initialCycle;
const previousBots = process.env.DISABLE_PLAYER_BOTS, originalError = console.error, setupErrors = [];
before(async () => {
  console.error = (...args) => { setupErrors.push(args); originalError.apply(console, args); };
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
  finally {
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = previousBots;
    console.error = originalError;
    assert.deepEqual(setupErrors, [], 'setup and engine errors must not be swallowed');
  }
});
function actor(t, x) {
  const channel = {kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){}};
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('wcemote' + next); p.setRegistered(true);
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
function scene(t, x) {
  const f = actor(t, x), ids = core.ItemIdentifiers, gains = [], attempts = [];
  const observer = 'WoodcutAttempt' + f.p.getIndex();
  PM.createApi(observer).onCustomEvent('woodcutting:attempt', e => { if (e.player === f.p) attempts.push({cycle:core.World.getProcessCycle(), success:e.success}); });
  t.after(() => { const hooks = PM.customEventHooks.get('woodcutting:attempt') ?? []; PM.customEventHooks.set('woodcutting:attempt', hooks.filter(h => h.pluginName !== observer)); });
  const skills = f.p.getSkillManager(), add = skills.addExperiences.bind(skills);
  t.mock.method(skills, 'addExperiences', (skill, amount) => { if (skill === core.Skill.WOODCUTTING) gains.push(amount); return add(skill, amount); });
  f.p.getInventory().add(new core.Item(ids.BRONZE_AXE), true);
  const tree = new core.GameObject(core.ObjectIdentifiers.TREE, new core.Location(x + 1, 3218, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => {
    const tasks = [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks];
    for (const task of tasks) {
      if (task.originalTreeObject === tree) { task.stop(); core.ObjectManager.deregister(task.stumpObject, true); }
    }
    core.ObjectManager.deregister(tree, true);
  });
  assert.equal(core.MapObjects.get(tree.getId(), tree.getLocation(), tree.getPrivateArea()), tree, 'the click must resolve to the seeded tree instance');
  const definition = core.ObjectDefinition.forPlayer(tree.getId(), f.p);
  assert.equal(definition.getName(), 'Tree'); assert.ok(definition.getActions().includes('Chop down'));
  const ground = () => core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === f.p.getUsername() && g.getPrivateArea() === f.p.getPrivateArea() && g.getItem().getId() === ids.LOGS);
  t.after(() => { for (const g of ground()) core.ItemOnGroundManager.deregister(g); });
  const logs = () => f.p.getInventory().getAmount(ids.LOGS) + ground().reduce((n,g) => n + g.getItem().getAmount(), 0);
  const respawn = () => [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks].find(task => task.originalTreeObject === tree && task.isRunning());
  return { ...f, x, tree, gains, logs, attempts, respawn };
}
async function clickTree(s) {
  await s.c.dispatch([{type:'object_option', id:s.tree.getId(), x:s.x+1, y:3218, action:'Chop down'}]);
}
async function clickEmote(s, slot) {
  await s.c.dispatch([{type:'widget_action', widgetId:(216<<16)|2, groupId:216, childId:2, slot, buttonNum:1, opId:1, itemId:-1}]);
}
function randomCut(t) {
  const random = Math.random, draws = {cut:0, nest:0};
  t.mock.method(Math, 'random', () => {
    const stack = new Error().stack;
    if (stack.includes('maybeDropBirdNest')) { draws.nest++; return 0.99; }
    if (stack.includes('rollLog')) { draws.cut++; return 0.01; }
    return random();
  });
  const errors = [], error = console.error.bind(console);
  t.mock.method(console, 'error', (...args) => { errors.push(args); error(...args); });
  return { draws, errors };
}

test('accepted emote interrupts chopping; another player and a fresh chop remain independent', async t => {
  const {draws, errors} = randomCut(t);
  const a = scene(t, 3222), b = scene(t, 3226);
  const accepted = [];
  const observer = 'WoodcutEmoteObserve' + a.p.getIndex();
  PM.createApi(observer).onCustomEvent('player:emote', e => { if (e.player === a.p) accepted.push(e.sequence); });
  t.after(() => { const hooks=PM.customEventHooks.get('player:emote') ?? []; PM.customEventHooks.set('player:emote', hooks.filter(h => h.pluginName !== observer)); });
  t.after(() => assert.deepEqual(errors, [], 'engine and hook errors must not be swallowed')); 
  await clickTree(a); await clickTree(b);
  for (let i=0; i<8 && (a.p.getAnimation()?.getId() !== 879 || b.p.getAnimation()?.getId() !== 879); i++) turn(a,b);
  assert.equal(a.p.getAnimation()?.getId(),879); assert.equal(b.p.getAnimation()?.getId(),879);
  assert.deepEqual(a.attempts,[]); assert.deepEqual(b.attempts,[]);
  assert.deepEqual(a.gains,[]); assert.deepEqual(b.gains,[]); assert.equal(a.logs(),0); assert.equal(b.logs(),0);
  assert.equal(a.p.busy(),false); assert.equal(a.p.getCombat().isAnimationStalled(),false);
  await clickEmote(a,0); turn(a,b);
  assert.deepEqual(accepted,[855], 'the ordinary Yes emote must actually pass all gates');
  assert.equal(a.p.getAnimation()?.getId(),855);
  assert.deepEqual(a.attempts,[], 'accepted emote preceded the first chopping attempt');
  assert.equal(a.p.getLocation().getX(),a.x);
  for (let i=0; i<8; i++) turn(a,b);
  assert.deepEqual(a.attempts,[], 'no delayed chop attempts after the accepted emote');
  assert.equal(b.attempts.length,1, 'the other actor reached a real attempt');
  assert.equal(draws.cut,1); assert.equal(draws.nest,1);
  assert.deepEqual(a.gains,[], 'accepted emote must prevent delayed woodcutting XP');
  assert.equal(a.logs(),0, 'accepted emote must prevent delayed owned logs');
  assert.deepEqual(b.gains,[25], 'another player continues their own action'); assert.equal(b.logs(),1);
  assert.ok(b.respawn()?.stumpObject, 'the successful normal tree actually depleted');
  await clickTree(a);
  for (let i=0; i<12 && a.gains.length===0; i++) turn(a,b);
  assert.deepEqual(a.gains,[25], 'a fresh click grants exactly one award'); assert.equal(a.logs(),1);
  assert.ok(a.respawn()?.stumpObject, 'the restarted normal tree actually depleted');
});

test('a refused locked emote does not interrupt an active chop', async t => {
  const {draws, errors} = randomCut(t);
  const a = scene(t,3222), accepted=[];
  const observer='WoodcutRefusalObserve' + a.p.getIndex();
  PM.createApi(observer).onCustomEvent('player:emote', e => { if (e.player === a.p) accepted.push(e.sequence); });
  t.after(() => { const hooks=PM.customEventHooks.get('player:emote') ?? []; PM.customEventHooks.set('player:emote', hooks.filter(h => h.pluginName !== observer)); });
  t.after(() => assert.deepEqual(errors, [], 'engine and hook errors must not be swallowed')); 
  await clickTree(a);
  for (let i=0; i<8 && a.p.getAnimation()?.getId()!==879; i++) turn(a);
  assert.equal(a.p.getAnimation()?.getId(),879); assert.deepEqual(a.gains,[]); assert.equal(a.logs(),0);
  await clickEmote(a,24); turn(a);
  assert.deepEqual(accepted,[], 'the locked Glass Box emote must be refused');
  assert.deepEqual(a.attempts,[], 'refusal was processed before the first attempt');
  for (let i=0; i<8; i++) turn(a);
  assert.equal(a.attempts.length,1); assert.equal(draws.cut,1); assert.equal(draws.nest,1); assert.deepEqual(a.gains,[25]); assert.equal(a.logs(),1);
  assert.ok(a.respawn()?.stumpObject, 'the continuing normal tree actually depleted');
});

// Inventory actions are hard interruptions; equipment-tab actions are exempt:
// https://osrs-docs.com/docs/mechanics/entity-interactions/#interruptions
for (const route of ['legacy', 'widget', 'equipment']) test('chopping responds to ' + route + ' item interaction', async t => {
  const { errors } = randomCut(t);
  const a = scene(t, 3222), b = scene(t, 3226), ids = core.ItemIdentifiers;
  t.after(() => assert.deepEqual(errors, [], 'engine and hook errors must not be swallowed'));
  a.p.setHitpoints(3);
  a.p.getInventory().add(new core.Item(ids.TROUT), true);
  if (route === 'equipment') {
    a.p.getInventory().deleteNumber(ids.BRONZE_AXE, 1);
    a.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(ids.BRONZE_AXE));
  }
  assert.equal(core.CacheDefinitions.getItem(ids.TROUT).inventoryActions[0], 'Eat');
  await clickTree(a); await clickTree(b);
  for (let i=0; i<8 && (a.p.getAnimation()?.getId() !== 879 || b.p.getAnimation()?.getId() !== 879); i++) turn(a,b);
  assert.equal(a.p.getAnimation()?.getId(),879); assert.equal(b.p.getAnimation()?.getId(),879);
  assert.deepEqual(a.attempts,[]); assert.deepEqual(b.attempts,[]);
  const slot = a.p.getInventory().getSlotForItemId(ids.TROUT);
  const widget = core.CacheDefinitions.getComponentId(route === 'equipment' ? 'wornitems:slot3' : 'inventory:items');
  assert.ok(widget > 0);
  await a.c.dispatch([route === 'legacy'
    ? {type:'inventory_action', widgetId:149<<16, slot, itemId:ids.TROUT, option:'Eat', optionIndex:1}
    : route === 'widget'
    ? {type:'widget_action', widgetId:widget, groupId:widget>>>16, childId:widget&0xffff, slot, itemId:ids.TROUT, buttonNum:2, opId:2}
    : {type:'widget_action', widgetId:widget, groupId:widget>>>16, childId:widget&0xffff, buttonNum:1, opId:1}]);
  turn(a,b);
  assert.deepEqual(a.attempts,[], 'the item action precedes the first chopping attempt');
  if (route === 'equipment') {
    assert.equal(a.p.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId() ?? -1, -1);
    assert.equal(a.p.getInventory().getAmount(ids.BRONZE_AXE), 1);
  } else {
    assert.equal(a.p.getInventory().getAmount(ids.TROUT), 0, 'Eat reaches the food consumer');
    assert.equal(a.p.getHitpoints(), 10, 'trout heals the player');
    assert.equal(a.p.getAnimation()?.getId(), 829);
  }
  for (let i=0; i<8; i++) turn(a,b);
  assert.deepEqual(b.gains,[25], 'the other player continues chopping');
  assert.equal(b.logs(),1); assert.ok(b.respawn()?.stumpObject);
  if (route === 'equipment') {
    assert.deepEqual(a.gains,[25], 'removing an axe to inventory keeps chopping');
    assert.equal(a.logs(),1); assert.ok(a.respawn()?.stumpObject);
    return;
  }
  assert.deepEqual(a.attempts,[], 'eating stops future chop attempts');
  assert.deepEqual(a.gains,[], 'eating prevents delayed XP');
  assert.equal(a.logs(),0);
  assert.equal(core.MapObjects.get(a.tree.getId(), a.tree.getLocation(), null), a.tree);
  assert.equal(a.p.getInventory().getAmount(ids.BRONZE_AXE),1);
  await clickTree(a);
  for (let i=0; i<12 && a.gains.length===0; i++) turn(a,b);
  assert.deepEqual(a.gains,[25], 'fresh chop still succeeds');
  assert.equal(a.logs(),1); assert.ok(a.respawn()?.stumpObject);
});
