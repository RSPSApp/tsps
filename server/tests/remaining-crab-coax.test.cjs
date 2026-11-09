const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

const CACHE = path.resolve(__dirname, '..');
const SIT_SLOT = 54;
const SIT_LOOP = 10061; // emote_sit_loop, interface 216 child 54 (cache enum 1001 -> 5248)

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(CACHE);
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

function setup() {
  const hooks = { custom: new Map(), objects: [], login: [], npcs: [], ground: [] };
  const attrs = new Map();
  const inventory = new Map();
  const messages = [];
  const persistentKeys = new Map();
  const placed = [];
  const spawned = [];
  const removed = [];
  const tasks = [];
  const xp = [];
  const varbits = [];
  const varValues = new Map();
  const groundItems = [];
  let area = null;
  let currentDialogue = null;
  let location = { x: 3041, y: 2638, z: 0 };
  const core = {
    ...PluginManager.getCoreApi(),
    ObjectManager: {
      register(object) { placed.push({ id: object.getId(), x: object.getLocation().getX(), y: object.getLocation().getY() }); },
      deregister() {},
    },
    TaskManager: {
      submit(task) { task.setRunning?.(true); tasks.push(task); },
      cancelTasks(key) { for (const task of tasks) if (task.key === key) task.stop?.(); },
    },
  };
  const api = new Proxy({
    core,
    persistAttribute(key, defaultValue) { persistentKeys.set(key, defaultValue); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn({ player, ...event }); },
    onNpcDialogueCondition() {},
    onNpcInteraction(fn) { hooks.npcs.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnItem() {},
    onGroundItemPickup(fn) { hooks.ground.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout() {},
    onNpcDialogueVariant() {},
    spawnNpc(definition) {
      const npc = {
        definition,
        registered: true,
        getIndex: () => 100 + spawned.length,
        getId: () => definition.id,
        getRealId: () => definition.id,
        getLocation: () => new core.Location(definition.x ?? 0, definition.y ?? 0, definition.z ?? 0),
        getArea: () => npc.__area,
        setArea: (value) => { npc.__area = value; },
        getPrivateArea: () => npc.__area,
        isRegistered: () => npc.registered,
        isOwnerOnly: () => definition.ownerOnly,
        getOwner: () => definition.owner,
        setPositionToFace() {},
        performAnimation() {},
        moveTo() {},
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { npc.registered = false; removed.push(npc); },
    getItemOnGroundManager() { return { getGroundItem: () => undefined, registerLocation(_player, item, position) { groundItems.push({ id: item.getId(), x: position.getX(), y: position.getY() }); } }; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.push({ id, value }); varValues.set(id, value); return sender; },
    sendConfig(id, value) { varValues.set(id, value); return sender; },
    getVarbit(id) { return varValues.get(id) ?? 0; },
    getVarp(id) { return varValues.get(id) ?? 0; },
    sendInterface() { return sender; },
    sendInterfaceScript() { return sender; },
    sendInterfaceRemoval() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      getFreeSlots: () => 28,
      isFull: () => false,
    }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences(skill, amount) { xp.push([skill, amount]); } }),
    getLocation: () => location.getX ? location : new core.Location(location.x, location.y, location.z),
    moveTo(value) { location = value; },
    getDialogueManager: () => ({
      isActive: () => currentDialogue !== null,
      startDialogues(chain) { currentDialogue = chain; },
      getCurrent: () => currentDialogue,
      reset() { currentDialogue = null; },
    }),
    getArea: () => area,
    setArea: (value) => { area = value; },
    getPrivateArea: () => area instanceof core.PrivateArea ? area : null,
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    setUntargetable() {},
    getEquipment: () => ({ getItems: () => [] }),
    getUsername: () => 'crab-coax-test',
    getIndex: () => 1,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return player; },
    isPlayerBot: () => false,
  };
  const loadQuest = () => {
    const file = path.join(__dirname, '..', 'plugins', 'quests', 'quests', 'CrabQuest.Quest.js');
    delete require.cache[require.resolve(file)];
    require(file)(api);
    return runtime.getRegisteredQuests().filter((quest) => quest.key === 'crab_quest').at(-1);
  };
  const emit = (name, event) => api.emitCustomEvent(name, event);
  const investigate = (objectId, x, y) => {
    const definition = core.ObjectDefinition.forId(objectId);
    const location = { x, y, z: 0 };
    for (const fn of hooks.objects) fn({ player, objectId, clickType: 1, location, definition });
  };
  const pickup = (groundItemId, x, y) => {
    for (const fn of hooks.ground) fn({ player, groundItemId, location: { x, y, z: 0 } });
  };
  const tick = (count = 1) => { while (count-- > 0) for (const task of [...tasks]) task.tick?.(); };
  const sit = (x, y, slot = SIT_SLOT) => {
    player.moveTo({ x, y, z: 0 });
    emit('player:emote', { slot, sequence: SIT_LOOP });
  };
  return { core, hooks, attrs, inventory, messages, persistentKeys, placed, spawned, removed, tasks, xp, varbits, varValues, groundItems, player, loadQuest, emit, investigate, pickup, sit, tick, setLocation(x, y) { location = { x, y, z: 0 }; }, get area() { return area; }, get currentDialogue() { return currentDialogue; } };
}

// `bit` is the spot-array index bit used by SCARED/MET (join bits differ).
const SIT_SPOTS = [
  { id: 62473, x: 3043, y: 2640, sit: [3042, 2640], bit: 1 << 0 },
  { id: 62470, x: 3042, y: 2637, sit: [3041, 2638], bit: 1 << 1 },
  { id: 62475, x: 3037, y: 2644, sit: [3037, 2643], bit: 1 << 3 },
  { id: 62475, x: 3047, y: 2656, sit: [3046, 2655], bit: 1 << 9 },
];

test('Crab coax needs the real Sit emote after the too-scared investigate', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 47);
  for (const spot of SIT_SPOTS) {
    h.setLocation(spot.sit[0], spot.sit[1]);
    h.investigate(spot.id, spot.x, spot.y);
    assert.ok((h.attrs.get('quest.crab_quest.scared') & spot.bit) !== 0, `spot ${spot.id} set scared`);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `spot ${spot.id} not coaxed by investigate`);

    h.investigate(spot.id, spot.x, spot.y);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `second investigate does not coax ${spot.id}`);

    h.sit(spot.sit[0], spot.sit[1], 12);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, 'a different emote does not coax');

    h.sit(spot.sit[0] + 1, spot.sit[1] + 1);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, 'Sit on the wrong tile does not coax');

    h.sit(spot.sit[0], spot.sit[1]);
    assert.ok((h.attrs.get('quest.crab_quest.met') & spot.bit) !== 0, `Sit at ${spot.sit} coaxes ${spot.id}`);
    assert.ok(h.messages.includes('And now, you wait...'));
  }
  // The captured crab chathead is crab_bandcrab 16483; its join action must count.
  h.emit('npc-dialogue:action', { npcId: 16483, stepId: '5WiO-g' });
  assert.ok((h.attrs.get('quest.crab_quest.recruited') & (1 << 0)) !== 0, 'bandcrab chathead action sets the join bit');
});

test('Crab does not place the solid flavor palm that sealed the recruit pocket', () => {
  const h = setup();
  h.loadQuest();
  for (const fn of h.hooks.login) fn({ player: h.player });
  assert.ok(h.placed.some((entry) => entry.id === 62473 && entry.x === 3043 && entry.y === 2640), 'magic tree placed');
  assert.ok(h.placed.some((entry) => entry.id === 62470 && entry.x === 3042 && entry.y === 2637), 'palm south placed');
  assert.ok(!h.placed.some((entry) => entry.id === 62470 && entry.x === 3039 && entry.y === 2644), 'the 3039,2644 flavor palm must not be placed');
  assert.equal(h.persistentKeys.get('crab-quest:shy-met'), false, 'shy-met defaults false');
});

test('Crab spawns raw NPC/object parents and lets the cache publish content children', () => {
  const h = setup();
  const quest = h.loadQuest();
  const vars = h.player.getPacketSender();
  const resolvedNpc = (id) => CacheDefinitions.resolveNpc(id, vars)?.id;

  quest.setStage(h.player, 25);
  for (const fn of h.hooks.login) fn({ player: h.player });

  assert.ok(h.spawned.some((npc) => npc.getId() === 16469), 'main crab spawns raw 16469');
  assert.equal(resolvedNpc(16469), 16471, 'cache publishes the stage-25 child 16471');
  assert.deepEqual(h.core.NpcDefinition.forId(16471).getActions().filter(Boolean), ['Talk-to'], 'dialogue head remains 16471');
  const rawInteraction = {
    player: h.player,
    npcId: 16469,
    clickType: 1,
    definition: h.core.NpcDefinition.forId(16471),
    handled: false,
  };
  h.hooks.npcs.at(-1)(rawInteraction);
  assert.equal(rawInteraction.handled, true, 'raw main-crab packet id routes to the main dialogue');

  assert.ok(h.placed.some((entry) => entry.id === 62438 && entry.x === 3055 && entry.y === 2639), 'raw bottle 62438 is registered');
  assert.ok(!h.placed.some((entry) => entry.id === 62439 || entry.id === 62440), 'bottle children are not registered directly');
  assert.ok(!h.placed.some((entry) => entry.id === 34588), 'stale QH bottle 34588 is never registered');
  assert.equal(h.core.ObjectDefinition.forPlayer(62438, h.player).getInteractions()[0], 'Drink', 'stage 25 bottle resolves to 62439 Drink');
  const bottleEvent = {
    player: h.player,
    objectId: 62438,
    clickType: 1,
    location: { x: 3055, y: 2639, z: 0 },
    definition: h.core.ObjectDefinition.forPlayer(62438, h.player),
    handled: false,
  };
  for (const fn of h.hooks.objects) fn(bottleEvent);
  assert.equal(bottleEvent.handled, true, 'raw bottle packet id is clickable');

  const recruiting = setup();
  const recruitingQuest = recruiting.loadQuest();
  recruitingQuest.setStage(recruiting.player, 47);
  for (const fn of recruiting.hooks.login) fn({ player: recruiting.player });
  assert.ok(recruiting.spawned.some((npc) => npc.getId() === 16470), 'recruiting spawns raw practising 16470');
  assert.equal(CacheDefinitions.resolveNpc(16470, recruiting.player.getPacketSender())?.id, 16474, 'stage 47 resolves to 16474');

  recruitingQuest.setStage(recruiting.player, 45);
  assert.equal(CacheDefinitions.resolveNpc(16470, recruiting.player.getPacketSender())?.id, 16473, 'stage 45 resolves to 16473');

  const complete = setup();
  const completeQuest = complete.loadQuest();
  completeQuest.setStage(complete.player, 63);
  for (const fn of complete.hooks.login) fn({ player: complete.player });
  assert.ok(!complete.spawned.some((npc) => [16469, 16470].includes(npc.getId())), 'completion removes the main crab spawn');
  assert.equal(complete.core.ObjectDefinition.forPlayer(62438, complete.player).getInteractions()[0], 'Reminisce', 'stage 63 bottle resolves to 62440 Reminisce');
});

test('Crab replaces 16469 with 16470 once for one continuous player and clears on completion', () => {
  const h = setup();
  const quest = h.loadQuest();
  const vars = h.player.getPacketSender();
  const mainSpawns = () => h.spawned.filter((npc) => [16469, 16470].includes(npc.getId()));

  quest.setStage(h.player, 40);
  for (const fn of h.hooks.login) fn({ player: h.player });
  assert.equal(mainSpawns().length, 1, 'one main actor after login');
  assert.equal(mainSpawns()[0].getId(), 16469, 'stages below 45 use raw 16469');
  assert.equal(CacheDefinitions.resolveNpc(16469, vars)?.id, 16471, 'stage 40 content is 16471');

  h.emit('npc-dialogue:action', { npcId: 16471, stepId: 'YAKnYw' });
  assert.equal(quest.getStage(h.player), 45);
  const liveAt45 = mainSpawns().filter((npc) => npc.isRegistered());
  assert.equal(liveAt45.length, 1, 'exactly one live main actor at 45');
  assert.equal(liveAt45[0].getId(), 16470, 'raw actor switched to 16470');
  assert.equal(h.spawned.filter((npc) => npc.getId() === 16469).length, 1, '16469 was not spawned twice');
  assert.equal(h.spawned.filter((npc) => npc.getId() === 16470).length, 1, '16470 was spawned exactly once');
  assert.equal(mainSpawns().find((npc) => npc.getId() === 16469).isRegistered(), false, 'old 16469 actor removed');
  assert.equal(CacheDefinitions.resolveNpc(16470, vars)?.id, 16473, 'stage 45 content is 16473');

  h.emit('npc-dialogue:action', { npcId: 16471, stepId: 'zUZGcG' });
  assert.equal(quest.getStage(h.player), 47);
  assert.equal(h.spawned.filter((npc) => npc.getId() === 16470).length, 1, '47 does not replace again');
  assert.equal(CacheDefinitions.resolveNpc(16470, vars)?.id, 16474, 'stage 47 content is 16474');

  const joins = ['5WiO-g', 'OrHsAs', 'uxsvrh', 'XBEBvy', 'XffNTB', 'MVf-5E', 'yUuVKM', 'nJXHcW', 'ByoUzK', 'UtfH3c', 'beb_BL'];
  for (const stepId of joins) h.emit('npc-dialogue:action', { npcId: 16471, stepId });
  assert.equal(quest.getStage(h.player), 50);
  assert.equal(h.spawned.filter((npc) => npc.getId() === 16470).length, 1, 'recruiting does not duplicate the actor');

  h.emit('npc-dialogue:action', { npcId: 16471, stepId: 'uZozUI' });
  assert.equal(quest.getStage(h.player), 55);
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'UOa-Sd' });
  assert.equal(quest.getStage(h.player), 60);
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'twF4TG' });
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(quest.getStage(h.player), 63);
  assert.equal(mainSpawns().filter((npc) => npc.isRegistered()).length, 0, 'completion leaves no live main actor');
});

test('Crab recruit pocket is reachable once the 3039,2644 flavor palm is skipped (real cache pathfinder)', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  ObjectDefinition.init();
  RegionManager.init();

  const spots = [
    [62473, 3043, 2640], [62470, 3042, 2637], [62470, 3039, 2644], [62475, 3037, 2644],
    [62470, 3037, 2647], [62470, 3039, 2647], [62470, 3040, 2649], [62470, 3048, 2658],
    [62470, 3040, 2636], [62475, 3047, 2656], [62475, 3063, 2653], [62477, 3054, 2656],
    [62478, 3050, 2636], [62478, 3057, 2640],
  ];
  const objects = spots.map(([id, x, y]) => new GameObject(id, new Location(x, y, 0), 10, 0, null));
  for (const object of objects) MapObjects.add(object);

  const reachable = () => {
    const start = [3039, 2645];
    const seen = new Set([start.join(',')]);
    const queue = [start];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || RegionManager.getClipping(nx, ny, 0, null) !== 0) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  const sealed = reachable();
  assert.equal(sealed.has('3042,2640'), false, 'solid 3039,2644 palm seals the magic tree');
  assert.equal(sealed.has('3041,2637'), false, 'solid 3039,2644 palm seals the palm south');

  const flavor = objects[2];
  MapObjects.remove(flavor);
  RegionManager.removeObjectClipping(flavor);
  const open = reachable();
  assert.equal(open.has('3042,2640'), true, 'magic tree reachable once the flavor palm is skipped');
  assert.equal(open.has('3041,2637'), true, 'palm south reachable once the flavor palm is skipped');
});

test('Crab tree NW sits at 3037,2643; the 2x2 tree refuses 3038,2644', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  ObjectDefinition.init();
  RegionManager.init();
  MapObjects.add(new GameObject(62475, new Location(3037, 2644, 0), 10, 0, null));
  assert.notEqual(RegionManager.getClipping(3038, 2644, 0, null), 0, '3038,2644 is inside the 2x2 tree');
  assert.equal(RegionManager.getClipping(3037, 2643, 0, null), 0, '3037,2643 is walkable');

  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 47);
  h.setLocation(3037, 2643);
  h.investigate(62475, 3037, 2644);
  assert.ok((h.attrs.get('quest.crab_quest.scared') & (1 << 3)) !== 0, 'tree NW scared bit 3');
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'no auto-coax');
  h.investigate(62475, 3037, 2644);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'second investigate does not coax');
  h.sit(3038, 2644);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'Sit on the tree/NPC-spawn tile is refused');
  h.sit(3037, 2643);
  assert.ok((h.attrs.get('quest.crab_quest.met') & (1 << 3)) !== 0, 'captured Sit tile 3037,2643 coaxes');
});

test('Crab dance and ceremony use the captured talkable main crab end and complete once', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 50);
  h.emit('npc-dialogue:action', { npcId: 16471, stepId: 'uZozUI' });
  assert.equal(quest.getStage(h.player), 55, 'dance scene starts at 55');

  const endDefinition = h.core.NpcDefinition.forId(16474);
  assert.deepEqual(endDefinition.getActions().filter(Boolean), ['Talk-to'], 'cache 16474 is talkable');
  const danceNpc = h.spawned.find((npc) => npc.getId() === 16474);
  assert.ok(danceNpc, 'crab_maincrab_end 16474 spawned in the dance scene');
  assert.deepEqual([danceNpc.getLocation().getX(), danceNpc.getLocation().getY()], [3062, 2641], 'captured dance NPC tile');
  assert.ok(danceNpc.getArea(), 'dance NPC attached to the private scene area');
  assert.ok(h.placed.some((entry) => entry.id === 62479 && entry.x === 3062 && entry.y === 2641), 'crab circle 62479');
  assert.ok(h.placed.some((entry) => entry.id === 62480 && entry.x === 3062 && entry.y === 2642), 'human circle 62480');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [3062, 2642], 'captured player tile');

  // Real NPC option dispatch: Talk-to on the scene NPC starts the stage-55 transcript.
  h.hooks.npcs.at(-1)({ player: h.player, npcId: 16474, clickType: 1, definition: endDefinition });
  assert.ok(h.currentDialogue, 'stage-55 transcript started');
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'UOa-Sd' });
  assert.equal(quest.getStage(h.player), 60, 'dance transcript ends at 60');

  // Talking again opens the ceremony scene and spawns its own talkable 16474.
  h.hooks.npcs.at(-1)({ player: h.player, npcId: 16474, clickType: 1, definition: endDefinition });
  h.tick(1);
  const ceremonyNpc = h.spawned.filter((npc) => npc.getId() === 16474).at(-1);
  assert.deepEqual([ceremonyNpc.getLocation().getX(), ceremonyNpc.getLocation().getY()], [3062, 2643], 'captured ceremony NPC tile');
  assert.ok(ceremonyNpc.getArea(), 'ceremony NPC attached to the private scene area');
  assert.equal(danceNpc.isRegistered(), false, 'dance scene actor removed, not left as a ghost');

  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'twF4TG' });
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(quest.getStage(h.player), 63);
  assert.equal(quest.isComplete(h.player), true);
  assert.equal(h.inventory.get(34589), 1, 'Shell collection once');
  assert.deepEqual(h.xp.map(([, amount]) => amount).sort((a, b) => a - b), [3000, 10000], 'Sailing/Fishing rewards once');
  assert.equal(ceremonyNpc.isRegistered(), false, 'ceremony actor removed on completion');
  const sceneSpawns = h.spawned.filter((npc) => [16480, 16482, 16474].includes(npc.getId()));
  assert.ok(sceneSpawns.every((npc) => !npc.isRegistered()), 'no phantom scene NPCs after cleanup');

  // A repeated completion action cannot grant the reward twice.
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(h.inventory.get(34589), 1);
  assert.equal(h.xp.length, 2);
});

test('Crab login at 55 and 60 restores the real scene actors', () => {
  const dance = setup();
  const danceQuest = dance.loadQuest();
  danceQuest.setStage(dance.player, 55);
  dance.player.moveTo(new dance.core.Location(3062, 2642, 0));
  for (const fn of dance.hooks.login) fn({ player: dance.player });
  assert.ok(dance.player.getPrivateArea(), 'stage-55 login restored the private scene');
  assert.ok(dance.spawned.some((npc) => npc.getId() === 16474), 'stage-55 login restored the main crab end');
  assert.ok(dance.placed.some((entry) => entry.id === 62480));

  const ceremony = setup();
  const ceremonyQuest = ceremony.loadQuest();
  ceremonyQuest.setStage(ceremony.player, 60);
  ceremony.player.moveTo(new ceremony.core.Location(3062, 2642, 0));
  for (const fn of ceremony.hooks.login) fn({ player: ceremony.player });
  ceremony.tick(1);
  assert.ok(ceremony.player.getPrivateArea(), 'stage-60 login restored the private scene');
  const endNpc = ceremony.spawned.find((npc) => npc.getId() === 16474);
  assert.deepEqual([endNpc.getLocation().getX(), endNpc.getLocation().getY()], [3062, 2643], 'stage-60 main crab end restored');
});

test('Crab publishes native sub-varbits for shells, floatsam and recruits without advancing', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const quest = h.loadQuest();

  quest.setStage(h.player, 25);
  h.varbits.length = 0;
  h.pickup(34575, 3059, 2648); // crab_shell_1 at the QH shellOne tile
  assert.equal(valueOf(h, 15844), 0, 'a picked but unhanded shell is not a returned native bit');
  assert.equal(valueOf(h, 15845), 0);
  assert.equal(quest.getStage(h.player), 25, 'publishing shells does not advance');

  h.inventory.set(34575, 1); // the pickup puts the shell in the inventory
  h.varbits.length = 0;
  h.hooks.npcs.at(-1)({
    player: h.player,
    npcId: 16471,
    clickType: 1,
    definition: h.core.NpcDefinition.forId(16471),
  });
  assert.equal(valueOf(h, 15844), 1, 'handing in crab_shell_1 sets crab_seashell_1');
  assert.equal(valueOf(h, 15845), 0, 'other colours stay zero');
  assert.equal(valueOf(h, 15846), 0);
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'handed count still advances once');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0, 'per-colour handed mask recorded at consume');
  assert.equal(quest.getStage(h.player), 25, 'handing in one shell does not advance');

  quest.setStage(h.player, 35);
  h.inventory.set(305, 1); // big fishing net
  h.varbits.length = 0;
  h.hooks.npcs.at(-1)({
    player: h.player,
    npcId: 16817, // Flotsam (16475 Floatsam before rev 242)
    clickType: 1,
    definition: { getActions: () => ['Net'] },
  });
  assert.equal(valueOf(h, 15852), 3, 'one native net action hides all three floatsam materials');
  assert.equal(quest.getStage(h.player), 37, 'materials still reach the established 37 stage');

  quest.setStage(h.player, 47);
  h.varbits.length = 0;
  h.emit('npc-dialogue:action', { npcId: 16483, stepId: '5WiO-g' }); // magic tree = QH crabSix
  assert.equal(valueOf(h, 15858), 1, 'magic tree sets bandmate_6');
  assert.equal(valueOf(h, 15874), 1, 'magic tree sets recruited_bandmate_6');
  assert.equal(valueOf(h, 15853), 0, 'other bandmate bits stay clear');
  assert.equal(quest.getStage(h.player), 47, 'recruiting one leader does not advance');

  h.emit('npc-dialogue:action', { npcId: 16485, stepId: 'yUuVKM' }); // penguin palm = crabSeven
  assert.equal(valueOf(h, 15859), 1, 'penguin palm sets bandmate_7');
  assert.equal(valueOf(h, 15875), 1, 'penguin palm sets recruited_bandmate_7');
  assert.equal(valueOf(h, 15867), 1, 'penguin recruitment publishes the kicked-penguin flag');
  assert.equal(quest.getStage(h.player), 47);
});

test('Crab blocks unproven partial progress and login restores every native flag', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 47);

  const firstSix = ['5WiO-g', 'OrHsAs', 'uxsvrh', 'XBEBvy', 'XffNTB', 'MVf-5E'];
  for (const stepId of firstSix) h.emit('npc-dialogue:action', { npcId: 16483, stepId });
  assert.equal(valueOf(h, 15881), 0, 'six leaders do not publish partial complete');

  const nextFour = ['yUuVKM', 'nJXHcW', 'ByoUzK', 'UtfH3c'];
  for (const stepId of nextFour) h.emit('npc-dialogue:action', { npcId: 16483, stepId });
  assert.equal(valueOf(h, 15881), 0, 'ten leaders do not publish a guessed partial threshold');
  assert.equal(quest.getStage(h.player), 47, 'partial complete does not advance the quest');

  h.attrs.set('quest.crab_quest.shells-handed', 2);
  h.attrs.set('crab-quest:shells-handed-mask', (1 << 0) | (1 << 2));
  h.attrs.set('quest.crab_quest.materials-fished', true);
  h.attrs.set('crab-quest:shy-progress', 3);
  h.varbits.length = 0;

  for (const fn of h.hooks.login) fn({ player: h.player });

  const published = h.varbits.map((entry) => entry.id).filter((id) => id >= 15844 && id <= 15881 && id !== 15842);
  const expected = [
    15844, 15845, 15846, 15847, 15848, 15849, 15850, // seashells
    15852, // floatsam
    15853, 15869, 15854, 15870, 15855, 15871, 15856, 15872, 15857, 15873, 15858, 15874,
    15859, 15875, 15860, 15876, 15861, 15877, 15862, 15878, 15863, 15879,
    15865, // shy
    15867, // kicked penguin
    15868, // in quest
    15881, // partial complete
  ];
  assert.deepEqual(published, expected, 'login restores the sub-varbits in a stable order');
  assert.equal(valueOf(h, 15844), 1, 'handed shell 1 restored');
  assert.equal(valueOf(h, 15845), 0, 'unhanded shell stays zero');
  assert.equal(valueOf(h, 15846), 1, 'handed shell 3 restored');
  assert.equal(valueOf(h, 15852), 3, 'fished floatsam restored');
  assert.equal(valueOf(h, 15865), 2, 'scuttered shy crab restored at 2');
  assert.equal(valueOf(h, 15867), 1, 'penguin flag restored');
  assert.equal(valueOf(h, 15868), 1, 'active quest restores the instance flag');
  assert.equal(valueOf(h, 15881), 0, 'blocked partial stays zero on login');
  assert.equal(quest.getStage(h.player), 47, 'login publication does not advance');
});

test('Crab legacy hand-in count derives colours only when complete and never from pickups', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const partial = setup();
  const partialQuest = partial.loadQuest();
  partialQuest.setStage(partial.player, 30);
  partial.attrs.set('quest.crab_quest.shells-handed', 3);
  partial.attrs.set('quest.crab_quest.shells-picked', 0b1111111);
  for (const fn of partial.hooks.login) fn({ player: partial.player });
  for (let index = 0; index < 7; index++) {
    assert.equal(valueOf(partial, 15844 + index), 0, `legacy partial count does not guess shell ${index + 1}`);
  }
  assert.equal(partialQuest.getStage(partial.player), 30);

  const complete = setup();
  const completeQuest = complete.loadQuest();
  completeQuest.setStage(complete.player, 30);
  complete.attrs.set('quest.crab_quest.shells-handed', 7);
  for (const fn of complete.hooks.login) fn({ player: complete.player });
  for (let index = 0; index < 7; index++) {
    assert.equal(valueOf(complete, 15844 + index), 1, `completed hand-in count derives shell ${index + 1}`);
  }
  assert.equal(completeQuest.getStage(complete.player), 30);
});

test('Crab does not count a duplicate colour towards the seven shells', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 25);
  const talk = () => h.hooks.npcs.at(-1)({
    player: h.player,
    npcId: 16471,
    clickType: 1,
    definition: h.core.NpcDefinition.forId(16471),
  });

  h.inventory.set(34575, 2);
  talk();
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'first colour counted once');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0);

  talk();
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'duplicate colour does not increment again');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0);
  assert.equal(h.inventory.get(34575), 0, 'duplicate shell is still consumed');
  assert.equal(quest.getStage(h.player), 25, 'duplicate colour cannot reach the seven-shell stage');
});

test('Crab re-registers picked-then-lost shells and net but not handed-in or held ones', () => {
  const lostShell = setup();
  lostShell.loadQuest().setStage(lostShell.player, 25);
  lostShell.attrs.set('quest.crab_quest.shells-picked', 1 << 0);
  for (const fn of lostShell.hooks.login) fn({ player: lostShell.player });
  assert.ok(lostShell.groundItems.some((item) => item.id === 34575 && item.x === 3059 && item.y === 2648), 'lost picked shell respawns at its canonical tile');

  const handedShell = setup();
  handedShell.loadQuest().setStage(handedShell.player, 25);
  handedShell.attrs.set('quest.crab_quest.shells-picked', 1 << 0);
  handedShell.attrs.set('crab-quest:shells-handed-mask', 1 << 0);
  for (const fn of handedShell.hooks.login) fn({ player: handedShell.player });
  assert.ok(!handedShell.groundItems.some((item) => item.id === 34575), 'handed-in shell does not respawn');

  const heldShell = setup();
  heldShell.loadQuest().setStage(heldShell.player, 25);
  heldShell.attrs.set('quest.crab_quest.shells-picked', 1 << 0);
  heldShell.inventory.set(34575, 1);
  for (const fn of heldShell.hooks.login) fn({ player: heldShell.player });
  assert.ok(!heldShell.groundItems.some((item) => item.id === 34575), 'held shell does not duplicate');

  const lostNet = setup();
  lostNet.loadQuest().setStage(lostNet.player, 35);
  lostNet.attrs.set('quest.crab_quest.net-picked', 1);
  for (const fn of lostNet.hooks.login) fn({ player: lostNet.player });
  assert.ok(lostNet.groundItems.some((item) => item.id === 305 && item.x === 3061 && item.y === 2646), 'lost picked net respawns at its canonical tile');

  const heldNet = setup();
  heldNet.loadQuest().setStage(heldNet.player, 35);
  heldNet.attrs.set('quest.crab_quest.net-picked', 1);
  heldNet.inventory.set(305, 1);
  for (const fn of heldNet.hooks.login) fn({ player: heldNet.player });
  assert.ok(!heldNet.groundItems.some((item) => item.id === 305), 'held net does not duplicate');
});

test('Crab shy palm conversation reaches 15865=2 only through the captured blush and scutter', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 47);

  h.investigate(62472, 3044, 2653); // crab_palm_update03
  assert.ok(h.messages.includes('A crab comes out shyly.'));
  const found = h.spawned.filter((npc) => npc.getId() === 16484).at(-1);
  assert.deepEqual([found.getLocation().getX(), found.getLocation().getY()], [3045, 2653], 'captured shy spawn tile');
  assert.equal(valueOf(h, 15865), 0, 'finding the palm does not publish shy progress');
  assert.ok(h.currentDialogue, 'investigating the palm starts the captured conversation');
  const dialogueTexts = [...h.currentDialogue.getDialogues().values()]
    .map((entry) => entry.getText?.())
    .filter(Boolean);
  assert.ok(dialogueTexts.some((text) => text.includes("Oh. Sorry. You've come to the wrong crab!")), 'captured opening line plays');
  assert.ok(dialogueTexts.some((text) => text.includes('If only I could be more like...')), 'captured pre-blush line plays');

  h.hooks.npcs.at(-1)({
    player: h.player,
    npcId: 16484,
    clickType: 1,
    definition: h.core.NpcDefinition.forId(16484),
  });
  assert.equal(valueOf(h, 15865), 0, 'talking alone does not force 2');

  h.emit('npc-dialogue:action', { npcId: 16484, stepId: 'shy-crab-blush' });
  assert.equal(valueOf(h, 15865), 1, 'captured blush publishes 1');
  assert.ok(h.messages.includes('The crab appears to turn bright red.'));
  assert.equal(quest.getStage(h.player), 47);

  h.emit('npc-dialogue:action', { npcId: 16484, stepId: 'shy-crab-scutter' });
  assert.equal(valueOf(h, 15865), 2, 'captured scutter publishes 2');
  assert.ok(h.messages.includes('The crab scutters away.'));
  const relocated = h.spawned.filter((npc) => npc.getId() === 16484).at(-1);
  assert.deepEqual([relocated.getLocation().getX(), relocated.getLocation().getY()], [3055, 2650], 'captured scutter tile');
  assert.equal(found.isRegistered(), false, 'the old shy crab is removed');
  assert.equal(quest.getStage(h.player), 47, 'shy conversation does not advance the quest');

  const relog = setup();
  const relogQuest = relog.loadQuest();
  relogQuest.setStage(relog.player, 47);
  relog.attrs.set('crab-quest:shy-progress', 3);
  for (const fn of relog.hooks.login) fn({ player: relog.player });
  const restored = relog.spawned.filter((npc) => npc.getId() === 16484).at(-1);
  assert.deepEqual([restored.getLocation().getX(), restored.getLocation().getY()], [3055, 2650], 'login restores the scuttered tile');
  assert.equal(valueOf(relog, 15865), 2);

  const legacy = setup();
  const legacyQuest = legacy.loadQuest();
  legacyQuest.setStage(legacy.player, 47);
  legacy.attrs.set('crab-quest:shy-met', true);
  for (const fn of legacy.hooks.login) fn({ player: legacy.player });
  assert.equal(valueOf(legacy, 15865), 0, 'legacy met state is not upgraded to blush or scutter');
});

test('Crab clears the native instance flag on completion only', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 60);
  h.varbits.length = 0;
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(quest.getStage(h.player), 63, 'ceremony completion still reaches 63');
  assert.equal(valueOf(h, 15868), 0, 'completed quest leaves the instance flag clear');
  assert.equal(valueOf(h, 15842), 63, 'stage varbit still publishes 63');
});

test('Crab Sit uses the real cached slot 54 loop', () => {
  const Emotes = require('../plugins/interface/Emotes.plugin');
  const player = { getEquipment: () => ({ getItems: () => [] }) };
  assert.deepEqual(Emotes._test.resolveEmote(player, SIT_SLOT, 1, {}), { sequence: SIT_LOOP, graphic: undefined });
});

// Native registered bottle, mooring and spell consumers. The fixture drives the real dialogue
// manager and scheduled sailing tasks; it does not claim a decoded click or a sailing journey.
test('native Crab bottle dream state and travel consumers', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const { GameConstants } = require('../dist/game/GameConstants');
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const priorBots = process.env.DISABLE_PLAYER_BOTS;
  process.env.DISABLE_PLAYER_BOTS = '1';
  const actors = [], steps = new WeakMap();
  let started = false;
  const core = PluginManager.getCoreApi();
  t.after(() => {
    try {
      for (const p of actors) {
        if (p.isRegistered()) {
          core.Sailing.onLogout(p);
          PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
        }
        core.TaskManager.cancelTasks(p);
        core.TaskManager.cancelTasks(p.getIndex());
        for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === p) PluginManager.removeNpc(npc);
        if (p.isRegistered()) core.World.getPlayers().remove(p);
      }
      if (started) PluginManager.emitServerShutdown({});
      core.World.refreshActiveRegions();
    } finally {
      if (priorBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
      else process.env.DISABLE_PLAYER_BOTS = priorBots;
    }
  });
  // The preceding fake-API controls initialized QuestRuntime's singleton.
  // Reload both modules before registering the real plugin handlers.
  delete require.cache[require.resolve('../plugins/quests/QuestRuntime')];
  delete require.cache[require.resolve('../plugins/quests/quests/CrabQuest.Quest.js')];
  assert.notEqual(require('../plugins/quests/QuestRuntime'), runtime);
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3055, 2639);
  core.RegionManager.loadMapFiles(3213, 3424);
  core.RegionManager.loadMapFiles(3051, 3193);
  core.ObjectDefinition.init();
  new NpcDefinitionLoader().load();
  started = true;
  PluginManager.emitServerStartup({});
  PluginManager.createApi('crab-dream-observer').onCustomEvent('npc-dialogue:action', e => {
    if (e.player && e.kind === 'message') steps.get(e.player)?.add(e.stepId);
  });
  let serial = 0;
  const tick = (n = 1) => { while (n-- > 0) core.World.process(); };
  const until = (p, predicate) => {
    const m = p.getDialogueManager();
    for (let i = 0; i < 300 && !predicate(); i++) {
      const current = m.getCurrent();
      if (current instanceof core.OptionDialogue) assert.fail('unexpected native option owner');
      else if (current instanceof core.ActionDialogue && current.isSelfAdvancing()) tick();
      else if (current) m.advance();
      else tick();
    }
    assert.ok(predicate(), 'real dialogue reached the requested step');
  };
  function actor(test, name = `crab${++serial}`) {
    const channel = { kind:'test', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){} };
    const session = new PlayerSession(channel), p = new Player(session, new core.Location(3055, 2639, 0));
    session.setPlayer(p);
    p.setUsername(name);
    p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
    assert.notEqual(p.getLongUsername(), 0n);
    test.mock.method(p, 'onAdd', () => {});
    test.mock.method(p, 'onRemove', () => {});
    test.after(() => {
      const fishier = require('../plugins/skills/sailing/charting/FishierStout.Charting');
      const scene = fishier.scenes.get(p), ownedNpcs = scene ? [...scene.npcs] : [];
      try {
        core.Sailing.onLogout(p);
        if (p.isRegistered()) PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      } finally {
        core.TaskManager.cancelTasks(p);
        core.TaskManager.cancelTasks(p.getIndex());
        if (scene) core.TaskManager.cancelTasks(scene);
        for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === p) PluginManager.removeNpc(npc);
        if (p.getArea()?.hasMember?.(p)) p.getArea().leave(p, false);
        if (p.isRegistered()) core.World.getPlayers().remove(p);
      }
      assert.equal(p.isRegistered(), false, 'owned actor released before its mocks restore');
      assert.equal(core.Sailing.instanceFor(p), undefined, 'owned boat instance released');
      if (scene) { assert.equal(fishier.scenes.has(p), false); if (scene.area) assert.equal(scene.area.isDestroyed(), true); }
      for (const npc of ownedNpcs) assert.equal(npc.isRegistered(), false);
    });
    const messages = [], send = p.sendMessage.bind(p);
    test.mock.method(p, 'sendMessage', msg => { messages.push(msg); return send(msg); });
    actors.push(p); steps.set(p, new Set());
    assert.equal(core.World.getPlayers().add(p), true);
    assert.equal(core.World.getPlayers().get(p.getIndex()), p);
    p.setAttribute('bot-skip-persistence', true);
    for (const [skill, level] of [[core.Skill.SAILING,40],[core.Skill.FISHING,30],[core.Skill.MAGIC,25],[core.Skill.HITPOINTS,99],[core.Skill.DEFENCE,99]]) {
      p.getSkillManager().setMaxLevels(skill, level, false);
      p.getSkillManager().setExperience(skill, core.SkillManager.getExperienceForLevel(level));
      p.getSkillManager().setCurrentLevel(skill, level, false);
    }
    p.setHitpoints(99);
    const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
    const pand = quests.filter(q => q.key === 'pandemonium').at(-1), quest = quests.filter(q => q.key === 'crab_quest').at(-1);
    assert.ok(pand && quest); pand.setStage(p, pand.completionValue);
    const requirement = { player: p, key: 'pandemonium', complete: undefined };
    PluginManager.createApi('crab-dream-requirement-check').emitCustomEvent('quest:is-complete', requirement);
    assert.equal(requirement.complete, true, 'the real registered quest listener confirms the prerequisite');
    assert.ok(p.getSkillManager().getMaxLevel(core.Skill.SAILING) >= 40);
    assert.ok(p.getSkillManager().getMaxLevel(core.Skill.FISHING) >= 30);
    assert.ok(core.Sailing.giveBoat(p, 'raft', 'dognose_island'));
    for (const [id, amount] of [[563,1],[556,3],[554,1]]) p.getInventory().add(new core.Item(id, amount), false);
    p.setSpellbook(core.MagicSpellbook.NORMAL);
    p.setLocation(new core.Location(3055,2639,0)); AreaManager.process(p);
    const area = p.getArea();
    const decision = area ? PluginManager.callArea(area, 'canTeleport', p, 20, new core.Location(3213,3424,0)) : null;
    assert.equal(decision == null, true, 'Dognose area has no explicit teleport decision');
    const conn = new ClientConnection(channel); conn.player = p;
    return {p, quest, messages, conn, test};
  }
  function clickBottle(f) {
    const at = new core.Location(3055,2639,0);
    const object = core.ObjectManager.objectsAt(at).find(o => o.getId() === 62438);
    assert.ok(object, 'the registered quest bottle exists at its authored location');
    const definition = core.ObjectDefinition.forPlayer(62438, f.p);
    assert.equal(definition.getActions()[0], 'Drink');
    return PluginManager.emitObjectInteraction({ player:f.p, object, objectId:62438, clickType:1,
      definition, location:{x:3055,y:2639,z:0}, handled:false });
  }
  function choose(f, option, title) {
    const manager=f.p.getDialogueManager();
    for (let i=0; i<40 && !core.MultiChatboxPrompt.getPending(f.p) && manager.isActive(); i++) {
      const current=manager.getCurrent();
      if (current instanceof core.ActionDialogue && current.isSelfAdvancing()) tick();
      else manager.advance();
    }
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    assert.ok(pending, `actual dialogue presents ${title}`);
    assert.equal(pending.title, title);
    assert.deepEqual(pending.options, ['Yes.', 'No.']);
    assert.equal(PluginManager.emitInterfaceActionClick({ player:f.p, groupId:219, childId:1,
      buttonId:(219<<16)|1, slot:option, action:1, handled:false }), true);
  }
  function firstDrink(f) {
    assert.equal(clickBottle(f), true); choose(f, 1, 'Start Crab Quest?');
    until(f.p, () => steps.get(f.p).has('A8M5CK'));
    until(f.p, () => !f.p.getDialogueManager().isActive());
    assert.ok(f.quest.getStage(f.p) >= 5 && !f.quest.isComplete(f.p));
  }
  function mooring(player) {
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
      const loc = new core.Location(3061+dx,2638+dy,0);
      const object = core.MapObjects.getObjectsAt(loc, null).find(o => core.ObjectDefinition.forPlayer(o.getId(), player)?.getName() === 'Mooring point');
      if (object) return object;
    }
    assert.fail('active cache scene has a Mooring point at Dognose');
  }
  function board(f) {
    const object = mooring(f.p), loc = object.getLocation();
    const definition = core.ObjectDefinition.forPlayer(object.getId(), f.p);
    const clickType = definition.getInteractions().indexOf('Board') + 1;
    assert.ok(clickType > 0, 'active cache exposes Board for this player');
    f.p.setLocation(new core.Location(3060,2638,0)); AreaManager.process(f.p);
    return PluginManager.emitObjectInteraction({player:f.p,object,objectId:object.getId(),definition,clickType,
      location:{x:loc.getX(),y:loc.getY(),z:loc.getZ()},handled:false});
  }
  function boardPortSarim(f) {
    // Fixture setup places the one real owned raft at this dock; no sailing journey is implied.
    assert.equal(f.p.getSailing().boats.length,1);
    const boat = core.Sailing.activeBoat(f.p);
    assert.ok(boat && boat.type==='raft'); assert.equal(core.Sailing.instanceFor(f.p),undefined);
    boat.location = {kind:'docked',dock:'port_sarim'};
    assert.ok(boat && boat.location.kind === 'docked' && boat.location.dock === 'port_sarim');
    let object;
    for (let dx=-2; dx<=2 && !object; dx++) for (let dy=-2; dy<=2 && !object; dy++) {
      const at = new core.Location(3051+dx,3193+dy,0);
      object = core.MapObjects.getObjectsAt(at, null).find(o => {
        const def = core.ObjectDefinition.forPlayer(o.getId(), f.p);
        return ['Gangplank','Mooring point'].includes(def?.getName()) && def.getInteractions().includes('Board');
      });
    }
    assert.ok(object, 'active Port Sarim scene provides a registered boarding object');
    const def=core.ObjectDefinition.forPlayer(object.getId(),f.p), loc=object.getLocation();
    f.p.setLocation(new core.Location(3050,3193,0)); AreaManager.process(f.p);
    assert.equal(PluginManager.emitObjectInteraction({player:f.p,object,objectId:object.getId(),definition:def,
      clickType:def.getInteractions().indexOf('Board')+1,location:{x:loc.getX(),y:loc.getY(),z:loc.getZ()},handled:false}),true);
    tick(3); assert.ok(core.Sailing.instanceAboard(f.p), 'the registered route boards the Port Sarim boat');
    assert.equal(core.Sailing.disembark(f.p,'port_sarim'),null);
    assert.equal(f.p.isNeedsPlacement(),true, 'disembark schedules native placement');
    tick();
    assert.equal(f.p.isNeedsPlacement(),false, 'World completed the landing placement');
    busyFrame(f,'after-disembark');
    assert.equal(f.p.busy(),false, 'the disembarked player is ready to travel');
  }
  function busyFrame(f, boundary) {
    const p=f.p, at=p.getLocation(), dialogue=p.getDialogueManager(), pending=core.MultiChatboxPrompt.getPending(p);
    f.test.diagnostic(`crab-recovery-busy ${JSON.stringify({boundary, interfaceId:p.getInterfaceId(), hp:p.getHitpoints(),
      needsPlacement:p.isNeedsPlacement(), teleporting:p.isTeleportingReturn(), status:p.getStatus(),
      forceMovement:!!p.getForceMovement(), dying:p.isDying, registered:p.isRegistered(),
      area:p.getArea()?.constructor?.name ?? null, dialogueActive:dialogue.isActive(),
      dialogueCurrent:dialogue.getCurrent()?.constructor?.name ?? null, pendingTitle:pending?.title ?? null,
      position:[at.getX(),at.getY(),at.getZ()]})}`);
  }
  async function cast(f) {
    const spell = core.CacheDefinitions.getSpellByName('Varrock Teleport'); assert.ok(spell);
    assert.equal(f.p.busy(), false);
    assert.equal(f.p.getMovementQueue().isMovementBlocked(), false);
    assert.equal(f.p.getCombat().getTeleblockTimer().finished(), true);
    await f.conn.dispatch([{type:'widget_action',widgetId:spell.widgetId,groupId:spell.widgetId>>>16,
      childId:spell.widgetId&65535,slot:-1,buttonNum:1}]); f.conn.processTurnPackets();
  }
  const runes = p => [563,556,554].map(id => p.getInventory().getAmount(id));
  function fishierFrame(p, turn) {
    const loc = p.getLocation(), dest = p.getMovementQueue().getDestination();
    const scene = require('../plugins/skills/sailing/charting/FishierStout.Charting').scenes.get(p);
    return { turn, position:[loc.getX(),loc.getY(),loc.getZ()], teleportSerial:p.getTeleportSerial(),
      teleporting:p.isTeleporting, forceMovement:!!p.getForceMovement(),
      destination:dest ? [dest.getX(),dest.getY(),dest.getZ()] : null,
      interaction:p.getInteractingMobile()?.getIndex?.() ?? null, hp:p.getHitpoints(),
      trolls:scene?.npcs.map(n => ({index:n.getIndex(),target:n.getCombat().getTarget()?.getIndex?.() ?? null})) ?? [] };
  }
  function fishierObserve(p, frames) {
    frames.push(fishierFrame(p, 0));
    for (let turn=1; turn<=8; turn++) { tick(); frames.push(fishierFrame(p, turn)); }
  }
  function fishier(f) {
    // A player can disable auto-retaliate; use an idle caster for the travel check.
    f.p.setAutoRetaliate(false);
    assert.equal(f.p.autoRetaliateReturn(), false);
    const id = core.CacheDefinitions.getObjId('sailing_charting_drink_crate_fishier_stout');
    assert.ok(Number.isInteger(id));
    f.p.getInventory().add(new core.Item(id,1), false);
    const slot = f.p.getInventory().getSlotForItemId(id), item=f.p.getInventory().get(slot);
    assert.ok(item && item.getId()===id);
    assert.equal(PluginManager.emitItemAction({player:f.p,item,itemId:id,slot,interfaceId:149,clickType:2,option:'Drink',handled:false}),true);
    until(f.p,()=>core.MultiChatboxPrompt.getPending(f.p)!==null);
    const prompt=core.MultiChatboxPrompt.getPending(f.p);
    assert.equal(prompt.title,'Are you sure you want to drink this?');
    assert.deepEqual(prompt.options,['Yes.','No.']);
    assert.equal(PluginManager.emitInterfaceActionClick({player:f.p,groupId:219,childId:1,buttonId:(219<<16)|1,slot:1,action:1,handled:false}),true);
    assert.equal(f.p.getInventory().getAmount(id),0,'registered drink consumed the selected item');
    tick(7);
    const scene=require('../plugins/skills/sailing/charting/FishierStout.Charting').scenes.get(f.p);
    assert.ok(scene && scene.area && f.p.getArea()===scene.area, 'actual Fishier producer entered its private arena');
    assert.equal(scene.npcs.length,3, 'the real producer spawned its three trolls');
    // Keep the actual arena and lifecycle, but quiesce unrelated troll combat for this cast check.
    for (const npc of scene.npcs) {
      assert.equal(npc.isRegistered(),true); npc.getCombat().reset();
      f.test.mock.method(npc.getCombat(), 'attack', () => {});
    }
    assert.equal(PluginManager.callArea(scene.area,'canTeleport',f.p,20,new core.Location(3213,3424,0)),true);
    assert.equal(f.p.busy(),false); assert.equal(f.p.getMovementQueue().isMovementBlocked(),false);
    assert.equal(f.p.needsPlacement,false, 'World processed native placement');
    assert.equal(f.p.getMovementQueue().getDestination(),null, 'no walk is queued before the cast');
    assert.equal(f.p.getForceMovement() == null,true, 'no forced movement is active before the cast');
    assert.equal(f.p.getInteractingMobile() == null,true, 'the caster has no active interaction');
  }
  await t.test('before a dose a legal moored boat boards normally', async test => {
    const f=actor(test); assert.equal(f.quest.getStage(f.p),0);
    assert.equal(clickBottle(f),true); choose(f,2,'Start Crab Quest?');
    assert.equal(f.quest.getStage(f.p),0); assert.ok(!steps.get(f.p).has('A8M5CK'));
    assert.equal(board(f),true); tick(3);
    assert.ok(core.Sailing.instanceAboard(f.p));
  });
  await t.test('before a dose a legal Varrock cast consumes its runes and arrives', async test => {
    const f=actor(test); assert.equal(f.quest.getStage(f.p),0); const xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC); await cast(f); tick(8);
    const at=f.p.getLocation(); assert.ok(Math.abs(at.getX()-3213)<=2 && Math.abs(at.getY()-3424)<=2 && at.getZ()===0);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp+35); assert.deepEqual(runes(f.p),[0,0,0]);
  });
  await t.test('confirmed first drink refuses a legal moored boat without changing it', async test => {
    const f=actor(test); firstDrink(f);
    const before=JSON.stringify(f.p.getSailing().boats);
    assert.equal(f.p.busy(), false); assert.equal(board(f),true); tick(3);
    assert.equal(core.Sailing.instanceAboard(f.p),undefined);
    assert.equal(JSON.stringify(f.p.getSailing().boats),before);
    assert.ok(f.messages.some(m => m.includes('headache') && m.includes('boat')));
  });
  await t.test('confirmed first drink refuses a legal Varrock cast without runes or XP loss', async test => {
    const f=actor(test); firstDrink(f);
    const before=runes(f.p), xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
    assert.equal(f.p.busy(),false); await cast(f); tick(8);
    assert.deepEqual(runes(f.p),before); assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp);
    assert.equal(f.p.isTeleporting,false); assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3055,2639]);
    assert.ok(f.messages.some(m => m.includes('headache') && m.includes('teleport')));
  });
  // Controlled registered callbacks between request and task; not a claim of natural click timing.
  await t.test('first sip before an already scheduled boarding commit prevents it', async test => {
    const f=actor(test), before=JSON.stringify(f.p.getSailing().boats);
    assert.equal(board(f),true); assert.equal(core.Sailing.instanceAboard(f.p),undefined);
    assert.equal(clickBottle(f),true); choose(f,1,'Start Crab Quest?');
    assert.ok(steps.get(f.p).has('A8M5CK'), 'the actual sip committed before processing the boarding task');
    tick(3); assert.equal(core.Sailing.instanceAboard(f.p),undefined);
    assert.equal(JSON.stringify(f.p.getSailing().boats),before);
  });
  await t.test('second-dose No retains lock; Yes restores boarding; re-entry relocks', async test => {
    const f=actor(test); firstDrink(f);
    assert.equal(clickBottle(f),true); choose(f,2,'Drink from the bottle again?');
    assert.ok(!steps.get(f.p).has('_Hk79X')); f.p.getDialogueManager().reset();
    assert.equal(board(f),true); tick(3); assert.equal(core.Sailing.instanceAboard(f.p),undefined);
    assert.equal(clickBottle(f),true); choose(f,1,'Drink from the bottle again?'); until(f.p,()=>steps.get(f.p).has('_Hk79X'));
    until(f.p,()=>!f.p.getDialogueManager().isActive());
    assert.equal(board(f),true); tick(3); assert.ok(core.Sailing.instanceAboard(f.p));
    assert.equal(core.Sailing.disembark(f.p,'dognose_island'),null);
    f.p.setLocation(new core.Location(3055,2639,0));
    assert.equal(clickBottle(f),true); until(f.p,()=>steps.get(f.p).has('ON9Mp-'));
    until(f.p,()=>!f.p.getDialogueManager().isActive());
    assert.equal(board(f),true); tick(3); assert.equal(core.Sailing.instanceAboard(f.p),undefined);
  });
  await t.test('second dose restores Varrock cast', async test => {
    const f=actor(test); firstDrink(f); assert.equal(clickBottle(f),true); choose(f,1,'Drink from the bottle again?');
    until(f.p,()=>steps.get(f.p).has('_Hk79X')); until(f.p,()=>!f.p.getDialogueManager().isActive());
    const xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC); await cast(f); tick(8);
    const at=f.p.getLocation(); assert.ok(Math.abs(at.getX()-3213)<=2 && Math.abs(at.getY()-3424)<=2 && at.getZ()===0);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp+35); assert.deepEqual(runes(f.p),[0,0,0]);
  });
  await t.test('ordinary Fishier arena permits a legal Varrock cast', async test => {
    const f=actor(test); fishier(f); const xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
    await cast(f); tick(8); const at=f.p.getLocation();
    assert.ok(Math.abs(at.getX()-3213)<=2 && Math.abs(at.getY()-3424)<=2 && at.getZ()===0);
    assert.deepEqual(runes(f.p),[0,0,0]); assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp+35);
  });
  await t.test('first sip still refuses a legal cast inside the real Fishier allow area', async test => {
    const f=actor(test); firstDrink(f); fishier(f);
    const at=f.p.getLocation().clone(), before=runes(f.p), xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
    const frames=[];
    try { frames.push(fishierFrame(f.p, 'before-cast')); await cast(f); fishierObserve(f.p, frames); }
    finally { test.diagnostic(`fishier-cast-frames ${JSON.stringify(frames)}`); }
    assert.deepEqual(runes(f.p),before); assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp);
    assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],[at.getX(),at.getY(),at.getZ()]);
    assert.equal(f.p.isTeleporting,false); assert.ok(f.messages.some(m=>m.includes('headache') && m.includes('teleport')));
  });
  await t.test('observe the same Fishier scene without casting', async test => {
    const f=actor(test); firstDrink(f); fishier(f); const frames=[];
    try { fishierObserve(f.p, frames); }
    finally { test.diagnostic(`fishier-no-cast-frames ${JSON.stringify(frames)}`); }
    assert.equal(frames.length,9);
    assert.equal(require('../plugins/skills/sailing/charting/FishierStout.Charting').scenes.has(f.p),true);
    for (const frame of frames) {
      assert.deepEqual(frame.position,frames[0].position, 'idle no-cast position stays fixed');
      assert.equal(frame.teleportSerial,frames[0].teleportSerial);
      assert.equal(frame.destination,null);
      assert.equal(frame.forceMovement,false);
    }
  });
  await t.test('committed dream state survives the actual player save round-trip', async test => {
    const f=actor(test); firstDrink(f); const snapshot=PlayerSave.fromPlayer(f.p);
    PluginManager.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    core.World.getPlayers().remove(f.p);
    const restored=actor(test, f.p.getUsername()); snapshot.applyToPlayer(restored.p);
    assert.equal(restored.p.getLongUsername(), f.p.getLongUsername());
    assert.notEqual(restored.p.getLongUsername(), 0n);
    assert.equal(core.World.getPlayers().get(restored.p.getIndex()), restored.p, "saved actor remains the admitted World player");
    assert.equal(board(restored),true); tick(3); assert.equal(core.Sailing.instanceAboard(restored.p),undefined);
    assert.ok(restored.messages.some(m=>m.includes('headache')));
  });
  await t.test('ordinary Port Sarim boarding is available with a locally docked boat', async test => {
    const f=actor(test); boardPortSarim(f);
  });
  await t.test('real death clears the dream before both saves and restores travel after respawn', async test => {
    const f=actor(test); firstDrink(f);
    assert.equal(f.p.getAttribute('crab-quest:dream-headache'),true);
    const saves=[], persistence=GameConstants.PLAYER_PERSISTENCE, original=persistence.requestSave.bind(persistence);
    test.mock.method(persistence,'requestSave',(player,reason) => {
      if (player===f.p && (reason==='death' || reason==='respawn')) saves.push([reason,player.getAttribute('crab-quest:dream-headache')]);
      return original(player,reason);
    });
    f.p.setHitpoints(0); assert.equal(f.p.isDying,true); tick(8);
    busyFrame(f,'after-death');
    assert.equal(f.p.isDying,false); assert.equal(f.p.getAttribute('crab-quest:dream-headache'),false);
    assert.deepEqual(saves,[['death',false],['respawn',false]]);
    assert.notDeepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3055,2639]);
    assert.equal(f.p.getInterfaceId(),30003, 'the actual PvP death presets modal opened');
    await f.conn.dispatch([{type:'interface_close'}]); f.conn.processTurnPackets();
    assert.equal(f.p.getInterfaceId(),-1, 'the normal client close released the modal');
    boardPortSarim(f);
    for (const [id, amount] of [[563,1],[556,3],[554,1]]) {
      f.p.getInventory().deleteNumber(id, f.p.getInventory().getAmount(id), true);
      f.p.getInventory().add(new core.Item(id,amount),false);
    }
    const xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC); await cast(f); tick(8);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp+35);
    assert.deepEqual(runes(f.p),[0,0,0]);
    const at=f.p.getLocation(); assert.ok(Math.abs(at.getX()-3213)<=2 && Math.abs(at.getY()-3424)<=2 && at.getZ()===0);
    assert.equal(f.p.isTeleporting,false);
  });
  await t.test('music cape unchecked exit remains locked until saved state is recovered by registered login', async test => {
    const f=actor(test); firstDrink(f);
    // Seed the actual music progression; the registered cape action is the unchecked exit.
    const Progress=require('../plugins/world/Progress.Music');
    const tracks=require('../plugins/world/Music.plugin')._test.getCatalog().nonHolidayTrackIds;
    assert.ok(Array.isArray(tracks) && tracks.length>0 && tracks.every(Number.isInteger));
    for (const id of tracks) Progress.unlock(f.p,id);
    assert.equal(Progress.allUnlocked(f.p,tracks),true); assert.equal(core.WorldDefinition.isMembersWorld(),true);
    const cape=core.ItemIdentifiers.MUSIC_CAPE, options=core.CacheDefinitions.getItem(cape).inventoryActions;
    const clickType=options.findIndex(option=>option?.toLowerCase()==='teleport')+1;
    assert.ok(clickType>0,'active cache exposes the music cape teleport');
    f.p.getInventory().add(new core.Item(cape,1),false);
    const slot=f.p.getInventory().getSlotForItemId(cape), item=f.p.getInventory().get(slot);
    assert.ok(item && item.getId()===cape);
    assert.equal(PluginManager.emitItemAction({player:f.p,item,itemId:cape,slot,interfaceId:149,clickType,
      option:options[clickType-1],handled:false}),true); tick(8);
    assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],[2689,3550,0]);
    assert.equal(f.p.getAttribute('crab-quest:dream-headache'),true);
    const before=runes(f.p), xpBefore=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
    const atBefore=f.p.getLocation().clone(); await cast(f); tick(2); assert.deepEqual(runes(f.p),before);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xpBefore);
    assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],
      [atBefore.getX(),atBefore.getY(),atBefore.getZ()]);
    assert.equal(f.p.isTeleporting,false); assert.ok(f.messages.some(m=>m.includes('headache') && m.includes('teleport')));
    const snapshot=PlayerSave.fromPlayer(f.p); PluginManager.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    core.World.getPlayers().remove(f.p);
    const restored=actor(test,f.p.getUsername()); snapshot.applyToPlayer(restored.p);
    assert.equal(restored.p.getAttribute('crab-quest:dream-headache'),true, 'save applied before login');
    PluginManager.emitPlayerLogin({player:restored.p,username:restored.p.getUsername()});
    assert.equal(restored.p.getAttribute('crab-quest:dream-headache'),false);
    boardPortSarim(restored); const xp=restored.p.getSkillManager().getExperience(core.Skill.MAGIC);
    await cast(restored); tick(8); assert.equal(restored.p.getSkillManager().getExperience(core.Skill.MAGIC),xp+35);
    assert.deepEqual(runes(restored.p),[0,0,0]);
    const at=restored.p.getLocation(); assert.ok(Math.abs(at.getX()-3213)<=2 && Math.abs(at.getY()-3424)<=2 && at.getZ()===0);
    assert.equal(restored.p.isTeleporting,false);
  });
  await t.test('registered login clears saved dream state on the island as a recovery policy', async test => {
    const f=actor(test); firstDrink(f); const snapshot=PlayerSave.fromPlayer(f.p);
    PluginManager.emitPlayerLogout({player:f.p,username:f.p.getUsername()}); core.World.getPlayers().remove(f.p);
    const restored=actor(test,f.p.getUsername()); snapshot.applyToPlayer(restored.p);
    assert.equal(restored.p.getAttribute('crab-quest:dream-headache'),true);
    PluginManager.emitPlayerLogin({player:restored.p,username:restored.p.getUsername()});
    assert.equal(restored.p.getAttribute('crab-quest:dream-headache'),false);
    assert.equal(board(restored),true); tick(3); assert.ok(core.Sailing.instanceAboard(restored.p));
  });
  await t.test('death during the bottle conversation cannot reapply the headache later', async test => {
    const f=actor(test); assert.equal(clickBottle(f),true); choose(f,1,'Start Crab Quest?');
    until(f.p,()=>steps.get(f.p).has('A8M5CK')); assert.equal(f.p.getAttribute('crab-quest:dream-headache'),true);
    assert.equal(f.p.getDialogueManager().isActive(),true, 'the real conversation is still live at death');
    f.p.setHitpoints(0); assert.equal(f.p.isDying,true); tick(12);
    assert.equal(f.p.isDying,false); assert.equal(f.p.getAttribute('crab-quest:dream-headache'),false);
    assert.equal(core.MultiChatboxPrompt.getPending(f.p),null);
    await f.conn.dispatch([{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:1}]); f.conn.processTurnPackets(); tick(2);
    assert.equal(f.p.getDialogueManager().isActive(),false);
    assert.equal(f.p.getAttribute('crab-quest:dream-headache'),false);
  });
  await t.test('actual quest completion clears the dream and permits travel', async test => {
    const f=actor(test); firstDrink(f); assert.equal(f.p.getAttribute('crab-quest:dream-headache'),true);
    const sender=f.p.getPacketSender(), opened=[], sendInterface=sender.sendInterface.bind(sender);
    test.mock.method(sender,'sendInterface',id => { opened.push(id); return sendInterface(id); });
    assert.equal(f.quest.complete(f.p),true); assert.equal(f.quest.isComplete(f.p),true);
    assert.equal(f.p.getAttribute('crab-quest:dream-headache'),false);
    tick(2); assert.ok(opened.includes(153), 'the real completion scroll opened');
    sender.sendInterfaceRemoval(); assert.equal(f.p.busy(),false);
    const xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC); await cast(f); tick(8);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp+35); assert.deepEqual(runes(f.p),[0,0,0]);
    assert.equal(f.p.isTeleporting,false);
  });
});
