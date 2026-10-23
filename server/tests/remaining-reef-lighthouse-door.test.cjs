// From server/: node --test tests/remaining-reef-scrambled-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const StaticShips = require('../plugins/skills/sailing/StaticShips.Sailing');
const { World } = require('../dist/game/World');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
afterEach(() => { for (const ship of StaticShips.all()) StaticShips.dispose(ship); });
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], areas = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), buttons = new Map(), namedNpcs = new Map(), namedObjects = new Map();
  const objectManager = { register: object => objects.push(object), deregister: object => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); } };
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: object => objects.push(object), deregister: noop } },
    registerArea: area => areas.push(area),
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args), getGroundItem: () => null }),
    onInterfaceActionButton: (ids, fn) => [].concat(ids).forEach(id => { const callbacks = buttons.get(id) ?? []; callbacks.push(fn); buttons.set(id, callbacks); }),
    onObjectClick: (ids, click, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    onObjectInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onObjectInteraction ??= []).push(name); else namedObjects.set(name, actions); },
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = { ...definition, animations: [], graphics: [], getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, setForceMovement: movement => { npc.forceMovement = movement; }, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isNpc: () => true, isPlayer: () => false, getAsNpc: () => npc,
        isRegistered: () => !npc.removed, setPositionToFace: noop, forceChat: text => { npc.said = text; },
        performAnimation: animation => npc.animations.push(animation.getId()), performGraphic: graphic => npc.graphics.push(graphic.id),
        getMovementQueue: () => ({ reset() { return this; }, addSteps: to => { npc.walkingTo = to; } }),
        exactMove: (to, options) => { npc.exact = options; location = to; },
        setFollowing: target => { npc.following = target; }, setMobileInteraction: noop, setNpcTransformationId: noop,
        setPet: noop, setOwner: noop, getOwner: () => definition.owner,
        setCombatXpMultiplier: value => { npc.multiplier = value; },
        getCombat: () => ({ attack: player => { npc.target = player; } }),
        getHitpoints: () => npc.hitpoints ?? 100, setHitpoints: value => { npc.hitpoints = value; return npc; },
        getMaxHitpoints: () => npc.maxHitpoints ?? 100,
      }; npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  api.getTaskManager = () => api.core.TaskManager;
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, areas, npcs, removed, objects, ground, clicks, buttons, namedNpcs, namedObjects, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice, `no variant for ${npcId}`); runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page, typeof choice === 'string' ? choice : choice.variant); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 120) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`); p.manager.advance(); } },
    continueToMenu(p, limit = 120) { h.continueUntil(p, () => Boolean(p.prompt), limit); },
    logout(p) { for (const fn of hooks.onPlayerLogout ?? []) fn({ player: p }); },
    login(p) { for (const fn of hooks.onPlayerLogin ?? []) fn({ player: p }); },
    death(p) { for (const fn of hooks.onPlayerDeath ?? []) fn({ player: p }); },
  }; return h;
}
function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28, contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount, `missing item ${id}`); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit(id) { return varbits.get(id) ?? 0; }, getVarp(id) { return configs.get(id) ?? 0; },
    isSubInterfaceOpen: () => false, closeInterface: id => { log.push(['closeInterface', id]); return packet; },
    sendString(text, uid) { if ([6, 3, 2].some(child => [217, 231, 229, 193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { setEnteredAmountAction: action => { p.amountAction = action; }, attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => p.amulet ? { getId: () => p.amulet } : null, getItems: () => p.amulet ? [{ getId: () => p.amulet }] : [] }),
    getSession: () => ({ sendClientPacket: frame => { log.push(['frame', Buffer.from(frame)]); return true; } }), getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: () => p.magic ?? 99, getMaxLevel: () => p.level ?? 99 }),
    getPrayerActive: () => new Array(30).fill(false), getQuickPrayers: () => ({ checkActive: noop }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; }, addSteps(to) { location = to; return this; }, isBlockMovement: () => Boolean(p.blocked) }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => { p.forceMovement = movement; }, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: damage => { p.damage = damage; } }) }),
    getUsername: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}

const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const ObstacleRunner = require('../plugins/skills/agility/ObstacleRunner.Agility');

const DOOR = { x: 2858, y: 2323, z: 0 };
const canWalk = (a, b) => RegionManager.canMove(a[0], a[1], b[0], b[1], 0, 1, 1, null);
const sentIds = (p, names) => p.log
  .filter(entry => names.includes(entry[0]) && entry[1] && typeof entry[1].getId === 'function')
  .map(entry => [entry[0], entry[1].getId(), entry[1].getType(), entry[1].getFace()]);

test('Last Light lighthouse doorway: captured scripted threshold Open60018 crosses one tile, closes in 2 ticks, exits normally, never clears the global wall', () => {
  if (RegionManager.regions.size === 0) RegionManager.init();
  const h = harness('RedReef'), p = player();
  p.getHitpoints = () => 99;
  p.setLocation = loc => p.moveTo(loc);
  p.setWalkingDirection = () => {};
  p.setSkillAnimation = () => {};
  p.getForceMovement = () => null;
  const movementQueue = p.getMovementQueue();
  p.getMovementQueue = () => ({ ...movementQueue, handleRegionChange: () => {} });
  h.quest.setStage(p, 24);
  p.moveTo(new core.Location(2857, 2323, 0));

  const closed = MapObjects.get(60018, new core.Location(DOOR.x, DOOR.y, DOOR.z), null);
  assert.ok(closed, 'captured closed last_light_doorway 60018 is on the map');
  assert.equal(canWalk([2857, 2323], [2858, 2323]), false, 'closed doorway keeps its clipped edge');

  const enter = { player: p, object: closed, objectId: 60018, definition: { id: 60018 }, handled: false };
  h.hooks.onObjectInteraction[0](enter);
  assert.equal(enter.handled, true, 'normal Open is claimed');
  assert.equal(h.quest.getStage(p), 24, 'world door never changes the quest stage');
  assert.equal(ObstacleRunner.isBusy(p), true, 'the crossing is scoped to this player');
  assert.deepEqual(sentIds(p, ['sendObject', 'sendObjectRemoval']), [
    ['sendObjectRemoval', 60018, 0, 0],
    ['sendObject', 38848, 0, 0],
    ['sendObject', 60019, 0, 0],
  ], 'raw shape0/face0 open states, inviswall first as captured');
  assert.equal(MapObjects.get(60019, new core.Location(DOOR.x, DOOR.y, DOOR.z), null), null,
    'the open state is a simulated client view, not a map object');
  assert.equal(canWalk([2857, 2323], [2858, 2323]), false,
    'the server keeps the wall clipping; only the scripted player crosses');

  h.tick(3);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2858, 2323],
    'the trusted queued one-tile enter lands on the door tile');
  assert.equal(ObstacleRunner.isBusy(p), false, 'crossing permission restored on finish');
  const afterEnter = sentIds(p, ['sendObject', 'sendObjectRemoval']).slice(3);
  assert.deepEqual(afterEnter, [
    ['sendObjectRemoval', 38848, 0, 0],
    ['sendObjectRemoval', 60019, 0, 0],
    ['sendObject', 60018, 0, 0],
  ], 'captured raw states close after 2 ticks');

  // Reverse exit from the later Door op: the same normal Open walks back west.
  const exit = { player: p, object: closed, objectId: 60018, definition: { id: 60018 }, handled: false };
  h.hooks.onObjectInteraction[0](exit);
  assert.equal(exit.handled, true, 'the later Door op is the normal exit');
  h.tick(3);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2857, 2323],
    'reverse exit crosses back one tile');
  assert.equal(ObstacleRunner.isBusy(p), false);
  assert.equal(h.quest.getStage(p), 24);

  // Wrong tile / wrong type are not swallowed.
  for (const [id, x, y] of [[60018, 2857, 2323], [60020, DOOR.x, DOOR.y]]) {
    const other = { player: p, objectId: id, location: new core.Location(x, y, 0), handled: false };
    h.hooks.onObjectInteraction[0](other);
    assert.equal(other.handled, false, `unrelated object ${id}@${x},${y} is not handled`);
  }
  assert.equal(ObstacleRunner.isBusy(p), false);

  // Logout cancels any pending crossing permission.
  const again = { player: p, object: closed, objectId: 60018, definition: { id: 60018 }, handled: false };
  h.hooks.onObjectInteraction[0](again);
  assert.equal(ObstacleRunner.isBusy(p), true);
  h.logout(p);
  assert.equal(ObstacleRunner.isBusy(p), false);
});
